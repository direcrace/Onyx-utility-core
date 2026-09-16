

import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  withTyping,
  tr,
} from "../utils/message.js";
import {
  getGroupSettings,
  setGroupSettings,
  toggleGroupFlag,
  addWarn,
  getWarns,
  resetWarns,
} from "../utils/groupSettings.js";
import { resolveTargetUser, displayId, kickUser } from "../utils/group.js";
import {
  botBanUser,
  botUnbanUser,
  listBotBans,
} from "../utils/globalBan.js";
import { normalizeNumber } from "../utils/access.js";
import { t } from "../utils/i18n.js";
import { BOT_INFO } from "../config/constants.js";

function onOff(v) {
  return v ? "ON" : "OFF";
}

command(
  { pattern: "welcome", fromMe: false, desc: "Toggle/set welcome message", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "welcome") || "").trim();
    if (!args) { const s = await toggleGroupFlag(message.from, "welcome"); await replyOk(conn, message, s.welcome ? await t("WELCOME_ON") : await t("WELCOME_OFF")); return; }
    if (args === "on" || args === "off") { await setGroupSettings(message.from, { welcome: args === "on" }); await replyOk(conn, message, args === "on" ? await t("WELCOME_ON") : await t("WELCOME_OFF")); return; }
    await setGroupSettings(message.from, { welcome: true, welcomeText: args });
    await replyOk(conn, message, await tr("Welcome text updated & enabled.", "Begrüßungstext aktualisiert & aktiviert."));
  }
);

command(
  { pattern: "goodbye", fromMe: false, desc: "Toggle/set goodbye message", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "goodbye") || "").trim();
    if (!args) { const s = await toggleGroupFlag(message.from, "goodbye"); await replyOk(conn, message, s.goodbye ? await t("GOODBYE_ON") : await t("GOODBYE_OFF")); return; }
    if (args === "on" || args === "off") { await setGroupSettings(message.from, { goodbye: args === "on" }); await replyOk(conn, message, args === "on" ? await t("GOODBYE_ON") : await t("GOODBYE_OFF")); return; }
    await setGroupSettings(message.from, { goodbye: true, goodbyeText: args });
    await replyOk(conn, message, await tr("Goodbye text updated & enabled.", "Abschiedstext aktualisiert & aktiviert."));
  }
);

command(
  { pattern: "antilink", fromMe: false, desc: "Configure anti-link (on|off|delete|warn|strict|kick|ban)", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antilink") || "").trim().toLowerCase();
    const valid = ["delete", "warn", "strict", "kick", "ban"];
    if (!args || args === "on") { const s = await setGroupSettings(message.from, { antilink: true }); await replyOk(conn, message, await tr(`Anti-link: *ON* (action: ${s.antilinkAction})`, `Anti-Link: *AN* (Aktion: ${s.antilinkAction})`)); return; }
    if (args === "off") { await setGroupSettings(message.from, { antilink: false }); await replyOk(conn, message, await tr("Anti-link: *OFF*", "Anti-Link: *AUS*")); return; }
    if (valid.includes(args)) { await setGroupSettings(message.from, { antilink: true, antilinkAction: args }); await replyOk(conn, message, await tr(`Anti-link: *ON* (action: *${args}*)`, `Anti-Link: *AN* (Aktion: *${args}*)`)); return; }
    await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}antilink on|off|delete|warn|strict|kick|ban\``, `Benutzung: \`${BOT_INFO.PREFIX}antilink on|off|delete|warn|strict|kick|ban\``));
  }
);

command(
  { pattern: "antispam", fromMe: false, desc: "Configure anti-spam (on|off|delete|warn|strict|kick|ban)", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antispam") || "").trim().toLowerCase();
    const valid = ["delete", "warn", "strict", "kick", "ban"];
    let s;
    if (args === "on") { s = await setGroupSettings(message.from, { antispam: true }); }
    else if (args === "off") { s = await setGroupSettings(message.from, { antispam: false }); }
    else if (valid.includes(args)) { s = await setGroupSettings(message.from, { antispam: true, antispamAction: args }); await replyOk(conn, message, await tr(`Anti-spam: *ON* (action: *${args}*)`, `Anti-Spam: *AN* (Aktion: *${args}*)`)); return; }
    else { s = await toggleGroupFlag(message.from, "antispam"); }
    await replyOk(conn, message, await tr(`Anti-spam: *${onOff(s.antispam)}* (action: ${s.antispamAction} · ${s.antispamLimit}/${s.antispamWindowMs}ms)`, `Anti-Spam: *${onOff(s.antispam)}* (Aktion: ${s.antispamAction} · ${s.antispamLimit}/${s.antispamWindowMs}ms)`));
  }
);

