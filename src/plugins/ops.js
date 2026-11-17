

import { exec } from "child_process";
import { command, rebuildCommandPatterns } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, tr } from "../utils/message.js";
import { BOT_INFO, getPrefix, getBotName, saveRuntimePrefix, saveRuntimeBotName } from "../config/constants.js";
import { normalizeNumber, isPrivileged, getOwnerNumbers, senderCandidates, isCreatorMessage, listCreators, addCreator, removeCreator, addOwner, removeOwner } from "../utils/access.js";
import { requireCreator } from "../utils/guard.js";
import { isSubConnection, getSubSessions, getSubSession, restartSubSession } from "../multi/sessionManager.js";
import { getPolicies } from "../enterprise/policy.js";
import { ROLES, listRoles } from "../enterprise/rbac.js";
import { getFlags } from "../enterprise/flags.js";
import { getMode, listSudo } from "../utils/access.js";

async function requireControl(conn, message) {
  if (isSubConnection(conn)) {
    const candidates = senderCandidates(message, conn);
    if (normalizeNumber(message.sender) === conn.__subNumber) return true;
    const owners = getOwnerNumbers();
    if (owners.some((o) => candidates.has(o))) return true;
    await replyFail(conn, message, await tr("Only the owner of this Onyx Mini can do that.", "Nur der Besitzer dieses Onyx Minis kann das tun."));
    return false;
  }
  if (!(await isPrivileged(message, conn))) {
    await replyFail(conn, message, await tr("Only the bot owner can do that.", "Nur der Bot-Besitzer kann das tun."));
    return false;
  }
  return true;
}

function resolveInstance(conn, token) {
  if (isSubConnection(conn)) return { type: "self", number: conn.__subNumber };
  const num = token ? normalizeNumber(token) : null;
  if (!num) return { type: "main" };
  return { type: "mini", number: num };
}

function formatUptime(sec) {
  if (sec < 60) return `${Math.floor(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.floor(sec % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

command(
  { pattern: "uptime", fromMe: false, desc: "Show how long the bot has been running", type: "info" },
  async (message, conn) => {
    const sec = process.uptime();
    const boot = new Date(Date.now() - sec * 1000).toLocaleString();
    const mini = isSubConnection(conn);
    const tag = mini ? ` (${conn.__subNumber})` : "";
    await reply(conn, message, await tr(
      `⏱️ Uptime: *${formatUptime(sec)}*${tag}\nBooted: ${boot}`,
      `⏱️ Laufzeit: *${formatUptime(sec)}*${tag}\nGestartet: ${boot}`
    ));
  }
);

command(
  { pattern: "version", fromMe: false, desc: "Show bot version", type: "info" },
  async (message, conn) => {
    const node = process.version;
    const pm2 = process.env.PM2_APP_NAME || process.env.name || "onyx";
    const pid = process.pid;
    await reply(conn, message, await tr(
      `📦 *${BOT_INFO.NAME}* v${BOT_INFO.VERSION}\n🖥️ Node ${node} · PID ${pid}\n🚀 pm2: ${pm2}`,
      `📦 *${BOT_INFO.NAME}* v${BOT_INFO.VERSION}\n🖥️ Node ${node} · PID ${pid}\n🚀 pm2: ${pm2}`
    ));
  }
);

command(
  { pattern: "update", fromMe: false, desc: "Pull latest code & restart (creator only)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    if (isSubConnection(conn)) {
      await replyFail(conn, message, await tr("Update must be run from the main bot.", "Update muss vom Haupt-Bot ausgeführt werden."));
      return;
    }
    if (!(await requireCreator(conn, message, "update (git pull)"))) return;
    await replyOk(conn, message, await tr("🔄 Checking & updating... (git pull, install, restart)", "🔄 Prüfe & aktualisiere... (git pull, install, Neustart)"));
    const run = (cmd) => new Promise((resolve) => {
      exec(cmd, { cwd: global.__basedir || process.cwd(), windowsHide: true }, (err, stdout, stderr) => {
        resolve({ code: err ? 1 : 0, out: String(stdout || "").trim(), err: String(stderr || "").trim() });
      });
    });
    const pulling = await run("git pull --ff-only");
    if (pulling.code !== 0) {
      await replyFail(conn, message, await tr(`Git pull failed:\n${pulling.err || pulling.out || "?"}`, `Git pull fehlgeschlagen:\n${pulling.err || pulling.out || "?"}`));
      return;
    }
    await run("npm install --silent");
    await replyOk(conn, message, await tr("✅ Updated. Restarting...", "✅ Aktualisiert. Neustart..."));
    setTimeout(() => process.exit(0), 900);
  }
);

command(
  { pattern: "restart", fromMe: false, desc: "Restart bot (or #restart <number> for a mini)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const token = (getCommandArgs(message.body, "restart") || "").trim();
    const instance = resolveInstance(conn, token);

    if (instance.type === "self") {
      await replyOk(conn, message, await tr("♻️ Restarting this Onyx Mini...", "♻️ Dieses Onyx Mini wird neu gestartet..."));
      try { await restartSubSession(conn.__subNumber); } catch (e) { console.error("[ops] mini restart failed:", e?.message || e); }
      return;
    }
    if (instance.type === "mini") {
      const exists = getSubSession(instance.number);
      if (!exists) {
        await replyFail(conn, message, await tr(`No mini with number *${instance.number}*. See \`#sessions\`.`, `Kein Mini mit Nummer *${instance.number}*. Siehe \`#sessions\`.`));
        return;
      }
      await replyOk(conn, message, await tr(`♻️ Restarting mini *${instance.number}*...`, `♻️ Mini *${instance.number}* wird neu gestartet...`));
      try { await restartSubSession(instance.number); } catch (e) { console.error("[ops] mini restart failed:", e?.message || e); }
      return;
    }
    await replyOk(conn, message, await tr("♻️ Restarting bot...", "♻️ Bot wird neu gestartet..."));
    setTimeout(() => process.exit(0), 800);
  }
);

