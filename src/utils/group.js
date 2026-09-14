/**
 * Group Utility Functions
 * LID/PN-aware helper functions for group operations
 */

import { isLidUser, isPnUser } from "../functions.js";
import { groupCache } from "./cache.js";

/**
 * Collect all known identifiers for a participant (id, lid, phoneNumber)
 * @param {object} participant
 * @returns {Set<string>}
 */
function participantIds(participant) {
  const ids = new Set();
  if (participant?.id) ids.add(participant.id);
  if (participant?.lid) ids.add(participant.lid);
  if (participant?.phoneNumber) ids.add(participant.phoneNumber);
  return ids;
}

/**
 * Collect candidate JIDs for a user (sender + alts + bot user fields)
 * @param {string|object} userRef - JID string or { id, lid, jid }
 * @returns {Set<string>}
 */
export function collectUserIds(userRef) {
  const ids = new Set();
  if (!userRef) return ids;

  if (typeof userRef === "string") {
    ids.add(userRef);
    return ids;
  }

  for (const key of ["id", "lid", "jid", "pn"]) {
    if (userRef[key]) ids.add(userRef[key]);
  }
  return ids;
}

/**
 * Find participant matching any of the candidate JIDs (LID or PN)
 * @param {object} groupMetadata
 * @param {string|object} userRef
 * @returns {object|null}
 */
export function findParticipant(groupMetadata, userRef) {
  const candidates = collectUserIds(userRef);
  if (!candidates.size || !groupMetadata?.participants) return null;

  return (
    groupMetadata.participants.find((p) => {
      const pIds = participantIds(p);
      for (const c of candidates) {
        if (pIds.has(c)) return true;
      }
      return false;
    }) || null
  );
}

/**
 * Check if user is group admin (LID/PN aware)
 * @param {object} groupMetadata
 * @param {string|object} userId
 * @returns {boolean}
 */
