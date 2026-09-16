

import { command } from "../plugins.js";
import { reply, replyFail, withTyping, tr } from "../utils/message.js";
import { writeTempFile, safeUnlink } from "../utils/media.js";
import { exec } from "child_process";

const EFFECTS = {
  bass:       "-af equalizer=f=54:width_type=o:width=2:g=20",
  blown:      "-af acrusher=.1:1:64:0:log",
  deep:       "-af atempo=4/4,asetrate=44500*2/3",
  earrape:    "-af volume=12",
  fast:       '-filter:a "atempo=1.63,asetrate=44100"',
  fat:        '-filter:a "atempo=1.6,asetrate=22100"',
  nightcore:  "-filter:a atempo=1.06,asetrate=44100*1.25",
  reverse:    '-filter_complex "areverse"',
  robot:      "-filter_complex \"afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75\"",
  slow:       '-filter:a "atempo=0.7,asetrate=44100"',
  smooth:     "-filter:v \"minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=120'\"",
  tupai:      '-filter:a "atempo=0.5,asetrate=65100"',
};

for (const [name, filter] of Object.entries(EFFECTS)) {
  command(
    { pattern: name, fromMe: false, desc: `${name} voice effect`, type: "fun", alwaysQuoted: true },
    async (message, conn) => {
      await withTyping(conn, message.from, async () => {
        const quoted = message.quoted;
        const isAudio = quoted && (quoted.mtype === "audioMessage" ||
          (message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage));
        if (!isAudio) { await replyFail(conn, message, await tr(`Reply to an audio message with \`#${name}\``, `Antworte auf eine Sprachnachricht mit \`#${name}\``)); return; }
        try {
          const { downloadMediaMessage } = await import("baileys");
          const contextMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || quoted.message;
          const buffer = await downloadMediaMessage({ key: quoted.key, message: contextMsg }, "buffer", {});
          const inputPath = await writeTempFile(buffer, ".webm");
          const outputPath = inputPath.replace(".webm", ".mp3");
          await new Promise((resolve, reject) => {
            exec(`ffmpeg -y -i "${inputPath}" ${filter} "${outputPath}"`, (err) => {
              if (err) reject(err); else resolve();
            });
          });
          const { readFile } = await import("fs/promises");
          const audioBuf = await readFile(outputPath);
          await conn.sendMessage(message.from, { audio: audioBuf, mimetype: "audio/mpeg", ptt: false },
            { quoted: { key: message.key, message: message.message } });
          await safeUnlink(inputPath);
          await safeUnlink(outputPath);
        } catch (err) {
          console.error(`Voice effect ${name} failed:`, err?.message);
          await replyFail(conn, message, await tr(`${name} effect failed.`, `Effekt ${name} fehlgeschlagen.`));
        }
      }, { timeoutMs: 60_000 });
    }
  );
}
