/**
 * Advanced Group Management Plugin
 * Deduplicated, LID-aware, consistent utils API usage
 */

import { command } from "../plugins.js";
import {
  sendMessage,
  sendError,
  replyOk,
  replyFail,
  getMentions,
  withTyping,
  tr,
} from "../utils/message.js";
import {
  getAdmins,
  getParticipantIds,
  formatGroupInfo,
  displayId,
  resolveTargetUser,
} from "../utils/group.js";
import { groupCache } from "../utils/cache.js";
import { isPnUser, isLidUser } from "../functions.js";
import { BOT_INFO } from "../config/constants.js";

async function getGroupMeta(conn, jid) {
  const cached = groupCache.get(jid);
  if (cached) return cached;
  const meta = await conn.groupMetadata(jid);
  groupCache.set(jid, meta);
  return meta;
}

// ==================== TAG ALL ====================
command(
  {
    pattern: "tagall",
    fromMe: true,
    desc: "Tag all group members",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      await withTyping(conn, message.from, async () => {
        const groupMetadata = await getGroupMeta(conn, message.from);
        const participants = groupMetadata.participants;
        const mentionIds = getParticipantIds(groupMetadata);

        let tagMessage = `*${groupMetadata.subject}*\n\n`;
        tagMessage += await tr(`👥 *Total Members:* ${participants.length}\n\n`, `👥 *Mitglieder gesamt:* ${participants.length}\n\n`);

        participants.forEach((participant, index) => {
          tagMessage += `${index + 1}. @${displayId(participant)}\n`;
        });

        await sendMessage(conn, message.from, tagMessage, {
          mentions: mentionIds,
          quoted: message,
        });
      });
    } catch (error) {
      console.error("Error in tagall command:", error);
      await replyFail(conn, message, await tr("Failed to tag all members.", "Mitglieder konnten nicht taggt werden."));
    }
  }
);

// ==================== NOTIFY ====================
command(
  {
    pattern: "notify",
    fromMe: true,
    desc: "Ping everyone with a short alert",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      await withTyping(conn, message.from, async () => {
        const groupMetadata = await getGroupMeta(conn, message.from);
        await sendMessage(conn, message.from, await tr("🔔 Attention everyone! 🔔", "🔔 Achtung, alle! 🔔"), {
          mentions: getParticipantIds(groupMetadata),
          quoted: message,
        });
      });
    } catch (error) {
      console.error("Error in notify command:", error);
      await replyFail(conn, message, await tr("Failed to notify members.", "Mitglieder konnten nicht informiert werden."));
    }
  }
);

// ==================== GROUP INFO ====================
command(
  {
    pattern: "groupinfo",
    fromMe: false,
    desc: "Get detailed group information",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      const groupMetadata = await getGroupMeta(conn, message.from);
      const lidUsers = groupMetadata.participants.filter((p) => isLidUser(p.id));
      const pnUsers = groupMetadata.participants.filter((p) => isPnUser(p.id));

      let info = formatGroupInfo(groupMetadata);
      info += await tr(`\n*🆔 Identifier Types:*\n`, `\n*🆔 Kennungstypen:*\n`);
      info += await tr(`• LID Users: ${lidUsers.length}\n`, `• LID-Nutzer: ${lidUsers.length}\n`);
      info += await tr(`• PN Users: ${pnUsers.length}\n`, `• PN-Nutzer: ${pnUsers.length}\n`);

      await sendMessage(conn, message.from, info);
    } catch (error) {
      console.error("Error in groupinfo command:", error);
      await replyFail(conn, message, await tr("Failed to get group information.", "Gruppeninformationen konnten nicht abgerufen werden."));
    }
  }
);

// ==================== PROMOTE ====================
command(
  {
    pattern: "promote",
    fromMe: false,
    desc: "Promote a member to admin (mention or reply)",
    type: "group",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const targetUser = resolveTargetUser(message) || getMentions(message)[0];
      if (!targetUser) {
        return await sendError(conn, message.from, await tr(`⚠️ Mention a user or reply to their message.\n*Usage:* ${BOT_INFO.PREFIX}promote @user`, `⚠️ Erwähne einen Nutzer oder antworte auf seine Nachricht.\n*Benutzung:* ${BOT_INFO.PREFIX}promote @user`));
      }

      await withTyping(conn, message.from, async () => {
        await conn.groupParticipantsUpdate(message.from, [targetUser], "promote");
        groupCache.delete(message.from);
        await replyOk(
          conn,
          message,
          await tr(`Promoted @${displayId(targetUser)} to admin!`, `@${displayId(targetUser)} zum Admin befördert!`),
          { mentions: [targetUser] }
        );
      });
    } catch (error) {
      console.error("Error in promote command:", error);
      await replyFail(conn, message, await tr("Failed to promote user.", "Benutzer konnte nicht befördert werden."));
    }
  }
);

// ==================== DEMOTE ====================
command(
  {
    pattern: "demote",
    fromMe: false,
    desc: "Demote an admin to member (mention or reply)",
    type: "group",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const targetUser = resolveTargetUser(message) || getMentions(message)[0];
      if (!targetUser) {
        return await sendError(conn, message.from, await tr(`⚠️ Mention a user or reply to their message.\n*Usage:* ${BOT_INFO.PREFIX}demote @user`, `⚠️ Erwähne einen Nutzer oder antworte auf seine Nachricht.\n*Benutzung:* ${BOT_INFO.PREFIX}demote @user`));
      }

      await withTyping(conn, message.from, async () => {
        await conn.groupParticipantsUpdate(message.from, [targetUser], "demote");
        groupCache.delete(message.from);
        await replyOk(
          conn,
          message,
          await tr(`Demoted @${displayId(targetUser)} to member!`, `@${displayId(targetUser)} zum Mitglied degradiert!`),
          { mentions: [targetUser] }
        );
      });
    } catch (error) {
      console.error("Error in demote command:", error);
      await replyFail(conn, message, await tr("Failed to demote user.", "Benutzer konnte nicht degradiert werden."));
    }
  }
);

// ==================== ADMINS ====================
command(
  {
    pattern: "admins",
    fromMe: false,
    desc: "List all group admins",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      const groupMetadata = await getGroupMeta(conn, message.from);
      const adminsList = getAdmins(groupMetadata);

      if (adminsList.length === 0) {
        return await sendError(conn, message.from, await tr("No admins found in this group.", "Keine Admins in dieser Gruppe gefunden."));
      }

      let adminList = await tr(`*👑 GROUP ADMINS*\n\n`, `*👑 GRUPPEN-ADMINS*\n\n`);
      adminList += await tr(`*Group:* ${groupMetadata.subject}\n`, `*Gruppe:* ${groupMetadata.subject}\n`);
      adminList += await tr(`*Total Admins:* ${adminsList.length}\n\n`, `*Admins gesamt:* ${adminsList.length}\n\n`);

      const mentionIds = [];
      for (const admin of adminsList) {
        mentionIds.push(admin.id);
        const role = admin.admin === "superadmin" ? (await tr("👑 Super Admin", "👑 Super-Admin")) : (await tr("🛡️ Admin", "🛡️ Admin"));
        adminList += `${mentionIds.length}. @${displayId(admin)} - ${role}\n`;
      }

      await sendMessage(conn, message.from, adminList, { mentions: mentionIds });
    } catch (error) {
      console.error("Error in admins command:", error);
      await replyFail(conn, message, await tr("Failed to get admin list.", "Adminliste konnte nicht abgerufen werden."));
    }
  }
);
