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

    const rows = await getEtfRanking(period, account);

    return NextResponse.json(
      {
        period,
        account: account ?? null,
        count: rows.length,
        updated_at: new Date().toISOString(),
        ranking: rows,
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[etfs/ranking]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
