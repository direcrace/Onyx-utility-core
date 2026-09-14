/**
 * Sub-session Manager — in-process secondary bot instances.
 *
 * The MAIN bot receives `#pair <number>`; it spawns an independent Baileys
 * socket whose auth state lives in its own per-number DB file. The friend links
 * that socket to their account, and the sub-session then actively runs the same
 * command set (restricted, no log-group) while the main logs everything.
 *
 * Sub-sessions PERSIST across restarts: the registered numbers are stored in
 * sessions/instances.json and auto-respawned on boot.
 */

import fs from "fs";
import path from "path";
import makeWASocket, {
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "baileys";
import pino from "pino";
import { useStandaloneAuthState } from "../database/authState.js";
import { serialize } from "../messages/serialize.js";
import { messageHandler, tryChatbotReply } from "../messages/handler.js";
import { groupCache, msgCache } from "../utils/cache.js";
import { processGroupGuards, processGroupMessageGate } from "../messages/groupGuards.js";
import { evaluateMiniMessage, purgeOldFlags, resetMiniState } from "./miniMonitor.js";
import { getPrefix } from "../config/constants.js";

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

const INDEX_FILE = "instances.json";
const MAX_RECONNECT_ATTEMPTS = 20;

function backoffDelay(attempt) {
  const exp = Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5));
  return exp + Math.floor(Math.random() * 500);
}

/** method-blocking set for sub-sessions (they are restricted, not owner) */
const subSessions = new Map(); // number (normalized) -> { number, conn, status, provisionedAt, lastSeen }

let sessionsDir = null;

function ensureSessionsDir() {
  if (sessionsDir) return sessionsDir;
  const base = global.__basedir || process.cwd();
  sessionsDir = path.join(base, "sessions");
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  return sessionsDir;
}

function dbPath(number) {
  return path.join(ensureSessionsDir(), `${number}.db`);
}

function indexPath() {
  return path.join(ensureSessionsDir(), INDEX_FILE);
}

