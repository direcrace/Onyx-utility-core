/**
 * Bounded in-process console capture ring.
 *
 * Captures every console.log/warn/error/info so the dev console (web SSE pane,
 * chat `#minilog`, terminal `logs`) can tail live output without reading log
 * files. Bounded to DEV_CONSOLE_LOG_MAX entries (default 2000).
 */

const MAX = Math.max(100, Number(process.env.DEV_CONSOLE_LOG_MAX) || 2000);
const ring = [];
const subscribers = new Set();
let installed = false;

function formatArg(a) {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || String(a);
  if (typeof a === "object") {
    try {
      const s = JSON.stringify(a);
      return s === undefined ? String(a) : s;
    } catch {
      return String(a);
    }
  }
  return String(a);
}

function emit(entry) {
  for (const fn of [...subscribers]) {
    // Defer so a subscriber that logs cannot recurse into us.
    setImmediate(() => {
      try {
        fn(entry);
      } catch {
        /* never let a subscriber break the ring */
      }
    });
  }
}

/**
 * Patch console.* once. Call at the very top of boot so every line lands here.
 */
export function installConsoleRing() {
  if (installed) return true;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level];
    if (typeof orig !== "function") continue;
    console[level] = (...args) => {
      const text = args.map(formatArg).join(" ");
      if (text) {
        const entry = { ts: Date.now(), level, text };
        ring.push(entry);
        if (ring.length > MAX) ring.splice(0, ring.length - MAX);
        emit(entry);
      }
      orig(...args);
    };
  }
  return true;
}

/** Last n lines of captured console output. */
export function getRingTail(n = 100, filter) {
  const count = Math.min(Math.max(1, n | 0), 500);
  let list = ring;
  if (filter) {
    const re = (() => {
      try {
        return new RegExp(filter, "i");
      } catch {
        return null;
      }
    })();
    if (re) list = ring.filter((e) => re.test(e.text));
  }
  return list.slice(-count);
}

/**
 * Subscribe to new console lines. Returns an unsubscribe fn.
 * @param {(entry:{ts:number,level:string,text:string})=>void} fn
 */
export function subscribeConsole(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}