#!/usr/bin/env node
import fs from "fs/promises";
import readline from "readline/promises";
import config from "./config.js";
import {
  describe,
  detectSupervisor,
  pm2AppName,
  restartViaPm2,
  stopViaPm2,
  hasPm2Env,
} from "./src/system/platform.js";

const HELP = `
Onyx Utility Core — maintenance CLI

Usage: node clear.js <command> [options]

Commands:
  --auth, -a        Clear the WhatsApp auth state (keeps settings). Re-pair required.
  --wipedb          Delete the auth database AND every saved setting.
  --restart, -r     Restart the bot via the supervisor (pm2).
  --shutdown, -s    Stop the bot via the supervisor (pm2).
  --status          Offline status: platform, database, stored settings.
  --platform        Show detected host / supervisor / runtime.
  --help, -h        Show this help.

Options:
  --yes, -y         Skip the confirmation prompt (for --auth / --wipedb).
  --app <name>      pm2 app name for --restart / --shutdown.

Examples:
  node clear.js --auth
  node clear.js --wipedb --yes
  node clear.js --restart --app onyx
`.trim();

function parseArgs(argv) {
  const opts = { flags: new Set(), app: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app") {
      opts.app = argv[++i] || "";
      continue;
    }
    if (a.startsWith("--app=")) {
      opts.app = a.slice("--app=".length);
      continue;
    }
    opts.flags.add(a);
  }
  return opts;
}

function has(opts, ...names) {
  return names.some((n) => opts.flags.has(n));
}

