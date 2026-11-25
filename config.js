import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || "./database.db";

export function isPostgresUrl(url = DATABASE_URL) {
  if (!url || typeof url !== "string") return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith("postgres://") ||
    normalized.startsWith("postgresql://")
  );
}

const USE_POSTGRES = isPostgresUrl(DATABASE_URL);

export function getSqlitePath(url = DATABASE_URL) {
  if (!url || url === "./database.db") return "./database.db";

  if (url.startsWith("file:")) {
    return url.slice("file:".length);
  }
  return url;
}

const LOCAL_DB_PATH = (process.env.ONYX_LOCAL_DB_PATH || "./database.db").trim() || "./database.db";
const HYBRID_ENABLED =
  USE_POSTGRES && String(process.env.ONYX_HYBRID || "on").trim().toLowerCase() !== "off";
const SUPABASE_REST_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_REST_ENABLED =
  /^https?:\/\//i.test(SUPABASE_REST_URL) &&
  !!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const config = {
  DATABASE_URL,
  USE_POSTGRES,
  SQLITE_PATH: USE_POSTGRES ? LOCAL_DB_PATH : getSqlitePath(DATABASE_URL),
  LOCAL_DB_PATH,
  HYBRID_ENABLED,
  SUPABASE_REST_ENABLED,
  SUPABASE_REST_URL,
  LOG_LEVEL: process.env.LOG_LEVEL || "warn",
};

export default config;
