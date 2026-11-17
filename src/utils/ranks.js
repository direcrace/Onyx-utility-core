
import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const RANKS_KEY = "community:ranks";

export const RANKS = [
  "user",
  "admin",
  "mod",
  "team",
  "co-owner",
  "owner",
];

export const RANK_LEVELS = {
  user: 1,
  admin: 2,
  mod: 3,
  team: 4,
  "co-owner": 5,
  owner: 6,
};

export const ASSIGNABLE_RANKS = [
  "user",
  "admin",
  "mod",
  "team",
  "co-owner",
];

export const RANK_LABELS = {
  user: "User",
  admin: "Admin",
  mod: "Moderator",
  team: "Team",
  "co-owner": "Co-Owner",
  owner: "Owner",
};

function rootNumbers() {
  return (process.env.CREATOR_NUMBERS || "")
    .split(",")
    .map((s) => normalizeNumber(s))
    .filter(Boolean);
}

function ownerNumbers() {
  return (process.env.OWNER_NUMBER || "")
    .split(",")
    .map((s) => normalizeNumber(s))
    .filter(Boolean);
}

export function isRoot(number) {
  const n = normalizeNumber(number);
  if (!n) return false;
  return rootNumbers().includes(n);
}

export function isOwnerNumber(number) {
  const n = normalizeNumber(number);
  if (!n) return false;
  return ownerNumbers().includes(n);
}

async function load() {
  const raw = await kvGet(RANKS_KEY);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

async function save(map) {
  await kvSet(RANKS_KEY, map);
  return map;
}

export async function getAssignedRanks() {
  return await load();
}

export async function getRank(number) {
  const n = normalizeNumber(number);
  if (!n) return "user";
  if (isRoot(n) || isOwnerNumber(n)) return "owner";
  const map = await load();
  const rank = map[n];
  return RANKS.includes(rank) ? rank : "user";
}

export async function getRankLevel(number) {
  const n = normalizeNumber(number);
  if (n && isRoot(n)) return Infinity;
  return RANK_LEVELS[await getRank(n)] || 0;
}

export async function hasRank(number, rank) {
  const target = RANK_LEVELS[rank] || 0;
  return (await getRankLevel(number)) >= target;
}

export async function setRank(number, rank) {
  const n = normalizeNumber(number);
  if (!n) throw new Error("Invalid number");
  if (!ASSIGNABLE_RANKS.includes(rank)) {
    throw new Error("Rank not assignable");
  }
  const map = await load();
  if (rank === "user") {
    delete map[n];
  } else {
    map[n] = rank;
  }
  await save(map);
  return rank;
}

export async function clearRank(number) {
  return await setRank(number, "user");
}

export async function listRanked() {
  const map = await load();
  return Object.entries(map)
    .filter(([, rank]) => RANKS.includes(rank) && rank !== "user")
    .map(([number, rank]) => ({ number, rank }));
}

export async function migrateRanks(entries) {
  const map = await load();
  let changed = 0;
  for (const { number, rank } of entries || []) {
    const n = normalizeNumber(number);
    const normalized =
      rank === "dev" ? "co-owner" : String(rank || "").toLowerCase();
    if (!n || !ASSIGNABLE_RANKS.includes(normalized)) continue;
    if (normalized === "user") {
      delete map[n];
    } else {
      map[n] = normalized;
    }
    changed++;
  }
  await save(map);
  return changed;
}
