/**
 * POST /api/cron/update-etf
 *
 * 매일 오후 4:00 KST (07:00 UTC) 평일에 실행 (vercel.json cron 또는 GitHub Actions).
 * sector_etfs 테이블의 모든 ETF 종목 종가를 수집해 etf_daily_prices에 Upsert.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * 설계 원칙:
 *  - fetchTodayPrice()를 별도 모듈로 분리 → 증권사 API 교체 시 이 함수만 수정
 *  - Supabase Service Role Key 사용 → RLS 우회 (Cron 환경에서 user context 없음)
 *  - Promise.allSettled → 일부 종목 실패해도 나머지 계속 처리
 *  - Upsert(onConflict: etf_id+date) → 재실행 시 중복 삽입 없이 안전하게 갱신
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { fetchRecentCloses } from "@/lib/server/etf-price-fetcher";

export const dynamic     = "force-dynamic";
// Vercel Pro: 여러 ETF 순차 조회 시간 보장. Hobby 플랜은 10s 제한에 주의.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // ── 1. Cron 인증 ────────────────────────────────────────────────────────────
  // CRON_SECRET 환경변수로 무단 호출 차단 (GitHub Actions / Vercel Cron 모두 동일)
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  try {
    // ── 2. 추적 ETF 목록 조회 ───────────────────────────────────────────────
    // sector_etfs 테이블이 마스터 → 코드 변경 없이 DB에서 종목 추가/제거 가능
    const { data: etfs, error: etfErr } = await supabase
      .from("sector_etfs")
      .select("id, ticker, sector_name, etf_name")
      .order("id");

    if (etfErr) throw new Error(`sector_etfs 조회 실패: ${etfErr.message}`);
    if (!etfs || etfs.length === 0) {
      return NextResponse.json({ message: "추적 ETF 없음", updated: 0 });
    }

    // ── 3. 종가 수집 (병렬) ─────────────────────────────────────────────────
    // Promise.allSettled: 일부 종목 API 오류가 전체 배치를 중단시키지 않도록.
    // 당일 1건만 적재하면 etf_daily_prices에 히스토리가 쌓이기 전까지 섹터
    // 1개월(20영업일) 수익률이 "1일 수익률"로 degrade되므로, 최근 구간(3개월
    // ≈ 60영업일)을 통째로 백필한다. upsert가 (etf_id, date) 멱등이라 매 실행
    // 재적재해도 중복 없이 안전하며, cron 첫 가동 즉시 20일+ 윈도우가 채워진다.
    const results = await Promise.allSettled(
      etfs.map(async (etf) => {
        const closes = await fetchRecentCloses(etf.ticker);
        if (closes.length === 0) throw new Error(`${etf.ticker} 종가 조회 실패`);
        return closes.map((c) => ({
          etf_id:      etf.id,
          date:        c.date,
          close_price: c.close,
        }));
      })
    );

    // ── 4. 성공한 종목만 Upsert ──────────────────────────────────────────────
    // onConflict: etf_id+date → 동일 날짜 재실행 시 가격 갱신(update)으로 처리
    // ignoreDuplicates: false → 중복 시 close_price를 최신값으로 덮어쓰기
    const okResults = results.filter(
      (r): r is PromiseFulfilledResult<{ etf_id: number; date: string; close_price: number }[]> =>
        r.status === "fulfilled"
    );
    const rows = okResults.flatMap((r) => r.value);

    const failed = results
      .filter((r) => r.status === "rejected")
      .map((r, i) => ({
        ticker: etfs[i]?.ticker ?? "unknown",
        reason: (r as PromiseRejectedResult).reason?.message ?? "unknown error",
      }));

    let upsertError: string | null = null;
    if (rows.length > 0) {
      const { error } = await supabase
        .from("etf_daily_prices")
        .upsert(rows, { onConflict: "etf_id,date" });

      if (error) upsertError = error.message;
    }

    // ── 5. 결과 반환 ────────────────────────────────────────────────────────
    // updated: 수집 성공 ETF 수 / rowsUpserted: 백필 포함 실제 upsert된 행 수
    return NextResponse.json({
      date:        today,
      total:       etfs.length,
      updated:     okResults.length,
      rowsUpserted: rows.length,
      failed:      failed.length,
      failedDetails: failed,
      upsertError,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/update-etf]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
