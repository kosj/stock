/**
 * EtfRankingService — 국내 상장 ETF 수익률 랭킹 (전체 유니버스)
 * ============================================================================
 * 유니버스: 네이버 ETF 목록 API — 국내 상장 ETF 전체(2026-07 기준 1,150종목).
 *           KRX/pykrx는 클라우드 IP 차단으로 사용 불가하여 네이버로 대체했다.
 *
 * 수익률 산출 경로(구간별로 다름 — 응답의 coverage로 명시한다):
 *   - 1D / 3M : 네이버 목록 응답에 포함(changeRate / threeMonthEarnRate).
 *               → 추가 요청 0회로 "전체 종목" 랭킹이 가능하다.
 *   - 그 외   : 종목별 일봉이 필요하다. 전 종목(1,150) 조회는 서버리스 시간
 *               제한을 넘기므로, 시가총액 상위 N종목으로 범위를 한정해 계산하고
 *               응답에 covered/total을 실어 UI가 "부분 커버리지"임을 표시한다.
 *               (전 구간 전체 커버리지가 필요하면 cron으로 Supabase에 적재 후
 *                이 서비스가 그 테이블을 읽는 방식으로 확장한다.)
 */

import { getChart } from "./yahoo-finance";
import { fetchNaverEtfList, type NaverEtf } from "./naver-etf";
import {
  getEtfUniverse, isEligible, ineligibleReason,
  type EtfMeta, type AccountType,
} from "./etf-universe";

/** 수익률 구간(거래일 수). */
export const RETURN_WINDOWS = {
  "1D":  1,
  "1W":  5,
  "1M":  20,
  "3M":  60,
  "6M":  120,
  "1Y":  250,
} as const;

export type ReturnPeriod = keyof typeof RETURN_WINDOWS;

/** 네이버 목록만으로 전체 커버리지가 가능한 구간 */
const NAVER_NATIVE: Record<string, "return1D" | "return3M" | undefined> = {
  "1D": "return1D",
  "3M": "return3M",
};

/** 일봉 계산이 필요한 구간에서 조회할 최대 종목 수(시가총액 상위) */
const CHART_LIMIT = 120;
const CONCURRENCY = 8;

export interface EtfReturnRow {
  rank:       number;
  ticker:     string;
  name:       string;
  category:   string;
  price:      number;
  marketCapEok: number | null;
  /** 안전자산 세부 유형(채권/현금성/금) — 안전자산 탭 표기용 */
  safeType?:  string | null;
  leveraged?:  boolean;
  inverse?:    boolean;
  derivative?: boolean;
  /** 정렬 기준 구간의 수익률(%) */
  sortReturn: number;
  /** 참고용 구간 수익률(제공 가능한 것만) */
  returns:    Partial<Record<ReturnPeriod, number | null>>;
  eligible?:  boolean;
  reason?:    string | null;
}

export interface EtfRankingResult {
  rows: EtfReturnRow[];
  /** 계좌 필터 적용 후 유니버스 종목 수 */
  total: number;
  /** 실제 수익률이 계산된 종목 수 */
  covered: number;
  /** 수익률 출처: naver(전체) | chart(부분) | seed */
  source: "naver" | "chart" | "seed";
  /** 부분 커버리지일 때 사용자에게 보일 설명 */
  note?: string;
}

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

/** 일별 종가 배열에서 N거래일 수익률(%). 데이터 부족 시 null. */
function periodReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - days];
  if (!prev || prev <= 0) return null;
  return Math.round(((last - prev) / prev) * 10000) / 100;
}

function finalize(
  scored: { meta: NaverEtf | EtfMeta; price: number; marketCapEok: number | null;
            value: number; returns: Partial<Record<ReturnPeriod, number | null>> }[],
  account: AccountType | undefined,
): EtfReturnRow[] {
  scored.sort((a, b) => b.value - a.value);
  return scored.map((c, i) => ({
    rank:         i + 1,
    ticker:       c.meta.ticker,
    name:         c.meta.name,
    category:     c.meta.category,
    price:        c.price,
    marketCapEok: c.marketCapEok,
    safeType:     "safeType" in c.meta ? c.meta.safeType : null,
    // 위험 상품 배지용 — 일반 주식계좌 추천에서 레버리지/인버스/파생 경고 표시
    leveraged:    "leveraged" in c.meta ? !!c.meta.leveraged : false,
    inverse:      "inverse" in c.meta ? !!c.meta.inverse : false,
    derivative:   "derivative" in c.meta ? !!(c.meta as { derivative?: boolean }).derivative : false,
    sortReturn:   c.value,
    returns:      c.returns,
    ...(account ? { eligible: true, reason: ineligibleReason(c.meta, account) } : {}),
  }));
}

