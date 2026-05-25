import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

const INDEX_MAP = [
  { name: "KOSPI",   ticker: "KS11" },
  { name: "KOSDAQ",  ticker: "KQ11" },
  { name: "S&P500",  ticker: "S&P500" },
  { name: "NASDAQ",  ticker: "IXIC" },
  { name: "달러/원", ticker: "USD/KRW" },
] as const;

const KR_INDICES = new Set(["KOSPI", "KOSDAQ"]);

export async function GET(req: NextRequest) {
  const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
  const appKey     = req.headers.get("x-app-key");
  const appSecret  = req.headers.get("x-app-secret");
  const hasBroker  = !!(brokerType && appKey && appSecret);

  // Yahoo + KIS 병렬 조회
  const [yahooSettled, kisSettled] = await Promise.allSettled([
    Promise.allSettled(INDEX_MAP.map(({ ticker }) => getQuote(ticker))),
    hasBroker
      ? createBrokerProvider(brokerType!, { appKey: appKey!, appSecret: appSecret! }).getIndices()
      : Promise.resolve(null),
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

  // 국내 지수는 KIS 데이터로 덮어쓰기 (브로커 사용 가능 시 Yahoo보다 우선)
  if (kisSettled.status === "fulfilled" && kisSettled.value) {
    const kis = kisSettled.value;
    for (const [name, data] of Object.entries(kis)) {
      if (KR_INDICES.has(name) && data.price > 0) {
        indices[name] = { price: data.price, change: data.change, change_pct: data.change_pct };
      }
    }
  }

  return NextResponse.json(indices);
}
