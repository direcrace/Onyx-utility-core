import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, sendMessage, tr } from "../utils/message.js";
import {
  normalizeNumber,
  isOwnerMessage,
  isPrivileged,
  isRankedAtLeast,
} from "../utils/access.js";
import { resolveTargetUser } from "../utils/group.js";
import { auditMessage } from "../enterprise/audit.js";
import { systemLog } from "../utils/logGroup.js";
import { BOT_INFO } from "../config/constants.js";
import { getRegistration } from "../utils/registration.js";
import { getRank, RANK_LABELS } from "../utils/ranks.js";
import {
  getLeaderboard,
  getUserStats,
  deleteUserStats,
  recordUserActivity,
} from "../utils/communityStats.js";
import {
  DELIVERY_MODES,
  getSupportGroup,
  setSupportGroup,
  getTicketDelivery,
  setTicketDelivery,
  createTicket,
  getTicket,
  getTicketBySupportMessageId,
  setTicketDeliveryMessage,
  answerTicket,
  listTickets,
  closeTicket,
} from "../utils/supportTickets.js";

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return new Date(ts).toISOString();
  }
}

function label(rank) {
  return RANK_LABELS[rank] || rank || "User";
}

async function ownerOnly(conn, message) {
  if (isOwnerMessage(message, conn) || message.key?.fromMe) return true;
  await replyFail(conn, message, await tr("Owner only.", "Nur Besitzer."));
  return false;
}

function parseTicketText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s*\|\s*|\s+—\s+|\s+–\s+/);
  if (parts.length >= 2) {
    return { subject: parts[0].trim().slice(0, 120), body: parts.slice(1).join(" | ").trim() };
  }
  return { subject: raw.slice(0, 80), body: raw };
}

function formatTicket(ticket, { full = true } = {}) {
  const head = [
    `🎫 *Ticket ${ticket.id}* · ${ticket.source === "report" ? "Report" : "Support"}`,
    `*From:* ${ticket.sender || ticket.number}${ticket.target ? `\n*Target:* ${ticket.target}` : ""}`,
    `*Chat:* ${ticket.chat || "DM"}`,
    `*Time:* ${fmtDate(ticket.ts)}`,
  ].join("\n");

  if (!full) {
    return `${head}\n_Content delivered privately (ticket delivery mode: dm)._`;
  }
  return `${head}\n\n*Subject:* ${ticket.subject}\n\n${ticket.body}`;
}

async function deliverTicket(conn, ticket, mode, supportJid) {
  let supportMessageId = null;

  if (mode === "group" || mode === "both") {
    if (!supportJid) return null;
    const sent = await sendMessage(conn, supportJid, formatTicket(ticket));
    supportMessageId = sent?.key?.id || sent?.id || null;
  }
  if (mode === "dm" || mode === "both") {
    if (!conn?.__isSub) {
      await sendMessage(conn, `${ticket.number}@s.whatsapp.net`, formatTicket(ticket));
    }
  }
  if (mode === "dm" && supportJid) {
    const sent = await sendMessage(conn, supportJid, formatTicket(ticket, { full: false }));
    supportMessageId = sent?.key?.id || sent?.id || supportMessageId;
  }

  return supportMessageId ? { supportMessageId, supportChat: supportJid } : null;
}

