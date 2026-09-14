/**
 * Anti-spam / anti-link helpers + mute checks
 */

import { normalizeNumber } from "./access.js";
import { getGroupSettings } from "./groupSettings.js";

/** senderKey → timestamps[] */
const spamBuckets = new Map();

const URL_RE =
  /(?:https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/)[^\s]+/gi;

export function extractLinks(text) {
  if (!text) return [];
  return text.match(URL_RE) || [];
}

/**
 * Returns true if this message should be treated as spam
 */
export function checkSpam(senderKey, limit = 5, windowMs = 8000) {
  const now = Date.now();
  let arr = spamBuckets.get(senderKey) || [];
  arr = arr.filter((t) => now - t < windowMs);
  arr.push(now);
  spamBuckets.set(senderKey, arr);
  return arr.length > limit;
}

export function isUserMuted(settings, message) {
  const muted = settings.muted || [];
  if (!muted.length) return false;
  const candidates = [
    normalizeNumber(message.sender),
    normalizeNumber(message.participant),
    normalizeNumber(message.participantAlt),
  ].filter(Boolean);
  return muted.some((m) => candidates.includes(normalizeNumber(m)));
}

/**
 * Detect "mention everyone" abuse:
 * - groupMentions (Baileys @everyone)
 * - very large mentionedJid lists
 * - explicit @everyone / @all / @here text
 */
export function hasEveryoneMention(message) {
  if (!message) return false;
  const ctx = message.rawMessage?.contextInfo;
  if (ctx?.groupMentions?.length) return true;
  if (ctx?.mentionedJid?.length > 10) return true;
  const text = message.body || "";
  return /(^|[^@\w])@(everyone|all|here)([^@\w]|$)/i.test(text);
}

export async function shouldBlockGroupMessage(message, conn) {
  if (!message?.isGroup) return { block: false };

  const settings = await getGroupSettings(message.from);

  if (isUserMuted(settings, message)) {
    return { block: true, reason: "MUTED", settings, deleteMsg: true };
  }

  if (settings.antispam && !message.key?.fromMe) {
    const key = `${message.from}:${normalizeNumber(message.sender) || message.sender}`;
    if (checkSpam(key, settings.antispamLimit, settings.antispamWindowMs)) {
      return { block: true, reason: "ANTISPAM", settings, deleteMsg: true };
    }
  }

  if (settings.antilink && message.body && !message.key?.fromMe) {
    const links = extractLinks(message.body);
    // Allow commands that are just the bot prefix + word without raw links... still block if URL present
    if (links.length) {
      return { block: true, reason: "ANTILINK", settings, deleteMsg: true };
    }
  }

  if (settings.antitag && message.body && !message.key?.fromMe) {
    if (hasEveryoneMention(message)) {
      return { block: true, reason: "ANTITAG", settings, deleteMsg: true };
    }
  }

  if (settings.antisticker && message.type === "sticker" && !message.key?.fromMe) {
    return { block: true, reason: "ANTISTICKER", settings, deleteMsg: true };
  }

  return { block: false, settings };
}

export async function tryDeleteMessage(conn, message) {
  try {
    await conn.sendMessage(message.from, { delete: message.key });
  } catch {
    /* may lack admin */
  }
}
