import { command, getCommands } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getMode, getSenderRankLevel } from "../utils/access.js";
import {
  RANKS,
  RANK_LEVELS,
  RANK_LABELS,
  ASSIGNABLE_RANKS,
  getRank,
  listRanked,
  setRank,
  isRoot,
  isOwnerNumber,
} from "../utils/ranks.js";
import { getRegistration } from "../utils/registration.js";
import { resolveTargetUser } from "../utils/group.js";
import { getLogLevel } from "../enterprise/logCapture.js";
import { isAutoFlagEnabled } from "../enterprise/autoFlag.js";
import { getSupportGroup, getTicketDelivery, listTickets } from "../utils/supportTickets.js";
import { auditMessage } from "../enterprise/audit.js";
import { systemLog } from "../utils/logGroup.js";

function label(rank) {
  return RANK_LABELS[rank] || rank || "User";
}

function levelText(level) {
  return level === Infinity ? "∞" : String(level);
}

function minRankFor(cmd) {
  if (cmd.fromMe || cmd.type === "owner") return "co-owner";
  if (cmd.type === "team") return "team";
  if (cmd.adminOnly) return "admin";
  return null;
}

function rankValue(rank) {
  return RANK_LEVELS[rank] || 0;
}

function hierarchyLines(myRank, myLevel) {
  return [...RANKS].reverse().map((rank) => {
    const level = RANK_LEVELS[rank];
    const marker = level === myLevel ? "  ← you" : "";
    return `• *${label(rank)}* (${level})${marker}`;
  });
}

command(
  {
    pattern: "team",
    fromMe: false,
    desc: "TEAM menu, rank hierarchy and your available team commands",
    type: "team",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "team") || "").trim().toLowerCase();
    const myRank = await getRank(message.sender);
    const rawLevel = await getSenderRankLevel(message, conn);
    const myLevel = rawLevel === Infinity ? RANKS.length + 1 : rawLevel;
    const showAll = (arg === "all" || arg === "full") && rawLevel === Infinity;

    const lines = [
      `🏅 *${BOT_INFO.NAME} · TEAM*`,
      await tr(`Your rank: *${label(myRank)}* · Level ${levelText(rawLevel)}`, `Dein Rang: *${label(myRank)}* · Stufe ${levelText(rawLevel)}`),
      "",
      await tr("*Rank hierarchy*", "*Rang-Hierarchie*"),
      ...hierarchyLines(myRank, myLevel),
    ];

    const grouped = new Map();
    for (const cmd of getCommands()) {
      const min = minRankFor(cmd);
      if (!min) continue;
      if (!showAll && rankValue(min) > myLevel) continue;
      if (!grouped.has(min)) grouped.set(min, []);
      grouped.get(min).push(cmd);
    }

    lines.push("", await tr("*Available commands*", "*Verfügbare Befehle*"));
    const tiers = [...RANKS].reverse().filter((rank) => grouped.has(rank));
    if (!tiers.length) {
      lines.push(await tr("_(no team commands for your rank)_", "_(keine Team-Befehle für deinen Rang)_"));
    } else {
      for (const tier of tiers) {
        lines.push("", `*${label(tier)}+*`);
        for (const cmd of grouped.get(tier).sort((a, b) => a.patternName.localeCompare(b.patternName))) {
          lines.push(`• \`${BOT_INFO.PREFIX}${cmd.patternName}\`${cmd.desc ? ` — ${cmd.desc}` : ""}`);
        }
      }
    }

    lines.push(
      "",
      await tr(
        `Open a command with \`${BOT_INFO.PREFIX}help <command>\` · Team list: \`${BOT_INFO.PREFIX}teamlist\` · Status: \`${BOT_INFO.PREFIX}teamstatus\`.`,
        `Befehl öffnen mit \`${BOT_INFO.PREFIX}help <Befehl>\` · Team-Liste: \`${BOT_INFO.PREFIX}teamlist\` · Status: \`${BOT_INFO.PREFIX}teamstatus\`.`
      )
    );

    await reply(conn, message, lines.join("\n"));
  }
);

command(
  {
    pattern: "teamhelp",
    fromMe: false,
    desc: "Shortcut for the TEAM menu",
    type: "team",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "teamhelp") || "").trim();
    await reply(conn, message, arg ? `Use \`${BOT_INFO.PREFIX}team ${arg}\`.` : `Use \`${BOT_INFO.PREFIX}team\`.`);
  }
);

