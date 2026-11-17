

import os from "os";
import fs from "fs/promises";
import { isWatchEnabled } from "./watchSwitch.js";

const CFG = {
  intervalMs: Math.max(5000, Number(process.env.SYSTEM_WATCH_INTERVAL_MS) || 15_000),
  cpuWarn: Number(process.env.SYSTEM_WATCH_CPU_WARN) || 70,
  cpuPanic: Number(process.env.SYSTEM_WATCH_CPU_PANIC) || 160,
  hostCpuWarn: Number(process.env.SYSTEM_WATCH_HOST_CPU_WARN) || 92,
  ramWarn: Number(process.env.SYSTEM_WATCH_RAM_WARN) || 90,
  ramPanic: Number(process.env.SYSTEM_WATCH_RAM_PANIC) || 99,
  diskWarnMb: Number(process.env.SYSTEM_WATCH_DISK_WARN_MB) || 1024,
  diskPanicMb: Number(process.env.SYSTEM_WATCH_DISK_PANIC_MB) || 300,
  rssWarnMb: Number(process.env.SYSTEM_WATCH_RSS_WARN_MB) || 1000,
  sustained: Math.max(1, Number(process.env.SYSTEM_WATCH_SUSTAINED) || 3),
  cooldownMs: Number(process.env.SYSTEM_WATCH_COOLDOWN_MS) || 5 * 60_000,
};

let timer = null;
let running = false;
let hasRun = false;
const streak = {};
const lastReported = {};

