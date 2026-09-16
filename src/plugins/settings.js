

import { command } from "../plugins.js";
import { replyOk, getCommandArgs, tr } from "../utils/message.js";
import { kvGet, kvSet } from "../database/botKv.js";

command(
  { pattern: "anticall", fromMe: true, desc: "Auto-reject all incoming calls (global)", type: "owner" },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "anticall") || "").trim().toLowerCase();
    let val;
    if (args === "on" || args === "off") { val = args === "on"; await kvSet("anticall_global", val); }
    else { const cur = await kvGet("anticall_global"); val = !cur; await kvSet("anticall_global", val); }
    await replyOk(conn, message, await tr(`Anti-call: *${val ? "ON" : "OFF"}*`, `Anti-Anruf: *${val ? "AN" : "AUS"}*`));
  }
);

command(
  { pattern: "alwaysonline", fromMe: true, desc: "Keep bot permanently online (global)", type: "owner" },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "alwaysonline") || "").trim().toLowerCase();
    let val;
    if (args === "on" || args === "off") { val = args === "on"; await kvSet("alwaysonline_global", val); }
    else { const cur = await kvGet("alwaysonline_global"); val = !cur; await kvSet("alwaysonline_global", val); }
    if (val) { try { await conn.sendPresenceUpdate("available"); } catch {  } }
    await replyOk(conn, message, await tr(`Always-online: *${val ? "ON" : "OFF"}*`, `Immer-online: *${val ? "AN" : "AUS"}*`));
  }
);
