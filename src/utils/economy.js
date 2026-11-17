

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "./access.js";

const WALLET = (n) => `economy:wallet:${n}`;
const LEADERBOARD_KEY = "economy:leaderboard";
const LEADERBOARD_MAX = 10;

export const ECONOMY = {
  START_BALANCE: 100,
  JOB_COOLDOWN: 3 * 60 * 1000,
  JOB_MAX_WITHIN: 3,
  JOB_RESET_MS: 60 * 60 * 1000,
  DAILY_BONUS: 500,
  DAILY_COOLDOWN: 24 * 60 * 60 * 1000,
  ROB_COOLDOWN: 30 * 60 * 1000,
  ROB_SUCCESS: 0.55,
  ROB_MIN_TARGET: 100,
  ROB_CAP: 500,
  ROB_FORFEIT: 30,
  GAMBLE_COOLDOWN: 15 * 1000,
  GAMBLE_MIN: 1,
};

const JOB_PAYOUT_RATES = [20, 30, 45, 65, 90, 120];

const chains = new Map();

function chain(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(key, next.catch(() => {}));
  return next;
}

function emptyWallet(name) {
  return {
    balance: ECONOMY.START_BALANCE,
    name: name || "",
    totalEarned: 0,
    totalLost: 0,
    jobs: 0,
    jobWindowAt: 0,
    jobsInWindow: 0,
    lastJob: 0,
    lastDaily: 0,
    lastRob: 0,
    robWins: 0,
    robLosses: 0,
    gambles: 0,
    gamblesWon: 0,
    lastGamble: 0,
    createdAt: Date.now(),
  };
}

function norm(input) {
  return normalizeNumber(input) || String(input || "").replace(/\D/g, "");
}

async function loadWallet(n) {
  const data = await kvGet(WALLET(n));
  const base = data && typeof data === "object" ? data : {};
  return { ...emptyWallet(base.name), ...base };
}

async function saveWallet(n, w) {
  await kvSet(WALLET(n), w);
}

async function touchName(n, w, name) {
  if (name && name !== w.name) {
    w.name = String(name).slice(0, 40);
    await saveWallet(n, w);
  }
}

export async function getWallet(input, name) {
  const n = norm(input);
  if (!n) return null;
  return chain(`get:${n}`, async () => {
    const w = await loadWallet(n);
    if (name) await touchName(n, w, name);
    return { ...w, _n: n };
  });
}

async function pushLeaderboard(n, w) {
  let list = (await kvGet(LEADERBOARD_KEY)) || [];
  if (!Array.isArray(list)) list = [];
  list = list.filter((e) => e && e.n !== n);
  list.push({ n, b: w.balance, name: w.name || "" });
  list.sort((a, b) => b.b - a.b);
  if (list.length > LEADERBOARD_MAX) list = list.slice(0, LEADERBOARD_MAX);
  await kvSet(LEADERBOARD_KEY, list);
  return list;
}

export async function getLeaderboard() {
  const list = (await kvGet(LEADERBOARD_KEY)) || [];
  return Array.isArray(list) ? list : [];
}

export async function doJob(input, name) {
  const n = norm(input);
  if (!n) return { ok: false, reason: "invalid" };
  return chain(`job:${n}`, async () => {
    const w = await loadWallet(n);
    await touchName(n, w, name);
    const now = Date.now();

    if (w.lastJob && now - w.lastJob < ECONOMY.JOB_COOLDOWN) {
      const wait = Math.ceil((ECONOMY.JOB_COOLDOWN - (now - w.lastJob)) / 1000);
      return { ok: false, reason: "cooldown", wait };
    }

    if (!w.jobWindowAt || now - w.jobWindowAt > ECONOMY.JOB_RESET_MS) {
      w.jobWindowAt = now;
      w.jobsInWindow = 0;
    }
    if (w.jobsInWindow >= ECONOMY.JOB_MAX_WITHIN) {
      const wait = Math.ceil((w.jobWindowAt + ECONOMY.JOB_RESET_MS - now) / 1000);
      return { ok: false, reason: "tired", wait };
    }

    w.jobsInWindow += 1;
    const idx = Math.min(w.jobsInWindow - 1, JOB_PAYOUT_RATES.length - 1);
    const payout = JOB_PAYOUT_RATES[idx] + Math.floor(Math.random() * 11) - 5;
    w.balance += payout;
    w.totalEarned += payout;
    w.jobs = (w.jobs || 0) + 1;
    w.lastJob = now;
    await saveWallet(n, w);
    await pushLeaderboard(n, w);
    return { ok: true, payout, streak: w.jobsInWindow, balance: w.balance };
  });
}

