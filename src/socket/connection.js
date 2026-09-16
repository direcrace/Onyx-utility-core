

import makeWASocket, {
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { useMultiDbAuthState } from "../database/authState.js";
import { serialize } from "../messages/serialize.js";
import { messageHandler } from "../messages/handler.js";
import { tryChatbotReply } from "../messages/handler.js";
import { setConnection } from "../terminal/handler.js";
import { groupCache, msgCache } from "../utils/cache.js";
import { attachGroupParticipantEvents } from "../events/groupParticipants.js";
import {
  startReminderScheduler,
  stopReminderScheduler,
} from "../utils/reminders.js";
import { processGroupGuards, processGroupMessageGate } from "../messages/groupGuards.js";

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

let globalConnection = null;
let reconnectAttempt = 0;
let isConnecting = false;
let cachedVersion = null;
let pairingRequested = false;

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

function backoffDelay(attempt) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 500);
  return exp + jitter;
}

async function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
  } catch {
    cachedVersion = undefined;
  }
  return cachedVersion;
}

function cleanupSocket(conn) {
  if (!conn) return;
  try {
    conn.ev?.removeAllListeners?.();
  } catch {

  }
  try {
    conn.ws?.close?.();
  } catch {

  }
  try {
    conn.end?.(undefined);
  } catch {

  }
}

