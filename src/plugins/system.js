/**
 * System controls: `#reboot` and `#shutdown`.
 * Works on the MAIN bot (owner/sudo) and on Onyx Minis (their own user).
 *
 * Main:   #reboot = graceful process restart (pm2 auto-restarts).
 *         #shutdown = pm2 stop (true off until manually started).
 * Mini:   #reboot = reconnect the sub-session in place.
 *         #shutdown = remove + logout the sub-session (termination DM).
 */

import { exec } from "child_process";
import { command } from "../plugins.js";
import {
  replyOk,
  replyFail,
  getCommandArgs,
  tr,
} from "../utils/message.js";
import { normalizeNumber, isPrivileged, getOwnerNumbers, senderCandidates } from "../utils/access.js";
import { isSubConnection, restartSubSession, removeSubSession } from "../multi/sessionManager.js";
import { BOT_INFO } from "../config/constants.js";

function isSubOwner(conn, message) {
  if (!conn?.__isSub || !conn?.__subNumber) return false;
  const candidates = senderCandidates(message, conn);
  if (normalizeNumber(message.sender) === conn.__subNumber) return true;
  const owners = getOwnerNumbers();
  return owners.some((o) => candidates.has(o));
}

function pm2StopApp() {
  return new Promise((resolve) => {
    const app =
      process.env.PM2_APP_NAME ||
      process.env.name ||
      (process.env.PM2_ID ? `pm${process.env.PM2_ID}` : "") ||
      "onyx";
    if (!app) return resolve(false);
    exec(`pm2 stop ${app}`, { windowsHide: true }, (err) => {
      if (err) {
        console.warn("[system] pm2 stop failed, falling back to exit:", err?.message);
        resolve(false);
      } else {
        console.log(`[system] pm2 stop ${app} issued.`);
        resolve(true);
      }
    });
  });
}

async function requireControl(conn, message) {
  if (isSubConnection(conn)) {
    if (!isSubOwner(conn, message)) {
      await replyFail(
        conn,
        message,
        await tr(
          "Only the owner of this Onyx Mini can do that.",
          "Nur der Besitzer dieses Onyx Minis kann das tun."
        )
      );
      return false;
    }
    return true;
  }
  if (!(await isPrivileged(message, conn))) {
    await replyFail(
      conn,
      message,
      await tr(
        "Only the bot owner can do that.",
        "Nur der Bot-Besitzer kann das tun."
      )
    );
    return false;
  }
  return true;
}

command(
  { pattern: "reboot", fromMe: false, desc: "Reboot the bot (owner)", type: "owner" },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "reboot") || "").trim().toLowerCase();
    if (!(await requireControl(conn, message))) return;

    if (isSubConnection(conn)) {
      await replyOk(conn, message, await tr("♻️ Rebooting this Onyx Mini...", "♻️ Dieses Onyx Mini wird neu gestartet..."));
      try {
        await restartSubSession(conn.__subNumber);
      } catch (err) {
        console.error("[system] mini reboot failed:", err?.message || err);
      }
      return;
    }

    // Main bot: graceful process restart.
    await replyOk(conn, message, await tr("♻️ Rebooting bot...", "♻️ Bot wird neu gestartet..."));
    if (args === "now") {
      process.exit(0);
    } else {
      setTimeout(() => process.exit(0), 800);
    }
  }
);

command(
  { pattern: "shutdown", fromMe: false, desc: "Shut the bot down (owner)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;

    if (isSubConnection(conn)) {
      await replyOk(conn, message, await tr("👋 Shutting down this Onyx Mini.", "👋 Dieses Onyx Mini wird heruntergefahren."));
      try {
        await removeSubSession(conn.__subNumber);
      } catch (err) {
        console.error("[system] mini shutdown failed:", err?.message || err);
      }
      return;
    }

    // Main bot: true pm2 stop (stays off until manually started).
    await replyOk(conn, message, await tr("👋 Shutting down... (pm2 stop — start again with `pm2 start onyx`)", "👋 Fahre herunter... (pm2 stop — erneut starten mit `pm2 start onyx`)"));
    setTimeout(async () => {
      const stopped = await pm2StopApp();
      if (!stopped) process.exit(0);
    }, 800);
  }
);

