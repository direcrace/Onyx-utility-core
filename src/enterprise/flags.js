/**
 * Global feature flags / kill switches
 */

import { kvGet, kvSet } from "../database/botKv.js";

const KEY = "feature_flags";

/** Defaults — all on unless flipped */
const DEFAULTS = {
  media: true,
  ytdl: true,
  social: true,
  stickers: true,
  moderation: true,
  broadcast: true,
  games: false,
  maintenance: false, // when true: only owner/sudo can run anything
};

let cache = null;

async function load() {
  if (cache) return cache;
  const stored = await kvGet(KEY);
  cache = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  return cache;
}

async function save(flags) {
  cache = flags;
  await kvSet(KEY, flags);
}

export async function getFlags() {
  return { ...(await load()) };
}

export async function setFlag(name, value) {
  const flags = await load();
  const key = String(name).toLowerCase();
  if (!(key in DEFAULTS) && key !== "maintenance") {
    // allow custom flags too
  }
  flags[key] = !!value;
  await save(flags);
  return flags;
}

export async function isFlagEnabled(name) {
  const flags = await load();
  if (flags.maintenance) return name === "maintenance" ? true : false;
  if (!(name in flags)) return true;
  return !!flags[name];
}

/** Map command → required flag (optional) */
export const COMMAND_FLAGS = {
  ytmp3: "ytdl",
  ytmp4: "ytdl",
  yt: "ytdl",
  ytdl: "ytdl",
  play: "ytdl",
  ig: "social",
  insta: "social",
  tiktok: "social",
  tt: "social",
  fb: "social",
  sticker: "stickers",
  s: "stickers",
  take: "stickers",
  steal: "stickers",
  toimg: "stickers",
  ttp: "stickers",
  attp: "stickers",
  quote: "stickers",
  tomp3: "media",
  tourl: "media",
  url: "media",
  removebg: "media",
  tts: "media",
  warn: "moderation",
  kick: "moderation",
  mute: "moderation",
  antilink: "moderation",
  antispam: "moderation",
  broadcast: "broadcast",
};

export async function checkCommandFlag(commandName) {
  const flags = await load();
  if (flags.maintenance) {
    return { ok: false, reason: "MAINTENANCE", flag: "maintenance" };
  }
  const flag = COMMAND_FLAGS[commandName];
  if (!flag) return { ok: true };
  if (flags[flag] === false) {
    return { ok: false, reason: "FLAG_OFF", flag };
  }
  return { ok: true, flag };
}
