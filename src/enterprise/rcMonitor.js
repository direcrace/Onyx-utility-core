

import { kvGet, kvSet } from "../database/botKv.js";

const FLAGS_KEY = "rc_flags";
const ARM_TTL_MS = 90_000;

const CFG = {
  enabled: (process.env.RC_MONITOR || "on").toLowerCase() !== "off",
  warn: Number(process.env.RC_FLAG_WARN) || 30,
  lock: Number(process.env.RC_FLAG_LOCK) || 80,
  windowMs: Math.max(10_000, Number(process.env.RC_FLAG_WINDOW_MS) || 300_000),
  lockoutMs: Math.max(10_000, Number(process.env.RC_FLAG_LOCKOUT_MS) || 600_000),
  retentionMs:
    Math.max(1, Number(process.env.RC_FLAG_RETENTION_DAYS) || 30) * 86_400_000,
};

const RC_WEIGHTS = {
  "main.reconnect": 25,
  "minis.remove": 20,
  "boot.restart": 0,
  "minis.suspend": 10,
  "minis.respawn": 8,
  "minis.unsuspend": 4,
  "minis.list": 0,
  "flags.clear": 6,
  "flags.list": 0,
  "mode.set": 10,
  "flags.set": 6,
  "bans.add": 15,
  "bans.remove": 10,
  "bans.list": 0,
  "queue.pause": 10,
  "queue.resume": 4,
  "send.test": 4,
  "send.chat": 12,
  "chats.list": 0,
  "messages.recent": 0,
  "config.set": 8,
  "syswatch.set": 3,
  "backup.now": 2,
  "pair.request": 8,
  "roles.list": 0,
  "roles.set": 0,
  "relink": 0,
  "git.update": 0,
  "invite.create": 2,
  "invite.list": 0,
  "invite.revoke": 2,
  "status": 0,
  "logs.tail": 0,
  "userflags.list": 0,
  "rc.status": 0,
  "rc.clear": 0,
  "rc.arm": 0,
};

export const CONFIRM_REQUIRED = new Set([
  "main.reconnect",
  "minis.remove",
]);

export const CREATOR_ONLY_ACTIONS = new Set([
  "reboot",
  "shutdown",
  "panic.test",
  "dev.term",
  "relink",
  "git.update",
  "roles.set",
  "invite.create",
  "invite.list",
  "invite.revoke",
]);

export const OPERATOR_CONFIG_KEYS = new Set([
  "prefix",
  "botname",
  "mode",
  "lang",
  "quiethoursstart",
  "quiethoursend",
  "maxwarns",
  "allowmediacommands",
  "allowlinksingroups",
  "ratelimitperuser",
  "blockbroadcast",
]);

const state = new Map();

let flagIdSeq = 0;

function getState(actor) {
  let s = state.get(actor);
  if (!s) {
    s = { scoreWindow: [], lockedUntil: 0, lastWarnAt: 0, armed: new Map() };
    state.set(actor, s);
  }
  return s;
}

function newFlagId() {
  flagIdSeq = (flagIdSeq + 1) % 1_000_000;
  return `rc-${Date.now().toString(36)}-${flagIdSeq.toString(36)}`;
}

function pruneWindow(s, now) {
  s.scoreWindow = s.scoreWindow.filter((e) => e.ts > now - CFG.windowMs);
}

