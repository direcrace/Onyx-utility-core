/**
 * Message Utility Functions
 * Helper functions for message operations + UX feel helpers
 */

import { ERROR_MESSAGES, SUCCESS_MESSAGES, UX } from "../config/constants.js";

/**
 * Pick English vs German based on the current global language (for inline strings).
 * Returns `de` when the bot language is German and a German variant is given.
 */
export async function tr(en, de) {
  const { getLang } = await import("./i18n.js");
  const lang = await getLang();
  return lang === "de" && de !== undefined ? de : en;
}

/**
 * Send a text message with optional quote / mentions
 */
export async function sendMessage(conn, jid, text, options = {}) {
  const messageOptions =
    typeof text === "string" ? { text } : { ...text };

  if (options.mentions) {
    messageOptions.mentions = options.mentions;
  }

  const sendOptions = {};
  if (options.quoted?.key) {
    sendOptions.quoted = {
      key: options.quoted.key,
      message: options.quoted.message,
    };
  }

  return await conn.sendMessage(jid, messageOptions, sendOptions);
}

/**
 * Reply to a message
 */
export async function reply(conn, message, text, options = {}) {
  return await sendMessage(conn, message.from, text, {
    ...options,
    quoted: {
      key: message.key,
      message: message.message,
    },
  });
}

/**
 * Send an error message
 */
export async function sendError(conn, jid, error) {
  const { t } = await import("./i18n.js");
  let text = error;
  try {
    const translated = await t(error);
    if (translated && translated !== error) text = translated;
  } catch { /* ignore */ }
  if (text === error) text = ERROR_MESSAGES[error] || error || ERROR_MESSAGES.FAILED;
  return await sendMessage(conn, jid, text);
}

/**
 * React-ack on the user's command message (instant feedback)
 */
export async function ackCommand(conn, message, emoji = UX.ACK_REACT) {
  try {
    await conn.sendMessage(message.from, {
      react: { text: emoji, key: message.key },
    });
  } catch {
    // Non-fatal — some chats block reactions
  }
}

/**
 * Brief composing presence around async work
 */
export async function withTyping(conn, jid, fn, { timeoutMs = 15_000 } = {}) {
  let cleared = false;
  const clear = async () => {
    if (cleared) return;
    cleared = true;
    try {
      await conn.sendPresenceUpdate("paused", jid);
    } catch {
      /* ignore */
    }
  };

  try {
    await conn.sendPresenceUpdate("composing", jid);
  } catch {
    /* ignore */
  }

  const timer = setTimeout(clear, timeoutMs);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    await clear();
  }
}

/**
 * Friendly success reply
 */
export async function replyOk(conn, message, text, options = {}) {
  const body =
    text === undefined || text === null
      ? SUCCESS_MESSAGES.DONE
      : text.startsWith("✅")
        ? text
        : `${UX.OK_PREFIX}${text}`;
  return reply(conn, message, body, options);
}

/**
 * Friendly failure reply
 */
export async function replyFail(conn, message, text, options = {}) {
  const body =
    text === undefined || text === null
      ? ERROR_MESSAGES.FAILED
      : text.startsWith("❌") || text.startsWith("⚠️")
        ? text
        : `${UX.FAIL_PREFIX}${text}`;
  return reply(conn, message, body, options);
}

/**
 * Extract command arguments from message body
 */
export function getCommandArgs(body, pattern) {
  const regex = new RegExp(`${pattern}\\s+(.*)`, "is");
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Format uptime to readable string
 */
export function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0) parts.push(`${seconds % 60}s`);

  return parts.join(" ") || "0s";
}

/**
 * Create quoted message object
 */
export function createQuote(message) {
  return {
    key: message.key,
    message: message.message,
  };
}

/**
 * Extract mentions from message
 */
export function getMentions(message) {
  return message.message?.contextInfo?.mentionedJid || [];
}

/**
 * Get quoted message participant
 */
export function getQuotedParticipant(message) {
  return message.message?.contextInfo?.participant || null;
}
