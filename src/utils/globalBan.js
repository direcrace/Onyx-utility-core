
import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const BAN_KEY = "botbans";

function entryNumber(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return normalizeNumber(entry);
  return normalizeNumber(entry.number);
}

function normalizeEntry(entry) {
  const number = entryNumber(entry);
  if (!number) return null;
  if (typeof entry === "string") {
    return { number, reason: "", date: "" };
  }
  return {
    number,
    reason: typeof entry.reason === "string" ? entry.reason : "",
    date: typeof entry.date === "string" ? entry.date : "",
  };
}

async function loadEntries() {
  const data = await kvGet(BAN_KEY);
  const raw = Array.isArray(data) ? data : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.number)) continue;
    seen.add(entry.number);
    out.push(entry);
  }
  return out;
}

async function saveEntries(entries) {
  await kvSet(BAN_KEY, entries);
  return entries;
}

export async function listBotBans() {
  return (await loadEntries()).map((entry) => entry.number);
}

export async function listBotBansDetailed() {
  return await loadEntries();
}

export async function getBotBan(userId) {
  const norm = normalizeNumber(userId);
  if (!norm) return null;
  return (await loadEntries()).find((entry) => entry.number === norm) || null;
}

export async function isBotBanned(userId) {
  return (await getBotBan(userId)) !== null;
}

export async function botBanUser(userId, reason = "") {
  const norm = normalizeNumber(userId);
  if (!norm) throw new Error("Invalid number");
  const entries = await loadEntries();
  const existing = entries.find((entry) => entry.number === norm);
  if (existing) {
    if (reason) existing.reason = String(reason);
    if (!existing.date) existing.date = new Date().toISOString();
  } else {
    entries.push({
      number: norm,
      reason: String(reason || ""),
      date: new Date().toISOString(),
    });
  }
  await saveEntries(entries);
  return norm;
}

export async function botUnbanUser(userId) {
  const norm = normalizeNumber(userId);
  const entries = await loadEntries();
  const next = entries.filter((entry) => entry.number !== norm);
  await saveEntries(next);
  return next.map((entry) => entry.number);
}