async function confirm(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("❌ No TTY available for confirmation — re-run with --yes to proceed.");
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} Type 'yes' to confirm: `))
      .trim()
      .toLowerCase();
    return answer === "yes" || answer === "y";
  } finally {
    rl.close();
  }
}

function printPlatform() {
  const d = describe();
  console.log("🖥️  Runtime");
  console.log(`• Platform: ${d.platform}/${d.arch} · node ${d.node}`);
  console.log(`• Supervisor: ${d.supervisorLabel} (${d.supervisor})`);
  console.log(`• Container: ${d.containerHint}`);
  console.log(`• Auto-restart: ${d.canAutoRestart ? "yes" : "no"} · stay-stopped: ${d.canStayStopped ? "yes" : "no"}`);
  console.log(`• TTY: ${d.tty ? "yes" : "no"}`);
  console.log(`• cwd: ${d.cwd}`);
  console.log(`• home: ${d.homedir || "n/a"}`);
}

async function sqliteStatus() {
  const dbPath = config.SQLITE_PATH;
  console.log(`• SQLite: ${dbPath}`);
  try {
    await fs.access(dbPath);
  } catch {
    console.log("• Not created yet (no database file).");
    return;
  }

  let db;
  try {
    const { default: Database } = await import("better-sqlite3");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const authRows = db.prepare("SELECT COUNT(*) AS n FROM AuthState").get()?.n ?? 0;
    const hasCreds = !!db
      .prepare("SELECT 1 AS ok FROM AuthState WHERE key = ? LIMIT 1")
      .get("creds.json");
    console.log(`• Credentials: ${hasCreds ? "present ✅" : "none (pairing required)"}`);
    console.log(`• Auth rows: ${authRows}`);

    let kv = [];
    try {
      kv = db.prepare("SELECT key, value FROM BotKV ORDER BY key").all();
    } catch {}
    if (kv.length) {
      console.log("• Settings:");
      for (const row of kv) {
        let val = row.value;
        try {
          val = JSON.stringify(JSON.parse(row.value));
        } catch {}
        if (typeof val === "string" && val.length > 90) val = `${val.slice(0, 87)}...`;
        console.log(`   - ${row.key} = ${val}`);
      }
    } else {
      console.log("• Settings: (none stored)");
    }
  } catch (err) {
    console.log(`• Could not read database: ${err?.message || err}`);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function statusAction() {
  printPlatform();
  console.log("");
  console.log("🗄️  Database");
  if (config.USE_POSTGRES) {
    console.log("• Postgres (USE_POSTGRES=true) — start the bot for live credential status.");
  } else {
    await sqliteStatus();
  }
}

async function authAction(opts) {
  if (!has(opts, "--yes", "-y")) {
    console.log("⚠️  This clears the WhatsApp session. You will have to pair again.");
    if (!(await confirm("Clear the auth state?"))) {
      console.log("Cancelled.");
      process.exitCode = 1;
      return;
    }
  }
  const { clearAuthState } = await import("./src/database/authState.js");
  await clearAuthState();
  console.log("✅ Auth state cleared. Restart the bot and pair again.");
}

async function wipeAction(opts) {
  if (config.USE_POSTGRES) {
    if (!has(opts, "--yes", "-y")) {
      console.log("⚠️  This clears the Postgres auth state.");
      if (!(await confirm("Wipe the auth state?"))) {
        console.log("Cancelled.");
        process.exitCode = 1;
        return;
      }
    }
    const { clearAuthState } = await import("./src/database/authState.js");
    await clearAuthState();
    console.log("✅ Postgres auth state cleared (BotKV settings are left untouched).");
    return;
  }

  if (!has(opts, "--yes", "-y")) {
    console.log("⚠️  This deletes the auth database AND every saved setting");
    console.log("    (wallets, reminders, notes, mode, language, ...).");
    if (!(await confirm("Wipe the database?"))) {
      console.log("Cancelled.");
      process.exitCode = 1;
      return;
    }
  }

  const targets = [
    config.SQLITE_PATH,
    `${config.SQLITE_PATH}-wal`,
    `${config.SQLITE_PATH}-shm`,
  ];
  const removed = [];
  for (const p of targets) {
    try {
      await fs.unlink(p);
      removed.push(p);
    } catch (err) {
      if (err.code !== "ENOENT") console.log(`⚠️  Could not remove ${p}: ${err.message}`);
    }
  }

  if (removed.length) {
    console.log(`✅ Removed ${removed.length} file(s):`);
    for (const p of removed) console.log(`   - ${p}`);
  } else {
    console.log("ℹ️  Nothing to remove (database already absent).");
  }
  console.log("Restart the bot to pair again.");
}

async function supervisorAction(opts, kind) {
  const app = opts.app || pm2AppName();
  if (!hasPm2Env() && detectSupervisor() !== "pm2") {
    console.log("ℹ️  No PM2 supervisor detected — this can only be done from the running bot.");
    console.log("   Chat: `.reboot` / `.shutdown` · Panel: Restart/Stop button · systemd: `systemctl restart <unit>`");
    process.exitCode = 1;
    return;
  }
  if (!app) {
    console.log("⚠️  pm2 app name unknown — pass --app <name> (or set PM2_APP_NAME).");
    process.exitCode = 1;
    return;
  }

  const ok = kind === "restart" ? await restartViaPm2(app) : await stopViaPm2(app);
  console.log(
    ok
      ? `✅ pm2 ${kind} "${app}" succeeded.`
      : `❌ pm2 ${kind} "${app}" failed.`
  );
  process.exitCode = ok ? 0 : 1;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.flags.size || has(opts, "--help", "-h")) {
    console.log(HELP);
    return;
  }

  if (has(opts, "--auth", "-a")) return authAction(opts);
  if (has(opts, "--wipedb")) return wipeAction(opts);
  if (has(opts, "--restart", "-r")) return supervisorAction(opts, "restart");
  if (has(opts, "--shutdown", "-s")) return supervisorAction(opts, "shutdown");
  if (has(opts, "--status")) return statusAction();
  if (has(opts, "--platform")) return printPlatform();

  console.error(`Unknown command. Run \`node clear.js --help\` for usage.`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("❌ clear.js error:", err?.message || err);
  process.exitCode = 1;
});
