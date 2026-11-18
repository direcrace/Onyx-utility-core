import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const KEY = "community:stats";
const MAX_USERS = 5000;

// XP is the existing `points` accumulator (1/message, 2/command, 4/ticket,
// 6/report, 8/helpful). 100 XP = one member level. These are display titles
// only — they never grant staff permissions.
export const XP_PER_LEVEL = 100;

export const MEMBER_TIERS = [
  { name: "Newcomer", minLevel: 1 },
  { name: "Member", minLevel: 3 },
  { name: "Regular", minLevel: 6 },
  { name: "Veteran", minLevel: 11 },
  { name: "Legend", minLevel: 21 },
];

export function levelFromXp(xp) {
  const value = Math.max(0, Number(xp) || 0);
  return Math.floor(value / XP_PER_LEVEL) + 1;
}

export function memberTier(levelOrXp) {
  const level = Math.max(1, Number(levelOrXp) || 1);
  let name = MEMBER_TIERS[0].name;
  for (const tier of MEMBER_TIERS) {
    if (level >= tier.minLevel) name = tier.name;
  }
  return name;
}

const FIELDS = {
  message: "messages",
  command: "commands",
  report: "reports",
  ticket: "tickets",
  helpful: "helpful",
};

const POINTS = {
  message: 1,
  command: 2,
  report: 6,
  ticket: 4,
  helpful: 8,
};

function norm(number) {
  return normalizeNumber(number) || String(number || "").replace(/\D/g, "");
}

async function readMap() {
  const map = await kvGet(KEY);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

function blank(number, now) {
  return {
    number,
    messages: 0,
    commands: 0,
    reports: 0,
    tickets: 0,
    helpful: 0,
    points: 0,
    firstAt: now,
    lastAt: now,
    lastCommand: null,
    lastChat: null,
  };
}

export async function recordUserActivity(number, { kind = "message", command = null, chat = null, amount = 1 } = {}) {
  const n = norm(number);
  if (!n) return null;

  const field = FIELDS[kind] || "commands";
  const step = Math.max(1, Math.min(100, Number(amount) || 1));
  const now = Date.now();
  const map = await readMap();
  const rec = map[n] || blank(n, now);

  rec[field] = (rec[field] || 0) + step;
  rec.points = (rec.points || 0) + (POINTS[kind] || POINTS.command) * step;
  rec.lastAt = now;
  if (command) rec.lastCommand = String(command).slice(0, 64);
  if (chat) rec.lastChat = String(chat).slice(0, 128);

  map[n] = rec;

  const keys = Object.keys(map);
  if (keys.length > MAX_USERS) {
    keys
      .sort((a, b) => (map[a].lastAt || 0) - (map[b].lastAt || 0))
      .slice(0, keys.length - MAX_USERS)
      .forEach((old) => delete map[old]);
  }

  await kvSet(KEY, map);
  return rec;
}

export async function getUserStats(number) {
  const n = norm(number);
  if (!n) return null;
  const map = await readMap();
  return map[n] || null;
}

export async function getUserLevel(number) {
  const stats = await getUserStats(number);
  return levelFromXp(stats?.points || 0);
}

export async function getUserTier(number) {
  return memberTier(await getUserLevel(number));
}

export async function getLeaderboard({ limit = 10, sortBy = "points" } = {}) {
  const field = FIELDS[sortBy] ? sortBy : "points";
  const map = await readMap();
  return Object.values(map)
    .filter((rec) => rec && rec.number)
    .sort((a, b) => {
      const diff = (b[field] || 0) - (a[field] || 0);
      return diff || (b.commands || 0) - (a.commands || 0) || (a.number || "").localeCompare(b.number || "");
    })
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 10)));
}

export async function deleteUserStats(number) {
  const n = norm(number);
  if (!n) return false;
  const map = await readMap();
  if (!map[n]) return false;
  delete map[n];
  await kvSet(KEY, map);
  return true;
}

export const resetUserStats = deleteUserStats;
