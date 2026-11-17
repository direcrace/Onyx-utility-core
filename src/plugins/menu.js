

import { command, getMenuCommands } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getMode, isPrivileged } from "../utils/access.js";
import { isAdmin } from "../utils/group.js";
import { getGroupSettings, setGroupSettings } from "../utils/groupSettings.js";
import { groupCache } from "../utils/cache.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MENU_IMAGE = join(__dirname, "..", "assets", "menu.png");

const SECTION_ORDER = [
  "ai", "moderation", "fun", "search", "voice",
  "media", "sticker", "group", "admin", "info",
  "productivity", "owner", "misc",
];

const SECTION_EMOJI = {
  ai: "🧠", moderation: "🛡️", fun: "🎮", search: "🔍", voice: "🎵",
  media: "📥", sticker: "🎨", group: "👥", admin: "⚙️", info: "ℹ️",
  productivity: "📋", owner: "👑", misc: "📦",
};

const SECTION_LABEL = {
  ai: "AI", moderation: "Moderation", fun: "Fun", search: "Search",
  voice: "Voice", media: "Media", sticker: "Stickers", group: "Group",
  admin: "Admin", info: "Info", productivity: "Productivity",
  owner: "Owner", misc: "Misc",
};

function categorize() {
  const cmds = getMenuCommands();
  const byType = new Map();
  for (const cmd of cmds) {
    const type = cmd.type || "misc";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(cmd);
  }
  const types = [
    ...SECTION_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !SECTION_ORDER.includes(t)).sort(),
  ];
  return { cmds, byType, types };
}

function emoji(type) {
  return SECTION_EMOJI[type] || "📦";
}

function label(type) {
  return SECTION_LABEL[type] || String(type).toUpperCase();
}

async function headerLines() {
  let mode = "public";
  try { mode = await getMode(); } catch {  }

  let uptime = "N/A";
  try {
    const s = process.uptime();
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    uptime = h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch {  }

  return [
    `│  *${BOT_INFO.NAME}*`,
    await tr(`│  Owner: @${BOT_INFO.OWNER || "N/A"}`, `│  Besitzer: @${BOT_INFO.OWNER || "N/A"}`),
    `│  Prefix: ${BOT_INFO.PREFIX}`,
    await tr(`│  Mode: ${mode}`, `│  Modus: ${mode}`),
    await tr(`│  Runtime: ${uptime}`, `│  Laufzeit: ${uptime}`),
    `│  Version: ${BOT_INFO.VERSION}`,
  ];
}

async function overviewText() {
  const { cmds, byType, types } = categorize();

  let text = `┌──────────────────────┐\n`;
  for (const line of await headerLines()) text += `${line}\n`;
  text += await tr(`│  Commands: ${cmds.length}\n`, `│  Befehle: ${cmds.length}\n`);
  text += `└──────────────────────┘\n\n`;

  text += await tr(
    `*Categories* — open one with \`${BOT_INFO.PREFIX}menu <number>\`:\n\n`,
    `*Kategorien* — öffne eine mit \`${BOT_INFO.PREFIX}menu <Nummer>\`:\n\n`
  );

  types.forEach((type, i) => {
    text += `*${i + 1}.* ${emoji(type)} ${label(type)} — ${byType.get(type).length}\n`;
  });

  text += `\n` + await tr(
    `_Example: \`${BOT_INFO.PREFIX}menu 2\`_`,
    `_Beispiel: \`${BOT_INFO.PREFIX}menu 2\`_`
  );
  return text;
}

async function categoryText(type) {
  const { byType } = categorize();
  const list = byType.get(type);
  if (!list) return null;

  let text = `${emoji(type)} *${label(type).toUpperCase()}*\n\n`;
  for (const cmd of list.sort((a, b) => a.patternName.localeCompare(b.patternName))) {
    text += `• \`${BOT_INFO.PREFIX}${cmd.patternName}\``;
    if (cmd.desc) text += ` — ${cmd.desc}`;
    text += `\n`;
  }
  return text;
}

function resolveCategory(arg) {
  if (!arg) return null;
  const { types } = categorize();
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= types.length) return types[n - 1];
  const lower = arg.toLowerCase();
  return types.find((t) => t === lower) || types.find((t) => t.startsWith(lower)) || null;
}

async function sendWithImage(message, conn, text) {
  try {
    const img = await readFile(MENU_IMAGE);
    await conn.sendMessage(message.from, { image: img, caption: text },
      { quoted: { key: message.key, message: message.message } });
  } catch {
    await reply(conn, message, text);
  }
}

async function sendMenu(message, conn, arg) {
  if (arg) {
    const type = resolveCategory(arg);
    if (type) {
      await sendWithImage(message, conn, await categoryText(type));
      return;
    }
  }
  await sendWithImage(message, conn, await overviewText());
}

