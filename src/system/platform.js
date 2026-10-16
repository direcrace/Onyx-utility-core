import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const IS_WINDOWS = process.platform === "win32";

let pm2AppCache;
let pm2BinCache;

export function isWindows() {
  return IS_WINDOWS;
}

export function pm2AppName() {
  if (pm2AppCache !== undefined) return pm2AppCache;
  pm2AppCache =
    process.env.PM2_APP_NAME ||
    process.env.name ||
    (process.env.PM2_ID ? `pm${process.env.PM2_ID}` : "") ||
    "";
  return pm2AppCache;
}

export function hasPm2Env() {
  return !!process.env.PM2_APP_NAME || !!process.env.PM2_ID || !!process.env.pm_id || !!process.env.name;
}

export function hasTty() {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

export function isDocker() {
  if (process.env.ONYX_IN_DOCKER === "1") return true;
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

export function isPterodactyl() {
  return !!(
    process.env.PTERODACTYL ||
    process.env.SERVER_JARFILE ||
    (process.env.HOSTNAME && /^[a-f0-9]{16}$/i.test(process.env.HOSTNAME))
  );
}

export function isSystemd() {
  return !!process.env.INVOCATION_ID || !!process.env.SYSTEMD_EXEC_PID;
}

export function detectSupervisor() {
  if (hasPm2Env()) return "pm2";
  if (isPterodactyl()) return "panel";
  if (isDocker()) return "docker";
  if (isSystemd()) return "systemd";
  return "none";
}

export function supervisorLabel() {
  switch (detectSupervisor()) {
    case "pm2":
      return "PM2";
    case "panel":
      return "Hosting-Panel";
    case "docker":
      return "Docker";
    case "systemd":
      return "systemd";
    default:
      return "none";
  }
}

export function canStayStopped() {
  if (detectSupervisor() === "pm2") return true;
  if (isSystemd()) return true;
  return false;
}

export function canAutoRestart() {
  return detectSupervisor() !== "none";
}

function pm2Command() {
  if (pm2BinCache !== undefined) return pm2BinCache;
  pm2BinCache = IS_WINDOWS ? "pm2.cmd" : "pm2";
  return pm2BinCache;
}

export function runCommand(cmd, { timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code ?? 1 : 0, stdout: stdout || "", stderr: stderr || "", error: err?.message || null });
    });
  });
}

export async function pm2Available() {
  if (!hasPm2Env()) return false;
  const res = await runCommand(`${pm2Command()} ping`);
  return res.ok;
}

export function killTreeSync(pid, { signal = "SIGKILL" } = {}) {
  const target = Number(pid);
  if (!target || target <= 1) return false;
  if (target === process.pid) return false;

  if (IS_WINDOWS) {
    try {
      exec(`taskkill /PID ${target} /T /F`, { windowsHide: true }, () => {});
      return true;
    } catch {
      return false;
    }
  }

  try {
    process.kill(-target, signal);
    return true;
  } catch {
    try {
      process.kill(target, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export function hardKillSync(pid) {
  return killTreeSync(pid, { signal: "SIGKILL" });
}

export function killTree(pid) {
  const target = Number(pid);
  if (!target || target <= 1) return Promise.resolve(false);
  if (target === process.pid) return Promise.resolve(false);
  if (IS_WINDOWS) {
    return runCommand(`taskkill /PID ${target} /T /F`).then(() => true);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    try {
      process.kill(-target, "SIGKILL");
      finish(true);
      return;
    } catch {  }
    try {
      process.kill(target, "SIGKILL");
      finish(true);
      return;
    } catch {  }
    setTimeout(() => finish(false), 400);
  });
}

export function forceSelfKill() {
  if (IS_WINDOWS) {
    try {
      exec(`taskkill /PID ${process.pid} /T /F`, { windowsHide: true }, () => {});
    } catch {  }
  } else {
    try {
      process.kill(process.pid, "SIGKILL");
    } catch {  }
  }
  setTimeout(() => process.exit(1), 1500).unref?.();
  return true;
}

export async function stopViaPm2(appName) {
  const app = appName || pm2AppName();
  if (!app) return false;
  const res = await runCommand(`${pm2Command()} stop ${app}`, { timeout: 15_000 });
  return res.ok;
}

export async function restartViaPm2(appName) {
  const app = appName || pm2AppName();
  if (!app) return false;
  const res = await runCommand(`${pm2Command()} restart ${app}`, { timeout: 20_000 });
  return res.ok;
}

export async function stopService({ exitCode = 0, delayMs = 0 } = {}) {
  const app = pm2AppName();
  if (app && detectSupervisor() === "pm2") {
    const ok = await stopViaPm2(app);
    if (ok) return { via: "pm2", ok: true };
    console.warn(`[platform] pm2 stop ${app} failed — exiting so the supervisor can act.`);
  }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  process.exit(exitCode);
  return { via: "exit", ok: true };
}

export async function restartService({ delayMs = 500 } = {}) {
  const app = pm2AppName();
  if (app && detectSupervisor() === "pm2") {
    const ok = await restartViaPm2(app);
    if (ok) return { via: "pm2", ok: true };
  }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  process.exit(0);
  return { via: "exit", ok: true };
}

let ffmpegCache;

export async function ffmpegPath() {
  if (ffmpegCache !== undefined) return ffmpegCache;
  const candidates = [];
  const fromEnv = String(process.env.FFMPEG_PATH || "").trim();
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg");

  for (const bin of candidates) {
    const res = await runCommand(`${bin.includes(" ") ? `"${bin}"` : bin} -version`, { timeout: 6000 });
    if (res.ok) {
      ffmpegCache = bin;
      return ffmpegCache;
    }
  }
  ffmpegCache = null;
  return ffmpegCache;
}

export async function hasFfmpeg() {
  return !!(await ffmpegPath());
}

export async function ffmpegVersion() {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const res = await runCommand(`${bin.includes(" ") ? `"${bin}"` : bin} -version`, { timeout: 6000 });
  const first = String(res.stdout || "").split("\n")[0] || "";
  return first.trim() || null;
}

export function writableDir(preferred) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  candidates.push(process.cwd());
  try {
    candidates.push(path.join(process.cwd(), "logs"));
  } catch {  }
  candidates.push(os.tmpdir());

  for (const dir of candidates) {
    try {
      if (!dir) continue;
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.onyx-write-probe-${process.pid}`);
      fs.writeFileSync(probe, "ok");
      fs.rmSync(probe, { force: true });
      return dir;
    } catch {  }
  }
  return os.tmpdir();
}

export function logFilePath(name) {
  const dir = process.env.ONYX_LOG_DIR || writableDir();
  return path.join(dir, name);
}

export function describe() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    supervisor: detectSupervisor(),
    supervisorLabel: supervisorLabel(),
    pm2App: pm2AppName(),
    canStayStopped: canStayStopped(),
    canAutoRestart: canAutoRestart(),
    docker: isDocker(),
    pterodactyl: isPterodactyl(),
    systemd: isSystemd(),
    tty: hasTty(),
    pid: process.pid,
    cwd: process.cwd(),
    homedir: (() => {
      try {
        return os.homedir();
      } catch {
        return null;
      }
    })(),
    containerHint: isPterodactyl()
      ? "panel"
      : isDocker()
        ? "docker"
        : isSystemd()
          ? "systemd"
          : hasPm2Env()
            ? "pm2"
            : "bare",
  };
}