function loadIndex() {
  try {
    const raw = fs.readFileSync(indexPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIndex(entries) {
  ensureSessionsDir();
  try {
    fs.writeFileSync(indexPath(), JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error("[sub-session] failed to save index:", err?.message || err);
  }
}

function upsertIndexEntry(number, status) {
  const entries = loadIndex();
  const idx = entries.findIndex((e) => e.number === number);
  const entry = { number, status, linkedAt: Date.now() };
  if (idx >= 0) entries[idx] = { ...entries[idx], ...entry };
  else entries.push(entry);
  saveIndex(entries);
}

function removeIndexEntry(number) {
  const entries = loadIndex().filter((e) => e.number !== number);
  saveIndex(entries);
}

export function getSubSessions() {
  return [...subSessions.values()].map((s) => ({
    number: s.number,
    status: s.status,
    provisionedAt: s.provisionedAt,
    lastSeen: s.lastSeen || null,
  }));
}

export function getSubSession(number) {
  return subSessions.get(String(number)) || null;
}

export function isSubConnection(conn) {
  return !!(conn && conn.__isSub);
}

export function isProvisioned(number) {
  return subSessions.has(String(number));
}

async function getVersion() {
  try {
    const { version } = await fetchLatestBaileysVersion();
    return version;
  } catch {
    return undefined;
  }
}

function cleanupSocket(conn) {
  if (!conn) return;
  try {
    conn.ev?.removeAllListeners?.();
  } catch { /* ignore */ }
  try {
    conn.ws?.close?.();
  } catch { /* ignore */ }
  try {
    conn.end?.(undefined);
  } catch { /* ignore */ }
}

/**
 * Notify the main owner(s) using the main socket when available.
 */
async function notifyOwner(text) {
  try {
    const { getConnection } = await import("../socket/connection.js");
    const { getOwnerNumbers } = await import("../utils/access.js");
    const main = getConnection();
    if (!main) return;
    const owners = getOwnerNumbers();
    if (!owners.length) return;
    for (const num of owners) {
      try {
        await main.sendMessage(num + "@s.whatsapp.net", { text });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * Send a text from the SUB socket (once it is connected).
 */
async function subSend(conn, jid, text) {
  try {
    await conn.sendMessage(jid, { text });
    return true;
  } catch (err) {
    console.error("[sub-session] send failed:", err?.message || err);
    return false;
  }
}

function wireEvents(entry) {
  const { number } = entry;
  const conn = entry.conn;
  conn.__isSub = true;
  conn.__subNumber = number;

  // Instrument sends so the core-panic send-burst monitor sees every Mini send.
  try {
    import("../system/corePanic.js").then(({ armSendMonitor }) =>
      armSendMonitor(conn)
    );
  } catch { /* ignore */ }

  conn.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    const liveConn = entry.conn;

    if (connection === "open") {
      entry.reconnectAttempt = 0;
      entry.status = "connected";
      entry.lastSeen = Date.now();
      upsertIndexEntry(number, "connected");
      console.log(`✅ Sub-session connected: ${liveConn.user?.id || number}`);

      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog(
          "success",
          `Sub-session linked: ${liveConn.user?.id || number}`
        );
      } catch { /* ignore */ }

      // Confirm to the friend (their own bot) + notify owner
      try {
        await subSend(
          liveConn,
          number + "@s.whatsapp.net",
          "✅ *Your Onyx Mini is linked!*\nIt is now active on this number."
        );
      } catch { /* ignore */ }
      try {
        const { tr } = await import("../utils/message.js");
        const rules = await tr(
          "📜 *Rules when using Onyx Mini:*\n\n" +
            "• Be respectful — no spam, harassment, or abuse.\n" +
            "• No illegal or harmful content.\n" +
            "• Usage is logged by the main bot owner.\n" +
            "• The owner can revoke your access or ban you at any time.\n" +
            "• Banned users have their session removed.\n" +
            "• *NO WARRANTY:* the Bot is provided \"as is\". You are responsible for your own WhatsApp account and for complying with WhatsApp's Terms of Service; we are not responsible for any action WhatsApp takes against your number (including bans) or for any data loss.\n\n" +
            "Use `#menu` to see available commands.",
          "📜 *Regeln für die Nutzung von Onyx Mini:*\n\n" +
            "• Sei respektvoll — kein Spam, keine Belästigung oder Missbrauch.\n" +
            "• Keine illegalen oder schädlichen Inhalte.\n" +
            "• Die Nutzung wird vom Haupt-Bot-Besitzer protokolliert.\n" +
            "• Der Besitzer kann deinen Zugriff jederzeit widerrufen oder dich sperren.\n" +
            "• Gesperrte Nutzer verlieren ihre Sitzung.\n" +
            "• *KEINE GEWÄHRLEISTUNG:* Der Bot wird \"wie er ist\" bereitgestellt. Du bist für dein eigenes WhatsApp-Konto und die Einhaltung der WhatsApp-Nutzungsbedingungen verantwortlich; wir sind nicht verantwortlich für Maßnahmen von WhatsApp gegen deine Nummer (einschließlich Sperren) oder für Datenverlust.\n\n" +
            "Nutze `#menu`, um verfügbare Befehle zu sehen."
        );
        await subSend(liveConn, number + "@s.whatsapp.net", rules);

        // Legal pointer for the Mini session.
        try {
          const legal = await tr(
            "You agreed to this when you used `#pair`. Full documents: `#terms` and `#privacy`.",
            "Du hast dem beim Use von `#pair` zugestimmt. Vollständige Dokumente: `#terms` und `#privacy`."
          );
          await subSend(liveConn, number + "@s.whatsapp.net", legal);
        } catch { /* ignore */ }
      } catch { /* ignore */ }
      await notifyOwner(`✅ New Onyx Mini linked: *${number}*\nIt is now active and logged via the main.`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const terminal = statusCode === DisconnectReason.loggedOut || statusCode === 403;

      if (terminal) {
        cleanupSocket(liveConn);
        // 401 = logged out on the server; 403 = account forbidden (banned/dead).
        // Neither recovers itself — let the owner re-link the number.
        entry.status = statusCode === 403 ? "forbidden" : "logged_out";
        upsertIndexEntry(number, entry.status);
        console.log(`🔓 Sub-session ${number} ${entry.status} (${statusCode}).`);
        subSessions.delete(number);
      } else {
        // Includes 515 (restartRequired) — the expected signal right after
        // pairing succeeds; we MUST reconnect immediately with the new creds.
        entry.status = "reconnecting";
        upsertIndexEntry(number, "reconnecting");
        entry.reconnectAttempt = (entry.reconnectAttempt || 0) + 1;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired;
        const delay = isRestartRequired
          ? 1500
          : backoffDelay(entry.reconnectAttempt);
        console.log(
          `❌ Sub-session ${number} closed (${statusCode ?? "?"}) — reconnecting in ${Math.round(delay / 1000)}s${isRestartRequired ? " (restart required)" : ""}`
        );

        try {
          await entry.saveCreds();
        } catch { /* ignore */ }

        if (entry.reconnectAttempt <= MAX_RECONNECT_ATTEMPTS) {
          setTimeout(() => {
            rebuildEntryConnection(entry).catch((err) =>
              console.error(`[sub-session] reconnect failed ${number}:`, err?.message || err)
            );
          }, delay);
        } else {
          entry.status = "failed";
          upsertIndexEntry(number, "failed");
          console.error(
            `[sub-session] ${number} gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts.`
          );
        }
      }
      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog("warn", `Sub-session ${number} closed (code ${statusCode ?? "?"})`);
      } catch { /* ignore */ }
    }
  });

  conn.ev.on("creds.update", (update) => entry.saveCreds?.());

  // Anti-call for the sub number
  conn.ev.on("call", async (calls) => {
    for (const call of calls) {
      try {
        if (call.status !== "offer") continue;
        await entry.conn.rejectCall(call.id, call.from);
      } catch { /* ignore */ }
    }
  });

  conn.ev.on("groups.update", async (updates) => {
    for (const update of updates) {
      if (update.id) groupCache.delete(update.id);
    }
  });

  conn.ev.on("messages.upsert", async (m) => {
    try {
      if (m.type && m.type !== "notify") return;
      if (m.requestId) return;
      const msg = m.messages?.[0];
      if (!msg?.message) return;
      if (msg.key?.remoteJid === "status@broadcast") return;
      if (msg.key?.id) msgCache.set(msg.key.id, msg.message);

      const { trackIncomingMessage } = await import("../system/corePanic.js");
      trackIncomingMessage();

      const liveConn = entry.conn;
      const message = await serialize(msg, liveConn);
      if (!message) return;

      // Temporal message log (RAM only) — sub-sessions must be captured exactly
      // like the main so a guard trigger (or media payload) can be verified.
      const { recordLogMessage, markLogBlocked } = await import("../enterprise/messageLog.js");
      const chatName = message.isGroup
        ? (() => { try { return groupCache.get(message.from)?.subject || null; } catch { return null; } })()
        : (msg?.pushName || message?.pushName || null);
      const logId = await recordLogMessage(message, { session: number, name: chatName });

      // Best-effort background download of payload bytes into the temporal
      // media cache — nothing a mini post can ever bypass the dashboard feed.
      try {
        const { ingestMedia } = await import("../enterprise/mediaCache.js");
        ingestMedia({ conn: liveConn, raw: msg, message, session: number, logId }).catch((err) =>
          console.error("[sub-session] media cache error:", err?.message || err)
        );
      } catch { /* media capture is best-effort */ }

      // ToS enforcement: evaluate outbound (account-sent) activity. A suspend
      // verdict closes this session — processing is then pointless.
      try {
        const verdict = await evaluateMiniMessage({
          number: entry.number,
          conn: liveConn,
          message,
        });
        if (verdict.action !== "continue") return;
      } catch (err) {
        console.error("[sub-session] mini monitor error:", err?.message || err);
      }

      const gate = await processGroupMessageGate({ message, conn: liveConn });
      if (gate === "disabled") {
        await markLogBlocked(logId, "BOT_OFF");
        return;
      }
      if (gate === "wake") {
        await messageHandler({ message, conn: liveConn });
        return;
      }

      const blocked = await processGroupGuards({ message, conn: liveConn }, (m, reason) => {
        markLogBlocked(logId, reason);
      });
      if (blocked) return;
      const wasCommand = message.body?.startsWith(getPrefix());
      await messageHandler({ message, conn: liveConn });
      if (!wasCommand) {
        const { routeGameTurn } = await import("../utils/gameCore.js");
        const consumed = await routeGameTurn({ message, conn: liveConn }).catch(() => false);
        if (!consumed) {
          await tryChatbotReply({ message, conn: liveConn });
        }
      }
    } catch (error) {
      console.error("❌ Sub-session message error:", error?.message || error);
      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog("error", "sub-session upsert failed", error);
      } catch { /* ignore */ }
    }
  });
}

/**
 * Open (or re-open) the auth state for a sub-session's own DB file.
 */
async function openSubAuth(number) {
  return useStandaloneAuthState(dbPath(number));
}

/**
 * Build a socket for the given auth state (fresh creds/keys).
 */
async function createConnFromAuth(auth) {
  const version = await getVersion();
  return makeWASocket({
    logger,
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
    },
    ...(version ? { version } : {}),
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    emitOwnEvents: false,
    shouldIgnoreJid: (jid) =>
      !jid || jid === "status@broadcast" || jid.endsWith("@broadcast"),
    getMessage: async (key) => (key?.id ? msgCache.get(key.id) : undefined),
    cachedGroupMetadata: async (jid) => groupCache.get(jid),
  });
}

/**
 * Create a brand-new sub-session socket for `number`.
 */
async function createSocket(number) {
  const auth = await openSubAuth(number);
  const conn = await createConnFromAuth(auth);
  const entry = {
    number,
    conn,
    saveCreds: auth.saveCreds,
    status: "connecting",
    provisionedAt: Date.now(),
    lastSeen: null,
    reconnectAttempt: 0,
  };
  wireEvents(entry);
  return entry;
}

/**
 * Rebuild a sub-session's socket using its (now) persisted creds.
 * Used on reconnect — especially after 515 restartRequired post-pairing.
 */
async function rebuildEntryConnection(entry) {
  if (entry.conn) cleanupSocket(entry.conn);
  const auth = await openSubAuth(entry.number);
  const conn = await createConnFromAuth(auth);
  entry.conn = conn;
  entry.saveCreds = auth.saveCreds;
  wireEvents(entry);
  console.log(`♻️ Sub-session ${entry.number} socket rebuilt.`);
  return entry;
}

/**
 * Provision a NEW sub-session for `number`: requests a pairing code and
 * returns it so the caller can DM it to the requester.
 * @returns {Promise<string>} the pairing code
 */
export async function provisionSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  if (!norm) throw new Error("Invalid number");

  // A number that was suspended for a ToS violation cannot be re-linked until
  // the operator lifts the suspension. MUST be checked before the live map,
  // because a suspended session still has a (closed) map entry.
  const entries = loadIndex();
  const existing = entries.find((e) => e.number === norm);
  if (existing?.status === "suspended") throw new Error("SUSPENDED");

  // A live session blocks re-pairing. Dead sessions (failed / logged out /
  // forbidden / removed) may be freshly re-linked — their creds are worthless.
  const live = subSessions.get(norm);
  if (live) {
    if (["connecting", "linking", "connected", "reconnecting"].includes(live.status)) {
      throw new Error("ALREADY_LINKED");
    }
    try { cleanupSocket(live.conn); } catch { /* ignore */ }
    subSessions.delete(norm);
  }

  // Fresh link: wipe any stale creds from a previous pairing. Reusing old keys
  // makes the account disconnect immediately (401 logged out) right after the
  // new QR is scanned.
  try {
    const auth = await openSubAuth(norm);
    await auth.clearAuthState?.();
  } catch { /* ignore */ }

  const entry = await createSocket(norm);
  subSessions.set(norm, entry);
  upsertIndexEntry(norm, "linking");

  try {
    // Wait until the socket is actually reachable before asking for a code —
    // requesting too early makes requestPairingCode fail on a flaky connection.
    // Also capture WHY it didn't come up (403/429/…) instead of a blind timeout.
    const conn = entry.conn;
    const deadline = Date.now() + 20_000;
    let closeError = null;
    const probe = (update) => {
      if (closeError) return;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (update.connection === "close" && code != null) closeError = code;
    };
    try { conn.ev?.on?.("connection.update", probe); } catch { /* ignore */ }
    try {
      while (Date.now() < deadline && !conn.ws?.isOpen && closeError === null) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } finally {
      try { conn.ev?.off?.("connection.update", probe); } catch { /* ignore */ }
    }

    if (!conn.ws?.isOpen) {
      const e = new Error("NOT_READY");
      if (closeError !== null) e.statusCode = closeError;
      throw e;
    }

    const code = await conn.requestPairingCode(norm);
    entry.status = "linking";
    return code;
  } catch (err) {
    // Never leave a half-paired zombie behind — a failed attempt must be
    // instantly retryable via #pair (no stale "linking" to fight).
    try { cleanupSocket(entry.conn); } catch { /* ignore */ }
    subSessions.delete(norm);
    removeIndexEntry(norm);
    throw err;
  }
}

/**
 * Resume an already-provisioned (already-linked or linking) sub-session on boot.
 * Does NOT request a new pairing code — only used for previously-connected bots.
 */
export async function respawnSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  if (!norm) return null;
  const live = subSessions.get(norm);
  if (live) {
    // A suspended/failed session (or one with a closed socket) is a zombie —
    // rebuild it instead of returning the dead entry.
    if (live.status !== "suspended" && live.status !== "failed" && live.conn) {
      return live;
    }
    try { cleanupSocket(live.conn); } catch { /* ignore */ }
    subSessions.delete(norm);
  }
  try {
    const entry = await createSocket(norm);
    subSessions.set(norm, entry);
    console.log(`♻️ Respawning sub-session: ${norm}`);
    return entry;
  } catch (err) {
    console.error(`[sub-session] respawn failed ${norm}:`, err?.message || err);
    return null;
  }
}

/**
 * Reboot a sub-session in place: tear down the current socket and start a
 * fresh one with the same (persisted) creds. Used by `#reboot` on a Mini.
 */
export async function restartSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  const entry = subSessions.get(norm);
  if (!entry) {
    return respawnSubSession(norm);
  }
  entry.reconnectAttempt = 0;
  entry.status = "reconnecting";
  upsertIndexEntry(norm, "reconnecting");
  if (entry.conn) {
    try { await entry.conn.end(1000); } catch { /* ignore */ }
    cleanupSocket(entry.conn);
  }
  try {
    await entry.saveCreds?.();
  } catch { /* ignore */ }
  await rebuildEntryConnection(entry);
  return entry;
}

