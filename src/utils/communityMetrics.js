import { listRegistrations } from "./registration.js";
import { legalVersions, listConsents, consentIsCurrent } from "./consent.js";
import { getAssignedRanks, RANKS } from "./ranks.js";
import { listTickets } from "./supportTickets.js";

const PENDING_PREFIXES = {
  selfRoles: "groupact:open:",
  joinRequests: "groupreq:open:",
  setupTokens: "groupsetup:pending:",
};

function uniqueRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row?.key || "");
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function rowValue(row) {
  let value = row?.value;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" ? value : null;
}

function isLive(row, now) {
  const value = rowValue(row);
  if (!value?.expiresAt) return true;
  return Number(value.expiresAt) > now;
}

export async function getCommunityMetrics({ kvRows = null, versions = legalVersions(), now = Date.now() } = {}) {
  const [registrations, consents, ranks, tickets] = await Promise.all([
    listRegistrations(),
    listConsents(),
    getAssignedRanks(),
    listTickets({ status: "open", limit: 300 }),
  ]);

  const consentMap = new Map(consents.map((record) => [String(record.number), record]));
  let staleRegistrations = 0;
  for (const record of registrations) {
    const number = String(record.number || "");
    if (
      record.terms !== versions.terms ||
      record.privacy !== versions.privacy ||
      !consentIsCurrent(consentMap.get(number), versions)
    ) {
      staleRegistrations += 1;
    }
  }

  const rankCounts = Object.fromEntries(RANKS.map((rank) => [rank, 0]));
  for (const value of Object.values(ranks)) {
    const rank = RANKS.includes(value) ? value : "user";
    rankCounts[rank] += 1;
  }

  const rows = [...uniqueRows(kvRows).values()];
  const pending = {};
  const kvByPrefix = {};
  for (const [name, prefix] of Object.entries(PENDING_PREFIXES)) {
    const matches = rows.filter((row) => String(row?.key || "").startsWith(prefix));
    kvByPrefix[name] = matches.length;
    pending[name] = matches.filter((row) => isLive(row, now)).length;
  }

  return {
    registered: registrations.length,
    staleRegistrations,
    consents: consents.length,
    staleConsents: consents.filter((record) => !consentIsCurrent(record, versions)).length,
    rankCounts,
    pending,
    ticketsOpen: tickets.length,
    ticketsUnanswered: tickets.filter((ticket) => !ticket.answer).length,
    kvKeys: rows.length,
    kvByPrefix,
    kvAvailable: kvRows !== null,
  };
}
