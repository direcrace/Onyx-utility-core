

import { runDevAction, getDevSnapshot, formatDevSummary } from "./devConsole.js";
import { BOT_INFO } from "../config/constants.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function fmtUptime(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

async function showStatus() {
  const snap = await getDevSnapshot();
  return { ok: true, text: formatDevSummary(snap, false) };
}

async function showMinis() {
  const r = await runDevAction("minis.list");
  const list = r?.data || [];
  if (!list.length) return { ok: true, text: "No Onyx Minis linked." };
  const lines = [`Onyx Minis (${list.length}):`];
  for (const s of list) {
    const flags = await runDevAction("flags.list", { number: s.number }).catch(() => null);
    const open = (flags?.data?.records || []).filter((x) => !x.resolved).length;
    const score = flags?.data?.windowScore ?? 0;
    lines.push(`  • ${s.number} — ${s.status} · score ${score} · flags ${open}${s.lastSeen ? ` · seen ${new Date(s.lastSeen).toLocaleString()}` : ""}`);
  }
  return { ok: true, text: lines.join("\n") };
}

async function showFlags(num) {
  const r = await runDevAction("flags.list", { number: num });
  if (!r?.ok) return { ok: false, text: `flags failed: ${r?.error}` };
  const a = r.data;
  if (!a?.records?.length) return { ok: true, text: `No flags for ${a?.number || num}.` };
  const lines = [`Flags for ${a.number} · score ${a.windowScore}/${a.thresholds.suspend}:`];
  for (const f of a.records.slice().reverse()) {
    const resolved = f.resolved ? " ✅" : "";
    lines.push(`  [${new Date(f.ts).toLocaleString()}] ${f.rule} (${f.weight})${resolved} "${String(f.text).replace(/\n/g, " ").slice(0, 80)}"`);
  }
  return { ok: true, text: lines.join("\n") };
}

async function tailLogs(n, filter) {
  const r = await runDevAction("logs.tail", { n: n || 50, filter });
  const lines = r?.data || [];
  const formatted = lines.map((e) => {
    const ts = new Date(e.ts).toLocaleTimeString();
    const lv = e.level === "error" ? "E" : e.level === "warn" ? "W" : " ";
    return `  [${lv} ${ts}] ${e.text}`;
  });
  return { ok: true, text: `Last ${lines.length} console line(s):\n${formatted.join("\n")}` };
}

export const DEV_WEB_HELP = [
  "Available commands:",
  "  status                     system + mini snapshot",
  "  minis                      list linked Onyx Minis",
  "  minis suspend <n> [reason]",
  "  minis unsuspend <n>",
  "  minis remove <n>",
  "  minis respawn <n>",
  "  flags <n>                  show ToS flags for a mini",
  "  flags clear <n> [id|all]",
  "  logs [count]               tail console output",
  "  logsgrep <text> [count]    tail output filtered by text",
  "  sendtest <target> [mini] [text...]   send a test message",
  "  panic                      trigger a core panic (stops the bot)",
  "  reboot                     restart the process (pm2 restarts)",
  "  shutdown                   pm2 stop (stays off)",
  "  help                       this list",
].join("\n");

export async function runDevCommandText(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const c = (cmd || "").toLowerCase();
  const num = () => String(rest[0] || "").replace(/\D/g, "");

  try {
    switch (c) {
      case "":
        return null;

      case "help":
      case "?":
        return { ok: true, text: DEV_WEB_HELP };

      case "status":
      case "st":
        return showStatus();

      case "minis":
        if (!rest.length) return showMinis();
        switch (rest[0].toLowerCase()) {
          case "suspend": {
            const r = await runDevAction("minis.suspend", { number: num(), reason: rest.slice(2).join(" ") || "dev-term" });
            return { ok: r.ok, text: r.ok ? `suspended ${num()}` : r.error };
          }
          case "unsuspend": {
            const r = await runDevAction("minis.unsuspend", { number: num() });
            return { ok: r.ok, text: r.ok ? `resumed ${num()}` : r.error };
          }
          case "remove": {
            const r = await runDevAction("minis.remove", { number: num() });
            return { ok: r.ok, text: r.ok ? `removed ${num()}` : r.error };
          }
          case "respawn": {
            const r = await runDevAction("minis.respawn", { number: num() });
            return { ok: r.ok, text: r.ok ? `respawn ${num()} (${r.data?.respawned ? "ok" : "not provisioned"})` : r.error };
          }
          default:
            return { ok: false, text: "unknown: minis suspend|unsuspend|remove|respawn <n>" };
        }

      case "flags": {
        if (!num()) return { ok: false, text: "usage: flags <number> | flags clear <number> [id|all]" };
        if (rest[0].toLowerCase() === "clear") {
          const r = await runDevAction("flags.clear", { number: num(), id: rest[1] || "all" });
          return { ok: r.ok, text: r.ok ? `flags cleared for ${num()}` : r.error };
        }
        return showFlags(num());
      }

      case "logs":
      case "log":
        return tailLogs(parseInt(rest[0], 10), null);

      case "logsgrep":
        return tailLogs(parseInt(rest[1], 10) || 200, rest[0]);

      case "sendtest": {
        const r = await runDevAction("send.test", { target: num(), mini: rest[1], text: rest.slice(2).join(" ") || "🔧 Dev console test message." });
        return { ok: r.ok, text: r.ok ? `sent via ${r.data?.via} → ${r.data?.target}` : r.error };
      }

      case "panic": {
        const r = await runDevAction("panic.test", { reason: "dev-term" });
        return { ok: r.ok, text: r.ok ? "core panic triggered (bot will stop)." : r.error };
      }
      case "reboot": {
        const r = await runDevAction("reboot");
        return { ok: r.ok, text: r.ok ? "rebooting…" : r.error };
      }
      case "shutdown": {
        const r = await runDevAction("shutdown");
        return { ok: r.ok, text: r.ok ? "shutting down (pm2 stop)…" : r.error };
      }

      default:
        return { ok: false, text: `Unknown command: "${cmd}". Type 'help'.` };
    }
  } catch (err) {
    return { ok: false, text: `error: ${err?.message || String(err)}` };
  }
}
