/**
 * Non-command group moderation guards
 * Handles: mute, antilink, antispam, antibot, banned, onlyadmin
 * Plus post-message actions: autoreact, autotyping, autoread
 */

import { shouldBlockGroupMessage, tryDeleteMessage } from "../utils/moderation.js";
import { isPrivileged } from "../utils/access.js";
import { isBotBanned } from "../utils/globalBan.js";
import { isAdmin, isBotAdmin, kickUser } from "../utils/group.js";
import { groupCache } from "../utils/cache.js";
import { getGroupSettings, isBanned } from "../utils/groupSettings.js";
import { normalizeNumber } from "../utils/access.js";

function isSenderBot(message, conn) {
  const sender = message.sender || message.participant || "";
  const botId = conn?.user?.id?.replace(/:\d+@/, "@") || "";
  const botLid = conn?.user?.lid || "";
  if (sender === botId || sender === botLid) return false;
  if (message.isBotMessage) return true;
  return false;
}
export async function processGroupGuards({ message, conn }, onBlock) {
  if (!message?.isGroup) return false;
  if (message.key?.fromMe) return false;

  const block = (reason) => {
    if (onBlock) onBlock(message, reason);
    return true;
  };

  const privileged = await isPrivileged(message, conn);
  const senderNorm = normalizeNumber(message.sender) || message.sender;

  let meta = groupCache.get(message.from);
  if (!meta) {
    try {
      meta = await conn.groupMetadata(message.from);
      groupCache.set(message.from, meta);
    } catch {
      meta = null;
    }
  }

  const admin =
    meta &&
    (isAdmin(meta, message.sender) ||
      isAdmin(meta, message.participant) ||
      isAdmin(meta, message.participantAlt));

  const settings = await getGroupSettings(message.from);

  // BANNED USER CHECK
  if (!privileged) {
    if (await isBotBanned(senderNorm)) return block("BANNED");
    const banned = await isBanned(message.from, senderNorm);
    if (banned) return block("BANNED");
  }

  // ONLY-ADMIN CHECK
  if (settings.onlyadmin && !admin && !privileged) return block("ONLY_ADMIN");

  // CORE BLOCK CHECKS (mute / antilink / antispam / antitag)
  const result = await shouldBlockGroupMessage(message, conn);
  if (result.block) {
    if (["ANTILINK", "ANTISPAM", "ANTITAG", "ANTISTICKER"].includes(result.reason) && (privileged || admin)) {
      // continue
    } else if (result.reason === "MUTED") {
      if (result.deleteMsg && meta && isBotAdmin(meta, conn)) {
        await tryDeleteMessage(conn, message);
      }
      return block("MUTED");
    } else {
      await runPunishment(settings, result.reason, message, conn, meta);
      return block(result.reason);
    }
  }

  // ANTIBOT CHECK
  if (settings.antibot && !privileged && !admin && !message.key?.fromMe) {
    if (isSenderBot(message, conn)) {
      if (meta && isBotAdmin(meta, conn)) {
        await tryDeleteMessage(conn, message);
      }
      const action = settings.antibotAction || "kick";
      if (action === "kick" && meta && isBotAdmin(meta, conn)) {
        try {
          await kickUser(conn, message.from, message.sender);
        } catch { /* ignore */ }
      }
      try {
        await conn.sendMessage(message.from, {
          text: `🤖 Bot detected and ${action === "kick" ? "removed" : "action taken"}.`,
        });
      } catch { /* ignore */ }
      return block("ANTIBOT");
    }
  }

  // POST-MESSAGE ACTIONS
  if (!result.block) {
    if (settings.autoreact && !message.key?.fromMe) {
      try {
        await conn.sendMessage(message.from, {
          react: { text: settings.autoreact, key: message.key },
        });
      } catch { /* ignore */ }
    }
    if (settings.autoread) {
      try { await conn.sendPresenceUpdate("available", message.from); } catch { /* ignore */ }
    }
    if (settings.autotyping) {
      try {
        await conn.sendPresenceUpdate("composing", message.from);
        setTimeout(async () => {
          try { await conn.sendPresenceUpdate("paused", message.from); } catch { /* ignore */ }
        }, 2000);
      } catch { /* ignore */ }
    }
  }

  return false;
}

