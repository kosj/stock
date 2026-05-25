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

// 브로커에서 보완할 국내 지수 이름 목록
const KR_INDICES = new Set(["KOSPI", "KOSDAQ"]);

export async function GET(req: NextRequest) {
  const results = await Promise.allSettled(
    INDEX_MAP.map(({ ticker }) => getQuote(ticker))
  );

  const indices: Record<string, unknown> = {};
  INDEX_MAP.forEach(({ name }, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) {
      const q = r.value;
      indices[name] = { price: q.price, change: q.change, change_pct: q.change_pct };
    } else {
      indices[name] = null;
    }
  });

  // 국내 지수 중 하나라도 null이면 브로커 폴백 시도
  const needFallback = [...KR_INDICES].some((name) => indices[name] === null);
  if (needFallback) {
    const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
    const appKey     = req.headers.get("x-app-key");
    const appSecret  = req.headers.get("x-app-secret");

    if (brokerType && appKey && appSecret) {
      try {
        const provider = createBrokerProvider(brokerType, { appKey, appSecret });
        const brokerIndices = await provider.getIndices();
        for (const [name, data] of Object.entries(brokerIndices)) {
          if (KR_INDICES.has(name) && indices[name] === null && data.price > 0) {
            indices[name] = { price: data.price, change: data.change, change_pct: data.change_pct };
          }
        }
      } catch (err) {
        console.warn(`[indices] broker(${brokerType}) 폴백 실패:`, err);
      }
    }
  }

  return NextResponse.json(indices);
}
