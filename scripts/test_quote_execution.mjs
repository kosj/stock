/** Exercises actual quote module with fake HTTP and DB; no network access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import { hasFreshTradeTime } from '../frontend/lib/core/execution-policy.ts';

function load(fetch, { database, Clock = Date } = {}) {
  const source = fs.readFileSync(new URL('../frontend/lib/server/yahoo-finance.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const context = vm.createContext({ exports, fetch, Date: Clock, Map, Set, Promise, AbortSignal, setTimeout, clearTimeout,
    require(name) {
      if (name === 'yahoo-finance2') return { default: class {} };
      if (name.includes('execution-policy')) return { hasFreshTradeTime };
      if (name.includes('supabase')) return { supabase: database ?? { from() { throw new Error('Execution must bypass display DB cache'); } } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(code, context);
  return exports;
}
function response(time, price = 100) {
  return { ok: true, json: async () => ({ chart: { result: [{ meta: {
    regularMarketPrice: price, regularMarketTime: time,
  } }] } }) };
}
test('fresh exchange source wins over stale candidate; coalesces concurrent orders', async () => {
  let requests = 0;
  const module = load(async url => {
    requests++;
    if (url.includes('.KS')) return response(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    return response(Math.floor(Date.now() / 1000), 123);
  });
  const quotes = await Promise.all([module.getExecutableQuote('005930'), module.getExecutableQuote('005930')]);
  assert.equal(requests, 2);
  assert.equal(quotes[0].price, 123);
  assert.equal(quotes[0].ticker, '005930');
  assert.equal(quotes[1], quotes[0]);
});
test('missing/stale trade time and foreign currency fail closed', async () => {
  const module = load(async () => response(undefined));
  assert.equal(await module.getExecutableQuote('005930'), null);
  assert.equal(await module.getExecutableQuote('AAPL'), null);
});
test('display cache preserves L2 expiry and coalesces concurrent refreshes', async () => {
  let now = Date.now();
  let requests = 0;
  class Clock extends Date { constructor(value) { super(value ?? now); } static now() { return now; } }
  // Freeze the stored expiry: subsequent reads must not renew it.
  const expires = new Date(now + 1000).toISOString();
  const database = { from: () => ({ select() { return this; }, eq() { return this; },
    single: async () => ({ data: { data: { price: 1 }, expires_at: expires } }), upsert: async () => ({}),
  }) };
  const module = load(async () => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return response(Math.floor(now / 1000), 222);
  }, { database, Clock });
  assert.equal((await module.getQuote('AAPL')).price, 1);
  now += 2000;
  const quotes = await Promise.all([module.getQuote('AAPL'), module.getQuote('AAPL')]);
  assert.equal(requests, 1);
  assert.equal(quotes[0].price, 222);
  assert.equal(quotes[1], quotes[0]);
});
