

const TOK0 = new URLSearchParams(location.search).get("token") || "";
let TOK = TOK0 || sessionStorage.getItem("dcToken") || "";
const $ = (s) => document.querySelector(s);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtUp = (sec) => {
  if (!Number.isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
};
const fmtT = (ts) => (ts ? new Date(ts).toLocaleString() : "—");
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString() : "—");

let D = null;
let active = "overview";
let selMini = "";
let AU = null;
let refreshing = false;

let logsPaused = false;
let logFilter = "";
let logSince = 0;
let streamOpen = false;
let es = null;
const LOG = [];

let termHist = [];
let termIdx = -1;
let dangerArmed = false;

let ROLE = "creator";

function toast(html, cls) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.innerHTML = html;
  t.className = "toast " + (cls || "");
  clearTimeout(t._h);
  t._h = setTimeout(() => {
    t.className = "toast fade";
  }, 4600);
}

async function apiGet(path) {
  const r = await fetch(apiPre() + path, { headers: { Authorization: "Bearer " + TOK } });
  if (r.status === 401) { showTok(); return null; }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function action(name, params) {
  const body = Object.assign({ action: name }, params || {});
  const r = await fetch(apiPre() + "/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOK },
    body: JSON.stringify(body),
  });
  if (r.status === 401) { showTok(); return { ok: false, error: "unauthorized" }; }
  const j = await r.json().catch(() => ({ ok: false, error: "bad response" }));
  if (j && j.watched) {
    toast(`🔒 ${esc(j.hint || "Creator-only. Logged & watched. 👀")}`, "err");
    return j;
  }
  return j;
}

async function doAction(name, params, opts = {}) {
  if (opts.confirm && !window.confirm(opts.text || `Run ${name}?`)) return null;
  let j = await action(name, params);
  if (j && j.confirm) {
    if (opts.autoArm === false) {
      toast(`🔒 ${esc(j.hint || "Action requires confirm.")}`);
      return j;
    }
    if (!window.confirm(opts.text || `Armed confirm required for ${name}. Confirm again to proceed.`)) return j;
    await action("rc.arm", { target: j.required || name });
    return await action(name, params);
  }
  return j;
}

function showTok() {
  $("#tokBox").hidden = false;
  $("#tokIn").focus();
}

function renderHeader() {
  const m = D?.main;
  if (!m) return;
  ROLE = D.role === "operator" ? "operator" : "creator";
  const roleEl = $("#hRole");
  if (roleEl) {
    roleEl.textContent = ROLE;
    roleEl.classList.toggle("op", ROLE === "operator");
    roleEl.title = ROLE === "operator" ? "operator token — creator-only tools hidden" : "creator token — full access";
  }
  const tmIn = $("#tmIn");
  if (tmIn) tmIn.disabled = ROLE !== "creator";
  const termNav = document.querySelector('#nav [data-nav="terminal"]');
  if (termNav) termNav.hidden = ROLE !== "creator";
  const tmDanger = $("#tmDanger");
  if (tmDanger) tmDanger.hidden = ROLE !== "creator";
  if (ROLE !== "creator" && active === "terminal") {
    active = "overview";
    document.querySelectorAll(".nav").forEach((n) => n.classList.toggle("active", n.getAttribute("data-nav") === active));
    document.querySelectorAll(".sec").forEach((s) => s.classList.toggle("active", s.id === "sec-overview"));
  }
  const dot = $("#hMain");
  dot.className = "dot " + (m.connected ? "on" : "off");
  $("#hMainTxt").textContent = m.connected ? "connected" : "DISCONNECTED";
  $("#hMode").textContent = m.mode;
  $("#hUp").textContent = fmtUp(m.uptimeSec);
  $("#hPid").textContent = m.pid;
  $("#hRss").textContent = m.rssMb + " MB";
  $("#hHeap").textContent = m.heapMb + " MB";
  $("#hQueue").textContent = (m.queue ? m.queue.pending : 0) + (m.queue?.active ? "/" + m.queue.active : "");
  $("#hFlags").textContent = D.flagsTotal ?? "?";
  const pan = $("#hPanic");
  pan.className = "dot " + (m.panic?.enabled ? "on" : "off");
  $("#sStamp").textContent = "v" + (D.version || "?") + " · " + new Date(D.generated_at || Date.now()).toLocaleTimeString();
  if (m.host) $("#sCpu").textContent = "cpu " + m.host.cpuPct + " / " + m.host.hostCpuPct + "% · mem " + m.host.mem.usedPct + "%";
  const hi = $("#hInst");
  if (hi) {
    hi.hidden = !INSTANCE;
    if (INSTANCE) hi.textContent = "viewing " + INSTANCE;
  }
}

function sparkline(values, color, w = 300, h = 60) {
  if (!values || !values.length) return '<svg viewBox="0 0 300 60"></svg>';
  if (values.length > 300) values = values.slice(-300);
  if (values.length === 1) values = [values[0], values[0]];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const last = values[values.length - 1];
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 7)).toFixed(1)}`)
    .join(" ");
  const areaPts = `0,${h - 2} ${pts} ${w},${h - 2}`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polygon points="${areaPts}" fill="${color}" fill-opacity="0.08"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="${w}" cy="${(h - 3 - ((last - min) / span) * (h - 7)).toFixed(1)}" r="2.2" fill="${color}"/>
      <text x="${w - 4}" y="10" fill="${color}" font-size="10" font-family="monospace" text-anchor="end">${last}</text>
    </svg>`;
}

function bars(data) {
  if (!data || !data.length) return '<div class="mini">no data yet</div>';
  const max = Math.max(...data.map((x) => x.open)) || 1;
  return data
    .slice(0, 7)
    .map((x) => {
      const pct = Math.max(2, Math.round((x.open / max) * 100));
      const cls = x.open ? "warn" : "ok";
      return `<div class="bar-row"><span style="width:130px">${esc(x.rule)}</span>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="mut">${x.open}/${x.total} open</span></div>`;
    })
    .join("");
}

const PREV = {};

function tickNum(id, key, num, display, minDelta = 1) {
  const val = $("#" + id);
  if (!val) return;
  const prev = PREV[key];
  const d =
    prev && typeof prev.num === "number" && typeof num === "number"
      ? num - prev.num
      : 0;
  val.textContent = display;
  const dEl = val.parentElement?.querySelector(".delta");
  if (dEl) {
    if (prev && Math.abs(d) >= minDelta) {
      const up = d > 0;
      const deltaShow = Math.abs(d) % 1 ? Math.abs(d).toFixed(1) : Math.abs(d);
      dEl.hidden = false;
      dEl.className = "delta " + (up ? "up" : "down");
      dEl.textContent = (up ? "▲" : "▼") + deltaShow;
    } else {
      dEl.hidden = true;
    }
  }
  PREV[key] = { num, display };
}

function tickText(id, key, text) {
  const val = $("#" + id);
  if (!val) return;
  val.textContent = text;
  PREV[key] = { text };
}

function tickHtml(id, key, html) {
  const val = $("#" + id);
  if (!val) return;
  val.innerHTML = html;
  PREV[key] = { html };
}

function setAccess(id, okLabel, badLabel, isOk) {
  const el = $("#" + id);
  if (el) {
    el.textContent = isOk ? okLabel : badLabel;
    el.style.color = isOk ? "var(--ok)" : "var(--warn)";
  }
}

const ovCard = (k, valCell) => `<div class="card"><div class="k">${k}</div><div class="v">${valCell}</div></div>`;
const numCell = (id) => `<span id="${id}" class="val">—</span><span class="delta" hidden></span>`;
const txtCell = (id) => `<span id="${id}"></span>`;
const ovGroup = (title, accent, gid, items) =>
  `<div class="ov-panel" style="--acc-color:${accent}">
     <div class="ov-head"><span class="ov-dot" style="background:${accent}"></span><span class="ov-title">${title}</span>
       <span class="spacer"></span><span class="ov-access" id="ov-g-${gid}">—</span></div>
     <div class="cards">${items}</div>
   </div>`;

const OV_TICKS = (() => {
  let s = "";
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    s += `<line x1="${(50 + 37 * Math.sin(a)).toFixed(1)}" y1="${(50 - 37 * Math.cos(a)).toFixed(1)}" x2="${(50 + 46 * Math.sin(a)).toFixed(1)}" y2="${(50 - 46 * Math.cos(a)).toFixed(1)}" class="tick maj"/>`;
  }
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue;
    const a = (i * 6 * Math.PI) / 180;
    s += `<line x1="${(50 + 41 * Math.sin(a)).toFixed(1)}" y1="${(50 - 41 * Math.cos(a)).toFixed(1)}" x2="${(50 + 46 * Math.sin(a)).toFixed(1)}" y2="${(50 - 46 * Math.cos(a)).toFixed(1)}" class="tick min"/>`;
  }
  return s;
})();

function renderClock() {
  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const ro = (id, deg) => {
    const g = document.getElementById(id);
    if (g) g.setAttribute("transform", `rotate(${deg} 50 50)`);
  };
  ro("ovHr", h * 30 + m * 0.5);
  ro("ovMin", m * 6 + s * 0.1);
  ro("ovSec", s * 6 + now.getMilliseconds() * 0.006);
  const dig = $("#ovDigits");
  if (dig) dig.textContent = now.toLocaleTimeString("de-DE");
}