/**
 * Persisted sub-sessions are auto-respawned on boot. Only consider entries that
 * were previously linked (connected / reconnecting) — never just a stray index.
 */
export async function respawnAllSubSessions() {
  try {
    await purgeOldFlags();
  } catch (err) {
    console.error("[sub-session] flag purge failed:", err?.message || err);
  }
  const entries = loadIndex();
  for (const e of entries) {
    // Respawn previously-linked AND failed sessions (failed = exhausted its
    // reconnect budget last run; a fresh boot deserves another chance).
    if (e.status === "connected" || e.status === "reconnecting" || e.status === "failed") {
      await respawnSubSession(e.number);
    }
  }
  // Drop stale "linking" entries (pairing never completed and the process
  // restarted) so they don't linger as confusing ghosts in the index.
  const staleLinking = entries.filter(
    (e) => e.status === "linking" && !subSessions.has(e.number)
  );
  if (staleLinking.length) {
    for (const e of staleLinking) removeIndexEntry(e.number);
  }
  return getSubSessions();
}

/**
 * Remove + logout a sub-session (owner command).
 */
export async function removeSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  const entry = subSessions.get(norm);
  if (entry?.conn) {
    // Tell the user their session is being terminated (best effort).
    try {
      const { tr } = await import("../utils/message.js");
      await subSend(
        entry.conn,
        norm + "@s.whatsapp.net",
        await tr(
          "⚠️ *Your Onyx Mini session has been terminated.*",
          "⚠️ *Deine Onyx-Mini-Sitzung wurde beendet.*"
        )
      );
    } catch { /* ignore */ }
    try {
      await entry.conn.logout?.();
    } catch { /* ignore */ }
    cleanupSocket(entry.conn);
    entry.status = "removed";
  }
  subSessions.delete(norm);
  removeIndexEntry(norm);
  // Remove this number's credential DB so removals leave no orphaned secrets
  // behind. A future re-link wipes/recreates it anyway (provisionSubSession).
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath(norm) + suffix);
    } catch { /* ignore */ }
  }
  try {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("info", `Sub-session removed: ${norm}`);
  } catch { /* ignore */ }
  return true;
}

