

import { normalizeNumber } from "./access.js";
import { tr } from "./message.js";

const SESSION_TTL = 30 * 60 * 1000;

const sessions = new Map();

export function getSession(chat) {
  return sessions.get(chat) || null;
}

export function startSession(chat, session) {
  sessions.set(chat, { ...session, chat, lastAt: Date.now() });
}

export function endSession(chat) {
  sessions.delete(chat);
}

export function expireSessions() {
  const now = Date.now();
  for (const [chat, s] of sessions) {
    if (now - s.lastAt > SESSION_TTL) sessions.delete(chat);
  }
}

function validSession(chat) {
  const s = sessions.get(chat);
  if (!s) return null;
  if (Date.now() - s.lastAt > SESSION_TTL) {
    sessions.delete(chat);
    return null;
  }
  return s;
}

function touch(s) {
  s.lastAt = Date.now();
}

async function sendGame(conn, chat, en, de, mentions) {
  const opts = mentions && mentions.length ? { mentions } : {};
  const text = await tr(en, de);
  conn.sendMessage(chat, { text, ...opts }).catch(() => {});
}

function mentionText(jid) {
  return jid && jid.includes("@") ? `@${jid.split("@")[0]}` : "?";
}

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function tttWinner(board) {
  for (const [a, b, c] of TTT_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every((c) => c !== null) ? "draw" : null;
}

export function parseTttMove(input) {
  const s = String(input || "").replace(/\s+/g, "").toLowerCase();
  if (/^[1-9]$/.test(s)) return { idx: 9 - Number(s), label: s };
  let m = s.match(/^([a-c])([1-3])$/);
  if (m) return { idx: (Number(m[2]) - 1) * 3 + (m[1].charCodeAt(0) - 97), label: `${m[1]}${m[2]}` };
  m = s.match(/^([1-3])([a-c])$/);
  if (m) return { idx: (Number(m[1]) - 1) * 3 + (m[2].charCodeAt(0) - 97), label: `${m[2]}${m[1]}` };
  return null;
}

export function renderTtt(board) {
  const cell = (i) => (board[i] ? board[i].toUpperCase() : "·");
  return [
    "```",
    "   A   B   C",
    `1   ${cell(0)}   ${cell(1)}   ${cell(2)}`,
    `2   ${cell(3)}   ${cell(4)}   ${cell(5)}`,
    `3   ${cell(6)}   ${cell(7)}   ${cell(8)}`,
    "```",
  ].join("\n");
}

export function botTttMove(board) {
  const open = board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return null;
  const tryWin = (p) => {
    const t = [...board];
    for (const i of open) {
      t[i] = p;
      if (tttWinner(t) === p) return i;
      t[i] = null;
    }
    return null;
  };
  return tryWin("o") ?? tryWin("x") ?? (open.includes(4) ? 4 : open[Math.floor(Math.random() * open.length)]);
}

export function guessHint(target, guess) {
  if (guess === target) return "win";
  return guess < target ? "higher" : "lower";
}

const HANGMAN_WORDS = [
  "apple", "banana", "orange", "grape", "lemon", "cherry", "melon",
  "pizza", "burger", "cookie", "candy", "honey", "coffee", "sugar",
  "tiger", "panda", "rabbit", "monkey", "dolphin", "zebra", "falcon",
  "castle", "bridge", "garden", "forest", "river", "mountain", "island",
  "rocket", "planet", "comet", "galaxy", "thunder", "rainbow", "sunset",
  "banjo", "guitar", "piano", "drummer", "violin", "camera", "notebook",
];

export function pickHangmanWord() {
  return HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
}

export function renderHangman(word, letters, fulls) {
  const visible = [...word].map((ch) => (letters.includes(ch) ? ch : "_")).join(" ");
  const wrong = [...letters.filter((g) => !word.includes(g)), ...fulls.map((f) => `"${f}"`)];
  const triesLeft = 6 - wrong.length;
  return `\`${visible}\`\n❌ ${wrong.join(" ") || "—"} · 💡 ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left`;
}

export async function routeGameTurn({ message, conn }) {
  expireSessions();
  const s = validSession(message.from);
  if (!s) return false;

  const who = normalizeNumber(message.sender);
  const body = String(message.body || "").trim();

  if (s.kind === "ttt") {
    const move = parseTttMove(body);
    if (!move) return false;

    const xNum = normalizeNumber(s.players.x);
    const oNum = normalizeNumber(s.players.o);
    if (who !== xNum && who !== oNum) return false;

    const moverMark = s.turn;
    const expectNum = moverMark === "x" ? xNum : oNum;
    if (who !== expectNum) {
      await sendGame(conn, message.from, "It's not your turn.", "Du bist nicht an der Reihe.");
      touch(s);
      return true;
    }
    if (s.board[move.idx] !== null) {
      await sendGame(conn, message.from, `Cell *${move.label}* is taken.`, `Zelle *${move.label}* ist belegt.`);
      touch(s);
      return true;
    }

    s.board[move.idx] = moverMark;
    s.moves += 1;
    touch(s);
    const winner = tttWinner(s.board);

    if (winner === moverMark || winner === "draw") {
      if (winner === "draw") {
        await sendGame(conn, message.from, `${renderTtt(s.board)}\n🤝 Draw!`, `${renderTtt(s.board)}\n🤝 Unentschieden!`, [s.players.x, s.players.o]);
      } else {
        await sendGame(
          conn,
          message.from,
          `${renderTtt(s.board)}\n🏆 ${mentionText(s.players[moverMark])} wins!`,
          `${renderTtt(s.board)}\n🏆 ${mentionText(s.players[moverMark])} gewinnt!`,
          [s.players.x, s.players.o]
        );
      }
      endSession(message.from);
      return true;
    }

    s.turn = moverMark === "x" ? "o" : "x";

    if (s.vsBot && s.turn === "o") {
      const botIdx = botTttMove(s.board);
      if (botIdx !== null) {
        s.board[botIdx] = "o";
        s.moves += 1;
        const botWinner = tttWinner(s.board);
        if (botWinner) {
          if (botWinner === "draw") {
            await sendGame(conn, message.from, `${renderTtt(s.board)}\n🤝 Draw!`, `${renderTtt(s.board)}\n🤝 Unentschieden!`, [s.players.x, s.players.o]);
          } else {
            await sendGame(conn, message.from, `${renderTtt(s.board)}\n🤖 Bot wins!`, `${renderTtt(s.board)}\n🤖 Bot gewinnt!`, [s.players.x, s.players.o]);
          }
          endSession(message.from);
          return true;
        }
        s.turn = "x";
      }
    }

    const nextMark = s.turn;
    const nextPlayer = s.players[nextMark];
    if (s.vsBot) {
      await sendGame(
        conn, message.from,
        `${renderTtt(s.board)}\nYour move (e.g. A1, or a keypad 1-9)`,
        `${renderTtt(s.board)}\nDein Zug (z. B. A1, oder 1-9 auf dem Ziffernblock)`,
        [s.players.x, s.players.o]
      );
    } else {
      await sendGame(
        conn, message.from,
        `${renderTtt(s.board)}\n${mentionText(nextPlayer)} — your move (e.g. A1 or 1-9)`,
        `${renderTtt(s.board)}\n${mentionText(nextPlayer)} — du bist dran (z. B. A1 oder 1-9)`,
        [s.players.x, s.players.o]
      );
    }
    return true;
  }

  if (s.kind === "guess") {
    if (!/^\d{1,6}$/.test(body)) return false;
    const guess = parseInt(body, 10);
    touch(s);
    if (guess < 1 || guess > s.max) {
      await sendGame(conn, message.from, `🔢 Between 1 and ${s.max}.`, `🔢 Zwischen 1 und ${s.max}.`);
      return true;
    }
    s.attempts += 1;
    const hint = guessHint(s.target, guess);
    if (hint === "win") {
      await sendGame(
        conn, message.from,
        `🎯 Correct! It was *${s.target}* — solved in ${s.attempts} ${s.attempts === 1 ? "try" : "tries"}.`,
        `🎯 Genau! Es war *${s.target}* — gelöst in ${s.attempts} ${s.attempts === 1 ? "Versuch" : "Versuchen"}.`,
        [message.sender]
      );
      endSession(message.from);
      return true;
    }
    await sendGame(
      conn, message.from,
      hint === "higher"
        ? `⬆️ Higher than *${guess}* (try #${s.attempts})`
        : `⬇️ Lower than *${guess}* (try #${s.attempts})`,
      hint === "higher"
        ? `⬆️ Höher als *${guess}* (Versuch #${s.attempts})`
        : `⬇️ Niedriger als *${guess}* (Versuch #${s.attempts})`
    );
    return true;
  }

  if (s.kind === "hangman") {
    const isLetter = /^[a-z]$/.test(body);
    const isWord = /^[a-z]{2,20}$/.test(body);
    if (!isLetter && !isWord) return false;
    touch(s);

    if ((isLetter && s.letters.includes(body)) || (isWord && s.fulls.includes(body))) {
      await sendGame(conn, message.from, `You already tried *${body}*.`, `Du hattest *${body}* schon.`);
      return true;
    }

    if (isLetter) s.letters.push(body);
    else s.fulls.push(body);

    if (body === s.word) {
      await sendGame(conn, message.from, `🎉 \`${s.word}\` — solved!`, `🎉 \`${s.word}\` — gelöst!`, [message.sender]);
      endSession(message.from);
      return true;
    }

    if (isLetter && [...s.word].every((ch) => s.letters.includes(ch))) {
      await sendGame(conn, message.from, `🎉 \`${s.word}\` — solved!`, `🎉 \`${s.word}\` — gelöst!`, [message.sender]);
      endSession(message.from);
      return true;
    }

    const wrongCount = s.letters.filter((g) => !s.word.includes(g)).length + s.fulls.length;
    if (6 - wrongCount <= 0) {
      await sendGame(
        conn, message.from,
        `💀 Out of tries! The word was \`${s.word}\`.`,
        `💀 Keine Versuche mehr! Das Wort war \`${s.word}\`.`
      );
      endSession(message.from);
      return true;
    }

    await sendGame(conn, message.from, renderHangman(s.word, s.letters, s.fulls), renderHangman(s.word, s.letters, s.fulls));
    return true;
  }

  return false;
}