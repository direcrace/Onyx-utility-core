/**
 * Anti-Delete — recovers deleted messages and resends to group
 */

import { getGroupSettings } from "./groupSettings.js";
import { msgCache } from "./cache.js";
import { normalizeNumber } from "./access.js";

export async function handleAntiDelete(conn, update) {
  try {
    if (!update?.key?.remoteJid) return;
    const jid = update.key.remoteJid;
    if (!jid.endsWith("@g.us")) return;
    const settings = await getGroupSettings(jid);
    if (!settings.antidelete) return;
    if (update.key?.fromMe) return;
    const msgId = update.key.id;
    if (!msgId) return;
    const cachedMsg = msgCache.get(msgId);
    if (!cachedMsg) return;

    const messageText =
      cachedMsg.conversation ||
      cachedMsg.extendedTextMessage?.text ||
      cachedMsg.imageMessage?.caption ||
      cachedMsg.videoMessage?.caption ||
      cachedMsg.documentMessage?.fileName ||
      "";

    const sender = update.key.participant || update.key.remoteJid;
    const senderTag = `@${normalizeNumber(sender) || sender.split("@")[0]}`;

    const { tr } = await import("./message.js");

    let recoveryText = await tr(`🗑️ *Deleted message recovered*\nFrom: ${senderTag}\n`, `🗑️ *Gelöschte Nachricht wiederhergestellt*\nVon: ${senderTag}\n`);
    if (messageText) {
      recoveryText += `\n${messageText}`;
    } else if (cachedMsg.imageMessage) {
      recoveryText += await tr(`\n📸 Image message`, `\n📸 Bildnachricht`);
    } else if (cachedMsg.videoMessage) {
      recoveryText += await tr(`\n🎥 Video message`, `\n🎥 Videonachricht`);
    } else if (cachedMsg.audioMessage) {
      recoveryText += await tr(`\n🎵 Audio message`, `\n🎵 Audionachricht`);
    } else if (cachedMsg.stickerMessage) {
      recoveryText += await tr(`\n🎨 Sticker message`, `\n🎨 Stickernachricht`);
    } else {
      recoveryText += await tr(`\n(Non-text message)`, `\n(Keine Textnachricht)`);
    }

    await conn.sendMessage(jid, { text: recoveryText, mentions: [sender] });
  } catch { /* don't crash on anti-delete errors */ }
}