const ovSkeleton = () =>
  `<div class="fleet" id="fleetPanel"></div>
   <div class="ov-clock">
     <svg viewBox="0 0 100 100" aria-hidden="true">
       <circle cx="50" cy="50" r="47" class="face"/>
       ${OV_TICKS}
       <g id="ovHr"><line x1="50" y1="50" x2="50" y2="28" class="hand hr"/></g>
       <g id="ovMin"><line x1="50" y1="50" x2="50" y2="18" class="hand min"/></g>
       <g id="ovSec"><line x1="50" y1="52" x2="50" y2="12" class="hand sec"/></g>
       <circle cx="50" cy="50" r="1.6" class="pin"/>
     </svg>
     <div id="ovDigits">--:--:--</div>
     <div class="ov-stamp"><span class="live-dot"></span><span class="mut2">live — auto-updates every second</span></div>
   </div>` +
  ovGroup("MAIN", "#58a6ff", "main",
    ovCard("status", txtCell("ov-status")) +
    ovCard("mode", txtCell("ov-mode")) +
    ovCard("uptime", txtCell("ov-uptime")) +
    ovCard("pid", txtCell("ov-pid"))) +
  ovGroup("MESSAGING", "#3fb950", "msg",
    ovCard("msgs in", numCell("ov-min")) +
    ovCard("msgs out", numCell("ov-mout")) +
    ovCard("send fails", numCell("ov-fails")) +
    ovCard("rate / min", numCell("ov-rate")) +
    ovCard("last send", numCell("ov-lastsend")) +
    ovCard("commands", numCell("ov-cmds")) +
    ovCard("errors / min", numCell("ov-errm"))) +
  ovGroup("SYSTEM", "#8b949e", "sys",
    ovCard("bot cpu", numCell("ov-cpub")) +
    ovCard("host cpu", numCell("ov-cpuh")) +
    ovCard("ram", numCell("ov-ram")) +
    ovCard("rss", numCell("ov-rss")) +
    ovCard("heap", numCell("ov-heap")) +
    ovCard("disk free", numCell("ov-disk"))) +
  ovGroup("MINIS", "#bc8cff", "minis",
    ovCard("linked", numCell("ov-minis-total")) +
    ovCard("online", numCell("ov-minis-on")) +
    ovCard("suspended", numCell("ov-minis-susp")) +
    ovCard("open flags", numCell("ov-minis-flags"))) +
  ovGroup("ERRORS", "#f85149", "errs",
    ovCard("core panic", txtCell("ov-panic")) +
    ovCard("errors / min", numCell("ov-errmin")) +
    ovCard("avg job", numCell("ov-avgjob")) +
    ovCard("msgs fails", numCell("ov-msgfails"))) +
  `<div class="charts" id="ovCharts"></div>
   <div class="panel" style="margin-top:10px"><h2>Flags by rule (open)</h2><div class="bars" id="ovFlagsBars"></div></div>`;

function buildCharts(s) {
  const last = (f) => s.map((p) => p[f]);
  const cap = (label, values, color, unit = "") => {
    const cur = values.length ? values[values.length - 1] : 0;
    return `<div class="panel chart"><div class="cap"><span>${label}</span><span class="cur">${cur}${unit}</span></div>${sparkline(values, color)}</div>`;
  };
  return [
    cap("CPU — bot", last("cpuPct"), "#58a6ff", "%"),
    cap("CPU — host", last("hostCpuPct"), "#8b949e", "%"),
    cap("RAM", last("mem"), "#3fb950", "%"),
    cap("RSS", last("rss"), "#58a6ff", " MB"),
    cap("heap", last("heap"), "#8b949e", " MB"),
    cap("disk free", last("diskGb"), "#39c5cf", " GB"),
    cap("errors / min", last("errorsMin"), "#f85149", ""),
    cap("msg rate", last("rate"), "#a5d6ff", "/min"),
  ].join("");
}

let FLEET = null;
let FLEET_AT = 0;
let INSTANCE = "";

function apiPre() {
  return INSTANCE ? `/api/proxy/${encodeURIComponent(INSTANCE)}` : "";
}

function fleetCard(p, key, isSelf) {
  const sel = INSTANCE === key;
  if (!p || p.ok === false) {
    return `<div class="fleet-card dead ${sel ? "sel" : ""}">
      <div class="fleet-name">${esc(p?.name || "?")}<span class="dot off"></span></div>
      <div class="fleet-line err-text">${esc(p?.err || "unreachable")}</div>
    </div>`;
  }
  const live = !!p.linked;
  const bits = [
    live ? (p.mode || "?") : (p.connected ? "awaiting link" : "offline"),
    p.uptimeSec ? fmtUp(p.uptimeSec) : "",
    p.user ? esc(p.user) : "",
    `${p.minis} minis`,
    `v${esc(p.version || "?")}`,
  ].filter(Boolean).join(" · ");
  const click = sel ? "" : ` data-act="fleetSwitch" data-name="${escAttr(key)}"`;
  return `<div class="fleet-card ${live ? "on" : "off"} ${sel ? "sel" : ""}"${click} title="${sel ? "" : "open this instance's dashboard"}">
    <div class="fleet-name">${isSelf ? "● " : ""}${esc(p.name || "?")}<span class="dot ${live ? "on" : "off"}"></span></div>
    <div class="fleet-line">${bits}</div>
  </div>`;
}

function paintFleet() {
  const el = $("#fleetPanel");
  if (!el || !FLEET) return;
  const c = FLEET.combined || {};
  const peerCards = (FLEET.peers || []).map((p) => fleetCard(p, p.name, false)).join("");
  el.innerHTML =
    `<div class="fleet-head">
       <span class="fleet-title">FLEET</span>
       <span class="mut2">all mains as one</span>
       <span class="spacer"></span>
       ${c.reachable ? `<span class="mini">${c.connected}/${c.reachable} online · ${c.minis} minis · ${c.minisOn} active</span>` : ""}
       <button class="mini" data-act="fleetRefresh" title="refresh fleet">↻</button>
     </div>
     <div class="fleet-grid">${fleetCard(FLEET.self, "", true)}${peerCards}</div>`;
}

const SWITCH_HOLD = 220;
let switchSeq = 0;
async function switchInstance(name) {
  const next = name && name !== "you" ? name : "";
  if (next === INSTANCE) return;
  INSTANCE = next;
  const seq = ++switchSeq;
  document.body.classList.remove("inst-in");
  document.body.classList.add("inst-switching");
  const hi = $("#hInst");
  if (hi) {
    hi.classList.remove("flash");
    void hi.offsetWidth;
    hi.classList.add("flash");
  }
  try {
    await new Promise((r) => setTimeout(r, SWITCH_HOLD));
    if (seq !== switchSeq) return;
    paintFleet();
    await refresh();
  } finally {
    if (seq !== switchSeq) return;
    document.body.classList.remove("inst-switching");
    document.body.classList.add("inst-in");
    setTimeout(() => {
      if (seq === switchSeq) document.body.classList.remove("inst-in");
    }, 350);
  }
}

async function ensureFleet(force) {
  const now = Date.now();
  if (!force && FLEET && now - FLEET_AT < 6000) return;
  try {
    const j = await apiGet("/api/fleet");
    if (j && j.combined) {
      FLEET = j;
      FLEET_AT = now;
      paintFleet();
    }
  } catch (e) {
    $("#hApi").textContent = "ERR";
    const el = $("#fleetPanel");
    if (el) el.innerHTML = `<div class="fleet-head"><span class="fleet-title">FLEET</span><span class="err-text">unavailable</span></div>`;
  }
}

function renderOverview() {
  const m = D?.main || {};
  const L = m.panic?.Live || {};
  const mt = m.metrics?.counters || {};
  const h = m.host || {};
  const body = $("#ovBody");
  if (!body) return;

  if (!body.dataset.built) {
    body.innerHTML = ovSkeleton();
    body.dataset.built = "1";
  }

  ensureFleet();

  const clock = $("#ovDigits");
  if (clock) renderClock();

  setAccess("ov-g-main", "live", "OFFLINE", !!m.connected);
  setAccess("ov-g-msg", "nominal", "watch", !L.totals?.fails);
  setAccess("ov-g-sys", "ok", "high load", (h.cpuPct ?? 0) < 80 && (h.mem?.usedPct ?? 0) < 90);
  const minis = D.minis || [];
  const onCount = minis.filter((s) => s.status === "connected").length;
  const suspCount = minis.filter((s) => s.status === "suspended").length;
  setAccess("ov-g-minis", minis.length ? "healthy" : "none", "attention", minis.length > 0 && suspCount === 0 && onCount === minis.length);
  setAccess("ov-g-errs", "nominal", "spike", !m.panic?.panicked && (m.metrics?.errors_last_min ?? 0) < 8);

  tickHtml("ov-status", "status",
    `<span class="dot ${m.connected ? "on" : "off"}"></span>${m.connected ? "connected" : "DISCONNECTED"}`);
  tickHtml("ov-mode", "mode", `${m.mode || "?"} <span class="mut2">/ ${esc(h.pm2App || "?")}</span>`);
  tickText("ov-uptime", "uptime", fmtUp(m.uptimeSec));
  tickText("ov-pid", "pid", String(m.pid ?? "—"));

  tickNum("ov-min", "in", L.totals?.in ?? 0, `${L.totals?.in ?? 0}`);
  tickNum("ov-mout", "out", L.totals?.out ?? 0, `${L.totals?.out ?? 0}`);
  tickNum("ov-fails", "fails", L.totals?.fails ?? 0, `${L.totals?.fails ?? 0}`);
  tickNum("ov-rate", "rate", L.ratePerMin ?? 0, `${L.ratePerMin ?? 0}`);
  tickNum("ov-lastsend", "lastsend", L.totals?.lastSendMs ?? 0, `${L.totals?.lastSendMs ?? 0} ms`);
  tickNum("ov-cmds", "cmds", mt.commands ?? 0, `${mt.commands ?? 0}`);
  tickNum("ov-errm", "errm", m.metrics?.errors_last_min ?? 0, `${m.metrics?.errors_last_min ?? 0}`);

  tickNum("ov-cpub", "cpub", h.cpuPct ?? 0, `${(h.cpuPct ?? 0).toFixed(1)}%`, 0.5);
  tickNum("ov-cpuh", "cpuh", h.hostCpuPct ?? 0, `${(h.hostCpuPct ?? 0).toFixed(1)}%`, 0.5);
  tickNum("ov-ram", "ram", h.mem?.usedPct ?? 0, `${h.mem?.usedPct ?? 0}%`);
  tickNum("ov-rss", "rss", m.rssMb ?? 0, `${m.rssMb ?? 0} MB`);
  tickNum("ov-heap", "heap", m.heapMb ?? 0, `${m.heapMb ?? 0} MB`);
  tickNum("ov-disk", "disk", h.disk?.freeMb ?? 0, `${h.disk ? (h.disk.freeMb / 1024).toFixed(1) : "?"} GB`, 256);

  tickNum("ov-minis-total", "minisTotal", minis.length, `${minis.length}`);
  tickNum("ov-minis-on", "minisOn", onCount, `${onCount}`);
  tickNum("ov-minis-susp", "minisSusp", suspCount, `${suspCount}`);
  tickNum("ov-minis-flags", "minisFlags", D.flagsTotal ?? 0, `${D.flagsTotal ?? 0}`);

  const pn = m.panic || {};
  const panicLabel = pn.panicked ? "🔴 TRIGGERED" : pn.enabled ? (pn.panicGrace ? "⏳ grace" : "🟢 armed") : "⚪ off";
  tickHtml("ov-panic", "panic", panicLabel);
  tickNum("ov-errmin", "errmin", m.metrics?.errors_last_min ?? 0, `${m.metrics?.errors_last_min ?? 0}`);
  tickNum("ov-avgjob", "avgjob", m.metrics?.avg_job_ms ?? 0, `${m.metrics?.avg_job_ms ?? 0} ms`);
  tickNum("ov-msgfails", "msgfails", L.totals?.fails ?? 0, `${L.totals?.fails ?? 0}`);

  const s = D.stats?.series || [];
  const chartsEl = $("#ovCharts");
  if (chartsEl) {
    if (chartsEl.dataset.len !== String(s.length)) {
      chartsEl.innerHTML = buildCharts(s);
      chartsEl.dataset.len = String(s.length);
    } else {
      const defs = [["cpuPct", "%"], ["hostCpuPct", "%"], ["mem", "%"], ["rss", " MB"], ["heap", " MB"], ["diskGb", " GB"], ["errorsMin", ""], ["rate", "/min"]];
      chartsEl.querySelectorAll(".cur").forEach((c, i) => {
        const vals = defs[i] ? s.map((p) => p[defs[i][0]]) : [];
        c.textContent = vals.length ? vals[vals.length - 1] + defs[i][1] : "0";
      });
    }
  }

  const fl = D.flags || {};
  const barsEl = $("#ovFlagsBars");
  const fk = JSON.stringify(fl.byRule || []);
  if (barsEl && barsEl.dataset.key !== fk) {
    barsEl.innerHTML = bars(fl.byRule || []);
    barsEl.dataset.key = fk;
  }
}

