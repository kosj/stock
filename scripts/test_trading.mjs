import test from "node:test";
import assert from "node:assert/strict";
import { TradingEngineService } from "../frontend/lib/core/trading-engine.ts";
import { ReplayBroker, replayClock, replayTrading } from "../frontend/lib/core/replay.ts";
import { effectivePrice, hasFreshTradeTime } from "../frontend/lib/core/execution-policy.ts";
import { validateRecommendations } from "../frontend/lib/core/recommendation-policy.ts";

const at = "2026-10-19T09:12:00+09:00";
const recommendations = (date = "2026-10-16") => Array.from({ length: 20 }, (_, i) => ({
  runDate: date, rank: i + 1, ticker: String(i + 1), name: String(i + 1),
  recommendation: "buy", currentPrice: 100, baseReturn30d: 0, sector: `sector-${i}`,
}));
const prices = Object.fromEntries(recommendations().map(r => [r.ticker, 100]));
const setup = (rows = recommendations(), { capital = null, instant = at } = {}) => {
  const broker = new ReplayBroker(10000, { at: instant, prices: { ...prices } }, capital);
  let locked = false, released = 0;
  const deps = {
    clock: replayClock(instant), recommendations: { getTopRecommendations: async () => rows },
    marketData: { getQuote: async ticker => ({ ticker, price: broker.session.prices[ticker] }), getCandles: async () => [] },
    execution: { acquire: async () => { if (locked) return false; locked = true; return true; },
      release: async () => { locked = false; released++; }, record: async () => {} },
  };
  return { broker, deps, engine: new TradingEngineService(broker, deps), released: () => released };
};
test("shared execution costs are adverse and configurable", () => {
  assert.equal(effectivePrice(100, "BUY"), 100.12);
  assert.equal(effectivePrice(100, "SELL"), 99.89);
  assert.ok(effectivePrice(100, "SELL", { feeRate: 0, slippageRate: 0, sellTaxRate: 0.01 }) < 100);
  assert.throws(() => effectivePrice(Infinity, "BUY"));
  assert.throws(() => effectivePrice(100, "BUY", { feeRate: NaN, slippageRate: 0, sellTaxRate: 0 }));
});
test("exchange trade time must be fresh; fetch timestamps are not substitutes", () => {
  const now = Date.parse(at);
  assert.equal(hasFreshTradeTime(at, now), true);
  assert.equal(hasFreshTradeTime(undefined, now), false);
  assert.equal(hasFreshTradeTime("invalid", now), false);
  assert.equal(hasFreshTradeTime("2026-10-16T15:30:00+09:00", now), false);
  assert.equal(hasFreshTradeTime("2026-10-19T09:20:00+09:00", now), false);
});
test("recommendations reject stale, same-day, partial, null, duplicate and mixed batches", () => {
  assert.equal(validateRecommendations(recommendations(), new Date(at)), null);
  for (const rows of [recommendations("2026-10-01"), recommendations("2026-10-19"), recommendations().slice(0, 19),
    recommendations().map((r, i) => i ? r : { ...r, rank: null }),
    recommendations().map((r, i) => i ? r : { ...r, ticker: "2" }),
    recommendations().map((r, i) => i ? r : { ...r, runDate: "2026-10-15" })]) {
    assert.ok(validateRecommendations(rows, new Date(at)));
  }
});
test("missing recommendation still executes stop loss; no rank-out liquidation", async () => {
  const { broker, engine } = setup([]);
  broker.positions.set("1", { ticker: "1", name: "1", quantity: 10, avgPrice: 110 });
  broker.positions.set("2", { ticker: "2", name: "2", quantity: 10, avgPrice: 100 });
  const result = await engine.executeTrading("u");
  assert.equal(result.trades_sell, 1); assert.equal(result.trades_buy, 0);
  assert.ok(broker.positions.has("2")); assert.ok(result.error);
});
test("recommendation exception still executes stop loss", async () => {
  const { broker, deps } = setup();
  broker.positions.set("1", { ticker: "1", name: "1", quantity: 10, avgPrice: 110 });
  deps.recommendations.getTopRecommendations = async () => { throw new Error("DB offline"); };
  const result = await new TradingEngineService(broker, deps).executeTrading("u");
  assert.equal(result.trades_sell, 1);
});
test("capital includes retained holdings and recovered sale proceeds", async () => {
  const { broker, engine } = setup(recommendations(), { capital: 5000 });
  broker.positions.set("20", { ticker: "20", name: "20", quantity: 30, avgPrice: 100 });
  broker.positions.set("6", { ticker: "6", name: "6", quantity: 10, avgPrice: 100 });
  await engine.executeTrading("u");
  const value = (await broker.getPositions()).reduce((s, p) => s + p.quantity * p.currentPrice, 0);
  assert.ok(value <= 5000); assert.ok(broker.cash > 0); assert.ok(broker.positions.size <= 5);
});
test("prior run sell history prevents same-day reentry", async () => {
  const { broker, engine } = setup();
  broker.fills.push({ ticker: "1", side: "SELL", quantity: 1, price: 100, amount: 100, filledAt: at });
  await engine.executeTrading("u");
  assert.ok(!broker.positions.has("1"));
});
test("fees are included in sizing, cash is nonnegative, repeat execution is idempotent", async () => {
  const { broker, engine } = setup();
  await engine.executeTrading("u"); const n = broker.fills.length;
  await engine.executeTrading("u");
  assert.equal(broker.fills.length, n); assert.equal(n, 5); assert.ok(broker.cash >= 0);
});
test("same account simultaneous runs acquire only one execution lease", async () => {
  const { engine, released } = setup();
  const results = await Promise.all([engine.executeTrading("u"), engine.executeTrading("u")]);
  assert.equal(results.filter(r => r.error).length, 1); assert.equal(released(), 1);
});
test("history read failure blocks purchases after risk checks", async () => {
  const { engine, broker, released } = setup();
  broker.getFills = async () => { throw new Error("fills offline"); };
  const result = await engine.executeTrading("u");
  assert.ok(result.error); assert.equal(broker.fills.length, 0); assert.equal(released(), 1);
});
test("market closed, weekend and closing boundary do not fill", async () => {
  for (const instant of ["2026-10-19T16:00:00+09:00", "2026-10-18T09:12:00+09:00", "2026-10-19T15:30:00+09:00"]) {
    const { broker, engine } = setup(recommendations(), { instant });
    await engine.executeTrading("u"); assert.equal(broker.fills.length, 0);
  }
});
test("stale holding prevents buying from uncertain equity", async () => {
  const { broker, engine } = setup();
  broker.positions.set("unknown", { ticker: "unknown", name: "unknown", quantity: 1, avgPrice: 100 });
  await engine.executeTrading("u"); assert.equal(broker.fills.length, 0);
});
test("replay cannot access a future publication and reports cost-adjusted NAV", async () => {
  const result = await replayTrading({ initialCash: 10000,
    batches: [{ completedAt: "2026-10-16T17:00:00+09:00", rows: recommendations() }],
    sessions: [{ at: "2026-10-16T09:12:00+09:00", prices, benchmark: 100 },
      { at, prices, benchmark: 101 }] });
  assert.equal(result.results[0].trades_buy, 0); assert.equal(result.results[1].trades_buy, 5);
  assert.ok(result.totalReturn < 0); assert.ok(result.maxDrawdown < 0);
  assert.ok(result.excessReturn < result.totalReturn);
});