async function openTicket(message, conn, { source, subject, body, target }) {
  const mode = await getTicketDelivery();
  if (mode === "off") {
    await replyFail(
      conn,
      message,
      await tr("🎫 Tickets are disabled. Ask the owner to enable them.", "🎫 Tickets sind deaktiviert. Bitte den Besitzer, sie zu aktivieren.")
    );
    return;
  }

  const supportJid = await getSupportGroup();
  if ((mode === "group" || mode === "both") && !supportJid) {
    await replyFail(
      conn,
      message,
      await tr(
        `🎫 No support group configured. Owner: \`${BOT_INFO.PREFIX}setsupportgroup\` in the support group.`,
        `🎫 Keine Support-Gruppe konfiguriert. Besitzer: \`${BOT_INFO.PREFIX}setsupportgroup\` in der Support-Gruppe.`
      )
    );
    return;
  }

  const number = normalizeNumber(message.sender || message.from);
  const ticket = await createTicket({
    number,
    sender: message.sender || message.from,
    chat: message.from,
    subject,
    body,
    target,
    source,
  });

  await recordUserActivity(number, {
    kind: source === "report" ? "report" : "ticket",
    chat: message.from,
  });
  await auditMessage(message, {
    action: source === "report" ? "community.report" : "community.ticket",
    target: target || null,
    reason: body,
    meta: { ticketId: ticket.id, subject: ticket.subject, delivery: mode },
  });
  await systemLog(
    source === "report" ? "warn" : "info",
    `🎫 ${source === "report" ? "Report" : "Ticket"} ${ticket.id} from ${ticket.number}${target ? ` → ${target}` : ""}`,
    ticket.subject
  );

  const delivery = await deliverTicket(conn, ticket, mode, supportJid);
  if (delivery) {
    await setTicketDeliveryMessage(ticket.id, delivery);
  }

  const where = mode === "dm" ? "privately to you" : mode === "both" ? "the support group and your DM" : "the support group";
  await replyOk(
    conn,
    message,
    await tr(
      `🎫 ${source === "report" ? "Report" : "Ticket"} opened: \`${ticket.id}\`\nDelivered to ${where}. You can track it with \`${BOT_INFO.PREFIX}mytickets\`.`,
      `🎫 ${source === "report" ? "Meldung" : "Ticket"} erstellt: \`${ticket.id}\`\nZugestellt an ${where}. Verfolgen mit \`${BOT_INFO.PREFIX}mytickets\`.`
    )
  );
}

function quotedText(message) {
  const quoted = message?.message?.contextInfo?.quotedMessage;
  return String(
    message?.quoted?.text ||
      quoted?.conversation ||
      quoted?.extendedTextMessage?.text ||
      ""
  );
}

function quotedMessageId(message) {
  const ctx = message?.message?.contextInfo || {};
  return ctx.stanzaId || message?.quoted?.id || message?.quoted?.key?.id || null;
}

async function findTicketForAnswer(message) {
  const byId = await getTicketBySupportMessageId(quotedMessageId(message));
  if (byId) return byId;
  const match = quotedText(message).match(/TKT-[A-Z0-9-]+/i);
  return match ? getTicket(match[0].toUpperCase()) : null;
}

function formatAnswer({ ticket, name, answer }) {
  return [
    `🎫 *Ticket ${ticket.id}*`,
    `*Answered by:* ${name}`,
    "",
    `*Original:* ${ticket.subject}`,
    ticket.body,
    "",
    `*Answer:* ${answer}`,
  ].join("\n");
}

command(
  {
    pattern: "setsupportgroup",
    fromMe: true,
    desc: "Set this group as the support ticket destination (owner only)",
    type: "owner",
    groupOnly: true,
  },
  async (message, conn) => {
    if (!(await ownerOnly(conn, message))) return;

    const args = (getCommandArgs(message.body, "setsupportgroup") || "").trim().toLowerCase();
    if (args === "status" || args === "?") {
      const jid = await getSupportGroup();
      await reply(
        conn,
        message,
        await tr(
          `🎫 Support group: ${jid ? `\`${jid}\`` : "not configured"}.`,
          `🎫 Support-Gruppe: ${jid ? `\`${jid}\`` : "nicht konfiguriert"}.`
        )
      );
      return;
    }

    const jid = await setSupportGroup(message.from);
    await auditMessage(message, { action: "supportgroup.set", target: jid });
    await systemLog("success", `Support group set to ${jid}`);
    await replyOk(
      conn,
      message,
      await tr(
        `🎫 This group is now the support ticket destination: \`${jid}\`.\nDelivery mode: \`${await getTicketDelivery()}\`.`,
        `🎫 Diese Gruppe ist jetzt das Ziel für Support-Tickets: \`${jid}\`.\nZustellmodus: \`${await getTicketDelivery()}\`.`
      )
    );
  }
);

