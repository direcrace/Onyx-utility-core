/**
 * Onyx Mini ToS monitor — always-on enforcement for linked sub-sessions.
 *
 * Watches the *outbound* activity of a linked account (messages the account
 * sends through its Own phone / devices, seen as `key.fromMe` by the sub
 * socket) and evaluates it against ToS trigger rules: spam/bulk patterns,
 * mass mentions, phishing URLs, harassment and illegal-content wordlists.
 *
 * Verdicts:
 *   continue — nothing happened (default)
 *   block    — (reserved; outbound messages aren't processed further anyway)
 *   suspend  — the linked session is immediately terminated (auto-enforcement)
 *
 * Flags are persisted in BotKV under `mini_flags` (+ number key), and old
 * records are auto-purged after MINI_FLAG_RETENTION_DAYS (default 30) to match
 * the GDPR retention cap documented in the Privacy Policy. Config knobs:
 *
 *   MINI_MONITOR              = "off" to disable monitoring
 *   MINI_FLAG_WARN            = score that triggers a warn log (default 30)
 *   MINI_FLAG_SUSPEND         = score that auto-suspends the session (default 80)
 *   MINI_FLAG_WINDOW_MS       = rolling score window (default 300000 = 5 min)
 *   MINI_FLAG_RETENTION_DAYS  = flag record retention (default 30)
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "../utils/access.js";

const FLAGS_KEY = "mini_flags";

const CFG = {
  enabled: (process.env.MINI_MONITOR || "on").toLowerCase() !== "off",
  warn: Number(process.env.MINI_FLAG_WARN) || 30,
  suspend: Number(process.env.MINI_FLAG_SUSPEND) || 80,
  windowMs: Math.max(10_000, Number(process.env.MINI_FLAG_WINDOW_MS) || 300_000),
  retentionMs:
    Math.max(1, Number(process.env.MINI_FLAG_RETENTION_DAYS) || 30) * 86_400_000,
};

/**
 * User-scope monitor (normal people on the main connection). Same rules, but
 * applied to inbound messages FROM a user, with a ban instead of a suspend.
 *   USER_MONITOR        = "off" to disable
 *   USER_FLAG_WARN      = score that triggers a warn log (default 50)
 *   USER_FLAG_BAN       = score that auto-bans the user (default 120)
 *   USER_FLAG_WINDOW_MS = rolling score window (default 5 min)
 */
const UCFG = {
  enabled: (process.env.USER_MONITOR || "on").toLowerCase() !== "off",
  warn: Number(process.env.USER_FLAG_WARN) || 50,
  ban: Number(process.env.USER_FLAG_BAN) || 120,
  windowMs: Math.max(10_000, Number(process.env.USER_FLAG_WINDOW_MS) || 300_000),
  retentionMs:
    Math.max(1, Number(process.env.USER_FLAG_RETENTION_DAYS) || 30) * 86_400_000,
};

/** In-memory rolling state per sub-session number. */
const state = new Map(); // number -> { texts: Map<hash, ts[]>, dms: Map<jid, ts[]>, links: ts[], lastLog: Map<rule, ts>, scoreWindow: [] }
/** In-memory rolling state per normal user number (main-connection inbound). */
const ustate = new Map();
/**
 * scoreWindow entries: { ts, w } — summed for the current window.
 */

const URL_RE =
  /(?:https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/)[^\s]+/gi;

// --- Wordlists ------------------------------------------------------------
// Bilingual, deliberately conservative: only unmistakable abusive/invalid
// tokens. Severe adds lots of score; critical suspends immediately.
const CSAM_RE =
  /(child\s?(porn|porno|sex)|porn\s?(child|kids?)|cp\s?(videos?|files?|links?)|mega\.nz\/(cp|xx|kids?)|lolita\s?(porn|videos?)|reportage?\s?kesahkisi?\s?anak|k?inderporn?o)/i;
const ILLEGAL_SALE_RE =
  /(sell(ing)?|verkauf(e|st)?|buy|kauf(e|st)?|order|bestell(e|st)?|delivery|lieferung|discreet|anon)/i;
