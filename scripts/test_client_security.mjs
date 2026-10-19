import test from "node:test";
import assert from "node:assert/strict";
import { KisTokenCache, kisBaseUrl, collectKisBalance } from "../frontend/lib/server/kis-session.ts";

test("KIS token singleflight isolates full secret, user, account and environment", async () => {
  let now = 0, calls = 0;
  const cache = new KisTokenCache(10, () => now);
  const credentials = { appKey: "same-prefix-KEY", appSecret: "secret-A", accountNumber: "1234567801", cacheScope: "user-A" };
  const issue = async () => ({ token: `token-${++calls}`, expiresIn: 3600 });
  assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => cache.get(credentials, issue))), Array(8).fill("token-1"));
  assert.equal(calls, 1);
  assert.equal(await cache.get(credentials, issue), "token-1");
  for (const diff of [{ appSecret: "secret-B" }, { cacheScope: "user-B" }, { accountNumber: "1234567802" }, { isDemo: true }]) {
    assert.notEqual(await cache.get({ ...credentials, ...diff }, issue), "token-1");
  }
  now = 3_301_000;
  assert.notEqual(await cache.get(credentials, issue), "token-1");
  assert.match(kisBaseUrl(true), /openapivts.*29443/);
  assert.match(kisBaseUrl(false), /openapi\..*9443/);
});

test("KIS cache retries failed issuance and evicts bounded LRU entries", async () => {
  const cache = new KisTokenCache(1);
  const a = { appKey: "a", appSecret: "a" }, b = { appKey: "b", appSecret: "b" };
  await assert.rejects(cache.get(a, async () => { throw Error("denied"); }), /denied/);
  let issues = 0;
  const issue = async () => ({ token: String(++issues), expiresIn: 3600 });
  assert.equal(await cache.get(a, issue), "1");
  assert.equal(await cache.get(b, issue), "2");
  assert.equal(await cache.get(a, issue), "3");
  await assert.rejects(cache.get(b, async () => ({ token: "bad", expiresIn: NaN })), /유효/);
});

test("KIS holdings continues all pages and refuses truncated/repeated cursors", async () => {
  const calls = [];
  const result = await collectKisBalance(async (cursor) => {
    calls.push(cursor);
    return calls.length === 1 ? { items: ["A"], continuation: "F", fk: "first", nk: "next" }
      : { items: ["B"], continuation: "D", fk: "", nk: "" };
  });
  assert.deepEqual(result, ["A", "B"]);
  assert.deepEqual(calls[1], { fk: "first", nk: "next", continuation: "N" });
  await assert.rejects(collectKisBalance(async () => ({ items: [], continuation: "M", fk: "same", nk: "same" })), /커서/);
  await assert.rejects(collectKisBalance(async () => ({ items: [], continuation: "M", fk: "", nk: "" })), /커서/);
  await assert.rejects(collectKisBalance(async () => ({ items: [], continuation: "M", fk: "x", nk: "y" }), 1), /한도/);
});

test("legacy browser secrets are purged and optional keys never enter storage", async () => {
  function storage() {
    const data = new Map([["__master_password__", "legacy-secret"], ["broker-config-kis", "encrypted"],
      ["api-key-anthropic", "old-api-key"], ["kis-token-cache", "old-token"], ["unrelated-setting", "keep"]]);
    return { getItem: (key) => data.get(key) ?? null, removeItem: (key) => data.delete(key),
      setItem: () => { throw Error("no credential may be persisted"); }, data };
  }
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  try {
    const { ApiKeyManager, BrokerConfigManager } = await import("../frontend/lib/apiConfig.ts");
    for (const store of [window.localStorage, window.sessionStorage]) assert.deepEqual([...store.data], [["unrelated-setting", "keep"]]);
    ApiKeyManager.saveKey("anthropic", "new-api-key");
    assert.equal(ApiKeyManager.getKey("anthropic"), "new-api-key");
    ApiKeyManager.clearKeys();
    assert.equal(ApiKeyManager.getKey("anthropic"), "");
    assert.equal(await BrokerConfigManager.getDefaultBrokerConfig(), null);
    await assert.rejects(BrokerConfigManager.setMasterPassword("Secret123"), /서버/);
  } finally { delete globalThis.window; }
});