command(
  {
    pattern: "sys",
    fromMe: false,
    desc: "Host + safety status (owner)",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;

    let snapshot = null;
    let panic = null;
    let swatch = null;
    try {
      const { hostSnapshot } = await import("../system/systemWatch.js");
      snapshot = await hostSnapshot();
      const { getSystemWatchStatus } = await import("../system/systemWatch.js");
      swatch = getSystemWatchStatus();
    } catch { /* ignore */ }

    try {
      const { getCorePanicStatus } = await import("../system/corePanic.js");
      panic = getCorePanicStatus();
    } catch { /* ignore */ }

    if (!snapshot || !panic) {
      await replyFail(conn, message, await tr("Could not read host status.", "Host-Status konnte nicht gelesen werden."));
      return;
    }

    const disk = snapshot.disk
      ? `~${Math.round(snapshot.disk.freeMb / 1024)} GB free / ${Math.round(snapshot.disk.totalMb / 1024)} GB (~${snapshot.disk.freePct}%)`
      : "n/a";
    const uptime =
      snapshot.uptimeSec < 60
        ? `${snapshot.uptimeSec}s`
        : snapshot.uptimeSec < 3600
          ? `${Math.floor(snapshot.uptimeSec / 60)} min`
          : `${(snapshot.uptimeSec / 3600).toFixed(1)} h`;

    const text = await tr(
      [
        `🖥️ *Host*`,
        `• CPU: ${snapshot.hostCpuPct}% total · bot ${snapshot.cpuPct}%`,
        `• RAM: ${snapshot.mem.usedPct}% (${snapshot.mem.freeG} GB free / ${snapshot.mem.totalG} GB)`,
        `• Disk: ${disk}`,
        `• PID ${snapshot.pid}${snapshot.pm2App ? ` · ${snapshot.pm2App}` : ""} · uptime ${uptime}`,
        `• RSS: ${snapshot.rssMb} MB · heap ${snapshot.heapMb} MB`,
        ``,
        `🧠 *Core panic:* ${panic.enabled ? "armed" : "OFF"}`,
        `• EL > ${panic.elDelayMs}ms · mem > ${panic.memoryMb}MB`,
        `• inbound > ${panic.msgRatePerMin}/min`,
        `• send > ${panic.sendBurst} per ${panic.sendWindowMs}ms`,
        `• sustained ${panic.sustainedChecks}× · watchdog ${panic.watchdog ? "armed" : "off"}`,
        swatch ? `👁️ *System watch:* every ${swatch.intervalMs / 1000}s · botCPU >${swatch.cpuPanic}% · ram >${swatch.ramPanic}% · disk <${Math.round(swatch.diskPanicMb / 1024)}GB` : "",
      ].join("\n"),
      [
        `🖥️ *Host*`,
        `• CPU: ${snapshot.hostCpuPct}% gesamt · Bot ${snapshot.cpuPct}%`,
        `• RAM: ${snapshot.mem.usedPct}% (${snapshot.mem.freeG} GB frei / ${snapshot.mem.totalG} GB)`,
        `• Festplatte: ${disk}`,
        `• PID ${snapshot.pid}${snapshot.pm2App ? ` · ${snapshot.pm2App}` : ""} · Uptime ${uptime}`,
        `• RSS: ${snapshot.rssMb} MB · Heap ${snapshot.heapMb} MB`,
        ``,
        `🧠 *Core panic:* ${panic.enabled ? "aktiviert" : "AUS"}`,
        `• EL > ${panic.elDelayMs}ms · Speicher > ${panic.memoryMb}MB`,
        `• eingehend > ${panic.msgRatePerMin}/min`,
        `• Send > ${panic.sendBurst} pro ${panic.sendWindowMs}ms`,
        `• anhaltend ${panic.sustainedChecks}× · Watchdog ${panic.watchdog ? "aktiv" : "aus"}`,
        swatch ? `👁️ *System-Watch:* alle ${swatch.intervalMs / 1000}s · Bot-CPU >${swatch.cpuPanic}% · RAM >${swatch.ramPanic}% · Platte <${Math.round(swatch.diskPanicMb / 1024)}GB` : "",
      ].join("\n")
    );
    await replyOk(conn, message, text);
  }
);

command(
  {
    pattern: "dev",
    fromMe: false,
    desc: "Dev console overview — main + minis + flags (owner)",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    try {
      const { getDevSnapshot, formatDevSummary } = await import("../enterprise/devConsole.js");
      const { getLang } = await import("../utils/i18n.js");
      const snap = await getDevSnapshot();
      const de = (await getLang()) === "de";
      await replyOk(conn, message, formatDevSummary(snap, de));
    } catch (err) {
      console.error("[system] #dev failed:", err?.message || err);
      await replyFail(
        conn,
        message,
        await tr(
          "Dev console unavailable.",
          "Dev-Konsole nicht verfügbar."
        )
      );
    }
  }
);

