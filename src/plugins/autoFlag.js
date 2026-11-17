
import { command } from "../plugins.js";
import { reply, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { isAutoFlagEnabled, setAutoFlagEnabled } from "../enterprise/autoFlag.js";
import { appendAuditFile } from "../enterprise/audit.js";

command(
  {
    pattern: "autoflag",
    fromMe: true,
    desc: "Auto ToS flagger: #autoflag on|off|status",
    type: "owner",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "autoflag") || "").trim().toLowerCase();
    const action = raw.split(/\s+/)[0] || "status";

    if (["status", "get", "?"].includes(action)) {
      const on = await isAutoFlagEnabled();
      await reply(
        conn,
        message,
        await tr(
          `🚩 Auto-Flag: *${on ? "ON" : "OFF"}*\n\n` +
            `When ON, the monitor detects ToS/abuse violations, flags users and can auto-suspend a Mini or auto-ban a user.\n` +
            `Change: \`#autoflag on|off\``,
          `🚩 Auto-Flag: *${on ? "AN" : "AUS"}*\n\n` +
            `Wenn AN, erkennt der Monitor ToS-/Missbrauchs-Verstöße, flaggt User und kann ein Mini automatisch suspendieren oder einen User automatisch bannen.\n` +
            `Ändern: \`#autoflag on|off\``
        )
      );
      return;
    }

    let value = null;
    if (["on", "true", "enable", "enabled", "1"].includes(action)) value = true;
    else if (["off", "false", "disable", "disabled", "0"].includes(action)) value = false;

    if (value === null) {
      await replyFail(
        conn,
        message,
        await tr(
          "Usage: `#autoflag on` | `#autoflag off` | `#autoflag status`",
          "Benutzung: `#autoflag on` | `#autoflag off` | `#autoflag status`"
        )
      );
      return;
    }

    const previous = await isAutoFlagEnabled();
    await setAutoFlagEnabled(value);

    await appendAuditFile({
      action: "autoflag.set",
      actor: message.sender,
      target: value ? "on" : "off",
      chat: message.from,
      meta: {
        previous: previous ? "on" : "off",
        next: value ? "on" : "off",
        by: message.pushName || null,
        messageId: message.key?.id || null,
      },
    });

    await reply(
      conn,
      message,
      await tr(
        `🚩 Auto-Flag: *${previous ? "ON" : "OFF"}* → *${value ? "ON" : "OFF"}*` +
          (value ? "" : `\nKeine neuen ToS-Flags, keine Auto-Suspends/Bans.`),
        `🚩 Auto-Flag: *${previous ? "AN" : "AUS"}* → *${value ? "AN" : "AUS"}*` +
          (value ? "" : `\nKeine neuen ToS-Flags, keine Auto-Suspends/Bans.`)
      )
    );
  }
);
