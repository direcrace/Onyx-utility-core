

import { clearAuthState } from "../database/authState.js";
import config from "../../config.js";
import fs from "fs/promises";

let connection = null;

export function setConnection(conn) {
  connection = conn;
}

async function logout() {
  console.log("\n🔄 Logging out...");

  try {
    if (connection) {
      try {
        await connection.logout();
        console.log("✅ Connection closed");
      } catch (err) {
        console.log("⚠️ Logout socket error:", err?.message || err);
      }
    }

    await clearAuthState();
    console.log("✅ Auth state cleared");
    console.log("✅ Logout complete!\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during logout:", error);
    process.exit(1);
  }
}

async function restart() {
  console.log("\n🔄 Restarting bot...");

  try {
    if (connection) {
      try {
        await connection.end();
        console.log("✅ Connection closed gracefully");
      } catch (error) {
        console.log("⚠️ Connection already closed:", error?.message || error);
      }
    }
    console.log("✅ Restart initiated...\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during restart:", error);
    process.exit(1);
  }
}

async function wipeDatabase() {
  console.log("\n⚠️  DATABASE WIPE INITIATED");

  try {
    await clearAuthState();

    if (!config.USE_POSTGRES && config.SQLITE_PATH) {
      try {
        await fs.unlink(config.SQLITE_PATH);
        await fs.unlink(`${config.SQLITE_PATH}-wal`).catch(() => {});
        await fs.unlink(`${config.SQLITE_PATH}-shm`).catch(() => {});
        console.log(`✅ Removed ${config.SQLITE_PATH}`);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }

    console.log("✅ Database wiped successfully!\n");
    console.log("⚠️  Please restart the bot manually.\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error wiping database:", error);
    process.exit(1);
  }
}

const DEV_HELP = `\n[dev-console] available commands:
  status                     system + mini snapshot
  minis                      list linked Onyx Minis
  minis suspend <n> [reason]
  minis unsuspend <n>
  minis remove <n>
  minis respawn <n>
  flags <n>                  show ToS flags for a mini
  flags clear <n> [id|all]
  logs [count]               tail console output (default 50)
  logsgrep <text>            tail output filtered by text
  sendtest <target> [mini]   send a test message (via main or a mini)
  panic                      trigger a core panic (stops the bot)
  reboot                     restart the process (pm2 auto-restarts)
  shutdown                   pm2 stop (stays off until started)
  Q  logout · R  restart · A  wipe auth database
  help                       show this`;

async function devCommand(line) {
  const c = line.trim().split(/\s+/)[0]?.toLowerCase();

  if (c === "q")  return logout();
  if (c === "a")  return wipeConfirm();
  if (c === "r")  return restart();

  try {
    const { runDevCommandText } = await import("../enterprise/devTerm.js");
    const res = await runDevCommandText(line);
    if (res?.text) console.log("\n" + res.text + "\n");
  } catch (err) {
    console.error(`[terminal] command error: ${err?.message || err}`);
  }
}

async function wipeConfirm() {
  console.log("\n⚠️  WARNING: This will DELETE ALL AUTH DATABASE DATA!");
  console.log("⚠️  Type 'Y' and press Enter to confirm: ");
  process.stdin.once("data", async (confirmData) => {
    const confirm = confirmData.toString().trim().toUpperCase();
    if (confirm === "Y") {
      await wipeDatabase();
    } else {
      console.log("❌ Database wipe cancelled.\n");
    }
  });
}

export function initTerminalHandler() {
  console.log("\n📝 Terminal console enabled:");
  console.log("   Type 'help' + Enter for commands. Shortcuts: Q logout · R restart · A wipe");

  process.stdin.setEncoding("utf8");
  if (process.stdin.isTTY) {
    process.stdin.resume();
  }

  process.stdin.on("data", async (data) => {
    const input = data.toString().trim();
    if (!input) return;
    try {
      await devCommand(input);
    } catch (err) {
      console.error("[terminal] command error:", err?.message || err);
    }
  });

  process.on("SIGINT", async () => {
    console.log("\n👋 Shutting down...");
    if (connection) {
      try {
        await connection.end();
      } catch {

      }
    }
    process.exit(0);
  });
}