import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, sendMessage, tr } from "../utils/message.js";
import {
  normalizeNumber,
  isPrivileged,
  isRankedAtLeast,
} from "../utils/access.js";
import { resolveTargetUser } from "../utils/group.js";
import { auditMessage } from "../enterprise/audit.js";
import { systemLog } from "../utils/logGroup.js";
import { BOT_INFO } from "../config/constants.js";
import { getRegistration } from "../utils/registration.js";
import { getRank, RANK_LABELS } from "../utils/ranks.js";
import { getHistory, clearHistory } from "../utils/aiHistory.js";
import { giveThanks, getThanksStats, getTopHelpers } from "../utils/karma.js";
import { getBadges, formatBadges } from "../utils/badges.js";
import { exportUserData, deleteUserData, deleteAiHistory } from "../utils/userData.js";
import {
  getLeaderboard,
  getUserStats,
  deleteUserStats,
  recordUserActivity,
  levelFromXp,
  memberTier,
  XP_PER_LEVEL,
} from "../utils/communityStats.js";
import {
  DELIVERY_MODES,
  DEFAULT_CATEGORY,
  getSupportGroup,
  setSupportGroup,
  getTicketRoutes,
  getTicketRoute,
  setTicketRoute,
  removeTicketRoute,
  DEFAULT_SLA_MINUTES,
  getTicketSlaMinutes,
  setTicketSlaMinutes,
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
  if (await isPrivileged(message, conn)) return true;
  await replyFail(conn, message, await tr("Owner/sudo only.", "Nur Besitzer/Sudo."));
  return false;
}

function toGroupJid(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "here") return null;
  if (/@g\.us$/i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@g.us` : null;
}

const BUILTIN_CATEGORIES = new Set([
  DEFAULT_CATEGORY, "bug", "feedback", "question", "abuse", "report", "other",
]);

async function parseTicketText(text, fallbackCategory = DEFAULT_CATEGORY) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s*\|\s*|\s+—\s+|\s+–\s+/);
  const routes = await getTicketRoutes();
  const known = new Set([...BUILTIN_CATEGORIES, ...Object.keys(routes)]);

  let category = fallbackCategory;
  let first = parts[0].trim();
  const bracketed = first.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracketed) {
    category = bracketed[1].trim().toLowerCase() || fallbackCategory;
    first = bracketed[2].trim();
  } else {
    const split = first.match(/^(\S+)\s+(.*)$/);
    if (split && known.has(split[1].toLowerCase())) {
      category = split[1].toLowerCase();
      first = split[2].trim();
    }
  }

  const subject = (parts.length >= 2 ? first : first.slice(0, 80)) || "Support request";
  const body = parts.length >= 2 ? parts.slice(1).join(" | ").trim() : raw;
  return { category: category.slice(0, 48), subject: subject.slice(0, 120), body };
}

function formatTicket(ticket, { full = true } = {}) {
  const head = [
    `🎫 *Ticket ${ticket.id}* · ${ticket.source === "report" ? "Report" : "Support"}`,
    `*Category:* ${ticket.category || DEFAULT_CATEGORY}`,
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

async function openTicket(message, conn, { source, subject, body, target, category = DEFAULT_CATEGORY }) {
  const mode = await getTicketDelivery();
  if (mode === "off") {
    await replyFail(
      conn,
      message,
      await tr("🎫 Tickets are disabled. Ask the owner to enable them.", "🎫 Tickets sind deaktiviert. Bitte den Besitzer, sie zu aktivieren.")
    );
    return;
  }

  const supportJid = (await getTicketRoute(category)) || (await getSupportGroup());
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
    category,
  });

  await recordUserActivity(number, {
    kind: source === "report" ? "report" : "ticket",
    chat: message.from,
  });
  await auditMessage(message, {
    action: source === "report" ? "community.report" : "community.ticket",
    target: target || null,
    reason: body,
    meta: { ticketId: ticket.id, category: ticket.category, subject: ticket.subject, delivery: mode },
  });
  await systemLog(
    source === "report" ? "warn" : "info",
    `🎫 ${source === "report" ? "Report" : "Ticket"} ${ticket.id} [${ticket.category}] from ${ticket.number}${target ? ` → ${target}` : ""}`,
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
    desc: "Set support ticket destination: in-group, <jid>, or status (owner/sudo)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await ownerOnly(conn, message))) return;

    const raw = (getCommandArgs(message.body, "setsupportgroup") || "").trim();
    const args = raw.toLowerCase();
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

    const jid = raw && args !== "here" ? toGroupJid(raw) : message.from;
    if (!jid) {
      await replyFail(
        conn,
        message,
        await tr(
          `🎫 Usage: run \`${BOT_INFO.PREFIX}setsupportgroup\` inside the group, or \`${BOT_INFO.PREFIX}setsupportgroup <group-jid>\`.`,
          `🎫 Benutzung: \`${BOT_INFO.PREFIX}setsupportgroup\` in der Gruppe ausführen oder \`${BOT_INFO.PREFIX}setsupportgroup <Gruppen-JID>\`.`
        )
      );
      return;
    }

    await setSupportGroup(jid);
    await auditMessage(message, { action: "supportgroup.set", target: jid });
    await systemLog("success", `Support group set to ${jid}`);
    await replyOk(
      conn,
      message,
      await tr(
        `🎫 Support ticket destination: \`${jid}\`.\nDelivery mode: \`${await getTicketDelivery()}\`.`,
        `🎫 Ziel für Support-Tickets: \`${jid}\`.\nZustellmodus: \`${await getTicketDelivery()}\`.`
      )
    );
  }
);

