/**
 * Per-user to-do lists in BotKV
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

function todoKey(ownerNorm) {
  return `todo:${ownerNorm}`;
}

async function load(ownerNorm) {
  const data = await kvGet(todoKey(ownerNorm));
  return Array.isArray(data) ? data : [];
}

async function save(ownerNorm, items) {
  await kvSet(todoKey(ownerNorm), items);
}

export async function addTodo(ownerId, text) {
  const owner = normalizeNumber(ownerId) || ownerId;
  const items = await load(owner);
  items.push({ text: String(text), createdAt: Date.now() });
  await save(owner, items);
  return items.length;
}

export async function listTodos(ownerId) {
  const owner = normalizeNumber(ownerId) || ownerId;
  return load(owner);
}

export async function removeTodo(ownerId, index1) {
  const owner = normalizeNumber(ownerId) || ownerId;
  const items = await load(owner);
  const idx = Number(index1) - 1;
  if (!items[idx]) return false;
  items.splice(idx, 1);
  await save(owner, items);
  return true;
}

export async function clearTodos(ownerId) {
  const owner = normalizeNumber(ownerId) || ownerId;
  await save(owner, []);
  return true;
}