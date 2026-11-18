import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const TICKETS_KEY = "community:tickets";
const SUPPORT_GROUP_KEY = "community:supportGroup";
const DELIVERY_KEY = "community:ticketDelivery";
const MAX_TICKETS = 300;

export const DELIVERY_MODES = ["group", "dm", "both", "off"];
export const DEFAULT_DELIVERY = "group";

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

export async function createTicket({
  number = null,
  sender = null,
  chat = null,
  subject = "",
  body = "",
  target = null,
  source = "ticket",
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
    subject: trim(subject, 120) || "Support request",
    body: trim(body, 2000),
    target: target ? String(target).slice(0, 256) : null,
    ts: Date.now(),
    status: "open",
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
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
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
