

import { command } from "../plugins.js";
import { reply, replyFail, getCommandArgs, tr } from "../utils/message.js";
import {
  getLogFileNames,
  getLogLevel,
  setLogLevel,
  normalizeLogLevel,
  LOG_LEVELS,
} from "../enterprise/logCapture.js";
import { appendAuditFile } from "../enterprise/audit.js";
import { isAutoFlagEnabled } from "../enterprise/autoFlag.js";

function fullLabel(level) {
  if (level === "raw") return "ON (everything)";
  if (level === "messages") return "messages only";
  if (level === "off") return "off";
  return "OFF (necessary only)";
}

async function statusText() {
  const level = await getLogLevel();
  const files = getLogFileNames();
  const autoFlag = (await isAutoFlagEnabled()) ? "ON" : "OFF";

  return await tr(
    `📝 *Logging*\nLevel: *${level}*\nFull-Log: *${fullLabel(level)}*\nAuto-Flag: *${autoFlag}*\nFolder: \`${files.dir}\`\n\n` +
      `• \`off\` — no plaintext logs\n` +
      `• \`audit\` — moderation/audit only (necessary)\n` +
      `• \`messages\` — audit + all in-/outgoing messages, calls, edits/deletes\n` +
      `• \`raw\` — everything + raw JSON (media is not downloaded)\n\n` +
      `Files today:\n• \`${files.audit}\`\n• \`${files.messages}\`\n• \`${files.raw}\`\n\n` +
      `Full-Log toggle: \`#fulllog on|off\`\nAuto-Flag toggle: \`#autoflag on|off\`\nChange level: \`#log level ${LOG_LEVELS.join("|")}\``,
    `📝 *Logging*\nStufe: *${level}*\nFull-Log: *${fullLabel(level)}*\nAuto-Flag: *${autoFlag}*\nOrdner: \`${files.dir}\`\n\n` +
      `• \`off\` — keine Plaintext-Logs\n` +
      `• \`audit\` — nur Moderation/Audit (notwendig)\n` +
      `• \`messages\` — Audit + alle ein-/ausgehenden Nachrichten, Anrufe, Edits/Deletes\n` +
      `• \`raw\` — alles + Roh-JSON (Medien werden nicht heruntergeladen)\n\n` +
      `Dateien heute:\n• \`${files.audit}\`\n• \`${files.messages}\`\n• \`${files.raw}\`\n\n` +
      `Full-Log-Toggle: \`#fulllog on|off\`\nAuto-Flag-Toggle: \`#autoflag on|off\`\nStufe ändern: \`#log level ${LOG_LEVELS.join("|")}\``
  );
}

async function applyLevel(message, requested, { via = "log" } = {}) {
  const previous = await getLogLevel();
  let level;
  try {
    level = await setLogLevel(requested);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  await appendAuditFile({
    action: "log.level",
    actor: message.sender,
    target: level,
    chat: message.from,
    meta: {
      previous,
      next: level,
      via,
      by: message.pushName || null,
      messageId: message.key?.id || null,
    },
  });

  return { ok: true, previous, level };
}

function levelReply(previous, level) {
  const note = level === "off" ? "⚠️ Plaintext logging is off." : `📄 Files: \`${getLogFileNames().dir}\``;
  const noteDe = level === "off" ? "⚠️ Plaintext-Logging ist aus." : `📄 Dateien: \`${getLogFileNames().dir}\``;
  return {
    en: `✅ Logging level: *${previous}* → *${level}*\nFull-Log: *${fullLabel(level)}*\n${note}`,
    de: `✅ Logging-Stufe: *${previous}* → *${level}*\nFull-Log: *${fullLabel(level)}*\n${noteDe}`,
  };
}

command(
  {
    pattern: "log",
    fromMe: true,
    desc: "Logging level: #log | #log level off|audit|messages|raw",
    type: "owner",
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "log") || "").trim().split(/\s+/).filter(Boolean);
    const action = (args[0] || "status").toLowerCase();

    if (action === "status" || action === "get") {
      await reply(conn, message, await statusText());
      return;
    }

    const values = ["level", "set", "mode"].includes(action) ? args.slice(1) : args;
    const requested = normalizeLogLevel(values[0]);

    if (!requested) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`#log\` or \`#log level ${LOG_LEVELS.join("|")}\``,
          `Benutzung: \`#log\` oder \`#log level ${LOG_LEVELS.join("|")}\``
        )
      );
      return;
    }

    const result = await applyLevel(message, requested, { via: "log" });
    if (!result.ok) {
      await replyFail(conn, message, result.error);
      return;
    }

    const text = levelReply(result.previous, result.level);
    await reply(conn, message, await tr(text.en, text.de));
  }
);

command(
  {
    pattern: "fulllog",
    fromMe: true,
    desc: "Full-Log toggle: #fulllog on|off|status",
    type: "owner",
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "fulllog") || "").trim().split(/\s+/).filter(Boolean);
    const action = (args[0] || "status").toLowerCase();

    if (["status", "get", ""].includes(action)) {
      await reply(conn, message, await statusText());
      return;
    }

    let requested = null;
    if (["on", "full", "everything", "raw", "all"].includes(action)) requested = "raw";
    else if (["messages", "message"].includes(action)) requested = "messages";
    else if (["off", "necessary", "minimal", "audit", "normal"].includes(action)) requested = "audit";
    else requested = normalizeLogLevel(action);

    if (!requested) {
      await replyFail(
        conn,
        message,
        await tr(
          "Usage: `#fulllog on` (everything) or `#fulllog off` (necessary only).\nAdvanced: `#log level off|audit|messages|raw`",
          "Benutzung: `#fulllog on` (alles) oder `#fulllog off` (nur das Notwendige).\nErweitert: `#log level off|audit|messages|raw`"
        )
      );
      return;
    }

    const result = await applyLevel(message, requested, { via: "fulllog" });
    if (!result.ok) {
      await replyFail(conn, message, result.error);
      return;
    }

    const text = levelReply(result.previous, result.level);
    await reply(conn, message, await tr(text.en, text.de));
  }
);
