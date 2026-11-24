import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  getMentions,
  tr,
  sendMessage,
} from "../utils/message.js";
import {
  resolveTargetUser,
  displayId,
  isAdmin,
} from "../utils/group.js";
import { groupCache } from "../utils/cache.js";
import { isPrivileged, isRankedAtLeast, senderCandidates } from "../utils/access.js";
import { setGroupSettings } from "../utils/groupSettings.js";
import { writeAudit } from "../enterprise/audit.js";
import { BOT_INFO } from "../config/constants.js";
import {
  groupJidFrom,
  parseInviteCode,
  messageIdFrom,
  requesterNumber,
  userJid,
  getReceiver,
  setReceiver,
  getAction,
  createAction,
  attachActionMessage,
  getActionByMessage,
  deleteAction,
  getRequest,
  createRequest,
  attachRequestMessage,
  getRequestByMessage,
  deleteRequest,
  approveRequest,
  getSetupByToken,
  deleteSetup,
} from "../utils/groupRequests.js";

const NOT_ADMIN = "DU BIST KEIN ADMIN. BITTE KONTAKTIERE EINEN ADMIN UM DIESEN PROZESS ZU BEENDEN.";

async function groupMeta(conn, jid) {
  const cached = groupCache.get(jid);
  if (cached) return cached;
  const meta = await conn.groupMetadata(jid);
  groupCache.set(jid, meta);
  return meta;
}

async function senderIsGroupAdmin(conn, message) {
  const meta = await groupMeta(conn, message.from);
  const ids = new Set([message.sender, message.participant, ...senderCandidates(message, conn)]);
  for (const id of ids) {
    if (id && isAdmin(meta, id)) return true;
  }
  return false;
}

async function audit(conn, action, record, meta = {}) {
  await writeAudit({
    action,
    actor: record.actor,
    target: record.target || null,
    chat: record.chat || null,
    meta,
  }).catch(() => {});
}

async function requireGroup(conn, message) {
  if (message.isGroup) return true;
  await replyFail(conn, message, await tr("Group only.", "Nur in Gruppen."));
  return false;
}

async function decideAction(conn, message, type, decision) {
  if (!(await senderIsGroupAdmin(conn, message))) {
    await reply(conn, message, NOT_ADMIN);
    return;
  }
  const record = await getActionByMessage({
    groupJid: message.from,
    type,
    messageId: messageIdFrom(message),
  });
  if (!record) {
    await replyFail(conn, message, await tr(
      "Reply to the bot's pending request message.",
      "Antworte auf die ausstehende Anfrage-Nachricht des Bots."
    ));
    return;
  }

  const label = type === "promote" ? "promotion" : "demotion";
  await deleteAction(record);

  if (decision === "reject") {
    await audit(conn, `group.${type}.reject`, {
      actor: message.sender,
      target: record.number,
      chat: message.from,
    }, { id: record.id, approver: requesterNumber(message, conn) });
    await replyOk(conn, message, await tr(`Self-${label} rejected.`, `Self-${label} abgelehnt.`));
    return;
  }

  try {
    await conn.groupParticipantsUpdate(message.from, [record.participant], type);
  } catch (error) {
    await replyFail(conn, message, await tr(
      `Could not apply the ${label} (am I still admin?).`,
      `${label} konnte nicht angewendet werden (bin ich noch Admin?).`
    ));
    return;
  }
  groupCache.delete(message.from);
  await audit(conn, `group.${type}.approve`, {
    actor: message.sender,
    target: record.number,
    chat: message.from,
  }, { id: record.id, approver: requesterNumber(message, conn) });
  await replyOk(conn, message, await tr(`Self-${label} approved.`, `Self-${label} genehmigt.`));
}

