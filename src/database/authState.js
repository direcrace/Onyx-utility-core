

import config from "../../config.js";
import { attachBotKv, seedBotKvFromEnv } from "./botKv.js";

let initPromise = null;
let activeBackend = null;

async function initBackend() {
  if (config.USE_POSTGRES) {
    const { createPostgresSequelize, usePostgresAuthState } = await import(
      "./authPostgres.js"
    );
    const sequelize = await createPostgresSequelize(config.DATABASE_URL);
    await sequelize.authenticate();
    activeBackend = await usePostgresAuthState(sequelize);
    console.log("✅ Auth backend: Postgres (Sequelize)");
  } else {
    const { useBetterSqliteAuthState } = await import("./authSqlite.js");
    activeBackend = await useBetterSqliteAuthState(config.SQLITE_PATH);
    console.log(`✅ Auth backend: better-sqlite3 (${config.SQLITE_PATH})`);
  }

  if (activeBackend?.botKv) {
    attachBotKv(activeBackend.botKv);
    await seedBotKvFromEnv();
  }

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
