import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "yum-community-metrics-"));
process.env.AUDIT_LOG_DIR = auditDir;

const { attachBotKv } = await import("../src/database/botKv.js");
const { legalVersions } = await import("../src/utils/consent.js");
const { getCommunityMetrics } = await import("../src/utils/communityMetrics.js");
const { expiredGroupKeys, sweepExpiredGroupState } = await import("../src/utils/groupRequests.js");
const { findCommand } = await import("../src/plugins.js");
await import("../src/plugins/enterprise.js");

const versions = legalVersions();
const NOW = 1_700_000_000_000;
const LIVE = JSON.stringify({ expiresAt: NOW + 60_000, messageId: "m1", token: "t1" });
const EXPIRED = JSON.stringify({ expiresAt: NOW - 1, messageId: "m2" });

function makeStore() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      data.set(key, value);
      return true;
    },
    async del(key) {
      data.delete(key);
      return true;
    },
  };
}

let store;
let rows;

beforeEach(() => {
  store = makeStore();
  store.data.set("community:registered", {
    "111": { number: "111", terms: versions.terms, privacy: versions.privacy, ts: 1 },
    "222": { number: "222", terms: "old", privacy: "old", ts: 2 },
    "333": { number: "333", terms: versions.terms, privacy: versions.privacy, ts: 3 },
  });
  store.data.set("consent:pair", {
    "111": { number: "111", terms: versions.terms, privacy: versions.privacy },
    "222": { number: "222", terms: versions.terms, privacy: versions.privacy },
    "333": { number: "333", terms: "old", privacy: "old" },
  });
  store.data.set("community:ranks", { "111": "mod", "222": "team", "333": "unknown" });
  store.data.set("community:tickets", {
    T1: { id: "T1", number: "111", status: "open", ts: 1, answer: "" },
    T2: { id: "T2", number: "222", status: "open", ts: 2, answer: "answered" },
    T3: { id: "T3", number: "333", status: "closed", ts: 3 },
  });
  attachBotKv(store);

  rows = [
    { key: "groupact:open:g1:111:promote", value: LIVE },
    { key: "groupact:open:g1:111:promote", value: LIVE },
    { key: "groupact:open:g1:222:promote", value: EXPIRED },
    { key: "groupreq:open:111", value: LIVE },
    { key: "groupsetup:pending:g2", value: LIVE },
    { key: "groupreq:receive", value: "g0" },
  ];
});

test("community metrics return only counts", async () => {
  const metrics = await getCommunityMetrics({ kvRows: rows, versions, now: NOW });

  assert.equal(metrics.registered, 3);
  assert.equal(metrics.staleRegistrations, 2);
  assert.equal(metrics.consents, 3);
  assert.equal(metrics.staleConsents, 1);
  assert.equal(metrics.rankCounts.user, 1);
  assert.equal(metrics.rankCounts.mod, 1);
  assert.equal(metrics.rankCounts.team, 1);
  assert.equal(metrics.rankCounts.owner, 0);
  assert.equal(metrics.pending.selfRoles, 1);
  assert.equal(metrics.pending.joinRequests, 1);
  assert.equal(metrics.pending.setupTokens, 1);
  assert.equal(metrics.ticketsOpen, 2);
  assert.equal(metrics.ticketsUnanswered, 1);
  assert.equal(metrics.kvKeys, 5);
  assert.equal(metrics.kvAvailable, true);
  assert.doesNotMatch(JSON.stringify(metrics), /111|222|333|chat\.whatsapp\.com/);
});

test("community metrics degrade gracefully without key rows", async () => {
  const metrics = await getCommunityMetrics({ kvRows: null, versions, now: NOW });
  assert.equal(metrics.kvAvailable, false);
  assert.equal(metrics.pending.selfRoles, 0);
});

test("expired group keys include companion pointers and sweep reports removals", async () => {
  const expired = expiredGroupKeys(rows, NOW);
  assert.deepEqual(expired.sort(), ["groupact:msg:m2", "groupact:open:g1:222:promote"]);

  const deleted = [];
  const result = await sweepExpiredGroupState({
    rows,
    now: NOW,
    onDelete: async (keys) => {
      deleted.push(...keys);
      return keys.length;
    },
  });
  assert.equal(result.expired, 2);
  assert.equal(result.removed, 2);
  assert.deepEqual(deleted.sort(), expired);
  assert.equal(result.scanned, 6);
});

test("communitymetrics is registered and health shows disk", async () => {
  assert.ok(findCommand("#communitymetrics"), "command not registered");
  const ops = await fs.readFile(new URL("../src/plugins/ops.js", import.meta.url), "utf8");
  assert.match(ops, /• Disk: \$\{disk\}/);
  assert.match(ops, /• Platte: \$\{disk\}/);
});