async function cancelAction(conn, message, type) {
  const number = requesterNumber(message, conn);
  const record = await getAction({ groupJid: message.from, number, type });
  if (!record || record.requester !== number) {
    await replyFail(conn, message, await tr(
      "No pending request from you.",
      "Keine ausstehende Anfrage von dir."
    ));
    return;
  }
  await deleteAction(record);
  await audit(conn, `group.${type}.cancel`, {
    actor: message.sender,
    target: number,
    chat: message.from,
  }, { id: record.id });
  await replyOk(conn, message, await tr("Request cancelled.", "Anfrage abgebrochen."));
}

async function selfRoleHandler(conn, message, type) {
  if (!(await requireGroup(conn, message))) return;

  const args = (getCommandArgs(message.body, type === "promote" ? "pr" : "dm") || "")
    .trim()
    .toLowerCase();

  if (args === "approve" || args === "reject") {
    await decideAction(conn, message, type, args);
    return;
  }
  if (args === "cancel") {
    await cancelAction(conn, message, type);
    return;
  }
  if (args) {
    await replyFail(conn, message, await tr(
      `Usage: \`${BOT_INFO.PREFIX}${type === "promote" ? "pr" : "dm"}\`, \`... cancel\` · admins: \`... approve\` / \`... reject\` (reply to the bot).`,
      `Benutzung: \`${BOT_INFO.PREFIX}${type === "promote" ? "pr" : "dm"}\`, \`... cancel\` · Admins: \`... approve\` / \`... reject\` (Antwort auf den Bot).`
    ));
    return;
  }

  if (!(await isRankedAtLeast(message, conn, "mod"))) {
    await replyFail(conn, message, await tr("Mod+ only.", "Nur Mod+."));
    return;
  }

  const number = requesterNumber(message, conn);
  if (!number) {
    await replyFail(conn, message, await tr("Could not resolve your number.", "Deine Nummer konnte nicht ermittelt werden."));
    return;
  }

  const input = {
    groupJid: message.from,
    number,
    type,
    participant: message.sender || message.participant || userJid(number),
    requester: number,
  };
  const result = await createAction(input);
  if (result.existing) {
    await replyFail(conn, message, await tr(
      "You already have an open request. Reply to the bot with `cancel` to withdraw it.",
      "Du hast bereits eine offene Anfrage. Antworte dem Bot mit `cancel`, um sie zurückzuziehen."
    ));
    return;
  }

  const card = await tr(
    `🔐 Self-${type === "promote" ? "promotion" : "demotion"} requested by @${number}.\n\nA group admin must reply to this message with \`${BOT_INFO.PREFIX}${type === "promote" ? "pr" : "dm"} approve\` or \`... reject\`.`,
    `🔐 Self-${type === "promote" ? "Beförderung" : "Degradierung"} von @${number} angefordert.\n\nEin Gruppen-Admin muss auf diese Nachricht mit \`${BOT_INFO.PREFIX}${type === "promote" ? "pr" : "dm"} approve\` oder \`... reject\` antworten.`
  );
  const sent = await reply(conn, message, card, { mentions: [userJid(number)] });
  await attachActionMessage({
    ...input,
    messageId: sent?.key?.id || sent?.id || null,
  });
  await audit(conn, `group.${type}.request`, {
    actor: message.sender,
    target: number,
    chat: message.from,
  }, { id: result.record.id });
}

command(
  {
    pattern: "pr",
    fromMe: false,
    desc: "Request self-promotion to group admin (mod+, admin approval)",
    type: "group",
    groupOnly: true,
    botAdminRequired: true,
  },
  (message, conn) => selfRoleHandler(conn, message, "promote")
);

command(
  {
    pattern: "dm",
    fromMe: false,
    desc: "Request self-demotion from group admin (mod+, admin approval)",
    type: "group",
    groupOnly: true,
    botAdminRequired: true,
  },
  (message, conn) => selfRoleHandler(conn, message, "demote")
);