command(
  { pattern: "logs", fromMe: false, desc: "Tail bot logs (or #logs <number> for a mini)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const args = (getCommandArgs(message.body, "logs") || "").split(/\s+/);
    const n = Math.min(200, parseInt(args[1], 10) || 30);
    const token = args[0];
    const instance = resolveInstance(conn, token);
    const target = instance.type === "mini" ? instance.number : instance.type === "self" ? conn.__subNumber : undefined;
    const filter = target;

    try {
      const { runDevAction } = await import("../enterprise/devConsole.js");
      const r = await runDevAction("logs.tail", { n, filter });
      if (!r.ok || !r.data?.length) {
        await replyOk(conn, message, await tr(`No console lines${filter ? ` for *${filter}*` : ""}.`, `Keine Konsolenzeilen${filter ? ` für *${filter}*` : ""}.`));
        return;
      }
      const lines = r.data.slice(-15).map((e) => `• [${new Date(e.ts).toLocaleTimeString()}] ${String(e.text).slice(0, 280)}`);
      await reply(conn, message, [
        await tr(`📟 Console${filter ? ` for *${filter}*` : ""} (last ${lines.length}):`, `📟 Konsole${filter ? ` für *${filter}*` : ""} (letzte ${lines.length}):`),
        ...lines,
      ].join("\n"));
    } catch (err) {
      console.error("[ops] #logs failed:", err?.message || err);
      await replyFail(conn, message, await tr("Log tail unavailable.", "Log-Ausschnitt nicht verfügbar."));
    }
  }
);

