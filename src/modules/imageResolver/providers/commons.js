import { guardedFetch } from "../utils/download.js";
import { BOT_UA, jsonHeaders } from "../constants.js";
import { cleanText } from "../utils/normalizer.js";
import { ImageError, IMAGE_ERRORS } from "../errors.js";

/** Wikimedia Commons search — last free fallback in the chain. */
export async function commonsProvider(query, ctx) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    format: "json",
  }).toString();

  const res = await guardedFetch(url.toString(), {
    ...ctx,
    headers: jsonHeaders(BOT_UA),
    maxBytes: 4 * 1024 * 1024,
  });
  if (!res.ok) {
    if (res.status === 401) throw new ImageError(IMAGE_ERRORS.AUTH_REQUIRED, "commons 401");
    if (res.status === 403 || res.status === 429) {
      throw new ImageError(IMAGE_ERRORS.SOURCE_BLOCKED, `commons ${res.status}`);
    }
    throw new Error(`Commons HTTP ${res.status}`);
  }

  let json;
  try {
    json = JSON.parse(res.buffer.toString("utf8"));
  } catch {
    return [];
  }
  const pages = Object.values(json?.query?.pages || {})
    .filter((p) => p?.imageinfo?.[0]?.thumburl)
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));

  return pages.slice(0, 3).map((page) => {
    const info = page.imageinfo[0];
    const em = info.extmetadata || {};
    return {
      url: info.thumburl,
      provider: "Wikimedia Commons",
      credit: cleanText(em.Artist?.value, 110) || "Wikimedia Commons",
      license: cleanText(em.LicenseShortName?.value, 60) || null,
      page: info.descriptionurl || null,
      ua: BOT_UA,
    };
  });
}
