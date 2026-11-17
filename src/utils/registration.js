import { kvGet, kvSet } from "../database/botKv.js";

const KEY = "community:registered";
const COOLDOWN_KEY = "community:registerCooldown";

export const RE_REGISTER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function norm(number) {
  return String(number || "").replace(/\D/g, "");
}

async function readMap() {
  const map = await kvGet(KEY);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

async function readCooldowns() {
  const map = await kvGet(COOLDOWN_KEY);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export async function getRegistration(number) {
  const n = norm(number);
  if (!n) return null;
  const map = await readMap();
  return map[n] || null;
}

export async function isRegistered(number) {
  return !!(await getRegistration(number));
}

export async function listRegistrations() {
  const map = await readMap();
  return Object.values(map).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export async function getCooldown(number) {
  const n = norm(number);
  if (!n) return null;
  const map = await readCooldowns();
  const rec = map[n];
  if (!rec) return null;
  if (Date.now() >= rec.until) {
    delete map[n];
    await kvSet(COOLDOWN_KEY, map);
    return null;
  }
  return { since: rec.since || 0, until: rec.until, remaining: rec.until - Date.now() };
}

export async function registerUser(number, { name, terms = null, privacy = null, sender = null } = {}) {
  const n = norm(number);
  if (!n) throw new Error("Invalid number");

  const cd = await getCooldown(n);
  if (cd) {
    const err = new Error("COOLDOWN");
    err.until = cd.until;
    err.remaining = cd.remaining;
    throw err;
  }

  const map = await readMap();
  const rec = {
    number: n,
    name: String(name || "").trim().slice(0, 32),
    ts: Date.now(),
    terms,
    privacy,
    sender: sender ? norm(sender) : null,
  };
  map[n] = rec;
  await kvSet(KEY, map);
  return rec;
}

export async function unregisterUser(number) {
  const n = norm(number);
  if (!n) throw new Error("Invalid number");

  const map = await readMap();
  const existed = !!map[n];
  if (existed) {
    delete map[n];
    await kvSet(KEY, map);
  }

  const cds = await readCooldowns();
  const now = Date.now();
  cds[n] = { since: now, until: now + RE_REGISTER_COOLDOWN_MS };
  await kvSet(COOLDOWN_KEY, cds);
  return existed;
}