command(
  { pattern: "health", fromMe: false, desc: "Health of bot (or #health <number> for a mini)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const token = (getCommandArgs(message.body, "health") || "").trim();
    const instance = resolveInstance(conn, token);

    if (instance.type === "mini") {
      const s = getSubSession(instance.number);
      if (!s) { await replyFail(conn, message, await tr(`No mini with number *${instance.number}*.`, `Kein Mini mit Nummer *${instance.number}*.`)); return; }
      const miniNum = instance.number;
      const lastSeen = s.lastSeen ? `${Math.floor((Date.now() - s.lastSeen) / 1000)}s ago` : "never";
      const status = s.status || "unknown";
      const emoji = status === "online" ? "🟢" : status === "suspended" ? "🔴" : "🟡";
      await reply(conn, message, await tr(
        `${emoji} *Mini ${miniNum}*\n• Status: ${status}\n• Last seen: ${lastSeen}`,
        `${emoji} *Mini ${miniNum}*\n• Status: ${status}\n• Zuletzt gesehen: ${lastSeen}`
      ));
      return;
    }

    if (instance.type === "self") {
      const s = getSubSession(conn.__subNumber);
      const lastSeen = s?.lastSeen ? `${Math.floor((Date.now() - s.lastSeen) / 1000)}s ago` : "never";
      await reply(conn, message, await tr(
        `🟢 *Mini ${conn.__subNumber} (self)*\n• Status: ${s?.status || "online"}\n• Last seen: ${lastSeen}`,
        `🟢 *Mini ${conn.__subNumber} (self)*\n• Status: ${s?.status || "online"}\n• Zuletzt gesehen: ${lastSeen}`
      ));
      return;
    }

    let host = {};
    let panic = null;
    try {
      const { hostSnapshot } = await import("../system/systemWatch.js");
      host = await hostSnapshot();
      const { getCorePanicStatus } = await import("../system/corePanic.js");
      panic = getCorePanicStatus();
    } catch {  }

    const memUsedPct = host.mem?.usedPct ?? "n/a";
    const cpu = host.hostCpuPct != null ? `${host.hostCpuPct}%` : "n/a";
    const rss = host.rssMb != null ? `${host.rssMb} MB` : "n/a";
    const q = (await import("../enterprise/queue.js")).queueStats?.() || { length: 0 };
    const panicTxt = !panic?.enabled ? "⚪ off" : panic.panicked ? "🔴 TRIGGERED" : panic.panicGrace ? "⏳ grace" : "🟢 armed";
    const uptime = process.uptime();

    await reply(conn, message, await tr(
      [
        `🩺 *Health — ${BOT_INFO.NAME}*`,
        `• Status: 🟢 online · uptime ${formatUptime(uptime)}`,
        `• CPU: ${cpu} · RAM used: ${memUsedPct}%`,
        `• RSS: ${rss} · queue: ${q.length}`,
        `• Core panic: ${panicTxt}`,
      ].join("\n"),
      [
        `🩺 *Gesundheit — ${BOT_INFO.NAME}*`,
        `• Status: 🟢 online · Laufzeit ${formatUptime(uptime)}`,
        `• CPU: ${cpu} · RAM genutzt: ${memUsedPct}%`,
        `• RSS: ${rss} · Warteschlange: ${q.length}`,
        `• Core panic: ${panicTxt}`,
      ].join("\n")
    ));
  }
);

async function getAllConfig() {
  const { kvGet } = await import("../database/botKv.js");
  const mode = await getMode();
  const sudo = await listSudo();
  const policies = await getPolicies();
  const flags = await getFlags();
  return { mode, sudo, lang: await kvGet("lang"), prefix: getPrefix(), botname: getBotName(), policies, flags };
}

