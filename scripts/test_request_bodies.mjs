/**
 * 요청 본문 게이트(readJsonObject)와 DB 오류 마스킹(dbErrorResponse) 회귀 테스트.
 *
 * 본문 라우트 13곳이 무제한 `req.json()` 에서 readJsonObject(8KB 상한) 로 바뀌었다.
 * 바꾸면서 각 라우트의 기존 계약이 깨지지 않았는지를 실제 핸들러로 확인한다:
 *   - 본문 선택 라우트(auto-fill, broker/holdings)는 본문 없이도 진행해야 한다
 *   - mock/account 는 "키가 있는가"로 설정 여부를 정한다(auto_trade_capital:null 은 해제)
 *   - mock/trade 는 잘못된 입력을 계좌 잠금 획득 전에 거부해야 한다
 * 운영 DB·외부 API 에 접근하지 않는다(모든 의존성은 스텁).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as policy from "../frontend/lib/server/api-security-policy.ts";

const responseStub = { json: (body, init) => Response.json(body, init) };

async function loadModule(path, modules) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", "console", compiled)(name => {
    if (name === "next/server") return { NextResponse: responseStub };
    if (modules[name]) return modules[name];
    throw new Error(`unexpected dependency ${name}`);
  }, exports, { env: {} }, { error() {}, warn() {}, log() {} });
  return exports;
}

const readJson = await loadModule("frontend/lib/server/read-json.ts", { "./api-security-policy": policy });
const dbError = await loadModule("frontend/lib/server/db-error.ts", {});
const approved = { requireUser: async () => ({ ok: true, userId: "u1", role: "user" }) };

const post = (body, headers = {}) =>
  new Request("https://offline.invalid/x", { method: "POST", body, headers, duplex: "half" });

test("readJsonObject: 객체만 통과, 깨진 JSON·배열·원시값은 400, 8KB 초과는 413", async () => {
  const ok = await readJson.readJsonObject(post('{"a":1}'));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.body, { a: 1 });

  for (const raw of ["not json", "[]", "123", '"str"', "null"]) {
    const r = await readJson.readJsonObject(post(raw));
    assert.equal(r.ok, false, raw);
    assert.equal(r.response.status, 400, raw);
  }
  const big = await readJson.readJsonObject(post(JSON.stringify({ x: "a".repeat(9000) })));
  assert.equal(big.ok, false);
  assert.equal(big.response.status, 413);
});

test("readJsonObject allowEmpty: 본문 없는 요청을 {} 로 받는다 (본문 선택 라우트 계약)", async () => {
  const noBody = new Request("https://offline.invalid/x", { method: "POST" });
  assert.deepEqual((await readJson.readJsonObject(noBody, { allowEmpty: true })).body, {});
  assert.deepEqual((await readJson.readJsonObject(post("", { "content-length": "0" }), { allowEmpty: true })).body, {});

  // allowEmpty 없이 본문이 없으면 거부된다
  const strict = await readJson.readJsonObject(new Request("https://offline.invalid/x", { method: "POST" }));
  assert.equal(strict.ok, false);
  assert.equal(strict.response.status, 400);

  // allowEmpty 여도 깨진 JSON 은 통과시키지 않는다
  const broken = await readJson.readJsonObject(post("{oops"), { allowEmpty: true });
  assert.equal(broken.ok, false);
});

test("dbErrorResponse: DB 원문을 응답에 싣지 않고 code 만 준다", async () => {
  const res = dbError.dbErrorResponse(
    { code: "23505", message: 'duplicate key value violates unique constraint "portfolios_pkey"' },
    "test", "만들지 못했습니다.",
  );
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body, { error: "만들지 못했습니다.", code: "23505" });
  assert.ok(!JSON.stringify(body).includes("portfolios_pkey"));
});

test("portfolio POST: 이름 타입·길이를 DB 전에 검증, 정상 입력만 insert", async () => {
  let inserted = null;
  const supabase = { from: () => ({ insert: row => { inserted = row; return {
    select: () => ({ single: async () => ({ data: { id: 1, ...row }, error: null }) }) }; } }) };
  const route = await loadModule("frontend/app/api/portfolio/route.ts", {
    "@/lib/server/read-json": readJson, "@/lib/server/db-error": dbError,
    "@/lib/server/supabase": { supabase }, "@/lib/server/require-user": approved,
  });
  for (const body of ["{}", '{"name":""}', '{"name":"   "}', '{"name":123}', JSON.stringify({ name: "a".repeat(101) }),
                      '{"name":"ok","description":5}', "not json"]) {
    inserted = null;
    const res = await route.POST(post(body));
    assert.equal(res.status, 400, body);
    assert.equal(inserted, null, `거부된 입력이 insert 되면 안 된다: ${body}`);
  }
  const res = await route.POST(post('{"name":"장기 투자","description":null}'));
  assert.equal(res.status, 201);
  assert.deepEqual(inserted, { name: "장기 투자", description: null, user_id: "u1" });
});

test("mock/account PUT: 키 존재 여부를 그대로 넘긴다 (cash 설정 / capital null=해제 / 다른 키 무시)", async () => {
  let received;
  const route = await loadModule("frontend/app/api/mock/account/route.ts", {
    "@/lib/server/read-json": readJson, "@/lib/server/require-user": approved,
    "@/lib/server/supabase": { supabase: {} }, "@/lib/server/yahoo-finance": { getQuote: async () => null },
    "@/lib/server/mock-account-control": { accountEpoch: async () => 0, updateAccount: async (_u, body) => { received = body; return { ok: true }; } },
    "@/lib/core/performance": { periodPerformance: () => null },
  });
  const cases = [
    ['{"cash":1000}', { cash: 1000 }],
    ['{"auto_trade_capital":null}', { auto_trade_capital: null }],
    ['{"cash":0,"auto_trade_capital":5000000}', { cash: 0, auto_trade_capital: 5000000 }],
    ['{"foo":1}', {}],
  ];
  for (const [raw, expected] of cases) {
    received = undefined;
    const res = await route.PUT(post(raw));
    assert.equal(res.status, 200, raw);
    assert.deepEqual(received, expected, raw);
    // updateAccount 는 `"key" in body` 로 설정 여부를 판단한다 — 키 집합까지 같아야 한다
    assert.deepEqual(Object.keys(received).sort(), Object.keys(expected).sort(), raw);
  }
  for (const raw of ['{"cash":-1}', '{"cash":null}', '{"cash":"1000"}', '{"cash":1000000001}',
                     '{"auto_trade_capital":"x"}', '{"cash":1e999}', "[]", "nope"]) {
    received = undefined;
    const res = await route.PUT(post(raw));
    assert.equal(res.status, 400, raw);
    assert.equal(received, undefined, `거부된 입력으로 계좌가 바뀌면 안 된다: ${raw}`);
  }
});

test("mock/trade POST: 잘못된 입력은 계좌 잠금 획득 전에 400 (검증식 등가 변환 확인)", async () => {
  let lockAttempts = 0;
  const route = await loadModule("frontend/app/api/mock/trade/route.ts", {
    "@/lib/server/read-json": readJson, "@/lib/server/require-user": approved,
    "@/lib/server/supabase": { supabase: {} },
    "@/lib/server/adapters/execution-market-data-adapter": { ExecutionMarketDataAdapter: class { async getQuote() { return null; } } },
    "@/lib/server/adapters/kr-market-clock": { KrMarketClock: class { isMarketOpen() { return false; } } },
    "@/lib/server/adapters/supabase-execution-control": { SupabaseExecutionControl: class {
      owner = "o"; async acquire() { lockAttempts++; return false; } async release() {} } },
    "@/lib/core/execution-policy": { effectivePrice: p => p },
    "@/lib/server/mock-execution": { mockCosts: () => ({}) },
  });
  const valid = { ticker: "005930", name: "삼성전자", trade_type: "BUY", quantity: 1,
                  client_order_id: "123e4567-e89b-42d3-a456-426614174000", account_epoch: 0 };
  const invalid = [
    "not json", "[]",
    { ...valid, trade_type: "HOLD" }, { ...valid, trade_type: "buy" },
    { ...valid, quantity: "1" }, { ...valid, quantity: 1.5 }, { ...valid, quantity: 0 }, { ...valid, quantity: 1_000_001 },
    { ...valid, account_epoch: "0" }, { ...valid, account_epoch: -1 },
    { ...valid, ticker: "AAPL" }, { ...valid, client_order_id: "not-a-uuid" }, { ...valid, name: " " },
  ];
  for (const body of invalid) {
    lockAttempts = 0;
    const res = await route.POST(post(typeof body === "string" ? body : JSON.stringify(body)));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(lockAttempts, 0, `검증 실패 입력이 계좌 잠금까지 가면 안 된다: ${JSON.stringify(body)}`);
  }
  // 유효한 입력은 검증을 통과해 잠금 단계로 간다(스텁은 잠금 실패 → 409)
  for (const side of ["BUY", "SELL"]) {
    lockAttempts = 0;
    const res = await route.POST(post(JSON.stringify({ ...valid, trade_type: side })));
    assert.equal(res.status, 409, side);
    assert.equal(lockAttempts, 1, side);
  }
});
