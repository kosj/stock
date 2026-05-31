/**
 * DART API 진단 엔드포인트
 * GET /api/market/dart-test?ticker=005930
 * 각 단계별 결과를 반환해 어디서 실패하는지 확인
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DART_BASE = "https://opendart.fss.or.kr/api";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "005930";
  const apiKey = process.env.DART_API_KEY ?? "";

  const result: Record<string, unknown> = {
    ticker,
    env_key_present: !!apiKey,
    env_key_length:  apiKey.length,
    env_key_preview: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "(없음)",
  };

  if (!apiKey) {
    return NextResponse.json({ ...result, error: "DART_API_KEY 환경변수 없음" });
  }

  // Step 1: list.json 으로 corp_code 조회
  const end   = new Date();
  const start = new Date(end.getTime() - 2 * 365 * 86_400_000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const listUrl =
    `${DART_BASE}/list.json?crtfc_key=${apiKey}` +
    `&stock_code=${ticker}&bgn_de=${fmt(start)}&end_de=${fmt(end)}&page_count=1`;

  result.list_url_without_key = listUrl.replace(apiKey, "***");

  try {
    const listRes  = await fetch(listUrl, { signal: AbortSignal.timeout(10000) });
    const listData = await listRes.json();
    result.list_http_status = listRes.status;
    result.list_status      = listData.status;
    result.list_message     = listData.message;
    result.list_total_count = listData.total_count;
    result.list_corp_code   = listData.list?.[0]?.corp_code ?? null;

    if (listData.status !== "000" || !listData.list?.length) {
      return NextResponse.json({
        ...result,
        error: `list.json 실패: status=${listData.status}, message=${listData.message}`,
      });
    }

    const corpCode = listData.list[0].corp_code as string;

    // Step 2: company.json 으로 기업 정보 조회
    const companyUrl = `${DART_BASE}/company.json?crtfc_key=${apiKey}&corp_code=${corpCode}`;
    const compRes    = await fetch(companyUrl, { signal: AbortSignal.timeout(10000) });
    const compData   = await compRes.json();

    result.company_http_status = compRes.status;
    result.company_status      = compData.status;
    result.company_message     = compData.message;
    result.company_name        = compData.corp_name ?? null;
    result.company_ceo         = compData.ceo_nm   ?? null;

    return NextResponse.json({
      ...result,
      success: compData.status === "000",
    });
  } catch (err) {
    result.fetch_error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ...result, error: "네트워크 오류" });
  }
}