command(
  { pattern: "antitag", fromMe: false, desc: "Block everyone-tags (on|off|delete|warn|kick)", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antitag") || "").trim().toLowerCase();
    const valid = ["delete", "warn", "kick"];
    if (!args || args === "on") { const s = await setGroupSettings(message.from, { antitag: true }); await replyOk(conn, message, await tr(`Anti-tag: *ON* (action: ${s.antitagAction})`, `Anti-Tag: *AN* (Aktion: ${s.antitagAction})`)); return; }
    if (args === "off") { await setGroupSettings(message.from, { antitag: false }); await replyOk(conn, message, await tr("Anti-tag: *OFF*", "Anti-Tag: *AUS*")); return; }
    if (valid.includes(args)) { await setGroupSettings(message.from, { antitag: true, antitagAction: args }); await replyOk(conn, message, await tr(`Anti-tag: *ON* (action: *${args}*)`, `Anti-Tag: *AN* (Aktion: *${args}*)`)); return; }
    await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}antitag on|off|delete|warn|kick\``, `Benutzung: \`${BOT_INFO.PREFIX}antitag on|off|delete|warn|kick\``));
  }
);

command(
  { pattern: "antibot", fromMe: false, desc: "Detect other bots (on|off|delete|warn|kick)", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antibot") || "").trim().toLowerCase();
    const valid = ["delete", "warn", "kick"];
    if (!args || args === "on") { const s = await setGroupSettings(message.from, { antibot: true }); await replyOk(conn, message, await tr(`Anti-bot: *ON* (action: ${s.antibotAction})`, `Anti-Bot: *AN* (Aktion: ${s.antibotAction})`)); return; }
    if (args === "off") { await setGroupSettings(message.from, { antibot: false }); await replyOk(conn, message, await tr("Anti-bot: *OFF*", "Anti-Bot: *AUS*")); return; }
    if (valid.includes(args)) { await setGroupSettings(message.from, { antibot: true, antibotAction: args }); await replyOk(conn, message, await tr(`Anti-bot: *ON* (action: *${args}*)`, `Anti-Bot: *AN* (Aktion: *${args}*)`)); return; }
    await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}antibot on|off|delete|warn|kick\``, `Benutzung: \`${BOT_INFO.PREFIX}antibot on|off|delete|warn|kick\``));
  }
);

command(
  { pattern: "antisticker", fromMe: false, desc: "Block stickers (on|off|delete|warn|strict|kick|ban)", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antisticker") || "").trim().toLowerCase();
    const valid = ["delete", "warn", "strict", "kick", "ban"];
    if (!args || args === "on") { const s = await setGroupSettings(message.from, { antisticker: true }); await replyOk(conn, message, await tr(`Anti-sticker: *ON* (action: ${s.antistickerAction})`, `Anti-Sticker: *AN* (Aktion: ${s.antistickerAction})`)); return; }
    if (args === "off") { await setGroupSettings(message.from, { antisticker: false }); await replyOk(conn, message, await tr("Anti-sticker: *OFF*", "Anti-Sticker: *AUS*")); return; }
    if (valid.includes(args)) { await setGroupSettings(message.from, { antisticker: true, antistickerAction: args }); await replyOk(conn, message, await tr(`Anti-sticker: *ON* (action: *${args}*)`, `Anti-Sticker: *AN* (Aktion: *${args}*)`)); return; }
    await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}antisticker on|off|delete|warn|strict|kick|ban\``, `Benutzung: \`${BOT_INFO.PREFIX}antisticker on|off|delete|warn|strict|kick|ban\``));
  }
);

command(
  { pattern: "antidelete", fromMe: false, desc: "Recover deleted messages (on|off)", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antidelete") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { antidelete: args === "on" }); } else { s = await toggleGroupFlag(message.from, "antidelete"); }
    await replyOk(conn, message, await tr(`Anti-delete: *${onOff(s.antidelete)}*`, `Anti-Löschen: *${onOff(s.antidelete)}*`));
  }
);

command(
  { pattern: "onlyadmin", fromMe: false, desc: "Restrict bot commands to admins only", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "onlyadmin") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { onlyadmin: args === "on" }); } else { s = await toggleGroupFlag(message.from, "onlyadmin"); }
    await replyOk(conn, message, await tr(`Only-Admin mode: *${onOff(s.onlyadmin)}*`, `Nur-Admin-Modus: *${onOff(s.onlyadmin)}*`));
  }
);

