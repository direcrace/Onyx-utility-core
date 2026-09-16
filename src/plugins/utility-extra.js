

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
  getCommandArgs,
  withTyping,
  tr,
} from "../utils/message.js";
import { downloadQuotedOrSelf } from "../utils/media.js";
import { BOT_INFO } from "../config/constants.js";

const MAX_FETCH_BYTES = 4 * 1024 * 1024;

command(
  { pattern: "fetch", fromMe: true, desc: "Fetch a URL / API endpoint (owner)", type: "misc" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const url = (getCommandArgs(message.body, "fetch") || "").trim();
      if (!url) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}fetch <url>\``, `Benutzung: \`${BOT_INFO.PREFIX}fetch <url>\``)); return; }
      if (!/^https?:\/\//i.test(url)) { await replyFail(conn, message, await tr("Only http(s) URLs.", "Nur http(s)-URLs.")); return; }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; OnyxBot/5.1)" },
        });
        clearTimeout(timer);
        if (!res.ok) { await replyFail(conn, message, `HTTP ${res.status} ${res.statusText}`); return; }

        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        const length = parseInt(res.headers.get("content-length") || "0", 10) || 0;
        if (length > MAX_FETCH_BYTES) { await replyFail(conn, message, await tr("Response too large (max 4MB).", "Antwort zu groß (max. 4 MB).")); return; }

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_FETCH_BYTES) { await replyFail(conn, message, await tr("Response too large (max 4MB).", "Antwort zu groß (max. 4 MB).")); return; }

        if (contentType.includes("json")) {
          let parsed;
          try { parsed = JSON.parse(buf.toString("utf8")); } catch { parsed = null; }
          if (parsed) {
            const pretty = JSON.stringify(parsed, null, 2);
            await reply(conn, message, `*${url}*\n\n\`\`\`json\n${pretty.slice(0, 3900)}\`\`\``);
            return;
          }
        }

        if (contentType.includes("text") || contentType.includes("xml") || contentType.includes("html") || contentType.includes("csv")) {
          await reply(conn, message, `*${url}*\n\n${buf.toString("utf8").slice(0, 4000)}`);
          return;
        }

        const mime = contentType.split(";")[0] || "application/octet-stream";
        await conn.sendMessage(message.from, {
          document: buf,
          mimetype: mime,
          fileName: decodeURIComponent(url.split("/").pop()?.split("?")[0] || "download"),
        }, { quoted: { key: message.key, message: message.message } });
      } catch (err) {
        await replyFail(conn, message, await tr(`Fetch failed: ${err?.message || "network error"}`, `Abruf fehlgeschlagen: ${err?.message || "Netzwerkfehler"}`));
      }
    });
  }
);

command(
  { pattern: "vv", fromMe: false, desc: "Recover a view-once media (reply to it)", type: "media" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      if (!message.quoted || !["image", "video", "audio", "document"].includes(message.quoted.type)) {
        await replyFail(conn, message, await tr(`Reply to a view-once media with \`${BOT_INFO.PREFIX}vv\`.`, `Antworte auf ein View-once-Medium mit \`${BOT_INFO.PREFIX}vv\`.`));
        return;
      }
      try {
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        if (!media || !media.buffer?.length) {
          await replyFail(conn, message, await tr("Could not download the view-once media (expired?).", "View-once-Medium konnte nicht geladen werden (abgelaufen?)."));
          return;
        }
        let content;
        if (media.type === "audio") {
          content = { audio: media.buffer, ptt: false };
        } else if (media.type === "document") {
          content = {
            document: media.buffer,
            mimetype: media.mimetype || "application/octet-stream",
            fileName: "recovered",
          };
        } else {
          content = { [media.type]: media.buffer, caption: await tr("from a view-once 👀", "aus einem View-once 👀") };
        }
        await conn.sendMessage(message.from, content, { quoted: { key: message.key, message: message.message } });
      } catch {
        await replyFail(conn, message, await tr("Could not recover the view-once media.", "View-once-Medium konnte nicht wiederhergestellt werden."));
      }
    });
  }
);

command(
  { pattern: "del", fromMe: false, desc: "Delete a message (reply to it)", type: "admin", groupOnly: true, adminOnly: true, botAdminRequired: true },
  async (message, conn) => {
    const stanzaId = message.message?.contextInfo?.stanzaId;
    const participant = message.message?.contextInfo?.participant;
    if (stanzaId) {
      try {
        const targetKey = {
          remoteJid: message.from,
          id: stanzaId,
          participant: participant || undefined,
          fromMe: false,
        };
        await conn.sendMessage(message.from, { delete: targetKey });
        return;
      } catch {  }
    }
    try {
      await conn.sendMessage(message.from, { delete: message.key });
    } catch {
      await replyFail(conn, message, await tr("Delete failed (am I admin?).", "Löschen fehlgeschlagen (bin ich Admin?)."));
    }
  }
);