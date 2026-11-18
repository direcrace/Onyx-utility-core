

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
  "• Register with `#register <Name> accept` to use commands — this is your explicit consent to these Terms and the Privacy Policy.",
  "• Consent is version-hashed: after updates you will be asked to re-accept.",
  "• Service is \"as is\", best-effort; third-party downloads may break anytime.",
  "• No illegal content (CSAM absolutely prohibited), harassment, spam, phishing, malware, ban evasion or false reports/tickets.",
  "• Group admins are responsible for the moderation tools they enable; ranks are privileges, not rights.",
  "• Community extras (`#thanks`, `#badges`, `#level`) are cosmetic and never grant staff permissions; data rights are available via `#mydata` / `#forgetai`.",
  "• `#pair` adds: own session, always-on automated monitoring (operator can disable it with `#autoflag off`), possible logging/review, termination without notice — running `#pair` is consent.",
  "• Audit logs can prove actions (actor/target/chat/reason/body/message ID); no media is downloaded for logging.",
  "• Liability limited; governed by Germany/EU law.",
  "Full text: `#terms full` · Changes: \"Last updated\" date + re-accept.",
].join("\n");

const TERMS_SHORT_DE = [
  "📜 *Nutzungsbedingungen* (Kurzfassung)",
  "• Registriere dich mit `#register <Name> accept`, um Befehle zu nutzen — das ist deine ausdrückliche Zustimmung zu diesen Bedingungen und zur Datenschutzerklärung.",
  "• Zustimmung ist versionsgehasht: nach Updates wirst du gebeten, neu zu akzeptieren.",
  "• Der Dienst wird \"wie er ist\", auf Best-Effort-Basis bereitgestellt; Drittanbieter-Downloads können jederzeit ausfallen.",
  "• Keine illegalen Inhalte (CSAM ausnahmslos verboten), keine Belästigung, kein Spam, Phishing, Schadsoftware, Ban-Evasion oder falsche Meldungen/Tickets.",
  "• Gruppen-Admins sind für aktivierte Moderationstools verantwortlich; Ränge sind kein Recht, sondern ein Privileg.",
  "• Community-Extras (`#thanks`, `#badges`, `#level`) sind rein kosmetisch und verleihen keine Staff-Rechte; Datenrechte gibt es über `#mydata` / `#forgetai`.",
  "• `#pair` brings mit: eigene Sitzung, dauerhaft aktive Überwachung (vom Betreiber mit `#autoflag off` abschaltbar), mögliche Protokollierung/Prüfung, Kündigung ohne Ankündigung — `#pair` zu nutzen ist Zustimmung.",
  "• Audit-Logs können Aktionen belegen (Akteur/Ziel/Chat/Grund/Text/Nachrichten-ID); für Logs werden keine Medien heruntergeladen.",
  "• Haftung begrenzt; es gilt das Recht von Deutschland/EU.",
  "Volltext: `#terms full` · Änderungen: \"Letzte Aktualisierung\" + erneute Zustimmung.",
].join("\n");

const PRIVACY_SHORT_EN = [
  "🔒 *Privacy Policy* (short)",
  "• Registering (`#register`) or using the bot = consent to this policy.",
  "• We may see: your number/ID, command text and content needed to run it, media for media commands, group metadata, and data you store (notes/to-dos/reminders).",
  "• Registration stores your name, number, timestamp and document version hashes; `#unregister` deletes it (30-day cooldown).",
  "• Audit: moderation events go to append-only plaintext files under `logs/` (default level `audit`). Proof records include actor/target/chat/reason/body/message ID. The operator can raise the level to `messages` or `raw` via `#log`/`#fulllog`. **No media is ever downloaded for logging.**",
  "• A short RAM-only snapshot supports safety checks; it is never written to disk and is cleared on restart.",
  "• `#pair`: dedicated session, always-on monitor (operator can disable via `#autoflag off`); flags may be logged/reviewed; termination anytime without notice.",
  "• Reports/tickets and community stats/leaderboard are stored to handle requests and run the community; tickets can be routed by category and unanswered ones may get one SLA reminder in the support group.",
  "• Self-service rights: `#mydata` exports your stored data (DM only); `#mydata delete` / `#forgetme` delete it, `#forgetai` clears AI history. Registration/consent proof and append-only audit logs are retained.",
  "• Legal basis: service + legitimate interest in safety and consent proof.",
  "• Third-party APIs only receive what your request needs.",
  "• GDPR rights (access/correction/deletion) via the contact below; verify via your registered number.",
  "Full text: `#privacy full`.",
].join("\n");

