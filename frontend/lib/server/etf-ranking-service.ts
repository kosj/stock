/**
 * EtfRankingService — 국내 상장 ETF 수익률 랭킹
 * ============================================================================
 * - 유니버스: etf-universe.getEtfUniverse() (KIS 적재 → 폴백 시드)
 * - 수익률:   Yahoo getChart("1y") 1회 조회로 다중 구간 수익률 계산(cloud 가용)
 * - 정렬:     선택 구간 수익률 내림차순 → rank 부여
 * - 계좌필터: account 지정 시 퇴직연금/IRP/ISA 편입 가능 종목만
 *
 * 외부 API 부하 보호를 위해 동시성 제한(concurrency)으로 ETF별 차트를 조회한다.
 */

import { getChart } from "./yahoo-finance";
import {
  getEtfUniverse, isEligible, ineligibleReason,
  type EtfMeta, type AccountType,
} from "./etf-universe";

/** 수익률 구간(거래일 수). YTD는 연초 이후라 별도 처리. */
export const RETURN_WINDOWS = {
  "1D":  1,
  "1W":  5,
  "1M":  20,
  "3M":  60,
  "6M":  120,
  "1Y":  250,
} as const;

export type ReturnPeriod = keyof typeof RETURN_WINDOWS;

export interface EtfReturnRow {
  rank:       number;
  ticker:     string;
  name:       string;
  category:   string;
  price:      number;
  dataDate:   string | null;
  returns:    Record<ReturnPeriod, number | null>;  // 구간별 수익률(%)
  /** 정렬 기준 구간의 수익률(%) */
  sortReturn: number;
  /** 계좌 필터 시: 편입 가능 여부와 사유 */
  eligible?:  boolean;
  reason?:    string | null;
}

const CONCURRENCY = 8;

/** 동시성 제한 map (외부 API rate-limit 회피) */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 일별 종가 배열에서 N거래일 수익률(%) 계산. 데이터 부족 시 null. */
function periodReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - days];
  if (!prev || prev <= 0) return null;
  return Math.round(((last - prev) / prev) * 10000) / 100;
}

interface EtfComputed {
  meta:     EtfMeta;
  price:    number;
  dataDate: string | null;
  returns:  Record<ReturnPeriod, number | null>;
}

async function computeOne(meta: EtfMeta): Promise<EtfComputed | null> {
  try {
    const candles = await getChart(meta.ticker, "1y");
    if (!candles || candles.length < 2) return null;
    const closes = candles.map((c) => c.close).filter((v) => typeof v === "number" && v > 0);
    if (closes.length < 2) return null;

    const returns = {} as Record<ReturnPeriod, number | null>;
    for (const [k, d] of Object.entries(RETURN_WINDOWS) as [ReturnPeriod, number][]) {
      returns[k] = periodReturn(closes, d);
    }
    return {
      meta,
      price:    closes[closes.length - 1],
      dataDate: candles[candles.length - 1].time ?? null,
      returns,
    };
  } catch {
    return null;
  }
}

/**
 * ETF 수익률 랭킹.
 * @param period  정렬 기준 수익률 구간(기본 1M)
 * @param account 지정 시 해당 계좌 편입 가능 종목만(랭킹에 eligible/reason 부가)
 */
export async function getEtfRanking(
  period: ReturnPeriod = "1M",
  account?: AccountType,
): Promise<EtfReturnRow[]> {
  let universe = await getEtfUniverse();
  if (account) universe = universe.filter((e) => isEligible(e, account));

  const computed = (await mapLimit(universe, CONCURRENCY, computeOne)).filter(
    (c): c is EtfComputed => c !== null && c.returns[period] !== null,
  );

  computed.sort((a, b) => (b.returns[period]! - a.returns[period]!));

  return computed.map((c, i) => ({
    rank:       i + 1,
    ticker:     c.meta.ticker,
    name:       c.meta.name,
    category:   c.meta.category,
    price:      c.price,
    dataDate:   c.dataDate,
    returns:    c.returns,
    sortReturn: c.returns[period]!,
    ...(account ? { eligible: true, reason: ineligibleReason(c.meta, account) } : {}),
  }));
}
