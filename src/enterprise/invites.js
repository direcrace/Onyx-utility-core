/**
 * Invite-based onboarding ("personal bots") — provision a sub-session WITHOUT
 * ever DMing the main with `#pair`.
 *
 * The operator mints a short-lived invite (unguessable token, revocable). A
 * person opens `/invite/<token>`, types their WhatsApp number, and the pairing
 * code is delivered directly on that page — the page IS the out-of-band
 * channel, so nobody has to message the shared main to get their own bot.
 *
 * Env knobs:
 *   INVITE_TTL_MS           invite validity window (default 24 h)
 *   INVITE_MAX_USES         pair calls a single token may serve (default 3)
 *   INVITE_MAX_IP_ATTEMPTS  pair calls per IP per window (default 3)
 *   INVITE_IP_WINDOW_MS     IP rate-limit window (default 10 min)
 *
 * Invites persist in sessions/invites.json so a shared link survives restarts
 * (the linked sub-session itself persists via its own DB + instances.json).
 * Pairing attempts are audited like every other provisioning action.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const TTL_MS = Number(process.env.INVITE_TTL_MS) || 24 * 3600 * 1000;
const MAX_USES = Number(process.env.INVITE_MAX_USES) || 3;
const MAX_IP_ATTEMPTS = Number(process.env.INVITE_MAX_IP_ATTEMPTS) || 3;
const IP_WINDOW_MS = Number(process.env.INVITE_IP_WINDOW_MS) || 10 * 60 * 1000;
const MAX_LOAD_PER_IP = 40;

const FILE = "invites.json";
let loaded = false;
let invites = []; // { token, label, created, expires, revoked, used }
const ipHits = new Map(); // "pair:<ip>" | "load:<ip>" -> [ts, ...]

function invitesDir() {
  const base = global.__basedir || process.cwd();
  return path.join(base, "sessions");
}

function invitesPath() {
  return path.join(invitesDir(), FILE);
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(invitesPath(), "utf8");
    const parsed = JSON.parse(raw);
    invites = Array.isArray(parsed) ? parsed : [];
  } catch {
    invites = [];
  }
}

function save() {
  try {
    fs.mkdirSync(invitesDir(), { recursive: true });
    fs.writeFileSync(invitesPath(), JSON.stringify(invites, null, 2));
  } catch (err) {
    console.error("[invites] failed to save:", err?.message || err);
  }
}

function hit(bucket, ip, max, windowMs) {
  const now = Date.now();
  const key = `${bucket}:${ip}`;
  const arr = (ipHits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    ipHits.set(key, arr);
    return true;
  }
  arr.push(now);
  ipHits.set(key, arr);
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits) {
      if (!v.length || now - v[v.length - 1] > windowMs) ipHits.delete(k);
    }
  }
  return false;
}

/** True only for valid, live invites. Never throws. */
function liveInvite(token) {
  const inv = invites.find((i) => i.token === token);
  if (!inv || inv.revoked) return null;
  if (Date.now() > inv.expires) return null;
  return inv;
}

/**
 * Mint a new invite. Returns the token (the link secret) + expiry.
 */
export function createInvite({ label = "" } = {}) {
  load();
  const token = crypto.randomBytes(16).toString("hex");
  const inv = {
    token,
    label: String(label || "").trim().slice(0, 60),
    created: Date.now(),
    expires: Date.now() + TTL_MS,
    revoked: false,
    used: 0,
    usedBy: [],
  };
  invites.push(inv);
  save();
  return { token, label: inv.label, created: inv.created, expires: inv.expires };
}

/** Sanitized list for the dashboard (tokens only ever leave via /api action). */
export function listInvites() {
  load();
  const now = Date.now();
  return invites
    .slice()
    .reverse()
    .map((i) => ({
      token: i.token,
      label: i.label || "",
      created: i.created,
      expires: i.expires,
      revoked: !!i.revoked,
      used: i.used,
      active: !i.revoked && now < i.expires,
    }));
}

export function revokeInvite(token) {
  load();
  const inv = invites.find((i) => i.token === token);
  if (!inv) return false;
  inv.revoked = true;
  save();
  return true;
}

function audit(text) {
  import("./audit.js").then(({ writeAudit }) =>
    writeAudit({ action: "invite:pair", actor: "web:invite", target: "sub-session", chat: null, meta: { note: text } })
  ).catch(() => { /* audit best effort */ });
}

function notify(text) {
  import("../utils/logGroup.js").then(({ systemLog }) =>
    systemLog("info", `🔗 ${text}`)
  ).catch(() => { /* best effort */ });
}

/**
 * Serve one pairing request through an invite.
 * @returns {{ok:true, data:{number,code}} | {ok:false, error:string}}
 */
export async function pairNumber(token, { ip = "?", number } = {}) {
  load();
  const inv = liveInvite(token);
  if (!inv) return { ok: false, error: "invite is invalid or has expired — ask the operator for a fresh one" };
  if (hit("pair", ip, MAX_IP_ATTEMPTS, IP_WINDOW_MS)) {
    return { ok: false, error: "too many attempts from this address — try again in a few minutes" };
  }
  const n = String(number || "").replace(/\D/g, "");
  if (!n) return { ok: false, error: "enter a WhatsApp number (country code + digits, e.g. 491512345678)" };

  const { provisionSubSession } = await import("../multi/sessionManager.js");
  let code;
  try {
    code = await provisionSubSession(n);
  } catch (err) {
    const e = String(err?.message || err).toUpperCase();
    if (e.includes("SUSPENDED")) return { ok: false, error: "that number is suspended — contact the operator" };
    if (e.includes("ALREADY_LINKED")) return { ok: false, error: "that number already has a linked bot — check the Minis list" };
    if (e.includes("NOT_READY")) return { ok: false, error: "couldn't start the session yet — try again in a few seconds" };
    return { ok: false, error: `pairing failed (${err?.message || "?"})` };
  }

  if (inv.used + 1 > MAX_USES) {
    return { ok: false, error: "this invite has already been used — ask the operator for a fresh one" };
  }
  inv.used += 1;
  inv.usedBy.push({ number: n, at: Date.now(), ip });
  if (inv.usedBy.length > 10) inv.usedBy.shift();
  save();

  audit(`invite pair via ${token.slice(0, 8)}… for ${n} (ip ${ip})`);
  notify(`Invite used: *${n}* via invite link — pairing code delivered on the web page.`);
  return { ok: true, data: { number: n, code, hint: `Enter this 8-digit code once on ${n} → WhatsApp → Linked devices` } };
}

