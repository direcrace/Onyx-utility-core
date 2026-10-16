

import fs from "fs";
import { detectSupervisor, hardKillSync, killTree, pm2AppName, stopViaPm2, writableDir } from "./platform.js";

const parentPid = Number(process.argv[2] || 0);
const appName = process.argv[3] || "";
const hbPath = process.argv[4] || "";
const staleMs = Number(process.argv[5] || 12_000);
const checkMs = Math.max(500, Number(process.argv[6] || 3000));

function log(msg) {
  try {
    fs.appendFileSync(`${writableDir()}/panic-watchdog.log`, `[${new Date().toISOString()}] ${msg}\n`);
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

function supervisorStop() {
  const app = appName || pm2AppName();
  if (!app || detectSupervisor() !== "pm2") return Promise.resolve(false);
  return stopViaPm2(app).catch(() => false);
}

function hardKill() {
  return killTree(parentPid).catch(() => {
    hardKillSync(parentPid);
    return true;
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
    `WEDGED: parent ${parentPid} alive but heartbeat stale ${Math.round(age)}ms — forcing stop (supervisor=${detectSupervisor()}, app=${appName || "n/a"}).`
  );

  supervisorStop().then((stopped) => {
    if (!stopped) {
      setTimeout(async () => {
        await hardKill();
        log("hard kill issued — leaving.");
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