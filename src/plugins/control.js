import { command } from "../plugins.js";
import { replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import {
  isPrivileged,
  isOwnerMessage,
  isCreatorMessage,
  senderCandidates,
  getOwnerNumbers,
} from "../utils/access.js";
import { BOT_INFO } from "../config/constants.js";
import { clearAuthState } from "../database/authState.js";
import { writeAudit } from "../enterprise/audit.js";
import { systemLog } from "../utils/logGroup.js";
import {
  describe,
  ffmpegVersion,
  supervisorLabel,
} from "../system/platform.js";

const CONFIRM_TTL_MS = 120_000;

const armed = new Map();

function armKey(message, conn) {
  const actor = [...senderCandidates(message, conn)][0] || message?.sender || "unknown";
  return `${message?.from || "?"}:${actor}`;
}

function isArmed(key) {
  const at = armed.get(key);
  if (!at) return false;
  if (Date.now() - at > CONFIRM_TTL_MS) {
    armed.delete(key);
    return false;
  }
  return true;
}

async function requireOwnerControl(conn, message) {
  if (await isPrivileged(message, conn)) return true;
  await replyFail(
    conn,
    message,
    await tr(
      "Only the bot owner can do that.",
      "Nur der Bot-Besitzer kann das tun."
    )
  );
  return false;
}

async function requireDestructiveGate(conn, message) {
  if (isCreatorMessage(message, conn) || isOwnerMessage(message, conn)) return true;
  await replyFail(
    conn,
    message,
    await tr(
      "⛔ This one is owner/creator only. The attempt was logged.",
      "⛔ Das geht nur für Owner/Creator. Der Versuch wurde protokolliert."
    )
  );
  try {
    await writeAudit({
      action: "control:deny",
      actor: message.sender,
      chat: message.from,
      meta: { command: String(message.body || "").split(/\s+/)[0] || "?" },
    });
  } catch {  }
  await systemLog(
    "warn",
    `🚨 Owner-only control command denied: ${String(message.body || "").slice(0, 40)} by ${message.sender}`
  ).catch(() => {});
  return false;
}

command(
  {
    pattern: "logout",
    fromMe: false,
    desc: "Log out and clear the WhatsApp session (owner)",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireDestructiveGate(conn, message))) return;

    const key = armKey(message, conn);
    const raw = (getCommandArgs(message.body, "logout") || "").trim().toLowerCase();

    if (raw !== "confirm") {
      armed.set(key, Date.now());
      await replyOk(
        conn,
        message,
        await tr(
          `🔓 *Logout armed.* This deletes the WhatsApp session — you must pair again.\n\nConfirm with \`${BOT_INFO.PREFIX}logout confirm\` (valid 2 minutes).`,
          `🔓 *Logout aktiviert.* Löscht die WhatsApp-Session — du musst dich neu koppeln.\n\nBestätige mit \`${BOT_INFO.PREFIX}logout confirm\` (2 Minuten gültig).`
        )
      );
      return;
    }

    armed.delete(key);

    try {
      await clearAuthState();
    } catch (err) {
      console.error("[control] clearAuthState failed:", err?.message || err);
      await replyFail(
        conn,
        message,
        await tr(
          "Could not clear the session database.",
          "Session-Datenbank konnte nicht gelöscht werden."
        )
      );
      return;
    }

    await writeAudit({
      action: "cmd.logout",
      actor: message.sender,
      chat: message.from,
      meta: { confirmed: true },
    }).catch(() => {});

    await systemLog("warn", "🔓 Session cleared via .logout — re-pairing required.", "").catch(
      () => {}
    );

    await replyOk(
      conn,
      message,
      await tr(
        "🔓 Session cleared. Restarting so a fresh QR / pairing code appears…",
        "🔓 Session gelöscht. Starte neu, damit ein neuer QR / Pairing-Code erscheint…"
      )
    );

    setTimeout(() => process.exit(0), 1200);
  }
);

