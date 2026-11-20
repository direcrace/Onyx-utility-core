
import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  tr,
} from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { can } from "../enterprise/rbac.js";
import {
  addDevTodo,
  listDevTodos,
  removeDevTodo,
  clearDevTodos,
  MAX_DEV_TODOS,
} from "../utils/devTodos.js";

command(
  {
    pattern: "devtodo",
    fromMe: false,
    desc: "Shared staff to-do list (add/list/del/clear)",
    type: "admin",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "devtodo"))) {
      await replyFail(
        conn,
        message,
        await tr(
          "Staff only (admin/mod/owner).",
          "Nur für Staff (Admin/Mod/Owner)."
        )
      );
      return;
    }

    const raw = (getCommandArgs(message.body, "devtodo") || "").trim();
    if (!raw || raw.toLowerCase() === "help") {
      await reply(
        conn,
        message,
        await tr(
          `*Shared dev to-dos*\n\n${BOT_INFO.PREFIX}devtodo add <text>\n${BOT_INFO.PREFIX}devtodo list\n${BOT_INFO.PREFIX}devtodo del <n>\n${BOT_INFO.PREFIX}devtodo clear\n\n_Visible to all staff (admin/mod/owner)._`,
          `*Geteilte Dev-To-dos*\n\n${BOT_INFO.PREFIX}devtodo add <Text>\n${BOT_INFO.PREFIX}devtodo list\n${BOT_INFO.PREFIX}devtodo del <n>\n${BOT_INFO.PREFIX}devtodo clear\n\n_Sichtbar für alle Staff-Mitglieder (Admin/Mod/Owner)._`
        )
      );
      return;
    }

    const [action, ...rest] = raw.split(/\s+/);
    const act = action.toLowerCase();

    if (act === "list" || act === "ls") {
      const items = await listDevTodos();
      if (!items.length) {
        await reply(
          conn,
          message,
          await tr("*Dev to-dos:* _(empty)_", "*Dev-To-dos:* _(leer)_")
        );
        return;
      }
      const shown = items.slice(0, 50).map((item, i) => {
        const date = new Date(item.createdAt).toISOString().slice(0, 10);
        const text = item.text.length > 140 ? `${item.text.slice(0, 140)}…` : item.text;
        return `${i + 1}. ${text}\n   _${date} · ${item.author || "—"}_`;
      });
      if (items.length > 50) {
        shown.push(await tr(`_…and ${items.length - 50} more_`, `_…und ${items.length - 50} weitere_`));
      }
      await reply(conn, message, `*Dev to-dos:*\n${shown.join("\n")}`);
      return;
    }

    if (act === "del" || act === "rm") {
      const n = parseInt(rest[0], 10);
      if (!n || n < 1) {
        await replyFail(
          conn,
          message,
          await tr(
            `Usage: ${BOT_INFO.PREFIX}devtodo del <n>`,
            `Benutzung: ${BOT_INFO.PREFIX}devtodo del <n>`
          )
        );
        return;
      }
      const ok = await removeDevTodo(n);
      if (!ok) {
        await replyFail(
          conn,
          message,
          await tr("No item with that number.", "Kein Eintrag mit dieser Nummer.")
        );
        return;
      }
      await replyOk(
        conn,
        message,
        await tr(`Removed item #${n}.`, `Eintrag #${n} entfernt.`)
      );
      return;
    }

    if (act === "clear") {
      await clearDevTodos();
      await replyOk(
        conn,
        message,
        await tr("Shared to-dos cleared.", "Geteilte To-dos geleert.")
      );
      return;
    }

    const text = (act === "add" ? rest.join(" ") : [action, ...rest].join(" ")).trim();
    if (!text) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: ${BOT_INFO.PREFIX}devtodo add <text>`,
          `Benutzung: ${BOT_INFO.PREFIX}devtodo add <Text>`
        )
      );
      return;
    }
    const result = await addDevTodo(message.sender, text);
    if (!result.ok) {
      await replyFail(
        conn,
        message,
        result.reason === "full"
          ? await tr(
              `Shared list is full (${MAX_DEV_TODOS} items).`,
              `Geteilte Liste ist voll (${MAX_DEV_TODOS} Einträge).`
            )
          : await tr("Text cannot be empty.", "Text darf nicht leer sein.")
      );
      return;
    }
    await replyOk(
      conn,
      message,
      await tr(
        `Added to the shared list (${result.count} item${result.count === 1 ? "" : "s"}).`,
        `Zur geteilten Liste hinzugefügt (${result.count} Eintrag${result.count === 1 ? "" : "e"}).`
      )
    );
  }
);
