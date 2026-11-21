

import config from "../../config.js";
import { attachBotKv, attachHybridBotKv, seedBotKvFromEnv } from "./botKv.js";

let initPromise = null;
let activeBackend = null;

async function localHasCreds(dbPath) {
  if (!dbPath) return false;
  const { default: Database } = await import("better-sqlite3");
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return !!db
      .prepare("SELECT 1 AS ok FROM AuthState WHERE key = ? LIMIT 1")
      .get("creds.json");
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function copyRemoteAuthState(sequelize, dbPath) {
  const model = sequelize.models.AuthState;
  if (!model || !dbPath) return;
  const rows = await model.findAll({ attributes: ["key", "value"], raw: true });
  if (!rows.length) return;
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(
      "CREATE TABLE IF NOT EXISTS AuthState (key TEXT PRIMARY KEY NOT NULL, value TEXT)"
    );
    const upsert = db.prepare(
      "INSERT INTO AuthState (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    db.transaction((items) => {
      for (const row of items) upsert.run(row.key, row.value);
    })(rows);
    console.log(`[auth] Migrated ${rows.length} auth row(s) from Postgres to local SQLite`);
  } finally {
    db.close();
  }
}

async function initBackend() {
  let kvAttached = false;

  if (config.USE_POSTGRES && !config.HYBRID_ENABLED) {
    const { createPostgresSequelize, usePostgresAuthState } = await import(
      "./authPostgres.js"
    );
    const sequelize = await createPostgresSequelize(config.DATABASE_URL);
    await sequelize.authenticate();
    activeBackend = await usePostgresAuthState(sequelize);
    console.log("✅ Auth backend: Postgres (Sequelize)");
  } else {
    const needsMigration =
      config.USE_POSTGRES && !(await localHasCreds(config.SQLITE_PATH));
    const { useBetterSqliteAuthState } = await import("./authSqlite.js");
    activeBackend = await useBetterSqliteAuthState(config.SQLITE_PATH);
    console.log(`✅ Auth backend: better-sqlite3 (${config.SQLITE_PATH})`);

    if (config.USE_POSTGRES) {
      try {
        const { createPostgresSequelize, usePostgresAuthState } = await import(
          "./authPostgres.js"
        );
        const sequelize = await createPostgresSequelize(config.DATABASE_URL);
        await sequelize.authenticate();
        const remote = await usePostgresAuthState(sequelize);
        if (needsMigration) {
          await copyRemoteAuthState(sequelize, config.SQLITE_PATH);
          Object.assign(activeBackend.state.creds, remote.state.creds);
        }
        attachHybridBotKv(remote.botKv, activeBackend.botKv);
        kvAttached = true;
        console.log("✅ Settings backend: Postgres first, local SQLite cache");
      } catch (error) {
        attachBotKv(activeBackend.botKv);
        kvAttached = true;
        console.warn(
          `[auth] Postgres settings unavailable, using local only: ${error?.message || error}`
        );
      }
    }
  }

  if (activeBackend?.botKv && !kvAttached) attachBotKv(activeBackend.botKv);
  if (activeBackend?.botKv) await seedBotKvFromEnv();

  return activeBackend;
}

export async function useMultiDbAuthState() {
  if (!initPromise) {
    initPromise = initBackend();
  }
  const backend = await initPromise;
  return {
    state: backend.state,
    saveCreds: backend.saveCreds,
  };
}

export async function useStandaloneAuthState(dbPath) {
  const { useStandaloneAuthState } = await import("./authSqlite.js");
  return useStandaloneAuthState(dbPath);
}

export async function clearAuthState() {
  if (!initPromise) {
    await useMultiDbAuthState();
  }
  await initPromise;
  if (activeBackend?.clearAuthState) {
    await activeBackend.clearAuthState();
    console.log("Cleared auth state");
  }
}

export async function checkAuthCreds() {
  if (!initPromise) {
    await useMultiDbAuthState();
  }
  await initPromise;
  const has =
    typeof activeBackend.hasCreds === "function"
      ? await activeBackend.hasCreds()
      : false;

  return {
    valid: !!has,
    hasCreds: !!has,
  };
}

export async function validateAuthState() {
  const result = await checkAuthCreds();
  return {
    valid: result.hasCreds,
    issues: result.hasCreds ? [] : ["No credentials found"],
    stats: null,
  };
}

export async function getAuthStateStats() {
  return null;
}
