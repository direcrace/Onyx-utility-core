import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { isPrunableKey, pruneBotKv, resolveKvScope } from "../src/database/kvMaintenance.js";

const KEEP_KEYS = [
  "creds.json",
  "mode",
  "sudo",
  "lang",
  "config:prefix",
  "config:owners",
  "rbac_roles",
  "policies",
  "feature_flags",
  "botbans",
  "community:ranks",
  "community:tickets",
  "economy:wallet:123",
  "notes:123",
  "reminders",
  "log_group_jid",
  "gset:group",
  "warns:group:user",
];

test("isPrunableKey matches only cache keys", () => {
  for (const key of [
    "aihist:123",
    "ai:message_ids",
    "audit_log",
    "chat_index",
    "chatbot_users",
    "community:registerCooldown",
    "community:stats",
    "corepanic:at",
    "log_capture_level",
    "mini_flags",
    "rc_flags",
    "stats_hourly",
    "stats_series",
  ]) {
    assert.equal(isPrunableKey(key), true, key);
  }
  for (const key of KEEP_KEYS) assert.equal(isPrunableKey(key), false, key);
});

test("clear.js exposes the maintenance flags", () => {
  const source = fs.readFileSync(new URL("../clear.js", import.meta.url), "utf8");
  for (const flag of ["--prune", "--reset-settings", "--dry-run", "--local", "--external"]) {
    assert.match(source, new RegExp(flag.replaceAll("-", "\\-")));
  }
});

test("prune removes caches and keeps settings plus auth state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-kv-"));
  const dbPath = path.join(dir, "database.db");
  const setup = new Database(dbPath);
  setup.exec(`
    CREATE TABLE AuthState (key TEXT PRIMARY KEY NOT NULL, value TEXT);
    CREATE TABLE BotKV (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `);
  setup.prepare("INSERT INTO AuthState (key, value) VALUES (?, ?)").run("creds.json", "{}");
  const insert = setup.prepare("INSERT INTO BotKV (key, value) VALUES (?, ?)");
  for (const key of [
    "aihist:123",
    "audit_log",
    "chat_index",
    "mode",
    "sudo",
    "config:prefix",
    "creds.json",
  ]) {
    insert.run(key, `"${key}"`);
  }
  setup.close();

  const cfg = { USE_POSTGRES: false, SQLITE_PATH: dbPath };
  try {
    const dry = await pruneBotKv({ cfg, dryRun: true });
    assert.deepEqual(dry.targets, ["aihist:123", "audit_log", "chat_index"]);
    assert.deepEqual(dry.kept, ["config:prefix", "creds.json", "mode", "sudo"]);

    const result = await pruneBotKv({ cfg });
    assert.equal(result.removedLocal, 3);
    assert.equal(result.removedRemote, 0);

    const check = new Database(dbPath, { readonly: true });
    const kv = check.prepare("SELECT key FROM BotKV ORDER BY key").all().map((row) => row.key);
    const auth = check.prepare("SELECT key FROM AuthState").all().map((row) => row.key);
    check.close();
    assert.deepEqual(kv, ["config:prefix", "creds.json", "mode", "sudo"]);
    assert.deepEqual(auth, ["creds.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveKvScope selects the requested backend", () => {
  assert.deepEqual(resolveKvScope({ usePostgres: true }), {
    useLocal: true,
    useExternal: true,
    label: "both backends",
  });
  assert.deepEqual(resolveKvScope({ local: true, usePostgres: true }), {
    useLocal: true,
    useExternal: false,
    label: "local SQLite only",
  });
  assert.deepEqual(resolveKvScope({ external: true, usePostgres: true }), {
    useLocal: false,
    useExternal: true,
    label: "external Postgres only",
  });
  assert.deepEqual(resolveKvScope({ external: true, usePostgres: false }), {
    useLocal: false,
    useExternal: false,
    label: "no matching backend",
  });
});

test("local reset clears settings but keeps the session", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-kv-reset-"));
  const dbPath = path.join(dir, "database.db");
  const setup = new Database(dbPath);
  setup.exec(`
    CREATE TABLE AuthState (key TEXT PRIMARY KEY NOT NULL, value TEXT);
    CREATE TABLE BotKV (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `);
  setup.prepare("INSERT INTO AuthState (key, value) VALUES (?, ?)").run("creds.json", "{}");
  const insert = setup.prepare("INSERT INTO BotKV (key, value) VALUES (?, ?)");
  for (const key of ["mode", "sudo", "config:prefix"]) insert.run(key, `"${key}"`);
  setup.close();

  const cfg = { USE_POSTGRES: false, SQLITE_PATH: dbPath, LOCAL_DB_PATH: "" };
  try {
    const result = await pruneBotKv({ cfg, resetAll: true, local: true });
    assert.equal(result.scope, "local SQLite only");
    assert.equal(result.removedLocal, 3);
    assert.equal(result.removedRemote, 0);

    const check = new Database(dbPath, { readonly: true });
    const kv = check.prepare("SELECT key FROM BotKV ORDER BY key").all().map((row) => row.key);
    const auth = check.prepare("SELECT key FROM AuthState").all().map((row) => row.key);
    check.close();
    assert.deepEqual(kv, []);
    assert.deepEqual(auth, ["creds.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("external-only scope leaves a local-only database untouched", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-kv-scope-"));
  const dbPath = path.join(dir, "database.db");
  const setup = new Database(dbPath);
  setup.exec(`
    CREATE TABLE AuthState (key TEXT PRIMARY KEY NOT NULL, value TEXT);
    CREATE TABLE BotKV (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `);
  setup.prepare("INSERT INTO AuthState (key, value) VALUES (?, ?)").run("creds.json", "{}");
  setup.prepare("INSERT INTO BotKV (key, value) VALUES (?, ?)").run("mode", '"public"');
  setup.close();

  const cfg = { USE_POSTGRES: false, SQLITE_PATH: dbPath, LOCAL_DB_PATH: "" };
  try {
    const result = await pruneBotKv({ cfg, resetAll: true, external: true });
    assert.equal(result.scope, "no matching backend");
    assert.equal(result.removedLocal, 0);
    assert.equal(result.removedRemote, 0);

    const check = new Database(dbPath, { readonly: true });
    const kv = check.prepare("SELECT key FROM BotKV ORDER BY key").all().map((row) => row.key);
    const auth = check.prepare("SELECT key FROM AuthState").all().map((row) => row.key);
    check.close();
    assert.deepEqual(kv, ["mode"]);
    assert.deepEqual(auth, ["creds.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
