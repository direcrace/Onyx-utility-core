

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "../utils/access.js";
import { appendLogLine, getLogDir, iso, quoted, safePrefix } from "./logFile.js";
import { isCaptureAtLeast } from "./logCapture.js";

const KEY = "audit_log";
const MAX = 500;

let ring = null;

function auditPrefix() {
  return safePrefix(process.env.AUDIT_LOG_PREFIX, "audit");
}

function formatFileLine(row) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const parts = [
    `[${iso(row.ts)}]`,
    String(row.action || "unknown"),
    `actor=${row.actor || "unknown"}`,
    `target=${row.target || "-"}`,
    `chat=${row.chat || "-"}`,
  ];
  if (meta.groupName) parts.push(`group=${quoted(meta.groupName)}`);
  if (meta.reason) parts.push(`reason=${quoted(meta.reason)}`);
  if (meta.body) parts.push(`body=${quoted(meta.body)}`);
  if (meta.messageId) parts.push(`messageId=${meta.messageId}`);
  if (row.id) parts.push(`id=${row.id}`);
  if (Object.keys(meta).length) parts.push(`meta=${JSON.stringify(meta)}`);
  return parts.join(" | ") + "\n";
}

async function appendPlaintext(row, { force = false } = {}) {
  if (!force) {
    try {
      if (!(await isCaptureAtLeast("audit"))) return;
    } catch {  }
  }
  return appendLogLine(auditPrefix(), row.ts, formatFileLine(row));
}

export function getAuditLogDir() {
  return getLogDir();
}

export async function appendAuditFile(entry) {
  return appendPlaintext(
    {
      ts: entry?.ts || Date.now(),
      action: String(entry?.action || "unknown"),
      actor: normalizeNumber(entry?.actor) || entry?.actor || "unknown",
      target: entry?.target || null,
      chat: entry?.chat || null,
      meta: entry?.meta || null,
      id: entry?.id || `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    },
    { force: true }
  );
}

export function auditMessage(message, { action, target = null, reason = null, meta = {} } = {}) {
  return writeAudit({
    action,
    actor: message?.sender || null,
    target,
    chat: message?.from || null,
    meta: {
      ...meta,
      reason: reason || meta.reason || null,
      body: String(message?.body || "").slice(0, 400),
      messageId: message?.key?.id || message?.id || null,
      group: message?.isGroup ? message.from : null,
      senderName: message?.pushName || null,
    },
  }).catch(() => {});
}

async function load() {
  if (ring) return ring;
  const stored = await kvGet(KEY);
  ring = Array.isArray(stored) ? stored.slice(-MAX) : [];
  return ring;
}

async function persist() {
  await kvSet(KEY, ring.slice(-MAX));
}

export async function writeAudit(entry) {
  const row = {
    id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    action: String(entry.action || "unknown"),
    actor: normalizeNumber(entry.actor) || entry.actor || "unknown",
    target: entry.target || null,
    chat: entry.chat || null,
    meta: entry.meta || null,
  };

  try {
    const list = await load();
    list.push(row);
    if (list.length > MAX) list.splice(0, list.length - MAX);
    ring = list;
    persist().catch(() => {});
  } catch (err) {
    console.error("[audit] db write failed:", err?.message || err);
  }

  appendPlaintext(row);
  return row;
}

export async function queryAudit({ limit = 20, action, actor } = {}) {
  const list = await load();
  let out = list.slice().reverse();
  if (action) {
    const a = action.toLowerCase();
    out = out.filter((e) => e.action.toLowerCase().includes(a));
  }
  if (actor) {
    const n = normalizeNumber(actor);
    out = out.filter((e) => e.actor === n || String(e.actor).includes(actor));
  }
  return out.slice(0, Math.min(100, limit));
}

export async function clearAudit() {
  ring = [];
  await kvSet(KEY, []);
}