function gb(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

function mb(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

async function hostCpuPercent() {
  const t1 = os.cpus();
  const idle1 = t1.reduce((a, c) => a + c.times.idle, 0);
  const total1 = t1.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
  await new Promise((r) => setTimeout(r, 200));
  const t2 = os.cpus();
  const idle2 = t2.reduce((a, c) => a + c.times.idle, 0);
  const total2 = t2.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
  const dt = total2 - total1;
  if (dt <= 0) return 0;
  return Math.round((1 - (idle2 - idle1) / dt) * 1000) / 10;
}

async function processCpuPercent() {
  const pass = () => ({
    cpu: process.cpuUsage(),
    wall: process.hrtime.bigint(),
  });

  await new Promise((r) => setTimeout(r, 120));
  const c1 = pass();
  {
    let x = 0;
    for (let i = 0; i < 200_000; i++) x += Math.sqrt(i);
  }
  await new Promise((r) => setTimeout(r, 120));
  const c2 = pass();

  const cpuDeltaMs =
    (c2.cpu.user - c1.cpu.user + (c2.cpu.system - c1.cpu.system)) / 1000;
  const wallDeltaMs = Number(c2.wall - c1.wall) / 1e6;
  if (!wallDeltaMs || wallDeltaMs <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((cpuDeltaMs / wallDeltaMs) * 1000) / 10));
}

async function diskFree() {
  try {
    const base = global.__basedir || process.cwd();
    const s = await fs.statfs(base);
    const freeMbTotal = Math.floor((s.bavail * s.bsize) / 1024 / 1024);
    const totalMb = Math.floor((s.blocks * s.bsize) / 1024 / 1024);
    return {
      freeMb: freeMbTotal,
      totalMb,
      freePct: totalMb ? Math.round((s.bavail / s.blocks) * 1000) / 10 : 0,
    };
  } catch {
    return null;
  }
}

let snapCache = { at: 0, p: null };
const SNAP_TTL_MS = 900;

async function measureHost() {
  const mem = {
    totalG: gb(os.totalmem()),
    freeG: gb(os.freemem()),
    usedPct: Math.round((1 - os.freemem() / os.totalmem()) * 1000) / 10,
  };
  const [hostCpuPct, procCpuPct, disk, rssMb, heapMb] = await Promise.all([
    hostCpuPercent(),
    processCpuPercent(),
    diskFree(),
    Promise.resolve(mb(process.memoryUsage().rss)),
    Promise.resolve(mb(process.memoryUsage().heapUsed)),
  ]);
  return {
    at: Date.now(),
    cpuPct: procCpuPct,
    hostCpuPct,
    mem,
    rssMb,
    heapMb,
    disk,
    uptimeSec: Math.floor(process.uptime()),
    pid: process.pid,
    pm2App: process.env.name || process.env.PM2_APP_NAME || "",
  };
}

export function hostSnapshot() {
  const now = Date.now();
  if (snapCache.p && now - snapCache.at < SNAP_TTL_MS) return snapCache.p;
  const p = measureHost().catch((err) => {
    snapCache = { at: 0, p: null };
    throw err;
  });
  snapCache = { at: now, p };
  return p;
}

export function getSystemWatchStatus() {
  return {
    enabled: running && isWatchEnabled("systemwatch"),
    runtimeSwitch: isWatchEnabled("systemwatch"),
    intervalMs: CFG.intervalMs,
    cpuWarn: CFG.cpuWarn,
    cpuPanic: CFG.cpuPanic,
    hostCpuWarn: CFG.hostCpuWarn,
    ramWarn: CFG.ramWarn,
    ramPanic: CFG.ramPanic,
    diskWarnMb: CFG.diskWarnMb,
    diskPanicMb: CFG.diskPanicMb,
    rssWarnMb: CFG.rssWarnMb,
    sustained: CFG.sustained,
  };
}

const RULE_ID = (rule) => `${rule}`;

function resetStreak(rule) {
  streak[RULE_ID(rule)] = 0;
}

function bumpStreak(rule) {
  const id = RULE_ID(rule);
  streak[id] = (streak[id] || 0) + 1;
  return streak[id];
}

function withinCooldown(rule) {
  const id = RULE_ID(rule);
  const t = lastReported[id];
  return t && Date.now() - t < CFG.cooldownMs;
}

async function evaluate(snapshot) {
  const active = [];

  const cpu = snapshot.cpuPct;
  if (cpu >= CFG.cpuPanic) {
    if (bumpStreak("cpu") >= CFG.sustained) {
      active.push({
        rule: "cpu",
        level: "panic",
        text: `🤖 Bot process pinned at ${cpu}% (panic ${CFG.cpuPanic}% · sustained ${CFG.sustained}×) — core panic.`,
      });
      resetStreak("cpu");
    }
  } else if (cpu >= CFG.cpuWarn) {
    if (bumpStreak("cpu") >= CFG.sustained && !withinCooldown("cpu")) {
      active.push({
        rule: "cpu",
        level: "warn",
        text: `🤖 Bot process CPU at ${cpu}% (warn ${CFG.cpuWarn}%) — sustained.`,
      });
    }
  } else {
    resetStreak("cpu");
  }

  const hcpu = snapshot.hostCpuPct;
  if (hcpu >= CFG.hostCpuWarn) {
    if (bumpStreak("hostCpu") >= CFG.sustained && !withinCooldown("hostCpu")) {
      active.push({
        rule: "hostCpu",
        level: "warn",
        text: `🖥️ Host total CPU at ${hcpu}% (warn ${CFG.hostCpuWarn}%) — sustained. (Bot CPU ${cpu}%)`,
      });
    }
  } else {
    resetStreak("hostCpu");
  }

  const ram = snapshot.mem.usedPct;
  if (ram >= CFG.ramPanic) {
    if (bumpStreak("ram") >= CFG.sustained) {
      active.push({
        rule: "ram",
        level: "panic",
        text: `🖥️ RAM at ${ram}% (${snapshot.mem.freeG} GB free / ${snapshot.mem.totalG} GB) — panic.
⚠️ The OS is nearly out of memory.`,
      });
      resetStreak("ram");
    }
  } else if (ram >= CFG.ramWarn) {
    if (bumpStreak("ram") >= CFG.sustained && !withinCooldown("ram")) {
      active.push({
        rule: "ram",
        level: "warn",
        text: `🖥️ RAM at ${ram}% (${snapshot.mem.usedPct}% used / ${snapshot.mem.totalG} GB) — warn.
💡 Suspect a memory leak.`,
      });
    }
  } else {
    resetStreak("ram");
  }

  if (snapshot.disk) {
    const free = snapshot.disk.freeMb;
    const total = snapshot.disk.totalMb;
    const freePct = snapshot.disk.freePct;
    if (free <= CFG.diskPanicMb) {
      if (bumpStreak("disk") >= CFG.sustained) {
        active.push({
          rule: "disk",
          level: "panic",
          text: `🖥️ Disk almost full: ${Math.round(free / 1024)} GB / ${Math.round(total / 1024)} GB free (~${freePct}%) — panic.
💡 Database writes will fail.`,
        });
        resetStreak("disk");
      }
    } else if (free <= CFG.diskWarnMb) {
      if (bumpStreak("disk") >= CFG.sustained && !withinCooldown("disk")) {
        active.push({
          rule: "disk",
          level: "warn",
          text: `🖥️ Running low on disk: ~${Math.round(free / 1024)} GB free (~${freePct}%) — warn.`,
        });
      }
    } else {
      resetStreak("disk");
    }
  }

  if (snapshot.rssMb >= CFG.rssWarnMb) {
    if (bumpStreak("rss") >= CFG.sustained && !withinCooldown("rss")) {
      active.push({
        rule: "rss",
        level: "warn",
        text: `🖥️ Bot process at ${snapshot.rssMb} MB RSS (warn ${CFG.rssWarnMb} MB) — pm2 restart cap is 1300 MB.\n💡 Leak or runaway memory.`,
      });
    }
  } else {
    resetStreak("rss");
  }

  return active;
}

async function runSample() {
  if (!running) return;
  if (!isWatchEnabled("systemwatch")) return;
  let snapshot = null;
  try {
    snapshot = await hostSnapshot();
  } catch (err) {
    console.warn("[system-watch] snapshot failed:", err?.message || err);
    return;
  }
  hasRun = true;

  const active = await evaluate(snapshot);
  if (!active.length) {
    console.log(
      `[system-watch] ok — botCpu ${snapshot.cpuPct}% · hostCpu ${snapshot.hostCpuPct}% · ram ${snapshot.mem.usedPct}% · disk ${snapshot.disk ? `${Math.round(snapshot.disk.freeMb / 1024)} GB free` : "?"} · rss ${snapshot.rssMb} MB`
    );
    return;
  }

  const warns = active.filter((a) => a.level === "warn");
  const panics = active.filter((a) => a.level === "panic");

  if (warns.length) {
    const body = warns.map((w) => w.text).join("\n");
    lastReported[warns[0].rule] = Date.now();
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      await systemLog("warn", body);
    } catch {  }
  }

  if (panics.length) {
    const worst = panics[0];
    lastReported[worst.rule] = Date.now();
    console.error("[system-watch] escalating to core panic:\n" + panics.map((p) => p.text).join("\n"));
    try {
      const { forceCorePanic } = await import("./corePanic.js");
      await forceCorePanic(
        { detail: { reason: "system", rules: panics.map((p) => p.rule) } },
        "system"
      );
    } catch (err) {
      console.error("[system-watch] panic escalation failed:", err?.message || err);
    }
  }
}

export async function startSystemMonitor() {
  if (running) return;
  if (process.env.SYSTEM_WATCH === "off") {
    console.log("💤 System monitor disabled (SYSTEM_WATCH=off).");
    return;
  }
  const { loadWatchSwitch } = await import("./watchSwitch.js");
  await loadWatchSwitch().catch(() => {});
  if (!isWatchEnabled("systemwatch")) {
    console.log("💤 System monitor disabled (watch switch off).");
    return;
  }
  running = true;
  timer = setInterval(runSample, CFG.intervalMs);
  if (timer?.unref) timer.unref();
  console.log(
    `🖥️ System monitor armed (every ${CFG.intervalMs / 1000}s · cpu panic >${CFG.cpuPanic}% · ram panic >${CFG.ramPanic}% · disk <${CFG.diskPanicMb}MB)`
  );
  runSample();
}

export function stopSystemMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
}