async function sudoRoleHandler(conn, message, type) {
  if (!(await requireGroup(conn, message))) return;
  if (!(await isPrivileged(message, conn))) {
    await replyFail(conn, message, await tr("Owner/sudo only.", "Nur Besitzer/Sudo."));
    return;
  }
  const target = resolveTargetUser(message) || getMentions(message)[0];
  if (!target) {
    await replyFail(conn, message, await tr(
      `Mention a user or reply to their message: \`${BOT_INFO.PREFIX}${type === "promote" ? "apr" : "adm"} @user\`.`,
      `Erwähne einen Nutzer oder antworte auf seine Nachricht: \`${BOT_INFO.PREFIX}${type === "promote" ? "apr" : "adm"} @user\`.`
    ));
    return;
  }
  try {
    await conn.groupParticipantsUpdate(message.from, [target], type);
  } catch (error) {
    await replyFail(conn, message, await tr(
      `Could not ${type} that user (am I admin?).`,
      `Nutzer konnte nicht ${type === "promote" ? "befördert" : "degradiert"} werden (bin ich Admin?).`
    ));
    return;
  }
  groupCache.delete(message.from);
  await audit(conn, `group.${type}.sudo`, {
    actor: message.sender,
    target,
    chat: message.from,
  }, { via: "sudo" });
  await replyOk(conn, message, await tr(
    `${type === "promote" ? "Promoted" : "Demoted"} @${displayId(target)} (sudo).`,
    `@${displayId(target)} ${type === "promote" ? "befördert" : "degradiert"} (Sudo).`
  ), { mentions: [target] });
}

command(
  {
    pattern: "apr",
    fromMe: false,
    desc: "Promote a member as sudo (no group-admin approval)",
    type: "group",
    groupOnly: true,
    botAdminRequired: true,
  },
  (message, conn) => sudoRoleHandler(conn, message, "promote")
);

command(
  {
    pattern: "adm",
    fromMe: false,
    desc: "Demote an admin as sudo (no group-admin approval)",
    type: "group",
    groupOnly: true,
    botAdminRequired: true,
  },
  (message, conn) => sudoRoleHandler(conn, message, "demote")
);

command(
  {
    pattern: "setrequestreceive",
    fromMe: false,
    desc: "Set the group that receives bot-join requests (sudo)",
    type: "admin",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, await tr("Owner/sudo only.", "Nur Besitzer/Sudo."));
      return;
    }
    const raw = (getCommandArgs(message.body, "setrequestreceive") || "").trim();
    const current = await getReceiver();
    if (!raw || raw.toLowerCase() === "status" || raw === "?") {
      await reply(conn, message, await tr(
        `📥 Request receiver: ${current ? `\`${current}\`` : "not configured"}.\nSet: \`${BOT_INFO.PREFIX}setrequestreceive here|<group-jid>\` · clear: \`${BOT_INFO.PREFIX}setrequestreceive clear\`.`,
        `📥 Anfrage-Empfänger: ${current ? `\`${current}\`` : "nicht konfiguriert"}.\nSetzen: \`${BOT_INFO.PREFIX}setrequestreceive here|<Gruppen-JID>\` · löschen: \`${BOT_INFO.PREFIX}setrequestreceive clear\`.`
      ));
      return;
    }
    if (raw.toLowerCase() === "clear") {
      await setReceiver(null);
      await audit(conn, "group.request.receiver.clear", {
        actor: message.sender,
        target: current,
        chat: message.from,
      });
      await replyOk(conn, message, await tr("Request receiver cleared.", "Anfrage-Empfänger gelöscht."));
      return;
    }
    const jid = raw.toLowerCase() === "here" ? message.from : groupJidFrom(raw);
    if (!jid) {
      await replyFail(conn, message, await tr(
        "Invalid group. Use `here` or a group JID.",
        "Ungültige Gruppe. Nutze `here` oder eine Gruppen-JID."
      ));
      return;
    }
    await setReceiver(jid);
    await audit(conn, "group.request.receiver.set", {
      actor: message.sender,
      target: jid,
      chat: message.from,
    });
    await replyOk(conn, message, await tr(
      `Request receiver: \`${jid}\`.`,
      `Anfrage-Empfänger: \`${jid}\`.`
    ));
  }
);

