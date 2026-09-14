/**
 * Admin HTTP + Dev Console — health, metrics, audit (token-protected).
 * Bind localhost by default.
 *
 *   GET  /health             open (no token) localhost
 *   GET  /ui *.css *.js      Dev Console web page + static assets (?token=)
 *   GET  /api/status         live snapshot (main + minis + flags)
 *   GET  /api/dashboard      aggregated dashboard payload (minis + stats + audit + bans)
 *   GET  /api/stats          time-series + hourly aggregates + flag summary
 *   GET  /api/bans           global bot bans
 *   POST /api/action         run a dev-console action
 *   GET  /api/events         SSE live console log stream
 *   GET  /api/help           supported actions
 *   GET  /metrics /flags /policies /audit
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getMetricsSnapshot, metricsPrometheus } from "./metrics.js";
import { queryAudit } from "./audit.js";
import { getFlags } from "./flags.js";
import { getPolicies } from "./policy.js";
import { queueStats } from "./queue.js";
import { getMode } from "../utils/access.js";
import { listBotBans } from "../utils/globalBan.js";
import { getLogGroupJid, isSetupDone } from "../utils/logGroup.js";
import { BOT_INFO } from "../config/constants.js";
import { checkFfmpeg } from "../onboarding/setup.js";
import logger from "../utils/logger.js";
import {
  getDevSnapshot,
  runDevAction,
  devActions,
} from "./devConsole.js";
import { getStats, summarizeFlags, startStatsSampler } from "./statsStore.js";
import {
  getRingTail,
  subscribeConsole,
} from "../utils/consoleRing.js";
import {
  CREATOR_ONLY_ACTIONS,
  CONFIRM_REQUIRED,
  OPERATOR_CONFIG_KEYS,
  guardRcAction,
  armRcAction,
  isRcArmed,
} from "./rcMonitor.js";

let server = null;

// --- static dashboard assets (read once at boot) -----------------------------

const DASH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard");
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const staticCache = new Map(); // url -> { mime, body }

function loadStatic() {
  if (staticCache.size) return;
  for (const [name, mime] of [
    ["index.html", STATIC_MIME[".html"]],
    ["styles.css", STATIC_MIME[".css"]],
    ["app.js", STATIC_MIME[".js"]],
    ["favicon.svg", STATIC_MIME[".svg"]],
  ]) {
    const file = path.join(DASH_DIR, name);
    try {
      const body = fs.readFileSync(file);
      staticCache.set(`/${name}`, { mime, body });
    } catch {
      staticCache.set(`/${name}`, null);
    }
  }
}

function auth(req, token) {
  if (!token) return false;
  const h = req.headers.authorization || "";
  if (h === `Bearer ${token}`) return true;
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("token") === token;
}

/**
 * Resolve which tier this request authenticated as.
 *   null      — not authenticated
 *   "creator" — ADMIN_HTTP_TOKEN (full access)
 *   "operator" — ADMIN_OPERATOR_TOKEN (restricted dev-console tier)
 */
function resolveRole(req) {
  const creator = process.env.ADMIN_HTTP_TOKEN || "";
  if (creator && auth(req, creator)) return "creator";
  const operator = process.env.ADMIN_OPERATOR_TOKEN || "";
  if (operator && auth(req, operator)) return "operator";
  return null;
}

/** Dev-console actions only the creator (host) token may run (see rcMonitor.js). */

/** JL1-style watching denial used when an operator hits a creator-only action. */
function watchedDenial(action) {
  return {
    ok: false,
    watched: true,
    error: "creator-only action",
    hint:
      "Nice try 👀 that one is creator-only and the attempt is already logged. " +
      "Everything you do here is visible to the creator — I am watching.",
  };
}

