

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

    setImmediate(() => {
      try {
        fn(entry);
      } catch {

      }
    });
  }
}

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

export function subscribeConsole(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}