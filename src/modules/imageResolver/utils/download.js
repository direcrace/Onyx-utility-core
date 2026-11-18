import { ImageError, IMAGE_ERRORS } from "../errors.js";
import { assertSafeUrl, assertSafeRedirect, positiveInt } from "./validator.js";

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function isTimeout(err) {
  const name = String(err?.name || "");
  const message = String(err?.message || "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    err?.code === "ABORT_ERR" ||
    /abort|timeout/i.test(message)
  );
}

async function readCapped(body, maxBytes) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.getReader !== "function") {
    const raw = await body.arrayBuffer?.();
    const buffer = Buffer.from(raw || []);
    if (buffer.length > maxBytes) {
      throw new ImageError(IMAGE_ERRORS.FILE_TOO_LARGE, `body exceeded ${maxBytes} bytes`);
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new ImageError(IMAGE_ERRORS.FILE_TOO_LARGE, `body exceeded ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof ImageError) throw err;
    if (isTimeout(err)) {
      throw new ImageError(IMAGE_ERRORS.REQUEST_TIMEOUT, "body read aborted");
    }
    throw new ImageError(IMAGE_ERRORS.REQUEST_TIMEOUT, `body read failed: ${err?.name || "error"}`);
  } finally {
    try { reader.releaseLock?.(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks, total);
}

function buildSignal(opts, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (opts.signal) {
    return typeof AbortSignal.any === "function"
      ? AbortSignal.any([timeout, opts.signal])
      : timeout;
  }
  return timeout;
}

/**
 * A single guarded HTTP request. Validates the URL and every redirect target,
 * caps the response body while streaming (never buffering an unbounded body),
 * applies a hard timeout and returns normalized response data.
 */
export async function guardedFetch(url, opts = {}) {
  const ctx = {
    dnsLookup: opts.dnsLookup,
    allowPorts: opts.allowPorts,
  };
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = positiveInt(opts.timeoutMs, 15000);
  const maxBytes = positiveInt(opts.maxBytes, 10 * 1024 * 1024);
  const maxRedirects = positiveInt(
    opts.maxRedirects,
    positiveInt(process.env.IMAGE_MAX_REDIRECTS, 3)
  );
  const method = opts.method || "GET";

  let current = String(url || "");
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeUrl(current, ctx);

    let res;
    try {
      res = await fetchImpl(current, {
        method,
        headers: opts.headers,
        body: opts.body,
        redirect: "manual",
        signal: buildSignal(opts, timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new ImageError(IMAGE_ERRORS.REQUEST_TIMEOUT, "request timed out");
      }
      throw new ImageError(IMAGE_ERRORS.REQUEST_TIMEOUT, `request failed: ${err?.name || "error"}`);
    }

    const location = res.headers?.get?.("location");
    if (REDIRECT_CODES.has(res.status) && location) {
      if (hop === maxRedirects) {
        try { await res.body?.cancel?.(); } catch { /* ignore */ }
        throw new ImageError(IMAGE_ERRORS.INVALID_URL, "too many redirects");
      }
      const next = await assertSafeRedirect(current, location, ctx);
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      current = next.toString();
      continue;
    }

    const buffer = await readCapped(res.body, maxBytes);
    const headers = {};
    try {
      for (const [key, value] of res.headers.entries()) headers[key.toLowerCase()] = value;
    } catch { /* ignore */ }
    return {
      ok: !!res.ok,
      status: res.status,
      url: current,
      headers,
      buffer,
    };
  }
  throw new ImageError(IMAGE_ERRORS.INVALID_URL, "redirect loop");
}
