import { getUserStats, levelFromXp } from "./communityStats.js";
import { getRegistration } from "./registration.js";
import { listTickets } from "./supportTickets.js";
import { getThanksStats } from "./karma.js";

export const BADGES = [
  { id: "registered", emoji: "✅", name: "Registered", desc: "Accepted the terms" },
  { id: "firstTicket", emoji: "🎫", name: "First Ticket", desc: "Opened a ticket or report" },
  { id: "responder", emoji: "💬", name: "Responder", desc: "Answered a ticket as support" },
  { id: "helper", emoji: "🤝", name: "Helper", desc: "Received a thank-you" },
  { id: "topHelper", emoji: "🏆", name: "Top Helper", desc: "10 thank-yous" },
  { id: "thanked", emoji: "🙏", name: "Thanked", desc: "Thanked someone 5 times" },
  { id: "chatter", emoji: "🗣️", name: "Chatter", desc: "100 messages" },
  { id: "commander", emoji: "⌨️", name: "Commander", desc: "100 commands" },
  { id: "reporter", emoji: "🚨", name: "Reporter", desc: "5 community reports" },
  { id: "veteran", emoji: "🎖️", name: "Veteran", desc: "Member level 11" },
  { id: "legend", emoji: "👑", name: "Legend", desc: "Member level 21" },
];

export async function getBadges(number) {
  const [stats, reg, tickets, thanks] = await Promise.all([
    getUserStats(number),
    getRegistration(number),
    listTickets({ limit: 300 }),
    getThanksStats(number),
  ]);

  const xp = stats?.points || 0;
  const level = levelFromXp(xp);
  const answered = Boolean(
    reg?.name && tickets.some((t) => t.status === "answered" && t.answeredBy === reg.name)
  );

  const ctx = {
    registered: Boolean(reg),
    firstTicket: (stats?.tickets || 0) + (stats?.reports || 0) >= 1 || tickets.some((t) => t.number === number),
    responder: answered,
    helper: thanks.received >= 1,
    topHelper: thanks.received >= 10,
    thanked: thanks.given >= 5,
    chatter: (stats?.messages || 0) >= 100,
    commander: (stats?.commands || 0) >= 100,
    reporter: (stats?.reports || 0) >= 5,
    veteran: level >= 11,
    legend: level >= 21,
  };

  return BADGES.filter((badge) => ctx[badge.id]);
}

export function formatBadges(badges) {
  return badges.length ? badges.map((b) => b.emoji).join(" ") : "—";
}