command(
  { pattern: "nsfw", fromMe: false, desc: "Toggle NSFW content permission", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "nsfw") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { nsfw: args === "on" }); } else { s = await toggleGroupFlag(message.from, "nsfw"); }
    await replyOk(conn, message, await tr(`NSFW: *${onOff(s.nsfw)}*`, `NSFW: *${onOff(s.nsfw)}*`));
  }
);

async function autoapproveHandler(message, conn) {
  const args = (getCommandArgs(message.body, "autoapprove") || getCommandArgs(message.body, "autoaccept") || "").trim().toLowerCase();
  let s;
  if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { autoapprove: args === "on" }); } else { s = await toggleGroupFlag(message.from, "autoapprove"); }
  await replyOk(conn, message, await tr(`Auto-approve: *${onOff(s.autoapprove)}*`, `Auto-Zulassung: *${onOff(s.autoapprove)}*`));
}

const autoApproveCmd = {
  pattern: "autoapprove",
  fromMe: false,
  desc: "Auto-approve pending group joins",
  type: "moderation",
  groupOnly: true,
  adminOnly: true,
};

command(autoApproveCmd, autoapproveHandler);
command(
  { pattern: "autoaccept", fromMe: false, desc: "Alias for autoapprove", type: "moderation", groupOnly: true, adminOnly: true },
  autoapproveHandler
);

command(
  { pattern: "autoread", fromMe: false, desc: "Auto-read all messages in this group", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "autoread") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { autoread: args === "on" }); } else { s = await toggleGroupFlag(message.from, "autoread"); }
    await replyOk(conn, message, await tr(`Auto-read: *${onOff(s.autoread)}*`, `Auto-Lesen: *${onOff(s.autoread)}*`));
  }
);

command(
  { pattern: "autoreact", fromMe: false, desc: "Auto-react with emoji (set emoji or 'off')", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "autoreact") || "").trim();
    if (!args || args === "off") { await setGroupSettings(message.from, { autoreact: "" }); await replyOk(conn, message, await tr("Auto-react: *OFF*", "Auto-Reaktion: *AUS*")); return; }
    const emoji = args.split(/\s+/)[0];
    await setGroupSettings(message.from, { autoreact: emoji });
    await replyOk(conn, message, await tr(`Auto-react: *${emoji}*`, `Auto-Reaktion: *${emoji}*`));
  }
);

command(
  { pattern: "autotyping", fromMe: false, desc: "Show typing indicator on all messages", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "autotyping") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { autotyping: args === "on" }); } else { s = await toggleGroupFlag(message.from, "autotyping"); }
    await replyOk(conn, message, await tr(`Auto-typing: *${onOff(s.autotyping)}*`, `Auto-Tippen: *${onOff(s.autotyping)}*`));
  }
);

command(
  { pattern: "alwaysonline", fromMe: false, desc: "Keep bot permanently online", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "alwaysonline") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") { s = await setGroupSettings(message.from, { alwaysonline: args === "on" }); } else { s = await toggleGroupFlag(message.from, "alwaysonline"); }
    await replyOk(conn, message, await tr(`Always-online: *${onOff(s.alwaysonline)}*`, `Immer-online: *${onOff(s.alwaysonline)}*`));
  }
);

command(
  { pattern: "warn", fromMe: false, desc: "Warn a user (kick at limit)", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const target = resolveTargetUser(message);
      if (!target) { await replyFail(conn, message, await tr(`Reply/mention a user.\nUsage: ${BOT_INFO.PREFIX}warn @user`, `Antworte/erwähne einen User.\nBenutzung: ${BOT_INFO.PREFIX}warn @user`)); return; }
      const settings = await getGroupSettings(message.from);
      const norm = normalizeNumber(target) || target;
      const count = await addWarn(message.from, norm);
      const limit = settings.warnLimit || 3;
      const text = (await t("WARNED", { count, limit })).replace("@user", `@${displayId(target)}`);
      await conn.sendMessage(message.from, { text, mentions: [target] });
      if (count >= limit) {
        try {
          await kickUser(conn, message.from, target);
          await resetWarns(message.from, norm);
          const kicked = (await t("KICKED_WARNS")).replace("@user", `@${displayId(target)}`);
          await conn.sendMessage(message.from, { text: kicked, mentions: [target] });
        } catch { await replyFail(conn, message, await tr("Could not remove user (need admin).", "Konnte User nicht entfernen (Admin nötig).")); }
      }
    });
  }
);