command(
  {
    pattern: "minilog",
    fromMe: false,
    desc: "Tail console logs for an Onyx Mini (owner)",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const args = (getCommandArgs(message.body, "minilog") || "").trim().split(/\s+/);
    const num = normalizeNumber(args[0]);
    const n = Math.min(200, parseInt(args[1], 10) || 30);
    if (!num) {
      await replyFail(
        conn,
        message,
        await tr(
          `Usage: \`${BOT_INFO.PREFIX}minilog <number> [lines]\``,
          `Benutzung: \`${BOT_INFO.PREFIX}minilog <Nummer> [Zeilen]\``
        )
      );
      return;
    }
    try {
      const { runDevAction } = await import("../enterprise/devConsole.js");
      const r = await runDevAction("logs.tail", { n, filter: num });
      if (!r.ok || !r.data?.length) {
        await replyOk(
          conn,
          message,
          await tr(
            `No console lines matched *${num}*.`,
            `Keine Konsolenzeilen für *${num}* gefunden.`
          )
        );
        return;
      }
      const lines = r.data
        .slice(-15)
        .map((e) => `• [${new Date(e.ts).toLocaleTimeString()}] ${String(e.text).slice(0, 280)}`);
      await reply(
        conn,
        message,
        [
          await tr(
            `📟 Console tail for *${num}* (last ${lines.length}):`,
            `📟 Konsolen-Ausschnitt für *${num}* (letzte ${lines.length}):`
          ),
          ...lines,
        ].join("\n")
      );
    } catch (err) {
      console.error("[system] #minilog failed:", err?.message || err);
      await replyFail(
        conn,
        message,
        await tr("Log tail unavailable.", "Log-Ausschnitt nicht verfügbar.")
      );
    }
  }
);

command(
  {
    pattern: "syswatch",
    fromMe: false,
    desc: "Toggle/status the system-watch + core-panic monitors (owner). Usage: #syswatch [on|off|status]",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const raw = (getCommandArgs(message.body, "syswatch") || "status").trim().toLowerCase();
    const action = ["on", "off", "status"].includes(raw) ? raw : "status";

    const { setWatchEnabled, getWatchSwitchInfo } = await import("../system/watchSwitch.js");
    const { getSystemWatchStatus, startSystemMonitor, stopSystemMonitor } = await import(
      "../system/systemWatch.js"
    );
    const { getCorePanicStatus, startCorePanicMonitor, stopCorePanicMonitor } = await import(
      "../system/corePanic.js"
    );

    if (action === "on" || action === "off") {
      const on = action === "on";
      await setWatchEnabled(on);
      if (on) {
        startSystemMonitor();
        await startCorePanicMonitor().catch(() => {});
        await replyOk(
          conn,
          message,
          await tr(
            "🟢 System-watch *ON* — host monitor + core-panic + watchdog re-armed.",
            "🟢 System-Watch *EIN* — Host-Monitor + Core-Panic + Watchdog aktiviert."
          )
        );
      } else {
        stopSystemMonitor();
        stopCorePanicMonitor();
        await replyOk(
          conn,
          message,
          await tr(
            "🟠 System-watch *OFF* — no more automatic self-kills. Manual #corepanic still works. Survives restarts.",
            "🟠 System-Watch *AUS* — keine automatischen Selbst-Abschaltungen mehr. Manuelles #corepanic funktioniert weiter. Übersteht Neustarts."
          )
        );
      }
      return;
    }

    const sw = getSystemWatchStatus();
    const cp = getCorePanicStatus();
    const info = getWatchSwitchInfo();
    const lines = [
      `🛡️ *System-watch*`,
      `Switch: ${info.enabled ? "ON" : "OFF"}` +
        (info.mode ? ` (persisted "${info.mode}")` : " (env default)"),
      `Host monitor: ${sw.enabled ? "running" : "stopped"} (interval ${sw.intervalMs / 1000}s)`,
      `Core panic: ${
        cp.enabled ? "armed" : cp.panicked ? "panicked" : "disabled"
      } · watchdog ${info.enabled ? "active" : "off"}`,
      `Use #syswatch on|off to change (owner).`,
    ];
    await replyOk(conn, message, lines.join("\n"));
  }
);

command(
  {
    pattern: "corepanic",
    fromMe: false,
    desc: "Trigger a core panic (owner). Forces pm2 stop now.",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    await replyOk(
      conn,
      message,
      "💥 Triggering *CORE PANIC* — the bot will stop itself (pm2 stop)."
    );
    try {
      const { forceCorePanic } = await import("../system/corePanic.js");
      setTimeout(async () => {
        try {
          await forceCorePanic({ detail: { reason: "manual" } });
        } catch (err) {
          console.error("[system] manual core panic failed:", err?.message || err);
        }
      }, 1200);
    } catch (err) {
      console.error("[system] corePanic import failed:", err?.message || err);
    }
  }
);