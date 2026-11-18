import { ImageError, IMAGE_ERRORS } from "../errors.js";
import { isAllowedMime } from "./validator.js";

/** Detect the real MIME type from magic bytes, not from a spoofable header. */
export async function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const type = await fileTypeFromBuffer(buffer);
    const mime = String(type?.mime || "").toLowerCase();
    return isAllowedMime(mime) ? mime : null;
  } catch {
    return null;
  }
}

export function cleanText(value, max = 120) {
  if (value === undefined || value === null) return null;
  const text = String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Turn a provider candidate plus downloaded bytes into the shape the WhatsApp
 * command already expects: { url, buffer, provider, credit, license, page }.
 */
export function normalizeHit(candidate, { buffer, finalUrl, mimeType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ImageError(IMAGE_ERRORS.IMAGE_NOT_FOUND, "empty image buffer");
  }
  return {
    url: String(finalUrl || candidate.url || ""),
    buffer,
    mimeType: mimeType || null,
    size: buffer.length,
    provider: cleanText(candidate.provider, 40) || "Image",
    credit: cleanText(candidate.credit, 110),
    license: cleanText(candidate.license, 60),
    page: cleanText(candidate.page, 180),
  };
}

export function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&quot/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
