/**
 * GET /api/etfs/ranking?period=1M&account=irp
 *
 * 국내 상장 ETF를 수익률(period 구간) 내림차순으로 정렬해 반환.
 *   - period:  1D | 1W | 1M | 3M | 6M | 1Y (기본 1M)
 *   - account: pension | irp | isa (지정 시 해당 계좌 편입 가능 ETF만)
 *
 * 데이터: ETF 목록 = Supabase etf_universe(KIS 적재) → 시드 폴백,
 *         수익률 = Yahoo getChart. 외부 API 조회가 있어 응답을 캐시한다.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEtfRanking, RETURN_WINDOWS, type ReturnPeriod } from "@/lib/server/etf-ranking-service";
import type { AccountType } from "@/lib/server/etf-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_ACCOUNTS: AccountType[] = ["pension", "irp", "isa"];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const periodRaw = (sp.get("period") ?? "1M").toUpperCase();
    const period: ReturnPeriod = (periodRaw in RETURN_WINDOWS ? periodRaw : "1M") as ReturnPeriod;

    const accountRaw = sp.get("account") as AccountType | null;
    const account = accountRaw && VALID_ACCOUNTS.includes(accountRaw) ? accountRaw : undefined;

    // asset=safe → 안전자산(채권·현금성·금)만 랭킹
    const safeOnly = sp.get("asset") === "safe";

    const result = await getEtfRanking(period, account, { safeOnly });

    return NextResponse.json(
      {
        period,
        account: account ?? null,
        asset: safeOnly ? "safe" : "all",
        count: result.rows.length,
        // 전체 유니버스 대비 실제 집계 종목 수 — 부분 커버리지를 UI가 표시한다
        total: result.total,
        covered: result.covered,
        source: result.source,
        note: result.note ?? null,
        updated_at: new Date().toISOString(),
        ranking: result.rows,
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[etfs/ranking]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
