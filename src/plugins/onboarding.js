/**
 * Onboarding, log-group, status, groupsetup, help
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import {
  ensureLogGroup,
  getLogGroupJid,
  setLogGroupJid,
  systemLog,
  isSetupDone,
} from "../utils/logGroup.js";
import { kvDel } from "../database/botKv.js";
import { runSetupCommand, checkFfmpeg } from "../onboarding/setup.js";
import {
  setGroupSettings,
} from "../utils/groupSettings.js";
import { getMode, isOwnerMessage, isPrivileged } from "../utils/access.js";
import { getLang } from "../utils/i18n.js";
import { BOT_INFO } from "../config/constants.js";
import os from "os";

command(
  {
    pattern: "createlog",
    fromMe: true,
    desc: "Create/recreate the system log group",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, await tr("Owner/sudo only.", "Nur Besitzer/Sudo."));
      return;
    }
    await kvDel("log_group_jid");
    const res = await ensureLogGroup(conn);
    if (res.needsManual) {
      await replyFail(
        conn,
        message,
        await tr("Set OWNER_NUMBER in .env, or create a group, add the bot, then `#setlog`.", "Setze OWNER_NUMBER in .env, oder erstelle eine Gruppe, füge den Bot hinzu, dann `#setlog`.")
      );
      return;
    }
    if (!res.jid) {
      await replyFail(conn, message, await tr(`Failed: ${res.error || "unknown"}`, `Fehlgeschlagen: ${res.error || "unbekannt"}`));
      return;
    }
    await replyOk(
      conn,
      message,
      await tr(`${res.created ? "Created" : "Using"} system group:\n\`${res.jid}\``, `${res.created ? "Erstellt" : "Nutze"} Systemgruppe:\n\`${res.jid}\``)
    );
  }
);

command(
  {
    pattern: "setlog",
    fromMe: true,
    desc: "Mark this group as the system log group",
    type: "owner",
    groupOnly: true,
  },
  async (message, conn) => {
    if (!isOwnerMessage(message, conn) && !message.key.fromMe) {
      await replyFail(conn, message, await tr("Owner only.", "Nur Besitzer."));
      return;
    }
    if (!message.isGroup) {
      await replyFail(conn, message, await tr("Run inside a group.", "Starte den Befehl in einer Gruppe."));
      return;
    }
    await setLogGroupJid(message.from);
    await replyOk(
      conn,
      message,
      await tr(
        "This group is now the *system log / onboarding* chat.\n" +
          `Run \`${BOT_INFO.PREFIX}setup\` here.\n` +
          "_Errors will only be posted in this group._",
        "Diese Gruppe ist jetzt der *System-Log-/Onboarding*-Chat.\n" +
          `Führe hier \`${BOT_INFO.PREFIX}setup\` aus.\n` +
          "_Fehler werden nur in dieser Gruppe gepostet._"
      )
    );
    await systemLog("success", `Log group set to ${message.from}`);
  }
);

command(
  {
    pattern: "setup",
    fromMe: true,
    desc: "Onboarding wizard (system log group only)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, await tr("Owner/sudo only.", "Nur Besitzer/Sudo."));
      return;
    }
    const args = getCommandArgs(message.body, "setup") || "";
    let result = await runSetupCommand(message, conn, args);
    if (result.continue) {
      result = await runSetupCommand(message, conn, "start");
    }
    if (result.ok) await reply(conn, message, result.text);
    else await replyFail(conn, message, result.text);
  }
);

command(
  {
    pattern: "groupsetup",
    fromMe: false,
    desc: "Quick group moderation setup",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "groupsetup") || "")
      .trim()
      .toLowerCase();

    if (!args || args === "help") {
      await reply(
        conn,
        message,
        await tr(
          `*Group setup*\n\n` +
            `\`${BOT_INFO.PREFIX}groupsetup recommended\` — welcome + antilink + antispam on\n` +
            `\`${BOT_INFO.PREFIX}groupsetup minimal\` — welcome only\n` +
            `\`${BOT_INFO.PREFIX}groupsetup off\` — disable welcome/goodbye/antilink/antispam\n\n` +
            `Then tweak with \`${BOT_INFO.PREFIX}groupsettings\``,
          `*Gruppen-Setup*\n\n` +
            `\`${BOT_INFO.PREFIX}groupsetup recommended\` — Willkommen + Antilink + Antispam an\n` +
            `\`${BOT_INFO.PREFIX}groupsetup minimal\` — nur Willkommen\n` +
            `\`${BOT_INFO.PREFIX}groupsetup off\` — Willkommen/Abschied/Antilink/Antispam aus\n\n` +
            `Danach mit \`${BOT_INFO.PREFIX}groupsettings\` anpassen`
        )
      );
      return;
    }

    if (args === "recommended" || args === "full") {
      await setGroupSettings(message.from, {
        welcome: true,
        goodbye: true,
        antilink: true,
        antispam: true,
      });
      await replyOk(
        conn,
        message,
        await tr("Applied *recommended*: welcome, goodbye, antilink, antispam ON.", "*recommended* angewendet: Willkommen, Abschied, Antilink, Antispam AN.")
      );
      return;
    }

    if (args === "minimal") {
      await setGroupSettings(message.from, {
        welcome: true,
        goodbye: false,
        antilink: false,
        antispam: false,
      });
      await replyOk(conn, message, await tr("Applied *minimal*: welcome ON only.", "*minimal* angewendet: nur Willkommen AN."));
      return;
    }

    if (args === "off") {
      await setGroupSettings(message.from, {
        welcome: false,
        goodbye: false,
        antilink: false,
        antispam: false,
      });
      await replyOk(conn, message, await tr("Moderation features turned OFF.", "Moderationsfunktionen AUSgeschaltet."));
      return;
    }

    await replyFail(conn, message, await tr("Use recommended | minimal | off", "Nutze recommended | minimal | off"));
  }
);

command(
  {
    pattern: "status",
    fromMe: false,
    desc: "Bot health status",
    type: "misc",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    const ff = await checkFfmpeg();
    const mode = await getMode();
    const lang = await getLang();
    const logJid = await getLogGroupJid();
    const setup = await isSetupDone();
    const uptime = Math.floor(process.uptime());
    const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);

    let text =
      `*${BOT_INFO.NAME}* v${BOT_INFO.VERSION}\n` +
      await tr(`• Uptime: ${uptime}s\n`, `• Laufzeit: ${uptime}s\n`) +
      `• Mode: ${mode}\n` +
      `• Lang: ${lang}\n` +
      `• FFmpeg: ${ff.ok ? "✅" : "❌"}\n` +
      await tr(`• Setup: ${setup ? "done" : "pending"}\n`, `• Setup: ${setup ? "fertig" : "ausstehend"}\n`);

    if (privileged) {
      text +=
        `• RSS: ${mem} MB\n` +
        `• Platform: ${os.platform()}\n` +
        await tr(`• Log group: ${logJid || "_(not set)_"}\n`, `• Log-Gruppe: ${logJid || "_(nicht gesetzt)_"}\n`) +
        `• User: ${conn.user?.id || "?"}\n`;
    }

    await reply(conn, message, text);
  }
);
