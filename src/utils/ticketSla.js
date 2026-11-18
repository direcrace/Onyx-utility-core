import logger from "./logger.js";
import { sendMessage, tr } from "./message.js";
import {
  getSupportGroup,
  getTicketRoute,
  getTicketSlaMinutes,
  listTickets,
  markTicketSlaNotified,
} from "./supportTickets.js";

const envInterval = Number.parseInt(process.env.TICKET_SLA_INTERVAL_MS ?? "300000", 10);
const CHECK_INTERVAL_MS = Number.isFinite(envInterval) && envInterval >= 30_000
  ? envInterval
  : 300_000;

let timer = null;
let connRef = null;

function durationText(ms) {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

async function ticketDestination(ticket) {
  return (
    ticket.supportChat ||
    (await getTicketRoute(ticket.category)) ||
    (await getSupportGroup())
  );
}

export async function tickTicketSla(conn = connRef) {
  if (!conn || conn.__isSub) return 0;

  const minutes = await getTicketSlaMinutes();
  if (!minutes) return 0;

  const open = await listTickets({ status: "open", limit: 300 });
  const now = Date.now();
  const due = open.filter(
    (t) => t?.id && !t.slaNotifiedAt && Number.isFinite(t.ts) && now - t.ts >= minutes * 60_000
  );
  if (!due.length) return 0;

  let sent = 0;
  for (const ticket of due) {
    const jid = await ticketDestination(ticket);
    if (!jid) continue;

    // Claim before sending so a restart cannot send the same reminder twice.
    const claimed = await markTicketSlaNotified(ticket.id, now);
    if (!claimed) continue;

    const text = await tr(
      `⏰ *Ticket SLA*\nTicket \`${ticket.id}\` [${ticket.category || "general"}] has been open for ${durationText(now - ticket.ts)}.\n*Subject:* ${ticket.subject || "-"}\n_Please answer or close it with \`#answer\` / \`#closeticket\`.`,
      `⏰ *Ticket-SLA*\nTicket \`${ticket.id}\` [${ticket.category || "general"}] ist seit ${durationText(now - ticket.ts)} offen.\n*Betreff:* ${ticket.subject || "-"}\n_Bitte mit \`#answer\` antworten oder mit \`#closeticket\` schließen._`
    );

    const quoted = ticket.supportMessageId
      ? { key: { id: ticket.supportMessageId, remoteJid: jid }, message: {} }
      : null;

    try {
      await sendMessage(conn, jid, text, quoted ? { quoted } : {});
      sent += 1;
    } catch (err) {
      logger.warn(`[ticketSla] send failed for ${ticket.id}: ${err?.message || err}`);
    }
  }
  return sent;
}

export function startTicketSlaScheduler(conn) {
  connRef = conn;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    tickTicketSla().catch((err) =>
      logger.warn(`[ticketSla] tick error: ${err?.message || err}`)
    );
  }, CHECK_INTERVAL_MS);
  timer.unref?.();

  tickTicketSla(conn).catch((err) =>
    logger.warn(`[ticketSla] initial tick error: ${err?.message || err}`)
  );
}

export function stopTicketSlaScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  connRef = null;
}
