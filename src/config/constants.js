/**
 * Application Constants
 * Centralized configuration for the bot
 */

let _prefix = (process.env.BOT_PREFIX || "").replace(/\s+/g, "") || "#";
let _botName = (process.env.BOT_NAME || "ONYX UTILITY CORE").trim();

/** Current runtime command prefix (BotKV/persisted override wins on boot). */
export function getPrefix() {
  return _prefix;
}

/** Current runtime bot display name. */
export function getBotName() {
  return _botName;
}

/** Load persisted prefix/botname overrides into memory (call after BotKV is up). */
export async function loadRuntimeConfig() {
  try {
    const { kvGet } = await import("../database/botKv.js");
    const p = await kvGet("config:prefix");
    if (typeof p === "string" && p.trim() && !/\s/.test(p) && p.trim().length <= 3) {
      _prefix = p.trim();
    }
    const n = await kvGet("config:botname");
    if (typeof n === "string" && n.trim()) {
      _botName = n.trim().slice(0, 40);
    }
  } catch {
    /* BotKV not ready yet — env/default values stay in effect */
  }
  process.env.BOT_PREFIX = _prefix;
  return { prefix: _prefix, botName: _botName };
}

/** Persist + apply a new command prefix (validated). Caller must rebuild patterns. */
export async function saveRuntimePrefix(value) {
  const p = String(value).trim();
  if (!p) throw new Error("Prefix must not be empty.");
  if (/\s/.test(p)) throw new Error("Prefix must be a single token without spaces.");
  if (p.length > 3) throw new Error("Prefix is too long (max 3 characters).");
  _prefix = p;
  process.env.BOT_PREFIX = p;
  try {
    const { kvSet } = await import("../database/botKv.js");
    await kvSet("config:prefix", p);
  } catch { /* DB write not critical */ }
  return p;
}

/** Persist + apply a new bot display name. */
export async function saveRuntimeBotName(value) {
  const n = String(value).trim();
  if (!n) throw new Error("Bot name must not be empty.");
  const name = n.slice(0, 40);
  _botName = name;
  process.env.BOT_NAME = name;
  try {
    const { kvSet } = await import("../database/botKv.js");
    await kvSet("config:botname", name);
  } catch { /* DB write not critical */ }
  return name;
}

export const BOT_INFO = {
  get NAME() {
    return _botName;
  },
  VERSION: "5.0.3",
  get PREFIX() {
    return _prefix;
  },
  OWNER: process.env.OWNER_NUMBER || "",
};

export const MEDIA = {
  STICKER_PACKNAME: process.env.STICKER_PACKNAME || "X-Asena",
  STICKER_AUTHOR: process.env.STICKER_AUTHOR || "X-Asena",
  REMOVEBG_API_KEY: process.env.REMOVEBG_API_KEY || "",
  /** Soft caps before send (bytes) */
  MAX_AUDIO_BYTES: 15 * 1024 * 1024,
  MAX_VIDEO_BYTES: 60 * 1024 * 1024,
  MAX_STICKER_BYTES: 1 * 1024 * 1024,
  /** Duration caps (seconds) */
  MAX_AUDIO_DURATION: 15 * 60,
  MAX_VIDEO_DURATION: 10 * 60,
  MAX_STICKER_VIDEO_DURATION: 10,
};

export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  STICKER: "sticker",
  DOCUMENT: "document",
};

export const JID_TYPES = {
  USER: "@s.whatsapp.net",
  LID: "@lid",
  GROUP: "@g.us",
  BROADCAST: "@broadcast",
  STATUS: "status@broadcast",
};

export const COMMAND_TYPES = {
  MISC: "misc",
  GROUP: "group",
  ADMIN: "admin",
  MEDIA: "media",
  INFO: "info",
  OWNER: "owner",
};

export const ERROR_MESSAGES = {
  GROUP_ONLY: "⚠️ This command can only be used in groups!",
  OWNER_ONLY: "⚠️ This command is only for the bot owner!",
  ADMIN_ONLY: "⚠️ This command is only for group admins!",
  BOT_ADMIN: "⚠️ Bot needs to be admin to perform this action!",
  FAILED: "❌ An error occurred while processing your request.",
  INVALID_FORMAT: "⚠️ Invalid format! Check command usage.",
  get UNKNOWN_COMMAND() {
    return `⚠️ Unknown command. Try ${getPrefix()}menu for a list.`;
  },
};

export const SUCCESS_MESSAGES = {
  DONE: "✅ Done!",
  PROCESSING: "⏳ Processing...",
  COMPLETED: "✅ Operation completed successfully!",
};

export const USAGE_HINTS = {
  get promote() {
    return `⚠️ Mention a user or reply to their message.\n*Usage:* ${_prefix}promote @user`;
  },
  get demote() {
    return `⚠️ Mention a user or reply to their message.\n*Usage:* ${_prefix}demote @user`;
  },
  get mention() {
    return `*Usage:* ${_prefix}mention [text]`;
  },
};

export const UX = {
  ACK_REACT: "⚡",
  OK_PREFIX: "✅ ",
  FAIL_PREFIX: "❌ ",
};

export const RETRY_CONFIG = {
  MAX_RETRIES: 5,
  RETRY_DELAY: 50,
  BACKOFF_MULTIPLIER: 1.5,
};

export const LOG_LEVELS = {
  SILENT: "silent",
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
};

