import { NextResponse } from "next/server";
import { getQuote, getIndexFromNaver } from "@/lib/server/yahoo-finance";

export const dynamic     = "force-dynamic";
export const maxDuration = 30;

const INDEX_MAP = [
  { name: "KOSPI",   ticker: "KS11" },
  { name: "KOSDAQ",  ticker: "KQ11" },
  { name: "S&P500",  ticker: "S&P500" },
  { name: "NASDAQ",  ticker: "IXIC" },
  { name: "달러/원", ticker: "USD/KRW" },
] as const;

const KR_INDICES = new Set(["KOSPI", "KOSDAQ"]);

// Broker keys are never accepted from request headers; saved keys live server-side only.
export async function GET() {
  // Yahoo + Naver 병렬 조회
  const [yahooSettled, naverKospiSettled, naverKosdaqSettled] = await Promise.allSettled([
    Promise.allSettled(INDEX_MAP.map(({ ticker }) => getQuote(ticker))),
    getIndexFromNaver("^KS11"),
    getIndexFromNaver("^KQ11"),
  ]);

  // Yahoo 결과 먼저 채우기
  const indices: Record<string, unknown> = {};
  if (yahooSettled.status === "fulfilled") {
    const yahooResults = yahooSettled.value;
    INDEX_MAP.forEach(({ name }, i) => {
      const r = yahooResults[i];
      if (r.status === "fulfilled" && r.value) {
        const q = r.value;
        indices[name] = { price: q.price, change: q.change, change_pct: q.change_pct };
      } else {
        indices[name] = null;
      }
    });
  } else {
    INDEX_MAP.forEach(({ name }) => { indices[name] = null; });
  }

  // 네이버 파이낸스로 국내 지수 보완 (Yahoo 실패 시 채움)
  const naverData: Record<string, { price: number; change: number; change_pct: number } | null> = {
    KOSPI:  naverKospiSettled.status  === "fulfilled" && naverKospiSettled.value
              ? { price: naverKospiSettled.value.price, change: naverKospiSettled.value.change, change_pct: naverKospiSettled.value.change_pct }
              : null,
    KOSDAQ: naverKosdaqSettled.status === "fulfilled" && naverKosdaqSettled.value
              ? { price: naverKosdaqSettled.value.price, change: naverKosdaqSettled.value.change, change_pct: naverKosdaqSettled.value.change_pct }
              : null,
  };
  for (const [name, data] of Object.entries(naverData)) {
    if (KR_INDICES.has(name) && data && data.price > 0) {
      // Yahoo가 null인 경우 또는 Yahoo보다 Naver 우선 (Yahoo Vercel 차단)
      indices[name] = data;
    }
  }

  return NextResponse.json(indices);
}
