

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

const subSessions = new Map();

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
  } catch {  }
  try {
    conn.ws?.close?.();
  } catch {  }
  try {
    conn.end?.(undefined);
  } catch {  }
}

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
      } catch {  }
    }
  } catch {  }
}

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

  try {
    import("../system/corePanic.js").then(({ armSendMonitor }) =>
      armSendMonitor(conn)
    );
  } catch {  }

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
      } catch {  }

      try {
        await subSend(
          liveConn,
          number + "@s.whatsapp.net",
          "✅ *Your Onyx Mini is linked!*\nIt is now active on this number."
        );
      } catch {  }
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

        try {
          const legal = await tr(
            "You agreed to this when you used `#pair`. Full documents: `#terms` and `#privacy`.",
            "Du hast dem beim Use von `#pair` zugestimmt. Vollständige Dokumente: `#terms` und `#privacy`."
          );
          await subSend(liveConn, number + "@s.whatsapp.net", legal);
        } catch {  }
      } catch {  }
      await notifyOwner(`✅ New Onyx Mini linked: *${number}*\nIt is now active and logged via the main.`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const terminal = statusCode === DisconnectReason.loggedOut || statusCode === 403;

      if (terminal) {
        cleanupSocket(liveConn);

        entry.status = statusCode === 403 ? "forbidden" : "logged_out";
        upsertIndexEntry(number, entry.status);
        console.log(`🔓 Sub-session ${number} ${entry.status} (${statusCode}).`);
        subSessions.delete(number);
      } else {

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
        } catch {  }

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
      } catch {  }
    }
  });

  conn.ev.on("creds.update", (update) => entry.saveCreds?.());

  conn.ev.on("call", async (calls) => {
    for (const call of calls) {
      try {
        if (call.status !== "offer") continue;
        await entry.conn.rejectCall(call.id, call.from);
      } catch {  }
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

      const { recordLogMessage, markLogBlocked } = await import("../enterprise/messageLog.js");
      const chatName = message.isGroup
        ? (() => { try { return groupCache.get(message.from)?.subject || null; } catch { return null; } })()
        : (msg?.pushName || message?.pushName || null);
      const logId = await recordLogMessage(message, { session: number, name: chatName });

      try {
        const { ingestMedia } = await import("../enterprise/mediaCache.js");
        ingestMedia({ conn: liveConn, raw: msg, message, session: number, logId }).catch((err) =>
          console.error("[sub-session] media cache error:", err?.message || err)
        );
      } catch {  }

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
      } catch {  }
    }
  });
}

async function openSubAuth(number) {
  return useStandaloneAuthState(dbPath(number));
}

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

export async function provisionSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  if (!norm) throw new Error("Invalid number");

  const entries = loadIndex();
  const existing = entries.find((e) => e.number === norm);
  if (existing?.status === "suspended") throw new Error("SUSPENDED");

  const live = subSessions.get(norm);
  if (live) {
    if (["connecting", "linking", "connected", "reconnecting"].includes(live.status)) {
      throw new Error("ALREADY_LINKED");
    }
    try { cleanupSocket(live.conn); } catch {  }
    subSessions.delete(norm);
  }

  try {
    const auth = await openSubAuth(norm);
    await auth.clearAuthState?.();
  } catch {  }

  const entry = await createSocket(norm);
  subSessions.set(norm, entry);
  upsertIndexEntry(norm, "linking");

  try {

    const conn = entry.conn;
    const deadline = Date.now() + 20_000;
    let closeError = null;
    const probe = (update) => {
      if (closeError) return;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (update.connection === "close" && code != null) closeError = code;
    };
    try { conn.ev?.on?.("connection.update", probe); } catch {  }
    try {
      while (Date.now() < deadline && !conn.ws?.isOpen && closeError === null) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } finally {
      try { conn.ev?.off?.("connection.update", probe); } catch {  }
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

    try { cleanupSocket(entry.conn); } catch {  }
    subSessions.delete(norm);
    removeIndexEntry(norm);
    throw err;
  }
}

export async function respawnSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  if (!norm) return null;
  const live = subSessions.get(norm);
  if (live) {

    if (live.status !== "suspended" && live.status !== "failed" && live.conn) {
      return live;
    }
    try { cleanupSocket(live.conn); } catch {  }
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
    try { await entry.conn.end(1000); } catch {  }
    cleanupSocket(entry.conn);
  }
  try {
    await entry.saveCreds?.();
  } catch {  }
  await rebuildEntryConnection(entry);
  return entry;
}

export async function respawnAllSubSessions() {
  try {
    await purgeOldFlags();
  } catch (err) {
    console.error("[sub-session] flag purge failed:", err?.message || err);
  }
  const entries = loadIndex();
  for (const e of entries) {

    if (e.status === "connected" || e.status === "reconnecting" || e.status === "failed") {
      await respawnSubSession(e.number);
    }
  }

  const staleLinking = entries.filter(
    (e) => e.status === "linking" && !subSessions.has(e.number)
  );
  if (staleLinking.length) {
    for (const e of staleLinking) removeIndexEntry(e.number);
  }
  return getSubSessions();
}

export async function removeSubSession(number) {
  const norm = String(number).replace(/\D/g, "");
  const entry = subSessions.get(norm);
  if (entry?.conn) {

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
    } catch {  }
    try {
      await entry.conn.logout?.();
    } catch {  }
    cleanupSocket(entry.conn);
    entry.status = "removed";
  }
  subSessions.delete(norm);
  removeIndexEntry(norm);

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath(norm) + suffix);
    } catch {  }
  }
  try {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("info", `Sub-session removed: ${norm}`);
  } catch {  }
  return true;
}

export async function suspendSubSession(number, reason = "suspended by operator") {
  const norm = String(number).replace(/\D/g, "");
  const entry = subSessions.get(norm);

  if (entry?.conn) {

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
    } catch {  }
    cleanupSocket(entry.conn);
    entry.status = "suspended";
  }

  const entries = loadIndex();
  const idx = entries.findIndex((e) => e.number === norm);
  if (idx >= 0) entries[idx] = { ...entries[idx], status: "suspended", suspendedAt: Date.now(), suspendReason: reason };
  else entries.push({ number: norm, status: "suspended", suspendedAt: Date.now(), suspendReason: reason, linkedAt: Date.now() });
  saveIndex(entries);

  resetMiniState(norm);
  try {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("warn", `⛔ Sub-session suspended: ${norm}`, reason);
  } catch {  }
  return true;
}

export async function getIndexEntries() {
  return loadIndex();
}

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

      const old = subSessions.get(norm);
      if (old) {
        try { cleanupSocket(old.conn); } catch {  }
        subSessions.delete(norm);
      }
      await respawnSubSession(norm);
    }
  }
  try {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("info", `Sub-session resumed: ${norm}`);
  } catch {  }
  return true;
}
