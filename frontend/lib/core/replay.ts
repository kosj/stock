import { TradingEngineService } from "./trading-engine.ts";
import { effectivePrice, DEFAULT_COSTS, type ExecutionCosts } from "./execution-policy.ts";
import type { BrokerPort } from "./ports/broker-port";
import type { BrokerPosition } from "./domain/account";
import type { OrderRequest, OrderResult, Fill } from "./domain/order";
import type { Recommendation } from "./domain/recommendation";
import type { ExposureLimits } from "./exposure-policy.ts";

export interface ReplaySession {
  /** Actual observed intraday snapshot time. Do NOT put a closing price at 09:12. */
  at: string;
  prices: Record<string, number>;
  benchmark?: number;
}
export interface ReplayBatch { completedAt: string; rows: Recommendation[]; sectors?: Record<string, string> }
export interface ReplayInput {
  initialCash: number;
  capital?: number | null;
  costs?: ExecutionCosts;
  batches: ReplayBatch[];
  sessions: ReplaySession[];
  exposureLimits?: ExposureLimits;
}

/** No network/DB dependencies. Same price/cost semantics as the production mock broker. */
export class ReplayBroker implements BrokerPort {
  cash: number;
  capital: number | null;
  session: ReplaySession;
  costs: ExecutionCosts;
  readonly positions = new Map<string, { ticker: string; name: string; quantity: number; avgPrice: number }>();
  readonly fills: Fill[] = [];
  readonly receipts = new Map<string, OrderResult>();
  private readonly lastMarks = new Map<string, number>();
  constructor(initialCash: number, session: ReplaySession, capital: number | null = null, costs = DEFAULT_COSTS) {
    this.cash = initialCash; this.capital = capital; this.session = session; this.costs = costs;
  }
  async getBalance() { return { cash: this.cash, autoTradeCapital: this.capital }; }
  async getPositions(): Promise<BrokerPosition[]> {
    return [...this.positions.values()].map(p => {
      const price = this.session.prices[p.ticker];
      const priceStale = !Number.isFinite(price) || price <= 0;
      // Missing observations must not reset accumulated gains/losses to cost.
      // Carry the last actual mark for valuation only; stale still blocks trading.
      if (!priceStale) this.lastMarks.set(p.ticker, price);
      const currentPrice = priceStale ? this.lastMarks.get(p.ticker) ?? p.avgPrice : price;
      return { ...p, currentPrice, pnlPct: (currentPrice / p.avgPrice - 1) * 100, priceStale };
    });
  }
  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    const old = this.receipts.get(req.clientOrderId);
    if (old) return { ...old, duplicate: true };
    const rejected = (error: string): OrderResult => ({ clientOrderId: req.clientOrderId, status: "REJECTED",
      filledQuantity: 0, avgFillPrice: 0, filledAmount: 0, duplicate: false, error });
    const observed = this.session.prices[req.ticker];
    if (!Number.isSafeInteger(req.quantity) || req.quantity < 1 || !Number.isFinite(observed) || observed <= 0)
      return rejected("Invalid quantity/observed price");
    const price = effectivePrice(observed, req.side, this.costs);
    const amount = Math.round(req.quantity * price * 100) / 100;
    const held = this.positions.get(req.ticker);
    if (req.side === "BUY") {
      if (amount > this.cash) return rejected("Insufficient cash");
      const quantity = (held?.quantity ?? 0) + req.quantity;
      const avgPrice = Math.round(((held?.avgPrice ?? 0) * (held?.quantity ?? 0) + amount) / quantity * 100) / 100;
      this.positions.set(req.ticker, { ticker: req.ticker, name: req.name, quantity, avgPrice });
      this.cash = Math.round((this.cash - amount) * 100) / 100;
    } else {
      if (!held || req.quantity > held.quantity) return rejected("Insufficient position");
      if (held.quantity === req.quantity) this.positions.delete(req.ticker);
      else this.positions.set(req.ticker, { ...held, quantity: held.quantity - req.quantity });
      this.cash = Math.round((this.cash + amount) * 100) / 100;
    }
    this.lastMarks.set(req.ticker, observed);
    const result: OrderResult = { clientOrderId: req.clientOrderId, status: "FILLED",
      filledQuantity: req.quantity, avgFillPrice: price, filledAmount: amount, duplicate: false };
    this.receipts.set(req.clientOrderId, result);
    this.fills.push({ clientOrderId: req.clientOrderId, ticker: req.ticker, side: req.side,
      quantity: req.quantity, price, amount, filledAt: this.session.at });
    return result;
  }
  async getOrderStatus(id: string) { return this.receipts.get(id) ?? null; }
  async getFills(opts?: { since?: Date; ticker?: string }) {
    return this.fills.filter(f => (!opts?.since || Date.parse(f.filledAt) >= opts.since.getTime())
      && (!opts?.ticker || opts.ticker === f.ticker));
  }
  async cancelOrder(): Promise<void> { throw new Error("Immediate simulated fills cannot be cancelled"); }
}

