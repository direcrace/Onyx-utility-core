

import { exec } from "child_process";
import { BOT_INFO } from "../config/constants.js";



async function mainBotSnapshot() {
  const out = {
    connected: false,
    user: null,
    wsReady: 0,
    mode: "unknown",
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    queue: null,
    metrics: null,
    panic: null,
    systemWatch: null,
    host: null,
  };
  try {
    const { getConnection } = await import("../socket/connection.js");
    const conn = getConnection();
    out.connected = !!conn;
    out.user = conn?.user?.id || null;
    out.wsReady = conn?.ws?.isOpen ? 1 : (conn?.ws?.socket?.readyState ?? 0);
  } catch {  }
  try {
    const { getMode } = await import("../utils/access.js");
    out.mode = await getMode();
  } catch {  }
  try {
    const { queueStats } = await import("./queue.js");
    out.queue = queueStats();
  } catch {  }
  try {
    const { getMetricsSnapshot } = await import("./metrics.js");
    out.metrics = getMetricsSnapshot();
  } catch {  }
  try {
    const { getCorePanicStatus } = await import("../system/corePanic.js");
    out.panic = getCorePanicStatus();
  } catch {  }
  try {
    const { getSystemWatchStatus, hostSnapshot } = await import("../system/systemWatch.js");
    out.systemWatch = getSystemWatchStatus();
    out.host = await hostSnapshot();
  } catch {  }
  return out;
}

async function miniSnapshots() {
  const { getSubSessions, getIndexEntries } = await import("../multi/sessionManager.js");
  const { getMiniAdmin } = await import("../multi/miniMonitor.js");
  const live = getSubSessions();
  const index = await getIndexEntries();
  const known = [];
  for (const e of index) {
    const s = live.find((x) => x.number === e.number);
    known.push({
      number: e.number,
      status: s?.status || e.status,
      linkedAt: e.linkedAt,
      lastSeen: s?.lastSeen || null,
      suspendReason: e.suspendReason || null,
    });
  }
  for (const s of live) {
    if (!known.some((k) => k.number === s.number)) {
      known.push({ number: s.number, status: s.status, linkedAt: s.linkedAt, lastSeen: s.lastSeen || null, suspendReason: null });
    }
  }
  return await Promise.all(
    known.map(async (s) => {
      let admin = null;
      try {
        admin = await getMiniAdmin(s.number);
      } catch {  }
      return {
        number: s.number,
        status: s.status,
        linkedAt: s.linkedAt,
        lastSeen: s.lastSeen || null,
        suspendReason: s.suspendReason || null,
        openFlags: admin ? admin.records.filter((r) => !r.resolved).length : 0,
        score: admin ? admin.windowScore : 0,
        threshold: admin ? admin.thresholds.suspend : 0,
      };
    })
  );
}


export async function getDevSnapshot() {
  const [main, minis] = await Promise.all([mainBotSnapshot(), miniSnapshots()]);
  let rc = null;
  try {
    const { getRcMonitor } = await import("./rcMonitor.js");
    rc = await getRcMonitor();
  } catch {  }
  return {
    generated_at: Date.now(),
    name: BOT_INFO.NAME,
    version: "5.0.3",
    main,
    minis,
    rc,
    flagsTotal: minis.reduce((a, m) => a + m.openFlags, 0),
  };
}



const PM2_APP =
  process.env.PM2_APP_NAME ||
  process.env.name ||
  (process.env.PM2_ID ? `pm${process.env.PM2_ID}` : "") ||
  "onyx";

function pm2Stop(cb) {
  exec(`pm2 stop ${PM2_APP}`, { windowsHide: true }, (err) => cb(!!err));
}

function jidOf(number) {
  return `${String(number).replace(/\D/g, "")}@s.whatsapp.net`;
}


