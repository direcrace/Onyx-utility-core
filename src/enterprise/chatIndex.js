/**
 * Chat index — a lightweight, rolling list of the MAIN bot's recent
 * conversations (DMs + groups), used by the dashboard Remote "send as bot"
 * composer. Pure convenience: chats are harvested from the messages the bot
 * sees (incoming + outgoing), capped and persisted to BotKV so the picker
 * survives restarts.
 *
 *   chat_index   BotKV payload: array of { jid, kind, name, ts }
 *   CHAT_INDEX_MAX        cap on retained chats (default 250)
 *   CHAT_INDEX_RETENTION  prune older than this many days (default 10)
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { groupCache } from "../utils/cache.js";

const KEY = "chat_index";
const CFG = {
  max: Math.max(25, Number(process.env.CHAT_INDEX_MAX) || 250),
  retentionMs: Math.max(1, Number(process.env.CHAT_INDEX_RETENTION) || 10) * 86_400_000,
};

/** jid → { jid, kind: "dm"|"group", name, ts } (MRU). */
const map = new Map();
let loaded = false;
let saveTimer = null;

export function kindOf(jid) {
  const s = String(jid || "");
  if (s.endsWith("@g.us")) return "group";
  if (s.endsWith("@broadcast")) return "broadcast";
  return "dm";
}

function numberFromJid(jid) {
  return String(jid || "").split("@")[0];
}

function prune() {
  const cut = Date.now() - CFG.retentionMs;
  for (const [jid, e] of map) {
    if (e.ts < cut) map.delete(jid);
  }
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const data = await kvGet(KEY);
    if (Array.isArray(data)) {
      for (const e of data) {
        if (typeof e?.jid !== "string" || !e.jid) continue;
        map.set(e.jid, { jid: e.jid, kind: e.kind || kindOf(e.jid), name: e.name || null, ts: Number(e.ts) || 0 });
      }
      prune();
    }
  } catch { /* best effort */ }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const list = [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, CFG.max);
      await kvSet(KEY, list);
    } catch { /* best effort */ }
  }, 800);
}

/** Record a chat that just had activity (usually from messages.upsert). */
export async function recordChat(entry) {
  const jid = String(entry?.jid || "");
  if (!jid || jid === "status@broadcast") return null;
  const prev = map.get(jid);
  const next = {
    jid,
    kind: entry?.kind || kindOf(jid),
    name: entry?.name || prev?.name || null,
    ts: entry?.ts || Date.now(),
  };
  map.set(jid, next);
  if (map.size > CFG.max * 2) {
    const sorted = [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, CFG.max);
    map.clear();
    for (const e of sorted) map.set(e.jid, e);
  }
  scheduleSave();
  return next;
}

/**
 * Best-effort harvest from a raw Baileys message. Uses the group metadata
 * cache for group subjects and pushName for contact DMs.
 */
export async function recordChatFromMessage(msg) {
  try {
    const jid = msg?.key?.remoteJid;
    if (!jid || jid === "status@broadcast") return;
    let name = null;
    if (kindOf(jid) === "dm") {
      name = msg?.pushName || null;
    } else {
      const meta = groupCache.get(jid);
      name = meta?.subject || null;
    }
    await recordChat({ jid, kind: kindOf(jid), name, ts: Date.now() });
  } catch { /* best effort */ }
}

/** MRU chat list for the composer dropdown. */
const GROUP_SYNC_MS = 60_000;
let lastGroupSync = 0;

/**
 * Enumerate EVERY group + community the main account participates in
 * (`groupFetchAllParticipating` → all @g.us jids; communities and their
 * sub-groups are @g.us too, so they're all covered — not just chats that
 * happened to produce a message recently). Subjects come from the metadata.
 * Throttled to one sync per minute unless forced (connection open / refresh).
 */
export async function syncGroups(conn, force = false) {
  try {
    if (!conn?.groupFetchAllParticipating) return 0;
    const now = Date.now();
    if (!force && lastGroupSync && now - lastGroupSync < GROUP_SYNC_MS) return 0;
    lastGroupSync = now;
    const groups = await conn.groupFetchAllParticipating();
    let n = 0;
    for (const [jid, meta] of Object.entries(groups || {})) {
      if (!String(jid || "").endsWith("@g.us")) continue;
      await recordChat({ jid, kind: "group", name: meta?.subject || null, ts: now });
      n++;
    }
    return n;
  } catch {
    lastGroupSync = 0; // allow a retry next window instead of wedging
    return 0;
  }
}

/**
 * Feed from Baileys `chats.upsert` / `contacts.upsert`: keeps group renames,
 * broadcast lists, and DM names fresh without waiting for a new message.
 */
export async function recordChatMeta(jid, meta = {}) {
  try {
    const j = String(jid || "");
    if (!j || j === "status@broadcast") return;
    await recordChat({
      jid: j,
      kind: kindOf(j),
      name: meta?.name || meta?.notify || meta?.pushName || meta?.verifiedName || null,
      ts: Date.now(),
    });
  } catch { /* best effort */ }
}

export async function listChats({ n = 60 } = {}) {
  await load();
  return [...map.values()]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.max(1, Math.min(Number(n) || 60, CFG.max)))
    .map((c) => ({
      jid: c.jid,
      kind: c.kind,
      name:
        c.name ||
        (c.kind === "group" ? groupCache.get(c.jid)?.subject || null : null),
      number: numberFromJid(c.jid),
      ts: c.ts,
    }));
}

/** Search the index by number or jid fragment for a direct pick. */
export async function findChat(ref) {
  await load();
  const q = String(ref || "").replace(/\D/g, "");
  if (!q) return null;
  for (const [jid, e] of map) {
    if (jid.startsWith(q)) return { ...e, number: numberFromJid(jid) };
  }
  return null;
}

/** Sync, best-effort display name for a jid (index name or group subject). */
export function lookupName(jid) {
  const j = String(jid || "");
  if (!j) return null;
  const e = map.get(j);
  if (e?.name) return e.name;
  if (j.endsWith("@g.us")) {
    try { return groupCache.get(j)?.subject || null; } catch { /* ignore */ }
  }
  return null;
}