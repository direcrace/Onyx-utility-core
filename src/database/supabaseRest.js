import config from "../../config.js";

const TABLE = "BotKV";

function settings() {
  return {
    url: String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, ""),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

export function supabaseRestConfigured() {
  const { url, key } = settings();
  return /^https?:\/\//i.test(url) && !!key;
}

function endpoint(query) {
  return `${settings().url}/rest/v1/${TABLE}${query}`;
}

function timeoutMs() {
  const value = Number(process.env.SUPABASE_REST_TIMEOUT_MS) || 10000;
  return Math.max(1000, Math.min(60000, value));
}

async function request(query, { method = "GET", headers = {}, body } = {}) {
  const { key } = settings();
  const response = await fetch(endpoint(query), {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`Supabase REST ${response.status}: ${text}`);
  }

  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

function filter(key) {
  return `?key=eq.${encodeURIComponent(String(key))}`;
}

async function get(key) {
  try {
    const rows = await request(`${filter(key)}&select=value&limit=1`);
    const value = rows?.[0]?.value;
    if (value === null || value === undefined) return null;
    return JSON.parse(value);
  } catch (error) {
    console.error(`[botkv-rest] get failed (${key}):`, error?.message || error);
    return null;
  }
}

async function del(key) {
  await request(filter(key), {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return true;
}

async function set(key, value) {
  if (value === null || value === undefined) return del(key);
  await request("?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { key: String(key), value: JSON.stringify(value) },
  });
  return true;
}

async function rows() {
  const limit = Math.max(1, Math.min(5000, Number(process.env.SUPABASE_REST_ROW_LIMIT) || 1000));
  const data = await request(`?select=key,value&limit=${limit}`);
  return (data || []).map((row) => ({ key: row.key, value: row.value }));
}

async function delMany(keys) {
  let removed = 0;
  for (const key of keys || []) {
    if (await del(key)) removed += 1;
  }
  return removed;
}

export function createSupabaseRestBotKv() {
  if (!config.SUPABASE_REST_ENABLED && !supabaseRestConfigured()) {
    throw new Error("Supabase REST is not configured");
  }
  return { get, set, del, rows, delMany };
}
