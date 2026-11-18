import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const TICKETS_KEY = "community:tickets";
const SUPPORT_GROUP_KEY = "community:supportGroup";
const DELIVERY_KEY = "community:ticketDelivery";
const ROUTES_KEY = "community:ticketRoutes";
const SLA_KEY = "community:ticketSlaMinutes";
const MAX_TICKETS = 300;

export const DELIVERY_MODES = ["group", "dm", "both", "off"];
export const DEFAULT_DELIVERY = "group";
export const DEFAULT_CATEGORY = "general";

const envSla = Number.parseInt(process.env.TICKET_SLA_MINUTES ?? "360", 10);
export const DEFAULT_SLA_MINUTES = Number.isFinite(envSla) && envSla >= 0
  ? Math.min(10080, envSla)
  : 360;

function norm(number) {
  return normalizeNumber(number) || String(number || "").replace(/\D/g, "");
}

async function readTickets() {
  const map = await kvGet(TICKETS_KEY);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

function trim(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

export async function getSupportGroup() {
  const jid = await kvGet(SUPPORT_GROUP_KEY);
  return typeof jid === "string" && jid.trim() ? jid.trim() : null;
}

export async function setSupportGroup(jid) {
  const value = trim(jid, 256);
  if (!value) throw new Error("Invalid support group");
  await kvSet(SUPPORT_GROUP_KEY, value);
  return value;
}

export async function getTicketDelivery() {
  const mode = await kvGet(DELIVERY_KEY);
  return DELIVERY_MODES.includes(mode) ? mode : DEFAULT_DELIVERY;
}

export async function setTicketDelivery(mode) {
  const value = trim(mode, 16).toLowerCase();
  if (!DELIVERY_MODES.includes(value)) throw new Error("Invalid delivery mode");
  await kvSet(DELIVERY_KEY, value);
  return value;
}

export async function getTicketRoutes() {
  const raw = await kvGet(ROUTES_KEY);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

export async function getTicketRoute(category) {
  const key = trim(category, 48).toLowerCase();
  if (!key) return null;
  const routes = await getTicketRoutes();
  return routes[key] || null;
}

export async function setTicketRoute(category, jid) {
  const key = trim(category, 48).toLowerCase();
  const value = trim(jid, 256);
  if (!key || !value) throw new Error("Invalid category route");
  const routes = await getTicketRoutes();
  routes[key] = value;
  await kvSet(ROUTES_KEY, routes);
  return { category: key, jid: value };
}

export async function removeTicketRoute(category) {
  const key = trim(category, 48).toLowerCase();
  const routes = await getTicketRoutes();
  if (!key || !routes[key]) return false;
  delete routes[key];
  await kvSet(ROUTES_KEY, routes);
  return true;
}

export async function getTicketSlaMinutes() {
  const raw = await kvGet(SLA_KEY);
  if (raw === 0 || raw === "0") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? Math.min(10080, value)
    : DEFAULT_SLA_MINUTES;
}

export async function setTicketSlaMinutes(minutes) {
  const raw = String(minutes ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") {
    await kvSet(SLA_KEY, 0);
    return 0;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid SLA minutes");
  const minutesValue = Math.min(10080, Math.round(value));
  await kvSet(SLA_KEY, minutesValue);
  return minutesValue;
}

export async function createTicket({
  number = null,
  sender = null,
  chat = null,
  subject = "",
  body = "",
  target = null,
  source = "ticket",
  category = DEFAULT_CATEGORY,
} = {}) {
  const n = norm(number);
  if (!n) throw new Error("Invalid ticket number");

  const map = await readTickets();
  const id = `TKT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const ticket = {
    id,
    number: n,
    sender: sender ? String(sender).slice(0, 256) : null,
    chat: chat ? String(chat).slice(0, 256) : null,
    source: source === "report" ? "report" : "ticket",
    category: trim(category, 48).toLowerCase() || DEFAULT_CATEGORY,
    subject: trim(subject, 120) || "Support request",
    body: trim(body, 2000),
    target: target ? String(target).slice(0, 256) : null,
    ts: Date.now(),
    status: "open",
    answer: null,
    answeredAt: null,
    answeredBy: null,
    supportMessageId: null,
    supportChat: null,
    slaNotifiedAt: null,
    closedAt: null,
    closedBy: null,
  };

  map[id] = ticket;

  const ids = Object.keys(map).sort((a, b) => (map[b].ts || 0) - (map[a].ts || 0));
  for (const old of ids.slice(MAX_TICKETS)) delete map[old];

  await kvSet(TICKETS_KEY, map);
  return ticket;
}

export async function getTicket(id) {
  const key = trim(id, 64).toUpperCase();
  if (!key) return null;
  const map = await readTickets();
  return map[key] || null;
}

export async function getTicketBySupportMessageId(messageId) {
  const id = trim(messageId, 128);
  if (!id) return null;
  const map = await readTickets();
  return Object.values(map).find((ticket) => ticket && ticket.supportMessageId === id) || null;
}

export async function setTicketDeliveryMessage(id, { supportMessageId = null, supportChat = null } = {}) {
  const key = trim(id, 64).toUpperCase();
  const map = await readTickets();
  if (!key || !map[key]) return null;
  map[key] = {
    ...map[key],
    supportMessageId: supportMessageId ? String(supportMessageId).slice(0, 128) : map[key].supportMessageId || null,
    supportChat: supportChat ? String(supportChat).slice(0, 256) : map[key].supportChat || null,
  };
  await kvSet(TICKETS_KEY, map);
  return map[key];
}

export async function answerTicket(id, { answer = "", answeredBy = "Support", supportMessageId = null, supportChat = null } = {}) {
  const key = trim(id, 64).toUpperCase();
  const map = await readTickets();
  if (!key || !map[key]) return null;
  map[key] = {
    ...map[key],
    status: "answered",
    answer: trim(answer, 2000),
    answeredAt: Date.now(),
    answeredBy: trim(answeredBy, 64) || "Support",
    supportMessageId: supportMessageId ? String(supportMessageId).slice(0, 128) : map[key].supportMessageId || null,
    supportChat: supportChat ? String(supportChat).slice(0, 256) : map[key].supportChat || null,
  };
  await kvSet(TICKETS_KEY, map);
  return map[key];
}

export async function listTickets({ number = null, status = null, limit = 20 } = {}) {
  const n = number ? norm(number) : null;
  const map = await readTickets();
  return Object.values(map)
    .filter((ticket) => {
      if (!ticket || !ticket.id) return false;
      if (n && ticket.number !== n) return false;
      if (status && ticket.status !== status) return false;
      return true;
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, Math.max(1, Math.min(MAX_TICKETS, Number(limit) || 20)));
}

export async function markTicketSlaNotified(id, at = Date.now()) {
  const key = trim(id, 64).toUpperCase();
  const map = await readTickets();
  if (!key || !map[key] || map[key].slaNotifiedAt) return null;
  map[key] = { ...map[key], slaNotifiedAt: Number(at) || Date.now() };
  await kvSet(TICKETS_KEY, map);
  return map[key];
}

export async function closeTicket(id, actor = null) {
  const key = trim(id, 64).toUpperCase();
  const map = await readTickets();
  if (!key || !map[key]) return null;
  map[key] = {
    ...map[key],
    status: "closed",
    closedAt: Date.now(),
    closedBy: actor ? String(actor) : null,
  };
  await kvSet(TICKETS_KEY, map);
  return map[key];
}

export async function deleteTicketsFor(number) {
  const n = norm(number);
  if (!n) return 0;
  const map = await readTickets();
  const ids = Object.keys(map).filter((id) => map[id]?.number === n);
  for (const id of ids) delete map[id];
  if (ids.length) await kvSet(TICKETS_KEY, map);
  return ids.length;
}
