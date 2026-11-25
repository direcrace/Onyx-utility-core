import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "./database.db";
process.env.ONYX_LOCAL_DB_PATH = "./database.db";
process.env.SUPABASE_URL = "https://legacy.example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJlegacyjwt";

const config = (await import("../config.js")).default;
const { createSupabaseRestBotKv } = await import("../src/database/supabaseRest.js");

test("legacy service_role JWT keeps the bearer header", async () => {
  assert.equal(config.SUPABASE_REST_KEY_IS_JWT, true);

  let headers;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    headers = options.headers;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await createSupabaseRestBotKv().get("legacy:check");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(headers.apikey, "eyJlegacyjwt");
  assert.equal(headers.Authorization, "Bearer eyJlegacyjwt");
});
