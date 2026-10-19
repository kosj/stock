import test from "node:test";
import assert from "node:assert/strict";
import { BoundedWorkCache, createWorkGate } from "../frontend/lib/core/bounded-work.ts";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("rank work cache coalesces requests, expires results and retries errors", async () => {
  let now = 0, calls = 0;
  const cache = new BoundedWorkCache(2, 30, () => now);
  const blocked = deferred();
  const load = () => { calls++; return blocked.promise; };
  const first = cache.load("same", load), second = cache.load("same", load);
  blocked.resolve(10);
  assert.deepEqual(await Promise.all([first, second]), [10, 10]);
  assert.equal(calls, 1);
  assert.equal(await cache.load("same", async () => 20), 10);
  now = 30;
  assert.equal(await cache.load("same", async () => 20), 20);
  await assert.rejects(cache.load("error", async () => { throw new Error("offline"); }));
  assert.equal(await cache.load("error", async () => 30), 30);
  await cache.load("third", async () => 40);
  assert.equal(await cache.load("same", async () => 50), 50); // Bounded eviction.
});

test("distinct in-flight ranking keys are bounded and partial-empty results can be retried", async () => {
  const cache = new BoundedWorkCache(1, 30);
  const blocked = deferred();
  const first = cache.load("a", () => blocked.promise);
  await assert.rejects(cache.load("b", async () => 2), /capacity/);
  blocked.resolve(1); await first;
  assert.equal(await cache.load("empty", async () => 0, n => n > 0), 0);
  assert.equal(await cache.load("empty", async () => 1, n => n > 0), 1);
});

test("chart gate shares concurrency across requests, bounds queue and releases failures", async () => {
  const run = createWorkGate(2, 1), blocked = deferred();
  let active = 0, peak = 0;
  const work = () => run(async () => {
    active++; peak = Math.max(peak, active);
    try { await blocked.promise; } finally { active--; }
  });
  const all = [work(), work(), work()];
  await assert.rejects(work(), /capacity/);
  blocked.resolve(); await Promise.all(all);
  assert.equal(peak, 2);
  await assert.rejects(run(async () => { throw new Error("offline"); }));
  assert.equal(await run(async () => 1), 1);
});
