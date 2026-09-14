/**
 * Media utilities — download, temp files, convert, size caps
 */

import fs from "fs/promises";
import { createWriteStream } from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { downloadMediaMessage } from "baileys";
import { MEDIA } from "../config/constants.js";

/** Minimal pino-like logger for Baileys media helpers */
const mediaLogger = {
  level: "error",
  child() {
    return this;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error(...args) {
    console.error("[media]", ...args);
  },
  fatal(...args) {
    console.error("[media]", ...args);
  },
};

const TEMP_PREFIX = "x-asena-";

/**
 * Create a unique temp path under os.tmpdir()
 */
export function createTempPath(ext = "") {
  const name = `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? (ext.startsWith(".") ? ext : `.${ext}`) : ""}`;
  return path.join(os.tmpdir(), name);
}

/**
 * Unlink ignoring missing files
 */
export async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore */
  }
}

/**
 * Write buffer to temp file; returns path
 */
export async function writeTempFile(buffer, ext = "") {
  const filePath = createTempPath(ext);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Stream a Web ReadableStream / Node Readable to a file
 */
export async function streamToFile(stream, filePath) {
  let nodeStream;
  if (stream instanceof Readable) {
    nodeStream = stream;
  } else if (stream && typeof stream.getReader === "function") {
    nodeStream = Readable.fromWeb(stream);
  } else if (stream && Symbol.asyncIterator in Object(stream)) {
    nodeStream = Readable.from(stream);
  } else {
    throw new Error("Unsupported download stream type");
  }
  await pipeline(nodeStream, createWriteStream(filePath));
  return filePath;
}

/**
 * Map mime/type string to Baileys message key
 */
export function mimeToMessageKey(typeOrMime) {
  const t = (typeOrMime || "").toLowerCase();
  if (t.includes("image") || t === "image") return "imageMessage";
  if (t.includes("video") || t === "video") return "videoMessage";
  if (t.includes("audio") || t === "audio") return "audioMessage";
  if (t.includes("sticker") || t === "sticker") return "stickerMessage";
  if (t.includes("document") || t === "document") return "documentMessage";
  return null;
}

/**
 * Build a WAMessage-like object for downloadMediaMessage
 */
function buildDownloadable(message, source = "self") {
  if (source === "quoted" && message.quoted) {
    const q = message.quoted;
    const keyName =
      q.messageTypeKey || mimeToMessageKey(q.type || q.mimetype);
    if (!keyName) return null;

    const content =
      q.raw?.[keyName] ||
      (() => {
        const { type, messageTypeKey, raw, text, caption, ...rest } = q;
        return rest;
      })();

    return {
      key: {
        remoteJid: message.from,
        id: message.message?.contextInfo?.stanzaId || message.id,
        fromMe: false,
        participant: message.message?.contextInfo?.participant,
      },
      message: { [keyName]: content },
    };
  }

  const keyName =
    message.messageTypeKey || mimeToMessageKey(message.type);
  if (!keyName || !message.message) return null;

  // serialize stores inner content in message; wrap it
  const inner =
    message.rawMessage?.[keyName] ||
    (message.message?.[keyName] ? message.message[keyName] : message.message);

  return {
    key: message.key,
    message: { [keyName]: inner },
  };
}

/**
 * Download media from the message itself or a quoted message.
 * Returns { buffer, mimetype, type, filePath? } — caller should unlink filePath if set.
 */
export async function downloadQuotedOrSelf(conn, message, { preferQuoted = true } = {}) {
  const hasQuotedMedia =
    preferQuoted &&
    message.quoted &&
    ["image", "video", "audio", "sticker", "document"].includes(
      message.quoted.type
    );

  const useQuoted = hasQuotedMedia;
  const meta = useQuoted
    ? {
        type: message.quoted.type,
        mimetype: message.quoted.mimetype,
      }
    : {
        type: message.type,
        mimetype: message.message?.mimetype,
      };

  if (
    !["image", "video", "audio", "sticker", "document"].includes(meta.type)
  ) {
    return null;
  }

  const waMsg = buildDownloadable(message, useQuoted ? "quoted" : "self");
  if (!waMsg) return null;

  const buffer = await downloadMediaMessage(
    waMsg,
    "buffer",
    {},
    {
      logger: mediaLogger,
      reuploadRequest: conn.updateMediaMessage?.bind(conn),
    }
  );

  return {
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    mimetype: meta.mimetype || null,
    type: meta.type,
  };
}

/**
 * Assert size under cap; throws Error with friendly message
 */
export function assertSize(bytes, maxBytes, label = "File") {
  if (bytes > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw new Error(`${label} is too large (max ${mb}MB).`);
  }
}

export function assertAudioSize(bytes) {
  assertSize(bytes, MEDIA.MAX_AUDIO_BYTES, "Audio");
}

export function assertVideoSize(bytes) {
  assertSize(bytes, MEDIA.MAX_VIDEO_BYTES, "Video");
}

/**
 * Lazy fluent-ffmpeg wrapper — convert file with options
 */
export async function ffmpegConvert(inputPath, outputPath, optionsFn) {
  const ffmpeg = (await import("fluent-ffmpeg")).default;
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath);
    if (typeof optionsFn === "function") {
      cmd = optionsFn(cmd) || cmd;
    }
    cmd
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

/**
 * Convert media buffer/file to audio/mp3 via ffmpeg
 */
export async function toMp3(inputPath) {
  const out = createTempPath(".mp3");
  try {
    await ffmpegConvert(inputPath, out, (cmd) =>
      cmd.noVideo().audioCodec("libmp3lame").audioBitrate("128k").format("mp3")
    );
    return out;
  } catch (err) {
    await safeUnlink(out);
    throw err;
  }
}

/**
 * Run fn with temp cleanup of listed paths in finally
 */
export async function withTempFiles(pathsOrFactory, fn) {
  const paths = [];
  const track = (p) => {
    if (p) paths.push(p);
    return p;
  };
  try {
    if (typeof pathsOrFactory === "function") {
      return await fn(track);
    }
    paths.push(...(pathsOrFactory || []).filter(Boolean));
    return await fn(track);
  } finally {
    await Promise.all(paths.map(safeUnlink));
  }
}

/**
 * Format seconds as m:ss
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Extract YouTube video id from URL or return null
 */
export function extractYoutubeId(input) {
  if (!input) return null;
  const text = String(input).trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