command(
  {
    pattern: "wipedb",
    fromMe: false,
    desc: "Wipe the auth database (owner)",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireDestructiveGate(conn, message))) return;

    const key = armKey(message, conn);
    const raw = (getCommandArgs(message.body, "wipedb") || "").trim().toLowerCase();

    if (raw !== "confirm") {
      armed.set(key, Date.now());
      await replyOk(
        conn,
        message,
        await tr(
          `⚠️ *Database wipe armed.* This deletes the auth database AND every saved setting, wallet, reminder and note.\n\nConfirm with \`${BOT_INFO.PREFIX}wipedb confirm\` (valid 2 minutes).`,
          `⚠️ *Datenbank-Löschung aktiviert.* Löscht die Auth-Datenbank UND alle gespeicherten Einstellungen, Wallets, Erinnerungen und Notizen.\n\nBestätige mit \`${BOT_INFO.PREFIX}wipedb confirm\` (2 Minuten gültig).`
        )
      );
      return;
    }

    armed.delete(key);

    const config = (await import("../../config.js")).default;
    const removed = [];

    try {
      await clearAuthState();
      removed.push("auth state");
    } catch (err) {
      console.error("[control] clearAuthState failed:", err?.message || err);
    }

    if (!config.USE_POSTGRES && config.SQLITE_PATH) {
      const fs = await import("fs/promises");
      for (const p of [
        config.SQLITE_PATH,
        `${config.SQLITE_PATH}-wal`,
        `${config.SQLITE_PATH}-shm`,
      ]) {
        try {
          await fs.unlink(p);
          removed.push(p);
        } catch (err) {
          if (err.code !== "ENOENT") {
            console.warn(`[control] unlink ${p} failed:`, err?.message || err);
          }
        }
      }
    }

    await writeAudit({
      action: "cmd.wipedb",
      actor: message.sender,
      chat: message.from,
      meta: { removed: removed.length },
    }).catch(() => {});

    await systemLog("warn", `🧨 Auth database wiped via .wipedb (${removed.length} file(s)).`, "").catch(
      () => {}
    );

    await replyOk(
      conn,
      message,
      await tr(
        `🧨 Database wiped (${removed.length} item(s)). Restarting — pair again to log in.`,
        `🧨 Datenbank gelöscht (${removed.length} Element(e)). Starte neu — zum Anmelden neu koppeln.`
      )
    );

    setTimeout(() => process.exit(0), 1500);
  }
);

command(
  {
    pattern: "platform",
    fromMe: false,
    desc: "Show detected host / supervisor / runtime (owner)",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireOwnerControl(conn, message))) return;

    const d = describe();
    const ff = await ffmpegVersion().catch(() => null);

    const lines = [
      `🖥️ *Runtime*`,
      `• Platform: ${d.platform}/${d.arch} · node ${d.node}`,
      `• Supervisor: *${d.supervisorLabel}* (${d.supervisor})`,
      `• Container: ${d.containerHint}`,
      `• Auto-restart: ${d.canAutoRestart ? "yes" : "no"}`,
      `• Stay-stopped: ${d.canStayStopped ? "yes" : "no"}`,
      ``,
      `⌨️ *Console*`,
      `• TTY: ${d.tty ? "yes" : "no"}`,
      `• Maintenance CLI: \`node clear.js --help\``,
      `• Web dashboard: ${process.env.ADMIN_HTTP_PORT ? `port ${process.env.ADMIN_HTTP_PORT}` : "off (ADMIN_HTTP_PORT unset)"}`,
      ``,
      `🔧 *Tools*`,
      `• FFmpeg: ${ff ? ff.slice(0, 70) : "❌ missing"}`,
      `• Database: ${d.supervisorLabel === "Hosting-Panel" ? "SQLite" : "see #sys"}`,
      ``,
      `📁 *Paths*`,
      `• cwd: ${d.cwd}`,
      `• home: ${d.homedir || "n/a"}`,
      ``,
      `_Control: ${BOT_INFO.PREFIX}reboot · ${BOT_INFO.PREFIX}logout confirm · ${BOT_INFO.PREFIX}wipedb confirm · ${BOT_INFO.PREFIX}corepanic_`,
    ];

    await replyOk(conn, message, lines.join("\n"));
  }
);

command(
  {
    pattern: "control",
    fromMe: false,
    desc: "List the owner control commands",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireOwnerControl(conn, message))) return;

    const p = BOT_INFO.PREFIX;
    const owners = getOwnerNumbers().join(", ") || "_(none set)_";

    const lines = [
      `🎛️ *Owner controls* (${p} prefix, supervisor: ${supervisorLabel()})`,
      ``,
      `• ${p}reboot — restart the process`,
      `• ${p}reboot now — restart immediately`,
      `• ${p}shutdown — stop the bot`,
      `• ${p}logout confirm — clear session, pair again`,
      `• ${p}wipedb confirm — wipe auth DB + all settings`,
      `• ${p}corepanic — force the safety shutdown`,
      `• ${p}syswatch on|off|status — toggle self-protection`,
      `• ${p}platform — host + runtime details`,
      `• ${p}health — quick health check`,
      ``,
      `_Owners: ${owners}_`,
      `_The same actions are available in the web dashboard and via \`node clear.js\` (\`platform\` shows what was detected)._`,
    ];

    await replyOk(conn, message, lines.join("\n"));
  }
);

command(
  {
    pattern: "wipekey",
    fromMe: false,
    desc: "Clear the armed confirmation for .logout / .wipedb",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireOwnerControl(conn, message))) return;
    const key = armKey(message, conn);
    const had = armed.delete(key);
    await replyOk(
      conn,
      message,
      had
        ? await tr("✅ Confirmation cleared.", "✅ Bestätigung zurückgesetzt.")
        : await tr("ℹ️ Nothing was armed.", "ℹ️ Es war nichts aktiviert.")
    );
  }
);