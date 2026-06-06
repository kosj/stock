/**
 * GET /api/sector-momentum
 *
 * 각 섹터의 1개월(약 20 영업일) 수익률을 반환한다.
 * 스코어링 알고리즘에서 "섹터 모멘텀" 팩터로 호출하는 엔드포인트.
 *
 * 응답 형태:
 *   {
 *     "반도체":    12.5,
 *     "2차전지":   -3.2,
 *     ...
 *     "_meta": { updated_at: "2025-06-04", data_date: "2025-06-04" }
 *   }
 *
 * DB 설계:
 *   sector_etfs       → 섹터명과 ETF id 매핑
 *   etf_daily_prices  → 일별 종가 (etf_id, date, close_price)
 *
 * 수익률 계산:
 *   최신 종가 날짜 기준으로 가장 최근 행(today)과
 *   그보다 20 영업일 이전 행(month_ago)을 찾아 비교.
 *   (close_today - close_month_ago) / close_month_ago × 100
 *
 * 캐싱 전략:
 *   Cache-Control: max-age=3600 (1시간)
 *   → 장중 다수 스코어링 호출에서 DB 부하 방지
 *   → 종가 수집 Cron(16:00 KST)이 실행된 후 캐시 자동 만료
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

// 1개월 ≈ 20 영업일 (한국 증시 기준)
const TRADING_DAYS_1M = 20;

interface EtfRow {
  id: number;
  sector_name: string;
  etf_name: string;
  ticker: string;
}

interface PriceRow {
  etf_id: number;
  date: string;
  close_price: number;
}

export async function GET() {
  try {
    // ── 1. 섹터 ETF 목록 조회 ──────────────────────────────────────────────
    const { data: etfs, error: etfErr } = await supabase
      .from("sector_etfs")
      .select("id, sector_name, etf_name, ticker")
      .order("id");

    if (etfErr) throw new Error(`sector_etfs 조회 실패: ${etfErr.message}`);
    if (!etfs || etfs.length === 0) {
      return NextResponse.json(
        { error: "ETF 마스터 데이터 없음. sector_etfs 테이블을 확인하세요." },
        { status: 503 }
      );
    }

    // ── 2. 각 ETF의 최신 (TRADING_DAYS_1M + 5)개 종가 조회 ────────────────
    // +5: 공휴일·데이터 누락 대비 여유분
    // etf_id IN (...) 로 단일 쿼리 → N+1 쿼리 방지
    const etfIds = (etfs as EtfRow[]).map((e) => e.id);
    const lookback = TRADING_DAYS_1M + 5;

    // Supabase는 복잡한 per-group-limit 쿼리를 직접 지원하지 않으므로
    // etf_id별로 분리하지 않고, 전체에서 충분히 넓은 날짜 범위를 가져온다.
    // 최신 데이터 날짜 기준 60일치 → 모든 ETF의 20영업일 범위를 포함
    const { data: allPrices, error: priceErr } = await supabase
      .from("etf_daily_prices")
      .select("etf_id, date, close_price")
      .in("etf_id", etfIds)
      .order("date", { ascending: false })
      .limit(lookback * etfIds.length); // 종목 수 × lookback

    if (priceErr) throw new Error(`etf_daily_prices 조회 실패: ${priceErr.message}`);

    // ── 3. ETF별 가격 그룹핑 ──────────────────────────────────────────────
    // Map<etf_id, 날짜 내림차순 PriceRow[]>
    const priceMap = new Map<number, PriceRow[]>();
    for (const row of (allPrices ?? []) as PriceRow[]) {
      if (!priceMap.has(row.etf_id)) priceMap.set(row.etf_id, []);
      priceMap.get(row.etf_id)!.push(row);
    }

    // ── 4. 섹터별 1개월 수익률 계산 ───────────────────────────────────────
    const momentum: Record<string, number> = {};
    let latestDataDate: string | null = null;

    for (const etf of etfs as EtfRow[]) {
      const prices = priceMap.get(etf.id);
      if (!prices || prices.length < TRADING_DAYS_1M) {
        // 데이터 부족 → 0으로 처리 (스코어링에서 중립 취급)
        momentum[etf.sector_name] = 0;
        continue;
      }

      // prices는 date DESC 정렬 → [0]이 최신, [TRADING_DAYS_1M]이 ~1개월 전
      const today    = prices[0];
      const monthAgo = prices[Math.min(TRADING_DAYS_1M, prices.length - 1)];

      if (!latestDataDate || today.date > latestDataDate) {
        latestDataDate = today.date;
      }

      const ret =
        monthAgo.close_price > 0
          ? Math.round(
              ((today.close_price - monthAgo.close_price) / monthAgo.close_price) * 10000
            ) / 100  // 소수점 2자리 반올림
          : 0;

      momentum[etf.sector_name] = ret;
    }

    // ── 5. 응답 반환 (1시간 캐시) ─────────────────────────────────────────
    // Cache-Control 헤더: CDN 엣지에서도 캐시 가능(s-maxage)하여 Vercel Function 호출 최소화
    return NextResponse.json(
      {
        ...momentum,
        _meta: {
          updated_at:  new Date().toISOString(),
          data_date:   latestDataDate ?? "no data",
          sector_count: Object.keys(momentum).length,
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
        },
      }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sector-momentum]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
