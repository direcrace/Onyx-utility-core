

import { kvGet, kvSet } from "../database/botKv.js";
import { groupCache } from "../utils/cache.js";
import { appendLogLine, getLogDir, iso, quoted, safePrefix } from "./logFile.js";

export const LOG_LEVELS = ["off", "audit", "messages", "raw"];

const RANK = { off: 0, audit: 1, messages: 2, raw: 3 };
const LEVEL_KEY = "log_capture_level";
const LEVEL_TTL_MS = 10_000;
const SEEN_CAP = 5000;

const MAX_BODY = Math.max(200, Number(process.env.AUDIT_LOG_BODY_MAX) || 4000);
const MAX_RAW = Math.max(500, Number(process.env.AUDIT_LOG_RAW_MAX) || 8000);

let cachedLevel = null;
let cachedAt = 0;

const seen = new Set();
const seenOrder = [];

export function normalizeLogLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return LOG_LEVELS.includes(level) ? level : null;
}

export async function getLogLevel() {
  if (cachedLevel && Date.now() - cachedAt < LEVEL_TTL_MS) return cachedLevel;

  let level = normalizeLogLevel(process.env.AUDIT_LOG_LEVEL) || "audit";
  try {
    const stored = normalizeLogLevel(await kvGet(LEVEL_KEY));
    if (stored) level = stored;
  } catch {  }

  cachedLevel = level;
  cachedAt = Date.now();
  return level;
}

export async function setLogLevel(value) {
  const level = normalizeLogLevel(value);
  if (!level) throw new Error(`Invalid log level (use ${LOG_LEVELS.join("|")})`);
  await kvSet(LEVEL_KEY, level);
  cachedLevel = level;
  cachedAt = Date.now();
  return level;
}

export function levelAtLeast(level, min) {
  return (RANK[level] ?? 0) >= (RANK[min] ?? 0);
}

export async function isCaptureAtLeast(min) {
  return levelAtLeast(await getLogLevel(), min);
}

function messagePrefix() {
  return safePrefix(process.env.AUDIT_MESSAGE_PREFIX, "messages");
}

function rawPrefix() {
  return safePrefix(process.env.AUDIT_RAW_PREFIX, "raw");
}

export function getLogFileNames(ts = Date.now()) {
  const day = iso(ts).slice(0, 10);
  return {
    dir: getLogDir(),
    audit: `${safePrefix(process.env.AUDIT_LOG_PREFIX, "audit")}-${day}.log`,
    messages: `${messagePrefix()}-${day}.log`,
    raw: `${rawPrefix()}-${day}.log`,
  };
}