const SUBSTANCE_RE =
  /\b(weed|grass|dope|mdma|ecstasy|xtc|coke|cocaine|crack|heroin|ice|meth|ketamin?e?|adderall|xanax|fentanyl|oxycodone|\d{1,3}€|\$\d{1,3})\b/i;
const WEAPON_RE =
  /\b(glock|sks|ak-?47|m-?16|9mm|\.45|kalashnikov|maschinenpistole|ar-?15|full.?auto)\b/i;
const HARASS_SEVERE_RE =
  /\b(kill\s?(yourself|your\s?self)|kys|fuck\s?(you|u)|hurensohn|schlampe|rape|vergewaltig(t|e|ung|en)?|nigga|nigger|niger)\b/i;
const HARASS_MILD_RE =
  /\b(dumb|stupid|idiot|loser|hässlich|dumm|blöd|vollidiot|asozial|bastard)\b/i;
const SCAM_RE =
  /(free\s?nitro|nitro\s?generator|free\s?robux|robux\s?generator|crypto\s?giveaway|wallet\s?has\s?been\s?unlocked|claim\s?your\s?prize|you'?ve?\s?won|giftcard\s?generator|free\s?gift\s?card|bitcoin\s?doubl|doubl?e\s?your\s?(bitcoin|crypto)|offiziellen?\s?gewinn(ne|st)?|kostenlose?\s?nitro|gratis\s?giftc?ards?|airdrop\s?claim)/i;

// --- Flag record helpers ---------------------------------------------------

let flagIdSeq = 0;

function newFlagId() {
  flagIdSeq = (flagIdSeq + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${flagIdSeq.toString(36)}`;
}

function normalizeChat(jid) {
  return String(jid || "").replace(/\D/g, "");
}

/** Load all mini flags from BotKV. */
async function loadFlags() {
  const data = await kvGet(FLAGS_KEY);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

/** Persist the whole mini-flag store. */
async function saveFlags(store) {
  await kvSet(FLAGS_KEY, store);
}

/** Drop records older than the retention cap (GDPR §6). */
function purgeRecords(list) {
  const cut = Date.now() - CFG.retentionMs;
  const kept = (Array.isArray(list) ? list : []).filter((r) => {
    const ts = Number(r?.ts) || 0;
    return ts > cut && r?.id;
  });
  return kept.length === (Array.isArray(list) ? list : []).length
    ? kept
    : kept;
}

async function purgeStore(store) {
  let changed = false;
  for (const num of Object.keys(store)) {
    const next = purgeRecords(store[num]);
    if (next.length !== store[num].length) {
      store[num] = next;
      changed = true;
    }
    if (!next.length) delete store[num];
  }
  if (changed) await saveFlags(store);
  return store;
}

/** Persist a single flag record for a number. */
async function addFlag(number, rule, weight, message, scope = "mini") {
  const store = await purgeStore(await loadFlags());
  const list = purgeRecords(store[number] || []);
  list.push({
    id: newFlagId(),
    ts: Date.now(),
    scope,
    rule: rule.id,
    severity: rule.severity,
    weight,
    chat: normalizeChat(message?.from),
    chatType: message?.isGroup ? "group" : "dm",
    text: String(message?.body || "").slice(0, 220),
    resolved: false,
  });
  store[number] = list.slice(-200);
  await saveFlags(store);
  return store[number].find((r) => r.ts === list[list.length - 1].ts);
}

// --- Rolling state --------------------------------------------------------

function getState(map, number) {
  let s = map.get(number);
  if (!s) {
    s = {
      texts: new Map(),
      dms: new Map(),
      links: [],
      lastLog: new Map(),
      scoreWindow: [],
    };
    map.set(number, s);
  }
  return s;
}

/** Drop all in-memory tracking for a number (session suspension/resume). */
export function resetMiniState(number) {
  state.delete(String(number).replace(/\D/g, ""));
}

/** Drop all in-memory tracking for a normal user number. */
export function resetUserState(number) {
  ustate.delete(String(number).replace(/\D/g, ""));
}

function pruneWindow(s, now) {
  const cutW = now - CFG.windowMs;
  s.scoreWindow = s.scoreWindow.filter((e) => e.ts > cutW);
  s.links = s.links.filter((t) => now - t < 60_000);
  for (const [k, arr] of s.texts) {
    const keep = arr.filter((t) => now - t < 60_000);
    if (keep.length) s.texts.set(k, keep);
    else s.texts.delete(k);
  }
  return s;
}

function shouldLog(s, rule, now) {
  const last = s.lastLog.get(rule.id) || 0;
  if (now - last < 30_000) return false;
  s.lastLog.set(rule.id, now);
  return true;
}

// --- Rules ----------------------------------------------------------------

/**
 * Each rule: { id, severity ("info"|"mild"|"severe"|"critical"), weight,
 *   test({ number, message, s, now }) -> { matched: true, note? } | null }
 */
const RULES = [
  {
    id: "repeat_flood",
    severity: "mild",
    weight: 20,
    test({ message, s, now }) {
      const text = String(message?.body || "").trim();
      if (!text || text.length < 4) return null;
      const key = text.toLowerCase().replace(/\s+/g, " ").slice(0, 160);
      const arr = s.texts.get(key) || [];
      arr.push(now);
      s.texts.set(key, arr);
      if (arr.filter((t) => now - t < 60_000).length >= 5) {
        return { matched: true, note: `identical message x${arr.length} in 60s` };
      }
      return null;
    },
  },
  {
    id: "dm_fan_out",
    severity: "mild",
    weight: 30,
    test({ number, message, s, now }) {
      if (!message?.from || message?.isGroup) return null;
      const jid = normalizeChat(message.from);
      if (!jid || jid === number) return null;
      const arr = s.dms.get(jid) || [];
      arr.push(now);
      s.dms.set(jid, arr);
      const active = [...s.dms.values()].filter((a) => a.some((t) => now - t < 120_000));
      if (active.length >= 6) {
        return { matched: true, note: `${active.length} distinct 1:1 chats in 120s` };
      }
      return null;
    },
  },
  {
    id: "mass_mention",
    severity: "severe",
    weight: 25,
    test({ message }) {
      const ctx = message?.rawMessage?.contextInfo;
      const huge = ctx?.groupMentions?.length || (ctx?.mentionedJid?.length || 0) > 10;
      const text = message?.body || "";
      const everyone =
        /(^|[^@\w])@(everyone|all|here)([^@\w]|$)/i.test(text) ||
        /alle|allen|@alle/i.test(text);
      if (huge || everyone) return { matched: true, note: "mass mention (@everyone/@all)" };
      return null;
    },
  },
  {
    id: "link_blast",
    severity: "mild",
    weight: 15,
    test({ message, s, now }) {
      const urls = String(message?.body || "").match(URL_RE) || [];
      if (urls.length) s.links.push(now);
      const recent = s.links.filter((t) => now - t < 60_000).length;
      if (recent >= 4) return { matched: true, note: `${recent} link messages in 60s` };
      return null;
    },
  },
  {
    id: "scam_phish",
    severity: "severe",
    weight: 40,
    test({ message }) {
      const text = String(message?.body || "");
      if (SCAM_RE.test(text)) return { matched: true, note: "phishing/giveaway scam pattern" };
      return null;
    },
  },
  {
    id: "harassment",
    severity: "severe",
    weight: 30,
    test({ message }) {
      const text = String(message?.body || "");
      if (HARASS_SEVERE_RE.test(text)) return { matched: true, note: "severe harassment language" };
      if (HARASS_MILD_RE.test(text)) return { matched: true, note: "abuse language" };
      return null;
    },
  },
  {
    id: "illegal_sale",
    severity: "critical",
    weight: 120,
    test({ message }) {
      const text = String(message?.body || "");
      const substances = SUBSTANCE_RE.test(text);
      const weapons = WEAPON_RE.test(text);
      const deal = ILLEGAL_SALE_RE.test(text);
      if (substances && deal) {
        return { matched: true, note: "drug sale wording" };
      }
      if (weapons && deal) {
        return { matched: true, note: "weapons sale wording" };
      }
      return null;
    },
  },
  {
    id: "csam",
    severity: "critical",
    weight: 100,
    test({ message }) {
      const text = String(message?.body || "");
      if (CSAM_RE.test(text)) return { matched: true, note: "CSAM-related content (absolute prohibition)" };
      return null;
    },
  },
];

// --- Public API -----------------------------------------------------------

/**
 * Evaluate one message from a sub-session. Only outbound activity of the
 * linked account (key.fromMe) is monitored — that is the account the ToS
 * makes the user responsible for.
 * @returns {Promise<{ action: "continue"|"block"|"suspend", reason?: string }>}
 */
export async function evaluateMiniMessage({ number, conn, message }) {
  if (!CFG.enabled) return { action: "continue" };
  const norm = number ? String(number) : normalizeNumber(message?.key?.remoteJid);
  if (!norm) return { action: "continue" };
  if (!message?.key?.fromMe) return { action: "continue" };
  const text = String(message?.body || "").trim();
  if (!text) return { action: "continue" };

  const now = Date.now();
  const s = getState(state, norm);
  pruneWindow(s, now);

  const matches = [];
  for (const rule of RULES) {
    const hit = rule.test({ number: norm, message, s, now });
    if (hit?.matched) matches.push({ rule, note: hit.note || rule.id });
  }
  if (!matches.length) return { action: "continue" };

  let score = 0;
  for (const m of matches) {
    score += m.rule.weight;
    const rec = await addFlag(norm, m.rule, m.rule.weight, message).catch(() => null);
    if (shouldLog(s, m.rule, now)) {
      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog(
          m.rule.severity === "critical" ? "error" : "warn",
          `🚩 [MINI] ${norm} → ${m.rule.id} (${m.rule.weight}) ${m.note}`,
          `…"${rec?.text || text}"`
        );
      } catch { /* log group unavailable */ }
    }
  }

  // Critical rules suspend immediately (CSAM etc.). Otherwise threshold-based.
  const critical = matches.some((m) => m.rule.severity === "critical");
  s.scoreWindow.push({ ts: now, w: score });
  pruneWindow(s, now);
  const windowScore = s.scoreWindow.reduce((a, e) => a + e.w, 0);

  if (!critical && windowScore < CFG.suspend) {
    if (windowScore >= CFG.warn) {
      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog("warn", `⚠️ [MINI] ${norm} ToS score ${windowScore} in ${Math.round(CFG.windowMs / 60000)}m window`, matches.map((m) => m.rule.id).join(", "));
      } catch { /* ignore */ }
    }
    return { action: "continue" };
  }

  const reason = critical
    ? `Critical ToS trigger: ${matches.map((m) => m.rule.id).join(", ")}`
    : `ToS score ${windowScore} ≥ ${CFG.suspend} (${matches.map((m) => m.rule.id).join(", ")})`;

  resetMiniState(norm);
  try {
    const { suspendSubSession } = await import("./sessionManager.js");
    await suspendSubSession(norm, reason);
  } catch (err) {
    console.error("[mini-monitor] auto-suspend failed:", err?.message || err);
  }
  return { action: "suspend", reason };
}

/**
 * Admin view of a number's flag history (purged) + current window score.
 * @param {string} number  normalized number
 * @param {"mini"|"user"} [scope] which rolling state the window score comes from
 */
export async function getMiniAdmin(number, scope = "mini") {
  const norm = String(number).replace(/\D/g, "");
  const store = await purgeStore(await loadFlags());
  const list = store[norm] || [];
  const s = (scope === "user" ? ustate : state).get(norm);
  const windowScore = s
    ? s.scoreWindow.filter((e) => e.ts > Date.now() - CFG.windowMs).reduce((a, e) => a + e.w, 0)
    : 0;
  return {
    number: norm,
    records: list,
    windowScore,
    thresholds: { warn: CFG.warn, suspend: CFG.suspend, windowMs: CFG.windowMs },
  };
}

/**
 * Normal-user flagging — inbound messages FROM a user on the main connection.
 * Same ToS rules as minis; enforcement is a global bot ban instead of a suspend.
 * @returns {Promise<{ action: "continue"|"ban", reason?: string }>}
 */
export async function evaluateUserMessage({ conn, message }) {
  if (!UCFG.enabled) return { action: "continue" };
  if (message?.key?.fromMe) return { action: "continue" };
  if (message?.isBotMessage) return { action: "continue" };
  const norm = normalizeNumber(message?.sender || message?.key?.remoteJid);
  if (!norm) return { action: "continue" };
  const text = String(message?.body || "").trim();
  if (!text) return { action: "continue" };

  try {
    const { isPrivileged } = await import("../utils/access.js");
    if (await isPrivileged(message, conn)) return { action: "continue" };
    const { isBotBanned } = await import("../utils/globalBan.js");
    if (await isBotBanned(norm)) return { action: "continue" };
  } catch { /* the monitor must never break the message flow */ }

  const now = Date.now();
  const s = getState(ustate, norm);
  pruneWindow(s, now);

  const matches = [];
  for (const rule of RULES) {
    const hit = rule.test({ number: norm, message, s, now });
    if (hit?.matched) matches.push({ rule, note: hit.note || rule.id });
  }
  if (!matches.length) return { action: "continue" };

  let score = 0;
  for (const m of matches) {
    score += m.rule.weight;
    const rec = await addFlag(norm, m.rule, m.rule.weight, message, "user").catch(() => null);
    if (shouldLog(s, m.rule, now)) {
      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog(
          m.rule.severity === "critical" ? "error" : "warn",
          `🚩 [USER] ${norm} → ${m.rule.id} (${m.rule.weight}) ${m.note}`,
          `…"${rec?.text || text}"`
        );
      } catch { /* log group unavailable */ }
    }
  }

  const critical = matches.some((m) => m.rule.severity === "critical");
  s.scoreWindow.push({ ts: now, w: score });
  pruneWindow(s, now);
  const windowScore = s.scoreWindow.reduce((a, e) => a + e.w, 0);

  if (!critical && windowScore < UCFG.ban) {
    if (windowScore >= UCFG.warn) {
      try {
        const { systemLog } = await import("../utils/logGroup.js");
        await systemLog("warn", `⚠️ [USER] ${norm} ToS score ${windowScore} in ${Math.round(UCFG.windowMs / 60000)}m window`, matches.map((m) => m.rule.id).join(", "));
      } catch { /* ignore */ }
    }
    return { action: "continue" };
  }

  const reason = critical
    ? `Critical ToS trigger: ${matches.map((m) => m.rule.id).join(", ")}`
    : `ToS score ${windowScore} ≥ ${UCFG.ban} (${matches.map((m) => m.rule.id).join(", ")})`;

  resetUserState(norm);
  try {
    const { botBanUser } = await import("../utils/globalBan.js");
    await botBanUser(norm);
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("error", `⛔ [USER] ${norm} auto-banned: ${reason}`);
  } catch (err) {
    console.error("[user-monitor] auto-ban failed:", err?.message || err);
  }
  return { action: "ban", reason };
}

/**
 * Dashboard list of normal users with open flags (scans the shared store).
 */
export async function listFlaggedUsers() {
  const store = await purgeStore(await loadFlags());
  const out = [];
  for (const [number, records] of Object.entries(store)) {
    if (!Array.isArray(records)) continue;
    const open = records.filter((r) => r.scope === "user" && !r.resolved).length;
    if (!open) continue;
    const s = ustate.get(number);
    const score = s
      ? s.scoreWindow.filter((e) => e.ts > Date.now() - UCFG.windowMs).reduce((a, e) => a + e.w, 0)
      : 0;
    out.push({ number, open, score, ban: UCFG.ban });
  }
  out.sort((a, b) => b.open - a.open || b.score - a.score);
  return out;
}

/**
 * Clear flag records for a number (operator review / false positive).
 * `id` = specific record id, "all" (default) clears everything for the number.
 */
export async function clearMiniFlags(number, id) {
  const norm = String(number).replace(/\D/g, "");
  const store = await purgeStore(await loadFlags());
  if (id && id !== "all") {
    store[norm] = (store[norm] || []).filter((r) => r.id !== id);
  } else {
    delete store[norm];
  }
  await saveFlags(store);
  return norm;
}

/** Drop expired flag records globally (call on boot). */
export async function purgeOldFlags() {
  const store = await loadFlags();
  await purgeStore(store);
}