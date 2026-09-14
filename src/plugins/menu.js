/**
 * Menu / Help Command — image + section-based layout
 */

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

async function buildMenuText() {
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

  let mode = "public";
  try { mode = await getMode(); } catch { /* ignore */ }

  let uptime = "N/A";
  try {
    const s = process.uptime();
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    uptime = h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { /* ignore */ }

  let text = `┌──────────────────────┐\n`;
  text += `│  *${BOT_INFO.NAME}*\n`;
  text += await tr(`│  Owner: @${BOT_INFO.OWNER || "N/A"}\n`, `│  Besitzer: @${BOT_INFO.OWNER || "N/A"}\n`);
  text += await tr(`│  Commands: ${cmds.length}\n`, `│  Befehle: ${cmds.length}\n`);
  text += await tr(`│  Runtime: ${uptime}\n`, `│  Laufzeit: ${uptime}\n`);
  text += `│  Prefix: ${BOT_INFO.PREFIX}\n`;
  text += await tr(`│  Mode: ${mode}\n`, `│  Modus: ${mode}\n`);
  text += `│  Version: ${BOT_INFO.VERSION}\n`;
  text += `└──────────────────────┘\n\n`;

  for (const type of types) {
    const list = byType.get(type);
    const emoji = SECTION_EMOJI[type] || "📦";
    text += `${emoji} *${type.toUpperCase()}*\n`;
    for (const cmd of list.sort((a, b) => a.patternName.localeCompare(b.patternName))) {
      text += `• \`${BOT_INFO.PREFIX}${cmd.patternName}\``;
      if (cmd.desc) text += ` — ${cmd.desc}`;
      text += `\n`;
    }
    text += `\n`;
  }

  text += await tr(`_Reply with a command to use it._`, `_Antworte mit einem Befehl, um ihn zu nutzen._`);
  return text;
}

async function sendMenu(message, conn) {
  const text = await buildMenuText();
  try {
    const img = await readFile(MENU_IMAGE);
    await conn.sendMessage(message.from, { image: img, caption: text },
      { quoted: { key: message.key, message: message.message } });
  } catch {
    await reply(conn, message, text);
  }
}

command(
  { pattern: "menu", fromMe: false, desc: "Show all commands", type: "misc" },
  sendMenu
);

command(
  { pattern: "help", fromMe: false, desc: "Show menu or help for one command", type: "misc", dontAddCommandList: true },
  async (message, conn) => {
    const args = (message.body || "").replace(new RegExp(`^\\${BOT_INFO.PREFIX}\\s*help\\s*`, "i"), "").trim().toLowerCase();
    if (!args) { await sendMenu(message, conn); return; }
    const cmds = getMenuCommands();
    const hit = cmds.find((c) => c.patternName === args) || cmds.find((c) => c.patternName.startsWith(args));
    if (!hit) {
      const suggestions = cmds.filter((c) => c.patternName.includes(args)).slice(0, 5).map((c) => `\`${c.patternName}\``);
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

    // Must be group admin (or privileged) to touch the kill-switch.
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
