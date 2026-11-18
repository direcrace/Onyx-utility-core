

import { kvGet, kvSet } from "../database/botKv.js";

const HIST_PREFIX = "aihist:";
const HIST_LIMIT = 20;
const SYSTEM_KEY = "ai_system_prompt";
const CHATBOT_KEY = "chatbot_enabled";
const USERS_KEY = "chatbot_users";
const AI_MSG_KEY = "ai:message_ids";
const AI_MSG_LIMIT = 500;

export async function rememberAiMessage(id) {
  if (!id) return;
  const raw = await kvGet(AI_MSG_KEY);
  const ids = Array.isArray(raw) ? raw.map(String) : [];
  ids.push(String(id));
  while (ids.length > AI_MSG_LIMIT) ids.shift();
  await kvSet(AI_MSG_KEY, ids);
}

export async function isAiMessage(id) {
  if (!id) return false;
  const raw = await kvGet(AI_MSG_KEY);
  const ids = Array.isArray(raw) ? raw.map(String) : [];
  return ids.includes(String(id));
}

export async function getHistory(sender) {
  return (await getFullHistory(sender)).slice(-HIST_LIMIT);
}

export async function getFullHistory(sender) {
  const raw = await kvGet(`${HIST_PREFIX}${sender}`);
  return Array.isArray(raw) ? raw : [];
}

export async function addMessage(sender, msg) {
  const hist = await getHistory(sender);
  hist.push(msg);
  if (hist.length > HIST_LIMIT) hist.splice(0, hist.length - HIST_LIMIT);
  await kvSet(`${HIST_PREFIX}${sender}`, hist);
}

export async function clearHistory(sender) {
  await kvSet(`${HIST_PREFIX}${sender}`, []);
}

export async function getSystemPrompt() {
  const p = await kvGet(SYSTEM_KEY);
  return typeof p === "string" ? p : "You are a helpful WhatsApp bot assistant. Be concise.";
}

export async function setSystemPrompt(text) {
  await kvSet(SYSTEM_KEY, text);
}

export async function isChatbotEnabled() {
  const v = await kvGet(CHATBOT_KEY);
  return v === true;
}

export async function toggleChatbot(on) {
  await kvSet(CHATBOT_KEY, !!on);
  return !!on;
}

export async function isUserAllowed(sender) {
  const users = await listAllowedUsers();
  if (!users.length) return true;
  const norm = String(sender).replace(/@.*/, "").replace(/:\d+$/, "").replace(/\D/g, "");
  return users.some((u) => u === norm);
}

export async function addUser(number) {
  const n = String(number).replace(/\D/g, "");
  if (!n) return;
  const list = await listAllowedUsers();
  if (!list.includes(n)) list.push(n);
  await kvSet(USERS_KEY, list);
}

export async function removeUser(number) {
  const n = String(number).replace(/\D/g, "");
  const list = (await listAllowedUsers()).filter((u) => u !== n);
  await kvSet(USERS_KEY, list);
}

export async function listAllowedUsers() {
  const raw = await kvGet(USERS_KEY);
  return Array.isArray(raw) ? raw.filter(Boolean) : [];
}
