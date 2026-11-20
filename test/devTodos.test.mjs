import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { attachBotKv } from "../src/database/botKv.js";

const store = new Map();

beforeEach(() => {
  store.clear();
  attachBotKv({
    async get(key) {
      return store.has(key) ? structuredClone(store.get(key)) : null;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
  });
});

const {
  DEV_TODOS_KEY,
  MAX_DEV_TODOS,
  MAX_DEV_TODO_TEXT,
  addDevTodo,
  listDevTodos,
  removeDevTodo,
  clearDevTodos,
} = await import("../src/utils/devTodos.js");

test("dev todos are shared across different authors", async () => {
  const first = await addDevTodo("123@s.whatsapp.net", "ship v5.0.6");
  const second = await addDevTodo("456:device", "review PR");
  assert.deepEqual(first, { ok: true, count: 1 });
  assert.deepEqual(second, { ok: true, count: 2 });

  const items = await listDevTodos();
  assert.deepEqual(
    items.map((item) => item.text),
    ["ship v5.0.6", "review PR"]
  );
  assert.deepEqual(
    items.map((item) => item.author),
    ["123", "456"]
  );
  assert.ok(items.every((item) => Number.isFinite(item.createdAt)));
});

test("empty text is rejected", async () => {
  assert.deepEqual(await addDevTodo("1", "   "), { ok: false, reason: "empty" });
  assert.deepEqual(await listDevTodos(), []);
});

test("text is normalized and capped", async () => {
  await addDevTodo("1", "  first   second  ");
  assert.equal((await listDevTodos())[0].text, "first second");

  await clearDevTodos();
  await addDevTodo("1", "x".repeat(MAX_DEV_TODO_TEXT + 50));
  assert.equal((await listDevTodos())[0].text.length, MAX_DEV_TODO_TEXT);
});

test("items can be removed by their displayed number", async () => {
  await addDevTodo("1", "one");
  await addDevTodo("2", "two");
  await addDevTodo("3", "three");

  assert.equal(await removeDevTodo(2), true);
  assert.deepEqual(
    (await listDevTodos()).map((item) => item.text),
    ["one", "three"]
  );
  assert.equal(await removeDevTodo(99), false);
  assert.equal(await removeDevTodo(0), false);
});

test("clearing removes the shared list", async () => {
  await addDevTodo("1", "one");
  await addDevTodo("2", "two");
  assert.equal(await clearDevTodos(), true);
  assert.deepEqual(await listDevTodos(), []);
});

test("a full list rejects new items", async () => {
  store.set(
    DEV_TODOS_KEY,
    Array.from({ length: MAX_DEV_TODOS }, (_, i) => ({
      text: `task ${i}`,
      createdAt: 1,
      author: "1",
    }))
  );
  assert.deepEqual(await addDevTodo("1", "more"), { ok: false, reason: "full" });
  assert.equal((await listDevTodos()).length, MAX_DEV_TODOS);
});

test("concurrent adds are serialized without lost updates", async () => {
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => addDevTodo("1", `item ${i}`))
  );
  assert.equal((await listDevTodos()).length, 10);
});

test("malformed stored data is treated as an empty list", async () => {
  store.set(DEV_TODOS_KEY, { not: "a list" });
  assert.deepEqual(await listDevTodos(), []);
});
