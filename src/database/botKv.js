/**
 * BotKV — key/value settings on the same DB as auth
 * Keys: mode, sudo, sticker_packname, sticker_author
 */

let kvBackend = null;
let seeded = false;

/**
 * Attach BotKV backend from auth init (sqlite or postgres)
 * @param {{ get: Function, set: Function, del?: Function }} backend
 */
export function attachBotKv(backend) {
  kvBackend = backend;
  seeded = false;
}

function ensureBackend() {
  if (!kvBackend) {
    throw new Error("BotKV not initialized — call useMultiDbAuthState() first");
  }
  return kvBackend;
}

export async function kvGet(key) {
  const b = ensureBackend();
  return b.get(key);
}

export async function kvSet(key, value) {
  const b = ensureBackend();
  return b.set(key, value);
}

export async function kvDel(key) {
  const b = ensureBackend();
  if (typeof b.del === "function") return b.del(key);
  return b.set(key, null);
}

/**
 * Seed mode / sudo from env once if DB has no values yet
 */
export async function seedBotKvFromEnv() {
  if (seeded) return;
  ensureBackend();

  const existingMode = await kvGet("mode");
  if (existingMode == null) {
    const envMode = (process.env.BOT_MODE || "public").toLowerCase().trim();
    const mode = envMode === "private" ? "private" : "public";
    await kvSet("mode", mode);
  }

  const existingSudo = await kvGet("sudo");
  if (existingSudo == null) {
    const fromEnv = (process.env.SUDO || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\D/g, ""))
      .filter(Boolean);
    await kvSet("sudo", fromEnv);
  }

  if ((await kvGet("sticker_packname")) == null) {
    await kvSet(
      "sticker_packname",
      process.env.STICKER_PACKNAME || "X-Asena"
    );
  }
  if ((await kvGet("sticker_author")) == null) {
    await kvSet("sticker_author", process.env.STICKER_AUTHOR || "X-Asena");
  }

  if ((await kvGet("lang")) == null) {
    const lang = (process.env.BOT_LANG || "en").toLowerCase().trim();
    await kvSet("lang", ["en", "de"].includes(lang) ? lang : "en");
  }

  seeded = true;
}

