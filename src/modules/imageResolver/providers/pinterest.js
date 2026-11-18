import { guardedFetch } from "../utils/download.js";
import { decodeHtmlEntities } from "../utils/normalizer.js";
import { ImageError, IMAGE_ERRORS } from "../errors.js";

const PIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PIN_LANDING = "https://www.pinterest.com/";
const PIN_SEARCH = "https://www.pinterest.com/resource/BaseSearchResource/get/";

export function isPinterestUrl(input) {
  try {
    const host = new URL(input).hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "pinterest.com" ||
      host === "pin.it" ||
      host === "pinimg.com" ||
      host.endsWith(".pinimg.com")
    );
  } catch {
    return false;
  }
}

/**
 * Fail fast on CAPTCHA/login walls. No retries, no proxy/IP rotation and no
 * browser-fingerprint spoofing — a blocked source simply stops here.
 */
function classifyBlock(text, response = {}) {
  const body = String(text || "");
  const finalUrl = String(response.url || "");
  if (/i am not a robot|px-captcha|captcha|unusual traffic|verify you are human/i.test(body)) {
    throw new ImageError(IMAGE_ERRORS.SOURCE_BLOCKED, "captcha detected");
  }
  if (response.status === 403) {
    throw new ImageError(IMAGE_ERRORS.SOURCE_BLOCKED, "source returned 403");
  }
  if (response.status === 401) {
    throw new ImageError(IMAGE_ERRORS.AUTH_REQUIRED, "source returned 401");
  }
  if (
    /log in to continue|sign in to continue|please log in|you must be logged in|authwall|login_required/i.test(body) ||
    /(^|\/)login\/?($|\?)/i.test(finalUrl)
  ) {
    throw new ImageError(IMAGE_ERRORS.AUTH_REQUIRED, "login wall detected");
  }
}

async function pinterestCookies(ctx) {
  const res = await guardedFetch(PIN_LANDING, {
    ...ctx,
    headers: {
      "User-Agent": PIN_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    maxBytes: 1024 * 1024,
  });
  if (!res.ok) classifyBlock(res.buffer.toString("utf8"), res);
  const raw = String(res.headers["set-cookie"] || "");
  const csrf = (raw.match(/csrftoken=([^;,\s]+)/) || [])[1] || "";
  return { cookies: raw, csrf };
}

/** Backwards-compatible helper: raw pin image URLs for a search query. */
export async function pinterestImageUrls(query, options = {}) {
  const ctx = {
    timeoutMs: options.timeoutMs,
    maxRedirects: options.maxRedirects,
    dnsLookup: options.dnsLookup,
    allowPorts: options.allowPorts,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    pinterestEnabled: !/^(0|false|off|no)$/i.test(process.env.PINTEREST_ENABLED || ""),
  };
  const candidates = await pinterestSearchProvider(String(query || "").trim().slice(0, 80), ctx);
  return candidates.map((candidate) => candidate.url);
}

/** Search Pinterest's public pin search metadata for a text query. */
export async function pinterestSearchProvider(query, ctx) {
  if (ctx.pinterestEnabled === false) return [];
  const { cookies, csrf } = await pinterestCookies(ctx);
  const data = JSON.stringify({
    options: { query, types: ["pins"], page_size: 25 },
    context: {},
  });
  const body = new URLSearchParams({
    source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
    data,
  });

  const res = await guardedFetch(PIN_SEARCH, {
    ...ctx,
    method: "POST",
    headers: {
      "User-Agent": PIN_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRFToken": csrf,
      Cookie: cookies,
    },
    body: body.toString(),
    maxBytes: 4 * 1024 * 1024,
  });

  const text = res.buffer.toString("utf8");
  classifyBlock(text, res);
  if (!res.ok || !String(res.headers["content-type"] || "").includes("json")) {
    throw new ImageError(IMAGE_ERRORS.SOURCE_BLOCKED, `search returned HTTP ${res.status}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, "search response was not JSON");
  }
  const results = json?.resource_response?.data?.results || [];
  const candidates = [];
  for (const item of results) {
    const pins = item?.objects?.length ? item.objects : [item];
    for (const pin of pins) {
      if (pin?.is_video) continue;
      const variants = pin?.images || {};
      let image = variants.orig || variants.originals;
      if (!image?.url) {
        for (const key of Object.keys(variants)) {
          if (variants[key]?.url) { image = variants[key]; break; }
        }
      }
      if (!image?.url || !/^https?:\/\//i.test(image.url)) continue;
      candidates.push({
        url: image.url,
        provider: "Pinterest",
        ua: PIN_UA,
        credit: pin?.title || null,
        page: pin?.link ? String(pin.link) : null,
      });
      if (candidates.length >= 6) break;
    }
    if (candidates.length >= 6) break;
  }
  return candidates;
}

function parseMeta(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (name) => {
      const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
      return m ? m[2] : null;
    };
    const key = (attr("property") || attr("name") || "").toLowerCase();
    const content = attr("content");
    if (key && content) out[key] = decodeHtmlEntities(content);
  }
  return out;
}

/** Resolve a public pin/pin.it link through its public og:image metadata. */
export async function pinterestUrlProvider(url, ctx) {
  if (ctx.pinterestEnabled === false) return [];
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "pinimg.com" || host.endsWith(".pinimg.com")) {
    return [{ url: parsed.toString(), provider: "Pinterest", ua: PIN_UA }];
  }

  const res = await guardedFetch(parsed.toString(), {
    ...ctx,
    headers: {
      "User-Agent": PIN_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    maxBytes: 2 * 1024 * 1024,
  });
  const html = res.buffer.toString("utf8");
  classifyBlock(html, res);
  if (!res.ok) {
    throw new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, `pin page returned HTTP ${res.status}`);
  }

  const meta = parseMeta(html);
  const image = meta["og:image"] || meta["twitter:image"] || meta["twitter:image:src"];
  if (!image) return [];

  let imageUrl;
  try {
    imageUrl = new URL(image, res.url).toString();
  } catch {
    return [];
  }
  return [
    {
      url: imageUrl,
      provider: "Pinterest",
      ua: PIN_UA,
      credit: meta["og:title"] || null,
      page: res.url,
    },
  ];
}