command(
  {
    pattern: "setticketdelivery",
    fromMe: true,
    desc: "Set ticket delivery: group|dm|both|off (owner/sudo)",
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

command(
  {
    pattern: "setticketroute",
    fromMe: true,
    desc: "Route ticket categories to groups (owner/sudo)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await ownerOnly(conn, message))) return;

    const raw = (getCommandArgs(message.body, "setticketroute") || "").trim();
    const [first, ...rest] = raw.split(/\s+/);
    const key = (first || "").toLowerCase();

    if (!key || key === "status" || key === "?") {
      const routes = await getTicketRoutes();
      const lines = Object.entries(routes).map(([category, jid]) => `• \`${category}\` → \`${jid}\``);
      await reply(
        conn,
        message,
        await tr(
          `🎫 *Category routes*\n${lines.length ? lines.join("\n") : "_(none — all tickets use the main support group)_"}\nDefault group: \`${(await getSupportGroup()) || "not set"}\`\nSet: \`${BOT_INFO.PREFIX}setticketroute <category> here|<jid>|clear\`.`,
          `🎫 *Kategorie-Routen*\n${lines.length ? lines.join("\n") : "_(keine — alle Tickets gehen in die Haupt-Support-Gruppe)_"}\nStandardgruppe: \`${(await getSupportGroup()) || "nicht gesetzt"}\`\nSetzen: \`${BOT_INFO.PREFIX}setticketroute <kategorie> here|<jid>|clear\`.`
        )
      );
      return;
    }

    if (!/^[a-z0-9_-]{1,48}$/.test(key)) {
      await replyFail(conn, message, await tr("⚠️ Invalid category.", "⚠️ Ungültige Kategorie."));
      return;
    }

    const value = rest.join(" ").trim();
    if (!value) {
      await replyFail(
        conn,
        message,
        await tr(`Usage: \`${BOT_INFO.PREFIX}setticketroute ${key} here|<jid>|clear\`.`, `Benutzung: \`${BOT_INFO.PREFIX}setticketroute ${key} here|<jid>|clear\`.`)
      );
      return;
    }

    if (value.toLowerCase() === "clear") {
      const removed = await removeTicketRoute(key);
      await auditMessage(message, { action: "ticketroute.clear", target: key });
      await replyOk(conn, message, removed
        ? await tr(`🎫 Route \`${key}\` removed.`, `🎫 Route \`${key}\` entfernt.`)
        : await tr(`🎫 Route \`${key}\` did not exist.`, `🎫 Route \`${key}\` existierte nicht.`));
      return;
    }

    const jid = value.toLowerCase() === "here" ? message.from : toGroupJid(value);
    if (!jid) {
      await replyFail(conn, message, await tr("⚠️ Invalid group JID.", "⚠️ Ungültige Gruppen-JID."));
      return;
    }

    const route = await setTicketRoute(key, jid);
    await auditMessage(message, { action: "ticketroute.set", target: route.category, meta: { jid: route.jid } });
    await systemLog("success", `Ticket route ${route.category} → ${route.jid}`);
    await replyOk(conn, message, await tr(
      `🎫 Category \`${route.category}\` now goes to \`${route.jid}\`.`,
      `🎫 Kategorie \`${route.category}\` geht jetzt an \`${route.jid}\`.`
    ));
  }
);

command(
  {
    pattern: "setsla",
    fromMe: true,
    desc: "Configure the unanswered-ticket reminder (owner/sudo)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await ownerOnly(conn, message))) return;

    const raw = (getCommandArgs(message.body, "setsla") || "").trim().toLowerCase();
    const current = await getTicketSlaMinutes();
    if (!raw || raw === "status" || raw === "?") {
      await reply(
        conn,
        message,
        await tr(
          `⏰ Ticket SLA: ${current ? `\`${current} min\`` : "`off`"}\nDefault: \`${DEFAULT_SLA_MINUTES} min\`\nChange: \`${BOT_INFO.PREFIX}setsla <minutes|off>\`.`,
          `⏰ Ticket-SLA: ${current ? `\`${current} Min.\`` : "`aus`"}\nStandard: \`${DEFAULT_SLA_MINUTES} Min.\`\nÄndern: \`${BOT_INFO.PREFIX}setsla <Minuten|off>\`.`
        )
      );
      return;
    }

    try {
      const minutes = await setTicketSlaMinutes(raw);
      await auditMessage(message, { action: "ticketsla.set", target: String(minutes) });
      await replyOk(conn, message, minutes
        ? await tr(`⏰ Ticket SLA is now \`${minutes} min\`.`, `⏰ Ticket-SLA ist jetzt \`${minutes} Min.\`.`)
        : await tr("⏰ Ticket SLA disabled.", "⏰ Ticket-SLA deaktiviert."));
    } catch {
      await replyFail(conn, message, await tr(
        `⚠️ Use minutes 1–10080 or \`off\`.`,
        `⚠️ Nutze Minuten 1–10080 oder \`off\`.`
      ));
    }
  }
);

