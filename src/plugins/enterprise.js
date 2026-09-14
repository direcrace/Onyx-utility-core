/**
 * Enterprise commands: audit, flags, policy, role, backup, metrics
 */

import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  withTyping,
  tr,
} from "../utils/message.js";
import { writeAudit, queryAudit, clearAudit } from "../enterprise/audit.js";
import { getFlags, setFlag, COMMAND_FLAGS } from "../enterprise/flags.js";
import { getPolicies, setPolicy } from "../enterprise/policy.js";
import {
  setUserRole,
  listRoles,
  resolveRole,
  can,
  ROLES,
} from "../enterprise/rbac.js";
import { createBackup } from "../enterprise/backup.js";
import { getMetricsSnapshot } from "../enterprise/metrics.js";
import { queueStats } from "../enterprise/queue.js";
import { isLogGroupAsync } from "../utils/logGroup.js";
import {
  isOwnerMessage,
  isPrivileged,
  normalizeNumber,
} from "../utils/access.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import { BOT_INFO } from "../config/constants.js";
import fs from "fs/promises";

async function requireLogGroup(message) {
  return isLogGroupAsync(message.from);
}

command(
  {
    pattern: "audit",
    fromMe: true,
    desc: "Show audit log (system group)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "audit.read"))) {
      await replyFail(conn, message, await tr("No permission.", "Keine Berechtigung."));
      return;
    }
    if (!(await requireLogGroup(message))) {
      await replyFail(conn, message, await tr("Use `#audit` only in the *system log group*.", "Benutze `#audit` nur in der *System-Log-Gruppe*."));
      return;
    }

    const raw = (getCommandArgs(message.body, "audit") || "").trim();
    if (raw === "clear" && isOwnerMessage(message, conn)) {
      await clearAudit();
      await writeAudit({
        action: "audit.clear",
        actor: message.sender,
        chat: message.from,
      });
      await replyOk(conn, message, await tr("Audit log cleared.", "Audit-Log geleert."));
      return;
    }

    const [filter, lim] = raw.split(/\s+/);
    const limit = parseInt(lim || filter, 10);
    const rows = await queryAudit({
      limit: Number.isFinite(limit) ? limit : 15,
      action: Number.isFinite(limit) ? undefined : filter || undefined,
    });

    if (!rows.length) {
      await reply(conn, message, await tr("*Audit:* _(empty)_", "*Audit:* _(leer)_"));
      return;
    }

    const lines = rows.map((r) => {
      const t = new Date(r.ts).toISOString().slice(5, 19).replace("T", " ");
      return `• \`${t}\` *${r.action}* by ${r.actor}` +
        (r.target ? ` → ${r.target}` : "") +
        (r.chat ? `\n  chat:${r.chat}` : "");
    });
    await reply(conn, message, await tr(`*Audit (latest)*\n${lines.join("\n")}`, `*Audit (aktuell)*\n${lines.join("\n")}`));
  }
);

command(
  {
    pattern: "flag",
    fromMe: true,
    desc: "Feature flags: #flag list | #flag media off",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "flag")) && !(await isPrivileged(message, conn))) {
      await replyFail(conn, message, await tr("No permission.", "Keine Berechtigung."));
      return;
    }

    const raw = (getCommandArgs(message.body, "flag") || "").trim();
    if (!raw || raw === "list") {
      const flags = await getFlags();
      const lines = Object.entries(flags)
        .map(([k, v]) => `• ${k}: *${v ? "ON" : "OFF"}*`)
        .join("\n");
      await reply(
        conn,
        message,
        await tr(
          `*Feature flags*\n${lines}\n\n` +
            `Mapped cmds: ${Object.keys(COMMAND_FLAGS).slice(0, 12).join(", ")}…\n` +
            `Usage: \`${BOT_INFO.PREFIX}flag <name> on|off\``,
          `*Feature-Flags*\n${lines}\n\n` +
            `Zugeordnete Befehle: ${Object.keys(COMMAND_FLAGS).slice(0, 12).join(", ")}…\n` +
            `Benutzung: \`${BOT_INFO.PREFIX}flag <name> on|off\``
        )
      );
      return;
    }

    const [name, state] = raw.split(/\s+/);
    if (!name || !["on", "off", "true", "false", "1", "0"].includes((state || "").toLowerCase())) {
      await replyFail(
        conn,
        message,
        await tr(`Usage: \`${BOT_INFO.PREFIX}flag media off\``, `Benutzung: \`${BOT_INFO.PREFIX}flag media off\``)
      );
      return;
    }
    const on = ["on", "true", "1"].includes(state.toLowerCase());
    const flags = await setFlag(name, on);
    await writeAudit({
      action: "flag.set",
      actor: message.sender,
      meta: { name, on },
      chat: message.from,
    });
    await replyOk(conn, message, await tr(`Flag *${name}* → *${flags[name] ? "ON" : "OFF"}*`, `Flag *${name}* → *${flags[name] ? "AN" : "AUS"}*`));
  }
);