command(
  { pattern: "unwarn", fromMe: false, desc: "Reset warns for a user", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) { await replyFail(conn, message, await tr("Reply/mention a user.", "Antworte/erwähne einen User.")); return; }
    const norm = normalizeNumber(target) || target;
    await resetWarns(message.from, norm);
    await replyOk(conn, message, await tr(`Warns reset for @${displayId(target)}`, `Verwarnungen für @${displayId(target)} zurückgesetzt`));
  }
);

command(
  { pattern: "warns", fromMe: false, desc: "Show warn count", type: "moderation", groupOnly: true },
  async (message, conn) => {
    const target = resolveTargetUser(message) || message.sender;
    const norm = normalizeNumber(target) || target;
    const count = await getWarns(message.from, norm);
    const settings = await getGroupSettings(message.from);
    await reply(conn, message, await tr(`Warns for @${displayId(target)}: *${count}/${settings.warnLimit}*`, `Verwarnungen für @${displayId(target)}: *${count}/${settings.warnLimit}*`));
  }
);

command(
  { pattern: "mute", fromMe: false, desc: "Mute a user in this group", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) { await replyFail(conn, message, await tr("Reply/mention a user.", "Antworte/erwähne einen User.")); return; }
    const s = await getGroupSettings(message.from);
    const n = normalizeNumber(target) || target;
    if (!s.muted.includes(n)) s.muted.push(n);
    await setGroupSettings(message.from, { muted: s.muted });
    await replyOk(conn, message, await tr(`Muted @${displayId(target)}`, `@${displayId(target)} stummgeschaltet`));
  }
);

command(
  { pattern: "unmute", fromMe: false, desc: "Unmute a user", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) { await replyFail(conn, message, await tr("Reply/mention a user.", "Antworte/erwähne einen User.")); return; }
    const s = await getGroupSettings(message.from);
    const n = normalizeNumber(target) || target;
    await setGroupSettings(message.from, { muted: (s.muted || []).filter((x) => x !== n) });
    await replyOk(conn, message, await tr(`Unmuted @${displayId(target)}`, `@${displayId(target)} nicht mehr stummgeschaltet`));
  }
);

command(
  { pattern: "kick", fromMe: false, desc: "Remove a member", type: "moderation", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) { await replyFail(conn, message, await tr("Reply/mention a user.", "Antworte/erwähne einen User.")); return; }
    try { await kickUser(conn, message.from, target); await replyOk(conn, message, await tr(`Removed @${displayId(target)}`, `@${displayId(target)} entfernt`)); }
    catch { await replyFail(conn, message, await tr("Failed to kick (bot must be admin).", "Kick fehlgeschlagen (Bot muss Admin sein).")); }
  }
);

command(
  { pattern: "ban", fromMe: true, desc: "Ban a user from the bot globally (owner)", type: "owner" },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) { await replyFail(conn, message, await tr("Reply/mention a user to ban from the bot.", "Antworte/erwähne einen User, um ihn vom Bot zu bannen.")); return; }
    try {
      const norm = await botBanUser(target);
      await replyOk(conn, message, await tr(`@${displayId(target)} is now banned from the bot globally.`, `@${displayId(target)} ist jetzt global vom Bot gebannt.`));
      return norm;
    } catch { await replyFail(conn, message, await tr("Failed to ban user.", "Ban fehlgeschlagen.")); }
  }
);

command(
  { pattern: "unban", fromMe: true, desc: "Remove a global bot ban (owner)", type: "owner" },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) { await replyFail(conn, message, await tr("Reply/mention a user to unban.", "Antworte/erwähne einen User zum Entbannen.")); return; }
    await botUnbanUser(target);
    await replyOk(conn, message, await tr(`@${displayId(target)} unbanned.`, `@${displayId(target)} entbannt.`));
  }
);

command(
  { pattern: "banlist", fromMe: true, desc: "List globally banned users (owner)", type: "owner" },
  async (message, conn) => {
    const banned = await listBotBans();
    if (!banned.length) { await reply(conn, message, await tr("*Global ban list:* _(empty)_", "*Globale Bannliste:* _(leer)_")); return; }
    await reply(conn, message, await tr(`*Global ban list:*\n${banned.map((n, i) => `${i + 1}. ${n}`).join("\n")}`, `*Globale Bannliste:*\n${banned.map((n, i) => `${i + 1}. ${n}`).join("\n")}`));
  }
);

