/**
 * Per-group settings stored in BotKV (JSON blob per group)
 * Extended for control-freak admin features
 */

import { kvGet, kvSet } from "../database/botKv.js";

const PREFIX = "gset:";

const DEFAULTS = {
  welcome: false,
  welcomeText:
    "👋 Welcome @user to *@group*!\nMembers: @count",
  goodbye: false,
  goodbyeText: "👋 @user left *@group*.",
  antilink: false,
  antilinkAction: "delete",
  antispam: false,
  antispamAction: "delete",
  antispamLimit: 5,
  antispamWindowMs: 8000,
  antitag: false,
  antitagAction: "delete",
  antibot: false,
  antibotAction: "kick",
  antisticker: false,
  antistickerAction: "delete",
  antidelete: false,
  autoread: false,
  autoreact: "",
  autotyping: false,
  alwaysonline: false,
  onlyadmin: false,
  nsfw: false,
  autoapprove: false,
  chatbot: false,
  botDisabled: false,
  warnLimit: 3,
  muted: [],
  banned: [],
  disabledPlugins: [],
};

function key(jid) {
  return `${PREFIX}${jid}`;
}

export async function getGroupSettings(jid) {
  const raw = await kvGet(key(jid));
  if (!raw || typeof raw !== "object") return defaultsWithLang();
  const merged = {
    ...(await defaultsWithLang()),
    ...raw,
    muted: raw.muted || [],
    banned: raw.banned || [],
    disabledPlugins: raw.disabledPlugins || [],
  };
  return merged;
}

async function defaultsWithLang() {
  const { getLang } = await import("./i18n.js");
  const lang = await getLang();
  if (lang === "de") {
    return {
      ...DEFAULTS,
      welcomeText:
        "👋 Willkommen @user in *@group*!\nMitglieder: @count",
      goodbyeText: "👋 @user hat *@group* verlassen.",
    };
  }
  return { ...DEFAULTS };
}

export async function setGroupSettings(jid, patch) {
  const cur = await getGroupSettings(jid);
  const next = { ...cur, ...patch };
  await kvSet(key(jid), next);
  return next;
}

export async function toggleGroupFlag(jid, flag, value) {
  const cur = await getGroupSettings(jid);
  if (typeof value === "boolean") {
    cur[flag] = value;
  } else {
    cur[flag] = !cur[flag];
  }
  await kvSet(key(jid), cur);
  return cur;
}

/** Warn counts: warns:{group}:{userNorm} */
export async function getWarns(groupJid, userNorm) {
  const n = await kvGet(`warns:${groupJid}:${userNorm}`);
  return typeof n === "number" ? n : parseInt(n, 10) || 0;
}

export async function setWarns(groupJid, userNorm, count) {
  await kvSet(`warns:${groupJid}:${userNorm}`, Math.max(0, count));
  return count;
}

export async function addWarn(groupJid, userNorm) {
  const c = (await getWarns(groupJid, userNorm)) + 1;
  await setWarns(groupJid, userNorm, c);
  return c;
}

export async function resetWarns(groupJid, userNorm) {
  await setWarns(groupJid, userNorm, 0);
  return 0;
}

/** Ban list management */
export async function isBanned(groupJid, userNorm) {
  const settings = await getGroupSettings(groupJid);
  const banned = settings.banned || [];
  return banned.includes(userNorm);
}

export async function banUser(groupJid, userNorm) {
  const settings = await getGroupSettings(groupJid);
  const banned = settings.banned || [];
  if (!banned.includes(userNorm)) {
    banned.push(userNorm);
    await setGroupSettings(groupJid, { banned });
  }
  return banned;
}

export async function unbanUser(groupJid, userNorm) {
  const settings = await getGroupSettings(groupJid);
  const banned = (settings.banned || []).filter((b) => b !== userNorm);
  await setGroupSettings(groupJid, { banned });
  return banned;
}
