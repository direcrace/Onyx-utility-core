/**
 * First-run / setup wizard — runs in the system log group only
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { getLogGroupJid, isSetupDone, markSetupDone, systemLog } from "../utils/logGroup.js";
import { getMode, setMode, getOwnerNumbers } from "../utils/access.js";
import { getLang, setLang, AVAILABLE_LANGS } from "../utils/i18n.js";
import { kvGet as kvGetRaw, kvSet as kvSetRaw } from "../database/botKv.js";
import { BOT_INFO, MEDIA } from "../config/constants.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const STEP_KEY = "setup_step";

export async function getSetupStep() {
  return (await kvGet(STEP_KEY)) || "idle";
}

export async function setSetupStep(step) {
  await kvSet(STEP_KEY, step);
}

export async function checkFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "ffmpeg not found" };
  }
}

/**
 * Post welcome + checklist into log group after connect
 */
export async function startOnboardingIfNeeded(conn) {
  const logJid = await getLogGroupJid();
  if (!logJid) return;

  const done = await isSetupDone();
  const ff = await checkFfmpeg();

  if (!ff.ok) {
    await systemLog(
      "warn",
      "FFmpeg not on PATH — #ytmp3 / #tomp3 / video stickers will fail.",
      ff.error
    );
  } else {
    await systemLog("info", "FFmpeg OK");
  }

  if (done) {
    await systemLog(
      "success",
      `${BOT_INFO.NAME} online · mode=${await getMode()} · lang=${await getLang()}`
    );
    return;
  }

  await setSetupStep("await_start");
  const owners = getOwnerNumbers().join(", ") || "_(not set — set OWNER_NUMBER)_";

  await conn.sendMessage(logJid, {
    text:
      `👋 *Welcome to ${BOT_INFO.NAME}*\n\n` +
      `This is your *system / log group*.\n` +
      `• Setup & diagnostics stay *here*\n` +
      `• Other chats only see friendly replies (no stack traces)\n\n` +
      `*Owner(s):* ${owners}\n` +
      `*FFmpeg:* ${ff.ok ? "✅" : "❌ missing"}\n\n` +
      `Run \`${BOT_INFO.PREFIX}setup\` to start the wizard.\n` +
      `Or \`${BOT_INFO.PREFIX}setup skip\` to mark setup done.`,
  });
}

/**
 * Handle #setup conversation inside log group
 */
export async function runSetupCommand(message, conn, args) {
  const logJid = await getLogGroupJid();
  if (!logJid || message.from !== logJid) {
    return {
      ok: false,
      text:
        `Setup runs only in the *system log group*.\n` +
        `Use \`${BOT_INFO.PREFIX}createlog\` / \`${BOT_INFO.PREFIX}setlog\` first, then run setup there.`,
    };
  }

  const raw = (args || "").trim().toLowerCase();

  if (raw === "skip" || raw === "done") {
    await markSetupDone(true);
    await setSetupStep("done");
    return {
      ok: true,
      text: `✅ Setup marked complete. Use \`${BOT_INFO.PREFIX}menu\` anywhere.`,
    };
  }

  if (raw === "reset") {
    await markSetupDone(false);
    await setSetupStep("owner");
    return {
      ok: true,
      text: "Setup reset. Continuing wizard…",
      continue: true,
    };
  }

  if (!raw || raw === "start") {
    await setSetupStep("owner");
  }

  const step = await getSetupStep();
  return advanceWizard(message, conn, step, raw);
}

