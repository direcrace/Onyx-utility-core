/**
 * Owner / sudo / mode commands
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import {
  getMode,
  setMode,
  listSudo,
  addSudo,
  removeSudo,
  isOwnerMessage,
  normalizeNumber,
} from "../utils/access.js";
import { resolveTargetUser } from "../utils/group.js";
import { BOT_INFO } from "../config/constants.js";

command(
  {
    pattern: "mode",
    fromMe: true,
    desc: "Set bot mode (public|private|inbox|group)",
    type: "owner",
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "mode") || "").trim().toLowerCase();

    if (!args) {
      const mode = await getMode();
      await reply(
        conn,
        message,
        await tr(
          `*Bot mode:* ${mode}\n\n` +
            `• \`${BOT_INFO.PREFIX}mode public\` — anyone, anywhere\n` +
            `• \`${BOT_INFO.PREFIX}mode private\` — owner + sudo only\n` +
            `• \`${BOT_INFO.PREFIX}mode inbox\` — DMs only (no groups)\n` +
            `• \`${BOT_INFO.PREFIX}mode group\` — groups only (no DMs)`,
          `*Bot-Modus:* ${mode}\n\n` +
            `• \`${BOT_INFO.PREFIX}mode public\` — jeder, überall\n` +
            `• \`${BOT_INFO.PREFIX}mode private\` — nur Besitzer + sudo\n` +
            `• \`${BOT_INFO.PREFIX}mode inbox\` — nur Direktnachrichten (keine Gruppen)\n` +
            `• \`${BOT_INFO.PREFIX}mode group\` — nur Gruppen (keine DMs)`
        )
      );
      return;
    }

    const valid = ["public", "private", "inbox", "group"];
    if (!valid.includes(args)) {
      await replyFail(
        conn,
        message,
        await tr(`Use: \`${BOT_INFO.PREFIX}mode public|private|inbox|group\``, `Benutze: \`${BOT_INFO.PREFIX}mode public|private|inbox|group\``)
      );
      return;
    }

    const next = await setMode(args);
    await replyOk(conn, message, await tr(`Mode set to *${next}*`, `Modus auf *${next}* gesetzt`));
  }
);

command(
  {
    pattern: "sudo",
    fromMe: true,
    desc: "Manage sudo users (add|del|list)",
    type: "owner",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "sudo") || "").trim();
    const [action, ...rest] = raw.split(/\s+/);
    const act = (action || "list").toLowerCase();

    if (act === "list" || !action) {
      const list = await listSudo();
      if (!list.length) {
        await reply(conn, message, await tr("*Sudo list:* _(empty)_", "*Sudo-Liste:* _(leer)_"));
        return;
      }
      await reply(
        conn,
        message,
        await tr(`*Sudo list:*\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}`, `*Sudo-Liste:*\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}`)
      );
      return;
    }

    if (!isOwnerMessage(message, conn)) {
      await replyFail(conn, message, await tr("Only the bot owner can add/remove sudo.", "Nur der Bot-Besitzer kann sudo hinzufügen/entfernen."));
      return;
    }

    let target = rest.join(" ").trim() || resolveTargetUser(message) || "";
    const mentions = message.message?.contextInfo?.mentionedJid || [];
    if (!target && mentions.length) target = mentions[0];

    const number = normalizeNumber(target);
    if (!number && (act === "add" || act === "del" || act === "remove" || act === "rm")) {
      await replyFail(
        conn,
        message,
        await tr(`Usage: \`${BOT_INFO.PREFIX}sudo add <number|@user>\` / \`${BOT_INFO.PREFIX}sudo del <number|@user>\``, `Benutzung: \`${BOT_INFO.PREFIX}sudo add <nummer|@user>\` / \`${BOT_INFO.PREFIX}sudo del <nummer|@user>\``)
      );
      return;
    }

    if (act === "add") {
      await addSudo(number);
      await replyOk(conn, message, await tr(`Added sudo: *${number}*`, `Sudo hinzugefügt: *${number}*`));
      return;
    }

    if (act === "del" || act === "remove" || act === "rm") {
      await removeSudo(number);
      await replyOk(conn, message, await tr(`Removed sudo: *${number}*`, `Sudo entfernt: *${number}*`));
      return;
    }

    await replyFail(conn, message, await tr("Unknown action. Use `list`, `add`, or `del`.", "Unbekannte Aktion. Benutze `list`, `add` oder `del`."));
  }
);

