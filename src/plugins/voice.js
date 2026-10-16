import { command } from "../plugins.js";
import { replyFail, withTyping, tr } from "../utils/message.js";
import { writeTempFile, safeUnlink } from "../utils/media.js";
import { execFile } from "child_process";
import { BOT_INFO } from "../config/constants.js";
import { ffmpegPath } from "../system/platform.js";

const EFFECTS = {
  bass: ["-af", "equalizer=f=54:width_type=o:width=2:g=20"],
  blown: ["-af", "acrusher=.1:1:64:0:log"],
  deep: ["-af", "atempo=4/4,asetrate=44500*2/3"],
  earrape: ["-af", "volume=12"],
  fast: ["-filter:a", "atempo=1.63,asetrate=44100"],
  fat: ["-filter:a", "atempo=1.6,asetrate=22100"],
  nightcore: ["-af", "atempo=1.06,asetrate=44100*1.25"],
  reverse: ["-filter_complex", "areverse"],
  robot: [
    "-filter_complex",
    "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  ],
  slow: ["-filter:a", "atempo=0.7,asetrate=44100"],
  smooth: [
    "-filter:v",
    "minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=120'",
  ],
  tupai: ["-af", "atempo=0.5,asetrate=65100"],
};

async function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

for (const [name, filterArgs] of Object.entries(EFFECTS)) {
  command(
    { pattern: name, fromMe: false, desc: `${name} voice effect`, type: "fun", alwaysQuoted: true },
    async (message, conn) => {
      await withTyping(conn, message.from, async () => {
        const quoted = message.quoted;
        const isAudio =
          quoted &&
          (quoted.mtype === "audioMessage" ||
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage);
        if (!isAudio) {
          await replyFail(
            conn,
            message,
            await tr(
              `Reply to an audio message with \`${BOT_INFO.PREFIX}${name}\``,
              `Antworte auf eine Sprachnachricht mit \`${BOT_INFO.PREFIX}${name}\``
            )
          );
          return;
        }

        const bin = await ffmpegPath().catch(() => null);
        if (!bin) {
          await replyFail(
            conn,
            message,
            await tr(
              "⚠️ FFmpeg is not available on this host — voice effects are disabled.",
              "⚠️ FFmpeg ist auf diesem Host nicht verfügbar — Stimm-Effekte sind deaktiviert."
            )
          );
          return;
        }

        let inputPath = null;
        let outputPath = null;
        try {
          const { downloadMediaMessage } = await import("baileys");
          const contextMsg =
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage || quoted.message;
          const buffer = await downloadMediaMessage(
            { key: quoted.key, message: contextMsg },
            "buffer",
            {}
          );
          inputPath = await writeTempFile(buffer, ".webm");
          outputPath = inputPath.replace(/\.webm$/, "") + `-${name}.mp3`;

          await runFfmpeg(bin, [
            "-y",
            "-i",
            inputPath,
            ...filterArgs,
            outputPath,
          ]);

          const { readFile } = await import("fs/promises");
          const audioBuf = await readFile(outputPath);
          await conn.sendMessage(
            message.from,
            { audio: audioBuf, mimetype: "audio/mpeg", ptt: false },
            { quoted: { key: message.key, message: message.message } }
          );
        } catch (err) {
          console.error(`Voice effect ${name} failed:`, err?.message);
          await replyFail(
            conn,
            message,
            await tr(`${name} effect failed.`, `Effekt ${name} fehlgeschlagen.`)
          );
        } finally {
          if (inputPath) await safeUnlink(inputPath).catch(() => {});
          if (outputPath) await safeUnlink(outputPath).catch(() => {});
        }
      }, { timeoutMs: 90_000 });
    }
  );
}