/**
 * Suspend a sub-session (ToS enforcement / operator decision). The socket is
 * closed and the session stays registered with status "suspended" so it is NOT
 * auto-respawned and cannot be re-paired until unsuspended. Creds are kept so
 * the operator can resume the session later (`#unsuspend`).
 */
export async function suspendSubSession(number, reason = "suspended by operator") {
  const norm = String(number).replace(/\D/g, "");
  const entry = subSessions.get(norm);

  if (entry?.conn) {
    // Tell the user their session is being suspended (best effort).
    try {
      const { tr } = await import("../utils/message.js");
      await subSend(
        entry.conn,
        norm + "@s.whatsapp.net",
        await tr(
          `⚠️ *Your Onyx Mini session has been suspended.*\n\n${reason}\n\nContact the operator if you think this is a mistake.`,
          `⚠️ *Deine Onyx-Mini-Sitzung wurde gesperrt.*\n\n${reason}\n\nKontaktiere die Betreiberin/den Betreiber, falls das ein Fehler war.`
        )
      );
    } catch { /* ignore */ }
    cleanupSocket(entry.conn);
    entry.status = "suspended";
  }

  // Persist suspension so respawn/pairing reject it.
  const entries = loadIndex();
  const idx = entries.findIndex((e) => e.number === norm);
  if (idx >= 0) entries[idx] = { ...entries[idx], status: "suspended", suspendedAt: Date.now(), suspendReason: reason };
  else entries.push({ number: norm, status: "suspended", suspendedAt: Date.now(), suspendReason: reason, linkedAt: Date.now() });
  saveIndex(entries);

  resetMiniState(norm);
  try {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("warn", `⛔ Sub-session suspended: ${norm}`, reason);
  } catch { /* ignore */ }
  return true;
}

export async function getIndexEntries() {
  return loadIndex();
}

/**
 * Resume a suspended sub-session (operator decision): respawn its socket.
 */
export async function unsuspendSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  const entries = loadIndex();
  const idx = entries.findIndex((e) => e.number === norm);
  if (idx >= 0) {
    const suspended = entries[idx].status === "suspended";
    entries[idx] = { ...entries[idx], status: "connected", suspendedAt: undefined, suspendReason: undefined };
    saveIndex(entries);
    resetMiniState(norm);
    if (suspended) {
      // The suspended entry is still in `subSessions` with a closed socket —
      // drop it so respawn builds a brand-new one with the persisted creds.
      const old = subSessions.get(norm);
      if (old) {
        try { cleanupSocket(old.conn); } catch { /* ignore */ }
        subSessions.delete(norm);
      }
      await respawnSubSession(norm);
    }
  }
  try {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("info", `Sub-session resumed: ${norm}`);
  } catch { /* ignore */ }
  return true;
}
