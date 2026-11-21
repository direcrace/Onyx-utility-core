import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { attachHybridBotKv, kvGet, kvSet, kvDel } from "../src/database/botKv.js";

const repoDir = fileURLToPath(new URL("..", import.meta.url));
const configUrl = new URL("../config.js", import.meta.url).href;

function memoryBackend(entries = []) {
  return {
    data: new Map(entries),
    async get(key) {
      return this.data.has(key) ? this.data.get(key) : null;
    },
    async set(key, value) {
      this.data.set(key, value);
    },
    async del(key) {
      this.data.delete(key);
    },
  };
}

function readConfig(env) {
  const script = `import config from ${JSON.stringify(configUrl)}; console.log(JSON.stringify({USE_POSTGRES:config.USE_POSTGRES,HYBRID_ENABLED:config.HYBRID_ENABLED,SQLITE_PATH:config.SQLITE_PATH,LOCAL_DB_PATH:config.LOCAL_DB_PATH}));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoDir,
    env: { ...process.env, DOTENV_CONFIG_QUIET: "true", ...env },
    encoding: "utf8",
  });
  const jsonLine = output
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("{"));
  return JSON.parse(jsonLine);
}

test("hybrid KV prefers remote values and falls back to local", async () => {
  const remote = memoryBackend([["mode", "private"]]);
  const local = memoryBackend([["mode", "public"], ["lang", "de"]]);
  attachHybridBotKv(remote, local);

  assert.equal(await kvGet("mode"), "private");
  assert.equal(await kvGet("lang"), "de");
  assert.equal(await kvGet("missing"), null);
});

test("hybrid KV mirrors writes and deletes to both backends", async () => {
  const remote = memoryBackend();
  const local = memoryBackend();
  attachHybridBotKv(remote, local);

  assert.equal(await kvSet("mode", "public"), true);
  assert.equal(remote.data.get("mode"), "public");
  assert.equal(local.data.get("mode"), "public");

  assert.equal(await kvDel("mode"), true);
  assert.equal(remote.data.has("mode"), false);
  assert.equal(local.data.has("mode"), false);
});

test("hybrid KV keeps local writes when Postgres fails", async () => {
  const remote = {
    async get() {
      throw new Error("offline");
    },
    async set() {
      throw new Error("offline");
    },
    async del() {
      throw new Error("offline");
    },
  };
  const local = memoryBackend();
  attachHybridBotKv(remote, local);

  assert.equal(await kvSet("mode", "private"), false);
  assert.equal(local.data.get("mode"), "private");
  assert.equal(await kvDel("mode"), false);
  assert.equal(local.data.has("mode"), false);
});

test("config keeps the session local when DATABASE_URL is Postgres", () => {
  const base = {
    DATABASE_URL: "postgresql://user:pass@example.invalid/testdb",
    ONYX_LOCAL_DB_PATH: "./tmp-session.db",
  };

  const hybrid = readConfig({ ...base, ONYX_HYBRID: "on" });
  assert.equal(hybrid.USE_POSTGRES, true);
  assert.equal(hybrid.HYBRID_ENABLED, true);
  assert.equal(hybrid.SQLITE_PATH, "./tmp-session.db");
  assert.equal(hybrid.LOCAL_DB_PATH, "./tmp-session.db");

  const legacy = readConfig({ ...base, ONYX_HYBRID: "off" });
  assert.equal(legacy.USE_POSTGRES, true);
  assert.equal(legacy.HYBRID_ENABLED, false);

  const local = readConfig({
    DATABASE_URL: "./database.db",
    ONYX_HYBRID: "on",
    ONYX_LOCAL_DB_PATH: "./tmp-session.db",
  });
  assert.equal(local.USE_POSTGRES, false);
  assert.equal(local.HYBRID_ENABLED, false);
  assert.equal(local.SQLITE_PATH, "./database.db");
});