function renderMinis() {
  const minis = D?.minis || [];

  const via = $("#tVia");
  const prev = via.value || "";
  via.innerHTML =
    '<option value="">main</option>' +
    minis.filter((x) => x.status === "connected").map((x) => `<option value="${esc(x.number)}">${esc(x.number)}</option>`).join("");
  if (prev) via.value = prev;

  const rows = minis
    .map((x) => {
      const stc = x.status === "connected" ? "on" : x.status === "suspended" ? "off" : "mid";
      const sel = x.number === selMini ? ' class="sel"' : "";
      const sus =
        x.status === "suspended"
          ? `<button data-act="unsuspend" data-num="${esc(x.number)}">unsuspend</button>`
          : `<button data-act="suspend" data-num="${esc(x.number)}">suspend</button>`;
      const pct = x.threshold ? Math.min(100, Math.round((x.score / x.threshold) * 100)) : 0;
      const fillCls = pct >= 100 ? "dang" : pct >= 50 ? "warnv" : "";
      const reason = x.suspendReason ? ` <span class="warn-text">(${esc(x.suspendReason)})</span>` : "";
      return `<tr${sel}><td class="num"><span class="dot ${stc}"></span>${esc(x.number)}</td>
        <td>${esc(x.status)}${reason}</td>
        <td><div class="score-wrap"><div class="score-bar"><div class="score-fill ${fillCls}" style="width:${pct}%"></div></div>${x.score}/${x.threshold ?? "?"}</div></td>
        <td>${x.openFlags ?? 0}</td>
        <td>${fmtTime(x.lastSeen)}</td>
        <td class="row-actions">
          <button data-act="detail" data-num="${esc(x.number)}">details</button>
          ${sus}
          <button data-act="respawn" data-num="${esc(x.number)}">respawn</button>
          <button class="danger" data-act="remove" data-num="${esc(x.number)}">remove</button>
        </td></tr>`;
    })
    .join("");

  const invPanel = ROLE === "creator"
    ? `<div class="panel"><h2>Invite links <span class="mut">(self-service pairing — no #pair DM needed)</span></h2>
      <div class="toolbar" style="margin-bottom:8px">
        <input id="invLabel" placeholder="label (this invite is for?)" style="width:200px"/>
        <button class="primary" data-act="inviteCreate">＋ create invite link</button>
        <span class="spacer"></span>
        <span class="mini mut">~24 h · revocable anytime · survives restarts</span>
      </div>${INVITES.length ? invitesHtml() : '<div class="mini mut">no invite links yet — create one and share the URL; the person types their number and the pairing code appears right on the page.</div>'}</div>`
    : "";

  $("#miBody").innerHTML =
    `<div class="panel"><h2>Onyx Minis (${minis.length})</h2>` +
    (minis.length
      ? `<table><tr><th>mini</th><th>status</th><th>score / threshold</th><th>flags</th><th>seen</th><th></th></tr>${rows}</table>`
      : '<div class="mini">no Onyx Minis linked — use an invite link (below) or run #pair in a DM to add one.</div>') +
    `</div>${invPanel}<div id="miDetail"></div>`;

  ensureInvites();
  renderMiniDetail();
}

let INVITES = [];
let INVITES_AT = 0;
let INVITES_SIG = "";

function copyText(t) {
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t).catch(() => fallbackCopy(t)); return; }
  fallbackCopy(t);
}
function fallbackCopy(t) {
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch {  }
  ta.remove();
}

async function ensureInvites(force) {
  if (!ROLE) return;
  const now = Date.now();
  if (!force && INVITES_AT && now - INVITES_AT < 60000) return;
  const j = await action("invite.list");
  if (j?.ok) {
    INVITES = j.data.invites || [];
    INVITES_AT = now;
    const sig = JSON.stringify(INVITES.map((i) => [i.token, i.revoked, i.used]));
    if (sig !== INVITES_SIG) {
      INVITES_SIG = sig;
      if (active === "minis") renderMinis();
    }
  }
}

function invitesHtml() {
  const live = INVITES.filter((i) => !i.revoked);
  const rows = live.map((i) => {
    const now = Date.now();
    const state = now > i.expires
      ? '<span class="warn-text">expired</span>'
      : i.used > 0
        ? '<span class="ok-text">used</span>'
        : '<span class="acc-text">live</span>';
    return `<div class="invite-row">
      <div class="invite-t"><b>${esc(i.label || "untitled")}</b> <code>${esc(i.token.slice(0, 8))}…</code> ${state}</div>
      <div class="mini mut">created ${fmtTime(i.created)} · expires ${fmtTime(i.expires)} · used ${i.used}×</div>
      <div class="invite-acts"><button data-act="inviteCopy" data-token="${esc(i.token)}">copy link</button>
      <button class="danger" data-act="inviteRevoke" data-token="${esc(i.token)}">revoke</button></div>
    </div>`;
  }).join("");
  return `<div class="invite-list">${rows}</div>`;
}

function renderMiniDetail() {
  const body = $("#miDetail");
  if (!body) return;
  if (!selMini) {
    body.innerHTML = "";
    return;
  }
  const records = (D?.flags?.records || []).filter((r) => r.number === selMini);
  const recs = records
    .map((r) => {
      const badge = r.resolved ? '<span class="badge resolved">resolved</span>' : `<span class="badge ${esc(r.severity)}">${esc(r.severity)}</span>`;
      const resolveBtn = r.resolved
        ? ""
        : `<button class="primary" data-act="resolve" data-num="${esc(r.number)}" data-id="${esc(r.id)}">resolve</button>`;
      return `<div class="mini">[${fmtT(r.ts)}] <b>${esc(r.rule)}</b> (${r.weight}) ${badge} · ${esc(r.chatType)} ${esc(r.chat)}
        <br/>&nbsp;&nbsp;"${esc(r.text).slice(0, 140)}"
        <br/>${resolveBtn}</div>`;
    })
    .join("");
  body.innerHTML =
    `<div class="toolbar" style="margin-top:10px"><b>${esc(selMini)}</b>
      <span class="mut">${records.filter((r) => !r.resolved).length} open · ${records.length} total</span>
      <span class="spacer"></span>
      <button data-act="resolveall" data-num="${esc(selMini)}">resolve all open</button>
      <button onclick="document.querySelector('[data-nav=flags]').click()">flag feed</button>
    </div>${recs || '<div class="mini">no flags for this mini.</div>'}`;
}

function renderFlags() {
  const fl = D?.flags;
  if (!fl) return;
  $("#flOpen").textContent = fl.totalOpen ?? 0;
  $("#flToday").textContent = fl.totalToday ?? 0;
  $("#flWeek").textContent = fl.totalWeek ?? 0;

  const ruleSel = $("#flRule");
  const prevRule = ruleSel.value;
  const rules = new Set((fl.byRule || []).map((r) => r.rule));
  ruleSel.innerHTML = '<option value="">all rules</option>' + [...rules].map((r) => `<option>${esc(r)}</option>`).join("");
  if (prevRule) ruleSel.value = prevRule;

  const qRule = ruleSel.value;
  const qSev = $("#flSeverity").value;
  const qRes = $("#flResolved").value;

  const rows = (fl.records || [])
    .filter((r) => (!qRule || r.rule === qRule) && (!qSev || r.severity === qSev) && (qRes === "" || String(r.resolved) === qRes))
    .map((r) => {
      const badge = r.resolved ? '<span class="badge resolved">resolved</span>' : `<span class="badge ${esc(r.severity)}">${esc(r.severity)}</span>`;
      const scopeBadge = r.scope === "user" ? '<span class="badge" style="background:#3f3f46">user</span>' : '<span class="badge" style="background:#1c2b3e">mini</span>';
      const btn = r.resolved ? "" : `<button class="primary" data-act="resolve" data-num="${esc(r.number)}" data-id="${esc(r.id)}">resolve</button>`;
      return `<tr><td class="num">${fmtTime(r.ts)}</td><td class="num">${esc(r.number)}</td>
        <td>${scopeBadge}</td><td><b>${esc(r.rule)}</b></td><td>${badge} ${r.weight}</td><td>${esc(r.chatType)}</td>
        <td>"${esc(r.text).slice(0, 120)}"</td><td>${btn}</td></tr>`;
    })
    .join("");

  const openUsers = new Map();
  for (const r of fl.records || []) {
    if (r.scope === "user" && !r.resolved) openUsers.set(r.number, (openUsers.get(r.number) || 0) + 1);
  }
  const userRows = [...openUsers.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([number, n]) => `<div class="toggle-row"><span>${esc(number)}</span><span class="badge">${n} open</span><span class="spacer"></span>
      <button class="primary" data-act="resolve" data-num="${esc(number)}" data-id="all">resolve all</button></div>`)
    .join("");

  $("#flBody").innerHTML =
    `<div class="panel"><h2>Flagged users (${openUsers.size})</h2>` +
    (userRows || '<div class="mini">no open flags from regular users.</div>') +
    `</div>` +
    `<div class="panel"><h2>Flag records (${fl.totalRecords} total · ${fl.resolvedTotal} resolved · ${fl.byScope?.user ?? 0} user / ${fl.byScope?.mini ?? 0} mini)</h2>` +
    (rows ? `<table><tr><th>when</th><th>number</th><th>scope</th><th>rule</th><th>sev / w</th><th>type</th><th>text</th><th></th></tr>${rows}</table>`
      : '<div class="mini">no flags match the filters.</div>') +
    `</div>`;
}

