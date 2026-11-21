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
  --prune           Clear growing history/cache keys. Keeps session and settings.
  --reset-settings  Clear every saved setting. Keeps the WhatsApp session.
  --wipedb          Delete the auth database AND every saved setting.
  --restart, -r     Restart the bot via the supervisor (pm2).
  --shutdown, -s    Stop the bot via the supervisor (pm2).
  --status          Offline status: platform, database, stored settings.
  --platform        Show detected host / supervisor / runtime.
  --help, -h        Show this help.

Options:
  --yes, -y         Skip the confirmation prompt (for --auth / --prune / --reset-settings / --wipedb).
  --dry-run         Show what --prune / --reset-settings would remove, touch nothing.
  --local           Limit --prune / --reset-settings to local SQLite settings.
  --external        Limit --prune / --reset-settings to external Postgres settings.
  --app <name>      pm2 app name for --restart / --shutdown.

Examples:
  node clear.js --status
  node clear.js --prune --dry-run
  node clear.js --prune --yes
  node clear.js --reset-settings --yes
  node clear.js --reset-settings --local --yes
  node clear.js --reset-settings --external --yes
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

function printKvRows(rows, label) {
  const sorted = [...rows].sort(
    (a, b) => Buffer.byteLength(b.value || "", "utf8") - Buffer.byteLength(a.value || "", "utf8")
  );
  if (!sorted.length) {
    console.log(`• ${label}: (none stored)`);
    return;
  }
  console.log(`• ${label} (${sorted.length} keys):`);
  for (const row of sorted) {
    const size = Buffer.byteLength(row.value || "", "utf8");
    console.log(`   - ${row.key} · ${size} B`);
  }
}

function maskUrl(url) {
  return String(url).replace(/\/\/[^@/]*@/, "//***@");
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
    printKvRows(kv, "Settings");
  } catch (err) {
    console.log(`• Could not read database: ${err?.message || err}`);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function postgresStatus() {
  console.log(`• Postgres: ${maskUrl(config.DATABASE_URL)}`);
  console.log("• Credentials: start the bot for live credential status.");
  try {
    const { inspectBotKv } = await import("./src/database/kvMaintenance.js");
    const snapshot = await inspectBotKv();
    printKvRows(snapshot.rows, "Remote settings");
    if (snapshot.localRows.length) printKvRows(snapshot.localRows, "Local cache");
  } catch (err) {
    console.log(`• Could not read Postgres settings: ${err?.message || err}`);
  }
}

async function statusAction() {
  printPlatform();
  console.log("");
  console.log("🗄️  Database");
  if (config.USE_POSTGRES) {
    await postgresStatus();
    if (config.HYBRID_ENABLED) {
      console.log("• Mode: hybrid (session local, settings Postgres first)");
      console.log(`• Local session DB: ${config.LOCAL_DB_PATH}`);
    }
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

async function kvMaintenanceAction(opts, mode) {
  const dryRun = has(opts, "--dry-run");
  const local = has(opts, "--local");
  const external = has(opts, "--external");
  const { pruneBotKv } = await import("./src/database/kvMaintenance.js");
  const label = mode === "reset" ? "every saved setting" : "growing history/cache keys";
  const scope = local && !external
    ? "local SQLite only"
    : external && !local
      ? "external Postgres only"
      : "both backends";

  if (external && !local && !config.USE_POSTGRES) {
    console.log("ℹ️  No external Postgres backend configured — nothing to do.");
    return;
  }

  if (!dryRun && !has(opts, "--yes", "-y")) {
    console.log(`⚠️  This clears ${label} (${scope}). The WhatsApp session is kept.`);
    if (!(await confirm(mode === "reset" ? "Reset all settings?" : "Prune cache keys?"))) {
      console.log("Cancelled.");
      process.exitCode = 1;
      return;
    }
  }

  const result = await pruneBotKv({ resetAll: mode === "reset", dryRun, local, external });
  if (dryRun) {
    console.log(`🔍 Dry run (${scope}) — ${result.targets.length} key(s) would be removed, ${result.kept.length} kept.`);
    for (const key of result.targets) console.log(`   - ${key}`);
    console.log("ℹ️  Nothing was written.");
    return;
  }

  console.log(
    `✅ Removed ${result.targets.length} setting key(s) (${scope}; remote: ${result.removedRemote}, local: ${result.removedLocal}).`
  );
  console.log("ℹ️  WhatsApp session untouched. Restart the bot to apply defaults.");
}

async function wipeAction(opts) {
  if (config.USE_POSTGRES) {
    if (!has(opts, "--yes", "-y")) {
      console.log("⚠️  This clears the auth state.");
      if (!(await confirm("Wipe the auth state?"))) {
        console.log("Cancelled.");
        process.exitCode = 1;
        return;
      }
    }
    const { clearAuthState } = await import("./src/database/authState.js");
    await clearAuthState();
    console.log("✅ Auth state cleared (BotKV settings are left untouched).");
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
  if (has(opts, "--prune")) return kvMaintenanceAction(opts, "prune");
  if (has(opts, "--reset-settings")) return kvMaintenanceAction(opts, "reset");
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