/** Whether a page load is allowed for this IP (generous, prevents hot-link hammering). */
export function allowInviteLoad(ip = "?") {
  return !hit("load", ip, MAX_LOAD_PER_IP, 60 * 1000);
}

/**
 * The public invite page — self-contained, dark-theme, no external deps.
 * The token is embedded into both the page and its API calls.
 */
export function renderInvitePage(token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="theme-color" content="#0b0f14"/>
<title>Onyx — link your bot</title>
<style>
  :root { --bg:#0b0f14; --panel:#151c26; --panel2:#1b2330; --line:#232d3a; --tx:#dfe8f2; --tx2:#b8c4d2; --mut:#8b99a8; --acc:#4da3ff; --acc-dim:#3a7acc; --err:#f87171; --ok:#3ddc84; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:
    radial-gradient(52% 38% at 12% -8%, rgba(77,163,255,.16), transparent 62%),
    radial-gradient(48% 36% at 100% 112%, rgba(124,92,255,.13), transparent 62%),
    var(--bg); color:var(--tx); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width: min(440px, 100%); background: linear-gradient(180deg, var(--panel2), var(--panel));
    border:1px solid var(--line); border-radius:16px; padding:28px 26px; box-shadow:0 10px 40px rgba(0,0,0,.55); animation: fadein .4s ease; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--mut); font-size:13px; margin-bottom:20px; }
  label { display:block; font-size:12px; color:var(--mut); margin-bottom:6px; }
  input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--line); background:#0c1017;
    color:var(--tx); font-size:15px; font-family:inherit; outline:none; }
  input:focus { border-color:var(--acc-dim); box-shadow:0 0 0 3px rgba(77,163,255,.12); }
  button { width:100%; margin-top:14px; padding:12px; border-radius:10px; border:1px solid var(--acc-dim);
    background:linear-gradient(180deg,#1e3456,#182a46); color:var(--acc); font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; }
  button:hover { box-shadow:0 0 14px rgba(77,163,255,.25); }
  button:disabled { opacity:.5; cursor:default; }
  #out { margin-top:16px; font-size:13px; color:var(--mut); min-height:18px; word-break:break-word; }
  #code { display:none; text-align:center; }
  #code .cd { font-size:34px; font-weight:800; letter-spacing:.22em; color:var(--acc); background:rgba(77,163,255,.07);
    border:1px solid var(--acc-dim); border-radius:12px; padding:16px 10px; margin:14px 0 10px; }
  #code .ok { color:var(--ok); font-weight:700; }
  .err { color:var(--err) !important; }
  .ft { margin-top:18px; font-size:11px; color:var(--mut); text-align:center; }
  @keyframes fadein { from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:none;} }
</style>
</head>
<body>
  <div class="card">
    <h1>🔗 Link your Onyx bot</h1>
    <div class="sub">Your own private bot. It uses <b>your</b> WhatsApp number — enter it below, then confirm the 8-digit code once in WhatsApp.</div>
    <label for="num">Your WhatsApp number</label>
    <input id="num" inputmode="numeric" autocomplete="tel" placeholder="e.g. 491512345678" spellcheck="false"/>
    <button id="go">Get pairing code</button>
    <div id="out"></div>
    <div id="code">
      <div class="ok">Enter this code once in WhatsApp:</div>
      <div class="cd" id="cdc">• • • • • • • •</div>
      <div class="sub">WhatsApp → <b>Linked devices → Link a device</b> → link using your phone number, then type the code. Required to use this number.</div>
    </div>
    <div class="ft">By pairing you agree to the bot's Terms & Privacy Policy. Activity is monitored only to enforce them — messages live in memory only (gone on restart) and the operator never reads your chats.</div>
  </div>
<script>
  const num = document.getElementById('num');
  const go = document.getElementById('go');
  const out = document.getElementById('out');
  const codeBox = document.getElementById('code');
  const cdc = document.getElementById('cdc');
  function msg(t, bad) { out.className = bad ? 'err' : ''; out.textContent = t || ''; }
  async function pair() {
    const n = (num.value || '').replace(/\\D/g, '');
    if (!n) { msg('Enter your WhatsApp number first.', true); return; }
    go.disabled = true; msg('Starting your session — this takes a few seconds…');
    try {
      const r = await fetch('/invite/${token}/pair', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ number: n }) });
      const j = await r.json();
      if (j.ok) {
        msg(''); codeBox.style.display = 'block'; cdc.textContent = j.data.code;
        out.textContent = '';
      } else {
        msg(j.error || 'Pairing failed.', true);
      }
    } catch (e) {
      msg('Network error — is the page reachable?', true);
    } finally { go.disabled = false; }
  }
  go.addEventListener('click', pair);
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') pair(); });
</script>
</body>
</html>`;
}