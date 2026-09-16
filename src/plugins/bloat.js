

import { command, getCommandsByType } from "../plugins.js";
import {
  reply,
  replyFail,
  getCommandArgs,
  tr,
} from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

command(
  { pattern: "bloatmode", fromMe: false, desc: "Open the ONYX BLOAT CORE menu", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const cmds = getCommandsByType("bloat").filter((c) => c.patternName);
    let text = "┌──────────────────────────┐\n";
    text += "│  *ONYX BLOAT CORE™*\n";
    text += await tr(`│  Commands: ${cmds.length}\n`, `│  Befehle: ${cmds.length}\n`);
    text += `│  Prefix: ${BOT_INFO.PREFIX}\n`;
    text += "└──────────────────────────┘\n\n";
    for (const cmd of cmds.sort((a, b) => a.patternName.localeCompare(b.patternName))) {
      text += `• \`${BOT_INFO.PREFIX}${cmd.patternName}\``;
      if (cmd.desc) text += ` — ${cmd.desc}`;
      text += "\n";
    }
    text += await tr("\n_Onyx BLOAT Core is not responsible for any lost brain cells._", "\n_Onyx BLOAT Core übernimmt keine Haftung für verlorene Gehirnzellen._");
    await reply(conn, message, text);
  }
);

command(
  { pattern: "rate", fromMe: false, desc: "I rate anything honestly", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const x = getCommandArgs(message.body, "rate")?.trim() || "air";
    await reply(conn, message, await tr(`I rate *${x}*: ${randInt(0, 10)}/10`, `Ich bewerte *${x}*: ${randInt(0, 10)}/10`));
  }
);

command(
  { pattern: "ship", fromMe: false, desc: "Ship two names", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const text = getCommandArgs(message.body, "ship") || "";
    if (!text.includes("+")) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}ship rem+tam\``, `Benutzung: \`${BOT_INFO.PREFIX}ship rem+tam\``)); return; }
    const [a, b] = text.split("+").map((s) => s.trim());
    const pct = randInt(0, 100);
    const verdict = pct > 80 ? (await tr("soulmates fr 💍", "Seelenverwandte fr 💍")) : pct > 50 ? (await tr("cute, maybe 👀", "niedlich, vielleicht 👀")) : pct > 20 ? (await tr("eh… friends 🤝", "ach… befreundet 🤝")) : (await tr("disaster 🚩", "Katastrophe 🚩"));
    await reply(conn, message, `*${a}* ❤️ *${b}*\nMatch: **${pct}%** — ${verdict}`);
  }
);

command(
  { pattern: "dice", fromMe: false, desc: "Roll a d6", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, await tr(`🎲 You rolled *${randInt(1, 6)}*`, `🎲 Du hast *${randInt(1, 6)}* gewürfelt`));
  }
);

command(
  { pattern: "flip", fromMe: false, desc: "Coin flip", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, await tr(`🪙 ${pick(["Heads", "Tails", "The edge?? How"])}`, `🪙 ${pick(["Kopf", "Zahl", "Die Kante?? Wie"])}`));
  }
);

command(
  { pattern: "say", fromMe: false, desc: "Make the bot repeat you", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const x = getCommandArgs(message.body, "say")?.trim();
    if (!x) { await replyFail(conn, message, await tr("Say what?", "Was soll ich sagen?")); return; }
    await reply(conn, message, `🗣️ ${x}`);
  }
);

command(
  { pattern: "screm", fromMe: false, desc: "Scream into the void", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, `A${"A".repeat(randInt(3, 12))}H${"!".repeat(randInt(1, 5))}`);
  }
);

command(
  { pattern: "how", fromMe: false, desc: "Measures anything", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const x = getCommandArgs(message.body, "how")?.trim() || "you";
    const adj = await tr(`*${x}* is ${randInt(0, 100)}% ${pick(["that", "this", "much", "something", "otherworldly"])}`, `*${x}* ist zu ${randInt(0, 100)}% ${pick(["das", "dieses", "soviel", "etwas", "jenseitig"])}`);
    await reply(conn, message, adj);
  }
);

