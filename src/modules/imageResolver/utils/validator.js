import net from "node:net";
import { MEDIA } from "../../../config/constants.js";
import { ImageError, IMAGE_ERRORS } from "../errors.js";

const DEFAULT_ALLOWED_PORTS = [80, 443];
const DEFAULT_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function defaultDnsLookup(hostname) {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true, verbatim: true });
  return (Array.isArray(records) ? records : [records])
    .map((r) => r?.address)
    .filter(Boolean);
}

function v4ToInt(ip) {
  const parts = String(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function v4InRange(ip, base, prefixBits) {
  const value = v4ToInt(ip);
  const network = v4ToInt(base);
  if (value === null || network === null) return false;
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (((value & mask) >>> 0) === ((network & mask) >>> 0));
}

const BLOCKED_V4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** True for loopback/private/link-local/reserved addresses (SSRF guard). */
export function isBlockedIp(ip) {
  const value = String(ip || "").trim().toLowerCase();
  const family = net.isIP(value);
  if (family === 4) {
    return BLOCKED_V4_RANGES.some(([base, bits]) => v4InRange(value, base, bits));
  }
  if (family === 6) {
    if (value === "::" || value === "::1") return true;
    if (/^f[cd]/.test(value)) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (value.startsWith("2001:db8")) return true;
    const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isBlockedIp(mapped[1]);
    const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const a = parseInt(mappedHex[1], 16);
      const b = parseInt(mappedHex[2], 16);
      return isBlockedIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    return false;
  }
  return true;
}

function allowedPorts(ctx) {
  const raw = ctx?.allowPorts;
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_ALLOWED_PORTS;
  return new Set(list.map(Number));
}

/**
 * Validate a user- or provider-supplied URL. Rejects non-HTTP schemes,
 * credentials, unusual ports, local/private hosts and any hostname that
 * resolves to a private address. Returns the parsed URL on success.
 */
export async function assertSafeUrl(input, ctx = {}) {
  const raw = String(input || "").trim();
  if (!raw || /[\u0000-\u001f\u007f\s]/.test(raw)) {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "empty or malformed URL");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "URL parse failed");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "scheme not allowed");
  }
  if (parsed.username || parsed.password) {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "credentials in URL");
  }

  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!allowedPorts(ctx).has(port)) {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "port not allowed");
  }

  const host = parsed.hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "host not allowed");
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new ImageError(IMAGE_ERRORS.INVALID_URL, "IP not allowed");
    }
    return parsed;
  }

  let addresses;
  try {
    const lookup = ctx.dnsLookup || defaultDnsLookup;
    addresses = await lookup(host);
  } catch {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "hostname resolution failed");
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "hostname has no addresses");
  }
  if (addresses.some((address) => isBlockedIp(address))) {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "hostname resolves to a private address");
  }
  return parsed;
}

/** Resolve and re-validate a redirect target before it is ever requested. */
export async function assertSafeRedirect(currentUrl, location, ctx = {}) {
  let target;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "redirect parse failed");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new ImageError(IMAGE_ERRORS.INVALID_URL, "redirect scheme not allowed");
  }
  return assertSafeUrl(target.toString(), ctx);
}

export function maxImageBytes(ctx = {}) {
  return positiveInt(ctx.maxBytes, positiveInt(process.env.IMAGE_MAX_BYTES, MEDIA.MAX_IMAGE_BYTES));
}

export function allowedMimes() {
  const configured = (process.env.IMAGE_ALLOWED_MIMES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_MIMES);
}

export function isAllowedMime(mime) {
  return allowedMimes().has(String(mime || "").toLowerCase());
}
