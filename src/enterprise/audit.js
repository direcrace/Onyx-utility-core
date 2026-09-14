/**
 * Append-only audit log (memory ring + BotKV snapshot)
 * Queried only from system log group / admin HTTP.
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "../utils/access.js";

const KEY = "audit_log";
const MAX = 500;

/** @type {Array<object>} */
let ring = null;

async function load() {
  if (ring) return ring;
  const stored = await kvGet(KEY);
  ring = Array.isArray(stored) ? stored.slice(-MAX) : [];
  return ring;
}

async function persist() {
  await kvSet(KEY, ring.slice(-MAX));
}

/**
 * @param {{ action, actor, target?, chat?, meta? }} entry
 */
export async function writeAudit(entry) {
  const list = await load();
  const row = {
    id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    action: String(entry.action || "unknown"),
    actor: normalizeNumber(entry.actor) || entry.actor || "unknown",
    target: entry.target || null,
    chat: entry.chat || null,
    meta: entry.meta || null,
  };
  list.push(row);
  if (list.length > MAX) list.splice(0, list.length - MAX);
  ring = list;
  // Persist async — don't block hot path hard
  persist().catch(() => {});
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
