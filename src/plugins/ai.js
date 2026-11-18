

import { command, findCommand } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, tr } from "../utils/message.js";
import { BOT_INFO, getPrefix } from "../config/constants.js";
import {
  getHistory,
  addMessage,
  clearHistory,
  getSystemPrompt,
  setSystemPrompt,
  isChatbotEnabled,
  toggleChatbot,
  isUserAllowed,
  addUser,
  removeUser,
  listAllowedUsers,
  rememberAiMessage,
  isAiMessage,
} from "../utils/aiHistory.js";
import { isPrivileged } from "../utils/access.js";
import { isBotBanned } from "../utils/globalBan.js";
import { systemLog } from "../utils/logGroup.js";

function quotedMessageId(message) {
  const ctx = message?.message?.contextInfo || {};
  return ctx.stanzaId || message?.quoted?.id || message?.quoted?.key?.id || null;
}

async function isReplyToAi(message) {
  // Only a reply to a message we actually produced as an AI answer may bypass
  // the chatbot on/off and allowlist gates. The previous heuristic treated any
  // reply to any bot message as an AI thread, which made `#chatbot off` answer
  // to everything.
  const id = quotedMessageId(message);
  return !!(id && (await isAiMessage(id)));
}

const LM_URL = "http://localhost:1234/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function callLMStudio(messages, { timeoutMs = 90_000 } = {}) {
  const model = process.env.LM_STUDIO_MODEL || "local-model";
  const axios = (await import("axios")).default;
  const res = await axios.post(
    LM_URL,
    { model, messages, temperature: 0.7, max_tokens: 2048 },
    { timeout: timeoutMs, headers: { "Content-Type": "application/json" } }
  );
  return {
    content: res.data?.choices?.[0]?.message?.content || "(no response)",
    backend: "LM Studio",
  };
}

async function callGroq(messages, { timeoutMs = 60_000 } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const axios = (await import("axios")).default;
  const res = await axios.post(
    GROQ_URL,
    { model, messages, temperature: 0.7, max_tokens: 2048 },
    { timeout: timeoutMs, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` } }
  );
  return {
    content: res.data?.choices?.[0]?.message?.content || "(no response)",
    backend: "Groq",
  };
}

async function callAI(messages) {
  try {
    return await callLMStudio(messages);
  } catch {
    return await callGroq(messages);
  }
}

command(
  { pattern: "chat", fromMe: false, desc: "Chat with LM Studio AI", type: "ai" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "chat") || message.quoted?.text || "";
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}chat <text>\``, `Benutzung: \`${BOT_INFO.PREFIX}chat <text>\``)); return; }
      try {
        const history = await getHistory(message.sender);
        const sys = await getSystemPrompt();
        const msgs = [];
        if (sys) msgs.push({ role: "system", content: sys });
        msgs.push(...history, { role: "user", content: text });
        const { content: reply_text, backend } = await callAI(msgs);
        await addMessage(message.sender, { role: "user", content: text });
        await addMessage(message.sender, { role: "assistant", content: reply_text });
        const note = backend === "Groq" ? `\n\n_via ${backend}_` : "";
        const sent = await reply(conn, message, reply_text + note);
        await rememberAiMessage(sent?.key?.id || sent?.id);
      } catch (err) {
        await replyFail(conn, message, await tr(`AI error: ${err?.message || "LM Studio not running?"}`, `KI-Fehler: ${err?.message || "LM Studio läuft nicht?"}`));
      }
    }, { timeoutMs: 120_000 });
  }
);

command(
  { pattern: "chatbot", fromMe: true, desc: "Toggle chatbot auto-reply", type: "owner" },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "chatbot") || "").trim().toLowerCase();
    if (args === "on" || args === "off") {
      await toggleChatbot(args === "on");
      await replyOk(conn, message, `Chatbot: *${args === "on" ? "ON" : "OFF"}*`);
    } else if (args === "status" || args === "state") {
      const cur = await isChatbotEnabled();
      await replyOk(conn, message, `Chatbot: *${cur ? "ON" : "OFF"}*`);
    } else {
      const cur = await isChatbotEnabled();
      await toggleChatbot(!cur);
      await replyOk(conn, message, `Chatbot: *${!cur ? "ON" : "OFF"}*`);
    }
  }
);

