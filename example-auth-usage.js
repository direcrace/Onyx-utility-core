/**
 * Example: Using Database Authentication State (Baileys 7.0.0-rc13)
 *
 * Default: better-sqlite3 (./database.db)
 * Postgres: set DATABASE_URL=postgres://...
 */

import makeWASocket, {
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} from "baileys";
import { useMultiDbAuthState, clearAuthState } from "./src/database/authState.js";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "silent" });

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiDbAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    version,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    emitOwnEvents: false,
  });

  conn.ev.on("creds.update", saveCreds);

  conn.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("Scan the QR code to login");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Connection closed, reconnecting...");
        connectToWhatsApp();
      } else {
        console.log("Logged out, clearing auth state...");
        await clearAuthState();
      }
    }

    if (connection === "open") {
      console.log("Connected successfully!");
    }
  });

  conn.ev.on("messages.upsert", async ({ messages, type, requestId }) => {
    if (type && type !== "notify") return;
    if (requestId) return;

    const msg = messages[0];
    if (!msg?.message) return;

    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (text === "#ping") {
      await conn.sendMessage(msg.key.remoteJid, { text: "Pong!" });
    }
  });

  return conn;
}

connectToWhatsApp().catch(console.error);

async function logout() {
  try {
    await clearAuthState();
    console.log("Auth state cleared successfully");
    process.exit(0);
  } catch (error) {
    console.error("Failed to clear auth state:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

export { connectToWhatsApp, logout };