function logLine(e) {
  if (e?.ts && e.ts < logSince) return;
  LOG.push(e);
  if (LOG.length > 600) LOG.splice(0, LOG.length - 600);
  if (logsPaused) {
    updateLogStatus();
    return;
  }
  if (!document.hidden) renderLogs();
}

function scrollAtBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

function setLive(on) {
  streamOpen = on;
  const el = $("#lgLive");
  if (el) {
    el.hidden = !on;
    el.classList.toggle("paused", !on);
  }
}

function updateLogStatus() {
  const st = $("#lgStat");
  if (!st) return;
  const parts = [];
  if (logsPaused) parts.push("paused");
  parts.push(LOG.length + " buffered");
  if (logFilter) parts.push("filtered");
  st.textContent = parts.join(" · ");
}

function renderLogs(forceScroll) {
  const el = $("#ltLogs");
  if (!el) return;
  const stick = forceScroll || scrollAtBottom(el);
  let html = "";
  for (const e of LOG) {
    const txt = String(e.text || "");
    if (logFilter && txt.toLowerCase().indexOf(logFilter) < 0) continue;
    html += `<div class="log ${esc(e.level || "")}"><span class="lt">${fmtTime(e.ts)}</span>${esc(txt)}</div>`;
  }
  if (!html) html = '<div class="log placeholder">waiting for console stream…</div>';
  el.innerHTML = html;
  if (stick) el.scrollTop = el.scrollHeight;
  updateLogStatus();
}

async function openLogStream() {
  if (es) { try { es.close(); } catch {  } es = null; }
  if (!TOK) return;
  const back = await action("logs.tail", { n: 150 });
  if (back?.ok && back.data) {
    const tss = back.data.map((x) => x.ts || 0);
    if (tss.length) logSince = Math.max(...tss, logSince);
    back.data.forEach(logLine);
  }
  es = new EventSource("/api/events?token=" + encodeURIComponent(TOK));
  es.onmessage = (ev) => {
    try { logLine(JSON.parse(ev.data)); } catch {  }
  };
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false);
}

async function renderAudit() {
  const q = $("#auFilter").value.trim().toLowerCase();
  AU = await apiGet("/audit?limit=100" + (q ? "&action=" + encodeURIComponent(q) : ""));
  const rows = (AU || [])
    .map((a) => {
      const now = Date.now() - a.ts > 24 * 3600 * 1000;
      return `<tr><td class="num">${now ? fmtT(a.ts) : fmtTime(a.ts)}</td><td><code>${esc(a.action)}</code></td>
        <td class="num">${esc(a.actor || "—")}</td><td>${esc(a.target || "—")}</td><td>${esc(a.chat || "—")}</td>
        <td class="mut">${esc(a.meta ? JSON.stringify(a.meta).slice(0, 60) : "")}</td></tr>`;
    })
    .join("");
  $("#auBody").innerHTML =
    `<div class="panel"><h2>Audit trail (${AU?.length ?? 0})</h2>` +
    (rows
      ? `<table><tr><th>when</th><th>action</th><th>actor</th><th>target</th><th>chat</th><th>meta</th></tr>${rows}</table>`
      : '<div class="mini">no audit entries.</div>') +
    `</div>`;
}

function termOut(html, cls) {
  const out = $("#tmOut");
  const div = document.createElement("div");
  div.className = "log" + (cls ? " " + cls : "");
  if (cls === "cmd") div.textContent = html;
  else div.innerHTML = html;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function termClear() {
  $("#tmOut").innerHTML = "";
  termOut("<span class='mut2'>── console cleared ──</span>", "info");
}

async function termRun(line) {
  termOut(line, "cmd");
  const j = await action("dev.term", { line });
  const text = String(j?.data?.text ?? j?.error ?? "no output");
  termOut(esc(text), j?.ok ? "out" : "error");
}

let LAST_PAIR = null;

let rcCompose = { chat: "", via: "", body: "" };
let CHATS = [];
let CHATS_AT = 0;

function uiBusy() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return true;
  const region = document.querySelector(".composer, .msglog");
  return !!(region && region.matches(":hover"));
}

async function ensureChats(force) {
  const now = Date.now();
  if (!force && CHATS_AT && now - CHATS_AT < 30000) return;
  const j = await action("chats.list", { n: 80 });
  if (j?.ok) {
    CHATS = j.data.chats || CHATS;
    CHATS_AT = now;
    if (active === "remote" && !uiBusy()) renderRemote();
  } else if (j && !j.ok && !j.watched) {
    CHATS = [];
    CHATS_AT = now;
  }
}

let RMESS = [];
let RMESS_AT = 0;
let RMESS_SIG = "";

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function ensureRecent(force) {
  const now = Date.now();
  if (!force && RMESS_AT && now - RMESS_AT < 30000) return;
  const j = await action("messages.recent", { n: 60 });
  if (j?.ok) {
    const ms = j.data.messages || [];
    RMESS = ms;
    RMESS_AT = now;
    const sig = ms.length ? ms[0].id + "|" + ms[0].ts : "empty";
    if (sig !== RMESS_SIG) {
      RMESS_SIG = sig;
      if (active === "remote" && !uiBusy()) renderRemote();
    }
  }
}

function chatLabel(c) {
  if (!c) return "";
  const name = c.name ? c.name : c.kind === "group" ? "group" : c.number;
  return c.kind === "group" ? `👥 ${esc(name)} · ${esc(c.number)}` : `💬 ${esc(name)}`;
}

function updateRcHint() {
  const c = CHATS.find((x) => x.jid === rcCompose.chat);
  const hint = $("#rcMsgHint");
  if (!hint) return;
  hint.innerHTML = c
    ? `➡ ${chatLabel(c)}${c.kind === "group" ? ' — <span class="warn-text">group, every member will see this</span>' : ""}`
    : rcCompose.chat
      ? `➡ ${esc(rcCompose.chat)}`
      : "pick a chat from the list (or type a number), write, send.";
}

function chatDisplayName(m) {
  const c = CHATS.find((x) => x.jid === m.jid || x.number === m.number);
  return (m.name || c?.name) || (m.kind === "group" ? "group" : (m.jid || m.number || "?").split("@")[0]);
}

function msgGroupLabel(m) {
  const sess = m.session && m.session !== "main" ? `<span class="mlrow-sess">${esc(m.session)}</span> · ` : "";
  const c = CHATS.find((x) => x.jid === m.jid || x.number === m.number);
  if (c || m.name) return sess + `${esc(chatDisplayName(m))} · <code>${esc(c?.number || (m.jid || m.number || "").split("@")[0])}</code>`;
  const num = esc((m.jid || m.number || "").split("@")[0] || "?");
  return sess + `${m.kind === "group" ? "group" : "dm"} · <code>${num}</code>`;
}

let ML = { view: "home", coll: "group", jid: "" };

function msgKey(m) {
  return (m.session || "main") + "|" + (m.jid || m.number || "?");
}

function msgGroups() {
  const g = new Map();
  for (const m of RMESS) {
    const k = msgKey(m);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(m);
  }
  return g;
}

function mlMediaBadge(m) {
  if (m.mediaInfo?.failed) return "✕";
  if (!m.mediaInfo?.ready) return "⏳";
  const mt = m.mediaInfo.mime || "";
  if (mt.startsWith("video/")) return "▶";
  if (mt.startsWith("audio/")) return "🎙";
  if (mt.startsWith("image/")) return "🔍";
  return "⬇";
}

function mlMediaWrap(m) {
  if (!m.media) return "";
  const key = encodeURIComponent(m.session || "main") + "/" + encodeURIComponent(m.id);
  const state = m.mediaInfo?.failed ? " failed" : m.mediaInfo?.ready ? " ready" : "";
  const inner = m.thumb
    ? `<img class="mlthumb" src="data:image/jpeg;base64,${m.thumb}" alt="preview" loading="lazy"/>`
    : `<span class="mlthumb-ph">${mlMediaBadge(m)}</span>`;
  return `<span class="mlthumb-wrap${state}" data-mkey="${key}" data-mname="${escAttr(m.mediaInfo?.name || "")}"
    title="${m.mediaInfo?.failed ? "media unavailable" : m.mediaInfo?.ready ? "open media" : "download pending…"}">${inner}<i class="mlbadge">${mlMediaBadge(m)}</i></span>`;
}

function mlRowHtml(m) {
  const sess = m.session && m.session !== "main" ? `<span class="mlrow-sess">${esc(m.session)}</span>` : "";
  return `<div class="mlrow${m.blocked ? " mlblocked" : ""}${m.thumb ? " hasthumb" : ""}">
    ${mlMediaWrap(m)}
    <span class="mini mut mlrow-t">${fmtClock(m.ts)}</span>
    ${m.fromMe ? `<span class="mlrow-you">you</span>` : ""}
    ${sess}
    <span class="mlrow-body${m.media ? " mlrow-media" : ""}" title="${esc(m.body)}">${esc(m.body || "—")}</span>
    ${m.blocked ? `<span class="mlrow-blocked">🔒 ${esc(m.blocked)}</span>` : ""}
  </div>`;
}

const mlBlobs = new Map();

function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

async function mlBlob(key) {
  if (mlBlobs.has(key)) return mlBlobs.get(key);
  const r = await fetch(apiPre() + "/media/" + key, { headers: { Authorization: "Bearer " + TOK } });
  if (!r.ok) throw new Error("media unavailable");
  const url = URL.createObjectURL(await r.blob());
  const mime = r.headers.get("content-type") || "";
  let name = "";
  try { name = decodeURIComponent(r.headers.get("x-media-name") || ""); } catch {  }
  const out = { url, mime, name };
  mlBlobs.set(key, out);
  if (mlBlobs.size > 120) {
    const k0 = mlBlobs.keys().next().value;
    try { URL.revokeObjectURL(mlBlobs.get(k0).url); } catch {  }
    mlBlobs.delete(k0);
  }
  return out;
}

