import test from "node:test";
import assert from "node:assert/strict";

const { restartViaPanelApi, restartService } = await import("../src/system/platform.js");

const PANEL_ENV = {
  PTERODACTYL_API_URL: "https://panel.example.com/",
  PTERODACTYL_API_KEY: "test-client-key",
  PTERODACTYL_SERVER_ID: "abc123",
};

test("restartViaPanelApi posts a restart signal with bearer auth", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return { ok: true, status: 204 };
  };

  const ok = await restartViaPanelApi({ fetchImpl, env: PANEL_ENV });

  assert.equal(ok, true);
  assert.equal(request.url, "https://panel.example.com/api/client/servers/abc123/power");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer test-client-key");
  assert.equal(request.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.init.body), { signal: "restart" });
});

test("restartViaPanelApi returns false without credentials", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true };
  };

  const ok = await restartViaPanelApi({ fetchImpl, env: {} });

  assert.equal(ok, false);
  assert.equal(called, false);
});

test("restartViaPanelApi returns false when the panel rejects the key", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });

  const ok = await restartViaPanelApi({ fetchImpl, env: PANEL_ENV });

  assert.equal(ok, false);
});

test("restartService uses the panel API and does not exit", async () => {
  const fetchImpl = async () => ({ ok: true, status: 204 });
  let exited = false;

  const result = await restartService({
    delayMs: 0,
    env: PANEL_ENV,
    fetchImpl,
    supervisor: "panel",
    appName: "",
    exit: () => {
      exited = true;
    },
  });

  assert.deepEqual(result, { via: "panel-api", ok: true });
  assert.equal(exited, false);
});

test("restartService falls back to exit when the panel API fails", async () => {
  const fetchImpl = async () => {
    throw new Error("offline");
  };
  const exited = [];

  const result = await restartService({
    delayMs: 0,
    env: PANEL_ENV,
    fetchImpl,
    supervisor: "panel",
    appName: "",
    exit: (code) => exited.push(code),
  });

  assert.deepEqual(result, { via: "exit", ok: true });
  assert.deepEqual(exited, [0]);
});