export async function runDevAction(action, params = {}) {
  const p = params || {};
  const norm = () => String(p.number || p.target || "").replace(/\D/g, "");
  try {
    switch (action) {
      case "status":
        return { ok: true, data: await getDevSnapshot() };

      case "logs.tail": {
        const { getRingTail } = await import("../utils/consoleRing.js");
        return { ok: true, data: getRingTail(p.n || 100, p.filter) };
      }

      case "minis.list": {
        const { getSubSessions } = await import("../multi/sessionManager.js");
        return { ok: true, data: getSubSessions() };
      }

      case "minis.suspend": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { suspendSubSession } = await import("../multi/sessionManager.js");
        await suspendSubSession(n, p.reason || "dev-console");
        return { ok: true, data: { number: n } };
      }

      case "minis.unsuspend": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { unsuspendSubSession } = await import("../multi/sessionManager.js");
        await unsuspendSubSession(n);
        return { ok: true, data: { number: n } };
      }

      case "minis.remove": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { removeSubSession } = await import("../multi/sessionManager.js");
        await removeSubSession(n);
        return { ok: true, data: { number: n } };
      }

      case "minis.respawn": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { respawnSubSession } = await import("../multi/sessionManager.js");
        const entry = await respawnSubSession(n);
        return { ok: true, data: { number: n, respawned: !!entry } };
      }

      case "flags.list": {
        const n = norm() || (p.mini ? String(p.mini).replace(/\D/g, "") : "");
        const { getMiniAdmin } = await import("../multi/miniMonitor.js");
        return { ok: true, data: n ? await getMiniAdmin(n) : await getMiniAdmin("") };
      }

      case "flags.clear": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { clearMiniFlags } = await import("../multi/miniMonitor.js");
        await clearMiniFlags(n, p.id || "all");
        return { ok: true, data: { number: n, id: p.id || "all" } };
      }

      case "panic.test": {
        const { forceCorePanic } = await import("../system/corePanic.js");
        const reason = p.reason || "dev-console manual panic";
        setTimeout(async () => {
          try {
            await forceCorePanic({ source: "dev-console", detail: { reason } });
          } catch (err) {
            console.error("[dev-console] panic test failed:", err?.message || err);
          }
        }, 1200);
        return { ok: true, data: { triggered: true } };
      }

      case "reboot":
        setTimeout(() => process.exit(0), 800);
        return { ok: true, data: { rebooting: true } };

      case "shutdown":
        setTimeout(() => {
          pm2Stop((failed) => {
            if (failed) process.exit(0);
          });
        }, 800);
        return { ok: true, data: { stopping: true } };

      case "send.test": {
        if (!p.target) return { ok: false, error: "target number required" };
        const text = p.text || "🔧 Dev console test message.";
        const jid = jidOf(p.target);
        if (p.mini) {
          const { getSubSession } = await import("../multi/sessionManager.js");
          const entry = getSubSession(p.mini);
          if (!entry?.conn) return { ok: false, error: "mini not connected" };
          await entry.conn.sendMessage(jid, { text });
        } else {
          const { getConnection } = await import("../socket/connection.js");
          const conn = getConnection();
          if (!conn) return { ok: false, error: "main not connected" };
          await conn.sendMessage(jid, { text });
        }
        return { ok: true, data: { target: jid, via: p.mini || "main" } };
      }

      case "chats.list": {
        const { listChats, syncGroups } = await import("./chatIndex.js");
        const { getSubSessions } = await import("../multi/sessionManager.js");
        const { getConnection } = await import("../socket/connection.js");
        const conn = getConnection?.();
        if (conn) await syncGroups(conn, false);
        const chats = await listChats({ n: p.n });
        const minis = getSubSessions()
          .filter((s) => s.status === "connected" || s.status === "linking")
          .map((s) => ({ number: s.number, status: s.status }));
        return { ok: true, data: { chats, minis, via: "main" } };
      }

      case "send.chat": {
        const to = String(p.to || "").trim();
        const text = String(p.text || "").trim();
        if (!to) return { ok: false, error: "chat required — pick from the list or type a number" };
        if (!text) return { ok: false, error: "message required" };
        if (text.length > 4096) return { ok: false, error: "message too long (max 4096)" };
        const target = to.includes("@") ? to : jidOf(to);
        const { kindOf } = await import("./chatIndex.js");
        const kind = kindOf(target);
        if (p.mini) {
          const { getSubSession } = await import("../multi/sessionManager.js");
          const entry = getSubSession(p.mini);
          if (!entry?.conn) return { ok: false, error: "mini not connected" };
          await entry.conn.sendMessage(target, { text });
        } else {
          const { getConnection } = await import("../socket/connection.js");
          const conn = getConnection();
          if (!conn) return { ok: false, error: "main not connected" };
          await conn.sendMessage(target, { text });
        }
        try {
          const { recordChat } = await import("./chatIndex.js");
          await recordChat({ jid: target, kind, ts: Date.now() });
        } catch {  }
        return { ok: true, data: { to: target, kind, via: p.mini || "main" } };
      }

      case "messages.recent": {
        const { listRecentLog, LOG_CAP } = await import("./messageLog.js");
        const messages = await listRecentLog({ n: p.n });
        return { ok: true, data: { temporal: true, cap: LOG_CAP, messages } };
      }



      case "mode.set": {
        const { getMode, setMode } = await import("../utils/access.js");
        const modes = ["public", "private", "inbox", "group"];
        const mode = String(p.mode || "").toLowerCase().trim();
        if (!modes.includes(mode)) return { ok: false, error: `valid modes: ${modes.join(", ")}` };
        const prev = await getMode();
        const next = await setMode(mode);
        return { ok: true, data: { prev, next } };
      }

      case "queue.pause": {
        const { setQueuePaused } = await import("./queue.js");
        return { ok: true, data: { paused: setQueuePaused(true) } };
      }

      case "queue.resume": {
        const { setQueuePaused } = await import("./queue.js");
        return { ok: true, data: { paused: setQueuePaused(false) } };
      }

      case "main.reconnect": {
        const { reconnectMain } = await import("../socket/connection.js");
        const entry = await reconnectMain();
        return { ok: true, data: { reconnecting: true, connected: !!entry } };
      }

      case "rc.status": {
        const { getRcMonitor } = await import("./rcMonitor.js");
        return { ok: true, data: await getRcMonitor() };
      }

      case "rc.arm": {
        const actor = String(p.actor || "web:unknown");
        const action = String(p.target || "").trim();
        if (!action) return { ok: false, error: "target action required" };
        const { armRcAction } = await import("./rcMonitor.js");
        return armRcAction(actor, action);
      }

      case "rc.clear": {
        const actor = String(p.actor || "web:operator");
        const { clearRcFlags, resetRcActor } = await import("./rcMonitor.js");
        await clearRcFlags(actor, p.id || "all");
        if (String(p.resetLock) === "true") resetRcActor(actor);
        return { ok: true, data: { actor, resetLock: p.resetLock === "true" } };
      }

      case "userflags.list": {
        const { listFlaggedUsers } = await import("../multi/miniMonitor.js");
        return { ok: true, data: await listFlaggedUsers() };
      }

      case "flags.set": {
        const { setFlag, getFlags } = await import("./flags.js");
        const name = String(p.name || "").toLowerCase().trim();
        if (!name) return { ok: false, error: "name required" };
        const value = p.value === true || String(p.value).toLowerCase() === "on" || String(p.value) === "1";
        const flags = await setFlag(name, value);
        return { ok: true, data: flags };
      }



      case "bans.list": {
        const { listBotBans } = await import("../utils/globalBan.js");
        return { ok: true, data: await listBotBans() };
      }

      case "bans.add": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { botBanUser } = await import("../utils/globalBan.js");
        const added = await botBanUser(n);
        return { ok: true, data: { banned: added } };
      }

      case "bans.remove": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { botUnbanUser } = await import("../utils/globalBan.js");
        const remaining = await botUnbanUser(n);
        return { ok: true, data: { remaining } };
      }

      case "config.set": {
        const key = String(p.key || "").toLowerCase().trim();
        const value = String(p.value ?? "").trim();
        if (!key || !value) return { ok: false, error: "key and value required" };
        if (key === "mode") {
          const { getMode, setMode } = await import("../utils/access.js");
          const modes = ["public", "private", "inbox", "group"];
          if (!modes.includes(value)) return { ok: false, error: `valid modes: ${modes.join(", ")}` };
          return { ok: true, data: { key: "mode", prev: await getMode(), next: await setMode(value) } };
        }
        if (key === "prefix") {
          const { saveRuntimePrefix } = await import("../config/constants.js");
          const { rebuildCommandPatterns } = await import("../plugins.js");
          const next = await saveRuntimePrefix(value);
          rebuildCommandPatterns();
          return { ok: true, data: { key: "prefix", next } };
        }
        if (key === "botname") {
          const { saveRuntimeBotName } = await import("../config/constants.js");
          return { ok: true, data: { key: "botname", next: await saveRuntimeBotName(value) } };
        }
        if (key === "lang") {
          const { kvSet } = await import("../database/botKv.js");
          await kvSet("lang", value);
          return { ok: true, data: { key: "lang", next: value } };
        }
        const { setPolicy } = await import("./policy.js");
        const POL_KEYS = ["quietHoursStart", "quietHoursEnd", "maxWarns", "allowMediaCommands", "allowLinksInGroups", "rateLimitPerUser", "blockBroadcast"];
        if (POL_KEYS.includes(key)) {
          const v = ["allowMediaCommands", "allowLinksInGroups", "blockBroadcast"].includes(key) ? value === "true" : Number.isFinite(Number(value)) ? Number(value) : value;
          await setPolicy(key, v);
          return { ok: true, data: { key, next: v, policy: true } };
        }
        const { kvSet } = await import("../database/botKv.js");
        await kvSet(`config:${key}`, value);
        return { ok: true, data: { key, next: value, freeform: true } };
      }

      case "config.get": {
        const { getMode } = await import("../utils/access.js");
        const { getPolicies } = await import("./policy.js");
        const { getPrefix, getBotName } = await import("../config/constants.js");
        const { kvGet } = await import("../database/botKv.js");
        return {
          ok: true,
          data: {
            mode: await getMode(),
            lang: (await kvGet("lang")) || process.env.BOT_LANG || "en",
            prefix: getPrefix(),
            botname: getBotName(),
            policies: await getPolicies(),
            owners: (await import("../utils/access.js")).getOwnerNumbers(),
            creators: (await import("../utils/access.js")).getCreatorNumbers(),
          },
        };
      }

      case "roles.list": {
        const { getOwnerNumbers, getCreatorNumbers } = await import("../utils/access.js");
        return { ok: true, data: { owners: getOwnerNumbers(), creators: getCreatorNumbers() } };
      }

      case "roles.set": {
        const num = norm();
        const role = String(p.role || "").toLowerCase().trim();
        const act = String(p.op || "add").toLowerCase().trim();
        if (!num) return { ok: false, error: "number required" };
        if (!["owner", "creator"].includes(role)) return { ok: false, error: "role must be owner|creator" };
        if (act !== "add" && act !== "remove") return { ok: false, error: "action must be add|remove" };
        const { addOwner, removeOwner, addCreator, removeCreator } = await import("../utils/access.js");
        if (role === "owner") act === "add" ? await addOwner(num) : await removeOwner(num);
        else act === "add" ? await addCreator(num) : await removeCreator(num);
        const { getOwnerNumbers, getCreatorNumbers } = await import("../utils/access.js");
        return { ok: true, data: { owners: getOwnerNumbers(), creators: getCreatorNumbers() } };
      }

      case "backup.now": {
        const { createBackup } = await import("./backup.js");
        const info = await createBackup({ includeAuth: p.includeAuth === true });
        return { ok: true, data: info };
      }

      case "relink": {
        const { clearAuthState } = await import("../database/authState.js");
        await clearAuthState();
        const { reconnectMain } = await import("../socket/connection.js");
        const entry = await reconnectMain();
        return { ok: true, data: { relinking: true, connected: !!entry } };
      }

      case "pair.request": {
        const n = norm();
        if (!n) return { ok: false, error: "number required" };
        const { provisionSubSession } = await import("../multi/sessionManager.js");
        const code = await provisionSubSession(n);
        return { ok: true, data: { number: n, code, hint: `Pairing code 8 digits → use it once on the number ${n}` } };
      }

      case "invite.create": {
        const { createInvite } = await import("./invites.js");
        const inv = createInvite({ label: String(p.label || "").trim() });
        return { ok: true, data: { token: inv.token, label: inv.label, created: inv.created, expires: inv.expires, ttlMs: Number(process.env.INVITE_TTL_MS) || 24 * 3600 * 1000 } };
      }

      case "invite.list": {
        const { listInvites } = await import("./invites.js");
        return { ok: true, data: { invites: listInvites() } };
      }

      case "invite.revoke": {
        const { revokeInvite } = await import("./invites.js");
        const token = String(p.token || "").trim();
        if (!token) return { ok: false, error: "token required" };
        return { ok: true, data: { revoked: revokeInvite(token) } };
      }

      case "git.update": {
        const run = (cmd) => new Promise((resolve) => {
          exec(cmd, { cwd: global.__basedir || process.cwd(), windowsHide: true }, (err, stdout, stderr) => {
            resolve({ code: err ? 1 : 0, out: String(stdout || "").trim(), err: String(stderr || "").trim() });
          });
        });
        const pulling = await run("git pull --ff-only");
        if (pulling.code !== 0) {
          return { ok: false, error: `git pull failed:\n${pulling.err || pulling.out || "?"}` };
        }
        await run("npm install --silent");
        setTimeout(() => process.exit(0), 900);
        return { ok: true, data: { updated: true, restarting: true } };
      }

      case "syswatch.set": {
        const { getSystemWatchStatus, startSystemMonitor, stopSystemMonitor } = await import("../system/systemWatch.js");
        const on = p.enabled === true || String(p.enabled).toLowerCase() === "on" || String(p.enabled) === "1";
        if (on) startSystemMonitor();
        else stopSystemMonitor();
        return { ok: true, data: { enabled: on, status: getSystemWatchStatus() } };
      }



      case "dev.term": {
        const { runDevCommandText } = await import("./devTerm.js");
        const line = String(p.line || "").trim();
        if (!line) return { ok: false, error: "line required" };
        const res = await runDevCommandText(line);
        return { ok: res.ok, data: { text: res.text } };
      }

      default:
        return { ok: false, error: `unknown action: ${action}` };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}


