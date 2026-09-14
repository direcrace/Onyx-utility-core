/**
 * Bot access control — public/private mode, owner + sudo
 */

import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet, seedBotKvFromEnv } from "../database/botKv.js";

const MODE_KEY = "mode";
const SUDO_KEY = "sudo";

/** Commands that always require privileged (even in public mode for management) */
export const PRIVILEGED_COMMANDS = new Set([
  "mode",
  "sudo",
  "exif",
  "broadcast",
  "cmdlist",
  "setup",
  "createlog",
  "setlog",
  "audit",
  "flag",
  "policy",
  "role",
  "backup",
  "metrics",
]);

/** Owner-only (not sudo) — plugin may still allow sudo list */
export const OWNER_ONLY_COMMANDS = new Set([
  "sudo",
  "broadcast",
  "setlog",
  "createlog",
  "backup",
]);

/**
 * Strip JID / LID / device suffix → digits or lid id
 */
export function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  // bare number or jid
  s = s.replace(/@.*/, "");
  // device suffix 123456:61 → 123456
  if (s.includes(":")) s = s.split(":")[0];
  // keep digits for phone; for LID keep alphanumeric
  const digits = s.replace(/\D/g, "");
  return digits || s;
}

/**
 * Collect candidate normalized ids from a message sender
 */
export function senderCandidates(message, conn) {
  const ids = new Set();
  const add = (v) => {
    const n = normalizeNumber(v);
    if (n) ids.add(n);
  };

  add(message?.sender);
  add(message?.participant);
  add(message?.participantAlt);
  add(message?.key?.participant);
  add(message?.key?.participantAlt);
  add(message?.key?.remoteJid);
  add(message?.key?.remoteJidAlt);

  if (message?.key?.fromMe && conn?.user) {
    add(conn.user.id);
    add(conn.user.lid);
    if (conn.user.id) add(conn.user.id.replace(/:\d+@/, "@"));
  }

  return ids;
}

/**
 * Owner numbers from env OWNER_NUMBER (comma-separated ok).
 * Creators (env CREATOR_NUMBERS + runtime) are always owners too, so a creator
 * can do everything an owner can while keeping creator-only powers.
 */
export function getOwnerNumbers() {
  const all = new Set([
    ...envOwnerList(),
    ...envCreatorList(),
    ..._runtimeOwners,
    ..._runtimeCreators,
  ]);
  return [...all].filter(Boolean);
}

/** Creator numbers — the ultimate host tier (env + runtime). */
export function getCreatorNumbers() {
  const all = new Set([...envCreatorList(), ..._runtimeCreators]);
  return [...all].filter(Boolean);
}

function envOwnerList() {
  return (process.env.OWNER_NUMBER || "")
    .split(",")
    .map((s) => normalizeNumber(s))
    .filter(Boolean);
}

function envCreatorList() {
  return (process.env.CREATOR_NUMBERS || "")
    .split(",")
    .map((s) => normalizeNumber(s))
    .filter(Boolean);
}

/** Runtime-added owner/creator numbers (persisted in BotKV; applied live). */
let _runtimeOwners = new Set();
let _runtimeCreators = new Set();

export async function listCreators() {
  return getCreatorNumbers();
}

export async function addCreator(number) {
  const n = normalizeNumber(number);
  if (!n) throw new Error("Invalid number");
  _runtimeCreators.add(n);
  await persistRoleNumbers();
  return getCreatorNumbers();
}

export async function removeCreator(number) {
  const n = normalizeNumber(number);
  _runtimeCreators.delete(n);
  await persistRoleNumbers();
  return getCreatorNumbers();
}

export async function addOwner(number) {
  const n = normalizeNumber(number);
  if (!n) throw new Error("Invalid number");
  _runtimeOwners.add(n);
  await persistRoleNumbers();
  return getOwnerNumbers();
}

export async function removeOwner(number) {
  const n = normalizeNumber(number);
  _runtimeOwners.delete(n);
  await persistRoleNumbers();
  return getOwnerNumbers();
}

async function persistRoleNumbers() {
  try {
    await kvSet("config:owners", [..._runtimeOwners]);
    await kvSet("config:creators", [..._runtimeCreators]);
  } catch { /* DB may be unavailable in tests */ }
}

/** Load persisted owner/creator overrides into memory (call once after BotKV is up). */
export async function hydrateRoleNumbers() {
  try {
    const o = await kvGet("config:owners");
    if (Array.isArray(o)) o.forEach((x) => _runtimeOwners.add(normalizeNumber(x)));
    const c = await kvGet("config:creators");
    if (Array.isArray(c)) c.forEach((x) => _runtimeCreators.add(normalizeNumber(x)));
  } catch { /* Not ready */ }
  return { owners: getOwnerNumbers(), creators: getCreatorNumbers() };
}

