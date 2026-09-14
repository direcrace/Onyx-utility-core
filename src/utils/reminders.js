/**
 * Reminder scheduler — persist in BotKV, tick every 30s
 */

import { kvGet, kvSet } from "../database/botKv.js";
import logger from "./logger.js";

const KEY = "reminders";
let timer = null;
let connRef = null;

async function loadReminders() {
  const list = await kvGet(KEY);
  return Array.isArray(list) ? list : [];
}

async function saveReminders(list) {
  await kvSet(KEY, list);
}

/**
 * @param {{ id, jid, text, at, createdBy }} reminder
 */
export async function addReminder(reminder) {
  const list = await loadReminders();
  list.push(reminder);
  await saveReminders(list);
  return reminder;
}

export async function listReminders(jid) {
  const list = await loadReminders();
  return jid ? list.filter((r) => r.jid === jid) : list;
}

export async function cancelReminder(id) {
  let list = await loadReminders();
  const before = list.length;
  list = list.filter((r) => r.id !== id);
  await saveReminders(list);
  return before !== list.length;
}

async function tick() {
  if (!connRef) return;
  try {
    const now = Date.now();
    let list = await loadReminders();
    const due = list.filter((r) => r.at <= now);
    if (!due.length) return;

    const remain = list.filter((r) => r.at > now);
    await saveReminders(remain);

    for (const r of due) {
      try {
        await connRef.sendMessage(r.jid, {
          text: `⏰ *Reminder*\n${r.text}`,
        });
      } catch (err) {
        logger.warn("Reminder send failed:", err?.message || err);
      }
    }
  } catch (err) {
    logger.warn("Reminder tick error:", err?.message || err);
  }
}

export function startReminderScheduler(conn) {
  connRef = conn;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 30_000);
  tick();
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  connRef = null;
}

/** Parse relative time: 10m, 2h, 1d or HH:MM tomorrow-ish absolute epoch from now */
export function parseWhen(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  const rel = s.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const u = rel[2];
    let ms = 0;
    if (u.startsWith("s")) ms = n * 1000;
    else if (u.startsWith("m")) ms = n * 60_000;
    else if (u.startsWith("h")) ms = n * 3_600_000;
    else if (u.startsWith("d")) ms = n * 86_400_000;
    return Date.now() + ms;
  }
  const abs = Date.parse(s);
  if (!Number.isNaN(abs) && abs > Date.now()) return abs;
  return null;
}