export async function claimDaily(input, name) {
  const n = norm(input);
  if (!n) return { ok: false, reason: "invalid" };
  return chain(`daily:${n}`, async () => {
    const w = await loadWallet(n);
    await touchName(n, w, name);
    const now = Date.now();

    if (w.lastDaily && now - w.lastDaily < ECONOMY.DAILY_COOLDOWN) {
      const wait = Math.ceil((ECONOMY.DAILY_COOLDOWN - (now - w.lastDaily)) / 1000);
      return { ok: false, reason: "cooldown", wait };
    }

    w.balance += ECONOMY.DAILY_BONUS;
    w.totalEarned += ECONOMY.DAILY_BONUS;
    w.lastDaily = now;
    await saveWallet(n, w);
    await pushLeaderboard(n, w);
    return { ok: true, bonus: ECONOMY.DAILY_BONUS, balance: w.balance };
  });
}

export async function rob(input, targetInput, name) {
  const n = norm(input);
  const tn = norm(targetInput);
  if (!n || !tn) return { ok: false, reason: "invalid" };
  if (n === tn) return { ok: false, reason: "self" };
  return chain(`rob:${n}`, async () => {
    const w = await loadWallet(n);
    await touchName(n, w, name);
    const now = Date.now();

    if (w.lastRob && now - w.lastRob < ECONOMY.ROB_COOLDOWN) {
      const wait = Math.ceil((ECONOMY.ROB_COOLDOWN - (now - w.lastRob)) / 1000);
      return { ok: false, reason: "cooldown", wait };
    }

    const tw = await loadWallet(tn);
    if (tw.balance < ECONOMY.ROB_MIN_TARGET) {
      return { ok: false, reason: "target_poor", balance: tw.balance };
    }

    const gained = Math.min(Math.floor(tw.balance * 0.2), ECONOMY.ROB_CAP);
    const win = Math.random() < ECONOMY.ROB_SUCCESS;

    if (win) {
      w.balance += gained;
      w.totalEarned += gained;
      w.robWins = (w.robWins || 0) + 1;
      tw.balance -= gained;
      tw.totalLost = (tw.totalLost || 0) + gained;
    } else {
      const forfeit = Math.min(ECONOMY.ROB_FORFEIT, w.balance);
      if (forfeit > 0) {
        w.balance -= forfeit;
        w.totalLost = (w.totalLost || 0) + forfeit;
        tw.balance += forfeit;
        tw.totalEarned = (tw.totalEarned || 0) + forfeit;
      }
      w.robLosses = (w.robLosses || 0) + 1;
    }

    w.lastRob = now;
    await saveWallet(n, w);
    await saveWallet(tn, tw);
    await pushLeaderboard(n, w);
    await pushLeaderboard(tn, tw);
    return {
      ok: true,
      win,
      gained: win ? gained : 0,
      forfeit: win ? 0 : Math.min(ECONOMY.ROB_FORFEIT, tw.balance),
      targetName: tw.name || tn,
      balance: w.balance,
    };
  });
}

export async function gamble(input, amountPhrase, name) {
  const n = norm(input);
  if (!n) return { ok: false, reason: "invalid" };
  return chain(`gamble:${n}`, async () => {
    const w = await loadWallet(n);
    await touchName(n, w, name);
    const now = Date.now();

    if (w.lastGamble && now - w.lastGamble < ECONOMY.GAMBLE_COOLDOWN) {
      const wait = Math.ceil((ECONOMY.GAMBLE_COOLDOWN - (now - w.lastGamble)) / 1000);
      return { ok: false, reason: "cooldown", wait };
    }

    const phrase = String(amountPhrase || "").trim().toLowerCase();
    let bet;
    if (phrase === "all") bet = w.balance;
    else if (phrase === "half") bet = Math.floor(w.balance / 2);
    else bet = Math.floor(Number(phrase));
    if (!Number.isFinite(bet) || bet < ECONOMY.GAMBLE_MIN) {
      return { ok: false, reason: "bad_amount", balance: w.balance };
    }
    if (bet > w.balance) return { ok: false, reason: "insufficient", balance: w.balance };

    const win = Math.random() < 0.5;
    if (win) {
      w.balance += bet;
      w.totalEarned += bet;
      w.gamblesWon = (w.gamblesWon || 0) + 1;
    } else {
      w.balance -= bet;
      w.totalLost += bet;
    }
    w.gambles = (w.gambles || 0) + 1;
    w.lastGamble = now;
    await saveWallet(n, w);
    await pushLeaderboard(n, w);
    return { ok: true, win, bet, balance: w.balance };
  });
}