command(
  { pattern: "aiprompt", fromMe: true, desc: "Set AI system prompt", type: "owner" },
  async (message, conn) => {
    const text = getCommandArgs(message.body, "aiprompt") || "";
    if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}aiprompt <system prompt>\``, `Benutzung: \`${BOT_INFO.PREFIX}aiprompt <system-prompt>\``)); return; }
    await setSystemPrompt(text);
    await replyOk(conn, message, await tr("System prompt updated.", "System-Prompt aktualisiert."));
  }
);

command(
  { pattern: "aiclear", fromMe: false, desc: "Clear your AI conversation history", type: "ai" },
  async (message, conn) => {
    await clearHistory(message.sender);
    await replyOk(conn, message, await tr("AI history cleared.", "KI-Verlauf gelöscht."));
  }
);

command(
  { pattern: "aiuser", fromMe: true, desc: "Manage chatbot allowed users", type: "owner" },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "aiuser") || "").trim();
    const [action, ...rest] = args.split(/\s+/);
    const act = (action || "list").toLowerCase();
    if (act === "list") {
      const list = await listAllowedUsers();
      if (!list.length) { await reply(conn, message, await tr("*Allowed users:* _(empty)_", "*Erlaubte Nutzer:* _(leer)_")); return; }
      await reply(conn, message, await tr(`*Allowed users:*\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}`, `*Erlaubte Nutzer:*\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}`));
      return;
    }
    const target = rest.join(" ").trim();
    if (!target) { await replyFail(conn, message, await tr("Provide a number.", "Eine Nummer angeben.")); return; }
    if (act === "add") { await addUser(target); await replyOk(conn, message, await tr(`Added: ${target}`, `Hinzugefügt: ${target}`)); }
    else if (act === "del" || act === "rm") { await removeUser(target); await replyOk(conn, message, await tr(`Removed: ${target}`, `Entfernt: ${target}`)); }
  }
);

export async function handleChatbotReply({ message, conn }) {
  try {
    if (message?.key?.fromMe) return;
    const text = message.body || "";
    if (!text || text.startsWith(getPrefix())) return;

    const sender = message.sender || "";
    if (await isBotBanned(sender)) return;

    // Replying to a remembered AI answer always continues that conversation —
    // even when chatbot mode is off or the user is not on the allowlist.
    // Everything else still needs chatbot mode plus the allowlist/rank gate.
    const threadReply = await isReplyToAi(message);
    if (!threadReply) {
      if (!(await isChatbotEnabled())) return;
      const allowed = await isUserAllowed(sender);
      const privileged = await isPrivileged(message, conn);
      if (!allowed && !privileged) return;
    }
    const history = await getHistory(sender);
    const sys = await getSystemPrompt();
    const msgs = [];
    if (sys) msgs.push({ role: "system", content: sys });
    msgs.push(...history, { role: "user", content: text });
    const { content: reply_text } = await callAI(msgs);
    await addMessage(sender, { role: "user", content: text });
    await addMessage(sender, { role: "assistant", content: reply_text });
    const sent = await conn.sendMessage(
      message.from,
      { text: reply_text },
      { quoted: { key: message.key, message: message.message } }
    );
    await rememberAiMessage(sent?.key?.id || sent?.id);
  } catch (err) {
    await systemLog("error", `AI reply failed: ${err?.message || "unknown error"}`);
    try {
      await replyFail(conn, message, await tr("AI error while continuing the conversation.", "KI-Fehler beim Fortsetzen der Unterhaltung."));
    } catch {  }
  }
}
