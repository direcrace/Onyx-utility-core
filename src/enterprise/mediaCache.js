

import fs from "fs";
import path from "path";
import { downloadMediaMessage } from "baileys";

const MAX_FILE = (Number(process.env.MEDIA_MAX_MB) || 25) * 1024 * 1024;
const MAX_TOTAL = (Number(process.env.MEDIA_TOTAL_MB) || 256) * 1024 * 1024;

const MEDIA_TYPES = new Set([
  "imageMessage",
  "videoMessage",
  "ptvMessage",
  "audioMessage",
  "voiceMessage",
  "stickerMessage",
  "documentMessage",
]);

const MIME_EXTS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/vcard": "vcf",
};

const files = new Map();
let totalBytes = 0;
let booted = false;

function baseDir() {
  return path.join(global.__basedir || process.cwd(), "media");
}

function bootMediaCache() {
  if (booted) return;
  booted = true;
  try {
    fs.rmSync(baseDir(), { recursive: true, force: true });
  } catch {  }
  try {
    fs.mkdirSync(baseDir(), { recursive: true });
  } catch {  }
}

function safeName(s) {
  return String(s || "media").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 60) || "media";
}

function extForMime(mime, fallbackName) {
  if (mime && MIME_EXTS[mime.toLowerCase()]) return MIME_EXTS[mime.toLowerCase()];
  if (fallbackName) {
    const e = String(fallbackName).split(".").pop();
    if (e && e.length <= 5 && /^[A-Za-z0-9]+$/.test(e)) return e.toLowerCase();
  }
  if (mime) {
    const sub = mime.split("/")[1]?.split(";")[0]?.toLowerCase();
    if (sub && /^[a-z0-9+.-]+$/.test(sub)) return sub;
  }
  return "bin";
}

function evictIfNeeded() {
  const order = [...files.values()].sort((a, b) => a.at - b.at);
  while (totalBytes > MAX_TOTAL && order.length) {
    const it = order.shift();
    const key = `${it.session}/${it.id}`;
    if (files.get(key) === it) {
      files.delete(key);
      totalBytes -= it.size;
      try { fs.unlinkSync(it.file); } catch {  }
    }
  }
}

function mark(item, state) {
  import("./messageLog.js").then(({ markLogMedia }) =>
    markLogMedia(item.logId, state)
  ).catch(() => {  });
}

export async function ingestMedia({ conn, raw, message, session = "main", logId }) {
  const content = message?.message || {};
  const typeKey = message?.messageTypeKey || "";
  if (!MEDIA_TYPES.has(typeKey)) return false;
  if (!content.mediaKey && !content.url) return false;

  let file = null, created = false;
  try {
    bootMediaCache();

    const declared = Number(content.fileLength) || 0;
    if (declared > MAX_FILE) {
      mark(logId, { ready: false, failed: true, reason: "too large to cache" });
      return false;
    }

    const fake = { key: raw?.key, message: { [typeKey]: content } };
    let stream;
    try {
      stream = await downloadMediaMessage(fake, "stream");
    } catch {
      mark(logId, { ready: false, failed: true });
      return false;
    }
    if (!stream || typeof stream !== "object") {
      mark(logId, { ready: false, failed: true });
      return false;
    }

    const chunks = [];
    let got = 0;
    for await (const chunk of stream) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      got += b.length;
      if (got > MAX_FILE) {
        mark(logId, { ready: false, failed: true, reason: "too large to cache" });
        return false;
      }
      chunks.push(b);
    }
    if (!got) {
      mark(logId, { ready: false, failed: true });
      return false;
    }

    const mime = String(content.mimetype || "").toLowerCase() || "application/octet-stream";
    const ext = extForMime(mime, content.fileName);
    const name = String(content.fileName || "").slice(0, 160) || "";
    const key = `${session}/${logId}`;
    const dir = path.join(baseDir(), String(session).replace(/[^0-9A-Za-z_-]/g, "_"));
    try { fs.mkdirSync(dir, { recursive: true }); } catch {  }
    file = path.join(dir, `${safeName(logId)}.${ext}`);
    fs.writeFileSync(file, Buffer.concat(chunks));

    files.set(key, { key, file, mime, ext, size: got, name, session, logId, at: Date.now() });
    totalBytes += got;
    try { evictIfNeeded(); } catch {  }

    created = true;
    mark(logId, { ready: true, mime, size: got, name, ext });
    return true;
  } catch {

    if (!created && file) { try { fs.unlinkSync(file); } catch {  } }
    mark(logId, { ready: false, failed: true });
    return false;
  }
}

export function getMedia(key) {
  const meta = files.get(String(key));
  if (!meta) return null;
  try {
    if (!fs.existsSync(meta.file)) return null;
  } catch {
    return null;
  }
  return meta;
}

export function mediaCacheStats() {
  return { count: files.size, bytes: totalBytes, fileCap: MAX_FILE, totalCap: MAX_TOTAL };
}