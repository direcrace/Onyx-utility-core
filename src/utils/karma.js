import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const KEY = "community:thanks";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

function norm(number) {
  return normalizeNumber(number) || String(number || "").replace(/\D/g, "");
}

async function readEntries() {
  const raw = await kvGet(KEY);
  return Array.isArray(raw) ? raw.filter((e) => e && e.from && e.to && e.ts) : [];
}

async function writeEntries(entries) {
  await kvSet(KEY, entries.slice(-MAX_ENTRIES));
}

export async function giveThanks(from, to) {
  const a = norm(from);
  const b = norm(to);
  if (!a || !b) return { ok: false, error: "invalid" };
  if (a === b) return { ok: false, error: "self" };

  const now = Date.now();
  let entries = await readEntries();
  const last = entries.find((e) => e.from === a && e.to === b && now - e.ts < COOLDOWN_MS);
  if (last) {
    const hours = Math.ceil((COOLDOWN_MS - (now - last.ts)) / (60 * 60 * 1000));
    return { ok: false, error: "cooldown", hours };
  }

  entries = entries.filter((e) => now - e.ts < KEEP_MS);
  entries.push({ from: a, to: b, ts: now });
  await writeEntries(entries);
  return { ok: true, count: entries.filter((e) => e.to === b).length };
}

export async function getThanksEntriesFor(number) {
  const n = norm(number);
  if (!n) return [];
  const entries = await readEntries();
  return entries.filter((e) => e.from === n || e.to === n);
}

export async function getThanksStats(number) {
  const n = norm(number);
  if (!n) return { given: 0, received: 0, week: 0 };
  const entries = await readEntries();
  const now = Date.now();
  return {
    given: entries.filter((e) => e.from === n).length,
    received: entries.filter((e) => e.to === n).length,
    week: entries.filter((e) => e.to === n && now - e.ts < WEEK_MS).length,
  };
}

export async function getTopHelpers(limit = 10) {
  const entries = await readEntries();
  const now = Date.now();
  const counts = new Map();
  for (const e of entries) {
    if (now - e.ts >= WEEK_MS) continue;
    counts.set(e.to, (counts.get(e.to) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([number, count]) => ({ number, count }))
    .sort((a, b) => b.count - a.count || a.number.localeCompare(b.number))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 10)));
}

export async function deleteThanksFor(number) {
  const n = norm(number);
  if (!n) return 0;
  const entries = await readEntries();
  const kept = entries.filter((e) => e.from !== n && e.to !== n);
  await writeEntries(kept);
  return entries.length - kept.length;
}
