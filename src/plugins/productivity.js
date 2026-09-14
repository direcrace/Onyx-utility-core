/**
 * Notes, reminders, polls
 */

import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  tr,
} from "../utils/message.js";
import { saveNote, getNote, deleteNote, listNotes } from "../utils/notes.js";
import {
  addReminder,
  listReminders,
  cancelReminder,
  parseWhen,
} from "../utils/reminders.js";
import { t } from "../utils/i18n.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";
import { addTodo, listTodos, removeTodo, clearTodos } from "../utils/todos.js";

command(
  {
    pattern: "note",
    fromMe: false,
    desc: "Save/get/delete personal notes",
    type: "misc",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "note") || "").trim();
    const owner = message.sender;
    if (!raw) {
      await replyFail(
        conn,
        message,
        await tr(`Usage:\n${BOT_INFO.PREFIX}note set <id> <text>\n${BOT_INFO.PREFIX}note get <id>\n${BOT_INFO.PREFIX}note del <id>\n${BOT_INFO.PREFIX}note list`, `Benutzung:\n${BOT_INFO.PREFIX}note set <id> <text>\n${BOT_INFO.PREFIX}note get <id>\n${BOT_INFO.PREFIX}note del <id>\n${BOT_INFO.PREFIX}note list`)
      );
      return;
    }

    const [action, id, ...rest] = raw.split(/\s+/);
    const act = action.toLowerCase();

    if (act === "list") {
      const notes = await listNotes(owner);
      if (!notes.length) {
        await reply(conn, message, await tr("*Notes:* _(empty)_", "*Notizen:* _(leer)_"));
        return;
      }
      await reply(
        conn,
        message,
        await tr(`*Notes:*\n${notes.map((n) => `• *${n.id}* — ${n.text.slice(0, 60)}`).join("\n")}`, `*Notizen:*\n${notes.map((n) => `• *${n.id}* — ${n.text.slice(0, 60)}`).join("\n")}`)
      );
      return;
    }

    if (act === "get") {
      if (!id) {
        await replyFail(conn, message, await tr("Provide note id.", "Notizen-ID angeben."));
        return;
      }
      const n = await getNote(owner, id);
      if (!n) {
        await replyFail(conn, message, await t("NOTE_NOT_FOUND"));
        return;
      }
      await reply(conn, message, await tr(`*Note \`${id}\`*\n${n.text}`, `*Notiz \`${id}\`*\n${n.text}`));
      return;
    }

    if (act === "del" || act === "delete" || act === "rm") {
      if (!id) {
        await replyFail(conn, message, await tr("Provide note id.", "Notizen-ID angeben."));
        return;
      }
      const ok = await deleteNote(owner, id);
      if (!ok) {
        await replyFail(conn, message, await t("NOTE_NOT_FOUND"));
        return;
      }
      await replyOk(conn, message, await t("NOTE_DELETED", { id }));
      return;
    }

    if (act === "set" || act === "add" || act === "save") {
      const text = rest.join(" ").trim();
      if (!id || !text) {
        await replyFail(
          conn,
          message,
          await tr(`Usage: ${BOT_INFO.PREFIX}note set <id> <text>`, `Benutzung: ${BOT_INFO.PREFIX}note set <id> <text>`)
        );
        return;
      }
      await saveNote(owner, id, text);
      await replyOk(conn, message, await t("NOTE_SAVED", { id }));
      return;
    }

    // Shorthand: #note <id> <text> → set
    const text = [id, ...rest].join(" ").trim();
    if (action && text) {
      await saveNote(owner, action, text);
      await replyOk(conn, message, await t("NOTE_SAVED", { id: action }));
      return;
    }

    await replyFail(conn, message, await tr("Unknown note action.", "Unbekannte Notiz-Aktion."));
  }
);

command(
  {
    pattern: "remind",
    fromMe: false,
    desc: "Set a reminder (e.g. 10m buy milk)",
    type: "misc",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "remind") || "").trim();
    if (!raw) {
      await replyFail(
        conn,
        message,
        await tr(`Usage: ${BOT_INFO.PREFIX}remind <time> <text>\nTime: 30s, 10m, 2h, 1d`, `Benutzung: ${BOT_INFO.PREFIX}remind <zeit> <text>\nZeit: 30s, 10m, 2h, 1d`)
      );
      return;
    }

    const [whenToken, ...rest] = raw.split(/\s+/);
    const at = parseWhen(whenToken);
    const text = rest.join(" ").trim();
    if (!at || !text) {
      await replyFail(
        conn,
        message,
        await tr(`Invalid time or empty text.\nExample: ${BOT_INFO.PREFIX}remind 10m Check oven`, `Ungültige Zeit oder leerer Text.\nBeispiel: ${BOT_INFO.PREFIX}remind 10m Ofen prüfen`)
      );
      return;
    }

    const id = `r_${Date.now().toString(36)}`;
    await addReminder({
      id,
      jid: message.from,
      text,
      at,
      createdBy: normalizeNumber(message.sender) || message.sender,
    });

    const when = new Date(at).toLocaleString();
    await replyOk(conn, message, await t("REMINDER_SET", { when }));
  }
);