async function advanceWizard(message, conn, step, raw) {
  const p = BOT_INFO.PREFIX;

  if (step === "idle" || step === "await_start" || step === "owner") {
    const owners = getOwnerNumbers();
    if (!owners.length && raw && /^\d{8,15}$/.test(raw)) {
      // Persist owner into BotKV note — env still preferred; store botkv owner_override
      await kvSetRaw("owner_override", raw);
      process.env.OWNER_NUMBER = raw;
      BOT_INFO.OWNER = raw;
    }

    const haveOwner = getOwnerNumbers().length > 0 || (await kvGetRaw("owner_override"));
    if (!haveOwner && (!raw || raw === "start")) {
      await setSetupStep("owner");
      return {
        ok: true,
        text:
          `*Step 1/4 — Owner*\n` +
          `Set \`OWNER_NUMBER\` in \`.env\` *or* reply:\n` +
          `\`${p}setup 9198XXXXXXXX\` (country code + number)\n\n` +
          `Current: _(none)_`,
      };
    }

    await setSetupStep("mode");
    return {
      ok: true,
      text:
        `✅ Owner noted.\n\n*Step 2/4 — Mode*\n` +
        `Reply:\n• \`${p}setup public\` — anyone can use commands\n` +
        `• \`${p}setup private\` — owner + sudo only\n\n` +
        `Current: *${await getMode()}*`,
    };
  }

  if (step === "mode") {
    if (raw === "public" || raw === "private") {
      await setMode(raw);
    } else if (raw && raw !== "start") {
      return {
        ok: false,
        text: `Reply \`${p}setup public\` or \`${p}setup private\``,
      };
    } else {
      return {
        ok: true,
        text:
          `*Step 2/4 — Mode*\n\`${p}setup public\` or \`${p}setup private\`\nCurrent: *${await getMode()}*`,
      };
    }
    await setSetupStep("lang");
    return {
      ok: true,
      text:
        `✅ Mode: *${await getMode()}*\n\n*Step 3/4 — Language*\n` +
        `Reply \`${p}setup en\` | \`de\`\n` +
        `Available: ${AVAILABLE_LANGS.join(", ")}\nCurrent: *${await getLang()}*`,
    };
  }

  if (step === "lang") {
    if (AVAILABLE_LANGS.includes(raw)) {
      await setLang(raw);
    } else if (raw && !["start", "public", "private"].includes(raw)) {
      return {
        ok: false,
        text: `Pick a language: ${AVAILABLE_LANGS.join(", ")}`,
      };
    } else if (!AVAILABLE_LANGS.includes(raw)) {
      return {
        ok: true,
        text: `*Step 3/4 — Language*\n\`${p}setup en|de\`\nCurrent: *${await getLang()}*`,
      };
    }
    await setSetupStep("exif");
    return {
      ok: true,
      text:
        `✅ Lang: *${await getLang()}*\n\n*Step 4/4 — Sticker pack*\n` +
        `Reply \`${p}setup PackName|Author\`\n` +
        `Or \`${p}setup skip\` to keep defaults (*${MEDIA.STICKER_PACKNAME}* / *${MEDIA.STICKER_AUTHOR}*)`,
    };
  }

  if (step === "exif") {
    if (raw && raw !== "skip" && raw.includes("|")) {
      const [pack, author] = raw.split("|").map((s) => s.trim());
      if (pack) await kvSetRaw("sticker_packname", pack);
      if (author) await kvSetRaw("sticker_author", author);
    }
    await markSetupDone(true);
    await setSetupStep("done");
    const pack = (await kvGetRaw("sticker_packname")) || MEDIA.STICKER_PACKNAME;
    const author = (await kvGetRaw("sticker_author")) || MEDIA.STICKER_AUTHOR;
    return {
      ok: true,
      text:
        `✅ *Setup complete!*\n\n` +
        `• Mode: *${await getMode()}*\n` +
        `• Lang: *${await getLang()}*\n` +
        `• Stickers: *${pack}* / *${author}*\n\n` +
        `*Try next:*\n` +
        `• \`${p}ping\`\n• \`${p}menu\`\n• \`${p}status\`\n` +
        `• In a user group: \`${p}groupsetup\`\n\n` +
        `_System errors will only appear in this group._`,
    };
  }

  return {
    ok: true,
    text: `Setup idle. Run \`${p}setup\` to begin or \`${p}setup reset\`.`,
  };
}
