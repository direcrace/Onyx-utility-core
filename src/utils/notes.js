/**
 * Personal / shared notes in BotKV
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

function userKey(ownerNorm) {
  return `notes:${ownerNorm}`;
}

async function load(ownerNorm) {
  const data = await kvGet(userKey(ownerNorm));
  return data && typeof data === "object" ? data : {};
}

async function save(ownerNorm, notes) {
  await kvSet(userKey(ownerNorm), notes);
}

export async function saveNote(ownerId, id, text) {
  const owner = normalizeNumber(ownerId) || ownerId;
  const notes = await load(owner);
  notes[id] = { text, updatedAt: Date.now() };
  await save(owner, notes);
  return notes[id];
}

export async function getNote(ownerId, id) {
  const owner = normalizeNumber(ownerId) || ownerId;
  const notes = await load(owner);
  return notes[id] || null;
}

export async function deleteNote(ownerId, id) {
  const owner = normalizeNumber(ownerId) || ownerId;
  const notes = await load(owner);
  if (!notes[id]) return false;
  delete notes[id];
  await save(owner, notes);
  return true;
}

export async function listNotes(ownerId) {
  const owner = normalizeNumber(ownerId) || ownerId;
  const notes = await load(owner);
  return Object.entries(notes).map(([id, v]) => ({ id, ...v }));
}