command(
  {
    pattern: "setticketdelivery",
    fromMe: true,
    desc: "Set ticket delivery: group|dm|both|off (owner only)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await ownerOnly(conn, message))) return;

    const args = (getCommandArgs(message.body, "setticketdelivery") || "").trim().toLowerCase();
    const current = await getTicketDelivery();
    if (!args || args === "status" || args === "?") {
      await reply(
        conn,
        message,
        await tr(
          `🎫 Ticket delivery: \`${current}\`.\nModes: \`group\` (support group), \`dm\` (private, group gets only a notice), \`both\`, \`off\`.\nChange: \`${BOT_INFO.PREFIX}setticketdelivery <mode>\`.`,
          `🎫 Ticket-Zustellung: \`${current}\`.\nModi: \`group\` (Support-Gruppe), \`dm\` (privat, Gruppe bekommt nur einen Hinweis), \`both\`, \`off\`.\nÄndern: \`${BOT_INFO.PREFIX}setticketdelivery <modus>\`.`
        )
      );
      return;
    }

    if (!DELIVERY_MODES.includes(args)) {
      await replyFail(
        conn,
        message,
        await tr(
          `⚠️ Unknown mode. Use: ${DELIVERY_MODES.join(" | ")}.`,
          `⚠️ Unbekannter Modus. Nutze: ${DELIVERY_MODES.join(" | ")}.`
        )
      );
      return;
    }

    const mode = await setTicketDelivery(args);
    await auditMessage(message, { action: "ticketdelivery.set", target: mode });
    await systemLog("success", `Ticket delivery set to ${mode}`);
    await replyOk(
      conn,
      message,
      await tr(`🎫 Ticket delivery is now \`${mode}\`.`, `🎫 Ticket-Zustellung ist jetzt \`${mode}\`.`)
    );
  }
);

async function ticketCommand(message, conn, pattern) {
  const text = (getCommandArgs(message.body, pattern) || "").trim();
  if (!text) {
    await reply(
      conn,
      message,
      await tr(
        `🎫 *Support ticket*\nUsage: \`${BOT_INFO.PREFIX}${pattern} <subject> | <message>\`\nExample: \`${BOT_INFO.PREFIX}${pattern} Login issue | It started today\`.`,
        `🎫 *Support-Ticket*\nBenutzung: \`${BOT_INFO.PREFIX}${pattern} <Betreff> | <Nachricht>\`\nBeispiel: \`${BOT_INFO.PREFIX}${pattern} Login-Problem | Seit heute\`.`
      )
    );
    return;
  }
  const parsed = parseTicketText(text);
  await openTicket(message, conn, { source: "ticket", ...parsed, target: resolveTargetUser(message) });
}

command(
  {
    pattern: "ticket",
    fromMe: false,
    desc: "Open a support ticket",
    type: "info",
  },
  (message, conn) => ticketCommand(message, conn, "ticket")
);

command(
  {
    pattern: "support",
    fromMe: false,
    desc: "Open a support ticket (alias for #ticket)",
    type: "info",
  },
  (message, conn) => ticketCommand(message, conn, "support")
);

command(
  {
    pattern: "report",
    fromMe: false,
    desc: "Report a user or message to the support team",
    type: "info",
  },
  async (message, conn) => {
    const body = (getCommandArgs(message.body, "report") || "").trim();
    if (!body) {
      await reply(
        conn,
        message,
        await tr(
          `🚨 *Report*\nUsage: \`${BOT_INFO.PREFIX}report <reason>\` (reply to a message or mention someone to include the target).`,
          `🚨 *Meldung*\nBenutzung: \`${BOT_INFO.PREFIX}report <Grund>\` (auf eine Nachricht antworten oder jemanden erwähnen, um das Ziel anzugeben).`
        )
      );
      return;
    }
    await openTicket(message, conn, {
      source: "report",
      subject: "Community report",
      body,
      target: resolveTargetUser(message),
    });
  }
);

