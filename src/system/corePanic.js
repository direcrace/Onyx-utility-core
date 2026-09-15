/**
 * CORE PANIC — safety mechanism (a.k.a. "kernel panic").
 *
 * When the runtime is overloaded, this module forces a real `pm2 stop` to
 * protect the backend and prevent the bot from spamming itself (reply loops /
 * message floods / runaway memory / event-loop starvation). Before stopping it
 * announces a KERNEL PANIC in the system log group.
 *
 * The mechanism is designed to ALWAYS work:
 *  1. In-process monitors (event-loop delay, heap, message rate, outbound
 *     send-burst) with low, hard-to-bypass thresholds, sustained over a short
 *     window.
 *  2. A detached WATCHDOG child process with its own event loop: if the main
 *     process stops writing its heartbeat (i.e. the loop is fully wedged and
 *     even the panic timer can't fire), the watchdog force-stops the bot.
 *  3. A hard kill deadline during panic — if `pm2 stop` fails, it force-kills.
 *
 * Tunable via env (applied at boot, see defaults below):
 *   CORE_PANIC              = "off" to disable
 *   CORE_PANIC_EL_DELAY     = event-loop delay limit in ms (default 2000)
 *   CORE_PANIC_MEMORY_MB    = heap limit in MB (default 900)
 *   CORE_PANIC_MSG_RATE     = inbound message rate limit per minute (default 150)
 *   CORE_PANIC_SEND_BURST   = outbound TEXT sends within the window before a
 *                             panic fires immediately (default 4 = ">3 fast")
 *   CORE_PANIC_SEND_WINDOW_MS = burst look-back window (default 2000 ms)
 *   CORE_PANIC_SUSTAINED    = consecutive checks above limit before firing (default 2)
 *   CORE_PANIC_GRACE_MS     = ignore overloads within this window after a panic
 *                             (default 10 min) — prevents boot-loop crashes
 *   WATCHDOG                = "off" to disable the external watchdog child
 *
 * Every callback socket (main + sub-sessions) is wrapped by armSendMonitor() so
 * the send-burst counter sees ALL outbound text, no matter which helper sent it.
 */

