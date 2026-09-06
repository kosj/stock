/**
 * GET /api/news?region=domestic|global&mode=major|all&debug=1
 *
 * 국내외 금융 뉴스 RSS 통합 조회 + 선별.
 *  - 기본(mode=major)은 중복을 병합하고 중요도 상위만 내려준다.
 *  - mode=all 은 중복 병합만 적용한 전체. 화면의 "전체" 토글이 쓴다.
 *  - debug=1 은 무엇이 왜 빠졌는지 함께 내려준다(운영 점검용).
 *
 * 일부 피드가 죽어도 나머지를 반환하되 실패한 소스를 failures 로 함께 내려
 * 화면이 "조용히 줄어든 목록"을 정상처럼 보여주지 않게 한다.
 * 전부 실패하면 502 — 빈 목록을 200 으로 주면 "오늘 뉴스가 없다"로 오인된다.
 */
import { NextRequest, NextResponse } from "next/server";
import { collectNews, type Region } from "@/lib/server/news-feeds";
import { curate } from "@/lib/server/news-curation";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("region");
  const region: Region | undefined =
    raw === "domestic" || raw === "global" ? raw : undefined;
  const mode = sp.get("mode") === "all" ? "all" : "major";
  const debug = sp.get("debug") === "1";

  try {
    const { items: rawItems, failures, fetchedAt } = await collectNews(region);

    // 수집이 통째로 실패한 경우와 선별로 0건이 된 경우는 원인이 다르다.
    // 전자만 502 로 다룬다 — 후자는 선별 기준 문제이지 장애가 아니다.
    if (rawItems.length === 0) {
      return NextResponse.json(
        {
          error: "뉴스를 불러오지 못했습니다. 모든 피드 조회에 실패했습니다.",
          failures,
          fetchedAt,
        },
        { status: 502 },
      );
    }

    const { major, all, dropped } = curate(rawItems);
    const items = mode === "all" ? all : major;

    const body: Record<string, unknown> = {
      count: items.length,
      mode,
      // 선별 전후를 함께 내려 화면이 "N건 중 M건" 을 정직하게 말할 수 있게 한다
      totals: {
        collected: rawItems.length,   // 피드에서 받은 원본
        merged: all.length,           // 중복 병합 후
        major: major.length,          // 중요도 상위
        droppedNoise: dropped.length, // 뉴스가 아니라 제외
        mergedAway: rawItems.length - dropped.length - all.length, // 중복으로 흡수
      },
      items,
      failures,
      fetchedAt,
    };
    if (debug) body.dropped = dropped;

    return NextResponse.json(body, {
      headers: {
        // 뉴스는 분 단위로 갱신되면 충분하다. 원문 서버 부하도 줄인다.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "조회 실패";
    return NextResponse.json(
      { error: `뉴스를 불러오지 못했습니다: ${message}` },
      { status: 500 },
    );
  }
}
