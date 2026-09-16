

import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet, seedBotKvFromEnv } from "../database/botKv.js";

const MODE_KEY = "mode";
const SUDO_KEY = "sudo";

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

export const OWNER_ONLY_COMMANDS = new Set([
  "sudo",
  "broadcast",
  "setlog",
  "createlog",
  "backup",
]);

export function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();

  s = s.replace(/@.*/, "");

  if (s.includes(":")) s = s.split(":")[0];

  const digits = s.replace(/\D/g, "");
  return digits || s;
}

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

export function getOwnerNumbers() {
  const all = new Set([
    ...envOwnerList(),
    ...envCreatorList(),
    ..._runtimeOwners,
    ..._runtimeCreators,
  ]);
  return [...all].filter(Boolean);
}

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
  } catch {  }
}

export async function hydrateRoleNumbers() {
  try {
    const o = await kvGet("config:owners");
    if (Array.isArray(o)) o.forEach((x) => _runtimeOwners.add(normalizeNumber(x)));
    const c = await kvGet("config:creators");
    if (Array.isArray(c)) c.forEach((x) => _runtimeCreators.add(normalizeNumber(x)));
  } catch {  }
  return { owners: getOwnerNumbers(), creators: getCreatorNumbers() };
}

export function isCreatorMessage(message, conn) {

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

  }
}

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

  if (conn?.__isSub) return false;
  if (message?.key?.fromMe) return true;
  const owners = getOwnerNumbers();
  if (!owners.length) {

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

export async function isPrivileged(message, conn) {
  if (message?.key?.fromMe) return true;
  if (isOwnerMessage(message, conn)) return true;
  return isSudoMessage(message, conn);
}

export async function checkCommandAccess(message, command, conn) {
  const name = (command.patternName || "").toLowerCase();
  const privileged = await isPrivileged(message, conn);
  const owner = isOwnerMessage(message, conn);

  if (name === "broadcast" && !owner && !message?.key?.fromMe) {
    return { allowed: false, silent: false, reason: "OWNER_ONLY" };
  }

  if (OWNER_ONLY_COMMANDS.has(name) && !owner && !message?.key?.fromMe) {

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