import { exec, spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { kvGet, kvSet } from "../database/botKv.js";
import { isWatchEnabled } from "./watchSwitch.js";

const CFG = {
  enabled: process.env.CORE_PANIC !== "off",
  elDelayMs: Number(process.env.CORE_PANIC_EL_DELAY) || 2000,
  memoryMb: Number(process.env.CORE_PANIC_MEMORY_MB) || 900,
  msgRatePerMin: Number(process.env.CORE_PANIC_MSG_RATE) || 150,
  sendBurst: Math.max(2, Number(process.env.CORE_PANIC_SEND_BURST) || 4),
  sendWindowMs: Math.max(500, Number(process.env.CORE_PANIC_SEND_WINDOW_MS) || 2000),
  sustainedChecks: Math.max(1, Number(process.env.CORE_PANIC_SUSTAINED) || 2),
  checkIntervalMs: 5000,
  graceMs: Number(process.env.CORE_PANIC_GRACE_MS) || 10 * 60 * 1000,
  settleMs: Number(process.env.CORE_PANIC_SETTLE_MS) || 60_000,
  watchdog: process.env.WATCHDOG !== "off",
  heartbeatMs: 2000,
  watchdogStaleMs: 12_000,
  watchdogCheckMs: 3000,
};

const PANIC_KEY = "corepanic:at";

let timer = null;
let heartbeatTimer = null;
let watchdogChild = null;
let panicked = false;
let panicGrace = false;
let bootedAt = Date.now();
let startedOnce = false;
let stoppedBySwitch = false;

const incoming = [];
const sends = [];

// Lifetime traffic totals for the dashboard (survive in-memory series restarts,
// reset on process restart — hourly aggregates are persisted elsewhere).
let totalIn = 0;
let totalOut = 0;
let sendFails = 0;
let lastSendMs = 0;

const SEND_PATCH = Symbol("onyxSendPatched");

/**
 * Wrap a socket's sendMessage so every outbound TEXT message is counted for the
 * send-burst condition. Call once per socket (main + sub-sessions). Non-text
 * sends (reacts, presence, media without text) are ignored — a chat reply is a
 * `{ text }` payload, so bursts of actual messages are what trigger.
 */
export function armSendMonitor(conn) {
  if (!conn || conn[SEND_PATCH] || typeof conn.sendMessage !== "function") {
    return conn;
  }
  const original = conn.sendMessage.bind(conn);
  conn.sendMessage = async (jid, content, options) => {
    const startedAt = Date.now();
    try {
      if (
        content &&
        typeof content === "object" &&
        typeof content.text === "string" &&
        content.text.length
      ) {
        trackOutboundMessage();
      }
    } catch { /* ignore */ }
    try {
      const result = await original(jid, content, options);
      lastSendMs = Date.now() - startedAt;
      if (result === undefined) sendFails += 1;
      return result;
    } catch (err) {
      lastSendMs = Date.now() - startedAt;
      sendFails += 1;
      throw err;
    }
  };
  conn[SEND_PATCH] = true;
  return conn;
}

/**
 * Call once per outbound TEXT message (auto-instrumented via armSendMonitor).
 */
export function trackOutboundMessage() {
  const now = Date.now();
  totalOut += 1;
  sends.push(now);
  if (sends.length > 500) sends.splice(0, sends.length >> 1);
}

function sendBurst() {
  const cutoff = Date.now() - CFG.sendWindowMs;
  while (sends.length && sends[0] < cutoff) sends.shift();
  return sends.length;
}

/**
 * Declarative status, used by `#sys` (includes live values).
 */
export function getCorePanicStatus() {
  return {
    enabled: CFG.enabled && isWatchEnabled("corepanic"),
    runtimeSwitch: isWatchEnabled("corepanic"),
    panicked,
    panicGrace,
    elDelayMs: CFG.elDelayMs,
    memoryMb: CFG.memoryMb,
    msgRatePerMin: CFG.msgRatePerMin,
    sendBurst: CFG.sendBurst,
    sendWindowMs: CFG.sendWindowMs,
    sustainedChecks: CFG.sustainedChecks,
    checkIntervalMs: CFG.checkIntervalMs,
    graceMs: CFG.graceMs,
    watchdog: CFG.watchdog,
    Live: {
      ratePerMin: messageRate(),
      sendBurstNow: sendBurst(),
      heapMb: Math.round(heapMb()),
      totals: { in: totalIn, out: totalOut, fails: sendFails, lastSendMs },
    },
  };
}

/**
 * Call once per processed incoming message (main + sub-sessions).
 * Ignores the post-boot settle window (WhatsApp replays the offline backlog on
 * connect — counting those would trip the rate limit on every restart).
 */
export function trackIncomingMessage() {
  if (Date.now() - bootedAt < CFG.settleMs) return;
  totalIn += 1;
  const now = Date.now();
  incoming.push(now);
  if (incoming.length > 2000) incoming.splice(0, incoming.length >> 1);
}

function messageRate() {
  const cutoff = Date.now() - 60_000;
  while (incoming.length && incoming[0] < cutoff) incoming.shift();
  return incoming.length;
}

function measureEventLoopDelay() {
  return new Promise((resolve) => {
    let started = false;
    const t0 = process.hrtime.bigint();
    setTimeout(() => {
      started = true;
      const spent = Number(process.hrtime.bigint() - t0) / 1e6;
      resolve(Math.max(0, spent - 1));
    }, 1);
  });
}

function heapMb() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

export function panicAppName() {
  return (
    process.env.PM2_APP_NAME ||
    process.env.name ||
    (process.env.PM2_ID ? `pm${process.env.PM2_ID}` : "") ||
    ""
  );
}

function pm2StopApp() {
  const app = panicAppName();
  if (!app) return Promise.resolve(false);
  return new Promise((resolve) => {
    exec(`pm2 stop ${app}`, { windowsHide: true }, (err) => {
      if (err) {
        console.warn("[core-panic] pm2 stop failed:", err?.message);
        resolve(false);
      } else {
        console.log(`[core-panic] pm2 stop ${app} issued.`);
        resolve(true);
      }
    });
  });
}

function hardKill(pid) {
  return new Promise((resolve) => {
    exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, (err) => {
      if (err && !/not found/i.test(err?.message || "")) {
        console.warn("[core-panic] taskkill failed:", err?.message);
      }
      resolve(true);
    });
  });
}