/**
 * ETF 수익률 랭킹.
 * @param period  정렬 기준 구간(기본 1M)
 * @param account 지정 시 해당 계좌 편입 가능 종목만
 */
export async function getEtfRanking(
  period: ReturnPeriod = "1M",
  account?: AccountType,
  opts: { safeOnly?: boolean } = {},
): Promise<EtfRankingResult> {
  const all = await fetchNaverEtfList();
  // 안전자산 탭: 채권·현금성·금만 (연금계좌 위험자산 30% 밖 배분 후보)
  const naverAll = opts.safeOnly ? all.filter((e) => e.safeAsset) : all;

  // ── 경로 1: 네이버가 해당 구간 수익률을 직접 제공 → 전체 종목 커버 ──────
  const nativeKey = NAVER_NATIVE[period];
  if (naverAll.length > 0 && nativeKey) {
    const pool = account ? naverAll.filter((e) => isEligible(e, account)) : naverAll;
    const scored = pool
      .filter((e) => e[nativeKey] != null)
      .map((e) => ({
        meta: e,
        price: e.price,
        marketCapEok: e.marketCapEok,
        value: e[nativeKey] as number,
        returns: { "1D": e.return1D, "3M": e.return3M } as Partial<Record<ReturnPeriod, number | null>>,
      }));

    return {
      rows: finalize(scored, account),
      total: pool.length,
      covered: scored.length,
      source: "naver",
    };
  }

  // ── 경로 2: 일봉 계산 필요 → 시가총액 상위로 범위 한정 ────────────────
  if (naverAll.length > 0) {
    const pool = account ? naverAll.filter((e) => isEligible(e, account)) : naverAll;
    const targets = [...pool]
      .sort((a, b) => b.marketCapEok - a.marketCapEok)
      .slice(0, CHART_LIMIT);

    const days = RETURN_WINDOWS[period];
    const computed = await mapLimit(targets, CONCURRENCY, async (e) => {
      try {
        const candles = await getChart(e.ticker, "1y");
        const closes = (candles ?? []).map((c) => c.close).filter((v) => v > 0);
        const value = periodReturn(closes, days);
        if (value == null) return null;
        return {
          meta: e,
          price: closes[closes.length - 1] ?? e.price,
          marketCapEok: e.marketCapEok,
          value,
          returns: {
            [period]: value, "1D": e.return1D, "3M": e.return3M,
          } as Partial<Record<ReturnPeriod, number | null>>,
        };
      } catch {
        return null;
      }
    });

    const scored = computed.filter((c): c is NonNullable<typeof c> => c !== null);
    return {
      rows: finalize(scored, account),
      total: pool.length,
      covered: scored.length,
      source: "chart",
      note: `${period} 수익률은 종목별 일봉 계산이 필요해 시가총액 상위 ${CHART_LIMIT}종목만 집계했습니다 `
          + `(전체 ${pool.length}종목). 1D·3M은 전체 종목이 반영됩니다.`,
    };
  }

  // ── 경로 3: 네이버 실패 → 기존 유니버스(Supabase/시드) + 일봉 ─────────
  let universe = await getEtfUniverse();
  if (account) universe = universe.filter((e) => isEligible(e, account));

  const days = RETURN_WINDOWS[period];
  const computed = await mapLimit(universe, CONCURRENCY, async (m) => {
    try {
      const candles = await getChart(m.ticker, "1y");
      const closes = (candles ?? []).map((c) => c.close).filter((v) => v > 0);
      const value = periodReturn(closes, days);
      if (value == null) return null;
      return {
        meta: m,
        price: closes[closes.length - 1] ?? 0,
        marketCapEok: null,
        value,
        returns: { [period]: value } as Partial<Record<ReturnPeriod, number | null>>,
      };
    } catch {
      return null;
    }
  });

  const scored = computed.filter((c): c is NonNullable<typeof c> => c !== null);
  return {
    rows: finalize(scored, account),
    total: universe.length,
    covered: scored.length,
    source: "seed",
    note: "네이버 ETF 목록을 불러오지 못해 축소된 목록으로 집계했습니다.",
  };
}
