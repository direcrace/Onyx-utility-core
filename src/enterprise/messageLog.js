/**
 * Temporal message log — RAM only, NEVER persisted.
 *
 * Rolling, bounded ring buffer of the last messages the MAIN connection saw,
 * kept so a triggered safety monitor (rc lockout / group guards) can show the
 * surrounding context: "did that actually violate the bot's terms, or was it a
 * misfire?" Anything in here dies with the process. Nothing is written to disk,
 * BotKV, or any database — the bot does not keep a message history. The cap and
 * body truncation keep memory tiny.
 *
 *   MSGLOG_CAP   max retained messages (default 250)
 *
 * Entry shape:
 *   { id, ts, kind, jid, session, number, name, sender, fromMe, body, media,
 *     thumb, mediaInfo, blocked }
 *   session    — which connection saw it ("main" or a mini number)
 *   name       — best-effort display name for the chat (pushName / subject /
 *                chat-index cache), so the dashboard shows names not just numbers
 *   mediaInfo  — download progress of the payload bytes (see mediaCache.js):
 *                null (no media) | { ready:false } (downloading) |
 *                { ready:true, mime, size, name, ext } | { failed:true }
 *   blocked    = reason when a safety guard stopped/marked this message.
 */

const CAP = Math.max(50, Number(process.env.MSGLOG_CAP) || 250);
const TRUNC = 200;

/** Friendly label for non-text payloads (shown when a message has no text body). */
const TYPE_LABELS = {
  imageMessage: "🖼 image",
  videoMessage: "🎬 video",
  ptvMessage: "🎥 video note",
  audioMessage: "🎙 voice note",
  voiceMessage: "🎙 voice note",
  stickerMessage: "🕹 sticker",
  documentMessage: "📄 document",
  locationMessage: "📍 location",
  liveLocationMessage: "📍 live location",
  contactMessage: "👤 contact",
  contactVcardMessages: "👤 contact",
  pollCreationMessage: "📊 poll",
  pollUpdateMessage: "📊 poll vote",
  paymentMessage: "💳 payment",
  reactionMessage: "👍 reaction",
  buttonsMessage: "🔘 buttons",
  buttonsResponseMessage: "🔘 button",
  listMessage: "📋 list",
  listResponseMessage: "📋 list reply",
  templateMessage: "🧩 template",
  viewOnceMessage: "👁 view-once",
  call: "📞 call",
};

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (!b) return "";
  if (b >= 1048576) return (b / 1048576).toFixed(1).replace(/\.0$/, "") + " MB";
  if (b >= 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
}

/** Readable label for non-text payloads (+ duration / filename / size / mime). */
function mediaLabel(message) {
  const content = message?.message || {};
  const typeKey = message?.messageTypeKey || "";
  const mime = content.mimetype || "";
  const seconds = Number(content.seconds) || 0;
  const fileName = content.fileName || "";
  const size = fmtSize(content.fileLength);
  const tmpl = TYPE_LABELS[typeKey];
  if (typeKey === "documentMessage") {
    return `[${tmpl}${fileName ? " · " + fileName : ""}${mime ? " · " + mime : ""}${size ? " · " + size : ""}]`;
  }
  if (typeKey === "audioMessage" || typeKey === "voiceMessage" || typeKey === "videoMessage" || typeKey === "ptvMessage") {
    return `[${tmpl}${seconds ? " · " + fmtDur(seconds) : ""}]`;
  }
  if (typeKey === "imageMessage" || typeKey === "stickerMessage") {
    return `[${tmpl}${size ? " · " + size : ""}]`;
  }
  return `[${tmpl || (typeKey ? typeKey.replace(/Message$/i, "") : "media")}]`;
}

/** Payload thumbnail (base64, small) so the dashboard can show an actual preview. */
function mediaThumb(message) {
  const content = message?.message || {};
  const raw = content.thumbnail || content.jpegThumbnail || content.ptvThumbnail || null;
  return raw && typeof raw === "string" ? raw.slice(0, 6000) : "";
}

export const LOG_CAP = CAP;

let seq = 0;
/** oldest → newest, trimmed to CAP */
const items = [];

function truncate(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > TRUNC ? t.slice(0, TRUNC) + "…" : t;
}

/** Sync, best-effort display name for a chat jid (index caches + group subjects). */
async function lookupChatName(jid) {
  try {
    const { lookupName } = await import("./chatIndex.js");
    return lookupName(jid);
  } catch { /* best effort */ }
  return null;
}

/** Log one serialized message. Returns its id so a guard can mark it blocked. */
export async function recordLogMessage(message, { session = "main", name } = {}) {
  const id = `${++seq}:${message?.id || message?.key?.id || "?"}-${Date.now()}`;
  const jid = message?.from || "";
  const rawBody = message?.body || "";
  const media = !rawBody;
  const known = name || (!message?.isGroup ? message?.pushName || "" : "") || "";
  items.push({
    id,
    ts: Date.now(),
    kind: message?.isGroup ? "group" : "dm",
    jid,
    session,
    number: (message?.sender || jid || "").split("@")[0],
    name: known || (await lookupChatName(jid)) || null,
    sender: message?.sender || null,
    fromMe: !!message?.key?.fromMe,
    body: truncate(rawBody || (media ? mediaLabel(message) : "")),
    media,
    thumb: media ? mediaThumb(message) : "",
    mediaInfo: media ? { ready: false } : null,
    blocked: null,
  });
  if (items.length > CAP) items.splice(0, items.length - CAP);
  return id;
}

/** Mark a previously-recorded message as blocked by a safety guard. */
export async function markLogBlocked(id, reason) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].id === id) {
      items[i].blocked = reason;
      return true;
    }
  }
  return false;
}

/** Set the payload-download state of an entry (see mediaCache.js). */
export async function markLogMedia(id, state) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].id === id) {
      items[i].mediaInfo = { ready: false, ...state };
      return true;
    }
  }
  return false;
}

/** Newest-first slice for the dashboard / dev-console. */
export async function listRecentLog({ n = 40 } = {}) {
  const take = Math.max(1, Math.min(Number(n) || 40, CAP));
  return items.slice(-take).reverse();
}

/** Short tail embedded into rc warn/lock audit entries — heavy/private fields
 *  (thumbnail bytes, raw sender jid, download meta) are stripped so persisted
 *  audit rows stay lean and never carry payload data. */
export async function snapshotLog(max = 12) {
  return items.slice(-Math.max(1, max)).reverse().map((x) => ({
    id: x.id,
    ts: x.ts,
    kind: x.kind,
    jid: x.jid,
    session: x.session,
    number: x.number,
    name: x.name,
    fromMe: x.fromMe,
    body: x.body,
    media: x.media,
    blocked: x.blocked,
  }));
}