async function openMlPreview(key, name) {
  const ov = $("#mlPreview");
  if (!ov) return;
  ov.hidden = false;
  const box = $("#mlPrevMedia");
  const t = $("#mlPrevMeta");
  if (box) box.innerHTML = `<div class="mini mut" style="padding:18px">loading…</div>`;
  if (t) t.textContent = name || "";
  try {
    const med = await mlBlob(key);
    if (!ov || ov.hidden) return;
    const { url, mime, name: nm } = med;
    if (mime.startsWith("video/")) box.innerHTML = `<video src="${url}" controls autoplay></video>`;
    else if (mime.startsWith("audio/")) box.innerHTML = `<audio src="${url}" controls autoplay></audio>`;
    else if (mime.startsWith("image/")) box.innerHTML = `<img src="${url}" alt="media"/>`;
    else box.innerHTML =
      `<div class="mlprev-doc"><div class="mlprev-doc-ic">📄</div>` +
      `<a class="primary" href="${url}" download="${escAttr(nm || "download")}">⬇ Download ${esc(nm || "")}</a></div>`;
    if (t && nm) t.textContent = nm;
  } catch (err) {
    if (!ov || ov.hidden) return;
    if (box) box.innerHTML = `<div class="mini mut" style="padding:18px">media unavailable (bytes are cleared on restart)</div>`;
    if (t) t.textContent = "";
  }
}

function closeMlPreview() {
  const ov = $("#mlPreview");
  if (ov) ov.hidden = true;
  const box = $("#mlPrevMedia");
  if (box) box.innerHTML = "";
  const t = $("#mlPrevMeta");
  if (t) t.textContent = "";
}

function mlHomeHtml() {
  const groups = msgGroups();
  const byColl = { group: [], dm: [] };
  for (const [jid, rows] of groups) {
    byColl[rows[0].kind === "group" ? "group" : "dm"].push([jid, rows]);
  }
  const mk = (coll, icon, label, hint) => {
    const rows = byColl[coll];
    const chats = rows.length;
    const msgs = rows.reduce((a, [, r]) => a + r.length, 0);
    const blocked = rows.reduce((a, [, r]) => a + r.filter((x) => x.blocked).length, 0);
    const last = rows.length ? rows[0][1][0].ts : 0;
    return `<button class="mlcard" data-ml="open" data-coll="${coll}">
      <div class="mlcard-top"><span class="mlcard-ic">${icon}</span><span class="mlcard-label">${label}</span>
        <span class="spacer"></span><span class="mlcard-arrow">›</span></div>
      <div class="mlcard-meta">${chats ? `${chats} ${hint} · ${msgs} msg${msgs > 1 ? "s" : ""}${blocked ? ` · <span class="err-text">🔒 ${blocked}</span>` : ""}` : "nothing logged yet"}</div>
      <div class="mlcard-last">${last ? `most recent ${fmtClock(last)}` : ""}</div>
    </button>`;
  };
  const ok = mk("group", "👥", "Groups", "chats");
  const dm = mk("dm", "💬", "Direct messages", "conversations");
  const empty = groups.size ? "" : '<div class="mini mut">waiting for the first messages… (RAM only, cleared on restart)</div>';
  return `<div class="mlcards">${ok}${dm}</div>${empty}`;
}

function mlListHtml() {
  const coll = ML.coll;
  const rows = [];
  for (const [jid, msgs] of msgGroups()) {
    const kind = msgs[0].kind === "group" ? "group" : "dm";
    if (kind === coll) rows.push([jid, msgs]);
  }
  return `<div class="mlbread"><button class="mlback" data-ml="home">‹ Collections</button>
    <span class="mlbread-title">${coll === "group" ? "👥 Groups" : "💬 Direct messages"}</span></div>
    <div class="ml-scroll">${
      rows.length
        ? rows
            .map(([jid, msgs]) => {
              const blocked = msgs.filter((r) => r.blocked);
              return `<button class="mlchat" data-ml="msgs" data-jid="${esc(jid)}">
                <span class="mlchat-label">${msgGroupLabel(msgs[0])}</span>
                <span class="spacer"></span>
                ${blocked.length ? `<span class="mlrow-blocked">🔒 ${blocked.length}</span>` : ""}
                <span class="mlchat-meta">${msgs.length} msg${msgs.length > 1 ? "s" : ""} · ${fmtClock(msgs[0].ts)}</span>
                <span class="mlcard-arrow">›</span>
              </button>`;
            })
            .join("")
        : '<div class="mini mut">no ' + (coll === "group" ? "group" : "dm") + ' activity in the log yet…</div>'
    }</div>`;
}

function mlMsgsHtml() {
  const rows = RMESS.filter((m) => msgKey(m) === ML.jid);
  if (!rows.length) return '<div class="mini mut">that conversation left the log window…</div>';
  const m0 = rows[0];
  const sess = m0.session && m0.session !== "main" ? `<span class="mlrow-sess">${esc(m0.session)}</span>` : "";
  const num = (m0.jid || m0.number || "").split("@")[0];
  return `<div class="mlbread"><button class="mlback" data-ml="list">‹ Back</button></div>
    <div class="mthread-head">
      <div class="mthread-name">${esc(chatDisplayName(m0))}</div>
      <div class="mthread-sub">${sess}<code>${esc(num)}</code> · <span class="mut">${rows.length} msg${rows.length > 1 ? "s" : ""}</span></div>
    </div>
    <div class="ml-scroll ml-msgs">${rows.map(mlRowHtml).join("")}</div>`;
}

function logRowsHtml() {
  if (!RMESS.length && ML.view !== "home") ML.view = "home";
  if (ML.view === "msgs") return mlMsgsHtml();
  if (ML.view === "list") return mlListHtml();
  return mlHomeHtml();
}

function rcLockInfo(a) {
  if (!a.locked) return "";
  const left = Math.max(0, Math.ceil(((a.lockedUntil || 0) - Date.now()) / 60000));
  return left > 0 ? ` · <span class="warn-text">locked ${left} min</span>` : "";
}

function rcSig() {
  const m = D?.main || {};
  const q = m.queue || {};
  const h = m.host || {};
  const cfg = D?.config || {};
  const p = m.panic || {};
  return JSON.stringify([
    ROLE, m.connected, m.mode, m.user || "", m.wsReady,
    Math.round(m.uptimeSec || 0), m.pid,
    Math.round(m.rssMb || 0), Math.round(m.heapMb || 0),
    q.pending, q.active, q.paused,
    m.systemWatch && [m.systemWatch.enabled, m.systemWatch.intervalMs],
    Math.round(h.hostCpuPct ?? -1), Math.round((h.mem || {}).usedPct ?? -1), h.disk?.freeMb,
    cfg.prefix, cfg.botname, cfg.lang, cfg.policies,
    D.roles, D.features,
    D.rc && { enabled: D.rc.enabled, thresholds: D.rc.thresholds, retentionDays: D.rc.retentionDays, actors: D.rc.actors },
    p.enabled, p.elDelayMs, p.memoryMb, p.watchdog, p.panicked,
    D.userFlags, D.minis && D.minis.map((x) => [x.number, x.status]),
    CHATS.map((c) => [c.jid, c.name, c.ts, c.kind]),
    RMESS.map((x) => [x.id, x.jid, x.session, x.body, x.blocked, x.fromMe, x.ts, x.mediaInfo?.ready || 0]),
    ML.view, ML.coll, ML.jid,
    LAST_PAIR && (LAST_PAIR.code || LAST_PAIR.error || LAST_PAIR.num),
  ]);
}