command(
  { pattern: "pp", fromMe: false, desc: "Totally scientific pp size", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, `📏 ${"8" + "=".repeat(randInt(0, 12)) + "D"}`);
  }
);

command(
  { pattern: "mood", fromMe: false, desc: "Feel the vibes", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, await tr(`🌡️ Current mood: *${pick(["sleepy 🥱", "chaotic 🔥", "chill 🧊", "unhinged 🤡", "productive (lie) 📚", "caffeinated ☕", "zen 🧘", "menacing 👹"])}*`, `🌡️ Aktuelle Stimmung: *${pick(["schlafrig 🥱", "chaotisch 🔥", "entspannt 🧊", "durchgeknallt 🤡", "produktiv (gelogen) 📚", "koffeiniert ☕", "zen 🧘", "bedrohlich 👹"])}*`));
  }
);

command(
  { pattern: "8ball", fromMe: false, desc: "Ask the magic 8 ball", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const q = getCommandArgs(message.body, "8ball")?.trim();
    if (!q) { await replyFail(conn, message, await tr(`Ask something: \`${BOT_INFO.PREFIX}8ball will I win?\``, `Frag etwas: \`${BOT_INFO.PREFIX}8ball werde ich gewinnen?\``)); return; }
    await reply(conn, message, `🔮 "*${q}*"\n${pick((await tr(["It is certain ✅", "Ask again later ⏳", "Don't count on it 🚫", "Without a doubt 👍", "Very doubtful 🤨", "Signs point to yes ➡️✅", "My sources say no 📉", "Outlook good 🌤️"], ["Es ist sicher ✅", "Frag später nochmal ⏳", "Verlass dich nicht drauf 🚫", "Ohne Zweifel 👍", "Sehr zweifelhaft 🤨", "Alles deutet auf ja ➡️✅", "Meine Quellen sagen nein 📉", "Sieht gut aus 🌤️"])))}`);
  }
);

command(
  { pattern: "rng", fromMe: false, desc: "Random number 1..n", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const n = parseInt((getCommandArgs(message.body, "rng") || "100"), 10);
    if (!n || n < 2) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}rng 10\``, `Benutzung: \`${BOT_INFO.PREFIX}rng 10\``)); return; }
    await reply(conn, message, `🎰 ${randInt(1, n)}`);
  }
);

command(
  { pattern: "boo", fromMe: false, desc: "Boo", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, `👻 ${pick(["booo!", "BOO!!", "boo. (spooky but respectful)", "🐔 boo"])}`);
  }
);

command(
  { pattern: "sus", fromMe: false, desc: "Implying suspicion", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const x = getCommandArgs(message.body, "sus")?.trim() || "you";
    await reply(conn, message, `🕵️ *${x}* is ${randInt(0, 100)}% sus`);
  }
);

command(
  { pattern: "vibe", fromMe: false, desc: "Check your vibe", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    const x = getCommandArgs(message.body, "vibe")?.trim() || "you";
    const bars = "🟩".repeat(randInt(0, 5)) + "🟨".repeat(randInt(0, 5)) + "🟥".repeat(randInt(0, 5));
    await reply(conn, message, await tr(`🎧 *${x}* vibes:\n${bars || "…none. literally none."}`, `🎧 *${x}* Vibes:\n${bars || "…keine. wirklich keine."}`));
  }
);

command(
  { pattern: "amogus", fromMe: false, desc: "Amogus", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, "ඞ\n\n*amogus*");
  }
);

command(
  { pattern: "time", fromMe: false, desc: "Current time", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, `🕐 ${new Date().toLocaleTimeString()}`);
  }
);

command(
  { pattern: "date", fromMe: false, desc: "Current date", type: "bloat", dontAddCommandList: true },
  async (message, conn) => {
    await reply(conn, message, `📅 ${new Date().toLocaleDateString()}`);
  }
);