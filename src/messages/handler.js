

import { findCommand } from "../plugins.js";
import { validateCommand } from "../utils/validation.js";
import { checkCommandAccess, isPrivileged, isRankedAtLeast, normalizeNumber } from "../utils/access.js";
import { sendError, ackCommand, tr } from "../utils/message.js";
import { validateGroupPermissions } from "../utils/group.js";
import { groupCache } from "../utils/cache.js";
import { getGroupSettings } from "../utils/groupSettings.js";
import { BOT_INFO } from "../config/constants.js";
import { t } from "../utils/i18n.js";
import logger from "../utils/logger.js";
import { systemLog, isLogGroupAsync } from "../utils/logGroup.js";
import { isBotBanned } from "../utils/globalBan.js";
import { getRegistrationStatus } from "../utils/registration.js";
import { recordUserActivity } from "../utils/communityStats.js";
import { checkCommandFlag } from "../enterprise/flags.js";
import { evaluatePolicy } from "../enterprise/policy.js";
import { writeAudit } from "../enterprise/audit.js";
import { recordCommand, recordError } from "../enterprise/metrics.js";

const AUDIT_ACTIONS = new Set([
  "kick",
  "warn",
  "mute",
  "unmute",
  "promote",
  "demote",
  "mode",
  "sudo",
  "broadcast",
  "disable",
  "enable",
  "flag",
  "autoflag",
  "policy",
  "role",
  "backup",
  "setlog",
  "createlog",
  "reboot",
  "shutdown",
  "logout",
  "wipedb",
  "wipekey",
  "corepanic",
  "syswatch",
]);

const SUB_BLOCKED_COMMANDS = new Set([
  "pair",
  "unpair",
  "instances",
  "flags",
  "resolveflag",
  "suspend",
  "unsuspend",
  "mode",
  "sudo",
  "exif",
  "broadcast",
  "cmdlist",
  "setup",
  "createlog",
  "setlog",
  "log",
  "fulllog",
  "audit",
  "flag",
  "autoflag",
  "policy",
  "role",
  "backup",
  "metrics",
  "aiprompt",
  "maintenance",
  "logout",
  "wipedb",
  "wipekey",
  "platform",
  "control",
]);

const REGISTRATION_EXEMPT = new Set([
  "register",
  "unregister",
  "terms",
  "privacy",
  "tos",
  "dsgvo",
  "menu",
  "help",
  "bot",
  "ping",
  "alive",
  "uptime",
  "status",
  "report",
  "ticket",
  "support",
  "mytickets",
  "closeticket",
  "mystats",
  "resetstats",
  "level",
  "whois",
  "mydata",
  "forgetme",
  "forgetai",
]);

const REGISTRATION_NOTICE_MS = 5 * 60 * 1000;
const registerNoticeAt = new Map();

async function checkRegistration(message, conn, command, name, privileged) {
  try {
    if (conn?.__isSub) return true;
    if (command.fromMe || privileged) return true;
    if (REGISTRATION_EXEMPT.has(name)) return true;
    if (await isRankedAtLeast(message, conn, "admin")) return true;

    const number = normalizeNumber(message.sender || message.from);
    if (!number) return true;

    const status = await getRegistrationStatus(number);
    if (status.registered && status.current) return true;

    const now = Date.now();
    if (now - (registerNoticeAt.get(number) || 0) >= REGISTRATION_NOTICE_MS) {
      registerNoticeAt.set(number, now);
      const text = status.registered
        ? await tr(
            `📝 The Terms/Privacy changed since you registered. Please renew your consent: \`${BOT_INFO.PREFIX}register ${status.record.name || "Name"} accept\` (see \`${BOT_INFO.PREFIX}terms\` / \`${BOT_INFO.PREFIX}privacy\`).`,
            `📝 Nutzbedingungen/Datenschutz haben sich seit deiner Registrierung geändert. Bitte erneuere deine Zustimmung: \`${BOT_INFO.PREFIX}register ${status.record.name || "Name"} accept\` (siehe \`${BOT_INFO.PREFIX}terms\` / \`${BOT_INFO.PREFIX}privacy\`).`
          )
        : await tr(
            `📝 You must register first. Send \`${BOT_INFO.PREFIX}register <Name>\` and accept the Terms + Privacy (see \`${BOT_INFO.PREFIX}terms\` / \`${BOT_INFO.PREFIX}privacy\`).`,
            `📝 Du musst dich zuerst registrieren. Sende \`${BOT_INFO.PREFIX}register <Name>\` und akzeptiere die Nutzungsbedingungen + Datenschutz (siehe \`${BOT_INFO.PREFIX}terms\` / \`${BOT_INFO.PREFIX}privacy\`).`
          );
      await sendError(conn, message.from, text);
    }
    return false;
  } catch (err) {
    console.error("[handler] registration gate error:", err?.message || err);
    return true;
  }
}

