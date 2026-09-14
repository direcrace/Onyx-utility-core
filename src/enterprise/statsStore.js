/**
 * Dashboard statistics — in-memory sparkline series + BotKV hourly aggregates.
 *
 * Called via startStatsSampler() (starts a 60 s interval) and lazily on
 * getStats().  All reads are synchronous in-memory (except first init which
 * hydrates from BotKV once).
 *
 * Env knobs:
 *   STATS_SAMPLE_MS      background sample interval (default 60 000)
 *   STATS_SAMPLE_MIN_MS  min time between lazy samples from /api (default 3 000)
 *   STATS_SERIES_MAX     max sparkline points (default 360; persisted in BotKV)
 *   STATS_HOURLY_RETENTION_HOURS  hours kept in BotKV (default 168 = 7 d)
 */

import { kvGet, kvSet } from "../database/botKv.js";

// --- config ----------------------------------------------------------------

const SAMPLE_MS = Math.max(15_000, Number(process.env.STATS_SAMPLE_MS) || 60_000);
const SAMPLE_MIN_MS = Math.max(1_000, Number(process.env.STATS_SAMPLE_MIN_MS) || 1_000);
const SERIES_MAX = Math.max(60, Number(process.env.STATS_SERIES_MAX) || 720);
const HOURLY_RETENTION_HOURS = Number(process.env.STATS_HOURLY_RETENTION_HOURS) || 168; // 7 d
const STORE_KEY = "stats_hourly";
const SERIES_KEY = "stats_series";

// --- state ----------------------------------------------------------------

/** @type {Array<{ts,rss,heap,cpuPct,hostCpuPct,mem,diskGb,queue,rate,sends,fails,errorsMin}>} */
let series = [];
let lastSampleAt = 0;
let samplerTimer = null;

// delta baselines (set after first sample)
let prevCounters = null;
let prevTraffic = null;

// persisted hourly buckets — hydrated once per process
let hourlyHydrated = false;
/** @type {Object<string, {in: number, out: number, fails: number, cmds: number, errs: number, jobsOk: number, jobsFail: number}>} */
let hourly = {};

// persisted sparkline series — survives restarts so charts keep their lines
let seriesHydrated = false;
let lastSeriesSave = 0;
let lastHourlySave = 0;

// --- helpers ---------------------------------------------------------------

function hourKey(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
}

function todayKey() {
  return hourKey(Date.now());
}

// --- persistence -----------------------------------------------------------

async function loadHourly() {
  if (hourlyHydrated) return hourly;
  try {
    const raw = await kvGet(STORE_KEY);
    hourly = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    hourly = {};
  }
  hourlyHydrated = true;
  pruneHourly();
  return hourly;
}

function pruneHourly() {
  const cutoff = Date.now() - HOURLY_RETENTION_HOURS * 3_600_000;
  const cutoffKey = hourKey(cutoff);
  for (const key of Object.keys(hourly)) {
    if (key < cutoffKey) delete hourly[key];
  }
}

async function saveHourly() {
  try {
    await kvSet(STORE_KEY, hourly);
  } catch {
    /* BotKV may not be initialized in tests */
  }
}

async function loadSeries() {
  if (seriesHydrated) return;
  seriesHydrated = true;
  try {
    const raw = await kvGet(SERIES_KEY);
    if (!Array.isArray(raw) || !raw.length) return;
    const pts = raw.filter((p) => p && typeof p === "object" && typeof p.ts === "number");
    if (!pts.length) return;
    // stale on purpose: a >5 min gap means downtime → start a fresh chart
    if (Date.now() - pts[pts.length - 1].ts > 5 * 60_000) return;
    series = pts;
    if (series.length > SERIES_MAX) series.splice(0, series.length - SERIES_MAX);
  } catch { /* ignore */ }
}

async function saveSeries() {
  if (Date.now() - lastSeriesSave < 5_000) return;
  lastSeriesSave = Date.now();
  try {
    await kvSet(SERIES_KEY, series.slice(-SERIES_MAX));
  } catch {
    /* BotKV may not be initialized in tests */
  }
}

// --- sampling -------------------------------------------------------------

/**
 * Collect a snapshot now.  Called on a timer and lazily when /api/stats is
 * requested.  No-ops if the last sample was <3 s ago.
 */