command(
  {
    pattern: "request",
    fromMe: false,
    desc: "Request the bot in a group via WhatsApp invite link",
    type: "group",
  },
  async (message, conn) => {
    const raw = getCommandArgs(message.body, "request") || "";
    const code = parseInviteCode(raw);
    if (!code) {
      await replyFail(conn, message, await tr(
        `Usage: \`${BOT_INFO.PREFIX}request <chat.whatsapp.com/...>\`.`,
        `Benutzung: \`${BOT_INFO.PREFIX}request <chat.whatsapp.com/...>\`.`
      ));
      return;
    }
    const receiver = await getReceiver();
    if (!receiver) {
      await replyFail(conn, message, await tr(
        "No request receiver configured. Ask the owner to run `#setrequestreceive`.",
        "Kein Anfrage-Empfänger konfiguriert. Bitte den Owner, `#setrequestreceive` auszuführen."
      ));
      return;
    }
    const number = requesterNumber(message, conn);
    if (!number) {
      await replyFail(conn, message, await tr("Could not resolve your number.", "Deine Nummer konnte nicht ermittelt werden."));
      return;
    }
    const result = await createRequest({ number, code, requesterJid: userJid(number) });
    if (result.existing) {
      await replyFail(conn, message, await tr(
        "You already have an open request. Only one at a time.",
        "Du hast bereits eine offene Anfrage. Nur eine gleichzeitig."
      ));
      return;
    }
    const card = await tr(
      `📥 *Group request*\n• From: @${number}\n• Code: \`${code.slice(0, 6)}…\`\n\nReply to this message with \`${BOT_INFO.PREFIX}rq approve\` or \`${BOT_INFO.PREFIX}rq reject\` (team+).`,
      `📥 *Gruppen-Anfrage*\n• Von: @${number}\n• Code: \`${code.slice(0, 6)}…\`\n\nAntworte auf diese Nachricht mit \`${BOT_INFO.PREFIX}rq approve\` oder \`${BOT_INFO.PREFIX}rq reject\` (Team+).`
    );
    const sent = await sendMessage(conn, receiver, card, { mentions: [userJid(number)] });
    await attachRequestMessage({
      number,
      messageId: sent?.key?.id || sent?.id || null,
    });
    await writeAudit({
      action: "group.request.create",
      actor: message.sender,
      target: number,
      chat: message.from,
      meta: { id: result.record.id, receiver, code: code.slice(0, 6) },
    }).catch(() => {});
    await replyOk(conn, message, await tr(
      "Request sent. You will get a DM with the decision.",
      "Anfrage gesendet. Du bekommst die Entscheidung per DM."
    ));
  }
);