async function ticketCommand(message, conn, pattern) {
  const text = (getCommandArgs(message.body, pattern) || "").trim();
  if (!text) {
    await reply(
      conn,
      message,
      await tr(
        `🎫 *Support ticket*\nUsage: \`${BOT_INFO.PREFIX}${pattern} [category] <subject> | <message>\`\nExample: \`${BOT_INFO.PREFIX}${pattern} bug Login issue | It started today\`.\nCategories can be routed with \`${BOT_INFO.PREFIX}setticketroute\`.`,
        `🎫 *Support-Ticket*\nBenutzung: \`${BOT_INFO.PREFIX}${pattern} [Kategorie] <Betreff> | <Nachricht>\`\nBeispiel: \`${BOT_INFO.PREFIX}${pattern} bug Login-Problem | Seit heute\`.\nKategorien lassen sich mit \`${BOT_INFO.PREFIX}setticketroute\` routen.`
      )
    );
    return;
  }
  const parsed = await parseTicketText(text);
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
    const parsed = await parseTicketText(body, "report");
    await openTicket(message, conn, {
      source: "report",
      subject: parsed.subject === body ? "Community report" : parsed.subject,
      body: parsed.body,
      category: parsed.category,
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
    const globalJid = await getSupportGroup();
    const routeJid = ticket?.category ? await getTicketRoute(ticket.category) : null;
    const validJids = [globalJid, routeJid, ticket?.supportChat].filter(Boolean);
    if (!validJids.includes(message.from)) {
      await replyFail(
        conn,
        message,
        await tr(
          "🎫 Use `#answer` inside the configured support or category group.",
          "🎫 Nutze `#answer` in der konfigurierten Support- oder Kategorie-Gruppe."
        )
      );
      return;
    }
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

    const supportJid = message.from;
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

    const lines = rows.map((r, i) => {
      const xpLevel = levelFromXp(r.points);
      return `${i + 1}. *${r.name}* · Lv ${xpLevel} ${memberTier(xpLevel)} · ${r.points} XP · ${r.commands} cmds · ${r.messages} msgs · ${r.rank}`;
    });
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
    const xp = stats.points || 0;
    const xpLevel = levelFromXp(xp);
    const intoLevel = xp % XP_PER_LEVEL;
    const thanks = await getThanksStats(number);
    await reply(
      conn,
      message,
      await tr(
        `📊 *Your stats* · ${rank}\n• Member level: ${xpLevel} (${memberTier(xpLevel)})\n• XP: ${xp} · ${intoLevel}/${XP_PER_LEVEL} to next level\n• Commands: ${stats.commands || 0}\n• Messages: ${stats.messages || 0}\n• Reports: ${stats.reports || 0}\n• Tickets: ${stats.tickets || 0}\n• Thanks received: ${thanks.received} · given: ${thanks.given}\n• Last activity: ${fmtDate(stats.lastAt)}`,
        `📊 *Deine Statistiken* · ${rank}\n• Member-Stufe: ${xpLevel} (${memberTier(xpLevel)})\n• XP: ${xp} · ${intoLevel}/${XP_PER_LEVEL} bis zur nächsten Stufe\n• Befehle: ${stats.commands || 0}\n• Nachrichten: ${stats.messages || 0}\n• Meldungen: ${stats.reports || 0}\n• Tickets: ${stats.tickets || 0}\n• Danke erhalten: ${thanks.received} · gegeben: ${thanks.given}\n• Letzte Aktivität: ${fmtDate(stats.lastAt)}`
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

command(
  {
    pattern: "level",
    fromMe: false,
    desc: "Show your member level, title and XP progress",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    const stats = await getUserStats(number);
    const xp = stats?.points || 0;
    const level = levelFromXp(xp);
    const next = (level * XP_PER_LEVEL) - xp;
    const badges = await getBadges(number);
    const lines = [
      `🏆 *Member level ${level}* — ${memberTier(level)}`,
      `• ${await tr("Badges", "Abzeichen")}: ${formatBadges(badges)}`,
      `• XP: ${xp}`,
      `• Next level in: ${next} XP`,
      "",
      await tr("Earn XP with messages, commands, reports and tickets.", "XP gibt es für Nachrichten, Befehle, Meldungen und Tickets."),
      await tr("Member titles are cosmetic — staff ranks use `#setrank`.", "Member-Titel sind kosmetisch — Staff-Ränge laufen über `#setrank`."),
    ];
    await reply(conn, message, lines.join("\n"));
  }
);

command(
  {
    pattern: "thanks",
    fromMe: false,
    desc: "Thank a helpful member (24h cooldown per pair)",
    type: "info",
  },
  async (message, conn) => {
    const self = normalizeNumber(message.sender || message.from);
    const raw = (getCommandArgs(message.body, "thanks") || "").trim();
    const targetRef = resolveTargetUser(message) || raw.split(/\s+/)[0] || "";
    const target = normalizeNumber(targetRef);

    if (!target) {
      await replyFail(conn, message, await tr(
        `🤝 Usage: \`${BOT_INFO.PREFIX}thanks @user\` (or reply to their message).`,
        `🤝 Benutzung: \`${BOT_INFO.PREFIX}thanks @user\` (oder auf ihre Nachricht antworten).`
      ));
      return;
    }

    const result = await giveThanks(self, target);
    if (!result.ok) {
      if (result.error === "self") {
        await replyFail(conn, message, await tr("🤝 You cannot thank yourself.", "🤝 Du kannst dir nicht selbst danken."));
      } else if (result.error === "cooldown") {
        await replyFail(conn, message, await tr(
          `⏳ You already thanked that member. Try again in ${result.hours}h.`,
          `⏳ Du hast diesem Mitglied schon gedankt. Versuche es in ${result.hours} Std. wieder.`
        ));
      } else {
        await replyFail(conn, message, await tr("⚠️ Invalid target.", "⚠️ Ungültiges Ziel."));
      }
      return;
    }

    await recordUserActivity(target, { kind: "helpful", chat: message.from });
    const targetReg = await getRegistration(target);
    const shown = targetReg?.name || await tr("that member", "dieses Mitglied");
    await replyOk(conn, message, await tr(
      `🤝 You thanked *${shown}*. They earned 8 helpful XP.`,
      `🤝 Du hast *${shown}* gedankt. Sie erhalten 8 Hilfs-XP.`
    ));
  }
);

command(
  {
    pattern: "tophelpers",
    fromMe: false,
    desc: "Show the most thanked members this week",
    type: "info",
  },
  async (message, conn) => {
    const rows = [];
    for (const entry of await getTopHelpers(10)) {
      const reg = await getRegistration(entry.number);
      if (!reg) continue;
      rows.push(`• *${reg.name}* — ${entry.count}×`);
    }
    await reply(conn, message, rows.length
      ? `🤝 *Top helpers this week*\n${rows.join("\n")}`
      : await tr("🤝 No thanks recorded this week.", "🤝 Diese Woche wurde noch kein Dank erfasst."));
  }
);

command(
  {
    pattern: "badges",
    fromMe: false,
    desc: "Show your earned badges",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    const badges = await getBadges(number);
    const lines = badges.length
      ? badges.map((b) => `${b.emoji} *${b.name}* — ${b.desc}`)
      : [await tr("No badges yet.", "Noch keine Abzeichen.")];
    await reply(conn, message, `🏅 *${await tr("Your badges", "Deine Abzeichen")}*\n${lines.join("\n")}`);
  }
);

function chunkText(text, max = 3500) {
  const parts = [];
  let rest = String(text || "");
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

async function sendDataExport(conn, message, number, data) {
  const json = JSON.stringify(data, null, 2);
  const caption = await tr(
    "🔒 Your Onyx data export. Keep this file private.",
    "🔒 Dein Onyx-Datenexport. Bitte privat aufbewahren."
  );
  try {
    await sendMessage(conn, message.from, {
      document: Buffer.from(json, "utf8"),
      fileName: `onyx-mydata-${number}.json`,
      mimetype: "application/json",
      caption,
    }, { quoted: { key: message.key, message: message.message } });
    return;
  } catch {
    // Fallback for providers that reject buffer documents.
  }

  const parts = chunkText(json);
  for (const part of parts) {
    await sendMessage(conn, message.from, part);
    if (parts.length > 1) await new Promise((r) => setTimeout(r, 500));
  }
}

command(
  {
    pattern: "mydata",
    fromMe: false,
    desc: "Export your stored data (DM only) · `#mydata delete`",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    if (message.isGroup || /@g\.us$/i.test(message.from)) {
      await replyFail(conn, message, await tr(
        "🔒 Use `#mydata` in a private chat so your data is not exposed.",
        "🔒 Nutze `#mydata` im Privatchat, damit deine Daten nicht sichtbar werden."
      ));
      return;
    }

    const args = (getCommandArgs(message.body, "mydata") || "").trim().toLowerCase();
    if (args === "delete" || args === "forget" || args === "erase") {
      const result = await deleteUserData(number);
      await auditMessage(message, { action: "mydata.delete", target: number, meta: result.deleted });
      const counts = Object.entries(result.deleted)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" · ");
      await replyOk(conn, message, await tr(
        `🗑 Deleted your stored data (${counts}). Registration/consent proof and append-only audit logs are retained.`,
        `🗑 Deine gespeicherten Daten gelöscht (${counts}). Registrierung/Zustimmungsnachweis und unveränderbare Audit-Logs bleiben erhalten.`
      ));
      return;
    }

    const data = await exportUserData(number);
    await auditMessage(message, { action: "mydata.export", target: number });
    await sendDataExport(conn, message, number, data);
  }
);

command(
  {
    pattern: "forgetai",
    fromMe: false,
    desc: "Delete your AI conversation history",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    const removed = await deleteAiHistory(number);
    await replyOk(conn, message, removed
      ? await tr(`🧠 AI history deleted (${removed} messages).`, `🧠 KI-Verlauf gelöscht (${removed} Nachrichten).`)
      : await tr("🧠 No AI history to delete.", "🧠 Kein KI-Verlauf zum Löschen."));
  }
);

command(
  {
    pattern: "forgetme",
    fromMe: false,
    desc: "Alias for #mydata delete",
    type: "info",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    const result = await deleteUserData(number);
    await auditMessage(message, { action: "mydata.delete", target: number, meta: result.deleted });
    await replyOk(conn, message, await tr(
      "🗑 Stored community/AI data deleted. Use `#unregister` to delete registration and consent proof.",
      "🗑 Gespeicherte Community-/KI-Daten gelöscht. Mit `#unregister` löschst du Registrierung und Zustimmungsnachweis."
    ));
  }
);

command(
  {
    pattern: "whois",
    fromMe: false,
    desc: "Show your own profile, or another member's (mod+)",
    type: "info",
  },
  async (message, conn) => {
    const selfNumber = normalizeNumber(message.sender || message.from);
    const rawArg = (getCommandArgs(message.body, "whois") || "").trim();
    const targetRef = resolveTargetUser(message) || rawArg.split(/\s+/)[0] || selfNumber;
    const targetNumber = normalizeNumber(targetRef) || selfNumber;
    const isSelf = targetNumber === selfNumber;

    if (!isSelf) {
      const allowed =
        (await isPrivileged(message, conn)) ||
        (await isRankedAtLeast(message, conn, "mod"));
      if (!allowed) {
        await replyFail(
          conn,
          message,
          await tr(
            "🔒 You can only view your own profile. Mod+ can view others.",
            "🔒 Du kannst nur dein eigenes Profil ansehen. Mod+ dürfen andere ansehen."
          )
        );
        return;
      }
    }

    const reg = await getRegistration(targetNumber);
    const rank = await getRank(targetNumber);
    const stats = await getUserStats(targetNumber);
    const xp = stats?.points || 0;
    const level = levelFromXp(xp);
    const openTickets = (await listTickets({ number: targetNumber, status: "open", limit: 100 })).length;
    const badges = await getBadges(targetNumber);
    const name = reg?.name || message.pushName || (isSelf ? targetNumber : await tr("Unknown member", "Unbekanntes Mitglied"));

    const lines = [
      `🪪 *${await tr("Profile", "Profil")}*`,
      `• ${await tr("Name", "Name")}: *${name}*`,
      `• ${await tr("Rank", "Rang")}: ${label(rank)}`,
      `• ${await tr("Member level", "Member-Stufe")}: ${level} (${memberTier(level)})`,
      `• ${await tr("Badges", "Abzeichen")}: ${formatBadges(badges)}`,
      `• XP: ${xp}`,
      `• ${await tr("Activity", "Aktivität")}: ${stats?.messages || 0} msgs · ${stats?.commands || 0} cmds · ${stats?.reports || 0} reports · ${stats?.tickets || 0} tickets`,
      `• ${await tr("Open tickets", "Offene Tickets")}: ${openTickets}`,
      `• ${await tr("Registered", "Registriert")}: ${reg ? fmtDate(reg.ts) : await tr("no", "nein")}`,
      `• ${await tr("Last seen", "Zuletzt aktiv")}: ${stats?.lastAt ? fmtDate(stats.lastAt) : "-"}`,
    ];
    if (isSelf) lines.push("", `• ${await tr("Number", "Nummer")}: \`${targetNumber}\``);
    lines.push("", await tr("Use `#rank` for staff levels.", "Staff-Stufen zeigt `#rank`."));

    if (!isSelf) {
      await auditMessage(message, { action: "community.whois", target: targetNumber });
    }
    await reply(conn, message, lines.join("\n"));
  }
);
