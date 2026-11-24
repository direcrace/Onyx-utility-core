import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

await import("../src/plugins/legal.js");
const { findCommand } = await import("../src/plugins.js");

test("legal commands are registered", () => {
  for (const pattern of ["terms", "tos", "privacy", "dsgvo", "guidelines"]) {
    assert.ok(findCommand(`#${pattern}`), `#${pattern} not registered`);
  }
});

test("legal documents describe group access, retention and reporting", async () => {
  const terms = await fs.readFile(new URL("../terms-of-service.md", import.meta.url), "utf8");
  assert.match(terms, /\*\*Group access\*\*/);
  assert.match(terms, /Abuse the bot-join request flow/);
  assert.match(terms, /Group access approvals/);
  assert.match(terms, /Reject, expire or invalidate a pending group-access request/);

  const privacy = await fs.readFile(new URL("../privacy-policy.md", import.meta.url), "utf8");
  assert.match(privacy, /Group-access state[\s\S]*expires automatically after 24 hours/);
  assert.match(privacy, /not part of the `#mydata` export/);

  const guidelines = await fs.readFile(new URL("../community-guidelines.md", import.meta.url), "utf8");
  for (const command of ["#pr", "#dm", "#apr", "#adm", "#request", "#rq", "#setupaccept"]) {
    assert.ok(guidelines.includes(command), `guidelines missing ${command}`);
  }

  const legal = await fs.readFile(new URL("../src/plugins/legal.js", import.meta.url), "utf8");
  assert.match(legal, /GUIDELINES_SHORT_EN/);
  assert.match(legal, /GUIDELINES_SHORT_DE/);
  assert.match(legal, /Group access: `#pr`/);
});