command(
  { pattern: "groupsettings", fromMe: false, desc: "Show all group moderation settings", type: "moderation", groupOnly: true, adminOnly: true },
  async (message, conn) => {
    const s = await getGroupSettings(message.from);
    await reply(conn, message, await tr(
      `*Group Settings*\n\n` +
      `*Messages:*\n• Welcome: ${onOff(s.welcome)}\n• Goodbye: ${onOff(s.goodbye)}\n\n` +
      `*Protection:*\n• Anti-link: ${onOff(s.antilink)} (${s.antilinkAction})\n• Anti-spam: ${onOff(s.antispam)} (${s.antispamAction})\n• Anti-bot: ${onOff(s.antibot)} (${s.antibotAction})\n• Anti-tag: ${onOff(s.antitag)} (${s.antitagAction})\n• Anti-delete: ${onOff(s.antidelete)}\n• Anti-sticker: ${onOff(s.antisticker)} (${s.antistickerAction})\n\n` +
      `*Access:*\n• Only-admin: ${onOff(s.onlyadmin)}\n• NSFW: ${onOff(s.nsfw)}\n• Auto-approve: ${onOff(s.autoapprove)}\n• Bot: ${s.botDisabled ? "OFF" : "ON"}\n\n` +
      `*Automation:*\n• Auto-read: ${onOff(s.autoread)}\n• Auto-react: ${s.autoreact || "OFF"}\n• Auto-typing: ${onOff(s.autotyping)}\n• Always-online: ${onOff(s.alwaysonline)}\n\n` +
      `*Enforcement:*\n• Warn limit: ${s.warnLimit}\n• Muted: ${s.muted.length}\n• Banned: ${s.banned.length}\n• Disabled cmds: ${s.disabledPlugins.join(", ") || "none"}`,
      `*Gruppen-Einstellungen*\n\n` +
      `*Nachrichten:*\n• Willkommen: ${onOff(s.welcome)}\n• Abschied: ${onOff(s.goodbye)}\n\n` +
      `*Schutz:*\n• Anti-Link: ${onOff(s.antilink)} (${s.antilinkAction})\n• Anti-Spam: ${onOff(s.antispam)} (${s.antispamAction})\n• Anti-Bot: ${onOff(s.antibot)} (${s.antibotAction})\n• Anti-Tag: ${onOff(s.antitag)} (${s.antitagAction})\n• Anti-Löschen: ${onOff(s.antidelete)}\n• Anti-Sticker: ${onOff(s.antisticker)} (${s.antistickerAction})\n\n` +
      `*Zugang:*\n• Nur-Admin: ${onOff(s.onlyadmin)}\n• NSFW: ${onOff(s.nsfw)}\n• Auto-Zulassung: ${onOff(s.autoapprove)}\n• Bot: ${s.botDisabled ? "AUS" : "AN"}\n\n` +
      `*Automatisierung:*\n• Auto-Lesen: ${onOff(s.autoread)}\n• Auto-Reaktion: ${s.autoreact || "OFF"}\n• Auto-Tippen: ${onOff(s.autotyping)}\n• Immer-online: ${onOff(s.alwaysonline)}\n\n` +
      `*Durchsetzung:*\n• Warn-Grenze: ${s.warnLimit}\n• Stummgeschaltet: ${s.muted.length}\n• Gebannt: ${s.banned.length}\n• Deaktivierte Befehle: ${s.disabledPlugins.join(", ") || "keine"}`
    ));
  }
);

command(
  { pattern: "gcstatus", fromMe: false, desc: "Quick group status overview", type: "moderation", groupOnly: true },
  async (message, conn) => {
    const s = await getGroupSettings(message.from);
    const p = [s.antilink && "🔗", s.antispam && "🛑", s.antibot && "🤖", s.antitag && "👥", s.antidelete && "🗑️"].filter(Boolean);
    await reply(conn, message, await tr(
      `*Group Status*\n• Protections: ${p.join(" ") || "None"}\n• Admin-only: ${onOff(s.onlyadmin)}\n• Muted: ${s.muted.length} | Banned: ${s.banned.length}\n• Warn limit: ${s.warnLimit}`,
      `*Gruppen-Status*\n• Schutz: ${p.join(" ") || "Keiner"}\n• Nur-Admin: ${onOff(s.onlyadmin)}\n• Stumm: ${s.muted.length} | Gebannt: ${s.banned.length}\n• Warn-Grenze: ${s.warnLimit}`
    ));
  }
);
