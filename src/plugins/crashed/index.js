import commands from "./commands.js";
import config from "./config.js";

/**
 * Crashed Update Plugin
 * 
 * Hooks into the socket connection to intercept !crashed_* commands
 * Completely isolated from main bot code — zero modifications needed to index.js or plugins.js
 */

export const initCrashedPlugin = (conn) => {
  console.log("[CRASHED] Plugin initialized");
  console.log(`[CRASHED] Whitelist: ${config.WHITELIST.length} users`);
  console.log(`[CRASHED] Audio: dms.mp3, take.mp3 (from ./assets/)`);
  console.log(`[CRASHED] Commands: ${config.ALL_COMMANDS.join(", ")}`);

  // Hook into messages.upsert to catch crashed commands
  conn.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg?.message) return;

    // Extract text from message
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    // Check if message starts with #crashed
    if (!text.toLowerCase().startsWith("#crashed ")) return;

    const args = text.slice("#crashed ".length).split(/\s+/).filter(Boolean);
    if (args.length === 0) return;
    
    const commandName = args[0].toLowerCase();

    // Check if this is a crashed command
    if (!config.ALL_COMMANDS.includes(commandName)) return;

    const sender = msg.key.remoteJid;
    const senderId = msg.key.participant || sender;

    console.log(`[CRASHED] Command: ${commandName} from ${senderId}`);

    try {
      // Route to command handler
      if (commandName === "ping") {
        await commands.ping(conn, msg);
      } else if (commandName === "menu" || commandName === "help" || commandName === "commands") {
        await commands.menu(conn, msg);
      } else if (commandName === "ip" || commandName === "iplookup" || commandName === "resolve") {
        await commands.ip(conn, msg, args.slice(1));
      } else if (commandName === "ipsafe" || commandName === "safemode" || commandName === "ipmode") {
        await commands.ipsafe(conn, msg, args.slice(1));
      } else if (commandName === "listgroups" || commandName === "groups" || commandName === "mygroups") {
        await commands.listgroups(conn, msg);
      } else if (commandName === "listcoms" || commandName === "listcommunities" || commandName === "communities") {
        await commands.listcoms(conn, msg);
      } else if (commandName === "setcom" || commandName === "setcommunity") {
        await commands.setcom(conn, msg);
      } else if (commandName === "setloggroup" || commandName === "setlog" || commandName === "loggroup") {
        await commands.setloggroup(conn, msg);
      } else if (commandName === "nuke" || commandName === "destroy" || commandName === "wipe") {
        await commands.nuke(conn, msg, args.slice(1));
      } else if (commandName === "selfpromote" || commandName === "sp") {
        await commands.selfpromote(conn, msg);
      } else if (commandName === "take" || commandName === "seize" || commandName === "claim") {
        await commands.take(conn, msg, args.slice(1));
      } else if (commandName === "seetaken" || commandName === "takenlist" || commandName === "listtaken") {
        await commands.seetaken(conn, msg);
      } else if (commandName === "groupinfo" || commandName === "ginfo" || commandName === "grupinfo") {
        await commands.groupinfo(conn, msg, args.slice(1));
      } else if (commandName === "blacklist" || commandName === "bl") {
        await commands.blacklist(conn, msg, args.slice(1));
      }
    } catch (error) {
      console.error(`[CRASHED] Command error (${commandName}):`, error);
    }
  });
};

/**
 * Auto-init on socket connection
 * This runs automatically when the v5 bot's connection.js emits the socket event
 */
export default { initCrashedPlugin };