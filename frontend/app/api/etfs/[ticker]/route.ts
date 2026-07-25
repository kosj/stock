/**
 * GET /api/etfs/[ticker]
 *
 * ETF 상세 정보: 기본 메타(네이버 전체 목록에서 조회) + 규칙 기반 진입타점·
 * 손절(ATR 적응형). 차트 캔들은 기존 /api/market/chart/[ticker]를 그대로 쓴다
 * (지표 계산이 이미 구현돼 있어 중복 구현하지 않는다).
 *
 * ※ 진입/손절 수치는 과거 가격 기반 기술적 레벨이며 투자 권유가 아니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchNaverEtfList } from "@/lib/server/naver-etf";
import { getChart } from "@/lib/server/yahoo-finance";
import { analyzeEntryPoint } from "@/lib/server/entry-point-analysis";
import { ACCOUNT_LABEL, isEligible, ineligibleReason, type AccountType } from "@/lib/server/etf-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACCOUNTS: AccountType[] = ["pension", "irp", "isa"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  try {
    const { ticker: raw } = await params;
    const ticker = String(raw).padStart(6, "0");
    if (!/^\d{6}$/.test(ticker)) {
      return NextResponse.json({ error: "6자리 종목코드가 필요합니다." }, { status: 400 });
    }

    const list = await fetchNaverEtfList();
    const meta = list.find((e) => e.ticker === ticker) ?? null;

    // 진입타점: 6개월 일봉으로 ATR·지지선 산출 (ETF이므로 isBasket)
    let entry = null;
    try {
      const candles = await getChart(ticker, "6m");
      entry = analyzeEntryPoint(ticker, candles, { isBasket: true });
    } catch {
      /* 차트 실패 시 메타만 반환 */
    }

    // 계좌별 편입 가능 여부 — 상세에서 바로 확인할 수 있게 함께 제공
    const accounts = meta
      ? ACCOUNTS.map((a) => ({
          account: a,
          label: ACCOUNT_LABEL[a],
          eligible: isEligible(meta, a),
          reason: ineligibleReason(meta, a),
        }))
      : [];

    return NextResponse.json(
      {
        ticker,
        found: meta !== null,
        meta,
        accounts,
        entry,
        updated_at: new Date().toISOString(),
        disclaimer: "기술적 레벨 정보이며 투자 권유가 아닙니다.",
      },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[etfs/detail]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
