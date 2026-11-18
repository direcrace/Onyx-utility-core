import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber, isPrivileged } from "../utils/access.js";
import { recordConsent, legalVersions, getConsent, consentIsCurrent } from "../utils/consent.js";
import {
  getRegistration,
  isRegistered,
  getCooldown,
  registerUser,
  refreshRegistrationConsent,
  unregisterUser,
} from "../utils/registration.js";

const ACCEPT_TOKENS = new Set(["accept", "akzeptieren", "agree", "ja", "yes"]);

function parseArgs(message, pattern) {
  const raw = (getCommandArgs(message.body, pattern) || "").trim();
  const tokens = raw ? raw.split(/\s+/) : [];
  const wantsAccept = tokens.some((t) => ACCEPT_TOKENS.has(t.toLowerCase()));
  const name = tokens
    .filter((t) => !ACCEPT_TOKENS.has(t.toLowerCase()))
    .join(" ")
    .trim();
  return { raw, tokens, wantsAccept, name };
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return new Date(ts).toISOString();
  }
}

function daysLeft(ms) {
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

async function usage(conn, message) {
  await reply(
    conn,
    message,
    await tr(
      `📝 *Registration*\n\nUsage: \`${BOT_INFO.PREFIX}register <Name>\`\nYou'll be asked to accept the Terms of Service and the Privacy Policy.`,
      `📝 *Registrierung*\n\nBenutzung: \`${BOT_INFO.PREFIX}register <Name>\`\nDu wirst gebeten, die Nutzungsbedingungen und die Datenschutzerklärung zu akzeptieren.`
    )
  );
}

async function askConsent(conn, message, name, versions) {
  await reply(
    conn,
    message,
    (await tr(
      `📝 *Registration* — name: *${name}*\n\nBefore you finish, please note:\n`,
      `📝 *Registrierung* — Name: *${name}*\n\nBevor du abschließt, bitte beachten:\n`
    )) +
      (await tr(
        `• Registering stores your name and your consent, and marks your number as registered.\n` +
          `• The same monitoring/abuse rules as pairing apply to registered numbers.\n` +
          `• You can delete it anytime with \`${BOT_INFO.PREFIX}unregister\` (30-day re-registration cooldown).\n\n` +
          `Documents: \`${BOT_INFO.PREFIX}terms\`, \`${BOT_INFO.PREFIX}privacy\`.\n\n`,
        `• Die Registrierung speichert deinen Namen und deine Zustimmung und markiert deine Nummer als registriert.\n` +
          `• Für registrierte Nummern gelten dieselben Überwachungs-/Missbrauchsregeln wie beim Pairing.\n` +
          `• Du kannst sie jederzeit mit \`${BOT_INFO.PREFIX}unregister\` löschen (30 Tage Sperre bis zur Neuregistrierung).\n\n` +
          `Dokumente: \`${BOT_INFO.PREFIX}terms\`, \`${BOT_INFO.PREFIX}privacy\`.\n\n`
      )) +
      (await tr(
        `To continue, reply:\n*${BOT_INFO.PREFIX}register ${name} accept*\n\nThis records your consent to the Terms of Service (v${versions.terms}) and the Privacy Policy (v${versions.privacy}).`,
        `Zum Fortfahren antworte mit:\n*${BOT_INFO.PREFIX}register ${name} accept*\n\nDamit wird deine Zustimmung zu den Nutzungsbedingungen (v${versions.terms}) und der Datenschutzerklärung (v${versions.privacy}) protokolliert.`
      ))
  );
}

command(
  {
    pattern: "register",
    fromMe: false,
    desc: "Register (accept ToS + Privacy), then use the bot",
    type: "info",
  },
  async (message, conn) => {
    const number = normalizeNumber(message.sender || message.from);
    if (!number) {
      await usage(conn, message);
      return;
    }

    const versions = legalVersions();
    const existing = await getRegistration(number);
    if (existing) {
      const current =
        existing.terms === versions.terms &&
        existing.privacy === versions.privacy &&
        consentIsCurrent(await getConsent(number), versions);

      if (current) {
        await reply(
          conn,
          message,
          await tr(
            `ℹ️ You're already registered as *${existing.name || "—"}* (since ${fmtDate(existing.ts)}).\nUse \`${BOT_INFO.PREFIX}unregister\` first if you want to change it.`,
            `ℹ️ Du bist bereits als *${existing.name || "—"}* registriert (seit ${fmtDate(existing.ts)}).\nNutze zuerst \`${BOT_INFO.PREFIX}unregister\`, wenn du das ändern willst.`
          )
        );
        return;
      }

      const { wantsAccept } = parseArgs(message, "register");
      if (!wantsAccept) {
        await reply(
          conn,
          message,
          await tr(
            `📝 The Terms/Privacy changed. Renew your consent with:\n*${BOT_INFO.PREFIX}register ${existing.name || "Name"} accept*\n\nNew versions: ToS v${versions.terms} · Privacy v${versions.privacy}.\nDocuments: \`${BOT_INFO.PREFIX}terms\` / \`${BOT_INFO.PREFIX}privacy\`.`,
            `📝 Nutzbedingungen/Datenschutz haben sich geändert. Erneuere deine Zustimmung mit:\n*${BOT_INFO.PREFIX}register ${existing.name || "Name"} accept*\n\nNeue Versionen: ToS v${versions.terms} · Datenschutz v${versions.privacy}.\nDokumente: \`${BOT_INFO.PREFIX}terms\` / \`${BOT_INFO.PREFIX}privacy\`.`
          )
        );
        return;
      }

      await recordConsent(number, {
        source: "register-reaccept",
        sender: message.sender || message.from,
      });
      const rec = await refreshRegistrationConsent(number, {
        terms: versions.terms,
        privacy: versions.privacy,
        sender: message.sender || message.from,
      });
      await replyOk(
        conn,
        message,
        await tr(
          `✅ Consent renewed as *${rec?.name || existing.name || "—"}*.\nCurrent versions: ToS v${versions.terms} · Privacy v${versions.privacy}. You can keep using my commands.`,
          `✅ Zustimmung erneuert als *${rec?.name || existing.name || "—"}*.\nAktuelle Versionen: ToS v${versions.terms} · Datenschutz v${versions.privacy}. Du kannst meine Befehle weiter nutzen.`
        )
      );
      return;
    }

    const cd = await getCooldown(number);
    if (cd) {
      await replyFail(
        conn,
        message,
        await tr(
          `⏳ You unregistered recently. You can register again in *${daysLeft(cd.remaining)}* day(s) — on ${fmtDate(cd.until)}.`,
          `⏳ Du hast dich kürzlich abgemeldet. Du kannst dich in *${daysLeft(cd.remaining)}* Tag(en) erneut registrieren — am ${fmtDate(cd.until)}.`
        )
      );
      return;
    }

    const { wantsAccept, name } = parseArgs(message, "register");
    if (!name) {
      await usage(conn, message);
      return;
    }

    if (!wantsAccept) {
      await askConsent(conn, message, name, versions);
      return;
    }

    await recordConsent(number, {
      source: "register",
      sender: message.sender || message.from,
    });
    const rec = await registerUser(number, {
      name,
      terms: versions.terms,
      privacy: versions.privacy,
      sender: message.sender || message.from,
    });

    await replyOk(
      conn,
      message,
      await tr(
        `✅ Registered as *${rec.name}*.\nConsent recorded (ToS v${versions.terms} · Privacy v${versions.privacy}). You can now use my commands.`,
        `✅ Registriert als *${rec.name}*.\nZustimmung protokolliert (ToS v${versions.terms} · Datenschutz v${versions.privacy}). Du kannst meine Befehle jetzt nutzen.`
      )
    );
  }
);

command(
  {
    pattern: "unregister",
    fromMe: false,
    desc: "Delete your registration (30-day re-registration cooldown)",
    type: "info",
  },
  async (message, conn) => {
    const { raw, name } = parseArgs(message, "unregister");
    const confirm = /\b(confirm|bestätigen|bestaetigen|yes|ja)\b/i.test(raw);

    const privileged = await isPrivileged(message, conn);
    let target = normalizeNumber(message.sender || message.from);
    if (privileged && name) {
      const asNumber = normalizeNumber(name);
      if (asNumber) target = asNumber;
    }

    if (!target) {
      await reply(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}unregister\` (then \`${BOT_INFO.PREFIX}unregister confirm\`).`,
          `Benutzung: \`${BOT_INFO.PREFIX}unregister\` (dann \`${BOT_INFO.PREFIX}unregister confirm\`).`
        )
      );
      return;
    }

    const existing = await getRegistration(target);
    if (!existing) {
      await reply(
        conn,
        message,
        await tr(
          `ℹ️ ${target === normalizeNumber(message.sender) ? "You're" : "That number is"} not registered.`,
          `ℹ️ ${target === normalizeNumber(message.sender) ? "Du bist" : "Diese Nummer ist"} nicht registriert.`
        )
      );
      return;
    }

    if (!confirm) {
      await replyFail(
        conn,
        message,
        await tr(
          `⚠️ This deletes the registration${target === normalizeNumber(message.sender) ? "" : ` of ${target}`} and blocks re-registration for *30 days*.\nTo confirm, reply:\n*${BOT_INFO.PREFIX}unregister${privileged && name ? " " + name : ""} confirm*`,
          `⚠️ Das löscht die Registrierung${target === normalizeNumber(message.sender) ? "" : ` von ${target}`} und sperrt die Neuregistrierung für *30 Tage*.\nZum Bestätigen antworte mit:\n*${BOT_INFO.PREFIX}unregister${privileged && name ? " " + name : ""} confirm*`
        )
      );
      return;
    }

    await unregisterUser(target);
    const until = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await replyOk(
      conn,
      message,
      await tr(
        `✅ Registration removed. Re-registration is possible on ${fmtDate(until)}.`,
        `✅ Registrierung gelöscht. Eine Neuregistrierung ist am ${fmtDate(until)} möglich.`
      )
    );
  }
);
