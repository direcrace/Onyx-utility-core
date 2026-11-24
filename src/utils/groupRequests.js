import crypto from "crypto";
import config from "../../config.js";
import { kvGet, kvSet, kvDel } from "../database/botKv.js";
import { inspectBotKv, deleteBotKvKeys } from "../database/kvMaintenance.js";
import { normalizeNumber, senderCandidates } from "./access.js";

export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

const RECEIVER_KEY = "groupreq:receive";

const defaultStore = {
  get: (key) => kvGet(key),
  set: (key, value) => kvSet(key, value),
  del: (key) => kvDel(key),
};

function storeOf(store) {
  return store || defaultStore;
}

function newId() {
  return crypto.randomBytes(4).toString("hex");
}

function expiresAt() {
  return Date.now() + REQUEST_TTL_MS;
}

async function read(key, store) {
  const raw = await store.get(key);
  if (raw == null) return null;
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { value = raw; }
  }
  if (!value || typeof value !== "object") return value;
  if (value.expiresAt && value.expiresAt <= Date.now()) {
    await store.del(key);
    return null;
  }
  return value;
}

async function write(key, value, store) {
  await store.set(key, value);
  return value;
}

export function groupJidFrom(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "here") return null;
  if (/@g\.us$/i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@g.us` : null;
}

export function parseInviteCode(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/([A-Za-z0-9_-]{6,})/i);
  return match ? match[1].split(/[?#]/)[0] : null;
}

export function inviteLink(code) {
  return code ? `https://chat.whatsapp.com/${code}` : null;
}

export function messageIdFrom(message) {
  const ctx = message?.message?.contextInfo || message?.rawMessage?.contextInfo || {};
  return ctx.stanzaId || message?.quoted?.id || message?.quoted?.key?.id || null;
}

export function requesterNumber(message, conn) {
  for (const candidate of senderCandidates(message, conn)) {
    if (String(candidate).endsWith("@g.us")) continue;
    const number = normalizeNumber(candidate);
    if (number) return number;
  }
  return normalizeNumber(message?.sender || message?.from) || null;
}

export function userJid(number) {
  const n = normalizeNumber(number);
  return n ? `${n}@s.whatsapp.net` : null;
}

function actionKey(groupJid, number, type) {
  return `groupact:open:${groupJid}:${number}:${type}`;
}

function actionMsgKey(messageId) {
  return `groupact:msg:${messageId}`;
}

function requestKey(number) {
  return `groupreq:open:${number}`;
}

function requestMsgKey(messageId) {
  return `groupreq:msg:${messageId}`;
}

function setupGroupKey(groupJid) {
  return `groupsetup:pending:${groupJid}`;
}

function setupTokenKey(token) {
  return `groupsetup:token:${token}`;
}

export async function getReceiver(store) {
  return read(RECEIVER_KEY, storeOf(store));
}

export async function setReceiver(jid, store) {
  const target = storeOf(store);
  if (!jid) {
    await target.del(RECEIVER_KEY);
    return null;
  }
  return write(RECEIVER_KEY, jid, target);
}

export async function getAction({ groupJid, number, type }, store) {
  if (!groupJid || !number || !type) return null;
  return read(actionKey(groupJid, number, type), storeOf(store));
}

export async function createAction({ groupJid, number, type, participant, requester }, store) {
  const target = storeOf(store);
  const existing = await getAction({ groupJid, number, type }, target);
  if (existing) return { existing };
  const record = {
    id: newId(),
    groupJid,
    number,
    type,
    participant: participant || userJid(number),
    requester: requester || number,
    createdAt: Date.now(),
    expiresAt: expiresAt(),
    status: "pending",
    messageId: null,
  };
  await write(actionKey(groupJid, number, type), record, target);
  return { record };
}

export async function attachActionMessage({ groupJid, number, type, messageId }, store) {
  const target = storeOf(store);
  const record = await getAction({ groupJid, number, type }, target);
  if (!record || !messageId) return record;
  record.messageId = messageId;
  await write(actionKey(groupJid, number, type), record, target);
  await write(actionMsgKey(messageId), { groupJid, number, type, id: record.id }, target);
  return record;
}

export async function getActionByMessage({ groupJid, type, messageId }, store) {
  const target = storeOf(store);
  if (!groupJid || !type || !messageId) return null;
  const pointer = await read(actionMsgKey(messageId), target);
  if (!pointer || pointer.groupJid !== groupJid || pointer.type !== type) return null;
  const record = await getAction(pointer, target);
  if (!record) {
    await target.del(actionMsgKey(messageId));
    return null;
  }
  return record;
}