function pairingNumber() {
  const raw = (process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
  return raw || null;
}

async function connect() {
  if (isConnecting) return globalConnection;
  isConnecting = true;

  let conn = null;

  try {
    const { state, saveCreds } = await useMultiDbAuthState();
    const version = await getVersion();

    const hasSession = !!(state.creds?.me || state.creds?.registered);
    const usePairing = !hasSession && !!pairingNumber();

    const socketOptions = {
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid) =>
        !jid ||
        jid === "status@broadcast" ||
        jid.endsWith("@broadcast"),
      getMessage: async (key) => {
        const id = key?.id;
        if (!id) return undefined;
        return msgCache.get(id) || undefined;
      },
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
    };

    if (version) {
      socketOptions.version = version;
    }

    conn = makeWASocket(socketOptions);

    globalConnection = conn;
    setConnection(conn);

    try {
      const { armSendMonitor } = await import("../system/corePanic.js");
      armSendMonitor(conn);
    } catch {  }

    pairingRequested = false;

    if (usePairing) {
      pairingRequested = true;
      setTimeout(async () => {
        try {
          const code = await conn.requestPairingCode(pairingNumber());
          console.log("\n🔗 Pairing code (enter on phone):\n");
          console.log(`   ${code}\n`);
          console.log("Phone → Linked devices → Link with phone number\n");
        } catch (err) {
          console.error("Pairing code failed:", err?.message || err);
          console.log("Scan QR instead if it appears...\n");
        }
      }, 2000);
    }

    conn.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        console.log("\n📱 Scan the QR code above to log in.");
        if (usePairing) {
          console.log("   …or keep the 8-digit code that printed above — 📱 Phone → Linked devices → Link with phone number.");
        } else {
          console.log("   (Or set PAIRING_NUMBER=yourNumberWithCountryCode and restart to get a pairing code instead.)\n");
        }
      }

      if (connection === "open") {
        reconnectAttempt = 0;
        console.log("✅ Connected successfully!");
        startReminderScheduler(conn);

        try {
          const { syncGroups } = await import("../enterprise/chatIndex.js");
          syncGroups(conn, true)
            .then((n) => n > 0 && console.log(`🗂 Chat index: ${n} group(s)/communities synced for the Remote picker`))
            .catch(() => {});
        } catch {  }

        try {
          const { initCrashedPlugin } = await import("../plugins/crashed/index.js");
          initCrashedPlugin(conn);
        } catch (err) {
          console.warn("[CRASHED] Plugin init failed:", err?.message || err);
        }

        setTimeout(async () => {
          try {
            const { ensureLogGroup, attachLogGroupConn, systemLog } =
              await import("../utils/logGroup.js");
            const { startOnboardingIfNeeded } = await import(
              "../onboarding/setup.js"
            );
            const loggerMod = (await import("../utils/logger.js")).default;

            attachLogGroupConn(conn);
            loggerMod.setRemoteSink((level, msg, detail) =>
              systemLog(level, msg, detail)
            );

            const res = await ensureLogGroup(conn);
            if (res.needsManual) {
              console.warn(
                "[onboarding] Set OWNER_NUMBER or run #setlog in a group you create."
              );
            }
            if (res.jid) {
              await startOnboardingIfNeeded(conn);
            }
          } catch (err) {
            console.error("Onboarding/log-group init failed:", err?.message || err);
          }
        }, 2500);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        stopReminderScheduler();
        cleanupSocket(conn);
        if (globalConnection === conn) {
          globalConnection = null;
          setConnection(null);
        }

        if (shouldReconnect) {
          const delay = backoffDelay(reconnectAttempt);
          reconnectAttempt += 1;
          console.log(
            `❌ Connection closed (code ${statusCode ?? "?"}). Reconnecting in ${Math.round(delay / 1000)}s...`
          );
          isConnecting = false;
          setTimeout(() => {
            connect().catch((err) => {
              console.error("Reconnect failed:", err?.message || err);
              isConnecting = false;
            });
          }, delay);
        } else {
          console.log("🔓 Logged out. Restart the bot to login again.");
          isConnecting = false;
        }
      }
    });

    conn.ev.on("creds.update", saveCreds);
    attachGroupParticipantEvents(conn);

    conn.ev.on("messages.update", async (updates) => {
      for (const update of updates) {
        try {
          if (update.update?.messageStubType === 68 || update.update?.messageStubType === 0) {
            const { handleAntiDelete } = await import("../utils/antiDelete.js");
            await handleAntiDelete(conn, update);
          }
        } catch {  }
      }
    });

    conn.ev.on("call", async (calls) => {
      for (const call of calls) {
        try {
          if (call.status !== "offer") continue;
          const { kvGet } = await import("../database/botKv.js");
          const anticall = await kvGet("anticall_global");
          if (!anticall) continue;
          await conn.rejectCall(call.id, call.from);
          try {
            const { tr } = await import("../utils/message.js");
            await conn.sendMessage(call.from, { text: await tr("📵 Calls are rejected by this bot.", "📵 Anrufe werden von diesem Bot abgelehnt.") });
          } catch {  }
          console.log(`📞 Auto-rejected call from ${call.from}`);
        } catch {  }
      }
    });

    try {
      const { kvGet } = await import("../database/botKv.js");
      const alwaysOnline = await kvGet("alwaysonline_global");
      if (alwaysOnline) await conn.sendPresenceUpdate("available");
    } catch {  }

    conn.ev.on("groups.update", async (updates) => {
      for (const update of updates) {
        if (update.id) groupCache.delete(update.id);
      }
    });

    conn.ev.on("chats.upsert", async (chats) => {
      try {
        const { recordChatMeta } = await import("../enterprise/chatIndex.js");
        for (const c of chats || []) {
          if (!c?.id) continue;
          await recordChatMeta(c.id, { name: c.name || c.notify || null });
        }
      } catch {  }
    });

    conn.ev.on("contacts.upsert", async (contacts) => {
      try {
        const { recordChatMeta } = await import("../enterprise/chatIndex.js");
        for (const c of contacts || []) {
          if (!c?.id) continue;
          await recordChatMeta(c.id, { name: c.pushName || c.notify || c.verifiedName || null });
        }
      } catch {  }
    });

    conn.ev.on("messages.upsert", async (m) => {
      try {
        if (m.type && m.type !== "notify") return;
        if (m.requestId) return;

        const msg = m.messages?.[0];
        if (!msg?.message) return;
        if (msg.key?.remoteJid === "status@broadcast") return;

        const { trackIncomingMessage } = await import("../system/corePanic.js");
        trackIncomingMessage();

        try {
          const { recordChatFromMessage } = await import("../enterprise/chatIndex.js");
          await recordChatFromMessage(msg);
        } catch {  }

        if (msg.key?.id) {
          msgCache.set(msg.key.id, msg.message);
        }

        const message = await serialize(msg, conn);
        if (!message) return;

        const { recordLogMessage, markLogBlocked } = await import("../enterprise/messageLog.js");
        const logId = await recordLogMessage(message, { session: "main" });

        try {
          const { ingestMedia } = await import("../enterprise/mediaCache.js");
          ingestMedia({ conn, raw: msg, message, session: "main", logId }).catch((err) =>
            console.error("media cache error:", err?.message || err)
          );
        } catch {  }

        const gate = await processGroupMessageGate({ message, conn });
        if (gate === "disabled") {
          await markLogBlocked(logId, "BOT_OFF");
          return;
        }
        if (gate === "wake") {
          await messageHandler({ message, conn });
          return;
        }

        const blocked = await processGroupGuards({ message, conn }, (m, reason) => {
          markLogBlocked(logId, reason);
        });
        if (blocked) return;

        const wasCommand = message.body?.startsWith("#");
        await messageHandler({ message, conn });

        if (!wasCommand) {
          const { routeGameTurn } = await import("../utils/gameCore.js");
          const consumed = await routeGameTurn({ message, conn }).catch(() => false);
          if (!consumed) {
            await tryChatbotReply({ message, conn });
          }
        }
      } catch (error) {
        console.error("❌ Error processing message:", error?.message || error);
        try {
          const { systemLog } = await import("../utils/logGroup.js");
          await systemLog("error", "messages.upsert failed", error);
        } catch {

        }
      }
    });

    isConnecting = false;
    return conn;
  } catch (error) {
    isConnecting = false;
    cleanupSocket(conn);
    throw error;
  }
}

export function getConnection() {
  return globalConnection;
}

export async function reconnectMain() {
  const old = globalConnection;
  if (old) {

    cleanupSocket(old);
    try {
      await old.end(1000);
    } catch {  }
  }
  if (globalConnection === old) globalConnection = null;
  setConnection(null);
  isConnecting = false;
  await connect();
  return globalConnection;
}

export default connect;