export function isAdmin(groupMetadata, userId) {
  const participant = findParticipant(groupMetadata, userId);
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

/**
 * Check if bot is group admin using conn.user (LID/PN)
 * @param {object} groupMetadata
 * @param {object} conn - Baileys connection
 * @returns {boolean}
 */
export function isBotAdmin(groupMetadata, conn) {
  const botRef = {
    id: conn?.user?.id,
    lid: conn?.user?.lid,
    jid: conn?.user?.id,
  };
  // Also try stripping device suffix from id (123:xx@s.whatsapp.net)
  if (conn?.user?.id) {
    const bare = conn.user.id.replace(/:\d+@/, "@");
    botRef.pn = bare;
  }
  return isAdmin(groupMetadata, botRef);
}

/**
 * Get all group admins
 */
export function getAdmins(groupMetadata) {
  return (groupMetadata?.participants || []).filter(
    (p) => p.admin === "admin" || p.admin === "superadmin"
  );
}

/**
 * Get all group members (non-admins)
 */
export function getMembers(groupMetadata) {
  return (groupMetadata?.participants || []).filter((p) => !p.admin);
}

/**
 * Get participant IDs for mentions
 */
export function getParticipantIds(groupMetadata) {
  return (groupMetadata?.participants || []).map((p) => p.id);
}

/**
 * Display label for a participant / JID
 */
export function displayId(jidOrParticipant) {
  if (!jidOrParticipant) return "unknown";
  if (typeof jidOrParticipant === "string") {
    return jidOrParticipant.split("@")[0];
  }
  const id = jidOrParticipant.id || "";
  if (isPnUser(id)) return id.split("@")[0];
  if (isLidUser(id) && jidOrParticipant.phoneNumber) {
    return jidOrParticipant.phoneNumber.split("@")[0];
  }
  return id.split("@")[0] || "LID User";
}

/**
 * Validate group command permissions
 * @param {object} message
 * @param {object} groupMetadata
 * @param {object} options
 * @param {object} [conn] - required when botAdminRequired
 */
export function validateGroupPermissions(
  message,
  groupMetadata,
  options = {},
  conn = null
) {
  const result = { valid: true, error: null, metadata: groupMetadata };

  if (!message.isGroup) {
    result.valid = false;
    result.error = "GROUP_ONLY";
    return result;
  }

  if (options.adminOnly) {
    const ok =
      isAdmin(groupMetadata, {
        id: message.sender,
        lid: message.participant,
        pn: message.participantAlt,
      }) ||
      isAdmin(groupMetadata, message.sender) ||
      isAdmin(groupMetadata, message.participant) ||
      isAdmin(groupMetadata, message.participantAlt);

    if (!ok) {
      result.valid = false;
      result.error = "ADMIN_ONLY";
      return result;
    }
  }

  if (options.botAdminRequired) {
    if (!conn || !isBotAdmin(groupMetadata, conn)) {
      result.valid = false;
      result.error = "BOT_ADMIN";
      return result;
    }
  }

  return result;
}

/**
 * Format group info for display
 */
export function formatGroupInfo(groupMetadata) {
  const admins = getAdmins(groupMetadata);
  const members = getMembers(groupMetadata);
  const superAdmins = admins.filter((a) => a.admin === "superadmin");

  let info = `*📋 GROUP INFORMATION*\n\n`;
  info += `*Name:* ${groupMetadata.subject}\n`;
  info += `*Group ID:* ${groupMetadata.id}\n`;

  if (groupMetadata.creation) {
    info += `*Created:* ${new Date(groupMetadata.creation * 1000).toLocaleDateString()}\n`;
  }

  if (groupMetadata.owner) {
    info += `\n*👑 Owner:* ${displayId(groupMetadata.owner)}\n`;
    if (groupMetadata.ownerPn) {
      info += `*Owner PN:* ${groupMetadata.ownerPn.split("@")[0]}\n`;
    }
  }

  info += `\n*👥 Members:*\n`;
  info += `• Total: ${groupMetadata.participants.length}\n`;
  info += `• Super Admins: ${superAdmins.length}\n`;
  info += `• Admins: ${admins.length - superAdmins.length}\n`;
  info += `• Regular: ${members.length}\n`;

  if (groupMetadata.announce !== undefined) {
    info += `\n*⚙️ Settings:*\n`;
    info += `• Announce: ${groupMetadata.announce ? "Only Admins" : "All Members"}\n`;
    info += `• Restrict: ${groupMetadata.restrict ? "Only Admins" : "All Members"}\n`;
  }

  if (groupMetadata.desc) {
    info += `\n*📄 Description:*\n${groupMetadata.desc}\n`;
  }

  return info;
}

/**
 * Resolve a participant's PN-based JID from a possibly LID-prefixed reference.
 * Baileys groupParticipantsUpdate requires the phone-number WID, so LID
 * references must be mapped via group metadata.
 */
export async function resolveParticipantJid(conn, groupJid, userRef) {
  if (!userRef) return "";
  let meta = groupCache.get(groupJid);
  if (!meta) {
    try {
      meta = await conn.groupMetadata(groupJid);
      groupCache.set(groupJid, meta);
    } catch {
      meta = null;
    }
  }
  const participant = meta ? findParticipant(meta, userRef) : null;
  return participant?.id || participant?.phoneNumber || userRef;
}

/**
 * LID-safe kick: resolve the member's PN JID then remove them.
 */
export async function kickUser(conn, groupJid, userRef) {
  const realJid = await resolveParticipantJid(conn, groupJid, userRef);
  if (!realJid) return false;
  await conn.groupParticipantsUpdate(groupJid, [realJid], "remove");
  groupCache.delete(groupJid);
  return true;
}

/**
 * Promote/demote participants
 */
export async function updateParticipantRole(conn, groupJid, participants, action) {
  return await conn.groupParticipantsUpdate(groupJid, participants, action);
}

/**
 * Resolve target user from reply or mention
 */
export function resolveTargetUser(message) {
  const mentions = message.message?.contextInfo?.mentionedJid || [];
  if (message.quoted || message.message?.contextInfo?.participant) {
    const quotedParticipant = message.message?.contextInfo?.participant;
    if (quotedParticipant) return quotedParticipant;
  }
  if (mentions.length > 0) return mentions[0];
  return null;
}
