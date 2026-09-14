/**
 * Bot system log group — onboarding + internal logs only.
 * User chats never receive stack traces / system diagnostics.
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { getOwnerNumbers, normalizeNumber } from "./access.js";
import { BOT_INFO } from "../config/constants.js";

const LOG_GROUP_KEY = "log_group_jid";
const SETUP_DONE_KEY = "setup_done";

let connRef = null;
let sendQueue = Promise.resolve();
let lastSendAt = 0;
const MIN_GAP_MS = 1500;

export function attachLogGroupConn(conn) {
  connRef = conn;
}

export async function getLogGroupJid() {
  return (await kvGet(LOG_GROUP_KEY)) || null;
}

export async function setLogGroupJid(jid) {
  await kvSet(LOG_GROUP_KEY, jid);
  return jid;
}

export async function isSetupDone() {
  return !!(await kvGet(SETUP_DONE_KEY));
}

export async function markSetupDone(done = true) {
  await kvSet(SETUP_DONE_KEY, !!done);
}

export function isLogGroup(jid) {
  // sync check against last known — prefer async get for accuracy in callers
  return false;
}

export async function isLogGroupAsync(jid) {
  const log = await getLogGroupJid();
  return !!(log && jid === log);
}

function ownerJids() {
  return getOwnerNumbers().map((n) => `${n}@s.whatsapp.net`);
}

function botBareJid(conn) {
  const id = conn?.user?.id;
  if (!id) return null;
  return id.replace(/:\d+@/, "@");
}

/**
 * Ensure a dedicated log/onboarding group exists.
 * Creates "X-Asena · System" with owner numbers when possible.
 */
export async function ensureLogGroup(conn) {
  attachLogGroupConn(conn);

  let jid = await getLogGroupJid();
  if (jid) {
    try {
      await conn.groupMetadata(jid);
      return { jid, created: false };
    } catch {
      // stale — recreate
      jid = null;
    }
  }

  const participants = ownerJids().filter((j) => {
    const bare = botBareJid(conn);
    return bare ? normalizeNumber(j) !== normalizeNumber(bare) : true;
  });

  // Need at least one other participant for groupCreate on many WA builds
  if (!participants.length) {
    console.warn(
      "[log-group] No OWNER_NUMBER set — cannot auto-create log group.\n" +
        "  Set OWNER_NUMBER, or create a group, add the bot, then run #setlog there."
    );
    return { jid: null, created: false, needsManual: true };
  }

  try {
    const subject = `${BOT_INFO.NAME} · System`;
    const res = await conn.groupCreate(subject, participants);
    const gid = res?.gid || res?.id;
    if (!gid) throw new Error("groupCreate returned no id");

    await setLogGroupJid(gid);

    // Announce briefly
    await conn.sendMessage(gid, {
      text:
        `🛠 *${BOT_INFO.NAME} system group*\n\n` +
        `This chat is for *onboarding* and *internal logs* only.\n` +
        `Users in other chats will never see stack traces or system errors.\n\n` +
        `Next: run \`${BOT_INFO.PREFIX}setup\` here.`,
    });

    console.log(`✅ System log group ready: ${gid}`);
    return { jid: gid, created: true };
  } catch (err) {
    console.error("[log-group] create failed:", err?.message || err);
    return { jid: null, created: false, error: err?.message || String(err) };
  }
}

/**
 * Send a system message to the log group only (never to user chats).
 */
export async function systemLog(level, message, detail) {
  const text = formatSystemLine(level, message, detail);
  // Always mirror to console
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);

  if (level === "error") {
    try {
      const { recordError } = await import("../enterprise/metrics.js");
      recordError();
    } catch {
      /* ignore */
    }
  }

  const jid = await getLogGroupJid();
  if (!jid || !connRef) return;

  sendQueue = sendQueue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastSendAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      await connRef.sendMessage(jid, { text });
      lastSendAt = Date.now();
    } catch (err) {
      console.error("[log-group] send failed:", err?.message || err);
    }
  });

  return sendQueue;
}

function formatSystemLine(level, message, detail) {
  const ts = new Date().toISOString().slice(11, 19);
  const icon =
    level === "error" ? "🔴" : level === "warn" ? "🟡" : level === "success" ? "🟢" : "ℹ️";
  let body = `${icon} *[${level.toUpperCase()}]* ${ts}\n${message}`;
  if (detail) {
    const d =
      typeof detail === "string"
        ? detail
        : detail?.stack || detail?.message || JSON.stringify(detail);
    const clipped = String(d).slice(0, 1500);
    body += `\n\`\`\`\n${clipped}\n\`\`\``;
  }
  return body;
}

/**
 * User-facing safe error — never includes stack. Details go to log group.
 */
export async function reportUserSafeError(conn, userJid, userMessage, error) {
  await systemLog("error", userMessage, error);
  // Caller sends userMessage (generic) to userJid — we only log details here
}