export function devActions() {
  return [
    "status",
    "logs.tail",
    "minis.list",
    "minis.suspend",
    "minis.unsuspend",
    "minis.remove",
    "minis.respawn",
    "flags.list",
    "flags.clear",
    "config.set",
    "config.get",
    "roles.list",
    "roles.set",
    "mode.set",
    "flags.set",
    "bans.list",
    "bans.add",
    "bans.remove",
    "dev.term",
    "panic.test",
    "reboot",
    "shutdown",
    "send.test",
    "chats.list",
    "send.chat",
    "messages.recent",
    "main.reconnect",
    "queue.pause",
    "queue.resume",
    "userflags.list",
    "rc.status",
    "rc.arm",
    "rc.clear",
    "backup.now",
    "relink",
    "pair.request",
    "invite.create",
    "invite.list",
    "invite.revoke",
    "git.update",
    "syswatch.set",
  ];
}



function fmtUptime(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

function fmtLine(snapshot, de) {
  const m = snapshot.main;
  const host = m.host;
  const L = [];
  L.push(
    de
      ? `📟 *Dev Console* — ${snapshot.name} v${snapshot.version}`
      : `📟 *Dev Console* — ${snapshot.name} v${snapshot.version}`
  );
  L.push(
    de
      ? `• Haupt: ${m.connected ? "verbunden" : "GETRENNT"} · Modus ${m.mode} · uptime ${fmtUptime(m.uptimeSec)}`
      : `• Main: ${m.connected ? "connected" : "DISCONNECTED"} · mode ${m.mode} · uptime ${fmtUptime(m.uptimeSec)}`
  );
  L.push(
    `• PID ${m.pid} · RSS ${m.rssMb}MB · heap ${m.heapMb}MB · queue ${m.queue?.pending ?? 0}${m.queue?.active ? `/active ${m.queue.active}` : ""}`
  );
  if (host) {
    L.push(
      `• Host: CPU ${host.hostCpuPct}% (bot ${host.cpuPct}%) · RAM ${host.mem.usedPct}% · disk ${Math.round((host.disk?.freeMb ?? 0) / 1024)}GB free`
    );
  }
  if (m.panic) {
    L.push(
      de
        ? `• Kern-Panik: ${m.panic.enabled ? "bewaffnet" : "AUS"} · EL>${m.panic.elDelayMs}ms · mem>${m.panic.memoryMb}MB · send>${m.panic.sendBurst}/${m.panic.sendWindowMs}ms`
        : `• Core panic: ${m.panic.enabled ? "armed" : "off"} · EL>${m.panic.elDelayMs}ms · mem>${m.panic.memoryMb}MB · send>${m.panic.sendBurst}/${m.panic.sendWindowMs}ms`
    );
  }
  L.push("");
  const minis = snapshot.minis;
  L.push(de ? `🔹 *Onyx Minis (${minis.length})*` : `🔹 *Onyx Minis (${minis.length})*`);
  if (!minis.length) L.push(de ? "   Keine Minis verknüpft." : "   No minis linked.");
  for (const s of minis) {
    const state = s.status === "connected" ? "🟢" : s.status === "suspended" ? "⛔" : `⚪${s.status}`;
    L.push(
      `   ${state} ${s.number} — ${s.status} · score ${s.score}/${s.threshold} · flags ${s.openFlags}${s.lastSeen ? ` · seen ${new Date(s.lastSeen).toLocaleString()}` : ""}`
    );
  }
  L.push("");
  L.push(
    de
      ? `⚠️ Offene Flags gesamt: ${snapshot.flagsTotal}`
      : `⚠️ Total open flags: ${snapshot.flagsTotal}`
  );
  return L.join("\n");
}


export function formatDevSummary(snapshot, de = false) {
  return fmtLine(snapshot, de);
}

