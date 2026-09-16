

import { kvGet, kvSet } from "../database/botKv.js";
import { getGroupSettings } from "../utils/groupSettings.js";

const KEY = "policies";

const GLOBAL_DEFAULTS = {
  quietHoursStart: null,
  quietHoursEnd: null,
  maxWarns: 3,
  allowMediaCommands: true,
  allowLinksInGroups: true,
  rateLimitPerUser: 20,
  blockBroadcast: false,
};

let cache = null;

async function loadGlobal() {
  if (cache) return cache;
  const stored = await kvGet(KEY);
  cache = { ...GLOBAL_DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  return cache;
}

export async function getPolicies() {
  return { ...(await loadGlobal()) };
}

export async function setPolicy(key, value) {
  const p = await loadGlobal();
  p[key] = value;
  cache = p;
  await kvSet(KEY, p);
  return p;
}

function inQuietHours(policy) {
  const start = policy.quietHoursStart;
  const end = policy.quietHoursEnd;
  if (!start || !end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const parse = (s) => {
    const [h, m] = String(s).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const a = parse(start);
  const b = parse(end);
  if (a === b) return false;
  if (a < b) return cur >= a && cur < b;

  return cur >= a || cur < b;
}

const buckets = new Map();

function rateLimited(userKey, limit) {
  if (!limit || limit <= 0) return false;
  const now = Date.now();
  let arr = buckets.get(userKey) || [];
  arr = arr.filter((t) => now - t < 60_000);
  arr.push(now);
  buckets.set(userKey, arr);
  return arr.length > limit;
}

export async function evaluatePolicy(message, command, { privileged = false } = {}) {
  const policy = await loadGlobal();
  const name = (command.patternName || "").toLowerCase();

  if (privileged) {

  }

  if (!privileged && inQuietHours(policy)) {

    const allow = new Set(["menu", "help", "ping", "status", "mode", "setup"]);
    if (!allow.has(name)) {
      return { ok: false, reason: "QUIET_HOURS" };
    }
  }

  if (policy.blockBroadcast && name === "broadcast") {
    return { ok: false, reason: "BROADCAST_BLOCKED" };
  }

  if (!policy.allowMediaCommands) {
    const mediaish = [
      "ytmp3",
      "ytmp4",
      "play",
      "sticker",
      "s",
      "ig",
      "tiktok",
      "fb",
      "tomp3",
    ];
    if (mediaish.includes(name) && !privileged) {
      return { ok: false, reason: "MEDIA_DISABLED" };
    }
  }

  if (!privileged) {
    const userKey = `${message.from}:${message.sender}`;
    if (rateLimited(userKey, policy.rateLimitPerUser)) {
      return { ok: false, reason: "RATE_LIMIT" };
    }
  }

  if (message.isGroup && policy.maxWarns) {
    try {
      const gs = await getGroupSettings(message.from);
      if (gs.warnLimit !== policy.maxWarns) {

      }
    } catch {

    }
  }

  return { ok: true, policy };
}
