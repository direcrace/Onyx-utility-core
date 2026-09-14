/**
 * Global bot ban — users banned from using the bot anywhere.
 * Stored in BotKV as a list of normalized numbers (key "botbans").
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const BAN_KEY = "botbans";

async function load() {
  const data = await kvGet(BAN_KEY);
  return Array.isArray(data) ? data.map(normalizeNumber).filter(Boolean) : [];
}

export async function listBotBans() {
  return load();
}

export async function isBotBanned(userId) {
  const norm = normalizeNumber(userId);
  if (!norm) return false;
  const list = await load();
  return list.includes(norm);
}

export async function botBanUser(userId) {
  const norm = normalizeNumber(userId);
  if (!norm) throw new Error("Invalid number");
  const list = await load();
  if (!list.includes(norm)) list.push(norm);
  await kvSet(BAN_KEY, list);
  return norm;
}

export async function botUnbanUser(userId) {
  const norm = normalizeNumber(userId);
  const list = await load();
  const next = list.filter((n) => n !== norm);
  await kvSet(BAN_KEY, next);
  return next;
}