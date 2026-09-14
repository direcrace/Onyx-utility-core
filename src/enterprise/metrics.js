/**
 * In-memory metrics + error-rate alerts to system log group
 */

import { systemLog } from "../utils/logGroup.js";

const counters = Object.create(null);
const timings = Object.create(null);

/** Sliding window of error timestamps */
const errorTimes = [];
const WINDOW_MS = 60_000;
const ERROR_ALERT_THRESHOLD = Number(process.env.ERROR_ALERT_THRESHOLD || 8);
let lastAlertAt = 0;
const ALERT_COOLDOWN_MS = 120_000;

const startedAt = Date.now();

export function recordMetric(name, value = 1) {
  if (name.endsWith("_ms")) {
    if (!timings[name]) timings[name] = [];
    timings[name].push(value);
    if (timings[name].length > 100) timings[name].shift();
    return;
  }
  counters[name] = (counters[name] || 0) + value;

  if (name === "errors") {
    const now = Date.now();
    errorTimes.push(now);
    while (errorTimes.length && now - errorTimes[0] > WINDOW_MS) {
      errorTimes.shift();
    }
    maybeAlert(now);
  }
}

async function maybeAlert(now) {
  if (errorTimes.length < ERROR_ALERT_THRESHOLD) return;
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;
  await systemLog(
    "warn",
    `⚠ Error-rate alert: ${errorTimes.length} errors in the last ${WINDOW_MS / 1000}s (threshold ${ERROR_ALERT_THRESHOLD})`
  );
}

export function recordError() {
  recordMetric("errors", 1);
}

export function recordCommand(name) {
  recordMetric("commands", 1);
  recordMetric(`cmd_${name}`, 1);
}

export function getMetricsSnapshot() {
  const avg = (arr) =>
    arr?.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  return {
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    counters: { ...counters },
    errors_last_min: errorTimes.filter((t) => Date.now() - t < WINDOW_MS).length,
    avg_job_ms: avg(timings.jobs_ms),
    started_at: startedAt,
  };
}

/** Prometheus text exposition */
export function metricsPrometheus() {
  const snap = getMetricsSnapshot();
  const lines = [
    `# HELP xasena_uptime_seconds Process uptime`,
    `# TYPE xasena_uptime_seconds gauge`,
    `xasena_uptime_seconds ${snap.uptime_s}`,
    `# HELP xasena_errors_last_minute Recent errors`,
    `# TYPE xasena_errors_last_minute gauge`,
    `xasena_errors_last_minute ${snap.errors_last_min}`,
  ];
  for (const [k, v] of Object.entries(snap.counters)) {
    const name = `xasena_${k.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${v}`);
  }
  return lines.join("\n") + "\n";
}
