/**
 * Remote-control safeguard — the web dashboard's safety net, mirroring the
 * Onyx Mini ToS monitor:
 *
 *   • Every operator-tier web action carries a weight. A high rolling score
 *     first WARNS (system log + audit), then LOCKS that operator out of the
 *     action bus for a cooldown — like a mini being suspended.
 *   • Danger-sensitive actions additionally need an ARMED confirmation
 *     (single web confirm, enforced server-side with a short TTL) — the
 *     analogue of the mini suspend confirm.
 *   • Flags are persisted in BotKV under `rc_flags` (retention-capped like
 *     mini flags) and surfaced on the dashboard's Remote panel; every
 *     warn/lock is audited, logged, and DM'd to the creators.
 *
 * Operators accumulate score; the creator tier is trusted (still audited).
 *
 * Env knobs:
 *   RC_MONITOR            = "off" to disable scoring (default on)
 *   RC_FLAG_WARN          = score that logs a warn (default 30)
 *   RC_FLAG_LOCK          = score that locks the operator out (default 80)
 *   RC_FLAG_WINDOW_MS     = rolling score window (default 300000 = 5 min)
 *   RC_FLAG_LOCKOUT_MS    = how long the lock lasts (default 600000 = 10 min)
 *   RC_FLAG_RETENTION_DAYS= flag record retention (default 30)
 */

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

/**
 * Weight per action — how "risky" an operator using it is. Actions missing
 * from the map are read-only inspective ones (weight 0, never scored).
 */
const RC_WEIGHTS = {
  "main.reconnect": 25,
  "minis.remove": 20,
  "boot.restart": 0, // reserved
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
  "roles.set": 0, // creator-only anyway
  "relink": 0, // creator-only
  "git.update": 0, // creator-only
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

/** Actions an operator must explicitly arm before they run. */
export const CONFIRM_REQUIRED = new Set([
  "main.reconnect",
  "minis.remove",
]);

/** Actions the creator may run directly; operator gets the confirm+monitor path. */
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

/**
 * Config keys an operator may change through `config.set` (compared
 * lower-case). Everything else is creator-only.
 */
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

/** In-memory rolling state per actor. */
const state = new Map(); // actor -> { scoreWindow: [{ts,w}], lockedUntil, lastWarnAt, armed: Map<action,ts> , flagIdSeq }

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
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

/**
 * Score + arm-check an operator web action.
 * @returns {Promise<{ok:boolean, score:number, threshold:number, warn?:boolean,
 *           locked?:boolean, needArm?:boolean, action:string, hint?:string}>}
 */
export async function guardRcAction(actor, action, meta = {}) {
  const weight = RC_WEIGHTS[action] ?? 0;
  const now = Date.now();
  const s = getState(actor);

  if (!CFG.enabled || weight <= 0) {
    return { ok: true, score: 0, threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs }, locked: false, action };
  }

  // Locked? No more actions until the cooldown ends.
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
    } catch { /* audit best effort */ }
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
    } catch { /* audit best effort */ }
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      await systemLog("warn", `🔒 [RC] *${action}* by ${actor} — score ${score} ≥ ${CFG.lock}, remote-control locked`, `web operator cooldown ${Math.round(CFG.lockoutMs / 60000)} min`);
    } catch { /* ignore */ }
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
    } catch { /* audit best effort */ }
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      await systemLog("warn", `⚠️ [RC] *${action}* by ${actor} — score ${score}/${CFG.warn}`, "web operator watch");
    } catch { /* ignore */ }
  }

  return { ok: true, score, threshold: { warn: CFG.warn, lock: CFG.lock, windowMs: CFG.windowMs }, locked: false, action };
}

/** Explicit arm (confirm) for a danger-sensitive action. 90 s TTL. */
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

/** Reset an actor's lock + score but keep audit trail of what happened. */
export function resetRcActor(actor) {
  const s = getState(actor);
  s.scoreWindow = [];
  s.lockedUntil = 0;
  s.lastWarnAt = 0;
}

/** Drop rc flag records for an actor (`id` = one record, "all" = everything). */
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

/** Live rc-monitor status for the dashboard / chat. */
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