command(
  {
    pattern: "mytickets",
    fromMe: false,
    desc: "List your support tickets",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    const tickets = await listTickets({ number, limit: 20 });
    if (!tickets.length) {
      await reply(conn, message, await tr("🎫 You have no tickets.", "🎫 Du hast keine Tickets."));
      return;
    }
    const icon = (status) => (status === "open" ? "🟢" : status === "answered" ? "✉️" : "🔒");
    const lines = tickets.map(
      (t) => `\`${t.id}\` · ${icon(t.status)} ${t.subject} · ${fmtDate(t.ts)}`
    );
    await reply(conn, message, `🎫 *Your tickets*\n${lines.join("\n")}`);
  }
);

command(
  {
    pattern: "closeticket",
    fromMe: false,
    desc: "Close a ticket (reporter or mod+)",
    type: "info",
  },
  async (message, conn) => {
    const id = (getCommandArgs(message.body, "closeticket") || "").trim().toUpperCase();
    if (!id) {
      await reply(
        conn,
        message,
        await tr(`Usage: \`${BOT_INFO.PREFIX}closeticket <ticket-id>\`.`, `Benutzung: \`${BOT_INFO.PREFIX}closeticket <Ticket-ID>\`.`)
      );
      return;
    }

    const ticket = await getTicket(id);
    if (!ticket) {
      await replyFail(conn, message, await tr("❌ Ticket not found.", "❌ Ticket nicht gefunden."));
      return;
    }
    if (ticket.status === "closed") {
      await reply(conn, message, await tr("🎫 That ticket is already closed.", "🎫 Dieses Ticket ist bereits geschlossen."));
      return;
    }

    const number = normalizeNumber(message.sender || message.from);
    const allowed =
      ticket.number === number ||
      (await isPrivileged(message, conn)) ||
      (await isRankedAtLeast(message, conn, "mod"));
    if (!allowed) {
      await replyFail(conn, message, await tr("❌ Only the reporter or a mod+ can close this ticket.", "❌ Nur der Melder oder ein Mod+ kann dieses Ticket schließen."));
      return;
    }

    const closed = await closeTicket(ticket.id, number);
    await auditMessage(message, { action: "community.ticket.close", target: closed.id });
    await replyOk(conn, message, await tr(`🎫 Ticket \`${closed.id}\` closed.`, `🎫 Ticket \`${closed.id}\` geschlossen.`));
  }
);

command(
  {
    pattern: "answer",
    fromMe: false,
    desc: "Answer a ticket (reply to the ticket message in the support group)",
    type: "info",
  },
  async (message, conn) => {
    const supportJid = await getSupportGroup();
    if (!supportJid || message.from !== supportJid) {
      await replyFail(
        conn,
        message,
        await tr(
          "🎫 Use `#answer` inside the configured support group.",
          "🎫 Nutze `#answer` in der konfigurierten Support-Gruppe."
        )
      );
      return;
    }

    const answer = (getCommandArgs(message.body, "answer") || "").trim();
    if (!answer) {
      await reply(
        conn,
        message,
        await tr(
          `🎫 *Answer a ticket*\nReply to the ticket message with \`${BOT_INFO.PREFIX}answer <text>\`.`,
          `🎫 *Ticket beantworten*\nAntworte auf die Ticket-Nachricht mit \`${BOT_INFO.PREFIX}answer <Text>\`.`
        )
      );
      return;
    }

    const ticket = await findTicketForAnswer(message);
    if (!ticket) {
      await replyFail(
        conn,
        message,
        await tr(
          "❌ Ticket not found. Reply directly to the bot's ticket message.",
          "❌ Ticket nicht gefunden. Antworte direkt auf die Ticket-Nachricht des Bots."
        )
      );
      return;
    }

    const number = normalizeNumber(message.sender || message.from);
    const registration = await getRegistration(number);
    const name = registration?.name || ((await isPrivileged(message, conn)) ? "Owner" : null);
    if (!name) {
      await replyFail(
        conn,
        message,
        await tr(
          `🎫 Register first so your name can be shown: \`${BOT_INFO.PREFIX}register <Name> accept\`.`,
          `🎫 Registriere dich zuerst, damit dein Name angezeigt werden kann: \`${BOT_INFO.PREFIX}register <Name> accept\`.`
        )
      );
      return;
    }

    const answered = await answerTicket(ticket.id, {
      answer,
      answeredBy: name,
      supportMessageId: quotedMessageId(message) || ticket.supportMessageId,
      supportChat: supportJid,
    });

    const full = formatAnswer({ ticket: answered, name, answer });
    const reporterJid = ticket.chat || `${ticket.number}@s.whatsapp.net`;
    if (reporterJid !== supportJid) {
      await sendMessage(conn, reporterJid, full);
    }

    const quoted = answered.supportMessageId
      ? { key: { id: answered.supportMessageId, remoteJid: supportJid }, message: {} }
      : null;
    await sendMessage(conn, supportJid, full, quoted ? { quoted } : {});

    await auditMessage(message, {
      action: "community.ticket.answer",
      target: answered.id,
      reason: answer,
      meta: { answeredBy: name },
    });
  }
);