function renderRemote() {
  const m = D?.main || {};
  const rc = D?.rc;
  const body = $("#rcBody");
  if (!body) return;
  const q = m.queue || {};
  const cfg = D?.config || {};
  const roles = D?.roles || { owners: [], creators: [] };
  const host = m.host || {};
  const features = D?.features || {};
  const creator = ROLE === "creator";

  ensureChats();
  ensureRecent();

  const sig = rcSig();
  if (body.dataset.sig === sig && body.childElementCount) return;
  body.dataset.sig = sig;

  const prevScroll = $(".msglog .ml-scroll");
  const mlKey = ML.view + "|" + ML.coll + "|" + ML.jid;
  const mlPrevKey = prevScroll?.dataset.mlkey || "";
  const mlTop = prevScroll ? prevScroll.scrollTop : 0;
  const mlH = prevScroll ? prevScroll.scrollHeight : 0;

  const queueBtn = q.paused
    ? `<button data-rc="queue" title="resume media/job queue">▶ resume queue</button>`
    : `<button data-rc="queue" title="pause media/job queue (soft suspend for the main)">⏸ pause queue</button>`;
  const maintBtn = features.maintenance
    ? `<button data-rc="maintenance" class="danger" title="maintenance blocks all non-owner commands">🛡 maintenance ON — toggle off</button>`
    : `<button data-rc="maintenance" title="maintenance blocks all non-owner commands">🛡 toggle maintenance</button>`;
  const swBtn = m.systemWatch?.enabled
    ? `<button data-rc="syswatch" data-v="0" title="host CPU/RAM/disk monitor (every ${m.systemWatch?.intervalMs ?? "?"}ms)">⏸ stop system watch</button>`
    : `<button data-rc="syswatch" data-v="1" title="host CPU/RAM/disk monitor">▶ start system watch</button>`;

  const creatorPower = creator
    ? `<button data-rc="reboot" class="danger" title="pm2 restart — brings the bot back with --update-env">♻️ reboot</button>
      <button data-rc="shutdown" class="danger" title="pm2 stop — requires a manual pm2 start to bring back">⛔ shutdown</button>
      <button data-rc="gitsys" title="git pull --ff-only + npm install + restart">⬆️ git update</button>
      <button data-rc="panictest" class="danger" title="trigger the core panic (test) — forces a pm2 stop">💥 panic test</button>`
    : "";

  const relinkBtn = creator
    ? `<button data-rc="relink" class="danger" title="wipes the MAIN auth state and shows a fresh QR — you must re-link">📵 force re-link</button>`
    : "";

  const roleHtml = creator
    ? `<div class="toggle-row"><span>owners (${roles.owners.length})</span><span class="spacer"></span><span class="mini">${esc(roles.owners.join(", ") || "none")}</span></div>
      <div class="toggle-row"><span>creators (${roles.creators.length})</span><span class="spacer"></span><span class="mini">${esc(roles.creators.join(", ") || "none")}</span></div>
      <div class="toolbar" style="margin-top:8px">
        <input id="rcRoleNum" placeholder="4915… number" style="width:150px"/>
        <select id="rcRoleSel"><option value="owner">owner</option><option value="creator">creator</option></select>
        <button data-rc="roleadd">add</button>
        <button data-rc="rolerm" class="danger">remove</button>
      </div>
      <div class="mini mut" style="margin-top:6px">Runtime role lists — the friend will live in <b>owner</b>, you in <b>creator</b>. These override who the bot trusts in-chat too.</div>`
    : "";

  const pairNote = LAST_PAIR
    ? LAST_PAIR.code
      ? `<div class="mini" style="margin-top:6px">🔑 Pairing code for <b>${esc(LAST_PAIR.num)}</b>: <code class="paircode">${esc(LAST_PAIR.code)}</code> — enter it once on that device (lasts the link session).</div>`
      : `<div class="mini err" style="margin-top:6px">✘ pair failed for ${esc(LAST_PAIR.num)}: ${esc(LAST_PAIR.error)}</div>`
    : "";

  const rcRows =
    (rc?.actors || []).map((a) => {
      const thr = a.threshold || {};
      const pct = thr.lock ? Math.min(100, Math.round((a.score / thr.lock) * 100)) : 0;
      const fillCls = pct >= 100 ? "dang" : pct >= 50 ? "warnv" : "";
      const clearBtn = a.openFlags
        ? `<button data-rc="rcclear" data-actor="${esc(a.actor)}" title="clear rc flags + lift lock">clear diagnostics</button>`
        : "";
      return `<tr><td><code>${esc(a.actor)}</code>${rcLockInfo(a)}</td>
        <td><div class="score-wrap"><div class="score-bar"><div class="score-fill ${fillCls}" style="width:${pct}%"></div></div>${a.score}/${thr.lock ?? "?"}</div></td>
        <td>${a.openFlags ?? 0}</td><td class="row-actions">${clearBtn}</td></tr>`;
    }).join("") ||
    '<tr><td colspan="4" class="mini">no remote-control activity tracked (rc monitor ' + (rc && rc.enabled !== false ? "on" : "off") + ").</td></tr>";

  const userRows =
    (D?.userFlags || []).map((u) =>
      `<tr><td class="num">${esc(u.number)}</td><td>${u.open ?? 0}</td>
        <td><div class="score-wrap"><div class="score-bar"><div class="${(u.score >= u.ban ? "score-fill dang" : "score-fill warnv")}" style="width:${u.ban ? Math.min(100, (u.score / u.ban) * 100) : 0}%"></div></div>${u.score}/${u.ban}</div></td>
        <td class="row-actions"><button data-rc="userresolve" data-num="${esc(u.number)}">resolve</button></td></tr>`
    ).join("") ||
    '<tr><td colspan="4" class="mini">no flagged users on the main connection.</td></tr>';

  const modePills = ["public", "private", "inbox", "group"]
    .map((mm) => `<button data-rc="mode" data-mode="${mm}" class="${m.mode === mm ? "active-mode" : ""}">${mm}</button>`)
    .join("");

  const polRows = Object.entries(cfg.policies || {}).map(([k, v]) => {
    const on = v === true || v === "true";
    if (typeof v === "boolean" || v === "true" || v === "false") {
      return `<div class="toggle-row"><span>${esc(k)}</span><span class="spacer"></span>
        <button data-rc="pol" data-k="${esc(k)}" data-v="${on ? "0" : "1"}" class="${on ? "primary" : ""}">${on ? "ON" : "OFF"}</button></div>`;
    }
    return `<div class="toggle-row"><span>${esc(k)}</span><span class="spacer"></span><span class="mini">${esc(String(v))}</span></div>`;
  }).join("");

  const panicLive = m.panic
    ? `<div class="toggle-row"><span>core panic</span><span class="spacer"></span><span class="${m.panic.enabled ? "" : "warn-text"}">${m.panic.enabled ? `armed · el>${m.panic.elDelayMs}ms · mem>${m.panic.memoryMb}MB${m.panic.watchdog ? " · watchdog" : ""}` : "OFF"}</span></div>
       <div class="toggle-row"><span>live</span><span class="spacer"></span><span class="mini">rate ${m.panic.Live?.ratePerMin ?? "?"}/min · sends ${m.panic.Live?.totals?.out ?? "?"} · fails ${m.panic.Live?.totals?.fails ?? "?"}</span></div>`
    : "";

  const chatOpts = CHATS.length
    ? `<option value="">— choose a chat —</option>` + CHATS.map((c) => `<option value="${esc(c.jid)}">${chatLabel(c)}</option>`).join("")
    : `<option value="">— no chats yet — groups/communities appear after the ↻ sync (or as the bot chats)</option>`;
  const viaOpts = (D?.minis || [])
    .map((mm) => `<option value="${esc(mm.number)}">via mini ${esc(mm.number)}</option>`)
    .join("");

  body.innerHTML =
    `<div class="settings-grid">
      <div class="panel"><h2>Connection <span class="mut">(${ROLE} tier)</span></h2>
        <div class="toggle-row"><span>status</span><span class="spacer"></span><span><span class="dot ${m.connected ? "on" : "off"}"></span> ${m.connected ? "connected" : "DISCONNECTED"}</span></div>
        <div class="toggle-row"><span>mode</span><span class="spacer"></span><b>${esc(m.mode || "?")}</b></div>
        <div class="toggle-row"><span>queue</span><span class="spacer"></span><span>${q.pending ?? 0} pending${q.active ? " · " + q.active + " active" : ""}${q.paused ? ' <span class="warn-text">paused</span>' : ""}</span></div>
        <div class="toggle-row"><span>uptime</span><span class="spacer"></span><span class="mini">${fmtUp(m.uptimeSec)} · ws ${m.wsReady ?? "?"}</span></div>
        <div class="toggle-row"><span>user</span><span class="spacer"></span><code class="mini">${esc(m.user || "—")}</code></div>
        <div class="toolbar" style="margin-top:10px">
          <button data-rc="reconnect" class="danger" title="respawn the main WhatsApp socket in place (keeps DB/BotKV)">🔄 reconnect session</button>
          ${relinkBtn}
        </div>
        <div class="toolbar" style="margin-top:6px">
          <input id="rcPairNum" placeholder="+49… mini number" style="width:150px"/>
          <button data-rc="pair" title="request a WhatsApp pairing code for a new Onyx Mini">🔑 pair code</button>
        </div>
        ${pairNote}
      </div>

      <div class="panel" style="grid-column:1/-1"><h2>Send a message as the bot <span class="mut">(main account — your identity)</span></h2>
        <div class="mini mut" style="margin-bottom:8px">Any kind of chat: DMs, groups, communities + broadcast lists all appear — the full group list is synced from the account (↻ to resync).</div>
        <div class="composer">
          <div class="composer-chats">
            <span class="mut" style="font-size:11px">recent chats — pick one</span>
            <select id="rcChatSel" size="6">${chatOpts}</select>
            <div class="toolbar" style="margin-top:4px">
              <button data-rc="refreshchats" title="reload the recent-chat list">↻</button>
              <span class="mini mut" id="rcChatCount"></span>
            </div>
          </div>
          <div class="composer-msg">
            <textarea id="rcMsgBody" rows="5" placeholder="Type your message… it sends AS the bot, from its own WhatsApp account."></textarea>
            <div class="toolbar">
              <select id="rcMsgVia"><option value="">via main (your bot)</option>${viaOpts}</select>
              <span class="spacer"></span>
              <button data-rc="sendchat" class="primary">📤 send as bot</button>
            </div>
            <div id="rcMsgHint" class="mini"></div>
          </div>
        </div>
      </div>

      <div class="panel" style="grid-column:1/-1"><h2>Recent messages <span class="mut">(grouped by chat · temporal · RAM only · never stored — cleared on restart)</span></h2>
        <div class="msglog-toolbar">
          <span class="mini mut" id="rcLogCount"></span>
          <span class="spacer"></span>
          <button data-rc="refreshlogs" class="mini" title="reload the temporal log">↻</button>
        </div>
        <div class="msglog">${logRowsHtml()}</div>
      </div>

      <div class="panel"><h2>Power &amp; lifecycle</h2>
        ${panicLive}
        <div class="toggle-row"><span>node</span><span class="spacer"></span><span class="mini">PID ${m.pid} · RSS ${m.rssMb}MB · heap ${m.heapMb}MB</span></div>
        ${m.systemWatch
          ? `<div class="toggle-row"><span>system watch</span><span class="spacer"></span><span class="mini">${m.systemWatch.enabled ? "running" : "stopped"} · cpu>${m.systemWatch.cpuWarn ?? "?"}% warn / ${m.systemWatch.hostCpuWarn ?? "?"}% host</span></div>${swBtn}`
          : ""}
        <div class="toggle-row"><span>host</span><span class="spacer"></span><span class="mini">CPU ${host.hostCpuPct ?? "?"}% · RAM ${host.mem?.usedPct ?? "?"}% · disk ${host.disk?.freeMb ? Math.round(host.disk.freeMb / 1024) + "GB free" : "?"}</span></div>
        <div class="toolbar" style="margin-top:10px">
          <button data-rc="backup" title="snapshot the database (+ optional auth) to ./backups/">🗄 backup now</button>
          ${creatorPower}
        </div>
        ${creator ? `<div class="mini mut" style="margin-top:8px">reboot / shutdown / git update / panic test are creator-only and always audited + confirmed.</div>` : ""}
      </div>

      <div class="panel"><h2>Runtime config</h2>
        <div class="mode-pills" style="margin-bottom:8px">${modePills}</div>
        <div class="toggle-row"><span>prefix</span><span class="spacer"></span><input id="rcPrefix" value="${esc(cfg.prefix ?? "!")}" style="width:70px"/><button data-rc="cfgprefix">set</button></div>
        <div class="toggle-row"><span>botname</span><span class="spacer"></span><input id="rcBotname" value="${esc(cfg.botname ?? "")}" style="flex:1"/><button data-rc="cfgbot">set</button></div>
        <div class="toggle-row"><span>lang</span><span class="spacer"></span>
          <select id="rcLang"><option ${(cfg.lang || "en") === "en" ? "selected" : ""}>en</option><option ${cfg.lang === "de" ? "selected" : ""}>de</option></select>
          <button data-rc="cfglang">set</button></div>
        <div class="toggle-row"><span>maintenance</span><span class="spacer"></span>${maintBtn}</div>
        <div class="toggle-row"><span>queue</span><span class="spacer"></span>${queueBtn}</div>
        <div style="margin-top:10px"><p class="mut" style="font-size:12px">Policies</p>${polRows}</div>
      </div>

      <div class="panel"><h2>Identity &amp; roles <span class="mut">(creator)</span></h2>
        ${roleHtml}
      </div>

      <div class="panel" style="grid-column:1/-1"><h2>Remote-control watchdog <span class="mut">(rc monitor ${rc && rc.enabled !== false ? "on" : "off"} · warn ${rc?.thresholds?.warn ?? "?"} · lock ${rc?.thresholds?.lock ?? "?"} · retention ${rc?.retentionDays ?? 30} d)</span></h2>
        ${rc?.actors?.length
          ? `<table><tr><th>actor</th><th>score / lock</th><th>flags</th><th></th></tr>${rcRows}</table>`
          : `<div class="mini">no remote-control activity yet. Operator actions are scored here; warn then lock like a mini being suspended.</div>`}
      </div>

      <div class="panel" style="grid-column:1/-1"><h2>Flagged users on main <span class="mut">(${D?.userFlags?.length ?? 0})</span></h2>
        <div class="toolbar"><span class="spacer"></span><button data-rc="clearusers" title="resolve all open user flags on the main connection">resolve all</button></div>
        <table><tr><th>user</th><th>open</th><th>score / ban</th><th></th></tr>${userRows}</table>
      </div>
    </div>
    <div class="panel" style="margin-top:12px"><div class="mini mut">Every action above is audited. Danger-sensitive controls ask for a confirm (armed server-side, 90 s on the operator tier). Operator actions are scored by the rc monitor; too many risky actions in 5 min → warn, then a 10 min lockout. Watched. 👀</div></div>`;

  const pairNum = $("#rcPairNum");
  if (pairNum && LAST_PAIR?.code) pairNum.value = "";

  const cs = $("#rcChatSel");
  if (cs) {
    cs.value = rcCompose.chat;
    cs.addEventListener("change", () => {
      rcCompose.chat = cs.value;
      updateRcHint();
    });
  }
  const cv = $("#rcMsgVia");
  if (cv) {
    cv.value = rcCompose.via;
    cv.addEventListener("change", () => {
      rcCompose.via = cv.value;
    });
  }
  const cb = $("#rcMsgBody");
  if (cb) {
    cb.value = rcCompose.body;
    cb.addEventListener("input", () => {
      rcCompose.body = cb.value;
    });
  }
  updateRcHint();
  const cc = $("#rcChatCount");
  if (cc) {
    const gN = CHATS.filter((c) => c.kind === "group").length;
    cc.textContent = CHATS.length
      ? `${CHATS.length} chats${gN ? ` · ${gN} group${gN > 1 ? "s" : ""}/communities` : ""}`
      : "↻ to refresh";
  }
  const lc = $("#rcLogCount");
  if (lc) lc.textContent = RMESS.length
    ? `${RMESS.length} msg${RMESS.length > 1 ? "s" : ""} · ${new Set(RMESS.map(msgKey)).size} chat${new Set(RMESS.map(msgKey)).size > 1 ? "s" : ""} · in-memory only`
    : "";

  const newScroll = $(".msglog .ml-scroll");
  if (newScroll) {
    newScroll.dataset.mlkey = mlKey;
    if (mlKey === mlPrevKey) {
      newScroll.scrollTop = mlTop + Math.max(0, newScroll.scrollHeight - mlH);
      $(".msglog").dataset.mlkey = mlKey;
    }
  }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-rc]");
  if (!b) return;
  const rc = b.getAttribute("data-rc");
  if (rc === "reconnect") {
    await doAction("main.reconnect", {}, { confirm: true, text: "Reconnect the main WhatsApp session in place? (respawns the socket, keeps DB)" });
    refresh();
  } else if (rc === "queue") {
    const paused = !!(D?.main?.queue?.paused);
    await doAction(paused ? "queue.resume" : "queue.pause", {});
    refresh();
  } else if (rc === "maintenance") {
    const target = !!(D?.features?.maintenance);
    await doAction("flags.set", { name: "maintenance", value: !target }, { confirm: true, text: (target ? "Turn maintenance OFF" : "Turn maintenance ON — this blocks all non-owner commands") + "?" });
    refresh();
  } else if (rc === "clearusers") {
    if (!window.confirm("Resolve ALL open user flags on the main connection?")) return;
    for (const u of D?.userFlags || []) await action("flags.clear", { number: u.number });
    refresh();
  } else if (rc === "userresolve") {
    await doAction("flags.clear", { number: b.getAttribute("data-num") });
    refresh();
  } else if (rc === "rcclear") {
    await doAction("rc.clear", { actor: b.getAttribute("data-actor"), id: "all", resetLock: true }, { confirm: true, text: "Clear rc watch flags and lift any lock for this actor?" });
    refresh();
  } else if (rc === "relink") {
    const j = await doAction("relink", {}, { confirm: true, text: "Force re-link the MAIN bot? This WIPES its WhatsApp auth state and shows a fresh QR — DB/BotKV stay, but you must re-scan. Continue?" });
    if (j?.ok) toast("📵 Auth state wiped — scan the fresh QR in <b>pm2 logs onyx</b>.", "");
    refresh();
  } else if (rc === "pair") {
    const num = ($("#rcPairNum")?.value || "").replace(/\D/g, "");
    if (!num) { alert("enter a number to pair"); return; }
    const j = await action("pair.request", { number: num });
    LAST_PAIR = j?.ok ? { num, code: j.data?.code } : { num, error: j?.error || "failed" };
    refresh();
  } else if (rc === "reboot") {
    const j = await doAction("reboot", {}, { confirm: true, text: "Reboot the bot (pm2 restart)? Restarts process only, leaves all data intact.", autoArm: false });
    if (j?.ok) toast("♻️ rebooting…", "");
    refresh();
  } else if (rc === "shutdown") {
    const j = await doAction("shutdown", {}, { confirm: true, text: "SHUT DOWN the bot (pm2 stop)? Requires a manual pm2 start to bring it back.", autoArm: false });
    if (j?.ok) toast("⛔ stopping…", "");
    refresh();
  } else if (rc === "gitsys") {
    const j = await doAction("git.update", {}, { confirm: true, text: "git pull --ff-only + npm install, then restart? Runs in the bot directory.", autoArm: false });
    if (j?.ok) toast("⬆️ updating + restarting…", "");
    refresh();
  } else if (rc === "panictest") {
    if (!window.confirm("Trigger a CORE PANIC (test)? This forces a genuine pm2 stop of the bot.")) return;
    const j = await action("panic.test", { reason: "web-remote" });
    if (j?.ok) toast("💥 panic triggered — pm2 stop incoming.", "err");
    refresh();
  } else if (rc === "backup") {
    const j = await action("backup.now", {});
    toast(j?.ok ? `🗄 ${esc(j.data?.file || "backup written")}` : `✘ backup failed: ${esc(j?.error || "?")}`, j?.ok ? "" : "err");
    refresh();
  } else if (rc === "sendchat") {
    const to = rcCompose.chat;
    const text = (rcCompose.body || "").trim();
    if (!to) { alert("pick a chat from the scroll list first"); return; }
    if (!text) { alert("type a message"); return; }
    const isGroup = to.endsWith("@g.us");
    if (isGroup && !window.confirm("Send to this GROUP as the bot? Every member will see it.")) return;
    const j = await doAction("send.chat", { to, text, via: rcCompose.via || "" });
    if (j?.ok) {
      toast(`📤 sent as bot → ${esc(to.split("@")[0])}${rcCompose.via ? " via " + esc(rcCompose.via) : ""}`, "");
      rcCompose.body = "";
      const cb = $("#rcMsgBody");
      if (cb) cb.value = "";
      ensureChats(true);
    } else if (j) {
      toast(`✘ ${esc(j.error || "send failed")}`, "err");
    }
    refresh();
  } else if (rc === "refreshchats") {
    ensureChats(true);
  } else if (rc === "refreshlogs") {
    ensureRecent(true);
  } else if (rc === "syswatch") {
    await doAction("syswatch.set", { enabled: b.getAttribute("data-v") === "1" });
    refresh();
  } else if (rc === "mode") {
    const j = await doAction("mode.set", { mode: b.getAttribute("data-mode") });
    refresh();
    if (j && !j.ok) alert(j.error);
  } else if (rc === "pol") {
    const k = b.getAttribute("data-k");
    const v = b.getAttribute("data-v") === "1";
    await doAction("config.set", { key: k, value: v ? "true" : "false" }, { confirm: true, text: `${v ? "Enable" : "Disable"} policy *${k}*?` });
    refresh();
  } else if (rc === "cfgprefix") {
    const v = ($("#rcPrefix")?.value || "").trim();
    if (!v) { alert("enter a prefix"); return; }
    await doAction("config.set", { key: "prefix", value: v });
    refresh();
  } else if (rc === "cfgbot") {
    const v = ($("#rcBotname")?.value || "").trim();
    if (!v) { alert("enter a bot name"); return; }
    await doAction("config.set", { key: "botname", value: v });
    refresh();
  } else if (rc === "cfglang") {
    const v = $("#rcLang")?.value || "en";
    await doAction("config.set", { key: "lang", value: v });
    refresh();
  } else if (rc === "roleadd" || rc === "rolerm") {
    const num = ($("#rcRoleNum")?.value || "").replace(/\D/g, "");
    const role = $("#rcRoleSel")?.value || "owner";
    if (!num) { alert("enter a number"); return; }
    const add = rc === "roleadd";
    const j = await doAction("roles.set", { number: num, role, op: add ? "add" : "remove" }, { confirm: true, text: `${add ? "Add" : "Remove"} *${role}* ${num}?` });
    if (j?.ok) toast(`✔ ${add ? "added" : "removed"} ${role} ${num}`, "");
    refresh();
  }
});