async function runPunishment(settings, reason, message, conn, meta) {
  const actionKey =
    reason === "ANTILINK" ? "antilinkAction"
    : reason === "ANTISPAM" ? "antispamAction"
    : reason === "ANTITAG" ? "antitagAction"
    : reason === "ANTISTICKER" ? "antistickerAction"
    : "delete";
  const action = settings[actionKey] || "delete";
  const label =
    reason === "ANTILINK" ? "🔗 Links are not allowed here."
    : reason === "ANTISPAM" ? "📬 No spamming."
    : reason === "ANTISTICKER" ? "🖼 No stickers here."
    : "👥 Don't tag everyone.";
  const norm = normalizeNumber(message.sender) || message.sender;

  if (meta && isBotAdmin(meta, conn)) {
    await tryDeleteMessage(conn, message);
  }

  try {
    await conn.sendMessage(message.from, { text: label });
  } catch { /* ignore */ }

  const {
    addWarn, resetWarns, banUser,
  } = await import("../utils/groupSettings.js");
  const warnLimit = settings.warnLimit || 3;

  if (action === "warn") {
    const count = await addWarn(message.from, norm);
    if (count <= warnLimit) {
      await conn.sendMessage(message.from, {
        text: `⚠️ Warning ${count}/${warnLimit}.`,
      }).catch(() => {});
    }
    if (count >= warnLimit && meta && isBotAdmin(meta, conn)) {
      try {
        await kickUser(conn, message.from, message.sender);
        await resetWarns(message.from, norm);
      } catch { /* ignore */ }
    }
  } else if (action === "strict") {
    const count = await addWarn(message.from, norm);
    if (count <= 2) {
      await conn.sendMessage(message.from, {
        text: `⚠️ Strict mode · warning ${count}/2.`,
      }).catch(() => {});
    }
    if (count >= 2 && meta && isBotAdmin(meta, conn)) {
      try {
        await kickUser(conn, message.from, message.sender);
        await resetWarns(message.from, norm);
      } catch { /* ignore */ }
    }
  } else if (action === "kick" && meta && isBotAdmin(meta, conn)) {
    try {
      await kickUser(conn, message.from, message.sender);
    } catch { /* ignore */ }
  } else if (action === "ban") {
    await banUser(message.from, norm);
  }
}

/**
 * Group kill-switch gate ("#bot off").
 * Returns:
 *  - "disabled" → fully silent (bot is off for this group)
 *  - "wake"     → only run the #bot handler (skip guards)
 *  - "bypass"   → run normally but skip guards (privileged users while bot is off)
 *  - false      → normal pipeline
 */
export async function processGroupMessageGate({ message, conn }) {
  if (!message?.isGroup || message.key?.fromMe) return false;
  const settings = await getGroupSettings(message.from);
  if (!settings.botDisabled) return false;

  const body = (message.body || "").trim().toLowerCase();
  const isBotCmd = /^#bot(\s+(on|off|status))?$/.test(body);
  const privileged = await isPrivileged(message, conn);

  if (privileged) return "bypass";

  if (isBotCmd && (await isWakeAdmin(message, conn))) return "wake";

  return "disabled";
}

async function isWakeAdmin(message, conn) {
  try {
    let meta = groupCache.get(message.from);
    if (!meta) {
      meta = await conn.groupMetadata(message.from);
      groupCache.set(message.from, meta);
    }
    return (
      isAdmin(meta, message.sender) ||
      isAdmin(meta, message.participant) ||
      isAdmin(meta, message.participantAlt)
    );
  } catch {
    return false;
  }
}
