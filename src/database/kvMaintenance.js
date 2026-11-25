import config from "../../config.js";
import { DataTypes, Op } from "sequelize";

export const PRUNE_KEYS = new Set([
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
]);

export const PRUNE_PREFIXES = [
  "aihist:",
  "groupact:msg:",
  "groupact:open:",
  "groupreq:msg:",
  "groupreq:open:",
  "groupsetup:pending:",
  "groupsetup:token:",
];

export function isPrunableKey(key) {
  const value = String(key);
  return PRUNE_KEYS.has(value) || PRUNE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function localPath(cfg) {
  return String(cfg.LOCAL_DB_PATH || cfg.SQLITE_PATH || "").trim();
}

function externalBackend(cfg) {
  return cfg.SUPABASE_REST_ENABLED
    ? { enabled: true, label: "Supabase REST", rest: true }
    : { enabled: !!cfg.USE_POSTGRES, label: "Postgres", rest: false };
}

async function sqliteRows(dbPath) {
  if (!dbPath) return [];
  const { default: Database } = await import("better-sqlite3");
  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    return db
      .prepare("SELECT key, value FROM BotKV ORDER BY key")
      .all()
      .map((row) => ({ key: row.key, value: row.value }));
  } catch (error) {
    if (error?.code === "SQLITE_CANTOPEN" || /no such table/i.test(error?.message || "")) {
      return [];
    }
    throw error;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function sqliteDelete(dbPath, keys) {
  if (!dbPath || !keys.length) return 0;
  const { default: Database } = await import("better-sqlite3");
  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    const remove = db.prepare("DELETE FROM BotKV WHERE key = ?");
    const transaction = db.transaction((items) => {
      let count = 0;
      for (const key of items) count += remove.run(key).changes;
      return count;
    });
    return transaction(keys);
  } catch (error) {
    if (error?.code === "SQLITE_CANTOPEN" || /no such table/i.test(error?.message || "")) {
      return 0;
    }
    throw error;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function postgresHandle(cfg) {
  const { createPostgresSequelize } = await import("./authPostgres.js");
  const sequelize = await createPostgresSequelize(cfg.DATABASE_URL);
  await sequelize.authenticate();
  const model = sequelize.define(
    "BotKV",
    {
      key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      value: { type: DataTypes.TEXT("long"), allowNull: true },
    },
    {
      timestamps: true,
      indexes: [{ fields: ["key"], unique: true }],
    }
  );
  await model.sync();
  return { sequelize, model };
}

export async function inspectBotKv(cfg = config) {
  if (cfg.SUPABASE_REST_ENABLED) {
    const { createSupabaseRestBotKv } = await import("./supabaseRest.js");
    const rows = await createSupabaseRestBotKv().rows();
    return {
      backend: "supabase-rest",
      rows,
      localRows: await sqliteRows(localPath(cfg)),
    };
  }

  if (cfg.USE_POSTGRES) {
    const { sequelize, model } = await postgresHandle(cfg);
    try {
      const rows = await model.findAll({ attributes: ["key", "value"], raw: true });
      return {
        backend: "postgres",
        rows: rows.map((row) => ({ key: row.key, value: row.value })),
        localRows: await sqliteRows(localPath(cfg)),
      };
    } finally {
      await sequelize.close();
    }
  }

  return { backend: "sqlite", rows: await sqliteRows(cfg.SQLITE_PATH), localRows: [] };
}

export async function remoteBotKvBackend(cfg = config) {
  if (cfg.SUPABASE_REST_ENABLED) {
    const { createSupabaseRestBotKv } = await import("./supabaseRest.js");
    const backend = createSupabaseRestBotKv();
    const existingKeys = new Set((await backend.rows()).map((row) => String(row.key)));
    return { label: "Supabase REST", backend, existingKeys };
  }
  if (cfg.USE_POSTGRES) {
    const { createPostgresSequelize, usePostgresBotKv } = await import("./authPostgres.js");
    const sequelize = await createPostgresSequelize(cfg.DATABASE_URL);
    await sequelize.authenticate();
    const backend = await usePostgresBotKv(sequelize);
    const rows = await sequelize.models.BotKV.findAll({
      attributes: ["key"],
      raw: true,
    });
    return {
      label: "Postgres",
      backend,
      existingKeys: new Set(rows.map((row) => String(row.key))),
      close: () => sequelize.close(),
    };
  }
  return null;
}

export async function pushLocalBotKvToRemote({ cfg = config, dryRun = false } = {}) {
  const remote = await remoteBotKvBackend(cfg);
  if (!remote) return { backend: null, scanned: 0, copied: 0, kept: 0, dryRun };

  const rows = await sqliteRows(localPath(cfg));
  let copied = 0;
  let kept = 0;
  try {
    for (const row of rows) {
      const key = String(row?.key || "");
      if (!key) continue;
      let value = row.value;
      if (typeof value === "string") {
        try { value = JSON.parse(value); } catch { continue; }
      }
      if (value === null || value === undefined) continue;
      if (remote.existingKeys.has(key)) {
        kept += 1;
        continue;
      }
      if (!dryRun) await remote.backend.set(key, value);
      copied += 1;
    }
  } finally {
    await remote.close?.();
  }
  return { backend: remote.label, scanned: rows.length, copied, kept, dryRun };
}

export function resolveKvScope({
  local = false,
  external = false,
  usePostgres = false,
  externalEnabled = null,
  externalLabel = "Postgres",
} = {}) {
  const enabled = externalEnabled === null ? !!usePostgres : !!externalEnabled;
  const both = (!local && !external) || (local && external);
  const useLocal = both || local || (!enabled && !external);
  const useExternal = (both || external) && enabled;
  const label = useLocal && useExternal
    ? "both backends"
    : useLocal
      ? "local SQLite only"
      : useExternal
        ? `external ${externalLabel} only`
        : "no matching backend";
  return { useLocal, useExternal, label };
}

export async function deleteBotKvKeys(keys, { cfg = config, local = false, external = false } = {}) {
  const targets = [...new Set((keys || []).map(String))].filter(Boolean);
  const backend = externalBackend(cfg);
  const scope = resolveKvScope({
    local,
    external,
    externalEnabled: backend.enabled,
    externalLabel: backend.label,
  });

  let removedRemote = 0;
  let removedLocal = 0;

  if (scope.useExternal && targets.length) {
    if (backend.rest) {
      const { createSupabaseRestBotKv } = await import("./supabaseRest.js");
      removedRemote = await createSupabaseRestBotKv().delMany(targets);
    } else {
      const { sequelize, model } = await postgresHandle(cfg);
      try {
        removedRemote = await model.destroy({ where: { key: { [Op.in]: targets } } });
      } finally {
        await sequelize.close();
      }
    }
  }
  if (scope.useLocal && targets.length) {
    removedLocal = await sqliteDelete(localPath(cfg) || cfg.SQLITE_PATH, targets);
  }

  return {
    scope: scope.label,
    removedRemote,
    removedLocal,
    removed: removedRemote + removedLocal,
  };
}

export async function pruneBotKv({
  cfg = config,
  resetAll = false,
  dryRun = false,
  local = false,
  external = false,
} = {}) {
  const backend = externalBackend(cfg);
  const scope = resolveKvScope({
    local,
    external,
    externalEnabled: backend.enabled,
    externalLabel: backend.label,
  });
  const snapshot = await inspectBotKv(cfg);
  const remoteRows = scope.useExternal ? snapshot.rows : [];
  const localRows = scope.useLocal
    ? backend.enabled ? snapshot.localRows : snapshot.rows
    : [];
  const sourceKeys = [...new Set([...remoteRows, ...localRows].map((row) => row.key))];
  const targets = resetAll ? sourceKeys : sourceKeys.filter(isPrunableKey);

  if (dryRun) {
    return {
      dryRun: true,
      backend: snapshot.backend,
      scope: scope.label,
      targets,
      kept: sourceKeys.filter((key) => !targets.includes(key)),
    };
  }

  const removed = await deleteBotKvKeys(targets, { cfg, local, external });

  return {
    dryRun: false,
    backend: snapshot.backend,
    scope: scope.label,
    targets,
    removedRemote: removed.removedRemote,
    removedLocal: removed.removedLocal,
  };
}