function renderSettings() {
  const prevBansScroll = document.getElementById("bansList")?.scrollTop ?? 0;
  const m = D?.main || {};
  const features = D?.features || {};
  const bans = D?.bans || [];

  const modes = ["public", "private", "inbox", "group"];
  const pills = modes
    .map((mm) => `<button class="${m.mode === mm ? "active-mode" : ""}" data-act="mode" data-mode="${mm}">${mm}</button>`)
    .join("");
  const flagsHtml = Object.entries(features)
    .map(([k, v]) => {
      const on = !!v;
      return `<div class="toggle-row"><span>${esc(k)}</span><span class="spacer"></span>
        <span class="onselect"><button data-act="fset" data-name="${esc(k)}" data-value="${on ? "0" : "1"}" class="${on ? "primary" : ""}">${on ? "ON" : "OFF"}</button></span></div>`;
    })
    .join("");
  const bansRows = bans.length
    ? bans.map((b) => `<div class="toggle-row"><span>${esc(b)}</span><span class="spacer"></span><button class="danger" data-act="banrm" data-num="${esc(b)}">unban</button></div>`).join("")
    : '<div class="mini">no banned numbers.</div>';

  $("#stBody").innerHTML =
    `<div class="settings-grid">
      <div class="panel"><h2>Bot mode</h2>
        <p class="mut" style="font-size:12px">public: everyone · private: owner/sudo only · inbox: groups blocked · group: DM blocked</p>
        <div class="mode-pills">${pills}</div>
      </div>
      <div class="panel"><h2>Feature flags</h2>${flagsHtml}</div>
      <div class="panel"><h2>Global bans</h2>
        <textarea id="banNum" rows="5" placeholder="one number per line — or space / comma separated&#10;e.g.&#10;+49 155 …&#10;49155…" style="width:100%;box-sizing:border-box"></textarea>
        <div class="toolbar" style="margin:8px 0 8px 0">
          <button class="danger" data-act="banadd">ban all</button>
          <span id="banHint" class="mini"></span>
        </div><div class="bans-list" id="bansList">${bansRows}</div>
      </div>
    </div>`;
  const bansList = document.getElementById("bansList");
  if (bansList) bansList.scrollTop = prevBansScroll;
}

