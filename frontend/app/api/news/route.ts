/**
 * GET /api/news?region=domestic|global
 *
 * 국내외 금융 뉴스 RSS 통합 조회.
 * 일부 피드가 죽어도 나머지를 반환하되, 실패한 소스를 failures 로 함께 내려
 * 화면이 "조용히 줄어든 목록"을 정상처럼 보여주지 않게 한다.
 * 전부 실패하면 502 — 빈 목록을 200 으로 주면 "오늘 뉴스가 없다"로 오인된다.
 */
import { NextRequest, NextResponse } from "next/server";
import { collectNews, type Region } from "@/lib/server/news-feeds";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("region");
  const region: Region | undefined =
    raw === "domestic" || raw === "global" ? raw : undefined;

  try {
    const { items, failures, fetchedAt } = await collectNews(region);

    if (items.length === 0) {
      return NextResponse.json(
        {
          error: "뉴스를 불러오지 못했습니다. 모든 피드 조회에 실패했습니다.",
          failures,
          fetchedAt,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { count: items.length, items, failures, fetchedAt },
      {
        headers: {
          // 뉴스는 분 단위로 갱신되면 충분하다. 원문 서버 부하도 줄인다.
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "조회 실패";
    return NextResponse.json(
      { error: `뉴스를 불러오지 못했습니다: ${message}` },
      { status: 500 },
    );
  }
}