command(
  { pattern: "config", fromMe: false, desc: "View or set config: #config [get] [key] | #config set key value", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const args = (getCommandArgs(message.body, "config") || "").trim().split(/\s+/);
    const action = (args[0] || "").toLowerCase();
    const key = args[1] || "";

    if (action === "set" || action === "add") {
      const value = args.slice(2).join(" ");
      if (!key || !value) { await replyFail(conn, message, await tr(`Usage: \`#config set <key> <value>\``, `Benutzung: \`#config set <schlüssel> <wert>\``)); return; }

      if (key === "prefix") {
        try {
          const p = await saveRuntimePrefix(value);
          rebuildCommandPatterns();
          await replyOk(conn, message, await tr(`✅ Prefix = \`${p}\` (command patterns rebuilt)`, `✅ Präfix = \`${p}\` (Befehlsmuster neu erstellt)`));
        } catch (err) {
          await replyFail(conn, message, await tr(`Prefix change failed: ${err?.message || "?"}`, `Präfix-Änderung fehlgeschlagen: ${err?.message || "?"}`));
        }
        return;
      }
      if (key === "botname") {
        try {
          const n = await saveRuntimeBotName(value);
          await replyOk(conn, message, await tr(`✅ Bot name = *${n}*`, `✅ Bot-Name = *${n}*`));
        } catch (err) {
          await replyFail(conn, message, await tr(`Bot name change failed: ${err?.message || "?"}`, `Bot-Namensänderung fehlgeschlagen: ${err?.message || "?"}`));
        }
        return;
      }

      const { setPolicy } = await import("../enterprise/policy.js");
      const POL_KEYS = ["quietHoursStart", "quietHoursEnd", "maxWarns", "allowMediaCommands", "allowLinksInGroups", "rateLimitPerUser", "blockBroadcast"];
      try {
        if (POL_KEYS.includes(key)) {
          const v = ["allowMediaCommands", "allowLinksInGroups", "blockBroadcast"].includes(key) ? value === "true" : Number.isFinite(Number(value)) ? Number(value) : value;
          await setPolicy(key, v);
          await replyOk(conn, message, await tr(`✅ Policy *${key}* = \`${JSON.stringify(v)}\``, `✅ Policy *${key}* = \`${JSON.stringify(v)}\``));
        } else if (key === "mode") {
          const { setMode } = await import("../utils/access.js");
          const modes = ["public", "private", "inbox", "group"];
          if (!modes.includes(value)) { await replyFail(conn, message, await tr(`Mode must be one of: ${modes.join(", ")}`, `Modus muss einer sein von: ${modes.join(", ")}`)); return; }
          await setMode(value);
          await replyOk(conn, message, await tr(`✅ Mode = *${value}*`, `✅ Modus = *${value}*`));
        } else {

          if (!(await requireCreator(conn, message, `config set ${key}`))) return;
          const { kvSet } = await import("../database/botKv.js");
          await kvSet(`config:${key}`, value);
          await replyOk(conn, message, await tr(`✅ Config *${key}* saved.`, `✅ Konfiguration *${key}* gespeichert.`));
        }
      } catch (err) {
        await replyFail(conn, message, await tr(`Config set failed: ${err?.message || "?"}`, `Konfiguration fehlgeschlagen: ${err?.message || "?"}`));
      }
      return;
    }

    const cfg = await getAllConfig();
    if (action === "get" && key) {
      if (key === "mode") { await reply(conn, message, await tr(`*mode* = ${cfg.mode}`, `*mode* = ${cfg.mode}`)); return; }
      if (key === "lang") { await reply(conn, message, await tr(`*lang* = ${cfg.lang || "en"}`, `*lang* = ${cfg.lang || "en"}`)); return; }
      if (key === "prefix") { await reply(conn, message, await tr(`*prefix* = \`${cfg.prefix}\``, `*prefix* = \`${cfg.prefix}\``)); return; }
      if (key === "botname") { await reply(conn, message, await tr(`*botname* = *${cfg.botname}*`, `*botname* = *${cfg.botname}*`)); return; }
      const pol = cfg.policies?.[key];
      if (pol !== undefined) { await reply(conn, message, await tr(`*${key}* = ${JSON.stringify(pol)}`, `*${key}* = ${JSON.stringify(pol)}`)); return; }
      const { kvGet } = await import("../database/botKv.js");
      const custom = await kvGet(`config:${key}`);
      if (custom !== undefined && custom !== null) { await reply(conn, message, await tr(`*${key}* = ${JSON.stringify(custom)}`, `*${key}* = ${JSON.stringify(custom)}`)); return; }
      await replyFail(conn, message, await tr(`Unknown config key *${key}*.`, `Unbekannter Konfigurationsschlüssel *${key}*.`));
      return;
    }

    const polLines = Object.entries(cfg.policies || {}).map(([k, v]) => `• ${k} = \`${JSON.stringify(v)}\``).join("\n");
    const flagLines = Object.entries(cfg.flags || {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
    await reply(conn, message, await tr(
      [
        `⚙️ *Config*`,
        `• mode = *${cfg.mode}*`,
        `• lang = ${cfg.lang || "en"}`,
        `• prefix = \`${cfg.prefix}\` · botname = *${cfg.botname}*`,
        `• sudo = ${cfg.sudo?.join(", ") || "none"}`,
        ``,
        `*Policies*`,
        polLines,
        ``,
        `*Flags enabled:* ${flagLines}`,
        ``,
        `_#config set <key> <value> · prefix, botname, mode, lang · policy keys: quietHoursStart, quietHoursEnd, maxWarns, allowMediaCommands, blockBroadcast, rateLimitPerUser · other config:* keys are creator-only_`,
      ].join("\n"),
      [
        `⚙️ *Konfiguration*`,
        `• mode = *${cfg.mode}*`,
        `• lang = ${cfg.lang || "en"}`,
        `• prefix = \`${cfg.prefix}\` · botname = *${cfg.botname}*`,
        `• sudo = ${cfg.sudo?.join(", ") || "keine"}`,
        ``,
        `*Policies*`,
        polLines,
        ``,
        `*Flags aktiv:* ${flagLines}`,
        ``,
        `_#config set <schlüssel> <wert> · prefix, botname, mode, lang · Policy-Schlüssel: quietHoursStart, quietHoursEnd, maxWarns, allowMediaCommands, blockBroadcast, rateLimitPerUser · weitere config:*-Schlüssel nur für Ersteller_`,
      ].join("\n")
    ));
  }
);

command(
  { pattern: "permissions", fromMe: false, desc: "Show role permissions & your effective role", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const roles = await listRoles();
    const roleLines = Object.entries(roles).map(([n, r]) => `• ${n} → ${r}`).join("\n") || "none";
    const lines = [];
    for (const role of ROLES) {
      const caps = (await (await import("../enterprise/rbac.js")).CAPABILITIES)[role] || [];
      lines.push(`*${role}*: ${caps.includes("*") ? "all" : caps.join(", ") || "—"}`);
    }
    await reply(conn, message, await tr(
      `🔐 *Permissions*\n\n${lines.join("\n")}\n\n*Mapped users*\n${roleLines}\n\n_#role <set> <num> <role> to assign_`,
      `🔐 *Berechtigungen*\n\n${lines.join("\n")}\n\n*Zugewiesene Nutzer*\n${roleLines}\n\n_#role <set> <num> <rolle> zum Zuweisen_`
    ));
  }
);

command(
  { pattern: "whoami", fromMe: false, desc: "Show who you are to the bot", type: "info" },
  async (message, conn) => {
    const role = await (await import("../enterprise/rbac.js")).resolveRole(message, conn);
    const isGw = isSubConnection(conn) ? " (Onyx Mini)" : "";
    const sudo = await (await import("../utils/access.js")).isSudoMessage(message, conn);
    const owner = await (await import("../utils/access.js")).isOwnerMessage(message, conn);
    const creator = isCreatorMessage(message, conn);
    const roleName = creator ? "creator" : owner ? "owner" : role;
    await reply(conn, message, await tr(
      `👤 *Who am I*\n• Name: ${message.pushName || "unknown"}\n• Number: ${normalizeNumber(message.sender) || message.sender}\n• Role: *${roleName}*\n• Creator: ${creator ? "yes" : "no"} · Owner: ${owner ? "yes" : "no"} · Sudo: ${sudo ? "yes" : "no"}${isGw}`,
      `👤 *Wer bin ich*\n• Name: ${message.pushName || "unbekannt"}\n• Nummer: ${normalizeNumber(message.sender) || message.sender}\n• Rolle: *${roleName}*\n• Ersteller: ${creator ? "ja" : "nein"} · Besitzer: ${owner ? "ja" : "nein"} · Sudo: ${sudo ? "ja" : "nein"}${isGw}`
    ));
  }
);

command(
  { pattern: "session", fromMe: false, desc: "Show this chat's session info", type: "info" },
  async (message, conn) => {
    const mini = isSubConnection(conn);
    const botId = conn.user?.id || "?";
    await reply(conn, message, await tr(
      `🔌 *Session*\n• Chat: ${message.from}\n• Group: ${message.isGroup ? "yes" : "no"}\n• Sender: ${normalizeNumber(message.sender) || message.sender}\n• Bot ID: ${botId}\n• Engine: ${mini ? `Onyx Mini (${conn.__subNumber})` : "Main bot"}`,
      `🔌 *Sitzung*\n• Chat: ${message.from}\n• Gruppe: ${message.isGroup ? "ja" : "nein"}\n• Absender: ${normalizeNumber(message.sender) || message.sender}\n• Bot-ID: ${botId}\n• Engine: ${mini ? `Onyx Mini (${conn.__subNumber})` : "Haupt-Bot"}`
    ));
  }
);

command(
  { pattern: "sessions", fromMe: false, desc: "List all linked Onyx Mini sessions (owner)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const minis = getSubSessions();
    if (!minis.length) {
      await replyOk(conn, message, await tr("No Onyx Minis linked. Use \`#pair <number>\` to add one.", "Keine Onyx Minis verlinkt. Nutze \`#pair <nummer>\` zum Hinzufügen."));
      return;
    }
    const lines = minis.map((s) => {
      const emoji = s.status === "online" ? "🟢" : s.status === "suspended" ? "🔴" : "🟡";
      const lastSeen = s.lastSeen ? `${Math.floor((Date.now() - s.lastSeen) / 1000)}s` : "—";
      return `${emoji} *${s.number}* — ${s.status} · seen ${lastSeen} ago`;
    });
    await reply(conn, message, await tr(`🔌 *Sessions* (${minis.length})\n${lines.join("\n")}`, `🔌 *Sitzungen* (${minis.length})\n${lines.join("\n")}`));
  }
);

command(
  { pattern: "ratelimit", fromMe: false, desc: "Show global rate-limit / policy config (owner)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const p = await getPolicies();
    await reply(conn, message, await tr(
      `⏱️ *Rate limit / policy*\n• Commands per user/min: *${p.rateLimitPerUser}*\n• Quiet hours: ${p.quietHoursStart || "—"} → ${p.quietHoursEnd || "—"}\n• Media commands: ${p.allowMediaCommands ? "allowed" : "disabled"}\n• Broadcast: ${p.blockBroadcast ? "blocked" : "allowed"}\n\n_#config set rateLimitPerUser <n> to change_`,
      `⏱️ *Rate-Limit / Policy*\n• Befehle pro Nutzer/min: *${p.rateLimitPerUser}*\n• Ruhezeiten: ${p.quietHoursStart || "—"} → ${p.quietHoursEnd || "—"}\n• Medienbefehle: ${p.allowMediaCommands ? "erlaubt" : "deaktiviert"}\n• Broadcast: ${p.blockBroadcast ? "blockiert" : "erlaubt"}\n\n_#config set rateLimitPerUser <n> zum Ändern_`
    ));
  }
);

command(
  { pattern: "diagnostics", fromMe: false, desc: "Run health diagnostics across the system (owner)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const rows = [];
    const push = (name, ok, detail) => rows.push({ name, ok, detail });
    try { const s = await (await import("../system/systemWatch.js")).hostSnapshot(); push("host", !!s, `CPU ${s.hostCpuPct}% · mem ${s.mem?.usedPct}%`); } catch { push("host", false, "unavailable"); }
    try { const p = await (await import("../system/corePanic.js")).getCorePanicStatus(); push("core-panic", !p.panicked, p.panicked ? "TRIGGERED" : p.enabled ? (p.panicGrace ? "grace" : "armed") : "off"); } catch { push("core-panic", false, "unavailable"); }
    try { const q = (await import("../enterprise/queue.js")).queueStats(); push("queue", true, `${q.length} pending · ${q.active ?? 0} active`); } catch { push("queue", false, "unavailable"); }
    try { const m = (await import("../enterprise/metrics.js")).getMetricsSnapshot(); push("metrics", true, `${m.commandsTotal ?? 0} cmds · ${m.errorsTotal ?? 0} errs`); } catch { push("metrics", false, "unavailable"); }
    try { const { getSubSessions: subs } = await import("../multi/sessionManager.js"); const list = subs(); push("sessions", true, `${list.length} mini(s)`); } catch { push("sessions", false, "unavailable"); }

    const lines = rows.map((r) => `${r.ok ? "✅" : "⚠️"} *${r.name}* — ${r.detail}`).join("\n");
    await reply(conn, message, await tr(`🩺 *Diagnostics*\n${lines}`, `🩺 *Diagnose*\n${lines}`));
  }
);

command(
  { pattern: "debug", fromMe: false, desc: "Dump runtime debug info (owner)", type: "owner" },
  async (message, conn) => {
    if (!(await requireControl(conn, message))) return;
    const lang = await realLang();
    const mode = await getMode();
    const minis = getSubSessions().length;
    const ul = process.uptime();
    const pm2 = process.env.PM2_APP_NAME || "onyx";
    const extra = [];
    try { extra.push(`cwd=${global.__basedir}`); } catch {  }
    try { extra.push(`queue=${(await import("../enterprise/queue.js")).queueStats().length}`); } catch {  }
    await reply(conn, message, await tr(
      `🐞 *Debug*\n• pid ${process.pid} · uptime ${formatUptime(ul)}\n• node ${process.version} · pm2 ${pm2}\n• mode=${mode} · lang=${lang}\n• minis=${minis} · ${extra.join(" · ")}`,
      `🐞 *Debug*\n• pid ${process.pid} · Laufzeit ${formatUptime(ul)}\n• node ${process.version} · pm2 ${pm2}\n• mode=${mode} · lang=${lang}\n• minis=${minis} · ${extra.join(" · ")}`
    ));
  }
);

async function realLang() {
  try {
    const { getLang } = await import("../utils/i18n.js");
    return await getLang();
  } catch { return "en"; }
}

function resolveTargetUser(message) {
  const mentions = message?.message?.contextInfo?.mentionedJid || [];
  return mentions[0] || "";
}

command(
  { pattern: "setcreator", fromMe: false, desc: "Manage creator (host) numbers — add|del|list", type: "owner" },
  async (message, conn) => {
    if (!(await requireCreator(conn, message, "setcreator"))) return;
    const raw = (getCommandArgs(message.body, "setcreator") || "").trim();
    const [action, ...rest] = raw.split(/\s+/);
    const act = (action || "list").toLowerCase();

    if (act === "list" || !action) {
      const list = await listCreators();
      await reply(conn, message, await tr(
        `👤 *Creator numbers:*\n${list.length ? list.map((n) => `• ${n}`).join("\n") : "_(none — set via env CREATOR_NUMBERS or add with \`#setcreator add <num>\`)_"}`,
        `👤 *Ersteller-Nummern:*\n${list.length ? list.map((n) => `• ${n}`).join("\n") : "_(leer — über env CREATOR_NUMBERS setzen oder mit \`#setcreator add <num>\` hinzufügen)_"}`
      ));
      return;
    }

    let target = rest.join(" ").trim() || resolveTargetUser(message) || "";
    const mentions = message.message?.contextInfo?.mentionedJid || [];
    if (!target && mentions.length) target = mentions[0];
    const number = normalizeNumber(target);
    if (!number) {
      await replyFail(conn, message, await tr(`Usage: \`#setcreator add <number|@user>\` / \`#setcreator del <number|@user>\``, `Benutzung: \`#setcreator add <nummer|@user>\` / \`#setcreator del <nummer|@user>\``));
      return;
    }

    if (act === "add") {
      await addCreator(number);
      await replyOk(conn, message, await tr(`Added creator: *${number}*`, `Ersteller hinzugefügt: *${number}*`));
      return;
    }
    if (act === "del" || act === "remove" || act === "rm") {
      await removeCreator(number);
      await replyOk(conn, message, await tr(`Removed creator: *${number}*`, `Ersteller entfernt: *${number}*`));
      return;
    }
    await replyFail(conn, message, await tr("Unknown action. Use `list`, `add`, or `del`.", "Unbekannte Aktion. Benutze `list`, `add` oder `del`."));
  }
);

command(
  { pattern: "creatormenu", fromMe: false, desc: "Creator-only commands", type: "owner", dontAddCommandList: true },
  async (message, conn) => {
    if (!(await requireCreator(conn, message, "creatormenu"))) return;
    await reply(conn, message, await tr(
      [
        `🔐 *Creator menu* (host only)`,
        `• \`update\` — pull latest code & restart`,
        `• \`setcreator add|del|list <num>\` — manage creators (including you)`,
        `• \`setowner add|del|list <num>\` — manage owner (operator) numbers`,
        `• \`config set <any key>\` — freeform config:* writes`,
        `• Dashboard — reboot, shutdown, terminal (creator token)`,
        ``,
        `_Everyone else — even owners — gets the watching treatment. 👀_`,
      ].join("\n"),
      [
        `🔐 *Ersteller-Menü* (nur Host)`,
        `• \`update\` — Code pullen & neu starten`,
        `• \`setcreator add|del|list <nr>\` — Ersteller verwalten (auch dich)`,
        `• \`setowner add|del|list <nr>\` — Besitzer (Operator) verwalten`,
        `• \`config set <beliebiger Schlüssel>\` — freie config:*-Einträge`,
        `• Dashboard — Restart, Shutdown, Terminal (Ersteller-Token)`,
        ``,
        `_Alle anderen — auch Besitzer — bekommen die Überwachungs-Behandlung. 👀_`,
      ].join("\n")
    ));
  }
);

command(
  { pattern: "setowner", fromMe: false, desc: "Manage owner (operator) numbers — add|del|list (creator only)", type: "owner" },
  async (message, conn) => {
    if (!(await requireCreator(conn, message, "setowner"))) return;
    const raw = (getCommandArgs(message.body, "setowner") || "").trim();
    const [action, ...rest] = raw.split(/\s+/);
    const act = (action || "list").toLowerCase();

    if (act === "list" || !action) {
      const list = await getOwnerNumbers();
      await reply(conn, message, await tr(
        `👑 *Owner numbers:*\n${list.map((n) => `• ${n}`).join("\n") || "_(none)_"}`,
        `👑 *Besitzer-Nummern:*\n${list.map((n) => `• ${n}`).join("\n") || "_(keine)_"}`
      ));
      return;
    }

    let target = rest.join(" ").trim() || resolveTargetUser(message) || "";
    const mentions = message.message?.contextInfo?.mentionedJid || [];
    if (!target && mentions.length) target = mentions[0];
    const number = normalizeNumber(target);
    if (!number) {
      await replyFail(conn, message, await tr(`Usage: \`#setowner add <number|@user>\` / \`#setowner del <number|@user>\``, `Benutzung: \`#setowner add <nummer|@user>\` / \`#setowner del <nummer|@user>\``));
      return;
    }

    if (act === "add") {
      await addOwner(number);
      await replyOk(conn, message, await tr(`Added owner: *${number}*`, `Besitzer hinzugefügt: *${number}*`));
      return;
    }
    if (act === "del" || act === "remove" || act === "rm") {
      await removeOwner(number);
      await replyOk(conn, message, await tr(`Removed owner: *${number}*`, `Besitzer entfernt: *${number}*`));
      return;
    }
    await replyFail(conn, message, await tr("Unknown action. Use `list`, `add`, or `del`.", "Unbekannte Aktion. Benutze `list`, `add` oder `del`."));
  }
);