function renderActive() {
  if (active === "overview") renderOverview();
  else if (active === "minis") renderMinis();
  else if (active === "remote") renderRemote();
  else if (active === "flags") renderFlags();
  else if (active === "settings") renderSettings();
  else if (active === "logs") renderLogs();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const j = await apiGet("/api/dashboard");
    if (!j) { $("#hApi").textContent = "AUTH"; return; }
    D = j;
    $("#hApi").textContent = "ok";
    renderHeader();
    if (!uiBusy()) renderActive();
  } catch (e) {
    $("#hApi").textContent = "ERR";
  } finally {
    refreshing = false;
  }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest ? e.target.closest("[data-act]") : null;
  if (!b) return;
  const act = b.getAttribute("data-act");
  const num = b.getAttribute("data-num") || "";
  const id = b.getAttribute("data-id") || "";

  if (act === "fleetRefresh") { ensureFleet(true); }
  else if (act === "fleetSwitch") { switchInstance(b.getAttribute("data-name") || ""); }
  else if (act === "instLocal") { switchInstance(""); }
  else if (act === "detail") { selMini = num; renderMinis(); }
  else if (act === "remove" && confirm("REMOVE " + num + "? Logs the socket out and deletes the session. Continue?")) {
    await action("minis.remove", { number: num });
    if (selMini === num) selMini = "";
    refresh();
  } else if (act === "suspend" && confirm("Suspend " + num + "?")) { await action("minis.suspend", { number: num, reason: "dev-console" }); refresh(); }
  else if (act === "unsuspend") { await action("minis.unsuspend", { number: num }); refresh(); }
  else if (act === "respawn") { await action("minis.respawn", { number: num }); refresh(); }
  else if (act === "resolve") { await action("flags.clear", { number: num, id }); refresh(); }
  else if (act === "resolveall") { await action("flags.clear", { number: num, id: "all" }); refresh(); }
  else if (act === "mode") {
    const j = await action("mode.set", { mode: b.getAttribute("data-mode") });
    refresh();
    if (!j.ok) alert(j.error);
  } else if (act === "fset") {
    const name = b.getAttribute("data-name");
    const value = b.getAttribute("data-value") === "1";
    const j = await action("flags.set", { name, value });
    refresh();
    if (!j.ok) alert(j.error);
  } else if (act === "banadd") {
    const raw = $("#banNum")?.value || "";
    const nums = [...new Set(raw.split(/[\s,;]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean))];
    if (!nums.length) { alert("enter a number"); return; }
    $("#banHint").textContent = `banning ${nums.length}…`;
    let banned = 0;
    for (const n of nums) {
      const j = await action("bans.add", { number: n });
      if (j.ok) banned++;
    }
    const hint = $("#banHint");
    hint.textContent = `banned ${banned} / ${nums.length}`;
    setTimeout(() => { if (hint) hint.textContent = ""; }, 4000);
    refresh();
  } else if (act === "banrm") { await action("bans.remove", { number: num }); refresh(); }
  else if (act === "inviteCreate") {
    const label = ($("#invLabel")?.value || "").trim();
    const j = await action("invite.create", { label: label || "untitled invite" });
    if (j?.ok && j.data?.url) {
      toast(`🔗 invite: <code>${esc(j.data.url)}</code>`, "");
    } else {
      alert(j?.error || "invite.create failed");
    }
    INVITES_AT = 0;
    renderMinis();
  } else if (act === "inviteCopy") {
    const token = b.getAttribute("data-token");
    const url = location.origin + "/invite/" + encodeURIComponent(token);
    copyText(url);
    toast("🔗 invite link copied to clipboard");
  } else if (act === "inviteRevoke") {
    if (!confirm("Revoke this invite link? It stops working immediately.")) return;
    await action("invite.revoke", { token: b.getAttribute("data-token") });
    refresh();
  }
  else if (act === "panic.test") { await action("panic.test", { reason: "web-console" }); termOut("panic triggered — bot is stopping.", "warn"); }
});

document.addEventListener("keydown", async (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
  const t = e.target;
  if (!t || t.id !== "banNum") return;
  e.preventDefault();
  document.querySelector('#stBody button[data-act="banadd"]')?.click();
});

document.addEventListener("click", (e) => {
  const wrap = e.target.closest ? e.target.closest(".mlthumb-wrap[data-mkey]") : null;
  if (wrap) {
    e.preventDefault();
    const key = wrap.getAttribute("data-mkey");
    if (wrap.classList.contains("failed")) {
      toast("✕ media unavailable (bytes cleared on restart or download failed)", "err");
      return;
    }
    if (!wrap.classList.contains("ready")) {
      toast("⏳ media still downloading…", "");
      return;
    }
    openMlPreview(key, wrap.getAttribute("data-mname") || "");
    return;
  }
  if (e.target.closest && e.target.closest("#mlPrevClose")) { closeMlPreview(); return; }
  if (e.target === document.getElementById("mlPreview")) { closeMlPreview(); return; }

  const b = e.target.closest ? e.target.closest("[data-ml]") : null;
  if (!b) return;
  const m = b.getAttribute("data-ml");
  if (m === "open") {
    ML.view = "list";
    ML.coll = b.getAttribute("data-coll") === "dm" ? "dm" : "group";
  } else if (m === "list") {
    ML.view = "list";
  } else if (m === "msgs") {
    ML.view = "msgs";
    ML.jid = b.getAttribute("data-jid") || ML.jid;
  } else if (m === "home") {
    ML.view = "home";
    ML.jid = "";
  }
  renderRemote();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMlPreview();
});

document.querySelector("#nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav");
  if (!btn) return;
  active = btn.getAttribute("data-nav");
  document.querySelectorAll(".nav").forEach((n) => n.classList.toggle("active", n === btn));
  document.querySelectorAll(".sec").forEach((s) => s.classList.toggle("active", s.id === "sec-" + active));
  if (active === "audit") renderAudit();
  else if (active === "logs") renderLogs();
  else if (active === "terminal") setTimeout(() => $("#tmIn").focus(), 60);
  renderActive();
});

$("#btnRefresh").addEventListener("click", refresh);

$("#btnTok").addEventListener("click", () => {
  TOK = ($("#tokIn").value || "").trim();
  if (!TOK) { alert("enter a token"); return; }
  sessionStorage.setItem("dcToken", TOK);
  $("#tokBox").hidden = true;
  boot();
});
if (!TOK) showTok();

$("#btnSend").addEventListener("click", async () => {
  const num = ($("#tNum").value || "").replace(/\D/g, "");
  const text = ($("#tText").value || "🔧 Dev console test message.").trim();
  if (!num) { alert("enter a target number"); return; }
  const via = $("#tVia").value || "";
  const j = await action("send.test", { target: num, text, mini: via });
  const det = $("#miDetail");
  if (det) det.innerHTML = `<div class="mini ${j.ok ? "ok" : "err"}">${esc(j.ok ? "sent via " + (via || "main") + " → " + num : j.error)}</div>`;
});

$("#lgFilter").addEventListener("input", (e) => { logFilter = e.target.value.toLowerCase().trim(); renderLogs(); });
$("#btnPause").addEventListener("click", () => {
  logsPaused = !logsPaused;
  $("#btnPause").textContent = logsPaused ? "▶ resume" : "❚❚ pause";
  if (!logsPaused) renderLogs(true);
});
$("#btnClear").addEventListener("click", () => { LOG.length = 0; renderLogs(true); });

$("#flRule").addEventListener("change", renderFlags);
$("#flSeverity").addEventListener("change", renderFlags);
$("#flResolved").addEventListener("change", renderFlags);
$("#btnResolveAll").addEventListener("click", async () => {
  if (!confirm("Resolve ALL open flags on ALL minis?")) return;
  for (const x of D?.minis || []) {
    if (x.openFlags > 0) await action("flags.clear", { number: x.number, id: "all" });
  }
  refresh();
});
$("#btnAudit").addEventListener("click", renderAudit);
$("#auFilter").addEventListener("keydown", (e) => { if (e.key === "Enter") renderAudit(); });

const tmIn = $("#tmIn");
tmIn.addEventListener("keydown", (e) => {
  const max = termHist.length;
  if (e.key === "ArrowUp") {
    if (!max) { e.preventDefault(); return; }
    termIdx = Math.max(0, termIdx === max ? max - 1 : termIdx - 1);
    e.target.value = termHist[termIdx] || "";
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    termIdx = Math.min(max, termIdx + 1);
    e.target.value = termHist[termIdx] || "";
    e.preventDefault();
  } else if (e.key === "Enter") {
    const line = e.target.value.trim();
    e.target.value = "";
    if (!line) return;
    if (/^(panic|reboot|shutdown)(\s|$)/i.test(line) && !dangerArmed) {
      termOut("⚠️ <b>panic</b>/<b>reboot</b>/<b>shutdown</b> are guarded. Click <i>arm danger</i> to allow.", "warn");
      return;
    }
    if (line === "clear" || line === "cls") {
      termClear();
      return;
    }
    if (termHist[termHist.length - 1] !== line) termHist.push(line);
    termIdx = termHist.length;
    termRun(line);
  }
});
$("#tmDanger").addEventListener("click", () => {
  dangerArmed = !dangerArmed;
  $("#tmDanger").textContent = dangerArmed ? "⚠ danger armed" : "arm danger";
  $("#tmDanger").classList.toggle("armed", dangerArmed);
});

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  refresh();
  openLogStream();

  const tick = () => {
    const delay = document.hidden ? 10_000 : 1_000;
    setTimeout(() => {
      refresh();
      tick();
    }, delay);
  };
  tick();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

if (TOK) boot();