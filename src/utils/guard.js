/**
 * Creator-guard — the host tier above owner. Every denied attempt gets a
 * playful "I'm watching you" reply, is written to the audit log, and the
 * creators are notified (log group + DM when on the main connection).
 */

import { BOT_INFO } from "../config/constants.js";
import { replyFail, tr } from "./message.js";
import {
  isCreatorMessage,
  getCreatorNumbers,
  senderCandidates,
} from "./access.js";
import { writeAudit } from "../enterprise/audit.js";
import { systemLog } from "./logGroup.js";

const WATCH_LINES = {
  en: [
    "🚨 Attempt logged. I am watching you. 👀",
    "🔒 Nice try — everything you do is visible to the creator. 👁️",
    "🙊 Not that one. Every action is logged and reported. 📋",
    "😏 You have full owner powers... but *this* stays with the creator.",
    "🔍 Tried, logged, watched. Maybe ask nicely next time.",
    "⛔ Holding you to account — this one is creator-only, and I see everything.",
  ],
  de: [
    "🚨 Versuch protokolliert. Ich beobachte dich. 👀",
    "🔒 Netter Versuch — alles, was du tust, ist für den Ersteller sichtbar. 👁️",
    "🙊 Nicht der. Jede Aktion wird protokolliert und gemeldet. 📋",
    "😏 Du hast volle Besitzerrechte... aber *das* bleibt beim Ersteller.",
    "🔍 Versucht, protokolliert, beobachtet. Frag vielleicht mal höflich.",
    "⛔ Zur Rechenschaft gezogen — das ist nur für den Ersteller, und ich sehe alles.",
  ],
};

let lastLine = -1;

function nextLine(lang) {
  const lines = WATCH_LINES[lang === "de" ? "de" : "en"] || WATCH_LINES.en;
  lastLine += 1;
  return lines[lastLine % lines.length];
}

/**
 * Gate a creator-only action. Returns true when the sender may proceed.
 * On denial: witty reply + audit + notify the creators.
 *
 * @param {object} conn
 * @param {object} message
 * @param {string} [label]  human/command label of the attempt, e.g. "#update"
 * @returns {Promise<boolean>}
 */
export async function requireCreator(conn, message, label = "creator-only") {
  if (isCreatorMessage(message, conn)) return true;

  const actor = [...senderCandidates(message, conn)][0] || message?.sender || "unknown";
  const pushName = message?.pushName || actor;
  const lang = (message?.source || "").toLowerCase().includes("de") ? "de" : "en";
  const line = nextLine(lang);
  try {
    await replyFail(conn, message, await tr(
      `${line}\n\n_${pushName}'s ${label} attempt → logged._`,
      `${line}\n\n_${pushName}'s ${label}-Versuch → protokolliert._`
    ));
  } catch { /* reply may fail */ }

  try {
    await writeAudit({
      action: "creator:deny",
      actor,
      target: label,
      chat: message?.from || null,
      meta: { pushName, source: message?.source || null },
    });
  } catch { /* audit best effort */ }

  try {
    await systemLog("warn", `🚨 [CREATOR] *${label}* denied for ${pushName} (${actor})`, "creator-only attempt logged");
  } catch { /* log group unavailable */ }

  // Notify creators directly (only from the main connection).
  if (!conn?.__isSub) {
    const creators = getCreatorNumbers();
    for (const num of creators) {
      try {
        await conn.sendMessage(`${num}@s.whatsapp.net`, {
          text: `🚨 *${BOT_INFO.NAME}* · creator-only attempt\n\n*${label}* was tried by ${pushName} (${actor}).\n📋 Logged and under your review.`,
        });
      } catch { /* best effort */ }
    }
  }

  return false;
}