export async function messageHandler(params) {
  const { message, conn } = params;
  try {
    if (message.isBotMessage && message.isGroup) return;
    if (!message.body) return;

    if (!conn?.__isSub) {
      try {
        const { evaluateUserMessage } = await import("../multi/miniMonitor.js");
        const verdict = await evaluateUserMessage({ conn, message });
        if (verdict.action === "ban") return;
      } catch (err) {
        console.error("[handler] user monitor error:", err?.message || err);
      }
    }

    if (!(await isPrivileged(message, conn)) && (await isBotBanned(message.sender))) {
      return;
    }

    if (!message.isBotMessage && !conn?.__isSub) {
      recordUserActivity(message.sender || message.from, { kind: "message", chat: message.from }).catch(() => {});
    }

    if (!message.body.startsWith(BOT_INFO.PREFIX)) return;

    const command = findCommand(message.body);
    if (!command) return;

    const name = (command.patternName || "").toLowerCase();
    const privileged = await isPrivileged(message, conn);

    if (conn?.__isSub && SUB_BLOCKED_COMMANDS.has(name)) {
      return;
    }

    const access = await checkCommandAccess(message, command, conn);
    if (!access.allowed) {
      if (access.silent) return;
      await sendError(conn, message.from, access.reason || "OWNER_ONLY");
      return;
    }

    if (!(await checkRegistration(message, conn, command, name, privileged))) {
      return;
    }

    const flagCheck = await checkCommandFlag(name);
    if (!flagCheck.ok) {
      if (flagCheck.flag === "maintenance" && privileged) {

      } else if (flagCheck.flag === "maintenance") {
        await sendError(
          conn,
          message.from,
          await tr("🛠 Bot is in *maintenance mode*. Try again later.", "🛠 Der Bot befindet sich im *Wartungsmodus*. Versuche es später erneut.")
        );
        return;
      } else {
        await sendError(
          conn,
          message.from,
          await tr(`⚠️ Feature *${flagCheck.flag}* is disabled.`, `⚠️ Funktion *${flagCheck.flag}* ist deaktiviert.`)
        );
        return;
      }
    }

    const policy = await evaluatePolicy(message, command, { privileged });
    if (!policy.ok) {
      const msgs = {
        QUIET_HOURS: await tr("🌙 Quiet hours — try again later.", "🌙 Ruhezeiten — versuche es später erneut."),
        RATE_LIMIT: await tr("⏳ Slow down — rate limit hit.", "⏳ Etwas langsamer — Rate-Limit erreicht."),
        MEDIA_DISABLED: await tr("⚠️ Media commands are disabled by policy.", "⚠️ Medienbefehle sind laut Policy deaktiviert."),
        BROADCAST_BLOCKED: await tr("⚠️ Broadcast is blocked by policy.", "⚠️ Broadcast ist laut Policy blockiert."),
      };
      await sendError(conn, message.from, msgs[policy.reason] || policy.reason);
      return;
    }

    if (message.isGroup && command.patternName) {
      const settings = await getGroupSettings(message.from);
      const disabled = settings.disabledPlugins || [];
      if (disabled.includes(name)) {
        if (!privileged) {
          await sendError(conn, message.from, await t("PLUGIN_DISABLED"));
          return;
        }
      }
    }

    logger.command(name || "unknown", message.sender, message.isGroup ? message.from : null);

    const validation = await validateCommand(message, command, conn);
    if (!validation.valid) {
      await sendError(conn, message.from, validation.error);
      return;
    }

    if (message.isGroup && (command.adminOnly || command.botAdminRequired)) {
      let groupMetadata = groupCache.get(message.from);
      if (!groupMetadata) {
        groupMetadata = await conn.groupMetadata(message.from);
        groupCache.set(message.from, groupMetadata);
      }

      const rankedAdmin =
        command.adminOnly && (await isRankedAtLeast(message, conn, "admin"));

      const groupValidation = validateGroupPermissions(
        message,
        groupMetadata,
        {
          adminOnly: command.adminOnly && !rankedAdmin,
          botAdminRequired: command.botAdminRequired,
        },
        conn
      );

      if (!groupValidation.valid) {
        await sendError(conn, message.from, groupValidation.error);
        return;
      }
    }

    await ackCommand(conn, message);
    recordCommand(name || "unknown");
    recordUserActivity(message.sender || message.from, { kind: "command", command: name, chat: message.from }).catch(() => {});

    await command.function(message, conn);

    if (AUDIT_ACTIONS.has(name)) {
      writeAudit({
        action: `cmd.${name}`,
        actor: message.sender,
        chat: message.from,
        meta: {
          body: String(message.body || "").slice(0, 400),
          messageId: message.key?.id || message.id || null,
          group: message.isGroup ? message.from : null,
          senderName: message.pushName || null,
        },
      }).catch(() => {});
    }
  } catch (error) {
    recordError();
    const where = `${commandNameSafe(message)} @ ${message?.from || "?"}`;
    await systemLog("error", `Handler crash: ${where}`, error);

    const inLog = await isLogGroupAsync(message?.from);
    try {
      if (inLog) {
        await sendError(
          conn,
          message.from,
          `Handler error: ${error?.message || "unknown"} (see log above)`
        );
      } else {
        await sendError(conn, message.from, await t("FAILED"));
      }
    } catch (sendErr) {
      recordError();
      await systemLog("error", "Failed to send user-safe error", sendErr);
    }
  }
}

function commandNameSafe(message) {
  try {
    const body = message?.body || "";
    return body.split(/\s+/)[0] || "unknown";
  } catch {
    return "unknown";
  }
}

export async function tryChatbotReply({ message, conn }) {
  try {
    const { handleChatbotReply } = await import("../plugins/ai.js");
    await handleChatbotReply({ message, conn });
  } catch (err) {
    const { systemLog } = await import("../utils/logGroup.js");
    await systemLog("error", `Chatbot hook failed: ${err?.message || "unknown error"}`);
  }
}