command(
  {
    pattern: "leaderboard",
    fromMe: false,
    desc: "Show the most active registered community members",
    type: "info",
  },
  async (message, conn) => {
    const raw = await getLeaderboard({ limit: 60 });
    const rows = [];
    for (const entry of raw) {
      const reg = await getRegistration(entry.number);
      if (!reg) continue;
      const rank = await getRank(entry.number);
      rows.push({
        ...entry,
        name: reg.name || entry.number,
        rank: label(rank),
      });
      if (rows.length >= 10) break;
    }

    if (!rows.length) {
      await reply(conn, message, await tr("📊 No community activity yet.", "📊 Noch keine Community-Aktivität."));
      return;
    }

    const lines = rows.map(
      (r, i) =>
        `${i + 1}. *${r.name}* · ${r.points} pts · ${r.commands} cmds · ${r.messages} msgs · ${r.rank}`
    );
    await reply(conn, message, `📊 *Community Leaderboard*\n${lines.join("\n")}`);
  }
);

command(
  {
    pattern: "mystats",
    fromMe: false,
    desc: "Show your community activity stats",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    const stats = await getUserStats(number);
    const rank = label(await getRank(number));
    if (!stats) {
      await reply(conn, message, await tr("📊 No stats yet.", "📊 Noch keine Statistiken."));
      return;
    }
    await reply(
      conn,
      message,
      await tr(
        `📊 *Your stats* · ${rank}\n• Points: ${stats.points || 0}\n• Commands: ${stats.commands || 0}\n• Messages: ${stats.messages || 0}\n• Reports: ${stats.reports || 0}\n• Tickets: ${stats.tickets || 0}\n• Last activity: ${fmtDate(stats.lastAt)}`,
        `📊 *Deine Statistiken* · ${rank}\n• Punkte: ${stats.points || 0}\n• Befehle: ${stats.commands || 0}\n• Nachrichten: ${stats.messages || 0}\n• Meldungen: ${stats.reports || 0}\n• Tickets: ${stats.tickets || 0}\n• Letzte Aktivität: ${fmtDate(stats.lastAt)}`
      )
    );
  }
);

command(
  {
    pattern: "resetstats",
    fromMe: false,
    desc: "Delete your community stats (owner can target a number)",
    type: "info",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "resetstats") || "").trim();
    const privileged = await isPrivileged(message, conn);
    let target = normalizeNumber(message.sender || message.from);
    if (privileged && raw) target = normalizeNumber(raw) || target;

    const removed = await deleteUserStats(target);
    await auditMessage(message, { action: "community.stats.reset", target });
    await replyOk(
      conn,
      message,
      removed
        ? await tr(`🗑 Stats deleted for \`${target}\`.`, `🗑 Statistiken für \`${target}\` gelöscht.`)
        : await tr("🗑 No stats to delete.", "🗑 Keine Statistiken zum Löschen.")
    );
  }
);