async function triggerPanic(metrics, { hard = false, source = "monitor" } = {}) {
  if (panicked) return;
  panicked = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const lines = [
    `• Event-loop delay: ${Math.round(metrics.elDelayMs)} ms (limit ${CFG.elDelayMs})`,
    `• Heap used: ${Math.round(metrics.heapMb)} MB (limit ${CFG.memoryMb})`,
    `• Message rate: ${metrics.rate}/min (limit ${CFG.msgRatePerMin})`,
    `• Outbound burst: ${metrics.burst ?? 0} msgs/${CFG.sendWindowMs / 1000}s (limit ${CFG.sendBurst})`,
    `• Source: ${source}`,
  ];

  const message =
    "💥 *CORE PANIC*" +
    (hard ? " (HARD)" : "") +
    " — forced shutdown!\n" +
    "_Kernel panic condition detected — stopping to protect the backend and prevent self-spam._\n\n" +
    lines.join("\n") +
    `\n\nUptime: ${Math.floor(process.uptime() / 60)} min` +
    (process.env.name ? `\nApp: ${process.env.name}` : "") +
    "\nRestart with `pm2 start onyx`.";

  console.error("\n\u{1F525} CORE PANIC — shutting down by safety mechanism\n" + message + "\n");

  try {
    await kvSet(PANIC_KEY, Date.now());
  } catch { /* ignore */ }

  // Announce in the system log group — but never let this block the stop.
  if (!hard) {
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      await Promise.race([
        systemLog("error", message),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch { /* ignore */ }
  } else {
    try {
      const { systemLog } = await import("../utils/logGroup.js");
      systemLog("error", message);
    } catch { /* ignore */ }
  }

  // Absolute deadline: no matter what goes wrong, the process must die soon.
  const killTimer = setTimeout(() => {
    console.error("[core-panic] hard deadline reached — force killing.");
    hardKill(process.pid);
    setTimeout(() => process.exit(1), 1500);
  }, 8000);
  killTimer.unref?.();

  const stopped = await pm2StopApp().catch(() => false);
  if (!stopped) {
    console.error("[core-panic] pm2 stop failed — force killing instead.");
    await hardKill(process.pid);
  }
  clearTimeout(killTimer);
}

async function writeHeartbeat() {
  if (panicked) return;
  try {
    await fs.writeFile(
      heartbeatPath(),
      JSON.stringify({ pid: process.pid, ts: Date.now() }),
      "utf8"
    );
  } catch { /* ignore */ }
}

function heartbeatPath() {
  let dir = process.env.CORE_PANIC_HB_DIR || "";
  if (!dir) {
    try {
      dir = os.tmpdir();
    } catch {
      dir = ".";
    }
  }
  return path.join(dir, `onyx-hb-${process.pid}.json`);
}

async function spawnWatchdog() {
  if (!CFG.watchdog || watchdogChild) return;
  if (!isWatchEnabled("corepanic")) return;
  const wdPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "watchdog.js"
  );
  const args = [
    wdPath,
    String(process.pid),
    String(process.env.name || ""),
    heartbeatPath(),
    String(CFG.watchdogStaleMs),
    String(CFG.watchdogCheckMs),
    String(process.env.PM2_ID || ""),
  ];
  try {
    watchdogChild = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    watchdogChild.unref();
    if (watchdogChild.pid) {
      console.log(`🐶 Core panic watchdog armed (pid ${watchdogChild.pid}).`);
    }
  } catch (err) {
    console.warn("[core-panic] watchdog spawn failed:", err?.message || err);
  }
}

/**
 * Start the core-panic monitor. Idempotent.
 */
export async function startCorePanicMonitor() {
  if (!CFG.enabled) {
    console.log("💤 Core panic monitor disabled (CORE_PANIC=off).");
    return;
  }
  if (startedOnce && !stoppedBySwitch) return;

  const { loadWatchSwitch } = await import("./watchSwitch.js");
  await loadWatchSwitch().catch(() => {});
  if (!isWatchEnabled("corepanic")) {
    console.log("💤 Core panic monitor disabled (watch switch off).");
    return;
  }

  // Crash guards: log fatal errors, and panic if the runtime is also overloaded.
  // Only attach once — re-arming after #syswatch off must not stack handlers.
  if (!startedOnce) {
    process.on("unhandledRejection", (err) => {
      try {
        import("../utils/logGroup.js").then(({ systemLog }) =>
          systemLog("error", "Unhandled promise rejection", err)
        );
      } catch { /* ignore */ }
    });

    process.on("uncaughtException", (err) => {
      console.error("☢️ Uncaught exception:", err?.message || err);
      try {
        import("../utils/logGroup.js").then(({ systemLog }) =>
          systemLog("error", "Uncaught exception", err)
        );
      } catch { /* ignore */ }
      measureEventLoopDelay().then((elDelayMs) => {
        const metrics = { elDelayMs, heapMb: heapMb(), rate: messageRate(), burst: sendBurst() };
        if (!inGrace && (metrics.heapMb >= CFG.memoryMb || metrics.rate >= CFG.msgRatePerMin)) {
          triggerPanic(metrics, { hard: true, source: "uncaught_exception" }).catch(() =>
            setTimeout(() => process.exit(1), 1500)
          );
        } else {
          setTimeout(() => process.exit(1), 2000);
        }
      });
    });
  }

  startedOnce = true;
  stoppedBySwitch = false;

  let inGrace = false;
  let lastPanicTs = null;
  try {
    const lastPanic = await kvGet(PANIC_KEY);
    lastPanicTs = lastPanic ? Number(lastPanic) : null;
    if (lastPanicTs && Date.now() - lastPanicTs < CFG.graceMs) {
      const mins = Math.ceil((CFG.graceMs - (Date.now() - lastPanicTs)) / 60_000);
      console.warn(`💤 Core panic monitor in grace period (~${mins} min left) — in-process auto-panic disarmed, watchdog stays.`);
      inGrace = true;
      panicGrace = true;
    }
  } catch { /* ignore */ }

  // Watchdog + heartbeat run even in grace so a wedged loop still gets caught.
  await spawnWatchdog();
  await writeHeartbeat();

  const counters = { elDelay: 0, memory: 0, rate: 0 };
  const graceUntil = lastPanicTs
    ? Number(lastPanicTs) + CFG.graceMs
    : Date.now();

  const tick = async () => {
    if (panicked) return;
    if (!isWatchEnabled("corepanic")) return;
    // Post-boot settle window: skip checks entirely (backlog replay looks
    // like a flood). A real wedge during settle is still caught by the watchdog.
    if (Date.now() - bootedAt < CFG.settleMs) return;
    // If we were in grace at boot, arm for real once it elapses.
    if (inGrace && Date.now() < graceUntil) return;
    if (inGrace && !timer) {
      inGrace = false;
      panicGrace = false;
      timer = setInterval(tick, CFG.checkIntervalMs);
      timer.unref?.();
      console.log(`🛡️ Grace period over — core panic auto-monitor re-armed.`);
    }
    const elDelayMs = await measureEventLoopDelay();
    const burst = sendBurst();

    counters.elDelay = elDelayMs >= CFG.elDelayMs ? counters.elDelay + 1 : 0;
    counters.memory = heapMb() >= CFG.memoryMb ? counters.memory + 1 : 0;
    counters.rate = messageRate() >= CFG.msgRatePerMin ? counters.rate + 1 : 0;

    const sustained =
      counters.elDelay >= CFG.sustainedChecks ||
      counters.memory >= CFG.sustainedChecks ||
      counters.rate >= CFG.sustainedChecks;

    // A send-burst is self-sustaining by definition (N messages inside a short
    // window) — one observation is already the condition.
    const sendBurstFire = burst >= CFG.sendBurst;

    if (sustained || sendBurstFire) {
      console.warn(
        `[core-panic] monitor firing — counters=${JSON.stringify(counters)} values el=${Math.round(elDelayMs)}ms mem=${Math.round(heapMb())}MB rate=${messageRate()}/min burst=${burst}`
      );
      await triggerPanic({ elDelayMs, heapMb: heapMb(), rate: messageRate(), burst }, { source: "monitor" });
    }
  };

  heartbeatTimer = setInterval(writeHeartbeat, CFG.heartbeatMs);
  heartbeatTimer.unref?.();

  if (inGrace) {
    // In grace: checks are disarmed, but keep a lightweight timer so the
    // monitor re-arms for real once the grace window elapses.
    console.warn("🛡️ Heartbeat + watchdog only (no threshold checks during grace; auto re-arm on expiry).");
    const graceCheck = setInterval(tick, 15_000);
    graceCheck.unref?.();
    return;
  }

  timer = setInterval(tick, CFG.checkIntervalMs);
  timer.unref?.();

  console.log(
    `🛡️ Core panic monitor armed (EL>${CFG.elDelayMs}ms · mem>${CFG.memoryMb}MB · rate>${CFG.msgRatePerMin}/min · send>${CFG.sendBurst} in ${CFG.sendWindowMs}ms · sustained ${CFG.sustainedChecks}×, ${CFG.checkIntervalMs}ms checks).`
  );
}

/**
 * Manual/system panic trigger (owner command / #sys escalation / testing).
 */
export async function forceCorePanic({ detail } = {}, source = "manual") {
  await triggerPanic(
    {
      elDelayMs: detail?.reason === "manual" ? 0 : await measureEventLoopDelay(),
      heapMb: heapMb(),
      rate: messageRate(),
      burst: sendBurst(),
    },
    { source }
  );
}

/**
 * Tear down the core-panic monitor + force-kill watchdog (runtime `#syswatch off`).
 * Idempotent; startCorePanicMonitor() can be called again to re-arm.
 */
export function stopCorePanicMonitor() {
  stoppedBySwitch = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (watchdogChild) {
    try {
      watchdogChild.kill("SIGKILL");
    } catch { /* ignore */ }
    watchdogChild = null;
    console.log("🐶 Core panic watchdog stopped (watch switch off).");
  }
  console.log("💤 Core panic monitor stopped (watch switch off).");
}