
import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { isOwnerMessage, normalizeNumber } from "../utils/access.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import {
  RANKS,
  RANK_LEVELS,
  RANK_LABELS,
  ASSIGNABLE_RANKS,
  getRank,
  getRankLevel,
  listRanked,
} from "../utils/ranks.js";
import { BOT_INFO } from "../config/constants.js";

function label(rank) {
  return RANK_LABELS[rank] || rank;
}

command(
  {
    pattern: "rank",
    fromMe: false,
    desc: "Show a user's community rank",
    type: "info",
  },
  async (message, conn) => {
    const target = resolveTargetUser(message) || message.sender;
    const rank = await getRank(target);
    const level = await getRankLevel(target);
    const shown = Number.isFinite(level) ? level : RANKS.length + 1;
    await reply(
      conn,
      message,
      await tr(
        `*${BOT_INFO.NAME} · Rank*\n\n` +
          `• User: @${displayId(target)}\n` +
          `• Rank: *${label(rank)}*\n` +
          `• Level: ${shown}/${RANKS.length}`,
        `*${BOT_INFO.NAME} · Rang*\n\n` +
          `• Nutzer: @${displayId(target)}\n` +
          `• Rang: *${label(rank)}*\n` +
          `• Stufe: ${shown}/${RANKS.length}`
      ),
      { mentions: [target] }
    );
  }
);

command(
  {
    pattern: "ranks",
    fromMe: false,
    desc: "Show the rank hierarchy and assignments",
    type: "info",
  },
  async (message, conn) => {
    const ranked = await listRanked();
    const order = [...RANKS].reverse();
    const none = await tr("(none)", "(niemand)");
    const lines = order.map((rank) => {
      const members = ranked.filter((r) => r.rank === rank);
      const names = members.map((m) => m.number).join(", ");
      return `• *${label(rank)}* (${RANK_LEVELS[rank]}) — ${names || none}`;
    });

    await reply(
      conn,
      message,
      await tr(
        `*Rank hierarchy*\n\n${lines.join("\n")}\n\n` +
          `Assignable by the owner: ${ASSIGNABLE_RANKS.join(" < ")}`,
        `*Rang-Hierarchie*\n\n${lines.join("\n")}\n\n` +
          `Vom Owner vergebbar: ${ASSIGNABLE_RANKS.join(" < ")}`
      )
    );
  }
);

command(
  {
    pattern: "setrank",
    fromMe: true,
    desc: "Assign a community rank to a user (owner)",
    type: "owner",
  },
  async (message, conn) => {
    if (!isOwnerMessage(message, conn)) {
      await replyFail(
        conn,
        message,
        await tr(
          "Only the bot owner can assign ranks.",
          "Nur der Bot-Besitzer kann Ränge vergeben."
        )
      );
      return;
    }

    const raw = (getCommandArgs(message.body, "setrank") || "").trim();
    const parts = raw ? raw.split(/\s+/) : [];
    const rankArg = parts.length ? parts[parts.length - 1].toLowerCase() : "";

    let target = resolveTargetUser(message);
    if (!target && parts.length >= 2) {
      target = normalizeNumber(parts[0]);
    }

    if (!target || !rankArg || parts.length < 2) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}setrank <@user|number> <rank>\`\nRanks: ${ASSIGNABLE_RANKS.join(", ")}`,
          `Benutzung: \`${BOT_INFO.PREFIX}setrank <@user|Nummer> <Rang>\`\nRänge: ${ASSIGNABLE_RANKS.join(", ")}`
        )
      );
      return;
    }

    const number = normalizeNumber(target);
    if (!number) {
      await replyFail(
        conn,
        message,
        await tr("Invalid target number.", "Ungültige Ziel-Nummer.")
      );
      return;
    }

    if (!ASSIGNABLE_RANKS.includes(rankArg)) {
      await replyFail(
        conn,
        message,
        await tr(
          `Unknown rank. Assignable: ${ASSIGNABLE_RANKS.join(", ")}`,
          `Unbekannter Rang. Vergebbar: ${ASSIGNABLE_RANKS.join(", ")}`
        )
      );
      return;
    }

    const { setRank } = await import("../utils/ranks.js");
    await setRank(number, rankArg);

    await replyOk(
      conn,
      message,
      await tr(
        `@${number} is now *${label(rankArg)}*.`,
        `@${number} ist jetzt *${label(rankArg)}*.`
      ),
      { mentions: [number + "@s.whatsapp.net"] }
    );
  }
);
