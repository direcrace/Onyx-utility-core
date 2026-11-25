import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_FOOTER,
  attachMessageFooter,
  footerizePayload,
} from "../src/utils/messageFooter.js";

test("MESSAGE_FOOTER uses the Onyx Community edition branding", () => {
  assert.equal(MESSAGE_FOOTER, "Onyx | Community edition");
});

test("footerizePayload appends the footer once to text and captions", () => {
  assert.equal(
    footerizePayload("Hello world"),
    "Hello world\n\nOnyx | Community edition"
  );
  assert.deepEqual(
    footerizePayload({ text: "Hi", caption: "Pic" }),
    {
      text: "Hi\n\nOnyx | Community edition",
      caption: "Pic\n\nOnyx | Community edition",
    }
  );
  assert.equal(
    footerizePayload("Already branded\n\nOnyx | Community edition"),
    "Already branded\n\nOnyx | Community edition"
  );
});

test("attachMessageFooter wraps sendMessage idempotently", async () => {
  const sent = [];
  const conn = {
    async sendMessage(jid, content) {
      sent.push({ jid, content });
      return { key: { id: "1" } };
    },
  };

  attachMessageFooter(conn);
  attachMessageFooter(conn);

  await conn.sendMessage("123@s.whatsapp.net", { text: "Ping" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content.text, "Ping\n\nOnyx | Community edition");
});
