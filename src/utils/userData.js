import { normalizeNumber } from "./access.js";
import { getRegistration } from "./registration.js";
import { getConsent } from "./consent.js";
import { getRank } from "./ranks.js";
import { getUserStats, deleteUserStats } from "./communityStats.js";
import { getFullHistory, clearHistory } from "./aiHistory.js";
import { listTickets, deleteTicketsFor } from "./supportTickets.js";
import { getThanksEntriesFor, deleteThanksFor } from "./karma.js";
import { listNotes, deleteAllNotes } from "./notes.js";
import { listTodos, clearTodos, countTodos } from "./todos.js";
import { listReminders, deleteRemindersByCreator } from "./reminders.js";

export async function exportUserData(input) {
  const number = normalizeNumber(input);
  if (!number) throw new Error("Invalid number");

  const [
    registration,
    consent,
    rank,
    stats,
    aiHistory,
    tickets,
    thanks,
    notes,
    todos,
    reminders,
  ] = await Promise.all([
    getRegistration(number),
    getConsent(number),
    getRank(number),
    getUserStats(number),
    getFullHistory(number),
    listTickets({ number, limit: 300 }),
    getThanksEntriesFor(number),
    listNotes(number),
    listTodos(number),
    listReminders(null),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    number,
    registration,
    consent,
    staffRank: rank,
    communityStats: stats,
    aiHistory,
    tickets,
    thanks,
    notes,
    todos,
    reminders: reminders.filter((r) => normalizeNumber(r?.createdBy) === number),
    retentionNote:
      "Append-only audit/message/raw log files under logs/ are operational evidence and are not part of this export. Registration/consent proof is retained; use #unregister to delete it.",
  };
}

export async function deleteAiHistory(number) {
  const n = normalizeNumber(number);
  if (!n) return 0;
  const before = (await getFullHistory(n)).length;
  await clearHistory(n);
  return before;
}

export async function deleteUserData(number) {
  const n = normalizeNumber(number);
  if (!n) throw new Error("Invalid number");

  const todoCount = await countTodos(n);
  const [aiMessages, notes, tickets, thanks, reminders, stats] = await Promise.all([
    deleteAiHistory(n),
    deleteAllNotes(n),
    deleteTicketsFor(n),
    deleteThanksFor(n),
    deleteRemindersByCreator(n),
    deleteUserStats(n),
  ]);
  await clearTodos(n);

  return {
    number: n,
    deleted: { aiMessages, notes, todos: todoCount, tickets, thanks, reminders, stats: stats ? 1 : 0 },
    retained: ["registration", "consent proof", "append-only audit logs"],
  };
}
