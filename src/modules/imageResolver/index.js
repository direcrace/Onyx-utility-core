import logger from "../../utils/logger.js";
import { ImageError, IMAGE_ERRORS, HARD_ERRORS, imageUserText } from "./errors.js";
import { assertSafeUrl, maxImageBytes, positiveInt } from "./utils/validator.js";
import { guardedFetch } from "./utils/download.js";
import { detectImageMime, normalizeHit } from "./utils/normalizer.js";
import { imageHeaders } from "./constants.js";
import {
  isPinterestUrl,
  pinterestSearchProvider,
  pinterestUrlProvider,
} from "./providers/pinterest.js";
import { openverseProvider } from "./providers/openverse.js";
import { commonsProvider } from "./providers/commons.js";
import { directUrlProvider } from "./providers/directUrl.js";

const searchProviders = [
  { name: "pinterest", handle: pinterestSearchProvider },
  { name: "openverse", handle: openverseProvider },
  { name: "commons", handle: commonsProvider },
];

const PINTEREST_URL_PROVIDER = {
  name: "pinterest-link",
  handle: (value, ctx) => pinterestUrlProvider(value, ctx),
};
const DIRECT_URL_PROVIDER = { name: "direct-url", handle: directUrlProvider };
const urlProviders = [PINTEREST_URL_PROVIDER, DIRECT_URL_PROVIDER];

const blockCooldowns = new Map();

export function resetProviderCooldowns() {
  blockCooldowns.clear();
}

function isCooling(name) {
  return Date.now() < (blockCooldowns.get(name) || 0);
}

function markCooling(name) {
  const ms = positiveInt(process.env.PROVIDER_BLOCK_COOLDOWN_MS, 10 * 60 * 1000);
  if (ms > 0) blockCooldowns.set(name, Date.now() + ms);
}

/** Add a provider at runtime: { name, handle(value, ctx) -> candidate[] }. */
export function registerProvider(provider, { kind = "search" } = {}) {
  if (!provider?.handle || typeof provider.handle !== "function") {
    throw new TypeError("provider.handle must be a function");
  }
  const list = kind === "url" ? urlProviders : searchProviders;
  const entry = { name: provider.name || `provider-${list.length}`, handle: provider.handle };
  list.push(entry);
  return entry;
}

export function listProviders() {
  return {
    search: searchProviders.map((p) => p.name),
    url: urlProviders.map((p) => p.name),
  };
}

function buildContext(options = {}) {
  const log =
    typeof options.log === "function"
      ? options.log
      : (level, message) => {
          if (level === "error") logger.error(message);
          else logger.warn(message);
        };
  const pinterestDisabled =
    options.pinterestEnabled === false ||
    /^(0|false|off|no)$/i.test(process.env.PINTEREST_ENABLED || "");

  return {
    timeoutMs: positiveInt(options.timeoutMs, positiveInt(process.env.IMAGE_TIMEOUT_MS, 15000)),
    maxBytes: positiveInt(options.maxBytes, maxImageBytes(options)),
    maxRedirects: positiveInt(options.maxRedirects, positiveInt(process.env.IMAGE_MAX_REDIRECTS, 3)),
    maxCandidates: positiveInt(options.maxCandidates, positiveInt(process.env.IMAGE_MAX_CANDIDATES, 5)),
    dnsLookup: options.dnsLookup,
    allowPorts: options.allowPorts,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    signal: options.signal,
    pinterestEnabled: !pinterestDisabled,
    log,
  };
}

function looksLikeUrl(text) {
  return /^https?:\/\/\S+$/i.test(text);
}

async function resolveFromProviders(providers, value, ctx, { cooldown = true } = {}) {
  const candidates = [];
  const hardErrors = [];

  for (const provider of providers) {
    if (candidates.length >= ctx.maxCandidates) break;
    if (cooldown && isCooling(provider.name)) {
      ctx.log("warn", `[imageResolver] ${provider.name}: skipped (block cooldown)`);
      continue;
    }
    try {
      const found = await provider.handle(value, ctx);
      const list = Array.isArray(found) ? found : found ? [found] : [];
      for (const candidate of list) {
        if (!candidate?.url || !/^https?:\/\//i.test(candidate.url)) continue;
        candidates.push({ ...candidate });
        if (candidates.length >= ctx.maxCandidates) break;
      }
    } catch (err) {
      if (err instanceof ImageError && HARD_ERRORS.has(err.code)) {
        if (cooldown) markCooling(provider.name);
        hardErrors.push(err);
      }
      const detail = err?.detail || err?.message || "unknown error";
      ctx.log("warn", `[imageResolver] ${provider.name}: ${detail}`);
    }
  }

  if (!candidates.length) {
    throw hardErrors[0] ||
      new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, "no provider returned a candidate");
  }

  const downloadErrors = [];
  for (const candidate of candidates) {
    try {
      const file = await guardedFetch(candidate.url, {
        ...ctx,
        headers: imageHeaders(candidate.ua),
      });
      if (!file.ok) {
        downloadErrors.push(
          new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, `download returned HTTP ${file.status}`)
        );
        continue;
      }
      const mimeType = await detectImageMime(file.buffer);
      if (!mimeType) {
        downloadErrors.push(
          new ImageError(IMAGE_ERRORS.UNSUPPORTED_FORMAT, "content is not a supported image")
        );
        continue;
      }
      return normalizeHit(candidate, {
        buffer: file.buffer,
        finalUrl: file.url,
        mimeType,
      });
    } catch (err) {
      if (err instanceof ImageError && HARD_ERRORS.has(err.code)) hardErrors.push(err);
      downloadErrors.push(
        err instanceof ImageError
          ? err
          : new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, `download failed: ${err?.name || "error"}`)
      );
    }
  }

  throw hardErrors[0] ||
    downloadErrors[0] ||
    new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, "no image could be downloaded");
}

/** Resolve a text query or a direct/pinterest image URL to a normalized hit. */
export async function resolveImage(input, options = {}) {
  const text = String(input || "").trim();
  if (!text) throw new ImageError(IMAGE_ERRORS.INVALID_URL, "empty input");
  if (looksLikeUrl(text)) return resolveImageUrl(text, options);
  return resolveFromProviders(searchProviders, text.slice(0, 80), buildContext(options));
}

/** Resolve an explicit URL. Rejects unsafe URLs before any request is made. */
export async function resolveImageUrl(url, options = {}) {
  const ctx = buildContext(options);
  const value = String(url || "").trim();
  await assertSafeUrl(value, ctx);
  const providers = isPinterestUrl(value)
    ? urlProviders.filter((p) => p.name !== DIRECT_URL_PROVIDER.name)
    : urlProviders;
  return resolveFromProviders(providers, value, ctx, { cooldown: false });
}

export { ImageError, IMAGE_ERRORS, imageUserText };
export default resolveImage;
