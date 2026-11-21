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

export const PRUNE_PREFIXES = ["aihist:"];

export function isPrunableKey(key) {
  const value = String(key);
  return PRUNE_KEYS.has(value) || PRUNE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function localPath(cfg) {
  return String(cfg.LOCAL_DB_PATH || cfg.SQLITE_PATH || "").trim();
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

export function resolveKvScope({ local = false, external = false, usePostgres = false } = {}) {
  const both = (!local && !external) || (local && external);
  const useLocal = both || local || (!usePostgres && !external);
  const useExternal = (both || external) && usePostgres;
  const label = useLocal && useExternal
    ? "both backends"
    : useLocal
      ? "local SQLite only"
      : useExternal
        ? "external Postgres only"
        : "no matching backend";
  return { useLocal, useExternal, label };
}

export async function pruneBotKv({
  cfg = config,
  resetAll = false,
  dryRun = false,
  local = false,
  external = false,
} = {}) {
  const scope = resolveKvScope({ local, external, usePostgres: !!cfg.USE_POSTGRES });
  const snapshot = await inspectBotKv(cfg);
  const remoteRows = scope.useExternal ? snapshot.rows : [];
  const localRows = scope.useLocal
    ? cfg.USE_POSTGRES ? snapshot.localRows : snapshot.rows
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

  let removedRemote = 0;
  let removedLocal = 0;

  if (scope.useExternal) {
    const { sequelize, model } = await postgresHandle(cfg);
    try {
      if (targets.length) {
        removedRemote = await model.destroy({ where: { key: { [Op.in]: targets } } });
      }
    } finally {
      await sequelize.close();
    }
  }
  if (scope.useLocal) {
    removedLocal = await sqliteDelete(localPath(cfg) || cfg.SQLITE_PATH, targets);
  }

  return {
    dryRun: false,
    backend: snapshot.backend,
    scope: scope.label,
    targets,
    removedRemote,
    removedLocal,
  };
}