command(
  { pattern: "menu", fromMe: false, desc: "Show categories, or one category with `menu <number>`", type: "misc" },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "menu") || "").trim();
    await sendMenu(message, conn, arg);
  }
);

command(
  { pattern: "help", fromMe: false, desc: "Menu, a category, or help for one command", type: "misc", dontAddCommandList: true },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "help") || "").trim();
    if (!arg) { await sendMenu(message, conn); return; }

    const type = resolveCategory(arg);
    if (type) { await sendWithImage(message, conn, await categoryText(type)); return; }

    const cmds = getMenuCommands();
    const lower = arg.toLowerCase();
    const hit = cmds.find((c) => c.patternName === lower) || cmds.find((c) => c.patternName.startsWith(lower));
    if (!hit) {
      const suggestions = cmds.filter((c) => c.patternName.includes(lower)).slice(0, 5).map((c) => `\`${c.patternName}\``);
      await reply(conn, message, suggestions.length ? await tr(`Unknown. Did you mean: ${suggestions.join(", ")}?`, `Unbekannt. Meintest du: ${suggestions.join(", ")}?`) : await tr(`Unknown command. Try \`${BOT_INFO.PREFIX}menu\`.`, `Unbekannter Befehl. Versuche \`${BOT_INFO.PREFIX}menu\`.`));
      return;
    }
    await reply(conn, message, await tr(`*${BOT_INFO.PREFIX}${hit.patternName}*\n${hit.desc || "_No description_"}\nType: ${hit.type}${hit.groupOnly ? " · group" : ""}${hit.adminOnly ? " · admin" : ""}${hit.fromMe ? " · owner" : ""}`, `*${BOT_INFO.PREFIX}${hit.patternName}*\n${hit.desc || "_Keine Beschreibung_"}\nTyp: ${hit.type}${hit.groupOnly ? " · Gruppe" : ""}${hit.adminOnly ? " · Admin" : ""}${hit.fromMe ? " · Besitzer" : ""}`));
  }
);

command(
  { pattern: "bot", fromMe: false, desc: "Bot info · `#bot on|off` kills the bot for this group", type: "misc", dontAddCommandList: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "bot") || "").trim().toLowerCase();
    if (!args) { await sendMenu(message, conn); return; }

    if (args !== "on" && args !== "off" && args !== "status") {
      await sendMenu(message, conn);
      return;
    }

    if (!message.isGroup) {
      await replyFail(conn, message, await tr("This only works in groups.", "Das funktioniert nur in Gruppen."));
      return;
    }

    let meta = groupCache.get(message.from);
    if (!meta) {
      try { meta = await conn.groupMetadata(message.from); groupCache.set(message.from, meta); } catch { meta = null; }
    }
    const admin = !!meta && (isAdmin(meta, message.sender) || isAdmin(meta, message.participant) || isAdmin(meta, message.participantAlt));
    if (!admin && !(await isPrivileged(message, conn))) {
      await replyFail(conn, message, await tr("Only group admins can do this.", "Nur Gruppen-Admins können das tun."));
      return;
    }

    const s = await getGroupSettings(message.from);
    if (args === "status") {
      await reply(conn, message, s.botDisabled
        ? await tr("🤖 The bot is currently *OFF* for this group. Send `#bot on` (admins only) to re-enable.", "🤖 Der Bot ist in dieser Gruppe aktuell *AUS*. Sende `#bot on` (nur Admins), um ihn zu aktivieren.")
        : await tr("🤖 The bot is *ON* for this group.", "🤖 Der Bot ist in dieser Gruppe *AN*."));
      return;
    }
    const next = args === "on";
    if (next === !s.botDisabled) {
      await reply(conn, message, s.botDisabled
        ? await tr("🤖 Bot is already *OFF* in this group.", "🤖 Der Bot ist in dieser Gruppe bereits *AUS*.")
        : await tr("🤖 Bot is already *ON* in this group.", "🤖 Der Bot ist in dieser Gruppe bereits *AN*."));
      return;
    }
    await setGroupSettings(message.from, { botDisabled: !next });
    if (next) {
      await replyOk(conn, message, await tr("🤖 Bot *ON* for this group.", "🤖 Bot *AN* für diese Gruppe."));
    } else {
      await replyOk(conn, message, await tr("🤖 Bot *OFF* for this group. I'm now completely silent here (admins can run `#bot on` to re-enable).", "🤖 Bot *AUS* für diese Gruppe. Ich bin jetzt hier komplett stumm (Admins können `#bot on` senden, um mich zu aktivieren)."));
    }
  }
);