command(
  {
    pattern: "policy",
    fromMe: true,
    desc: "View/set global policies",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "policy"))) {
      await replyFail(conn, message, await tr("No permission.", "Keine Berechtigung."));
      return;
    }
    const raw = (getCommandArgs(message.body, "policy") || "").trim();
    if (!raw || raw === "list") {
      const p = await getPolicies();
      await reply(
        conn,
        message,
        await tr(
          `*Policies*\n${Object.entries(p)
            .map(([k, v]) => `• ${k}: \`${v}\``)
            .join("\n")}\n\n` +
            `Set: \`${BOT_INFO.PREFIX}policy rateLimitPerUser 30\``,
          `*Richtlinien*\n${Object.entries(p)
            .map(([k, v]) => `• ${k}: \`${v}\``)
            .join("\n")}\n\n` +
            `Setzen: \`${BOT_INFO.PREFIX}policy rateLimitPerUser 30\``
        )
      );
      return;
    }

    const [key, ...rest] = raw.split(/\s+/);
    let value = rest.join(" ").trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "null" || value === "none") value = null;
    else if (/^\d+$/.test(value)) value = Number(value);

    const p = await setPolicy(key, value);
    await writeAudit({
      action: "policy.set",
      actor: message.sender,
      meta: { key, value },
      chat: message.from,
    });
    await replyOk(conn, message, await tr(`Policy *${key}* = \`${p[key]}\``, `Richtlinie *${key}* = \`${p[key]}\``));
  }
);

command(
  {
    pattern: "role",
    fromMe: true,
    desc: "RBAC: #role set @user admin | list",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "role.manage")) && !isOwnerMessage(message, conn)) {
      await replyFail(conn, message, await tr("Owner/admin only.", "Nur Besitzer/Admin."));
      return;
    }

    const raw = (getCommandArgs(message.body, "role") || "").trim();
    if (!raw || raw === "list") {
      const map = await listRoles();
      const entries = Object.entries(map);
      if (!entries.length) {
        await reply(conn, message, await tr("*Roles:* _(none — sudo defaults to admin)_", "*Rollen:* _(keine — sudo hat standardmäßig admin)_"));
        return;
      }
      await reply(
        conn,
        message,
        await tr(`*Roles*\n${entries.map(([n, r]) => `• ${n}: *${r}*`).join("\n")}`, `*Rollen*\n${entries.map(([n, r]) => `• ${n}: *${r}*`).join("\n")}`)
      );
      return;
    }

    const [action, a2, a3] = raw.split(/\s+/);
    if (action === "me") {
      const r = await resolveRole(message, conn);
      await reply(conn, message, await tr(`Your role: *${r}*`, `Deine Rolle: *${r}*`));
      return;
    }

    if (action === "set") {
      let target = a2;
      let role = a3;
      if (!role) {
        role = a2;
        target = resolveTargetUser(message);
      }
      const n = normalizeNumber(target);
      if (!n || !role) {
        await replyFail(
          conn,
          message,
          await tr(`Usage: \`${BOT_INFO.PREFIX}role set @user admin\`\nRoles: ${ROLES.filter((r) => r !== "owner").join(", ")}`, `Benutzung: \`${BOT_INFO.PREFIX}role set @user admin\`\nRollen: ${ROLES.filter((r) => r !== "owner").join(", ")}`)
        );
        return;
      }
      try {
        const r = await setUserRole(n, role);
        await writeAudit({
          action: "role.set",
          actor: message.sender,
          target: n,
          meta: { role: r },
        });
        await replyOk(conn, message, await tr(`Set *${n}* → *${r}*`, `Gesetzt *${n}* → *${r}*`));
      } catch (err) {
        await replyFail(conn, message, err.message);
      }
      return;
    }

    await replyFail(conn, message, await tr("Use `list`, `me`, or `set`.", "Benutze `list`, `me` oder `set`."));
  }
);

