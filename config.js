import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || "./database.db";

/**
 * Detect whether DATABASE_URL points at Postgres.
 * Local / default path uses better-sqlite3 (no Sequelize).
 */
export function isPostgresUrl(url = DATABASE_URL) {
  if (!url || typeof url !== "string") return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith("postgres://") ||
    normalized.startsWith("postgresql://")
  );
}

const USE_POSTGRES = isPostgresUrl(DATABASE_URL);

/** Local sqlite file path when not using Postgres */
export function getSqlitePath(url = DATABASE_URL) {
  if (!url || url === "./database.db") return "./database.db";
  // File path or file: URL
  if (url.startsWith("file:")) {
    return url.slice("file:".length);
  }
  return url;
}

const config = {
  DATABASE_URL,
  USE_POSTGRES,
  SQLITE_PATH: USE_POSTGRES ? null : getSqlitePath(DATABASE_URL),
  LOG_LEVEL: process.env.LOG_LEVEL || "warn",
};

export default config;