async function loadFlags() {
  const data = await kvGet(FLAGS_KEY);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

async function saveFlags(store) {
  await kvSet(FLAGS_KEY, store);
}

function purgeRecords(list) {
  const cut = Date.now() - CFG.retentionMs;
  return (Array.isArray(list) ? list : []).filter((r) => {
    const ts = Number(r?.ts) || 0;
    return ts > cut && r?.id;
  });
}

async function addFlag(actor, action, weight, reason) {
  const store = await loadFlags();
  const list = purgeRecords(store[actor] || []);
  list.push({
    id: newFlagId(),
    ts: Date.now(),
    scope: "rc",
    action,
    weight,
    reason: String(reason || action).slice(0, 180),
    resolved: false,
  });
  store[actor] = list;
  await saveFlags(store);
}

async function notifyCreators(text) {
  try {
    const { getConnection } = await import("../socket/connection.js");
    const conn = getConnection();
    if (!conn || conn.__isSub) return;
    const { getCreatorNumbers } = await import("../utils/access.js");
    const { BOT_INFO } = await import("../config/constants.js");
    for (const num of getCreatorNumbers()) {
      try {
        await conn.sendMessage(`${num}@s.whatsapp.net`, {
          text: `🚨 *${BOT_INFO.NAME}* · remote-control watch\n\n${text}`,
        });
      } catch {  }
    }
  } catch {  }
}

export async function guardRcAction(actor, action, meta = {}) {
  const weight = RC_WEIGHTS[action] ?? 0;
  const now = Date.now();
  const s = getState(actor);

  if (!CFG.enabled || weight <= 0) {
    return { ok: true, score: 0, threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs }, locked: false, action };
  }

  if (s.lockedUntil > now) {
    try {
      const { writeAudit } = await import("./audit.js");
      await writeAudit({
        action: "rc:locked-attempt",
        actor,
        target: action,
        chat: null,
        meta: { ...meta, source: "web" },
      });
    } catch {  }
    return {
      ok: false,
      locked: true,
      score: s.scoreWindow.reduce((a, e) => a + e.w, 0),
      threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs },
      lockRemainingMs: s.lockedUntil - now,
      action,
      hint: `📛 Remote-control lock: you're in a cooldown for ${Math.ceil((s.lockedUntil - now) / 60000)} min. What you did is logged and visible to the creator. 👀`,
    };
  }

  pruneWindow(s, now);
  s.scoreWindow.push({ ts: now, w: weight });
  pruneWindow(s, now);
  const score = s.scoreWindow.reduce((a, e) => a + e.w, 0);

  if (score >= CFG.lock) {
    s.lockedUntil = now + CFG.lockoutMs;
    await addFlag(actor, action, weight, `score ${score} ≥ ${CFG.lock} → locked ${Math.round(CFG.lockoutMs / 60000)} min`);
    try {
      const { writeAudit } = await import("./audit.js");
      const { snapshotLog } = await import("./messageLog.js");
      await writeAudit({ action: "rc:lock", actor, target: action, chat: null, meta: { score, ...meta, source: "web", recent: await snapshotLog() } });
    } catch {  }
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      await systemLog("warn", `🔒 [RC] *${action}* by ${actor} — score ${score} ≥ ${CFG.lock}, remote-control locked`, `web operator cooldown ${Math.round(CFG.lockoutMs / 60000)} min`);
    } catch {  }
    await notifyCreators(`Operator *${actor}* ran *${action}* — rc score ${score}/${CFG.lock}. Locked out of the dashboard controls for ${Math.round(CFG.lockoutMs / 60000)} min. Oversight power is yours.`);
    return {
      ok: false,
      locked: true,
      score,
      threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs },
      lockRemainingMs: CFG.lockoutMs,
      action,
      hint: "📛 That action pushed the remote-control score over the limit — controls are locked for 10 min. Everything you did is logged and visible. 👀",
    };
  }

  if (score >= CFG.warn && s.lastWarnAt < now - CFG.windowMs) {
    s.lastWarnAt = now;
    await addFlag(actor, action, weight, `score ${score} in window`);
    try {
      const { writeAudit } = await import("./audit.js");
      const { snapshotLog } = await import("./messageLog.js");
      await writeAudit({ action: "rc:warn", actor, target: action, chat: null, meta: { score, ...meta, source: "web", recent: await snapshotLog() } });
    } catch {  }
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      await systemLog("warn", `⚠️ [RC] *${action}* by ${actor} — score ${score}/${CFG.warn}`, "web operator watch");
    } catch {  }
  }

  return { ok: true, score, threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs }, locked: false, action };
}

export function armRcAction(actor, action) {
  const s = getState(actor);
  s.armed.set(action, Date.now() + ARM_TTL_MS);
  return { ok: true, armedUntil: Date.now() + ARM_TTL_MS };
}

export function isRcArmed(actor, action) {
  const s = getState(actor);
  const until = s.armed.get(action) || 0;
  if (until <= Date.now()) {
    s.armed.delete(action);
    return false;
  }
  return true;
}

export function resetRcActor(actor) {
  const s = getState(actor);
  s.scoreWindow = [];
  s.lockedUntil = 0;
  s.lastWarnAt = 0;
}

export async function clearRcFlags(actor, id) {
  const store = await loadFlags();
  if (id && id !== "all") {
    store[actor] = (store[actor] || []).filter((r) => r.id !== id);
  } else {
    delete store[actor];
  }
  await saveFlags(store);
  return actor;
}

export async function getRcMonitor() {
  const store = await loadFlags();
  const actors = new Set([...state.keys(), ...Object.keys(store)]);
  const out = [];
  for (const actor of actors) {
    const s = state.get(actor);
    const recs = purgeRecords(store[actor] || []);
    const score = s
      ? s.scoreWindow.filter((e) => e.ts > Date.now() - CFG.windowMs).reduce((a, e) => a + e.w, 0)
      : 0;
    out.push({
      actor,
      score,
      threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs },
      locked: !!(s && s.lockedUntil > Date.now()),
      lockedUntil: s?.lockedUntil || 0,
      openFlags: recs.filter((r) => !r.resolved).length,
      totalFlags: recs.length,
      records: recs.slice(-20),
    });
  }
  out.sort((a, b) => Number(b.locked) - Number(a.locked) || b.score - a.score);
  return {
    enabled: CFG.enabled,
    thresholds: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs, lockoutMs: CFG.lockoutMs },
    retentionDays: Math.round(CFG.retentionMs / 86_400_000),
    actors: out,
  };
}