command(
  {
    pattern: "reminders",
    fromMe: false,
    desc: "List pending reminders in this chat",
    type: "misc",
  },
  async (message, conn) => {
    const list = await listReminders(message.from);
    if (!list.length) {
      await reply(conn, message, await tr("*Reminders:* _(none)_", "*Erinnerungen:* _(keine)_"));
      return;
    }
    await reply(
      conn,
      message,
      await tr(`*Reminders:*\n${list
        .map(
          (r) =>
            `• \`${r.id}\` ${new Date(r.at).toLocaleString()} — ${r.text}`
        )
        .join("\n")}`, `*Erinnerungen:*\n${list
        .map(
          (r) =>
            `• \`${r.id}\` ${new Date(r.at).toLocaleString()} — ${r.text}`
        )
        .join("\n")}`)
    );
  }
);

command(
  {
    pattern: "cancelremind",
    fromMe: false,
    desc: "Cancel reminder by id",
    type: "misc",
  },
  async (message, conn) => {
    const id = (getCommandArgs(message.body, "cancelremind") || "").trim();
    if (!id) {
      await replyFail(conn, message, await tr(`Usage: ${BOT_INFO.PREFIX}cancelremind <id>`, `Benutzung: ${BOT_INFO.PREFIX}cancelremind <id>`)
      );
      return;
    }
    const ok = await cancelReminder(id);
    if (!ok) {
      await replyFail(conn, message, await tr("Reminder not found.", "Erinnerung nicht gefunden."));
      return;
    }
    await replyOk(conn, message, await tr(`Cancelled \`${id}\``, `Abgebrochen \`${id}\``));
  }
);

command(
  {
    pattern: "poll",
    fromMe: false,
    desc: "Create a poll: question | opt1 | opt2",
    type: "misc",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "poll") || "").trim();
    if (!raw.includes("|")) {
      await replyFail(
        conn,
        message,
        await tr(`Usage: ${BOT_INFO.PREFIX}poll Question? | Option A | Option B | Option C`, `Benutzung: ${BOT_INFO.PREFIX}poll Frage? | Option A | Option B | Option C`)
      );
      return;
    }
    const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
    const name = parts[0];
    const values = parts.slice(1);
    if (!name || values.length < 2) {
      await replyFail(conn, message, await tr("Need a question and at least 2 options.", "Eine Frage und mindestens 2 Optionen nötig."));
      return;
    }
    if (values.length > 12) {
      await replyFail(conn, message, await tr("Max 12 options.", "Maximal 12 Optionen."));
      return;
    }

    try {
      await conn.sendMessage(message.from, {
        poll: {
          name,
          values,
          selectableCount: 1,
        },
      });
    } catch (err) {
      await replyFail(
        conn,
        message,
        await tr(`Poll failed: ${err?.message || "unsupported"}`, `Umfrage fehlgeschlagen: ${err?.message || "nicht unterstützt"}`)
      );
    }
  }
);

command(
  {
    pattern: "todo",
    fromMe: false,
    desc: "Personal to-do list (add/list/del/clear)",
    type: "misc",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "todo") || "").trim();
    const owner = message.sender;
    if (!raw) {
      await reply(
        conn,
        message,
        await tr(`*To-dos*\n\n${BOT_INFO.PREFIX}todo add <text>\n${BOT_INFO.PREFIX}todo list\n${BOT_INFO.PREFIX}todo del <n>\n${BOT_INFO.PREFIX}todo clear`, `*To-dos*\n\n${BOT_INFO.PREFIX}todo add <text>\n${BOT_INFO.PREFIX}todo list\n${BOT_INFO.PREFIX}todo del <n>\n${BOT_INFO.PREFIX}todo clear`)
      );
      return;
    }

    const [action, ...rest] = raw.split(/\s+/);
    const act = action.toLowerCase();

    if (act === "list") {
      const items = await listTodos(owner);
      if (!items.length) { await reply(conn, message, await tr("*To-dos:* _(empty)_", "*To-dos:* _(leer)_")); return; }
      await reply(conn, message, await tr(`*To-dos:*\n${items.map((item, i) => `${i + 1}. ${item.text}`).join("\n")}`, `*To-dos:*\n${items.map((item, i) => `${i + 1}. ${item.text}`).join("\n")}`));
      return;
    }

    if (act === "del" || act === "rm") {
      const n = parseInt(rest[0], 10);
      if (!n) { await replyFail(conn, message, await tr(`Usage: ${BOT_INFO.PREFIX}todo del <n>`, `Benutzung: ${BOT_INFO.PREFIX}todo del <n>`)); return; }
      const ok = await removeTodo(owner, n);
      if (!ok) { await replyFail(conn, message, await tr("No item with that number.", "Kein Eintrag mit dieser Nummer.")); return; }
      await replyOk(conn, message, await tr(`Removed item #${n}.`, `Eintrag #${n} entfernt.`));
      return;
    }

    if (act === "clear") {
      await clearTodos(owner);
      await replyOk(conn, message, await tr("To-dos cleared.", "To-dos geleert."));
      return;
    }

    // add / shorthand
    const text = (act === "add" ? rest.join(" ") : [action, ...rest].join(" ")).trim();
    if (!text) { await replyFail(conn, message, await tr(`Usage: ${BOT_INFO.PREFIX}todo add <text>`, `Benutzung: ${BOT_INFO.PREFIX}todo add <text>`)); return; }
    const count = await addTodo(owner, text);
    await replyOk(conn, message, await tr(`Added to your list (${count} item${count > 1 ? "s" : ""}).`, `Zur Liste hinzugefügt (${count} Eintrag${count > 1 ? "e" : ""}).`));
  }
);
