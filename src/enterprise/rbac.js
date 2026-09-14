/**
 * RBAC — roles: owner > admin > mod > user
 * Capabilities gate sensitive actions.
 */

import { kvGet, kvSet } from "../database/botKv.js";
import {
  isOwnerMessage,
  isSudoMessage,
  normalizeNumber,
  senderCandidates,
} from "../utils/access.js";

export const ROLES = ["owner", "admin", "mod", "user"];

export const CAPABILITIES = {
  owner: ["*"],
  admin: [
    "broadcast",
    "flag",
    "policy",
    "audit.read",
    "backup",
    "role.manage",
    "moderation",
    "plugin.disable",
  ],
  mod: ["moderation", "plugin.disable", "audit.read"],
  user: [],
};

const KEY = "rbac_roles"; // { "9198...": "admin" }

async function loadMap() {
  const m = await kvGet(KEY);
  return m && typeof m === "object" ? m : {};
}

async function saveMap(m) {
  await kvSet(KEY, m);
}

export async function setUserRole(number, role) {
  const n = normalizeNumber(number);
  const r = String(role).toLowerCase();
  if (!ROLES.includes(r) || r === "owner") {
    throw new Error("Invalid role (use admin|mod|user)");
  }
  const map = await loadMap();
  if (r === "user") delete map[n];
  else map[n] = r;
  await saveMap(map);
  return map[n] || "user";
}

export async function getUserRole(number) {
  const n = normalizeNumber(number);
  const map = await loadMap();
  return map[n] || "user";
}

export async function listRoles() {
  return loadMap();
}

/**
 * Resolve effective role for a message
 */
export async function resolveRole(message, conn) {
  if (isOwnerMessage(message, conn) || message?.key?.fromMe) return "owner";
  if (await isSudoMessage(message, conn)) {
    // sudo defaults to admin unless mapped
    const candidates = [...senderCandidates(message, conn)];
    const map = await loadMap();
    for (const c of candidates) {
      if (map[c]) return map[c];
    }
    return "admin";
  }
  const candidates = [...senderCandidates(message, conn)];
  const map = await loadMap();
  for (const c of candidates) {
    if (map[c]) return map[c];
  }
  return "user";
}

export function roleHasCapability(role, capability) {
  const caps = CAPABILITIES[role] || [];
  if (caps.includes("*")) return true;
  return caps.includes(capability);
}

export async function can(message, conn, capability) {
  const role = await resolveRole(message, conn);
  return roleHasCapability(role, capability);
}