command(
  {
    pattern: "teamlist",
    fromMe: false,
    desc: "List the team grouped by rank with registered names",
    type: "team",
  },
  async (message, conn) => {
    const ranked = await listRanked();
    const rows = [];
    for (const entry of ranked) {
      const reg = await getRegistration(entry.number);
      rows.push({ ...entry, name: reg?.name || entry.number });
    }

    const lines = [
      `🏅 *${BOT_INFO.NAME} · TEAM LIST*`,
      "",
    ];
    const tiers = [...RANKS].reverse();
    for (const rank of tiers) {
      const members = rows.filter((r) => r.rank === rank);
      if (!members.length) continue;
      lines.push(`*${label(rank)} (${RANK_LEVELS[rank]})*`);
      lines.push(...members.map((m) => `• ${m.name}`));
      lines.push("");
    }
    if (lines.length <= 2) {
      lines.push(await tr("_(no ranks assigned)_", "_(keine Ränge vergeben)_"));
    }

    await reply(conn, message, lines.join("\n").trim());
  }
);

command(
  {
    pattern: "teamstatus",
    fromMe: false,
    desc: "Show team-relevant runtime status",
    type: "team",
  },
  async (message, conn) => {
    const mode = await getMode();
    const logLevel = await getLogLevel();
    const autoflag = await isAutoFlagEnabled();
    const supportJid = await getSupportGroup();
    const delivery = await getTicketDelivery();
    const openTickets = (await listTickets({ status: "open", limit: 100 })).length;
    const teamSize = (await listRanked()).length;

    await reply(
      conn,
      message,
      await tr(
        `🏅 *TEAM STATUS*\n\n` +
          `• Mode: \`${mode}\`\n` +
          `• Log level: \`${logLevel}\`\n` +
          `• Autoflag: \`${autoflag ? "on" : "off"}\`\n` +
          `• Support group: ${supportJid ? `\`${supportJid}\`` : "not configured"}\n` +
          `• Ticket delivery: \`${delivery}\`\n` +
          `• Open tickets: ${openTickets}\n` +
          `• Ranked members: ${teamSize}`,
        `🏅 *TEAM-STATUS*\n\n` +
          `• Modus: \`${mode}\`\n` +
          `• Log-Stufe: \`${logLevel}\`\n` +
          `• Autoflag: \`${autoflag ? "an" : "aus"}\`\n` +
          `• Support-Gruppe: ${supportJid ? `\`${supportJid}\`` : "nicht konfiguriert"}\n` +
          `• Ticket-Zustellung: \`${delivery}\`\n` +
          `• Offene Tickets: ${openTickets}\n` +
          `• Mitglieder mit Rang: ${teamSize}`
      )
    );
  }
);

command(
  {
    pattern: "teamset",
    fromMe: true,
    desc: "Assign a rank with hierarchy protection (co-owner+)",
    type: "team",
  },
  async (message, conn) => {
    const callerLevel = await getSenderRankLevel(message, conn);
    if (callerLevel < rankValue("co-owner")) {
      await replyFail(conn, message, await tr("Co-owner+ only.", "Nur Co-Owner oder höher."));
      return;
    }

    const raw = (getCommandArgs(message.body, "teamset") || "").trim();
    const parts = raw ? raw.split(/\s+/) : [];
    const rankArg = parts.length ? parts[parts.length - 1].toLowerCase() : "";
    let target = resolveTargetUser(message);
    if (!target && parts.length >= 2) target = normalizeNumber(parts[0]);

    if (!target || !rankArg || parts.length < 2) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}teamset <@user|number> <rank>\`\nRanks: ${ASSIGNABLE_RANKS.join(", ")}`,
          `Benutzung: \`${BOT_INFO.PREFIX}teamset <@user|Nummer> <Rang>\`\nRänge: ${ASSIGNABLE_RANKS.join(", ")}`
        )
      );
      return;
    }

    const number = normalizeNumber(target);
    if (!number) {
      await replyFail(conn, message, await tr("Invalid target number.", "Ungültige Ziel-Nummer."));
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
    if (isRoot(number) || isOwnerNumber(number)) {
      await replyFail(conn, message, await tr("The owner's rank cannot be changed.", "Der Rang des Besitzers kann nicht geändert werden."));
      return;
    }
    if (callerLevel !== Infinity && rankValue(rankArg) >= callerLevel) {
      await replyFail(
        conn,
        message,
        await tr(
          "You cannot assign a rank equal to or higher than your own.",
          "Du kannst keinen Rang vergeben, der gleich oder höher als deiner ist."
        )
      );
      return;
    }

    await setRank(number, rankArg);
    const reg = await getRegistration(number);
    const shownName = reg?.name || number;
    await auditMessage(message, { action: "team.rank.set", target: number, reason: rankArg });
    await systemLog("info", `🏅 ${shownName} → ${label(rankArg)}`);
    await replyOk(
      conn,
      message,
      await tr(`*${shownName}* is now *${label(rankArg)}*.`, `*${shownName}* ist jetzt *${label(rankArg)}*.`)
    );
  }
);