function clip(text, max) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max)}…<+${s.length - max}>` : s;
}

function safeJson(value) {
  try {
    const replacer = (_key, val) => {
      if (typeof val === "string" && val.length > 2000) {
        return `<str ${val.length}b:${val.slice(0, 64)}…>`;
      }
      if (typeof val === "object" && val && val.type === "Buffer" && Array.isArray(val.data)) {
        return `<buffer ${val.data.length}b>`;
      }
      return val;
    };
    const text = JSON.stringify(value, replacer);
    return clip(text === undefined ? String(value) : text, MAX_RAW);
  } catch {
    return "<unserializable>";
  }
}

function chatNameFor(message) {
  if (message?.isGroup) {
    try {
      return groupCache.get(message.from)?.subject || null;
    } catch {  }
  }
  return message?.pushName || null;
}

function isDuplicate(session, chat, id) {
  if (!id) return false;
  const key = `${session}:${chat}:${id}`;
  if (seen.has(key)) return true;
  seen.add(key);
  seenOrder.push(key);
  if (seenOrder.length > SEEN_CAP) {
    const oldest = seenOrder.shift();
    if (oldest) seen.delete(oldest);
  }
  return false;
}

export async function archiveMessage({ message, raw, session = "main" } = {}) {
  if (!message) return false;

  const level = await getLogLevel();
  if (!levelAtLeast(level, "messages")) return false;

  const chat = message.from || raw?.key?.remoteJid || "";
  const id = message.key?.id || message.id || raw?.key?.id || "";
  if (isDuplicate(session, chat, id)) return false;

  const ts = Date.now();
  const chatName = chatNameFor(message);
  const parts = [
    `[${iso(ts)}]`,
    `dir=${message.key?.fromMe ? "out" : "in"}`,
    `session=${session}`,
    `chat=${chat || "-"}`,
  ];

  if (chatName) parts.push(`chatName=${quoted(chatName)}`);
  parts.push(`sender=${message.sender || "-"}`);
  if (message.pushName) parts.push(`senderName=${quoted(message.pushName)}`);
  parts.push(`fromMe=${message.key?.fromMe ? 1 : 0}`);
  parts.push(`kind=${message.isGroup ? "group" : "dm"}`);
  parts.push(`type=${message.type || "unknown"}`);
  if (message.messageTypeKey) parts.push(`typeKey=${message.messageTypeKey}`);
  if (id) parts.push(`id=${id}`);
  if (message.isBotMessage) parts.push(`bot=1`);
  if (message.key?.participant) parts.push(`participant=${message.key.participant}`);

  const contextInfo = message.message?.contextInfo || message.rawMessage?.contextInfo;
  const mentions = contextInfo?.mentionedJid;
  if (Array.isArray(mentions) && mentions.length) parts.push(`mentions=${mentions.length}`);

  if (message.quoted) {
    const qid = message.quoted?.id || message.quoted?.key?.id || null;
    if (qid) parts.push(`quotedId=${qid}`);
    const qtext = message.quoted?.text || message.quoted?.caption || "";
    if (qtext) parts.push(`quotedBody=${quoted(clip(qtext, 500))}`);
  }

  if (message.body) parts.push(`body=${quoted(clip(message.body, MAX_BODY))}`);

  await appendLogLine(messagePrefix(), ts, parts.join(" | ") + "\n");

  if (level === "raw") {
    const payload = raw || message.rawMessage || message;
    await appendLogLine(
      rawPrefix(),
      ts,
      `[${iso(ts)}] | event=message | session=${session} | chat=${chat || "-"} | id=${id || "-"} | json=${safeJson(payload)}\n`
    );
  }

  return true;
}

function outgoingType(content) {
  if (!content || typeof content === "string") return "text";
  if (content.react) return "reaction";
  if (content.image) return "image";
  if (content.video) return "video";
  if (content.audio) return "audio";
  if (content.document) return "document";
  if (content.sticker) return "sticker";
  if (content.location) return "location";
  if (content.contacts) return "contact";
  if (content.poll) return "poll";
  if (content.text || content.caption) return "text";
  return "other";
}

export async function archiveOutgoing({ jid, content, result, session = "main" } = {}) {
  if (!jid) return false;

  const level = await getLogLevel();
  if (!levelAtLeast(level, "messages")) return false;

  const id = result?.key?.id || "";
  if (isDuplicate(session, jid, id)) return false;

  const ts = Date.now();
  const text = typeof content === "string" ? content : content?.text || content?.caption || "";
  const parts = [
    `[${iso(ts)}]`,
    `dir=out`,
    `session=${session}`,
    `chat=${jid}`,
    `sender=bot`,
    `fromMe=1`,
    `kind=${String(jid).endsWith("@g.us") ? "group" : "dm"}`,
    `type=${outgoingType(content)}`,
  ];

  if (id) parts.push(`id=${id}`);
  if (text) parts.push(`body=${quoted(clip(text, MAX_BODY))}`);
  if (content?.mentions?.length) parts.push(`mentions=${content.mentions.length}`);
  if (content?.quoted?.key?.id) parts.push(`quotedId=${content.quoted.key.id}`);

  await appendLogLine(messagePrefix(), ts, parts.join(" | ") + "\n");

  if (level === "raw") {
    await appendLogLine(
      rawPrefix(),
      ts,
      `[${iso(ts)}] | event=message.out | session=${session} | chat=${jid} | id=${id || "-"} | json=${safeJson({ key: result?.key || null, content })}\n`
    );
  }

  return true;
}

const OUT_PATCH = Symbol("onyxLogOutPatched");

export function armOutgoingCapture(conn, { session = "main" } = {}) {
  if (!conn || conn[OUT_PATCH] || typeof conn.sendMessage !== "function") return conn;

  const original = conn.sendMessage.bind(conn);
  conn.sendMessage = async (jid, content, options) => {
    const result = await original(jid, content, options);
    try {
      archiveOutgoing({ jid, content, result, session }).catch(() => {});
    } catch {  }
    return result;
  };
  conn[OUT_PATCH] = true;
  return conn;
}

export async function archiveEvent(kind, data, { session = "main", minLevel = "messages" } = {}) {
  const level = await getLogLevel();
  if (!levelAtLeast(level, minLevel)) return false;

  const ts = Date.now();
  const chat = data?.chat || data?.from || data?.key?.remoteJid || "-";
  const id = data?.id || data?.key?.id || data?.update?.key?.id || "-";

  const parts = [
    `[${iso(ts)}]`,
    `event=${kind}`,
    `session=${session}`,
    `chat=${chat}`,
    `id=${id}`,
  ];
  if (data?.from && data.from !== chat) parts.push(`from=${data.from}`);
  if (data?.status) parts.push(`status=${data.status}`);
  if (data?.isVideo !== undefined) parts.push(`video=${data.isVideo ? 1 : 0}`);
  if (data?.update?.messageStubType !== undefined) parts.push(`stub=${data.update.messageStubType}`);
  if (data?.update?.key?.fromMe !== undefined) parts.push(`fromMe=${data.update.key.fromMe ? 1 : 0}`);

  const summary = parts.join(" | ");
  await appendLogLine(messagePrefix(), ts, summary + "\n");

  if (level === "raw") {
    await appendLogLine(rawPrefix(), ts, `${summary} | json=${safeJson(data)}\n`);
  }

  return true;
}
