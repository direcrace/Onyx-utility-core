export const BOT_UA = "YumBot/1.0 (WhatsApp community bot; contact via #terms) Node/20+";

export function imageHeaders(ua = BOT_UA) {
  return {
    "User-Agent": ua,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
}

export function jsonHeaders(ua = BOT_UA) {
  return {
    "User-Agent": ua,
    Accept: "application/json, text/plain, */*",
  };
}
