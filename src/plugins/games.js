

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, getMentions, getQuotedParticipant, tr } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { doJob, claimDaily, rob, gamble, getWallet, getLeaderboard, ECONOMY } from "../utils/economy.js";
import { startSession, endSession, getSession, routeGameTurn, parseTttMove, renderTtt, tttWinner, pickHangmanWord, renderHangman } from "../utils/gameCore.js";
import { normalizeNumber } from "../utils/access.js";

function fmtWait(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function mentionText(jid) {
  return jid && jid.includes("@") ? `@${jid.split("@")[0]}` : "?";
}

function isBotNumber(conn, jid) {
  const nums = new Set();
  if (conn?.user?.id) nums.add(normalizeNumber(conn.user.id));
  if (conn?.user?.lid) nums.add(normalizeNumber(conn.user.lid));
  return nums.has(normalizeNumber(jid));
}

async function gameActive(conn, message) {
  const s = getSession(message.from);
  if (!s) return false;
  await replyFail(conn, message, await tr(`A *${s.kind}* game is already running here. \`#stopgame\` to end it.`, `Hier läuft bereits ein *${s.kind}*-Spiel. \`#stopgame\` zum Beenden.`));
  return true;
}

command(
  { pattern: "job", fromMe: false, desc: "Work a shift & earn coins", type: "fun" },
  async (message, conn) => {
    const res = await doJob(message.sender, message.pushName);
    if (res.ok) {
      return replyOk(conn, message, await tr(
        `💰 Paid *${res.payout}* coins (shift ${res.streak}/${ECONOMY.JOB_MAX_WITHIN}). Balance: *${res.balance}*`,
        `💰 *${res.payout}* Münzen erhalten (Schicht ${res.streak}/${ECONOMY.JOB_MAX_WITHIN}). Kontostand: *${res.balance}*`
      ));
    }
    if (res.reason === "cooldown") {
      return replyFail(conn, message, await tr(`😪 Rest a bit — next shift in ${fmtWait(res.wait)}.`, `😪 Kurze Pause — nächste Schicht in ${fmtWait(res.wait)}.`));
    }
    if (res.reason === "tired") {
      return replyFail(conn, message, await tr(`🥵 You're exhausted! Come back in ${fmtWait(res.wait)}.`, `🥵 Du bist erschöpft! Komm in ${fmtWait(res.wait)} zurück.`));
    }
    return replyFail(conn, message, await tr("Something went wrong.", "Etwas ist schiefgelaufen."));
  }
);

command(
  { pattern: "daily", fromMe: false, desc: "Claim your daily bonus (24h)", type: "fun" },
  async (message, conn) => {
    const res = await claimDaily(message.sender, message.pushName);
    if (res.ok) {
      return replyOk(conn, message, await tr(
        `🎁 Daily bonus: *${res.bonus}* coins. Balance: *${res.balance}*`,
        `🎁 Tagesbonus: *${res.bonus}* Münzen. Kontostand: *${res.balance}*`
      ));
    }
    if (res.reason === "cooldown") {
      return replyFail(conn, message, await tr(`🎁 Next daily in ${fmtWait(res.wait)}.`, `🎁 Nächster Tagesbonus in ${fmtWait(res.wait)}.`));
    }
    return replyFail(conn, message, await tr("Something went wrong.", "Etwas ist schiefgelaufen."));
  }
);

command(
  { pattern: "balance", fromMe: false, desc: "Show your coin balance & stats", type: "fun" },
  async (message, conn) => {
    const w = await getWallet(message.sender, message.pushName);
    if (!w) return replyFail(conn, message, await tr("Could not read wallet.", "Konto konnte nicht gelesen werden."));
    const lb = await getLeaderboard();
    const rank = lb.findIndex((e) => e.n === w._n) + 1;
    await reply(conn, message, await tr(
      `💰 *Coin Wallet*\n• Balance: *${w.balance}*\n• Total earned: ${w.totalEarned}\n• Jobs: ${w.jobs} · Rob ${w.robWins}W/${w.robLosses}L\n• Gambles: ${w.gambles} (${w.gamblesWon} won)${rank ? `\n• Rank: #${rank}` : ""}`,
      `💰 *Münz-Konto*\n• Kontostand: *${w.balance}*\n• Gesamt verdient: ${w.totalEarned}\n• Jobs: ${w.jobs} · Raub ${w.robWins}W/${w.robLosses}L\n• Wetten: ${w.gambles} (${w.gamblesWon} gewonnen)${rank ? `\n• Rang: #${rank}` : ""}`
    ));
  }
);

command(
  { pattern: "bal", fromMe: false, desc: "Alias for #balance", type: "fun", dontAddCommandList: true },
  async (message, conn) => {
    const w = await getWallet(message.sender, message.pushName);
    if (!w) return replyFail(conn, message, await tr("Could not read wallet.", "Konto konnte nicht gelesen werden."));
    await reply(conn, message, await tr(`💰 Balance: *${w.balance}*`, `💰 Kontostand: *${w.balance}*`));
  }
);

command(
  { pattern: "rob", fromMe: false, desc: "Try to rob another player", type: "fun" },
  async (message, conn) => {
    const mentions = getMentions(message);
    let target = mentions[0] || getQuotedParticipant(message);
    if (!target) {
      return replyFail(conn, message, await tr(`Mention someone or reply to their message: \`${BOT_INFO.PREFIX}rob @user\``, `Erwähne jemanden oder antworte auf dessen Nachricht: \`${BOT_INFO.PREFIX}rob @user\``));
    }
    if (isBotNumber(conn, target)) {
      return replyFail(conn, message, await tr("You can't rob the bot.", "Du kannst den Bot nicht ausrauben."));
    }
    const res = await rob(message.sender, target, message.pushName);
    switch (res.reason) {
      case "self":
        return replyFail(conn, message, await tr("You can't rob yourself.", "Du kannst dich nicht selbst ausrauben."));
      case "target_poor":
        return replyFail(conn, message, await tr(`Target has only *${res.balance}* coins — nothing to steal.`, `Das Ziel hat nur *${res.balance}* Münzen — nichts zu holen.`));
      case "cooldown":
        return replyFail(conn, message, await tr(`Take it easy — next attempt in ${fmtWait(res.wait)}.`, `Ganz ruhig — nächster Versuch in ${fmtWait(res.wait)}.`));
      default:
        break;
    }
    if (res.ok && res.win) {
      return replyOk(conn, message, await tr(
        `🦹 You robbed *${res.targetName}* for *${res.gained}* coins! Balance: *${res.balance}*`,
        `🦹 Du hast *${res.targetName}* um *${res.gained}* Münzen erleichtert! Kontostand: *${res.balance}*`
      ));
    }
    if (res.ok && !res.win) {
      return replyFail(conn, message, await tr(
        `😅 Busted! The cops took *${res.forfeit}* coins. Balance: *${res.balance}*`,
        `😅 Erwischt! Die Polizei hat *${res.forfeit}* Münzen eingezogen. Kontostand: *${res.balance}*`
      ));
    }
    return replyFail(conn, message, await tr("Something went wrong.", "Etwas ist schiefgelaufen."));
  }
);

command(
  { pattern: "gamble", fromMe: false, desc: "Double-or-nothing: #gamble 50 | all | half", type: "fun" },
  async (message, conn) => {
    const amt = getCommandArgs(message.body, "gamble");
    const res = await gamble(message.sender, amt ?? "all", message.pushName);
    switch (res.reason) {
      case "bad_amount":
        return replyFail(conn, message, await tr(`Usage: \`#gamble <amount|all|half>\``, `Benutzung: \`#gamble <betrag|all|half>\``));
      case "insufficient":
        return replyFail(conn, message, await tr(`You only have *${res.balance}* coins.`, `Du hast nur *${res.balance}* Münzen.`));
      case "cooldown":
        return replyFail(conn, message, await tr(`Slow down — next toss in ${fmtWait(res.wait)}.`, `Nicht so schnell — nächster Wurf in ${fmtWait(res.wait)}.`));
      default:
        break;
    }
    if (res.ok && res.win) {
      return replyOk(conn, message, await tr(
        `🪙 Heads! *+${res.bet}* → balance *${res.balance}*`,
        `🪙 Kopf! *+${res.bet}* → Kontostand *${res.balance}*`
      ));
    }
    if (res.ok && !res.win) {
      return replyFail(conn, message, await tr(
        `🪙 Tails... lost *${res.bet}*. Balance: *${res.balance}*`,
        `🪙 Zahl... *${res.bet}* verloren. Kontostand: *${res.balance}*`
      ));
    }
    return replyFail(conn, message, await tr("Something went wrong.", "Etwas ist schiefgelaufen."));
  }
);

command(
  { pattern: "rich", fromMe: false, desc: "Show the coin leaderboard (top 10)", type: "fun" },
  async (message, conn) => {
    const lb = await getLeaderboard();
    if (!lb.length) {
      return reply(conn, message, await tr("No wallets yet — be the first with \`#job\`!", "Noch keine Konten — sei der Erste mit \`#job\`!"));
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = lb.map((e, i) => `${medals[i] || `${i + 1}.`} ${e.name ? `*${e.name}*` : e.n} — *${e.b}*`).join("\n");
    await reply(conn, message, await tr(`💰 *Richest players*\n${lines}`, `💰 *Reichste Spieler*\n${lines}`));
  }
);

command(
  { pattern: "dice", fromMe: false, desc: "Roll a die (optional sides)", type: "fun" },
  async (message, conn) => {
    const arg = getCommandArgs(message.body, "dice");
    let sides = 6;
    if (arg) {
      const n = parseInt(arg, 10);
      if (Number.isFinite(n) && n >= 2 && n <= 100) sides = n;
    }
    const roll = 1 + Math.floor(Math.random() * sides);
    await reply(conn, message, await tr(`🎲 You rolled *${roll}* (d${sides})`, `🎲 Du hast *${roll}* gewürfelt (W${sides})`));
  }
);

command(
  { pattern: "coin", fromMe: false, desc: "Flip a coin", type: "fun" },
  async (message, conn) => {
    const heads = Math.random() < 0.5;
    await reply(conn, message, await tr(`🪙 ${heads ? "Heads!" : "Tails!"}`, `🪙 ${heads ? "Kopf!" : "Zahl!"}`));
  }
);

command(
  { pattern: "rps", fromMe: false, desc: "Rock paper scissors: #rps rock", type: "fun" },
  async (message, conn) => {
    const hand = (getCommandArgs(message.body, "rps") || "").toLowerCase().replace(/[.!,]/g, "").trim();
    const map = { rock: "rock", stein: "rock", scissors: "scissors", schere: "scissors", paper: "paper", papier: "paper", "✊": "rock", "✌️": "scissors", "✋": "paper" };
    const mine = map[hand];
    if (!mine) return replyFail(conn, message, await tr(`Pick one: \`rock\`, \`paper\` or \`scissors\`.`, `Wähle: \`stein\`, \`papier\` oder \`schere\`.`));
    const opts = ["rock", "paper", "scissors"];
    const bot = opts[Math.floor(Math.random() * 3)];
    const beat = { rock: "scissors", paper: "rock", scissors: "paper" };
    const r = beat[mine] === bot ? "win" : mine === bot ? "draw" : "lose";
    const label = { rock: "🪨", paper: "📄", scissors: "✂️", win: "🎉", draw: "🤝", lose: "😅" };
    const en = `You ${r} — ${label[mine]} vs 🤖 ${label[bot]}`;
    const de = `${r === "win" ? "Du gewinnst" : r === "draw" ? "Unentschieden" : "Du verlierst"} — ${label[mine]} vs 🤖 ${label[bot]}`;
    await reply(conn, message, await tr(en, de));
  }
);

command(
  { pattern: "ttt", fromMe: false, desc: "Tic-tac-toe: #ttt vs bot, #ttt @friend for PvP", type: "fun" },
  async (message, conn) => {
    const existing = getSession(message.from);
    if (existing) {
      const arg = getCommandArgs(message.body, "ttt");
      if (arg && existing.kind === "ttt" && !tttWinner(existing.board)) {
        const move = parseTttMove(arg);
        if (move) {
          const consumed = await routeGameTurn({ message: { ...message, body: arg }, conn });
          if (consumed) return;
        }
      }
      return replyFail(conn, message, await tr(`A *${existing.kind}* game is already running here. \`#stopgame\` to end it.`, `Hier läuft bereits ein *${existing.kind}*-Spiel. \`#stopgame\` zum Beenden.`));
    }

    const mentions = getMentions(message);
    const arg = getCommandArgs(message.body, "ttt");
    let opponent = mentions[0];
    if (!opponent && arg && message.quoted) opponent = getQuotedParticipant(message);
    const board = Array(9).fill(null);

    if (opponent) {
      if (normalizeNumber(opponent) === normalizeNumber(message.sender)) {
        return replyFail(conn, message, await tr("You can't play against yourself.", "Du kannst nicht gegen dich selbst spielen."));
      }
      if (isBotNumber(conn, opponent)) {
        return replyFail(conn, message, await tr("To play against me just use \`#ttt\` alone.", "Um gegen mich zu spielen, reicht \`#ttt\`."));
      }
      startSession(message.from, { kind: "ttt", players: { x: message.sender, o: opponent }, board, turn: "x", moves: 0, vsBot: false });
      await reply(conn, message, await tr(
        `⚔️ ${mentionText(message.sender)} (X) vs ${mentionText(opponent)} (O)!\n${renderTtt(board)}\n${mentionText(message.sender)} starts — send a move (e.g. A1 or 1-9).`,
        `⚔️ ${mentionText(message.sender)} (X) vs ${mentionText(opponent)} (O)!\n${renderTtt(board)}\n${mentionText(message.sender)} beginnt — sende einen Zug (z. B. A1 oder 1-9).`
      ), { mentions: [message.sender, opponent] });
      return;
    }

    startSession(message.from, { kind: "ttt", players: { x: message.sender, o: conn.user?.id || "bot@s.whatsapp.net" }, board, turn: "x", moves: 0, vsBot: true });
    await reply(conn, message, await tr(
      `🤖 Tic-tac-toe vs me! You are X.\n${renderTtt(board)}\nSend a move (e.g. A1 or a keypad 1-9).`,
      `🤖 Tic-tac-toe gegen mich! Du bist X.\n${renderTtt(board)}\nSende einen Zug (z. B. A1 oder 1-9 auf dem Ziffernblock).`
    ), { mentions: [message.sender] });
  }
);

command(
  { pattern: "guess", fromMe: false, desc: "Start a number-guessing game", type: "fun" },
  async (message, conn) => {
    if (await gameActive(conn, message)) return;
    const arg = getCommandArgs(message.body, "guess");
    let max = 100;
    if (arg) {
      const n = parseInt(arg, 10);
      if (Number.isFinite(n) && n > 2 && n <= 1_000_000) max = n;
    }
    const target = 1 + Math.floor(Math.random() * max);
    startSession(message.from, { kind: "guess", target, max, attempts: 0 });
    await reply(conn, message, await tr(
      `🔢 I'm thinking of a number between *1* and *${max}*. Send a number to guess it!`,
      `🔢 Ich denke mir eine Zahl zwischen *1* und *${max}*. Schick eine Zahl als Tipp!`
    ));
  }
);

command(
  { pattern: "hangman", fromMe: false, desc: "Start a hangman game (letter guessing)", type: "fun" },
  async (message, conn) => {
    if (await gameActive(conn, message)) return;
    const word = pickHangmanWord();
    startSession(message.from, { kind: "hangman", word, letters: [], fulls: [] });
    await reply(conn, message, await tr(
      `🪢 Hangman started!\n${renderHangman(word, [], [])}\nGuess a letter (a-z) or type the whole word.`,
      `🪢 Galgenmännchen gestartet!\n${renderHangman(word, [], [])}\nRate einen Buchstaben (a-z) oder schreib das ganze Wort.`
    ));
  }
);

command(
  { pattern: "stopgame", fromMe: false, desc: "End the current game in this chat", type: "fun" },
  async (message, conn) => {
    if (getSession(message.from)) {
      endSession(message.from);
      return replyOk(conn, message, await tr("Game ended.", "Spiel beendet."));
    }
    await reply(conn, message, await tr("No game running here.", "Hier läuft kein Spiel."));
  }
);