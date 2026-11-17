

import { command } from "../plugins.js";
import { reply, replyFail, getCommandArgs, withTyping, tr } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";

function factorial(n) {
  n = Math.round(Number(n));
  if (n < 0 || !isFinite(n)) throw new Error("Invalid factorial");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function evaluateMath(expr, variableValue = null) {
  let e = String(expr)
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/√\s*\(/g, "Math.sqrt(")
    .replace(/sqrt\s*\(/g, "Math.sqrt(")
    .replace(/\^/g, "**")
    .replace(/(\d+)!/g, "fact($1)")
    .replace(/π|(^|[^a-zA-Z])pi([^a-zA-Z]|$)/gi, `$1(${Math.PI})$2`);
  e = e.replace(/[^0-9+\-*/%.()a-zA-Z]/g, "");
  if (variableValue != null) {
    const v = `(${variableValue})`;
    e = e
      .replace(/(^|[^a-zA-Z.\d)])x(?![a-zA-Z.])/gi, `$1${v}`)
      .replace(/([\d)])x(?![a-zA-Z.])/gi, `$1*${v}`);
  }
  e = e.replace(/(?<![a-zA-Z.])e(?![a-zA-Z.])/gi, `(${Math.E})`);
  const fn = new Function("Math", "fact", `"use strict"; return (${e})`);
  const result = fn(Math, factorial);
  if (typeof result !== "number" || !isFinite(result)) throw new Error("Invalid");
  return result;
}

function near(n, eps = 1e-9) {
  if (Math.abs(n - Math.round(n)) < eps) return Math.round(n);
  return parseFloat(n.toFixed(10));
}

command(
  { pattern: "cal", fromMe: false, desc: "Math calculator (+, -, *, /, ^, %, !, sqrt()", type: "fun" },
  async (message, conn) => {
    const text = getCommandArgs(message.body, "cal");
    if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}cal sqrt(16)+2^3*3!\``, `Benutzung: \`${BOT_INFO.PREFIX}cal sqrt(16)+2^3*3!\``)); return; }
    try {
      const result = evaluateMath(text);
      await reply(conn, message, `*${text}* = ${result}`);
    } catch { await replyFail(conn, message, await tr("Invalid expression.", "Ungültiger Ausdruck.")); }
  }
);

command(
  { pattern: "solve", fromMe: false, desc: "Solve linear/quadratic equations (e.g. x^2-4=0)", type: "fun" },
  async (message, conn) => {
    const eq = getCommandArgs(message.body, "solve")?.trim();
    if (!eq || !eq.includes("=")) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}solve 2x+3=7\` or \`${BOT_INFO.PREFIX}solve x^2-4=0\``, `Benutzung: \`${BOT_INFO.PREFIX}solve 2x+3=7\` oder \`${BOT_INFO.PREFIX}solve x^2-4=0\``)); return; }
    const [lhs, ...rest] = eq.split("=");
    if (!lhs || !rest.length) { await replyFail(conn, message, await tr("Invalid equation.", "Ungültige Gleichung.")); return; }
    const rhs = rest.join("=");
    try {
      const fAt = (v) => evaluateMath(lhs, v) - evaluateMath(rhs, v);
      const f0 = fAt(0), f1 = fAt(1), f2 = fAt(2);
      const a = (f2 - 2 * f1 + f0) / 2;
      const b = f1 - f0 - a;
      const c = f0;
      if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) < 1e-9) { await replyFail(conn, message, await tr("No variable x found in equation.", "Keine Variable x in der Gleichung gefunden.")); return; }
        const x = near(-c / b);
        await reply(conn, message, await tr(`*${eq}*\n\nLinear: (${near(b)})x + (${near(c)}) = 0\n**x = ${x}**`, `*${eq}*\n\nLinear: (${near(b)})x + (${near(c)}) = 0\n**x = ${x}**`));
        return;
      }
      let D = b * b - 4 * a * c;
      if (D < -1e-9) { await replyFail(conn, message, await tr(`*${eq}*\n\nNo real roots (D = ${near(D)} < 0).`, `*${eq}*\n\nKeine reellen Nullstellen (D = ${near(D)} < 0).`)); return; }
      if (D < 0) D = 0;
      const sqrtD = Math.sqrt(D);
      const x1 = near((-b + sqrtD) / (2 * a));
      const x2 = near((-b - sqrtD) / (2 * a));
      await reply(conn, message, await tr(
        `*${eq}*\n\nStandard: (${near(a)})x² + (${near(b)})x + (${near(c)}) = 0\nDiscriminant: ${near(D)}\n\n*x₁ = ${x1}*\n*x₂ = ${x2}*`,
        `*${eq}*\n\nStandardform: (${near(a)})x² + (${near(b)})x + (${near(c)}) = 0\nDiskriminante: ${near(D)}\n\n*x₁ = ${x1}*\n*x₂ = ${x2}*`
      ));
    } catch (err) { await replyFail(conn, message, await tr(`Could not solve: ${err?.message || "invalid input"}`, `Lösung fehlgeschlagen: ${err?.message || "ungültige Eingabe"}`)); }
  }
);

