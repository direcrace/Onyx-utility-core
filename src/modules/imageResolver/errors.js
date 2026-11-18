export const IMAGE_ERRORS = Object.freeze({
  IMAGE_NOT_FOUND: "IMAGE_NOT_FOUND",
  SOURCE_BLOCKED: "SOURCE_BLOCKED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  INVALID_URL: "INVALID_URL",
});

const USER_MESSAGES = {
  IMAGE_NOT_FOUND: {
    en: "No image found right now. Try a different search term.",
    de: "Gerade kein Bild gefunden. Versuch einen anderen Suchbegriff.",
  },
  SOURCE_BLOCKED: {
    en: "Couldn't retrieve this Pinterest image. The source requires additional authentication or restricts automated access.",
    de: "Dieses Pinterest-Bild konnte nicht geladen werden. Die Quelle verlangt eine Anmeldung oder beschränkt den automatisierten Zugriff.",
  },
  AUTH_REQUIRED: {
    en: "Couldn't retrieve this Pinterest image. The source requires additional authentication or restricts automated access.",
    de: "Dieses Pinterest-Bild konnte nicht geladen werden. Die Quelle verlangt eine Anmeldung oder beschränkt den automatisierten Zugriff.",
  },
  UNSUPPORTED_FORMAT: {
    en: "That source didn't return a supported image (JPG, PNG, WEBP or GIF).",
    de: "Die Quelle hat kein unterstütztes Bild geliefert (JPG, PNG, WEBP oder GIF).",
  },
  FILE_TOO_LARGE: {
    en: "That image is too large to send on WhatsApp.",
    de: "Dieses Bild ist zu groß, um es auf WhatsApp zu senden.",
  },
  REQUEST_TIMEOUT: {
    en: "The image source took too long to respond.",
    de: "Die Bildquelle hat zu lange gebraucht.",
  },
  INVALID_URL: {
    en: "That's not a valid or allowed image URL.",
    de: "Das ist keine gültige oder erlaubte Bild-URL.",
  },
};

export const HARD_ERRORS = new Set([
  IMAGE_ERRORS.SOURCE_BLOCKED,
  IMAGE_ERRORS.AUTH_REQUIRED,
]);

export class ImageError extends Error {
  constructor(code, detail = "", options = {}) {
    const message = USER_MESSAGES[code]?.en || USER_MESSAGES.IMAGE_NOT_FOUND.en;
    super(message, options);
    this.name = "ImageError";
    this.code = Object.values(IMAGE_ERRORS).includes(code)
      ? code
      : IMAGE_ERRORS.IMAGE_NOT_FOUND;
    this.detail = String(detail || "").slice(0, 240);
  }
}

export function isImageError(err, code) {
  return (
    err instanceof ImageError && (!code || err.code === code)
  );
}

export function imageUserMessage(code) {
  const entry = USER_MESSAGES[code] || USER_MESSAGES.IMAGE_NOT_FOUND;
  return { en: entry.en, de: entry.de };
}

export async function imageUserText(code) {
  const { tr } = await import("../../utils/message.js");
  const msg = imageUserMessage(code);
  return tr(msg.en, msg.de);
}
