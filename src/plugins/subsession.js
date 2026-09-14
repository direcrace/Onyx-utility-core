/**
 * Sub-session management — `#pair` (open) + `#instances` (owner)
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { normalizeNumber, isOwnerMessage } from "../utils/access.js";
import { isBotBanned } from "../utils/globalBan.js";
import {
  provisionSubSession,
  respawnSubSession,
  removeSubSession,
  suspendSubSession,
  unsuspendSubSession,
  getSubSessions,
  getSubSession,
  getIndexEntries,
  isSubConnection,
} from "../multi/sessionManager.js";
import { getMiniAdmin, clearMiniFlags } from "../multi/miniMonitor.js";
import { BOT_INFO } from "../config/constants.js";

const INSTRUCTIONS_EN =
  "How to link:\n" +
  "1. Open WhatsApp on your phone\n" +
  "2. Go to *Settings → Linked devices*\n" +
  "3. Tap *Link a device*\n" +
  "4. Choose *Link with phone number instead*\n" +
  "5. Enter this code:";

const INSTRUCTIONS_DE =
  "So verlinkst du:\n" +
  "1. Öffne WhatsApp auf deinem Handy\n" +
  "2. Gehe zu *Einstellungen → Verknüpfte Geräte*\n" +
  "3. Tippe auf *Gerät verknüpfen*\n" +
  "4. Wähle *Stattdessen mit Telefonnummer verknüpfen*\n" +
  "5. Gib diesen Code ein:";

const PAIR_CONSENT_EN =
  "*Before you link your number with #pair — please read:*\n" +
  "• Your linked account gets its own separate database/session.\n" +
  "• Because the Bot runs as your account in this mode, it can see the activity in that session.\n" +
  "• An automated system continuously monitors linked sessions for specific abuse/violation triggers — this is always on, not occasional.\n" +
  "• If flagged: your messages related to the flag may be logged, and/or the operator may personally review the flagged activity.\n" +
  "• The operator can suspend or terminate your linked session at any time, at their sole discretion, with no guaranteed notice.\n" +
  "*⚠️ NO WARRANTY / NOT OUR RESPONSIBILITY:* the Bot is provided \"as is\". You are solely responsible for how you use your linked session and for complying with WhatsApp's own Terms of Service. The operator is NOT responsible for any action WhatsApp takes against your number (including temporary or permanent bans) as a result of using this feature, for any data loss, or for any other consequences of linking.\n" +
  "• There is no separate signup — *running #pair means you agree to this*, the full Privacy Policy and the Terms of Service.\n\n" +
  "_Full documents: `#terms` and `#privacy`._";

const PAIR_CONSENT_DE =
  "*Bevor du deine Nummer mit #pair verknüpfst — bitte lies das:*\n" +
  "• Dein verknüpftes Konto bekommt eine eigene, getrennte Datenbank/Sitzung.\n" +
  "• Da der Bot in diesem Modus *als* dein Konto läuft, kann er die Aktivität in dieser Sitzung sehen.\n" +
  "• Ein automatisiertes System überwacht verknüpfte Sitzungen kontinuierlich auf bestimmte Missbrauchs-/Verstoß-Auslöser — dauerhaft, nicht nur gelegentlich.\n" +
  "• Bei einer Markierung: Deine zugehörigen Nachrichten können protokolliert und/oder von der Betreiberin/dem Betreiber persönlich geprüft werden.\n" +
  "• Die Betreiberin/der Betreiber kann deine verknüpfte Sitzung jederzeit, nach eigenem Ermessen und ohne garantierte Ankündigung beenden.\n" +
  "*⚠️ KEINE GEWÄHRLEISTUNG / KEINE HAFTUNG:* Der Bot wird \"wie er ist\" bereitgestellt. Du bist allein für die Nutzung deiner verknüpften Sitzung und für die Einhaltung der WhatsApp-Nutzungsbedingungen verantwortlich. Die Betreiberin/der Betreiber ist NICHT verantwortlich für Maßnahmen von WhatsApp gegen deine Nummer (einschließlich vorübergehender oder dauerhafter Sperren) infolge der Nutzung dieser Funktion, für Datenverlust oder andere Folgen der Verknüpfung.\n" +
  "• Es gibt keine separate Anmeldung — *#pair zu nutzen bedeutet, dem zuzustimmen*, ebenso wie der vollständigen Datenschutzerklärung und den Nutzungsbedingungen.\n\n" +
  "_Vollständige Dokumente: `#terms` und `#privacy`._";

command(
  {
    pattern: "pair",
    fromMe: false,
    desc: "Link a new bot number (Onyx Mini)",
    type: "misc",
  },
  async (message, conn) => {
    if (isSubConnection(conn)) {
      await replyFail(
        conn,
        message,
        await tr(
          "You can't create an Onyx Mini from another Onyx Mini. Ask the main bot owner.",
          "Du kannst kein Onyx Mini aus einem anderen Onyx Mini erstellen. Frage den Besitzer des Haupt-Bots."
        )
      );
      return;
    }

    if (message.isGroup) {
      await replyFail(
        conn,
        message,
        await tr(
          "This command only works in DMs. Message the bot privately to link your number.",
          "Dieser Befehl funktioniert nur in DMs. Schreib dem Bot privat, um deine Nummer zu verknüpfen."
        )
      );
      return;
    }

    const arg = (getCommandArgs(message.body, "pair") || "").trim();
    let target = normalizeNumber(arg);

    if (!target) {
      // Fall back to the requester's own number when no argument is given.
      target = normalizeNumber(message.sender || message.from);
    }

    if (!target) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}pair <number>\` (with country code)`,
          `Benutzung: \`${BOT_INFO.PREFIX}pair <Nummer>\` (mit Ländervorwahl)`
        )
      );
      return;
    }

    if (message.sender && normalizeNumber(message.sender) !== target) {
      // Allow anyone to pair their OWN number; only owner may pair others.
      if (!isOwnerMessage(message, conn)) {
        await replyFail(
          conn,
          message,
          await tr(
            "You can only link your own number. Run `#pair <yourNumber>`.",
            "Du kannst nur deine eigene Nummer verknüpfen. Nutze `#pair <deineNummer>`."
          )
        );
        return;
      }
    }

    if (await isBotBanned(target)) {
      await replyFail(
        conn,
        message,
        await tr(
          "This number is banned from using the bot.",
          "Diese Nummer ist für die Bot-Nutzung gesperrt."
        )
      );
      return;
    }

    const live = getSubSessions().find((s) => s.number === target);
    if (live && ["connecting", "linking", "connected", "reconnecting"].includes(live.status)) {
      await replyFail(
        conn,
        message,
        await tr(
          "This number is already linked to an Onyx Mini.",
          "Diese Nummer ist bereits mit einem Onyx Mini verknüpft."
        )
      );
      return;
    }

    // A suspended number stays blocked with a clear message (never "already linked").
    const idx = (await getIndexEntries()).find((e) => e.number === target);
    if (!live && idx?.status === "suspended") {
      await replyFail(
        conn,
        message,
        await tr(
          "This number is suspended — the owner must lift the suspension before it can be linked again.",
          "Diese Nummer ist gesperrt — die Betreiberin/der Betreiber muss die Sperre aufheben, bevor sie wieder verknüpft werden kann."
        )
      );
      return;
    }

    try {
      const code = await provisionSubSession(target);
      const then = await tr(
        `\n\n*NOTE:* You have ~1 minute. The code expires when the hourglass turns.*`,
        `\n\n*HINWEIS:* Du hast ~1 Minute. Der Code läuft ab, wenn die Sanduhr erscheint.*`
      );
      await reply(
        conn,
        message,
        `${await tr(PAIR_CONSENT_EN, PAIR_CONSENT_DE)}\n\n━━━━━━━━━━━━━━\n\n${await tr(INSTRUCTIONS_EN, INSTRUCTIONS_DE)}\n\n*${code}*${then}\n\n` +
          await tr(
            "When it links, you'll get a ✅ here automatically.",
            "Sobald es verknüpft ist, bekommst du hier automatisch ein ✅."
          )
      );
    } catch (err) {
      const msg = (err?.message || "").toString();
      if (msg === "ALREADY_LINKED") {
        await replyFail(
          conn,
          message,
          await tr(
            "This number is already linked to an Onyx Mini.",
            "Diese Nummer ist bereits mit einem Onyx Mini verknüpft."
          )
        );
      } else if (msg === "SUSPENDED") {
        await replyFail(
          conn,
          message,
          await tr(
            "This number is suspended — the owner must lift the suspension before it can be linked again.",
            "Diese Nummer ist gesperrt — die Betreiberin/der Betreiber muss die Sperre aufheben, bevor sie wieder verknüpft werden kann."
          )
        );
      } else if (msg === "NOT_READY") {
        const code = err.statusCode;
        let txt;
        if (code === 403) {
          txt = await tr(
            "Pairing was refused (code 403) — this phone number isn't registered on WhatsApp, or the account is in a bad state. Check the number (country code + number, no spaces) and retry.",
            "Pairing abgelehnt (Code 403) — diese Telefonnummer ist nicht bei WhatsApp registriert oder das Konto ist in einem schlechten Zustand. Überprüfe die Nummer (Ländervorwahl + Nummer, ohne Leerzeichen) und versuche es erneut."
          );
        } else if (code === 429) {
          txt = await tr(
            "WhatsApp is throttling new device links from this network right now (code 429) — wait a few minutes and try again.",
            "WhatsApp drosselt aktuell neue Geräteverknüpfungen aus diesem Netzwerk (Code 429) — warte ein paar Minuten und versuche es erneut."
          );
        } else if (code === 401) {
          txt = await tr(
            "Pairing was refused (code 401) — retry the link in a few seconds.",
            "Pairing abgelehnt (Code 401) — versuche die Verknüpfung in ein paar Sekunden erneut."
          );
        } else if (code) {
          txt = await tr(
            `WhatsApp rejected the connection (code ${code}). If this keeps happening, check the number format and that the person is a registered WhatsApp user, then retry.`,
            `WhatsApp hat die Verbindung abgelehnt (Code ${code}). Falls das weiterhin passiert, prüfe das Nummernformat und dass die Person ein registrierter WhatsApp-Nutzer ist, und versuche es erneut.`
          );
        } else {
          txt = await tr(
            "The WhatsApp connection isn't ready yet — retry the pairing in a few seconds.",
            "Die WhatsApp-Verbindung ist noch nicht bereit — versuche das Pairing in ein paar Sekunden erneut."
          );
        }
        await replyFail(conn, message, txt);
      } else {
        await replyFail(
          conn,
          message,
          await tr(
            `Pairing failed: ${err?.message || "unknown error"}`,
            `Pairing fehlgeschlagen: ${err?.message || "unbekannter Fehler"}`
          )
        );
      }
    }
  }
);

command(
  {
    pattern: "instances",
    fromMe: true,
    desc: "List running sub-sessions (owner)",
    type: "owner",
  },
  async (message, conn) => {
    const live = getSubSessions();
    const index = await getIndexEntries();
    const known = [];
    for (const e of index) {
      const s = live.find((x) => x.number === e.number);
      known.push({
        number: e.number,
        status: s?.status || e.status,
        lastSeen: s?.lastSeen || null,
        suspendReason: e.suspendReason || null,
      });
    }
    for (const s of live) {
      if (!known.some((k) => k.number === s.number)) {
        known.push({ number: s.number, status: s.status, lastSeen: s.lastSeen, suspendReason: null });
      }
    }
    if (!known.length) {
      await replyOk(
        conn,
        message,
        await tr("No Onyx Minis are linked yet.", "Noch keine Onyx Minis verknüpft.")
      );
      return;
    }
    const lines = known.map((s) => {
      const mark =
        s.status === "connected" ? "🟢"
        : s.status === "suspended" ? "⛔"
        : s.status === "failed" || s.status === "forbidden" ? "🔴"
        : s.status === "logged_out" ? "⚪"
        : "🟡";
      let line = `${mark} *${s.number}* — ${s.status}`;
      if (s.status === "suspended" && s.suspendReason) line += ` (${s.suspendReason})`;
      if (s.lastSeen) line += ` — last seen ${new Date(s.lastSeen).toLocaleString()}`;
      return line;
    });
    await reply(
      conn,
      message,
      [
        await tr("*Onyx Minis:*", "*Onyx Minis:*"),
        ...lines,
        await tr(
          `Re-link a dead Mini with \`${BOT_INFO.PREFIX}pair <number>\`; revert a suspension with \`${BOT_INFO.PREFIX}unsuspend <number>\`.`,
          `Verknüpfe eine tote Mini mit \`${BOT_INFO.PREFIX}pair <Nummer>\` erneut; hebe eine Sperre mit \`${BOT_INFO.PREFIX}unsuspend <Nummer>\` auf.`
        ),
      ].join("\n")
    );
  }
);

command(
  {
    pattern: "unpair",
    fromMe: true,
    desc: "Remove a sub-session (owner)",
    type: "owner",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "unpair") || "").trim();
    const target = normalizeNumber(arg);
    if (!target) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}unpair <number>\``,
          `Benutzung: \`${BOT_INFO.PREFIX}unpair <Nummer>\``
        )
      );
      return;
    }
    await removeSubSession(target);
    await replyOk(
      conn,
      message,
      await tr(`Onyx Mini ${target} removed.`, `Onyx Mini ${target} entfernt.`)
    );
  }
);

command(
  {
    pattern: "flags",
    fromMe: true,
    desc: "Show ToS flag history for an Onyx Mini (owner)",
    type: "owner",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "flags") || "").trim();
    const target = normalizeNumber(arg);
    if (!target) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}flags <number>\``,
          `Benutzung: \`${BOT_INFO.PREFIX}flags <Nummer>\``
        )
      );
      return;
    }
    const admin = await getMiniAdmin(target);
    const installed = getSubSessions().find((s) => s.number === target);
    if (!admin.records.length && !installed) {
      await replyOk(
        conn,
        message,
        await tr(
          `No Onyx Mini / flags found for *${target}*.`,
          `Keine Onyx Mini / Flags für *${target}* gefunden.`
        )
      );
      return;
    }
    const status = installed?.status || "—";
    const lines = [
      await tr("*Onyx Mini flags*:", "*Onyx Mini Flags:*"),
      `• ${target} — ${status} (score ${admin.windowScore}/${admin.thresholds.suspend})`,
    ];
    for (const r of admin.records.slice(-8).reverse()) {
      const when = new Date(r.ts).toLocaleString();
      const flag = r.resolved ? "✅" : r.rule === "csam" || r.rule === "illegal_sale" ? "🚨" : "🚩";
      const txt = String(r.text || "").replace(/\n/g, " ").slice(0, 60);
      lines.push(`  ${flag} \`${r.id}\` ${when} · *${r.rule}* (${r.weight})\n    → "${txt}"`);
    }
    if (!admin.records.length) lines.push("  (no pending flags)");
    lines.push(
      "",
      await tr(
        `Use \`${BOT_INFO.PREFIX}resolveflag ${target} <id|all>\` after review.`,
        `Nutze \`${BOT_INFO.PREFIX}resolveflag ${target} <id|all>\` nach der Prüfung.`
      )
    );
    await reply(conn, message, lines.join("\n"));
  }
);

command(
  {
    pattern: "resolveflag",
    fromMe: true,
    desc: "Resolve/clear ToS flags for an Onyx Mini (owner)",
    type: "owner",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "resolveflag") || "").trim();
    const [targetRaw, id] = arg.split(/\s+/);
    const target = normalizeNumber(targetRaw);
    if (!target) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}resolveflag <number> <id|all>\``,
          `Benutzung: \`${BOT_INFO.PREFIX}resolveflag <Nummer> <id|all>\``
        )
      );
      return;
    }
    await clearMiniFlags(target, id || "all");
    await replyOk(
      conn,
      message,
      await tr(
        `Flags for ${target} resolved/cleared.`,
        `Flags für ${target} aufgelöst/gelöscht.`
      )
    );
  }
);

command(
  {
    pattern: "suspend",
    fromMe: true,
    desc: "Suspend an Onyx Mini session (owner, ToS enforcement)",
    type: "owner",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "suspend") || "").trim();
    const [targetRaw, ...rest] = arg.split(/\s+/);
    const target = normalizeNumber(targetRaw);
    if (!target) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}suspend <number> [reason]\``,
          `Benutzung: \`${BOT_INFO.PREFIX}suspend <Nummer> [Grund]\``
        )
      );
      return;
    }
    const reason = rest.join(" ") || (await tr("suspended by operator", "durch die Betreiberin/den Betreiber gesperrt"));
    await suspendSubSession(target, reason);
    await replyOk(
      conn,
      message,
      await tr(
        `Onyx Mini ${target} suspended.${reason ? `\nReason: ${reason}` : ""}`,
        `Onyx Mini ${target} gesperrt.${reason ? `\nGrund: ${reason}` : ""}`
      )
    );
  }
);

command(
  {
    pattern: "unsuspend",
    fromMe: true,
    desc: "Resume a suspended Onyx Mini session (owner)",
    type: "owner",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "unsuspend") || "").trim();
    const target = normalizeNumber(arg);
    if (!target) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}unsuspend <number>\``,
          `Benutzung: \`${BOT_INFO.PREFIX}unsuspend <Nummer>\``
        )
      );
      return;
    }
    await unsuspendSubSession(target);
    await replyOk(
      conn,
      message,
      await tr(
        `Onyx Mini ${target} resumed (reconnecting).`,
        `Onyx Mini ${target} wieder aktiv (verbindet sich erneut).`
      )
    );
  }
);

// Expose respawn for index.js boot wiring
export { respawnSubSession };