export async function sampleNow() {
  await loadSeries();
  const now = Date.now();
  if (now - lastSampleAt < SAMPLE_MIN_MS) return;
  lastSampleAt = now;

  // --- gather current values (dynamic imports to avoid startup ordering) ---
  let metricsSnap = null;
  try {
    const { getMetricsSnapshot } = await import("./metrics.js");
    metricsSnap = getMetricsSnapshot();
  } catch { /* ignore */ }

  let live = { totals: { in: 0, out: 0, fails: 0 } };
  try {
    const { getCorePanicStatus } = await import("../system/corePanic.js");
    live = getCorePanicStatus().Live || live;
  } catch { /* ignore */ }

  let host = {};
  try {
    const { hostSnapshot } = await import("../system/systemWatch.js");
    host = await hostSnapshot().catch(() => ({}));
  } catch { /* ignore */ }

  let queue = { pending: 0, active: 0 };
  try {
    const { queueStats } = await import("./queue.js");
    queue = queueStats();
  } catch { /* ignore */ }

  // --- push sparkline point ------------------------------------------------
  const counters = metricsSnap?.counters || {};
  const traffic = live.totals || { in: 0, out: 0, fails: 0 };

  series.push({
    ts: now,
    rss: host.rssMb ?? 0,
    heap: host.heapMb ?? 0,
    cpuPct: host.cpuPct ?? 0,
    hostCpuPct: host.hostCpuPct ?? 0,
    mem: host.mem?.usedPct ?? 0,
    diskGb: Math.round((host.disk?.freeMb ?? 0) / 102.4) / 10,
    queue: queue.pending ?? 0,
    rate: live.ratePerMin ?? 0,
    sends: live.sendBurstNow ?? 0,
    errorsMin: metricsSnap?.errors_last_min ?? 0,
  });
  if (series.length > SERIES_MAX) series.splice(0, series.length - SERIES_MAX);
  await saveSeries();

  // --- hourly aggregate (deltas from prev counters) -------------------------
  await loadHourly();
  const key = todayKey();
  if (!hourly[key]) hourly[key] = { in: 0, out: 0, fails: 0, cmds: 0, errs: 0, jobsOk: 0, jobsFail: 0 };

  if (prevCounters && prevTraffic) {
    const hc = hourly[key];
    hc.in  += Math.max(0, traffic.in  - (prevTraffic.in  || 0));
    hc.out += Math.max(0, traffic.out - (prevTraffic.out || 0));
    hc.fails += Math.max(0, traffic.fails - (prevTraffic.fails || 0));
    hc.cmds  += Math.max(0, (counters.commands || 0) - (prevCounters.commands || 0));
    hc.errs  += Math.max(0, (counters.errors  || 0) - (prevCounters.errors  || 0));
    hc.jobsOk += Math.max(0, (counters.jobs_ok || 0) - (prevCounters.jobs_ok || 0));
    hc.jobsFail += Math.max(0, (counters.jobs_fail || 0) - (prevCounters.jobs_fail || 0));
    if (Date.now() - lastHourlySave > 60_000) {
      lastHourlySave = Date.now();
      await saveHourly();
    }
  }
  prevCounters = { ...counters };
  prevTraffic  = { ...traffic };
}

// --- public API -----------------------------------------------------------

/**
 * Return the full stats payload for the dashboard.
 */
export async function getStats() {
  await sampleNow();
  const hArr = Object.keys(hourly)
    .sort()
    .slice(-48)
    .map((k) => ({ hour: k, ...hourly[k] }));
  return { series, hourly: hArr };
}

/**
 * Aggregate all mini-flags into a single summary.  Used by /api/dashboard and
 * the Flags section.  Returns records (newest first), counts by rule/severity,
 * and today/week totals.
 */
export async function summarizeFlags() {
  try {
    const raw = await kvGet("mini_flags");
    const store = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

    const now = Date.now();
    const DAY = 86_400_000;
    const WEEK = 7 * DAY;
    const allRecords = [];
    const byRule = {};
    const bySeverity = { info: 0, mild: 0, severe: 0, critical: 0 };
    const byScope = { mini: 0, user: 0 };
    let openToday = 0;
    let openWeek = 0;

    for (const [number, records] of Object.entries(store)) {
      if (!Array.isArray(records)) continue;
      for (const r of records) {
        if (!r?.id) continue;
        const rec = { number, scope: r.scope === "user" ? "user" : "mini", ...r };
        allRecords.push(rec);
        if (!byRule[r.rule]) byRule[r.rule] = { rule: r.rule, severity: r.severity, weight: r.weight, total: 0, open: 0 };
        byRule[r.rule].total += 1;
        if (!r.resolved) byRule[r.rule].open += 1;
        if (bySeverity[r.severity] !== undefined) bySeverity[r.severity] += 1;
        if (rec.scope === "user") byScope.user += 1; else byScope.mini += 1;
        if (!r.resolved && now - r.ts < DAY) openToday += 1;
        if (!r.resolved && now - r.ts < WEEK)  openWeek  += 1;
      }
    }

    allRecords.sort((a, b) => b.ts - a.ts);
    const openTotal = allRecords.filter((r) => !r.resolved).length;

    return {
      totalOpen: openTotal,
      totalToday: openToday,
      totalWeek: openWeek,
      totalRecords: allRecords.length,
      resolvedTotal: allRecords.filter((r) => r.resolved).length,
      byRule: Object.values(byRule).sort((a, b) => b.open - a.open),
      bySeverity,
      byScope,
      records: allRecords.slice(0, 200),
    };
  } catch {
    return { totalOpen: 0, totalToday: 0, totalWeek: 0, totalRecords: 0, resolvedTotal: 0, byRule: [], bySeverity: { info: 0, mild: 0, severe: 0, critical: 0 }, byScope: { mini: 0, user: 0 }, records: [] };
  }
}

// --- sampler lifecycle -----------------------------------------------------

export function startStatsSampler() {
  if (samplerTimer) return;
  console.log("[stats] Sampler armed (every", Math.round(SAMPLE_MS / 1000), "s).");
  samplerTimer = setInterval(() => sampleNow().catch(() => {}), SAMPLE_MS);
  samplerTimer.unref?.();
}
