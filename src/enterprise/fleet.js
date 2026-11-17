

const PEER_TIMEOUT_MS = 2500;
const cache = new Map();

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