const PRIVACY_SHORT_DE = [
  "🔒 *Datenschutz* (Kurzfassung)",
  "• Registrierung (`#register`) oder Nutzung des Bots = Zustimmung zu dieser Richtlinie.",
  "• Wir können sehen: deine Nummer/ID, Befehlstext und nötigen Inhalt, Medien für Medien-Befehle, Gruppen-Metadaten und selbst gespeicherte Daten (Notizen/To-dos/Erinnerungen).",
  "• Die Registrierung speichert Name, Nummer, Zeitstempel und Dokument-Versionshashes; `#unregister` löscht sie (30 Tage Sperre).",
  "• Audit: Moderationsereignisse gehen in unveränderbare Klartext-Dateien unter `logs/` (Standardstufe `audit`). Belege enthalten Akteur/Ziel/Chat/Grund/Text/Nachrichten-ID. Der Betreiber kann die Stufe mit `#log`/`#fulllog` auf `messages` oder `raw` erhöhen. **Für Logs werden niemals Medien heruntergeladen.**",
  "• Ein kurzer RAM-Snapshot unterstützt Sicherheitsprüfungen; er wird nie auf die Platte geschrieben und beim Neustart gelöscht.",
  "• `#pair`: eigene Sitzung, dauerhaft aktive Überwachung (vom Betreiber mit `#autoflag off` abschaltbar); Flaggen können protokolliert/geprüft werden; jederzeitige Beendigung ohne Ankündigung.",
  "• Meldungen/Tickets sowie Community-Statistiken/Leaderboard werden gespeichert, um Anfragen zu bearbeiten und die Community zu betreiben; Tickets können nach Kategorie geroutet werden, unbeantwortete erhalten einmalig eine SLA-Erinnerung in der Support-Gruppe.",
  "• Selbstbedienung: `#mydata` exportiert deine Daten (nur Privatchat), `#mydata delete` / `#forgetme` löschen sie, `#forgetai` löscht nur den KI-Verlauf. Registrierung/Zustimmungsnachweis und unveränderbare Audit-Logs bleiben erhalten.",
  "• Rechtsgrundlage: Leistungserbringung + berechtigtes Interesse an Sicherheit und Zustimmungsnachweis.",
  "• Drittanbieter-APIs erhalten nur, was deine Anfrage braucht.",
  "• DSGVO-Rechte (Auskunft/Berichtigung/Löschung) über den Kontakt unten; Verifikation über deine registrierte Nummer.",
  "Volltext: `#privacy full`.",
].join("\n");

const SHORT_TEXT = {
  terms: { en: TERMS_SHORT_EN, de: TERMS_SHORT_DE },
  privacy: { en: PRIVACY_SHORT_EN, de: PRIVACY_SHORT_DE },
};

const CONTACT_EN = "\n\n_Impressum / contact: +49 15679 830332 · Meros.Basement@gmx.net_\n_Postal address available on request; no publicly listed address for privacy reasons._";
const CONTACT_DE = "\n\n_Impressum / Kontakt: +49 15679 830332 · Meros.Basement@gmx.net_\n_Postadresse auf Anfrage; aus Datenschutzgründen wird keine ladungsfähige Anschrift veröffentlicht._";

async function serveLegal(conn, message, name, token = name) {
  const args = (getCommandArgs(message.body, token) || "").trim().toLowerCase();

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
    pattern: "tos",
    fromMe: false,
    desc: "Alias for #terms",
    type: "info",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    await serveLegal(conn, message, "terms", "tos");
  }
);

command(
  {
    pattern: "dsgvo",
    fromMe: false,
    desc: "Alias for #privacy",
    type: "info",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    await serveLegal(conn, message, "privacy", "dsgvo");
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