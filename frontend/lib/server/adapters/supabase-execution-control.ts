import { randomUUID } from "node:crypto";
import { supabase } from "../supabase";
import type { TradingResult } from "../../core/trading-engine";
import type { EquityObservation } from "../../core/performance";

/** DB lease outlives the 60s HTTP handler; a crashed invocation expires after 120s.
 * Never fall back to process-local locks on serverless instances.
 */
export class SupabaseExecutionControl {
  readonly owner = randomUUID();
  async acquire(userId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("acquire_auto_trade_lease", { p_user_id: userId, p_owner: this.owner });
    if (error) throw new Error(`자동매매 잠금 실패(마이그레이션 확인): ${error.message}`);
    return data === true;
  }
  async release(userId: string): Promise<void> {
    const { error } = await supabase.rpc("release_auto_trade_lease", { p_user_id: userId, p_owner: this.owner });
    if (error) throw new Error(error.message);
  }
  async snapshot(userId: string, observation: EquityObservation): Promise<void> {
    const { error } = await supabase.rpc("record_mock_equity_snapshot", {
      p_user: userId, p_owner: this.owner, p_epoch: observation.accountEpoch,
      p_observed_at: observation.observedAt,
      p_marks: observation.positions.map(p => ({ ticker: p.ticker, quantity: p.quantity,
        price: p.priceStale ? null : p.currentPrice, traded_at: p.tradedAt ?? null,
        source: p.quoteSource ?? null })),
      p_benchmark: observation.benchmark ? { price: observation.benchmark.price,
        traded_at: observation.benchmark.tradedAt ?? null } : null,
      p_context: observation.context ?? {},
    });
    if (error) throw new Error("성과 관측 저장 실패");
  }
  async record(userId: string, result: TradingResult): Promise<void> {
    const { error } = await supabase.from("mock_auto_trade_logs").insert({
      user_id: userId, tickers_analyzed: result.tickers_analyzed,
      trades_buy: result.trades_buy, trades_sell: result.trades_sell,
      skipped: result.skipped, error: result.error ?? null,
      details: result.details.slice(0, 50).map(detail => ({ ...detail, execution_mode: result.mode ?? "rebalance" })),
    });
    if (error) throw new Error(`매매 로그 저장 실패: ${error.message}`);
  }
}
