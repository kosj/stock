import { getBrokerConfig } from "../broker-config";
import { KISProvider } from "../providers";
import { YahooMarketDataAdapter } from "./yahoo-market-data-adapter";
import { hasFreshTradeTime } from "../../core/execution-policy";
import { QuoteUnavailable } from "../../core/quote-evidence";
import type { MarketDataPort, MarketQuote } from "../../core/ports/market-data-port";

/** Per-user credentials, shared by that user's mock broker AND strategy sizing.
 * Request-local observations are revalidated on reuse. Delayed/display quotes never
 * become executable by increasing a freshness threshold or replacing a timestamp.
 */
export class ExecutionMarketDataAdapter implements MarketDataPort {
  private readonly yahoo = new YahooMarketDataAdapter();
  private provider?: Promise<KISProvider | null>;
  private readonly quotes = new Map<string, { at: number; quote: MarketQuote }>();
  private readonly pending = new Map<string, Promise<MarketQuote>>();
  private tail: Promise<unknown> = Promise.resolve();
  private deadline: number | undefined;
  constructor(private readonly userId: string) {}
  private getProvider() {
    return this.provider ??= getBrokerConfig(this.userId, "kis").then(config =>
      config ? new KISProvider({ ...config, cacheScope: this.userId }) : null);
  }
  async getQuote(ticker: string): Promise<MarketQuote> {
    if (!/^\d{6}$/.test(ticker) && ticker !== "^KS11") throw new QuoteUnavailable("INVALID_EXECUTION_SYMBOL");
    const old = this.quotes.get(ticker);
    if (old && Date.now() - old.at < 30_000 && hasFreshTradeTime(old.quote.tradedAt)) return old.quote;
    this.deadline ??= Date.now() + 25_000;
    if (Date.now() >= this.deadline) throw new QuoteUnavailable("QUOTE_BUDGET_EXHAUSTED");
    const running = this.pending.get(ticker);
    if (running) return running;
    const task = (async () => {
      let issue = "KIS_NOT_CONFIGURED";
      try {
        const provider = await this.getProvider();
        if (provider) {
          // Serialize this user's requests, including demo keys with lower quotas.
          const result = this.tail.then(async () => {
            await new Promise(resolve => setTimeout(resolve, 550));
            if (Date.now() >= this.deadline!) throw new QuoteUnavailable("QUOTE_BUDGET_EXHAUSTED");
            return provider.getExecutableQuote(ticker);
          });
          this.tail = result.catch(() => {});
          const quote = await result;
          this.quotes.set(ticker, { at: Date.now(), quote });
          return quote;
        }
      } catch (error) { issue = error instanceof QuoteUnavailable ? error.code : "KIS_CONFIG_UNAVAILABLE"; }
      if (Date.now() >= this.deadline!) throw new QuoteUnavailable("QUOTE_BUDGET_EXHAUSTED");
      const fallback = ticker === "^KS11" ? null : await this.yahoo.getQuote(ticker);
      if (fallback && hasFreshTradeTime(fallback.tradedAt)) return fallback;
      throw new QuoteUnavailable(`${issue}:NO_FRESH_FALLBACK`);
    })().finally(() => this.pending.delete(ticker));
    this.pending.set(ticker, task);
    return task;
  }
  getBenchmark() { return this.getQuote("^KS11"); }
  getCandles(ticker: string, period?: string) { return this.yahoo.getCandles(ticker, period); }
}
