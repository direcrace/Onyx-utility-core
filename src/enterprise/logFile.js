

import fs from "fs/promises";
import path from "path";

let cachedDir = null;
let dirReady = null;
let fileQueue = Promise.resolve();

export function getLogDir() {
  if (!cachedDir) cachedDir = path.resolve(process.env.AUDIT_LOG_DIR || "logs");
  return cachedDir;
}

export function iso(ts) {
  try {
    return new Date(ts || Date.now()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export function oneLine(value) {
  return String(value ?? "").replace(/\r?\n/g, "\\n");
}

export function quoted(value) {
  return JSON.stringify(oneLine(value));
}

export function safePrefix(value, fallback = "log") {
  const cleaned = String(value || fallback)
    .replace(/[^a-z0-9_.-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

export function logFileFor(prefix, ts) {
  return path.join(getLogDir(), `${safePrefix(prefix)}-${iso(ts).slice(0, 10)}.log`);
}

export function appendLogLine(prefix, ts, line) {
  const file = logFileFor(prefix, ts);
  fileQueue = fileQueue
    .then(async () => {
      if (!dirReady) dirReady = fs.mkdir(getLogDir(), { recursive: true });
      await dirReady;
      await fs.appendFile(file, line, "utf8");
    })
    .catch((err) => {
      dirReady = null;
      console.error(`[logs] ${safePrefix(prefix)} write failed:`, err?.message || err);
    });
  return fileQueue;
}
