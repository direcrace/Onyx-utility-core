import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import connect from "./src/socket/connection.js";
import { commands } from "./src/plugins.js";
import { installSignalHandlers } from "./src/terminal/handler.js";
import { useMultiDbAuthState, checkAuthCreds } from "./src/database/authState.js";
import config from "./config.js";
import { installConsoleRing } from "./src/utils/consoleRing.js";
import { describe, hasFfmpeg } from "./src/system/platform.js";

global.__basedir = path.resolve();
installConsoleRing();

const readAndRequireFiles = async (directory) => {
  try {
    const files = await fs.readdir(directory);
    const jsFiles = files.filter((file) => file.endsWith(".js"));
    await Promise.all(
      jsFiles.map((file) => import(pathToFileURL(path.join(directory, file)).href))
    );
  } catch (error) {
    console.error("Error loading files:", error);
    throw error;
  }
};

const initialize = async () => {
  console.log("\n╔══════════════════════════════╗");
  console.log("║    ONYX UTILITY CORE v5.0.4  ║");
  console.log("║   Baileys 7.0.0-rc13         ║");
  console.log("╚══════════════════════════════╝\n");

  try {

    const plat = describe();
    console.log(
      `🌐 Platform: ${plat.platform}/${plat.arch} · node ${plat.node} · supervisor ${plat.supervisorLabel} (${plat.containerHint}) · tty ${plat.tty ? "yes" : "no"}`
    );

    console.log(
      config.USE_POSTGRES
        ? "⏳ Initializing Postgres auth..."
        : `⏳ Initializing SQLite auth (${config.SQLITE_PATH})...`
    );
    await useMultiDbAuthState();

    try {
      if (!(await hasFfmpeg())) {
        console.warn(
          "⚠️  FFmpeg not found on PATH — #ytmp3 / #tomp3 / voice effects / video stickers will fail."
        );
        console.warn("    Debian/Ubuntu: apt-get install -y ffmpeg · Alpine: apk add ffmpeg");
      }
    } catch {  }

    try {
      const { loadRuntimeConfig } = await import("./src/config/constants.js");
      const rc = await loadRuntimeConfig();
      if (rc.botName !== (process.env.BOT_NAME || "ONYX UTILITY CORE")) {
        console.log(`ℹ️  Bot name: ${rc.botName} · prefix: ${rc.prefix}`);
      }
    } catch (err) {
      console.warn("Runtime config load failed:", err?.message || err);
    }

    try {
      const { hydrateRoleNumbers } = await import("./src/utils/access.js");
      const roles = await hydrateRoleNumbers();
      if (roles.owners.length) console.log(`ℹ️  Owners loaded: ${roles.owners.length} · creators: ${roles.creators.length}`);
    } catch (err) {
      console.warn("Role hydration failed:", err?.message || err);
    }

    const credsCheck = await checkAuthCreds();
    if (credsCheck.hasCreds) {
      console.log("✅ Credentials found");
    } else if (process.env.PAIRING_NUMBER) {
      console.log(
        `ℹ️  No credentials — pairing code login (${process.env.PAIRING_NUMBER.replace(/\D/g, "")})`
      );
    } else {
      console.log(
        "ℹ️  No credentials — QR login (or set PAIRING_NUMBER for code login)"
      );
    }

    await readAndRequireFiles(path.join(global.__basedir, "src/plugins"));
    console.log(`✅ ${commands.length} Plugins Loaded!`);

    installSignalHandlers();

    console.log(
      "ℹ️  Control: chat `.reboot` `.logout` `.wipedb` (owner) · web dashboard · maintenance CLI: `node clear.js --help`"
    );

    try {
      const { startAdminHttp } = await import("./src/enterprise/adminHttp.js");
      startAdminHttp();
    } catch (err) {
      console.warn("Admin HTTP not started:", err?.message || err);
    }

    console.log("⏳ Connecting to WhatsApp...\n");
    await connect();

    try {
      const { respawnAllSubSessions } = await import(
        "./src/multi/sessionManager.js"
      );
      const restored = await respawnAllSubSessions();
      if (restored.length) {
        console.log(`♻️ Restored ${restored.length} persisted sub-session(s)`);
      }
    } catch (err) {
      console.error("Sub-session restore failed:", err?.message || err);
    }

    try {
      const { startCorePanicMonitor } = await import(
        "./src/system/corePanic.js"
      );
      await startCorePanicMonitor();
    } catch (err) {
      console.warn("Core panic monitor start failed:", err?.message || err);
    }

    try {
      const { startSystemMonitor } = await import(
        "./src/system/systemWatch.js"
      );
      startSystemMonitor();
    } catch (err) {
      console.warn("System watch start failed:", err?.message || err);
    }
  } catch (error) {
    console.error("❌ Initialization error:", error);
    process.exit(1);
  }
};

initialize();