export async function deleteAction(record, store) {
  if (!record) return;
  const target = storeOf(store);
  await target.del(actionKey(record.groupJid, record.number, record.type));
  if (record.messageId) await target.del(actionMsgKey(record.messageId));
}

export async function getRequest(number, store) {
  if (!number) return null;
  return read(requestKey(number), storeOf(store));
}

export async function createRequest({ number, code, requesterJid }, store) {
  const target = storeOf(store);
  const existing = await getRequest(number, target);
  if (existing) return { existing };
  const record = {
    id: newId(),
    number,
    code,
    requesterJid: requesterJid || userJid(number),
    createdAt: Date.now(),
    expiresAt: expiresAt(),
    status: "pending",
    messageId: null,
  };
  await write(requestKey(number), record, target);
  return { record };
}

export async function attachRequestMessage({ number, messageId }, store) {
  const target = storeOf(store);
  const record = await getRequest(number, target);
  if (!record || !messageId) return record;
  record.messageId = messageId;
  await write(requestKey(number), record, target);
  await write(requestMsgKey(messageId), { number, id: record.id }, target);
  return record;
}

export async function getRequestByMessage({ messageId }, store) {
  const target = storeOf(store);
  if (!messageId) return null;
  const pointer = await read(requestMsgKey(messageId), target);
  if (!pointer) return null;
  const record = await getRequest(pointer.number, target);
  if (!record) {
    await target.del(requestMsgKey(messageId));
    return null;
  }
  return record;
}

export async function deleteRequest(record, store) {
  if (!record) return;
  const target = storeOf(store);
  await target.del(requestKey(record.number));
  if (record.messageId) await target.del(requestMsgKey(record.messageId));
}

export async function approveRequest(record, { groupJid, approver }, store) {
  const target = storeOf(store);
  await deleteRequest(record, target);
  const setup = {
    id: record.id,
    groupJid,
    token: newId(),
    requester: record.number,
    approver: approver || null,
    createdAt: Date.now(),
    expiresAt: expiresAt(),
    status: "awaiting-setup",
  };
  await write(setupGroupKey(groupJid), setup, target);
  await write(setupTokenKey(setup.token), groupJid, target);
  return setup;
}

export async function getSetupByGroup(groupJid, store) {
  if (!groupJid) return null;
  return read(setupGroupKey(groupJid), storeOf(store));
}

export async function getSetupByToken(token, store) {
  if (!token) return null;
  const target = storeOf(store);
  const groupJid = await read(setupTokenKey(token), target);
  if (!groupJid) return null;
  const setup = await getSetupByGroup(groupJid, target);
  if (!setup || setup.token !== token) {
    await target.del(setupTokenKey(token));
    return null;
  }
  return setup;
}

export async function deleteSetup(setup, store) {
  if (!setup) return;
  const target = storeOf(store);
  await target.del(setupGroupKey(setup.groupJid));
  await target.del(setupTokenKey(setup.token));
}

const SWEEP_PREFIXES = ["groupact:", "groupreq:", "groupsetup:"];

function parseRecord(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

export function expiredGroupKeys(rows, now = Date.now()) {
  const keys = new Set();
  for (const row of rows || []) {
    const key = String(row?.key || "");
    if (!key || /:(?:msg|token):/.test(key)) continue;
    if (!SWEEP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    let value = row?.value;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { continue; }
    }
    const record = parseRecord(value);
    if (!record?.expiresAt || Number(record.expiresAt) > now) continue;
    keys.add(key);
    if (key.startsWith("groupact:") && record.messageId) {
      keys.add(`groupact:msg:${record.messageId}`);
    }
    if (key.startsWith("groupreq:") && record.messageId) {
      keys.add(`groupreq:msg:${record.messageId}`);
    }
    if (key.startsWith("groupsetup:") && record.token) {
      keys.add(`groupsetup:token:${record.token}`);
    }
  }
  return [...keys];
}

export async function sweepExpiredGroupState({ rows = null, onDelete = null, cfg = config, now = Date.now() } = {}) {
  const sourceRows = rows || [];
  let allRows = sourceRows;
  if (!rows) {
    const snapshot = await inspectBotKv(cfg);
    allRows = [...snapshot.rows, ...snapshot.localRows];
  }
  const keys = expiredGroupKeys(allRows, now);
  if (!keys.length) return { scanned: allRows.length, expired: 0, removed: 0 };

  const result = onDelete
    ? await onDelete(keys)
    : await deleteBotKvKeys(keys, { cfg });
  const removed = typeof result === "number"
    ? result
    : result?.removed ?? ((result?.removedRemote || 0) + (result?.removedLocal || 0));

  return { scanned: allRows.length, expired: keys.length, removed };
}
