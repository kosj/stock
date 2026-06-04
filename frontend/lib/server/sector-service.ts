/**
 * SectorService — DB 기반 섹터 데이터 서비스
 *
 * 기존: Yahoo Finance 직접 호출 (매 요청마다 외부 API 조회)
 * 변경: Supabase etf_daily_prices 테이블 조회
 *       → 응답 속도 향상, 외부 API 의존성 제거
 *
 * 종가 수집은 Cron Job(update-etf)이 담당하므로
 * 이 서비스는 이미 저장된 데이터를 읽기만 한다.
 */

import { supabase } from "./supabase";

const TRADING_DAYS_1M = 20;

export interface SectorMomentum {
  sector_name:  string;
  etf_name:     string;
  ticker:       string;
  return_1m:    number;  // 1개월 수익률 (%)
  close_today:  number | null;
  close_1m_ago: number | null;
  data_date:    string | null;  // 최신 데이터 기준일
}

export class SectorService {
  /**
   * 전체 섹터 모멘텀 목록 반환 (1개월 수익률 내림차순)
   */
  static async getMomentum(): Promise<SectorMomentum[]> {
    const { data: etfs, error: etfErr } = await supabase
      .from("sector_etfs")
      .select("id, sector_name, etf_name, ticker")
      .order("id");

    if (etfErr || !etfs) return [];

    const etfIds = etfs.map((e: any) => e.id);
    const lookback = TRADING_DAYS_1M + 5;

    const { data: allPrices, error: priceErr } = await supabase
      .from("etf_daily_prices")
      .select("etf_id, date, close_price")
      .in("etf_id", etfIds)
      .order("date", { ascending: false })
      .limit(lookback * etfIds.length);

    if (priceErr || !allPrices) return [];

    const priceMap = new Map<number, { date: string; close_price: number }[]>();
    for (const row of allPrices as any[]) {
      if (!priceMap.has(row.etf_id)) priceMap.set(row.etf_id, []);
      priceMap.get(row.etf_id)!.push(row);
    }

    const result: SectorMomentum[] = (etfs as any[]).map((etf) => {
      const prices = priceMap.get(etf.id) ?? [];
      if (prices.length < 2) {
        return {
          sector_name: etf.sector_name,
          etf_name:    etf.etf_name,
          ticker:      etf.ticker,
          return_1m:   0,
          close_today:  null,
          close_1m_ago: null,
          data_date:   null,
        };
      }
      const today    = prices[0];
      const monthAgo = prices[Math.min(TRADING_DAYS_1M, prices.length - 1)];
      const ret = monthAgo.close_price > 0
        ? Math.round(((today.close_price - monthAgo.close_price) / monthAgo.close_price) * 10000) / 100
        : 0;

      return {
        sector_name:  etf.sector_name,
        etf_name:     etf.etf_name,
        ticker:       etf.ticker,
        return_1m:    ret,
        close_today:  today.close_price,
        close_1m_ago: monthAgo.close_price,
        data_date:    today.date,
      };
    });

    return result.sort((a, b) => b.return_1m - a.return_1m);
  }

  /**
   * 섹터 모멘텀 기반 로테이션 테마 분석
   */
  static async getRotationTheme(): Promise<{
    theme: string;
    leading: string[];
    lagging: string[];
  }> {
    const sectors = await this.getMomentum();
    const leading = sectors.slice(0, 3).map((s) => s.sector_name);
    const lagging = sectors.slice(-3).map((s) => s.sector_name);
    const topSet  = new Set(leading);

    let theme: string;
    if (topSet.has("반도체") || topSet.has("AI/로봇"))
      theme = "기술 성장주 주도장 — AI/반도체 사이클 상승 국면";
    else if (topSet.has("바이오"))
      theme = "헬스케어/바이오 주도장 — 방어주 선호 구간";
    else if (topSet.has("금융") || topSet.has("건설"))
      theme = "경기민감/가치주 주도장 — 금리 환경 개선 기대";
    else if (topSet.has("2차전지") || topSet.has("에너지"))
      theme = "친환경/에너지 전환 주도장";
    else
      theme = `${leading.slice(0, 2).join(", ")} 주도 순환매 진행 중`;

    return { theme, leading, lagging };
  }
}