export function replayClock(at: string) {
  const now = () => new Date(at);
  const kst = () => new Date(now().getTime() + 9 * 3600_000);
  const isTradingDay = () => kst().getUTCDay() > 0 && kst().getUTCDay() < 6;
  return { now, isTradingDay,
    isMarketOpen: () => isTradingDay() && kst().getUTCHours() * 60 + kst().getUTCMinutes() >= 540
      && kst().getUTCHours() * 60 + kst().getUTCMinutes() < 930,
    tradingDateKst: () => kst().toISOString().slice(0, 10).replaceAll("-", "") };
}

function isExplicitTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export async function replayTrading(input: ReplayInput) {
  if (!input || !Number.isFinite(input.initialCash) || input.initialCash <= 0
      || !Array.isArray(input.sessions) || !input.sessions.length || !Array.isArray(input.batches))
    throw new Error("Positive initialCash and observed sessions required");
  if (input.capital != null && (!Number.isFinite(input.capital) || input.capital < 0)) throw new Error("Invalid capital");
  // Validate even when the replay contains no fills.
  effectivePrice(1, "BUY", input.costs ?? DEFAULT_COSTS);
  effectivePrice(1, "SELL", input.costs ?? DEFAULT_COSTS);
  const sessions = input.sessions;
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    if (!session || !isExplicitTimestamp(session.at)
        || (i > 0 && Date.parse(session.at) <= Date.parse(sessions[i - 1].at)))
      throw new Error("Sessions must have explicit timezones and strictly increasing timestamps");
    if (!session.prices || typeof session.prices !== "object" || Array.isArray(session.prices))
      throw new Error("Session prices must be an observed-price map");
  }
  if (input.batches.some(b => !b || !isExplicitTimestamp(b.completedAt) || !Array.isArray(b.rows)))
    throw new Error("Batch completion timestamp with explicit timezone and rows required");
  const batches = [...input.batches].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  if (batches.some(b => !Number.isFinite(Date.parse(b.completedAt)))) throw new Error("Batch completion timestamp required");
  const broker = new ReplayBroker(input.initialCash, sessions[0], input.capital ?? null, input.costs);
  const equity: { at: string; value: number; cash: number; stale: boolean }[] = [];
  const results = [];
  let peak = input.initialCash, maxDrawdown = 0;
  for (const session of sessions) {
    broker.session = session;
    // completedAt prevents Friday-close signals leaking into Friday morning trades.
    const batch = batches.filter(b => Date.parse(b.completedAt) <= Date.parse(session.at)).at(-1);
    const engine = new TradingEngineService(broker, {
      exposureLimits: input.exposureLimits,
      clock: replayClock(session.at),
      marketData: { getQuote: async ticker => {
        const price = session.prices[ticker];
        return Number.isFinite(price) && price > 0 ? { ticker, price } : null;
      }, getCandles: async () => [] },
      recommendations: { getTopRecommendations: async () => batch?.rows ?? [],
        getSectors: async () => batch?.sectors ?? Object.fromEntries((batch?.rows ?? [])
          .filter(r => r.sector?.trim()).map(r => [r.ticker, r.sector!.trim()])) },
      costs: () => input.costs ?? DEFAULT_COSTS,
      execution: { acquire: async () => true, release: async () => {}, record: async () => {} },
    });
    results.push(await engine.executeTrading("replay"));
    const positions = await broker.getPositions();
    const value = broker.cash + positions.reduce((v, p) => v + p.currentPrice * p.quantity, 0);
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    equity.push({ at: session.at, value, cash: broker.cash, stale: positions.some(p => p.priceStale) });
  }
  const finalValue = equity.at(-1)!.value;
  const benchmarkValid = sessions.every(s => Number.isFinite(s.benchmark) && s.benchmark! > 0);
  const benchmarkReturn = benchmarkValid ? sessions.at(-1)!.benchmark! / sessions[0].benchmark! - 1 : null;
  const totalReturn = finalValue / input.initialCash - 1;
  return { initialCash: input.initialCash, finalValue, totalReturn, maxDrawdown, benchmarkReturn,
    valuationComplete: equity.every(e => !e.stale), finalValuationComplete: !equity.at(-1)!.stale,
    excessReturn: benchmarkReturn === null ? null : totalReturn - benchmarkReturn,
    turnover: broker.fills.reduce((s, f) => s + f.amount, 0) / (equity.reduce((s, e) => s + e.value, 0) / equity.length),
    costs: input.costs ?? DEFAULT_COSTS, equity, fills: broker.fills, results,
    warning: "Observed snapshots only; stale valuations carry last observed marks and performance is provisional when valuationComplete=false. No intraday stop guarantee, order-book capacity, or survivorship correction. Tax defaults to zero unless configured." };
}