command(
  {
    pattern: "backup",
    fromMe: true,
    desc: "Export BotKV backup (optional auth db)",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "backup")) && !isOwnerMessage(message, conn)) {
      await replyFail(conn, message, await tr("No permission.", "Keine Berechtigung."));
      return;
    }

    const raw = (getCommandArgs(message.body, "backup") || "").trim().toLowerCase();
    const includeAuth = raw === "full" || raw === "auth";

    await withTyping(conn, message.from, async () => {
      try {
        const { jsonPath, dbCopy, checksum } = await createBackup({
          includeAuth,
        });
        await writeAudit({
          action: "backup.create",
          actor: message.sender,
          meta: { includeAuth, checksum },
          chat: message.from,
        });

        const buf = await fs.readFile(jsonPath);
        await conn.sendMessage(message.from, {
          document: buf,
          mimetype: "application/json",
          fileName: `xasena-backup-${checksum}.json`,
          caption: await tr(`✅ Backup ready\nSHA256∶ \`${checksum}\``, `✅ Backup bereit\nSHA256∶ \`${checksum}\``) +
            (dbCopy ? await tr(`\nDB copy: \`${dbCopy}\``, `\nDB-Kopie: \`${dbCopy}\``) : ""),
        });
      } catch (err) {
        await replyFail(conn, message, err?.message || await tr("Backup failed", "Backup fehlgeschlagen"));
      }
    });
  }
);

command(
  {
    pattern: "metrics",
    fromMe: true,
    desc: "Show runtime metrics",
    type: "owner",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, await tr("Owner/sudo only.", "Nur Besitzer/Sudo."));
      return;
    }
    const m = getMetricsSnapshot();
    const q = queueStats();
    await reply(
      conn,
      message,
      await tr(
        `*Metrics*\n` +
          `• Uptime: ${m.uptime_s}s\n` +
          `• Commands: ${m.counters.commands || 0}\n` +
          `• Errors: ${m.counters.errors || 0} (last min: ${m.errors_last_min})\n` +
          `• Jobs ok/fail: ${m.counters.jobs_ok || 0}/${m.counters.jobs_fail || 0}\n` +
          `• Avg job ms: ${m.avg_job_ms}\n` +
          `• Queue: ${q.active} active / ${q.pending} pending\n` +
          `• Tenant: \`${process.env.TENANT_ID || "default"}\``,
        `*Metriken*\n` +
          `• Laufzeit: ${m.uptime_s}s\n` +
          `• Befehle: ${m.counters.commands || 0}\n` +
          `• Fehler: ${m.counters.errors || 0} (letzte Min: ${m.errors_last_min})\n` +
          `• Jobs ok/fehlgeschlagen: ${m.counters.jobs_ok || 0}/${m.counters.jobs_fail || 0}\n` +
          `• Durchschn. Job ms: ${m.avg_job_ms}\n` +
          `• Warteschlange: ${q.active} aktiv / ${q.pending} wartend\n` +
          `• Tenant: \`${process.env.TENANT_ID || "default"}\``
      )
    );
  }
);
