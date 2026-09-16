

import { getGroupSettings } from "../utils/groupSettings.js";
import { groupCache } from "../utils/cache.js";
import logger from "../utils/logger.js";
import { isLogGroupAsync } from "../utils/logGroup.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";

function formatTemplate(tpl, { user, group, count }) {
  return String(tpl || "")
    .replaceAll("@user", user)
    .replaceAll("@group", group)
    .replaceAll("@count", String(count ?? ""));
}

function isBotParticipant(conn, participantJid) {
  if (!conn?.user?.id || !participantJid) return false;
  const bot = normalizeNumber(conn.user.id.replace(/:\d+@/, "@"));
  const p = normalizeNumber(participantJid);
  const botLid = normalizeNumber(conn.user.lid);
  return p === bot || (botLid && p === botLid);
}

export function attachGroupParticipantEvents(conn) {
  conn.ev.on("group-participants.update", async (update) => {
    try {
      const { id: groupJid, participants, action } = update;
      if (!groupJid || !participants?.length) return;

      groupCache.delete(groupJid);

      const settings = await getGroupSettings(groupJid);
      let meta = groupCache.get(groupJid);
      try {
        if (!meta) {
          meta = await conn.groupMetadata(groupJid);
          groupCache.set(groupJid, meta);
        }
      } catch {
        meta = { subject: "Group", participants: [] };
      }

      const groupName = meta.subject || "Group";
      const count = meta.participants?.length || 0;
      const logGroup = await isLogGroupAsync(groupJid);

      for (const p of participants) {
        const mention = typeof p === "string" ? p : p?.id || p;
        if (!mention) continue;

        if (action === "request_join" && settings.autoapprove) {
          for (const p of participants) {
            const id = typeof p === "string" ? p : p?.id || p;
            if (!id) continue;
            try {
              await conn.groupParticipantsUpdate(groupJid, [id], "approve");
            } catch {  }
          }
          continue;
        }

        if (action === "add" && isBotParticipant(conn, mention) && !logGroup) {
          const { tr } = await import("../utils/message.js");
          await conn.sendMessage(groupJid, {
            text: await tr(
              `👋 *${BOT_INFO.NAME}* is here.\n\n` +
                `Admins: run \`${BOT_INFO.PREFIX}groupsetup recommended\` for welcome + antilink + antispam.\n` +
                `Or \`${BOT_INFO.PREFIX}menu\` to see commands.`,
              `👋 *${BOT_INFO.NAME}* ist da.\n\n` +
                `Admins: führe \`${BOT_INFO.PREFIX}groupsetup recommended\` für Begrüßung + Antilink + Antispam aus.\n` +
                `Oder \`${BOT_INFO.PREFIX}menu\` für alle Befehle.`
            ),
          });
          continue;
        }

        if (logGroup) continue;

        const tag = `@${String(mention).split("@")[0]}`;

        if (action === "add" && settings.welcome) {
          const text = formatTemplate(settings.welcomeText, {
            user: tag,
            group: groupName,
            count,
          });
          await conn.sendMessage(groupJid, {
            text,
            mentions: [mention],
          });
        }

        if ((action === "remove" || action === "leave") && settings.goodbye) {
          const text = formatTemplate(settings.goodbyeText, {
            user: tag,
            group: groupName,
            count,
          });
          await conn.sendMessage(groupJid, {
            text,
            mentions: [mention],
          });
        }
      }
    } catch (err) {
      logger.warn("group-participants.update:", err?.message || err);
    }
  });
}