/**
 * Creator check — the host tier above owner.
 */
export function isCreatorMessage(message, conn) {
  // Sub-sessions are never the creator.
  if (conn?.__isSub) return false;
  if (message?.key?.fromMe) return true;
  const creators = getCreatorNumbers();
  if (!creators.length) return false;
  const candidates = senderCandidates(message, conn);
  return creators.some((c) => candidates.has(c));
}

async function ensureSeeded() {
  try {
    await seedBotKvFromEnv();
  } catch {
    /* BotKV may not be ready in tests */
  }
}

/**
 * Env SUDO list (always merged)
 */
function envSudoList() {
  return (process.env.SUDO || "")
    .split(",")
    .map((s) => normalizeNumber(s.trim()))
    .filter(Boolean);
}

const VALID_MODES = ["public", "private", "inbox", "group"];

export async function getMode() {
  await ensureSeeded();
  const mode = (await kvGet(MODE_KEY)) || "public";
  return VALID_MODES.includes(mode) ? mode : "public";
}

export async function setMode(mode) {
  const next = VALID_MODES.includes(mode) ? mode : "public";
  await kvSet(MODE_KEY, next);
  return next;
}

/**
 * Runtime sudo list from BotKV (env merged at read time)
 */
export async function listSudo() {
  await ensureSeeded();
  const stored = (await kvGet(SUDO_KEY)) || [];
  const list = Array.isArray(stored) ? stored.map(normalizeNumber) : [];
  const merged = new Set([...list.filter(Boolean), ...envSudoList()]);
  return [...merged];
}

export async function addSudo(number) {
  const n = normalizeNumber(number);
  if (!n) throw new Error("Invalid number");
  await ensureSeeded();
  const stored = (await kvGet(SUDO_KEY)) || [];
  const list = Array.isArray(stored) ? stored.map(normalizeNumber) : [];
  if (!list.includes(n)) list.push(n);
  await kvSet(SUDO_KEY, list);
  return list;
}

export async function removeSudo(number) {
  const n = normalizeNumber(number);
  await ensureSeeded();
  const stored = (await kvGet(SUDO_KEY)) || [];
  const list = (Array.isArray(stored) ? stored : [])
    .map(normalizeNumber)
    .filter((x) => x && x !== n);
  await kvSet(SUDO_KEY, list);
  return list;
}

export function isOwnerMessage(message, conn) {
  // Sub-sessions are never the owner — they are restricted guests.
  if (conn?.__isSub) return false;
  if (message?.key?.fromMe) return true;
  const owners = getOwnerNumbers();
  if (!owners.length) {
    // No OWNER_NUMBER: treat fromMe / bot user as owner only
    return !!message?.key?.fromMe;
  }
  const candidates = senderCandidates(message, conn);
  return owners.some((o) => candidates.has(o));
}

export async function isSudoMessage(message, conn) {
  const sudos = await listSudo();
  if (!sudos.length) return false;
  const candidates = senderCandidates(message, conn);
  return sudos.some((s) => candidates.has(s));
}

/**
 * Owner or sudo (or fromMe)
 */
export async function isPrivileged(message, conn) {
  if (message?.key?.fromMe) return true;
  if (isOwnerMessage(message, conn)) return true;
  return isSudoMessage(message, conn);
}

/**
 * Can this user run this command given current mode?
 * Returns { allowed: boolean, silent?: boolean, reason?: string }
 */
export async function checkCommandAccess(message, command, conn) {
  const name = (command.patternName || "").toLowerCase();
  const privileged = await isPrivileged(message, conn);
  const owner = isOwnerMessage(message, conn);

  // Strict owner-only (broadcast); sudo mutations enforced in plugin for `#sudo`
  if (name === "broadcast" && !owner && !message?.key?.fromMe) {
    return { allowed: false, silent: false, reason: "OWNER_ONLY" };
  }

  if (OWNER_ONLY_COMMANDS.has(name) && !owner && !message?.key?.fromMe) {
    // Allow privileged to *list* sudo; plugin enforces owner for add/del
    if (!privileged) {
      return { allowed: false, silent: false, reason: "OWNER_ONLY" };
    }
  }

  if (PRIVILEGED_COMMANDS.has(name) || command.fromMe) {
    if (!privileged) {
      return { allowed: false, silent: false, reason: "OWNER_ONLY" };
    }
    return { allowed: true };
  }

  const mode = await getMode();

  if (mode === "private" && !privileged) {
    return { allowed: false, silent: true };
  }

  if (mode === "inbox" && message?.isGroup) {
    return { allowed: false, silent: true };
  }

  if (mode === "group" && !message?.isGroup) {
    return { allowed: false, silent: true };
  }

  return { allowed: true };
}

