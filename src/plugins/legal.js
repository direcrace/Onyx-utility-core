/**
 * Legal docs: `#terms` and `#privacy`.
 *
 * Default: a condensed, bilingual summary (one message).
 * `#terms full` / `#privacy full`: the complete document from the repo files,
 * sent in chunks. Chunks are paced so the multi-message send never trips the
 * core-panic send-burst condition (4 text messages inside 2 seconds).
 */

import path from "path";
import fs from "fs/promises";
import { command } from "../plugins.js";
import { reply, getCommandArgs, tr } from "../utils/message.js";

const DOCS = {
  terms: "terms-of-service.md",
  privacy: "privacy-policy.md",
};

const CHUNK_MAX = 3800;
const CHUNK_GAP_MS = 700;

async function readDoc(name) {
  const base = global.__basedir || process.cwd();
  const file = path.join(base, DOCS[name] || name);
  const text = await fs.readFile(file, "utf8");
  return text.replace(/\r\n/g, "\n").trim();
}

function chunkText(text) {
  const parts = [];
  let rest = text;
  while (rest.length > CHUNK_MAX) {
    let cut = rest.lastIndexOf("\n", CHUNK_MAX);
    if (cut <= 0) cut = CHUNK_MAX;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const TERMS_SHORT_EN = [
  "📜 *Terms of Service* (short)",
  "• By sending any command, adding the bot to a group, or using `#pair`, you agree to the Terms.",
  "• Service is \"as is\", best-effort; downloads (`#tiktok`/`#ig`/`#fb`/`#ytmp3`…) may break or change anytime.",
  "• No illegal content (CSAM is prohibited absolutely and without exception), harassment, spam, phishing, malware, or abuse.",
  "• Group admins are responsible for the moderation tools they enable.",
  "• `#pair` adds extra rules: own session, always-on automated monitoring, possible logging/review, termination without notice, no uptime/data guarantee — running `#pair` is consent.",
  "• Liability limited; governed by Germany/EU law.",
  "Full text: `#terms full` · Changing terms: \"Last updated\" date in the Terms.",
].join("\n");

const TERMS_SHORT_DE = [
  "📜 *Nutzungsbedingungen* (Kurzfassung)",
  "• Mit jedem Befehl, dem Hinzufügen des Bots zu einer Gruppe oder der Nutzung von `#pair` stimmst du den Nutzungsbedingungen zu.",
  "• Der Dienst wird \"wie er ist\", auf Best-Effort-Basis bereitgestellt; Downloads (`#tiktok`/`#ig`/`#fb`/`#ytmp3`…) können sich jederzeit ändern oder ausfallen.",
  "• Keine illegalen Inhalte (CSAM ist ausnahmslos verboten), keine Belästigung, kein Spam, Phishing, Schadsoftware oder Missbrauch.",
  "• Gruppen-Admins sind für die von ihnen aktivierten Moderationsfunktionen verantwortlich.",
  "• `#pair` bringt zusätzliche Regeln: eigene Sitzung, dauerhafte automatische Überwachung, mögliche Protokollierung/Prüfung, Kündigung ohne Ankündigung, keine Uptime-/Datengarantie — `#pair` zu nutzen ist Zustimmung.",
  "• Haftung begrenzt; es gilt das Recht von Deutschland/EU.",
  "Volltext: `#terms full` · Änderungen: \"Letzte Aktualisierung\"-Datum in den Bedingungen.",
].join("\n");

const PRIVACY_SHORT_EN = [
  "🔒 *Privacy Policy* (short)",
  "• Using the bot = consent to this policy.",
  "• We may see: your WhatsApp number/ID, command text and content needed to run it, media you send to media commands, group metadata, and data you ask to store (notes/to-dos/reminders).",
  "• Messages are kept only in a short RAM-only snapshot that is never written to disk and disappears on the next restart — the operator does **NOT** read chats. Logging happens only when an automated monitor flags a message, to enforce the Terms.",
  "• `#pair`: dedicated session, activity in it is visible, and an **always-on automated monitor** checks for abuse/spam/illegal/WhatsApp-ToS triggers; flags may be logged and personally reviewed; the session can be terminated anytime without notice.",
  "• Legal basis: providing the service + legitimate interest in safety and abuse prevention.",
  "• Third-party APIs (search/download/AI) only receive what your request needs.",
  "• Your GDPR rights (access/correction/deletion) via the contact below.",
  "Full text: `#privacy full`.",
].join("\n");

const PRIVACY_SHORT_DE = [
  "🔒 *Datenschutz* (Kurzfassung)",
  "• Die Nutzung des Bots = Zustimmung zu dieser Richtlinie.",
  "• Wir können sehen: deine WhatsApp-Nummer/ID, Befehlstext und Inhalt, die zur Ausführung nötig sind, Medien für Medien-Befehle, Gruppen-Metadaten und Daten, die du speichern lässt (Notizen/To-dos/Erinnerungen).",
  "• Nachrichten werden nur in einem kurzen RAM-Snapshot gehalten, der nie auf die Festplatte geschrieben wird und beim nächsten Neustart verschwindet — der Betreiber liest KEINE Chats. Protokolle entstehen nur, wenn ein automatischer Monitor eine Nachricht flaggt, zur Durchsetzung der Nutzungsbedingungen.",
  "• `#pair`: eigene Sitzung, sichtbare Aktivität und eine **dauerhaft aktive automatische Überwachung** auf Missbrauch/Spam/Illegalität/WhatsApp-ToS-Verstöße; Flaggen können protokolliert und persönlich geprüft werden; die Sitzung kann jederzeit ohne Ankündigung beendet werden.",
  "• Rechtsgrundlage: Leistungserbringung + berechtigtes Interesse an Sicherheit und Missbrauchsbekämpfung.",
  "• Drittanbieter-APIs (Suche/Download/KI) erhalten nur, was deine Anfrage braucht.",
  "• Deine DSGVO-Rechte (Auskunft/Berichtigung/Löschung) über den Kontakt unten.",
  "Volltext: `#privacy full`.",
].join("\n");

const SHORT_TEXT = {
  terms: { en: TERMS_SHORT_EN, de: TERMS_SHORT_DE },
  privacy: { en: PRIVACY_SHORT_EN, de: PRIVACY_SHORT_DE },
};

const CONTACT_EN = "\n\n_Contact: +49 160 95344704 · directorace · teamtestdevteam@gmx.net_";
const CONTACT_DE = "\n\n_Kontakt: +49 160 95344704 · directorace · teamtestdevteam@gmx.net_";

async function serveLegal(conn, message, name) {
  const args = (getCommandArgs(message.body, name) || "").trim().toLowerCase();

  if (args !== "full") {
    const short = SHORT_TEXT[name];
    await reply(conn, message, (await tr(short.en, short.de)) + await tr(CONTACT_EN, CONTACT_DE));
    return;
  }

  let full = null;
  try {
    full = await readDoc(name);
  } catch (err) {
    await reply(
      conn,
      message,
      await tr(
        `Could not read the document (${err?.message || "error"}). Tell the owner.`,
        `Dokument konnte nicht gelesen werden (${err?.message || "Fehler"}). Sag es dem Besitzer.`
      )
    );
    return;
  }

  const parts = chunkText(full);
  for (const part of parts) {
    await reply(conn, message, part);
    if (parts.length > 1) await new Promise((r) => setTimeout(r, CHUNK_GAP_MS));
  }
}

command(
  {
    pattern: "terms",
    fromMe: false,
    desc: "Terms of Service · `#terms full` for the complete document",
    type: "info",
  },
  async (message, conn) => {
    await serveLegal(conn, message, "terms");
  }
);

command(
  {
    pattern: "privacy",
    fromMe: false,
    desc: "Privacy Policy · `#privacy full` for the complete document",
    type: "info",
  },
  async (message, conn) => {
    await serveLegal(conn, message, "privacy");
  }
);