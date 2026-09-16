

import { command } from "../plugins.js";
import { replyFail, tr } from "../utils/message.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS_DIR = join(__dirname, "..", "assets", "meropic");
const TOTAL_IMAGES = 22;
const CAPTION = "by Mero.";
const EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

async function findImage(i) {
  for (const ext of EXTENSIONS) {
    const p = join(ASSETS_DIR, `${i}.${ext}`);
    try {
      await readFile(p);
      return p;
    } catch {  }
  }
  return null;
}

for (let i = 1; i <= TOTAL_IMAGES; i++) {
  command(
    { pattern: `${i}`, fromMe: false, desc: `MeroPic #${i}`, type: "fun" },
    async (message, conn) => {
      try {
        const filePath = await findImage(i);
        if (!filePath) {
          const expected = join(ASSETS_DIR, `${i}.png`);
          await replyFail(conn, message, await tr(`MeroPic #${i} not found.\nExpected file: \`${expected}\`\n(accepts .png/.jpg/.jpeg/.webp)`, `MeroPic #${i} nicht gefunden.\nErwartete Datei: \`${expected}\`\n(akzeptiert .png/.jpg/.jpeg/.webp)`));
          return;
        }
        const buf = await readFile(filePath);
        await conn.sendMessage(message.from, { image: buf, caption: CAPTION },
          { quoted: { key: message.key, message: message.message } });
      } catch { await replyFail(conn, message, await tr(`MeroPic #${i} not found.`, `MeroPic #${i} nicht gefunden.`)); }
    }
  );
}
