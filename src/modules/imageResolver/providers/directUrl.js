import { BOT_UA } from "../constants.js";

/**
 * Direct, publicly accessible image links. The shared downloader does the
 * real work (SSRF checks, redirect validation, MIME sniffing, size caps);
 * this provider simply turns a validated URL into a candidate.
 */
export async function directUrlProvider(url, ctx = {}) {
  const parsed = new URL(url);
  return [
    {
      url: parsed.toString(),
      provider: ctx.providerLabel || "Direct link",
      ua: BOT_UA,
    },
  ];
}
