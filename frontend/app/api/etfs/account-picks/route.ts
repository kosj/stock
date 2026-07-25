/**
 * GET /api/etfs/account-picks?account=irp&period=3M&limit=5
 *
 * 퇴직연금/IRP/ISA 계좌에 편입 가능한 ETF를 수익률 상위로 선별하고,
 * 각 종목의 규칙 기반 진입타점(지지선·이평·밴드·손절선)을 함께 반환한다.
 *   - account: pension | irp | isa (필수)
 *   - period:  정렬 기준 수익률 구간 (기본 3M)
 *   - limit:   상위 N개 (기본 5, 최대 20)
 *
 * ※ 정보 제공용 정량 선별이며 개인 투자자문/매매 권유가 아니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEtfRanking, RETURN_WINDOWS, type ReturnPeriod } from "@/lib/server/etf-ranking-service";
import { ACCOUNT_LABEL, type AccountType } from "@/lib/server/etf-universe";
import { getChart } from "@/lib/server/yahoo-finance";
import { analyzeEntryPoint } from "@/lib/server/entry-point-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_ACCOUNTS: AccountType[] = ["pension", "irp", "isa"];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const account = sp.get("account") as AccountType | null;
    if (!account || !VALID_ACCOUNTS.includes(account)) {
      return NextResponse.json(
        { error: "account 파라미터가 필요합니다 (pension | irp | isa)." },
        { status: 400 },
      );
    }

    const periodRaw = (sp.get("period") ?? "3M").toUpperCase();
    const period: ReturnPeriod = (periodRaw in RETURN_WINDOWS ? periodRaw : "3M") as ReturnPeriod;

    const limit = Math.min(20, Math.max(1, parseInt(sp.get("limit") ?? "5", 10) || 5));

    // 1) 계좌 편입 가능 ETF 수익률 랭킹 → 상위 N
    const ranking = await getEtfRanking(period, account);
    const top = ranking.rows.slice(0, limit);

    // 2) 각 종목 진입타점 계산(병렬)
    const picks = await Promise.all(
      top.map(async (row) => {
        let entry = null;
        try {
          const candles = await getChart(row.ticker, "6m");
          entry = analyzeEntryPoint(row.ticker, candles);
        } catch { /* 진입타점 실패 시 null */ }
        return { ...row, entry };
      }),
    );

    return NextResponse.json(
      {
        account,
        account_label: ACCOUNT_LABEL[account],
        period,
        count: picks.length,
        universe_total: ranking.total,
        universe_covered: ranking.covered,
        source: ranking.source,
        note: ranking.note ?? null,
        updated_at: new Date().toISOString(),
        disclaimer: "정보 제공용 정량 선별이며 투자 권유가 아닙니다. 투자 책임은 본인에게 있습니다.",
        picks,
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[etfs/account-picks]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
