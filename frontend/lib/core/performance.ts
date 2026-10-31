import type { BrokerPosition } from "./domain/account";
import type { MarketQuote } from "./ports/market-data-port";

export interface EquityObservation {
  accountEpoch: number;
  observedAt: string;
  positions: BrokerPosition[];
  benchmark?: MarketQuote | null;
  context?: Record<string, unknown>;
}
interface Mark { observed_at: string; equity: number | null; complete: boolean; benchmark_price: number | null; benchmark_aligned: boolean }
export interface PerformanceHistory {
  first: Mark | null; last: Mark | null; samples: number;
  flows: { amount: number; created_at: string }[];
}

/** Modified Dietz handles timed external flows without inventing pre-flow NAVs.
 * Exact TWR requires valuations immediately before every external cash flow.
 */
export function periodPerformance(history: PerformanceHistory | null) {
  const unavailable = (reason: string) => ({ available: false as const, reason });
  const first = history?.first, last = history?.last;
  if (!first || !last || history.samples < 2) return unavailable("성과 관측값이 2개 이상 쌓이면 표시됩니다.");
  const start = Date.parse(first.observed_at), end = Date.parse(last.observed_at);
  if (!first.complete || !last.complete || first.equity === null || last.equity === null
      || !Number.isFinite(first.equity) || !Number.isFinite(last.equity) || !(end > start))
    return unavailable("관측기간 양끝의 신뢰할 수 있는 평가액이 필요합니다.");
  let flows = 0, weightedFlows = 0;
  let hasFlows = false;
  for (const flow of history.flows) {
    const at = Date.parse(flow.created_at);
    if (!Number.isFinite(at) || !Number.isFinite(flow.amount)) return unavailable("입출금 기록이 유효하지 않습니다.");
    if (at > start && at <= end) {
      flows += flow.amount;
      hasFlows ||= flow.amount !== 0;
      weightedFlows += flow.amount * (end - at) / (end - start);
    }
  }
  const denominator = first.equity + weightedFlows;
  if (!(denominator > 0) || !Number.isFinite(denominator)) return unavailable("성과 계산의 가중 투자금이 양수가 아닙니다.");
  const pnl = last.equity - first.equity - flows;
  const returnPct = pnl / denominator * 100;
  const benchmarkPct = first.benchmark_aligned && last.benchmark_aligned
    && first.benchmark_price !== null && last.benchmark_price !== null && first.benchmark_price > 0
    ? (last.benchmark_price / first.benchmark_price - 1) * 100 : null;
  return { available: true as const, method: "modified_dietz" as const, from: first.observed_at,
    to: last.observed_at, samples: history.samples, pnl, returnPct, netFlows: flows,
    benchmarkPct, excessPct: benchmarkPct === null || hasFlows ? null : returnPct - benchmarkPct };
}
