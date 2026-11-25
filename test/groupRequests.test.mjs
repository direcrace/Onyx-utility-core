import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "onyx-group-access-"));
process.env.AUDIT_LOG_DIR = auditDir;

const { attachBotKv } = await import("../src/database/botKv.js");
const { findCommand } = await import("../src/plugins.js");
await import("../src/plugins/groupAccess.js");
const requests = await import("../src/utils/groupRequests.js");

const RECEIVER = "120363400000000001@g.us";
const TARGET = "120363400000000002@g.us";
const GROUP = "120363400000000003@g.us";
const MOD = "4912340000001@s.whatsapp.net";
const ADMIN = "4999900000001@s.whatsapp.net";
const SUDO = "4900000000001@s.whatsapp.net";
const TEAM = "4911100000001@s.whatsapp.net";
const USER = "4912300000001@s.whatsapp.net";

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
let sent;
let updates;
let joins;
let meta;
let conn;

function reset() {
  store = makeStore();
  store.data.set("community:ranks", {
    "4912340000001": "mod",
    "4999900000001": "admin",
    "4911100000001": "team",
  });
  store.data.set("sudo", ["4900000000001"]);
  store.data.set("lang", "en");
  attachBotKv(store);

  sent = [];
  updates = [];
  joins = [];
  meta = {
    id: GROUP,
    subject: "Test",
    participants: [
      { id: ADMIN, admin: "admin" },
      { id: MOD, admin: null },
      { id: TEAM, admin: null },
      { id: USER, admin: null },
    ],
  };
  conn = {
    user: { id: "bot@s.whatsapp.net" },
    async sendMessage(jid, content, options = {}) {
      const id = `card${sent.length + 1}`;
      sent.push({ jid, content, options, id });
      return { key: { id } };
    },
    async groupMetadata() {
      return meta;
    },
    async groupParticipantsUpdate(jid, participants, action) {
      updates.push({ jid, participants, action });
      return {};
    },
    async groupAcceptInvite(code) {
      joins.push(code);
      return TARGET;
    },
    async sendPresenceUpdate() {
      return {};
    },
  };
}

function message(body, options = {}) {
  const from = options.from || GROUP;
  const quotedId = options.quotedId || null;
  return {
    body,
    from,
    sender: options.sender || from,
    participant: options.sender || from,
    isGroup: options.isGroup !== undefined ? options.isGroup : from.endsWith("@g.us"),
    pushName: "T",
    key: { id: options.id || "cmd", remoteJid: from },
    message: {
      contextInfo: {
        ...(quotedId ? { stanzaId: quotedId } : {}),
        ...(options.mentions ? { mentionedJid: options.mentions } : {}),
      },
    },
    quoted: quotedId ? { id: quotedId } : null,
  };
}

function texts() {
  return sent.map((item) => item.content?.text || item.content?.caption || "");
}

async function run(pattern, msg) {
  const found = findCommand(`#${pattern}${msg.body.slice(pattern.length + 1)}`);
  assert.ok(found, `command ${pattern} not registered`);
  await found.function(msg, conn);
}

beforeEach(() => {
  reset();
});

test("parses invite links and group targets", () => {
  assert.equal(
    requests.parseInviteCode("https://chat.whatsapp.com/ABCDEF123456xyz?x=1"),
    "ABCDEF123456xyz"
  );
  assert.equal(requests.parseInviteCode("nope"), null);
  assert.equal(requests.inviteLink("ABCDEF123456"), "https://chat.whatsapp.com/ABCDEF123456");
  assert.equal(requests.inviteLink(null), null);
  assert.equal(requests.groupJidFrom("here"), null);
  assert.equal(requests.groupJidFrom("120363400000000001"), RECEIVER);
  assert.equal(requests.groupJidFrom(RECEIVER), RECEIVER);
});

test("action state keeps one open request, expires and resolves by reply", async () => {
  const input = {
    groupJid: GROUP,
    number: "4912340000001",
    type: "promote",
    participant: MOD,
    requester: "4912340000001",
  };
  const first = await requests.createAction(input);
  assert.ok(first.record);
  assert.equal((await requests.createAction(input)).existing?.id, first.record.id);

  await requests.attachActionMessage({ ...input, messageId: "card1" });
  const byMessage = await requests.getActionByMessage({
    groupJid: GROUP,
    type: "promote",
    messageId: "card1",
  });
  assert.equal(byMessage.id, first.record.id);

  await requests.deleteAction(byMessage);
  assert.equal(await requests.getAction(input), null);
  assert.equal(
    await requests.getActionByMessage({ groupJid: GROUP, type: "promote", messageId: "card1" }),
    null
  );

  const expired = await requests.createAction(input);
  const key = `groupact:open:${GROUP}:4912340000001:promote`;
  await store.set(key, { ...expired.record, expiresAt: Date.now() - 1 });
  assert.equal(await requests.getAction(input), null);
});

