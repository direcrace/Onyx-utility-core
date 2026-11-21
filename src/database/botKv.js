

let kvBackend = null;
let seeded = false;

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

export function attachHybridBotKv(remote, local) {
  kvBackend = {
    async get(key) {
      if (remote) {
        try {
          const value = await remote.get(key);
          if (value !== null && value !== undefined) return value;
        } catch (error) {
          console.warn(`[botkv-hybrid] remote get failed (${key}):`, error?.message || error);
        }
      }
      if (local) return local.get(key);
      return null;
    },
    async set(key, value) {
      let remoteOk = false;
      if (remote) {
        try {
          await remote.set(key, value);
          remoteOk = true;
        } catch (error) {
          console.warn(`[botkv-hybrid] remote set failed (${key}):`, error?.message || error);
        }
      }
      if (local) await local.set(key, value);
      return remoteOk;
    },
    async del(key) {
      let remoteOk = false;
      if (remote) {
        try {
          await remote.del(key);
          remoteOk = true;
        } catch (error) {
          console.warn(`[botkv-hybrid] remote del failed (${key}):`, error?.message || error);
        }
      }
      if (local) await local.del(key);
      return remoteOk;
    },
  };
  seeded = false;
}

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
      process.env.STICKER_PACKNAME || "Onyx"
    );
  }
  if ((await kvGet("sticker_author")) == null) {
    await kvSet("sticker_author", process.env.STICKER_AUTHOR || "Onyx");
  }

  if ((await kvGet("lang")) == null) {
    const lang = (process.env.BOT_LANG || "en").toLowerCase().trim();
    await kvSet("lang", ["en", "de"].includes(lang) ? lang : "en");
  }

  seeded = true;
}

