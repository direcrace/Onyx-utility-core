import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yum-supabase-rest-"));
const localDbPath = path.join(tmp, "database.db");
process.env.DATABASE_URL = `file:${localDbPath}`;
process.env.ONYX_LOCAL_DB_PATH = localDbPath;
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const config = (await import("../config.js")).default;
const { createSupabaseRestBotKv, supabaseRestConfigured } = await import(
  "../src/database/supabaseRest.js"
);
const {
  inspectBotKv,
  deleteBotKvKeys,
  pruneBotKv,
  pushLocalBotKvToRemote,
  resolveKvScope,
} = await import("../src/database/kvMaintenance.js");
const { useMultiDbAuthState } = await import("../src/database/authState.js");
const { kvGet, kvSet, kvDel } = await import("../src/database/botKv.js");

const remote = new Map();
const calls = [];
let failWrites = false;
const originalFetch = globalThis.fetch;

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function filterKey(parsed) {
  const raw = parsed.searchParams.get("key");
  return raw?.startsWith("eq.") ? raw.slice(3) : null;
}

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = options.method || "GET";
  const key = filterKey(parsed);
  calls.push({ url: parsed, options });

  if (method === "GET" && parsed.pathname.endsWith("/BotKV")) {
    if (key) return jsonResponse(remote.has(key) ? [{ value: remote.get(key) }] : []);
    return jsonResponse([...remote].map(([rowKey, value]) => ({ key: rowKey, value })));
  }
  if (method === "POST" && parsed.pathname.endsWith("/BotKV")) {
    if (failWrites) return new Response("boom", { status: 500 });
    const body = JSON.parse(options.body);
    remote.set(body.key, body.value);
    return new Response(null, { status: 204 });
  }
  if (method === "DELETE" && parsed.pathname.endsWith("/BotKV") && key) {
    remote.delete(key);
    return new Response(null, { status: 204 });
  }
  return new Response("unexpected request", { status: 400 });
};

after(() => {
  globalThis.fetch = originalFetch;
});

test("Supabase REST is enabled by env variables", () => {
  assert.equal(config.SUPABASE_REST_ENABLED, true);
  assert.equal(supabaseRestConfigured(), true);
  assert.equal(config.SUPABASE_REST_URL, "https://example.supabase.co");
  assert.equal(config.SUPABASE_REST_KEY_IS_JWT, false);
});

test("REST botkv reads, writes and deletes through fetch", async () => {
  const kv = createSupabaseRestBotKv();
  assert.equal(await kv.set("community:flags", { a: 1 }), true);
  assert.deepEqual(await kv.get("community:flags"), { a: 1 });
  assert.equal(await kv.del("community:flags"), true);
  assert.equal(await kv.get("community:flags"), null);

  const post = calls.find((call) => call.options.method === "POST");
  assert.match(post.url.pathname, /\/rest\/v1\/BotKV$/);
  assert.equal(post.url.searchParams.get("on_conflict"), "key");
  assert.equal(post.options.headers.apikey, "test-secret-key");
  assert.equal(post.options.headers.Authorization, undefined);
  assert.equal(post.options.headers.Prefer, "resolution=merge-duplicates,return=minimal");

  const getCall = calls.find(
    (call) => call.options.method === "GET" && filterKey(call.url)
  );
  assert.equal(getCall.url.searchParams.get("key"), "eq.community:flags");
});

test("hybrid auth attaches Supabase REST as the settings backend", async () => {
  await useMultiDbAuthState();
  await kvSet("test:hybrid", { count: 1 });
  assert.equal(remote.get("test:hybrid"), JSON.stringify({ count: 1 }));
  assert.deepEqual(await kvGet("test:hybrid"), { count: 1 });
  await kvDel("test:hybrid");
  assert.equal(remote.has("test:hybrid"), false);
});

test("inspect and prune use the Supabase REST backend", async () => {
  remote.set("aihist:old", JSON.stringify({ x: 1 }));
  remote.set("community:registered", JSON.stringify({}));

  const snapshot = await inspectBotKv(config);
  assert.equal(snapshot.backend, "supabase-rest");
  assert.ok(snapshot.rows.some((row) => row.key === "aihist:old"));

  const dry = await pruneBotKv({ cfg: config, dryRun: true });
  assert.ok(dry.targets.includes("aihist:old"));
  assert.ok(!dry.targets.includes("community:registered"));

  const result = await pruneBotKv({ cfg: config });
  assert.equal(result.removedRemote, 1);
  assert.equal(remote.has("aihist:old"), false);
});

test("deleteBotKvKeys can target only the REST backend", async () => {
  remote.set("groupact:msg:m1", JSON.stringify({ expiresAt: 1 }));
  const result = await deleteBotKvKeys(["groupact:msg:m1"], {
    cfg: config,
    external: true,
  });
  assert.equal(result.scope, "external Supabase REST only");
  assert.equal(result.removedRemote, 1);
  assert.equal(remote.has("groupact:msg:m1"), false);
  assert.equal(
    resolveKvScope({ external: true, externalEnabled: true, externalLabel: "Supabase REST" }).label,
    "external Supabase REST only"
  );
});

test("pushLocalBotKvToRemote copies missing keys and keeps remote values", async () => {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path.join(tmp, "database.db"));
  db.prepare("INSERT OR REPLACE INTO BotKV (key, value) VALUES (?, ?)").run(
    "local:only",
    JSON.stringify({ seed: 1 })
  );
  db.prepare("INSERT OR REPLACE INTO BotKV (key, value) VALUES (?, ?)").run(
    "shared:key",
    JSON.stringify({ fromLocal: true })
  );
  db.close();
  remote.set("shared:key", JSON.stringify({ fromRemote: true }));

  const dry = await pushLocalBotKvToRemote({ cfg: config, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.copied >= 1);
  assert.equal(remote.has("local:only"), false);

  const result = await pushLocalBotKvToRemote({ cfg: config });
  assert.equal(result.backend, "Supabase REST");
  assert.equal(remote.get("local:only"), JSON.stringify({ seed: 1 }));
  assert.equal(remote.get("shared:key"), JSON.stringify({ fromRemote: true }));
});

test("REST write errors fall back locally and abort backfill", async () => {
  failWrites = true;
  try {
    await assert.rejects(
      () => createSupabaseRestBotKv().set("fail:direct", 1),
      /Supabase REST 500/
    );
    assert.equal(await kvSet("fail:hybrid", { ok: true }), false);
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(localDbPath, { fileMustExist: true });
    const row = db.prepare("SELECT value FROM BotKV WHERE key = ?").get("fail:hybrid");
    db.close();
    assert.equal(row?.value, JSON.stringify({ ok: true }));
    await assert.rejects(() => pushLocalBotKvToRemote({ cfg: config }), /Supabase REST 500/);
  } finally {
    failWrites = false;
  }
});

test("docs describe the Supabase REST variables", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  const envExample = await fs.readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(readme, /SUPABASE_URL/);
  assert.match(readme, /SUPABASE_SECRET_KEY/);
  assert.match(readme, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(readme, /create table if not exists public\."BotKV"/);
  assert.match(readme, /grant select, insert, update, delete on public\."BotKV" to service_role;/);
  assert.match(readme, /--push-kv/);
  assert.match(envExample, /SUPABASE_URL=/);
  assert.match(envExample, /SUPABASE_SECRET_KEY=/);
  assert.match(envExample, /SUPABASE_SERVICE_ROLE_KEY=/);
});