test("request state enforces one open request and creates a setup token", async () => {
  const first = await requests.createRequest({ number: "4912300000001", code: "ABCDEF123456" });
  assert.ok(first.record);
  assert.equal(
    (await requests.createRequest({ number: "4912300000001", code: "OTHER123456" })).existing?.id,
    first.record.id
  );
  await requests.attachRequestMessage({ number: "4912300000001", messageId: "card9" });
  assert.equal(
    (await requests.getRequestByMessage({ messageId: "card9" })).id,
    first.record.id
  );

  const setup = await requests.approveRequest(first.record, { groupJid: TARGET, approver: "4911100000001" });
  assert.equal((await requests.getSetupByGroup(TARGET)).token, setup.token);
  assert.equal((await requests.getSetupByToken(setup.token)).groupJid, TARGET);
  await requests.deleteSetup(setup);
  assert.equal(await requests.getSetupByToken(setup.token), null);
});

test("pr requires admin approval and applies promotion only on approved reply", async () => {
  await run("pr", message("#pr", { sender: MOD }));
  const cardId = sent.at(-1).id;
  assert.match(texts().at(-1), /Self-promotion requested/);

  await run("pr", message("#pr approve", { sender: MOD, quotedId: cardId }));
  assert.equal(texts().at(-1), "DU BIST KEIN ADMIN. BITTE KONTAKTIERE EINEN ADMIN UM DIESEN PROZESS ZU BEENDEN.");
  assert.equal(updates.length, 0);

  await run("pr", message("#pr approve", { sender: ADMIN, quotedId: cardId }));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { jid: GROUP, participants: [MOD], action: "promote" });
  assert.equal(await requests.getAction({ groupJid: GROUP, number: "4912340000001", type: "promote" }), null);
});

test("dm cancel removes the pending self-demotion", async () => {
  await run("dm", message("#dm", { sender: MOD }));
  await run("dm", message("#dm cancel", { sender: MOD }));
  assert.equal(await requests.getAction({ groupJid: GROUP, number: "4912340000001", type: "demote" }), null);
  assert.match(texts().at(-1), /cancelled|abgebrochen/i);
});

test("apr works for sudo without group-admin approval", async () => {
  await run("apr", message("#apr @user", { sender: SUDO, mentions: ["4912300000001@s.whatsapp.net"] }));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].action, "promote");
  assert.deepEqual(updates[0].participants, ["4912300000001@s.whatsapp.net"]);
});

test("request reject DMs the requester and clears the request", async () => {
  await run("setrequestreceive", message("#setrequestreceive here", { sender: SUDO }));
  assert.equal(await requests.getReceiver(), GROUP);

  await run("request", message(
    "#request https://chat.whatsapp.com/ABCDEF123456",
    { from: USER, isGroup: false }
  ));
  const card = sent.find((item) => item.jid === GROUP && /Group request/.test(item.content.text || ""));
  assert.ok(card, "request card was not posted to the receiver group");
  assert.match(card.content.text, /https:\/\/chat\.whatsapp\.com\/ABCDEF123456/);
  const cardId = card.id;

  await run("rq", message("#rq reject", { sender: TEAM, quotedId: cardId }));
  assert.equal(await requests.getRequest("4912300000001"), null);
  assert.ok(sent.some((item) => item.jid === "4912300000001@s.whatsapp.net" && /rejected/i.test(item.content.text)));
});

test("request approve joins the group and setupaccept enables defaults", async () => {
  await run("setrequestreceive", message("#setrequestreceive here", { sender: SUDO }));
  await run("request", message(
    "#request https://chat.whatsapp.com/ABCDEF123456",
    { from: USER, isGroup: false }
  ));
  const card = sent.find((item) => item.jid === GROUP && /Group request/.test(item.content.text || ""));
  assert.ok(card, "request card was not posted to the receiver group");
  const cardId = card.id;
  await run("rq", message("#rq approve", { sender: TEAM, quotedId: cardId }));

  assert.deepEqual(joins, ["ABCDEF123456"]);
  assert.ok(sent.some((item) => item.jid === GROUP
    && /https:\/\/chat\.whatsapp\.com\/ABCDEF123456/.test(item.content.text || "")
    && /setupaccept/.test(item.content.text || "")), "approval did not include the join link and token");
  const setupKey = [...store.data.keys()].find((key) => key.startsWith("groupsetup:pending:"));
  assert.ok(setupKey, "setup token was not stored");
  const token = store.data.get(setupKey).token;

  await run("setupaccept", message(`#setupaccept ${token}`, { from: TARGET, sender: TEAM }));
  const settings = store.data.get(`gset:${TARGET}`);
  assert.equal(settings.welcome, true);
  assert.equal(settings.goodbye, true);
  assert.equal(settings.antilink, true);
  assert.equal(settings.antispam, true);
  assert.equal(await requests.getSetupByToken(token), null);
});

test("pending prefixes are prunable but the receiver setting is kept", async () => {
  const { isPrunableKey } = await import("../src/database/kvMaintenance.js");
  assert.equal(isPrunableKey("groupact:open:group:user:promote"), true);
  assert.equal(isPrunableKey("groupreq:msg:card1"), true);
  assert.equal(isPrunableKey("groupsetup:pending:group"), true);
  assert.equal(isPrunableKey("groupreq:receive"), false);
});
