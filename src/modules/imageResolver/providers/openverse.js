import { guardedFetch } from "../utils/download.js";
import { BOT_UA, jsonHeaders } from "../constants.js";
import { ImageError, IMAGE_ERRORS } from "../errors.js";

/** Free, license-filtered image search through Openverse (no API key). */
export async function openverseProvider(query, ctx) {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({
    q: query,
    page_size: "12",
    license_type: "commercial",
    license: "cc0,pdm,by",
    mature: "false",
  }).toString();

  const res = await guardedFetch(url.toString(), {
    ...ctx,
    headers: jsonHeaders(BOT_UA),
    maxBytes: 2 * 1024 * 1024,
  });
  if (!res.ok) {
    if (res.status === 401) throw new ImageError(IMAGE_ERRORS.AUTH_REQUIRED, "openverse 401");
    if (res.status === 403 || res.status === 429) {
      throw new ImageError(IMAGE_ERRORS.SOURCE_BLOCKED, `openverse ${res.status}`);
    }
    throw new Error(`Openverse HTTP ${res.status}`);
  }

  let json;
  try {
    json = JSON.parse(res.buffer.toString("utf8"));
  } catch {
    return [];
  }
  const results = (json?.results || []).filter((r) => /^https?:\/\//i.test(r?.url || ""));
  return results.slice(0, 3).map((hit) => ({
    url: hit.thumbnail || hit.url,
    provider: "Openverse",
    credit: hit.attribution || hit.creator || null,
    license: hit.license || null,
    page: hit.foreign_landing_url || null,
    ua: BOT_UA,
  }));
}