command(
  { pattern: "ebinary", fromMe: false, desc: "Encode text to binary", type: "fun" },
  async (message, conn) => {
    const text = getCommandArgs(message.body, "ebinary");
    if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}ebinary <text>\``, `Benutzung: \`${BOT_INFO.PREFIX}ebinary <text>\``)); return; }
    await reply(conn, message, [...text].map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" "));
  }
);

command(
  { pattern: "dbinary", fromMe: false, desc: "Decode binary to text", type: "fun" },
  async (message, conn) => {
    const text = getCommandArgs(message.body, "dbinary");
    if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}dbinary <binary>\``, `Benutzung: \`${BOT_INFO.PREFIX}dbinary <binär>\``)); return; }
    try { await reply(conn, message, text.split(" ").map((b) => String.fromCharCode(parseInt(b, 2))).join("")); }
    catch { await replyFail(conn, message, await tr("Invalid binary string.", "Ungültiger Binärstring.")); }
  }
);

command(
  { pattern: "mock", fromMe: false, desc: "SpongeBob mock text", type: "fun" },
  async (message, conn) => {
    const text = getCommandArgs(message.body, "mock") || message.quoted?.text || "";
    if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}mock <text>\``, `Benutzung: \`${BOT_INFO.PREFIX}mock <text>\``)); return; }
    await reply(conn, message, [...text].map((c, i) => /[a-z]/i.test(c) ? (i % 2 ? c.toUpperCase() : c.toLowerCase()) : c).join(""));
  }
);

command(
  { pattern: "flirt", fromMe: false, desc: "Random flirt text", type: "fun" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get("https://shizoapi.onrender.com/api/texts/flirt?apikey=shizo");
        await reply(conn, message, res.data?.result || "Connection error.");
      } catch { await replyFail(conn, message, await tr("Could not fetch flirt text.", "Konnte Flirt-Text nicht abrufen.")); }
    });
  }
);

command(
  { pattern: "emix", fromMe: false, desc: "Mix two emojis into a sticker", type: "fun" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "emix");
      if (!text || !text.includes("+")) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}emix 😅+🤔\``, `Benutzung: \`${BOT_INFO.PREFIX}emix 😅+🤔\``)); return; }
      const [emoji1, emoji2] = text.split("+").map((s) => s.trim());
      if (!emoji1 || !emoji2) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}emix 😅+🤔\``, `Benutzung: \`${BOT_INFO.PREFIX}emix 😅+🤔\``)); return; }
      const tenorKey = process.env.TENOR_API_KEY;
      if (!tenorKey) { await replyFail(conn, message, await tr("Emoji mix is not configured (missing TENOR_API_KEY).", "Emoji-Mischung ist nicht konfiguriert (TENOR_API_KEY fehlt).")); return; }
      try {
        const fetch = (await import("node-fetch")).default;
        const res = await fetch(`https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(tenorKey)}&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}`);
        const data = await res.json();
        if (!data.results?.length) { await replyFail(conn, message, await tr("No mix found.", "Keine Emoji-Mischung gefunden.")); return; }
        for (const r of data.results) {
          await conn.sendMessage(message.from, { sticker: { url: r.url } },
            { quoted: { key: message.key, message: message.message } });
        }
      } catch { await replyFail(conn, message, await tr("Emoji mix failed.", "Emoji-Mischung fehlgeschlagen.")); }
    });
  }
);

const REACTIONS = ["cry","kiss","kill","hug","pat","lick","bite","yeet","bully","bonk","wink","poke","nom","slap","smile","wave","awoo","blush","smug","dance","happy","sad","cuddle","glomp","highfive"];

for (const reaction of REACTIONS) {
  command(
    { pattern: reaction, fromMe: false, desc: `Send a ${reaction} reaction`, type: "fun" },
    async (message, conn) => {
      await withTyping(conn, message.from, async () => {
        try {
          const axios = (await import("axios")).default;
          const { data } = await axios.get(`https://api.waifu.pics/sfw/${reaction}`);
          if (data?.url) { await conn.sendMessage(message.from, { image: { url: data.url }, caption: `*${reaction}*` },
            { quoted: { key: message.key, message: message.message } }); }
          else { await replyFail(conn, message, await tr("Could not fetch reaction.", "Konnte Reaktion nicht abrufen.")); }
        } catch { await replyFail(conn, message, await tr("Reaction fetch failed.", "Reaktion abrufen fehlgeschlagen.")); }
      });
    }
  );
}
