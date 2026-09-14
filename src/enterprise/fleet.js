/**
 * Fleet view — aggregate multiple main instances under one dashboard.
 *
 * Each main runs its own admin HTTP + dashboard; a "hub" instance polls the
 * other mains through their admin token and serves a combined snapshot at
 * GET /api/fleet so the Overview page can show all mains as one.
 *
 *   FLEET_PEERS   semicolon-separated "name:port:TOKEN" peers. The host
 *                 defaults to ADMIN_HTTP_HOST / 127.0.0.1. The instance you
 *                 are viewing is always included as the "self" entry — list
 *                 only the OTHERS here.
 *   FLEET_TTL_MS  how long one snapshot is cached per peer (default 6000)
 *
 * Security note: peer tokens travel over plain HTTP on the same network the
 * operator already uses to reach the dashboards — keep FLEET_PEERS scoped to
 * trusted hosts and never put it in a public config.
 */

const PEER_TIMEOUT_MS = 2500;
const cache = new Map(); // name -> { ts, data }

export function fleetPeers() {
  const raw = process.env.FLEET_PEERS || "";
  const host = process.env.ADMIN_HTTP_HOST || "127.0.0.1";
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, port, token] = part.split(":");
      return { name: name || `peer:${port}`, host, port: Number(port), token };
    })
    .filter((p) => Number.isFinite(p.port) && p.port > 0 && p.token);
}

async function fetchPeer({ name, host, port, token }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PEER_TIMEOUT_MS);
  try {
    const r = await fetch(`http://${host}:${port}/api/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const m = d?.main || {};
    const minis = d?.minis || [];
    return {
      name,
      ok: true,
      ts: Date.now(),
      version: d?.version || "?",
      mode: m.mode || "?",
      connected: !!m.connected,
      linked: !!(m.user && m.connected),
      wsReady: !!m.wsReady,
      uptimeSec: m.uptimeSec || 0,
      user: m.user || "",
      minis: minis.length,
      minisOn: minis.filter((s) => s.status === "connected").length,
      panic: !!m.panic?.enabled,
    };
  } catch (e) {
    return { name, ok: false, ts: Date.now(), err: e?.name === "AbortError" ? "timeout" : e?.message || "?" };
  } finally {
    clearTimeout(t);
  }
}

/** Combined lean snapshot of every configured peer (cached per TTL). */
export async function fetchFleet() {
  const peers = fleetPeers();
  const ttl = Number(process.env.FLEET_TTL_MS) || 6000;
  const now = Date.now();
  const out = [];
  await Promise.all(
    peers.map(async (p) => {
      const hit = cache.get(p.name);
      if (hit && now - hit.ts < ttl) {
        out.push(hit.data);
        return;
      }
      const data = await fetchPeer(p);
      cache.set(p.name, { ts: now, data });
      out.push(data);
    })
  );
  return out;
}

/** Build the local-instance snapshot in the same shape as a peer. */
export function selfSnapshot(main, minis, version) {
  const m = main || {};
  return {
    name: "you",
    ok: true,
    ts: Date.now(),
    version: version || "?",
    mode: m.mode || "?",
    connected: !!m.connected,
    linked: !!(m.user),
    wsReady: !!m.wsReady,
    uptimeSec: m.uptimeSec || 0,
    user: m.user || "",
    minis: (minis || []).length,
    minisOn: (minis || []).filter((s) => s.status === "connected").length,
    panic: !!m.panic?.enabled,
  };
}