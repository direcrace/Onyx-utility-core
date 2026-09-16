

import { exec } from "child_process";
import fs from "fs";

const parentPid = Number(process.argv[2] || 0);
const appName = process.argv[3] || "";
const hbPath = process.argv[4] || "";
const staleMs = Number(process.argv[5] || 12_000);
const checkMs = Math.max(500, Number(process.argv[6] || 3000));

function log(msg) {
  try {
    fs.appendFileSync("panic-watchdog.log", `[${new Date().toISOString()}] ${msg}\n`);
  } catch {  }
}

function isParentAlive() {
  if (!parentPid) return false;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function lastHeartbeat() {
  try {
    return fs.statSync(hbPath).mtimeMs;
  } catch {
    return 0;
  }
}

function pm2Stop() {
  return new Promise((resolve) => {
    if (!appName) return resolve(false);
    exec(`pm2 stop ${appName}`, { windowsHide: true }, (err) => resolve(!err));
  });
}

function hardKill() {
  return new Promise((resolve) => {
    exec(`taskkill /PID ${parentPid} /T /F`, { windowsHide: true }, () =>
      resolve(true)
    );
  });
}

let checking = false;

function check() {
  if (checking) return;
  checking = true;

  if (!isParentAlive()) {
    fs.rmSync(hbPath, { force: true });
    log(`parent ${parentPid} gone — exiting.`);
    process.exit(0);
  }

  const age = Date.now() - lastHeartbeat();
  if (age < staleMs) {
    checking = false;
    return;
  }

  log(
    `WEDGED: parent ${parentPid} alive but heartbeat stale ${Math.round(age)}ms — forcing stop (app=${appName || "pm2-name-unset"}).`
  );

  pm2Stop().then((stopped) => {
    if (!stopped) {

      setTimeout(async () => {
        await hardKill();
        log("taskkill issued — leaving.");
        process.exit(0);
      }, 800);
    } else {

      setTimeout(() => {
        log("pm2 stop issued — leaving.");
        process.exit(0);
      }, 2500);
    }
  });
}

log(`watchdog started for pid ${parentPid} (app=${appName || "?"}, stale=${staleMs}ms, check=${checkMs}ms).`);
setInterval(check, checkMs);