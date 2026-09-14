/**
 * Ping Command — latency, uptime, memory, socket state
 */

import { command } from "../plugins.js";
import { reply, tr } from "../utils/message.js";

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

command(
  {
    pattern: "ping",
    fromMe: false,
    desc: "Check bot response time",
    type: "misc",
  },
  async (message, conn) => {
    const start = Date.now();
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const wsState = conn?.ws?.isOpen ? 1 : conn?.ws?.isConnecting ? 0 : (conn?.ws?.socket?.readyState ?? 3);
    const wsLabel =
      wsState === 1 ? await tr("🟢 connected", "🟢 verbunden")
      : wsState === 0 ? await tr("🟡 connecting", "🟡 verbinde")
      : "🔴 offline";

    const lines = [
      `*Pong!* ${Date.now() - start}ms`,
      "",
      await tr(`⏱️ Bot uptime: ${formatUptime(uptime)}`, `⏱️ Bot-Laufzeit: ${formatUptime(uptime)}`),
      `🧠 RAM: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB heap / ${(mem.rss / 1024 / 1024).toFixed(0)}MB rss`,
      await tr(`📶 Socket: ${wsLabel}`, `📶 Socket: ${wsLabel}`),
      await tr(`🛰️ Wa version: ${conn?.version?.join?.(".") || "n/a"}`, `🛰️ WA-Version: ${conn?.version?.join?.(".") || "n/a"}`),
    ];

    await reply(
      conn,
      message,
      (await Promise.all(lines)).join("\n")
    );
  }
);