command(
  {
    pattern: "rq",
    fromMe: false,
    desc: "Approve or reject a pending group request (team+)",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "rq") || "").trim().toLowerCase();
    if (args !== "approve" && args !== "reject") {
      await replyFail(conn, message, await tr(
        `Usage: \`${BOT_INFO.PREFIX}rq approve\` / \`${BOT_INFO.PREFIX}rq reject\` (reply to the request).`,
        `Benutzung: \`${BOT_INFO.PREFIX}rq approve\` / \`${BOT_INFO.PREFIX}rq reject\` (Antwort auf die Anfrage).`
      ));
      return;
    }
    if (!(await isRankedAtLeast(message, conn, "team"))) {
      await replyFail(conn, message, await tr("Team+ only.", "Nur Team+."));
      return;
    }
    const record = await getRequestByMessage({ messageId: messageIdFrom(message) });
    if (!record) {
      await replyFail(conn, message, await tr(
        "Reply to the bot's request message.",
        "Antworte auf die Anfrage-Nachricht des Bots."
      ));
      return;
    }
    const approver = requesterNumber(message, conn);

    if (args === "reject") {
      await deleteRequest(record);
      await writeAudit({
        action: "group.request.reject",
        actor: message.sender,
        target: record.number,
        chat: message.from,
        meta: { id: record.id, approver },
      }).catch(() => {});
      await sendMessage(conn, record.requesterJid || userJid(record.number), await tr(
        "Your group request was rejected.",
        "Deine Gruppen-Anfrage wurde abgelehnt."
      ));
      await replyOk(conn, message, await tr("Request rejected; requester notified by DM.", "Anfrage abgelehnt; Anfragender per DM informiert."));
      return;
    }

    let groupJid;
    try {
      groupJid = await conn.groupAcceptInvite(record.code);
    } catch (error) {
      await replyFail(conn, message, await tr(
        "The invite could not be used (expired or revoked?).",
        "Der Einladungslink konnte nicht genutzt werden (abgelaufen oder widerrufen?)."
      ));
      return;
    }
    if (!groupJid) {
      await replyFail(conn, message, await tr(
        "The invite did not return a group. Ask for a fresh link.",
        "Der Einladungslink hat keine Gruppe zurückgegeben. Bitte um einen neuen Link."
      ));
      return;
    }
    const setup = await approveRequest(record, { groupJid, approver });
    await writeAudit({
      action: "group.request.approve",
      actor: message.sender,
      target: record.number,
      chat: message.from,
      meta: { id: record.id, groupJid, approver },
    }).catch(() => {});
    await replyOk(conn, message, await tr(
      `Bot joined \`${groupJid}\`. Team+ must join there and run \`${BOT_INFO.PREFIX}setupaccept ${setup.token}\`.`,
      `Bot ist \`${groupJid}\` beigetreten. Team+ muss dort joinen und \`${BOT_INFO.PREFIX}setupaccept ${setup.token}\` ausführen.`
    ));
    await sendMessage(conn, groupJid, await tr(
      `👋 Joined after an approved request. A team member must run \`${BOT_INFO.PREFIX}setupaccept ${setup.token}\` here to finish setup.`,
      `👋 Nach genehmigter Anfrage beigetreten. Ein Teammitglied muss hier \`${BOT_INFO.PREFIX}setupaccept ${setup.token}\` ausführen, um das Setup abzuschließen.`
    ));
  }
);

command(
  {
    pattern: "setupaccept",
    fromMe: false,
    desc: "Finish an approved group setup (team+, in the target group)",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    const token = (getCommandArgs(message.body, "setupaccept") || "").trim();
    if (!token) {
      await replyFail(conn, message, await tr(
        `Usage: \`${BOT_INFO.PREFIX}setupaccept <token>\`.`,
        `Benutzung: \`${BOT_INFO.PREFIX}setupaccept <token>\`.`
      ));
      return;
    }
    if (!(await isRankedAtLeast(message, conn, "team"))) {
      await replyFail(conn, message, await tr("Team+ only.", "Nur Team+."));
      return;
    }
    const setup = await getSetupByToken(token);
    if (!setup || setup.groupJid !== message.from) {
      await replyFail(conn, message, await tr(
        "Unknown or expired setup token in this group.",
        "Unbekanntes oder abgelaufenes Setup-Token in dieser Gruppe."
      ));
      return;
    }
    await setGroupSettings(message.from, {
      welcome: true,
      goodbye: true,
      antilink: true,
      antispam: true,
    });
    groupCache.delete(message.from);
    await deleteSetup(setup);
    await writeAudit({
      action: "group.setup.accept",
      actor: message.sender,
      target: message.from,
      chat: message.from,
      meta: { id: setup.id, requester: setup.requester, approver: setup.approver },
    }).catch(() => {});
    await replyOk(conn, message, await tr(
      "Setup accepted: welcome, goodbye, antilink and antispam are ON.",
      "Setup akzeptiert: Willkommen, Abschied, Antilink und Antispam sind AN."
    ));
  }
);
