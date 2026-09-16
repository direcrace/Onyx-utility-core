

import { kvGet, kvSet, seedBotKvFromEnv } from "../database/botKv.js";

const STRINGS = {
  en: {
    GROUP_ONLY: "⚠️ This command can only be used in groups!",
    OWNER_ONLY: "⚠️ This command is only for the bot owner!",
    ADMIN_ONLY: "⚠️ This command is only for group admins!",
    BOT_ADMIN: "⚠️ Bot needs to be admin to perform this action!",
    FAILED: "❌ An error occurred while processing your request.",
    DONE: "✅ Done!",
    PLUGIN_DISABLED: "⚠️ This command is disabled in this group.",
    MUTED: "🔇 You are muted in this group.",
    WARNED: "⚠️ @user warned ({count}/{limit})",
    KICKED_WARNS: "🚫 @user removed after reaching warn limit.",
    ANTILINK: "🔗 Links are not allowed here.",
    ANTISPAM: "🛑 Slow down — spam detected.",
    WELCOME_ON: "✅ Welcome messages enabled",
    WELCOME_OFF: "✅ Welcome messages disabled",
    GOODBYE_ON: "✅ Goodbye messages enabled",
    GOODBYE_OFF: "✅ Goodbye messages disabled",
    LANG_SET: "✅ Language set to *{lang}*",
    LANG_LIST: "Available: {list}\nCurrent: *{lang}*",
    REMINDER_SET: "✅ Reminder set for {when}",
    NOTE_SAVED: "✅ Note saved as *{id}*",
    NOTE_DELETED: "✅ Note *{id}* deleted",
    NOTE_NOT_FOUND: "⚠️ Note not found",
    BROADCAST_DONE: "✅ Broadcast sent to {ok}/{total} chats",
    PAIRING_HINT: "Enter the pairing code on your phone",
  },
  de: {
    GROUP_ONLY: "⚠️ Dieser Befehl funktioniert nur in Gruppen!",
    OWNER_ONLY: "⚠️ Dieser Befehl ist nur für den Bot-Besitzer!",
    ADMIN_ONLY: "⚠️ Dieser Befehl ist nur für Gruppen-Admins!",
    BOT_ADMIN: "⚠️ Der Bot muss Admin sein, um das auszuführen!",
    FAILED: "❌ Beim Verarbeiten deiner Anfrage ist ein Fehler aufgetreten.",
    DONE: "✅ Erledigt!",
    PLUGIN_DISABLED: "⚠️ Dieser Befehl ist in dieser Gruppe deaktiviert.",
    MUTED: "🔇 Du bist in dieser Gruppe stummgeschaltet.",
    WARNED: "⚠️ @user verwarnt ({count}/{limit})",
    KICKED_WARNS: "🚫 @user wurde nach Erreichen der Warn-Grenze entfernt.",
    ANTILINK: "🔗 Links sind hier nicht erlaubt.",
    ANTISPAM: "🛑 Langsamer — Spam erkannt.",
    WELCOME_ON: "✅ Willkommensnachrichten aktiviert",
    WELCOME_OFF: "✅ Willkommensnachrichten deaktiviert",
    GOODBYE_ON: "✅ Abschiedsnachrichten aktiviert",
    GOODBYE_OFF: "✅ Abschiedsnachrichten deaktiviert",
    LANG_SET: "✅ Sprache geändert auf *{lang}*",
    LANG_LIST: "Verfügbar: {list}\nAktuell: *{lang}*",
    REMINDER_SET: "✅ Erinnerung festgelegt für {when}",
    NOTE_SAVED: "✅ Notiz *{id}* gespeichert",
    NOTE_DELETED: "✅ Notiz *{id}* gelöscht",
    NOTE_NOT_FOUND: "⚠️ Notiz nicht gefunden",
    BROADCAST_DONE: "✅ Broadcast an {ok}/{total} Chats gesendet",
    PAIRING_HINT: "Gib den Pairing-Code auf deinem Handy ein",
  },
};

export const AVAILABLE_LANGS = Object.keys(STRINGS);

let cachedLang = null;

async function ensureLang() {
  if (cachedLang) return cachedLang;
  try {
    await seedBotKvFromEnv();
    const stored = await kvGet("lang");
    if (stored && STRINGS[stored]) {
      cachedLang = stored;
      return cachedLang;
    }
  } catch {

  }
  const env = (process.env.BOT_LANG || "en").toLowerCase();
  cachedLang = STRINGS[env] ? env : "en";
  return cachedLang;
}

export async function getLang() {
  return ensureLang();
}

export async function setLang(lang) {
  const next = String(lang || "").toLowerCase();
  if (!STRINGS[next]) throw new Error("Unsupported language");
  await kvSet("lang", next);
  cachedLang = next;
  return next;
}

export async function t(key, vars = {}) {
  const lang = await ensureLang();
  let text =
    STRINGS[lang]?.[key] || STRINGS.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function tSync(key, vars = {}, lang = "en") {
  let text = STRINGS[lang]?.[key] || STRINGS.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
