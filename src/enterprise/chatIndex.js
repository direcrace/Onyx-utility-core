

import { kvGet, kvSet } from "../database/botKv.js";
import { groupCache } from "../utils/cache.js";

const KEY = "chat_index";
const CFG = {
  max: Math.max(25, Number(process.env.CHAT_INDEX_MAX) || 250),
  retentionMs: Math.max(1, Number(process.env.CHAT_INDEX_RETENTION) || 10) * 86_400_000,
};

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
  } catch {  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const list = [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, CFG.max);
      await kvSet(KEY, list);
    } catch {  }
  }, 800);
}

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
  } catch {  }
}

const GROUP_SYNC_MS = 60_000;
let lastGroupSync = 0;

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
    lastGroupSync = 0;
    return 0;
  }
}

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
  } catch {  }
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

export async function findChat(ref) {
  await load();
  const q = String(ref || "").replace(/\D/g, "");
  if (!q) return null;
  for (const [jid, e] of map) {
    if (jid.startsWith(q)) return { ...e, number: numberFromJid(jid) };
  }
  return null;
}

export function lookupName(jid) {
  const j = String(jid || "");
  if (!j) return null;
  const e = map.get(j);
  if (e?.name) return e.name;
  if (j.endsWith("@g.us")) {
    try { return groupCache.get(j)?.subject || null; } catch {  }
  }
  return null;
}