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

    // "stock" = 일반 주식계좌(편입 제한 없음 — 전체 유니버스). 나머지는 제도 필터 적용.
    const accountRaw = sp.get("account");
    const isStock = accountRaw === "stock";
    const account = accountRaw as AccountType | null;
    if (!isStock && (!account || !VALID_ACCOUNTS.includes(account))) {
      return NextResponse.json(
        { error: "account 파라미터가 필요합니다 (pension | irp | isa | stock)." },
        { status: 400 },
      );
    }

    const periodRaw = (sp.get("period") ?? "3M").toUpperCase();
    const period: ReturnPeriod = (periodRaw in RETURN_WINDOWS ? periodRaw : "3M") as ReturnPeriod;

    const limit = Math.min(20, Math.max(1, parseInt(sp.get("limit") ?? "5", 10) || 5));

    // 1) 계좌 편입 가능 ETF 수익률 랭킹 → 상위 N (stock은 필터 없음)
    // 추천 화면: 유동성 하한 + 동일지수 중복 제거 + 파생형 후순위
    const ranking = await getEtfRanking(period, isStock ? undefined : account!, {
      liquidityFilter: true, dedup: true, demoteRisky: true, blendVolatility: true,
    });
    const top = ranking.rows.slice(0, limit);

    // 2) 각 종목 진입타점 계산(병렬)
    const picks = await Promise.all(
      top.map(async (row) => {
        let entry = null;
        let drawdownPct: number | null = null;
        try {
          // 1y: 진입타점(후행 구간 사용)과 52주 전고점 낙폭을 한 번의 조회로 계산
          const candles = await getChart(row.ticker, "1y");
          // ETF는 바스켓 → 개별주 기준봉 전제의 눌림목 점수를 판정에 쓰지 않는다
          entry = analyzeEntryPoint(row.ticker, candles, { isBasket: true });
          const closes = (candles ?? []).map((c) => c.close).filter((v) => v > 0);
          if (closes.length >= 20) {
            const high52 = Math.max(...closes);
            drawdownPct = Math.round((closes[closes.length - 1] / high52 - 1) * 10000) / 100;
          }
        } catch { /* 진입타점 실패 시 null */ }
        return { ...row, entry, drawdownPct };
      }),
    );

    return NextResponse.json(
      {
        account,
        account_label: isStock ? "일반 주식계좌" : ACCOUNT_LABEL[account!],
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
