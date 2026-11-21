import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("dotenv/config is the first import in index.js", () => {
  const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(source, /^import "dotenv\/config";/);
});

test("dotenv values are available when constants.js is imported", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-dotenv-"));
  const envFile = path.join(dir, "test.env");
  fs.writeFileSync(envFile, "BOT_PREFIX=ZZ\n");

  const script =
    "import 'dotenv/config'; const { getPrefix } = await import('./src/config/constants.js'); process.stdout.write(getPrefix());";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, DOTENV_CONFIG_PATH: envFile },
    encoding: "utf8",
  });

  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ZZ");
});
