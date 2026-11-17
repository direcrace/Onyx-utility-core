

import logger from "../utils/logger.js";
import { recordMetric } from "./metrics.js";

const queue = [];
let active = 0;
let paused = false;
const CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 1);

export function enqueueJob(name, fn) {
  return new Promise((resolve, reject) => {
    queue.push({ name, fn, resolve, reject, enqueuedAt: Date.now() });
    recordMetric("jobs_enqueued", 1);
    pump();
  });
}

function pump() {
  while (!paused && active < CONCURRENCY && queue.length) {
    const job = queue.shift();
    active += 1;
    const start = Date.now();
    Promise.resolve()
      .then(() => job.fn())
      .then((result) => {
        recordMetric("jobs_ok", 1);
        recordMetric("jobs_ms", Date.now() - start);
        job.resolve(result);
      })
      .catch((err) => {
        recordMetric("jobs_fail", 1);
        logger.warn(`Job ${job.name} failed:`, err?.message || err);
        job.reject(err);
      })
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function queueStats() {
  return { pending: queue.length, active, concurrency: CONCURRENCY, paused };
}

export function setQueuePaused(value) {
  paused = !!value;
  if (!paused) pump();
  return paused;
}