function json(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

/** Read a JSON request body (best effort) → merges with query params. */
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 100_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function handleSSE(req, res, token) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  const heartbeat = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      cleanup();
    }
  }, 15_000);

  const unsub = subscribeConsole((entry) => {
    try {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch {
      cleanup();
    }
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    try {
      unsub?.();
    } catch { /* ignore */ }
    try {
      res.end();
    } catch { /* ignore */ }
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

export function startAdminHttp() {
  const port = Number(process.env.ADMIN_HTTP_PORT || 0);
  if (!port) {
    logger.info?.("Admin HTTP disabled (set ADMIN_HTTP_PORT to enable)");
    return null;
  }

  const host = process.env.ADMIN_HTTP_HOST || "127.0.0.1";
  const token = process.env.ADMIN_HTTP_TOKEN || "";

  if (!token) {
    console.warn(
      "[admin-http] ADMIN_HTTP_PORT set but ADMIN_HTTP_TOKEN missing — refusing to start"
    );
    return null;
  }

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`);
      const path = url.pathname;

      // Health is open on localhost only (still require token if remotely bound)
      if (path === "/health") {
        const ff = await checkFfmpeg();
        return json(res, 200, {
          ok: true,
          name: BOT_INFO.NAME,
          version: BOT_INFO.VERSION,
          mode: await getMode(),
          ffmpeg: ff.ok,
          setup: await isSetupDone(),
          logGroup: !!(await getLogGroupJid()),
          queue: queueStats(),
        });
      }

      // ----- Self-service onboarding (public invite links) -----------------
      // Public surface ONLY: the /invite/<token>/… page + its pairing API.
      // Everything else on this port stays token-protected. The page delivers
      // the pairing code inline, so nobody ever has to DM the main with #pair.
      // Rate limiting + per-token caps happen inside invites.js.
      if (path.startsWith("/invite/")) {
        const segs = path.slice("/invite/".length).split("/").filter(Boolean);
        const token = decodeURIComponent(segs[0] || "");
        const { renderInvitePage, pairNumber, allowInviteLoad } = await import("./invites.js");
        const ip = String(req.socket.remoteAddress || "?").replace(/^::ffff:/, "");
        if (segs.length === 1 && req.method === "GET") {
          if (!allowInviteLoad(ip)) return json(res, 429, { error: "too many views — slow down" });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(renderInvitePage(token));
        }
        if (segs.length === 2 && segs[1] === "pair" && req.method === "POST") {
          const body = await readBody(req);
          const out = await pairNumber(token, { ip, number: body?.number });
          return json(res, out.ok ? 200 : 400, out);
        }
        return json(res, 404, { error: "not_found" });
      }

      // Static dashboard assets (client code only — the API surface below
      // stays token-protected).
      if (path === "/styles.css" || path === "/app.js" || path === "/favicon.svg") {
        loadStatic();
        const entry = staticCache.get(path);
        if (!entry?.body) return json(res, 404, { error: "asset missing" });
        res.writeHead(200, { "Content-Type": entry.mime, "Cache-Control": "no-store" });
        return res.end(entry.body);
      }

      const role = resolveRole(req);
      if (!role) {
        return json(res, 401, { error: "unauthorized" });
      }

      // ----- Dev Console ------------------------------------------------
      if (path === "/ui" || path === "/index.html") {
        loadStatic();
        const entry = staticCache.get("/index.html");
        if (!entry?.body) return json(res, 404, { error: "index missing" });
        res.writeHead(200, { "Content-Type": entry.mime, "Cache-Control": "no-store" });
        return res.end(entry.body);
      }

      // ----- Temporal media cache -------------------------------------
      // Served ONLY through the in-memory index (session + log id, both
      // decoded from the path) — never via user-supplied file paths. The
      // bytes follow the RAM-log lifecycle: they die with the process.
      if (path.startsWith("/media/")) {
        if (role !== "creator") return json(res, 403, { error: "creator-only" });
        const { getMedia } = await import("./mediaCache.js");
        const rest = decodeURIComponent(path.slice("/media/".length));
        const idx = rest.indexOf("/");
        const key = idx < 0 ? rest : rest.slice(0, idx) + "/" + rest.slice(idx + 1);
        const meta = getMedia(key);
        if (!meta) return json(res, 404, { error: "media not found" });
        res.writeHead(200, {
          "Content-Type": meta.mime || "application/octet-stream",
          "Content-Length": meta.size,
          "Cache-Control": "no-store",
          "X-Media-Name": encodeURIComponent(meta.name || ""),
        });
        return require("fs").createReadStream(meta.file).pipe(res);
      }

      if (path === "/api/status") {
        return json(res, 200, await getDevSnapshot());
      }

      if (path === "/api/dashboard") {
        const [status, stats, flags, bans, policies, lang, owners, creators] = await Promise.all([
          getDevSnapshot(),
          getStats(),
          summarizeFlags(),
          listBotBans(),
          getPolicies(),
          (async () => {
            try {
              const { kvGet } = await import("../database/botKv.js");
              return await kvGet("lang");
            } catch { return null; }
          })(),
          (async () => {
            try {
              const { getOwnerNumbers } = await import("../utils/access.js");
              return getOwnerNumbers();
            } catch { return []; }
          })(),
          (async () => {
            try {
              const { getCreatorNumbers } = await import("../utils/access.js");
              return getCreatorNumbers();
            } catch { return []; }
          })(),
        ]);
        let userFlags = [];
        try {
          const { listFlaggedUsers } = await import("../multi/miniMonitor.js");
          userFlags = await listFlaggedUsers();
        } catch { /* ignore */ }
        const { getPrefix, getBotName } = await import("../config/constants.js");
        return json(res, 200, {
          generated_at: Date.now(),
          name: BOT_INFO.NAME,
          version: BOT_INFO.VERSION,
          role,
          main: status.main,
          minis: status.minis,
          rc: status.rc,
          userFlags,
          flagsTotal: status.flagsTotal,
          stats,
          flags,
          bans,
          features: await getFlags(),
          config: { prefix: getPrefix(), botname: getBotName(), lang: lang || process.env.BOT_LANG || "en", policies },
          roles: { owners, creators },
        });
      }

      if (path === "/api/fleet") {
        const { fetchFleet, selfSnapshot } = await import("./fleet.js");
        const [snap, peers] = await Promise.all([getDevSnapshot(), fetchFleet()]);
        let localName = BOT_INFO.NAME || "you";
        try {
          const { getBotName } = await import("../config/constants.js");
          localName = getBotName() || localName;
        } catch { /* keep default */ }
        const self = selfSnapshot(snap.main, snap.minis, BOT_INFO.VERSION);
        self.name = localName;
        const all = [self, ...peers];
        const connected = all.filter((p) => p.ok && p.linked).length;
        const reachable = all.filter((p) => p.ok).length;
        const minisOn = all.reduce((a, p) => a + (p.ok ? p.minisOn : 0), 0);
        return json(res, 200, {
          self,
          peers,
          combined: {
            mains: all.length,
            reachable,
            connected,
            minis: all.reduce((a, p) => a + (p.ok ? p.minis : 0), 0),
            minisOn,
          },
        });
      }

      if (path === "/api/stats") {
        return json(res, 200, await getStats());
      }

      if (path === "/api/bans") {
        return json(res, 200, { bans: await listBotBans() });
      }

      if (path === "/api/help") {
        return json(res, 200, { actions: devActions() });
      }

      if (path === "/api/events") {
        return handleSSE(req, res, token);
      }

      if (path === "/api/action" && (req.method === "POST" || req.method === "GET")) {
        const body = await readBody(req);
        const params = { ...Object.fromEntries(url.searchParams.entries()), ...body };
        const action = params.action;
        if (!action) return json(res, 400, { error: "action required" });

        const actor = role === "creator" ? "web:creator" : "web:operator";
        const isOperator = role === "operator";

        // ------ Remote-control safeguard (operator tier) -------------------
        if (isOperator) {
          // explicit arm (the real "yes I meant it" — needed for CONFIRM_REQUIRED)
          if (action === "rc.arm") {
            const target = String(params.target || "").trim();
            if (!target) return json(res, 400, { ok: false, confirm: true, error: "target action required" });
            const a = armRcAction(actor, target);
            return json(res, 200, { ok: true, ...a });
          }
          if (action === "rc.clear") {
            const { clearRcFlags, resetRcActor } = await import("./rcMonitor.js");
            await clearRcFlags("web:operator", params.id || "all");
            if (String(params.resetLock) === "true") resetRcActor("web:operator");
            return json(res, 200, { ok: true, data: { actor } });
          }
          if (action === "rc.status") {
            const { getRcMonitor } = await import("./rcMonitor.js");
            return json(res, 200, { ok: true, data: await getRcMonitor() });
          }
        }

        if (role !== "creator" && CREATOR_ONLY_ACTIONS.has(action)) {
          try {
            const { writeAudit } = await import("./audit.js");
            await writeAudit({
              action: "creator:deny",
              actor: "operator-token",
              target: action,
              chat: null,
              meta: { source: "web", req: url.pathname },
            });
          } catch { /* audit best effort */ }
          try {
            const { systemLog } = await import("../utils/logGroup.js");
            await systemLog("warn", `🚨 [CREATOR] operator-token tried *${action}* on the web console`, "logged via /api/action");
          } catch { /* ignore */ }
          return json(res, 403, watchedDenial(action));
        }

        // Operators may only `config.set` whitelisted keys — freeform `config:*`
        // KV writes can break the bot and stay creator-only.
        if (isOperator && action === "config.set" && !OPERATOR_CONFIG_KEYS.has(String(params.key || "").toLowerCase().trim())) {
          try {
            const { writeAudit } = await import("./audit.js");
            await writeAudit({
              action: "creator:deny",
              actor: "operator-token",
              target: "config.set:" + String(params.key || "?"),
              chat: null,
              meta: { source: "web", req: url.pathname },
            });
          } catch { /* audit best effort */ }
          try {
            const { systemLog } = await import("../utils/logGroup.js");
            await systemLog("warn", `🚨 [CREATOR] operator-token tried *config.set ${String(params.key || "?")}* on the web console`, "logged via /api/action");
          } catch { /* ignore */ }
          return json(res, 403, watchedDenial("config.set:" + String(params.key || "?")));
        }

        // Danger-sensitive actions need an armed confirm first (server-side).
        // send.chat to a group/community/broadcast is treated like one too —
        // the safety monitor has to be everywhere, so group-wide blind sends
        // can never fire without an explicit arm.
        const groupSend =
          action === "send.chat" &&
          /@g\.us$|@broadcast$/.test(String(params?.to || ""));
        if (
          isOperator &&
          !isRcArmed(actor, action) &&
          (CONFIRM_REQUIRED.has(action) || groupSend)
        ) {
          return json(res, 403, {
            ok: false,
            confirm: true,
            required: action,
            hint: `🔒 *${action}*${groupSend ? " targets a group/community — visible to every member —" : ""} needs an explicit confirm. Click it again and confirm the dialog to arm it (90 s window). Logged, watched. 👀`,
          });
        }

        // Score the operator's action through the rc monitor.
        if (isOperator) {
          const g = await guardRcAction(actor, action, { req: path });
          if (!g.ok) {
            return json(res, 423, {
              ok: false,
              watched: true,
              locked: g.locked === true,
              score: g.score,
              threshold: g.threshold,
              lockRemainingMs: g.lockRemainingMs || 0,
              hint: g.hint || watchedDenial(action).hint,
            });
          }
        }

        const result = await runDevAction(action, { ...params, actor: params.actor || actor });

        // Attach the shareable invite origin to freshly minted links so the
        // dashboard can show a copy-ready URL (uses the origin the operator
        // actually reached this server through).
        if (action === "invite.create" && result?.ok && result.data?.token) {
          result.data.url = `${url.protocol}//${url.host}/invite/${result.data.token}`;
        }

        // Every "send as bot" is audited, whatever tier ran it — the monitor
        // follows the message, not just the console action.
        if (action === "send.chat") {
          try {
            const { writeAudit } = await import("./audit.js");
            const raw = String(params?.to || "");
            await writeAudit({
              action: "chat:send:" + (raw.endsWith("@g.us") ? "group" : raw.endsWith("@broadcast") ? "broadcast" : "dm"),
              actor,
              target: raw.split("@")[0],
              chat: null,
              meta: {
                to: String(params?.to || ""),
                kind: raw.endsWith("@broadcast") ? "broadcast" : raw.endsWith("@g.us") ? "group" : "dm",
                via: params?.via || "main",
                chars: String(params?.text || "").length,
                source: "web",
              },
            });
          } catch { /* audit best effort */ }
        }

        return json(res, result.ok ? 200 : 400, result);
      }

      // ----- Legacy header endpoints ------------------------------------
      if (path === "/metrics" && url.searchParams.get("format") === "prom") {
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(metricsPrometheus());
        return;
      }

      if (path === "/metrics") {
        return json(res, 200, getMetricsSnapshot());
      }

      if (path === "/flags") {
        return json(res, 200, await getFlags());
      }

      if (path === "/policies") {
        return json(res, 200, await getPolicies());
      }

      if (path === "/audit") {
        const limit = Number(url.searchParams.get("limit") || 50);
        const action = url.searchParams.get("action") || undefined;
        return json(res, 200, await queryAudit({ limit, action }));
      }

      if (path === "/") {
        return json(res, 200, {
          service: BOT_INFO.NAME,
          ui: "GET /ui",
          endpoints: [
            "GET /health",
            "GET /ui",
            "GET /api/status",
            "GET /api/dashboard",
            "GET /api/stats",
            "GET /api/bans",
            "POST /api/action",
            "GET /api/events (SSE)",
            "GET /api/help",
            "GET /metrics",
            "GET /metrics?format=prom",
            "GET /flags",
            "GET /policies",
            "GET /audit?limit=50",
          ],
        });
      }

      return json(res, 404, { error: "not_found" });
    } catch (err) {
      return json(res, 500, { error: err?.message || "error" });
    }
  });

  server.listen(port, host, () => {
    console.log(`🛡 Admin HTTP on http://${host}:${port} (token required)`);
    console.log(`   Dev console: http://${host}:${port}/ui`);
    startStatsSampler();
  });

  return server;
}

export function stopAdminHttp() {
  if (server) {
    server.close();
    server = null;
  }
}