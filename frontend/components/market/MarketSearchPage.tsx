"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { BrokerConfigManager } from "@/lib/apiConfig";
import { Card } from "@/components/ui/Card";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type BrokerCreds = { type: string; appKey: string; appSecret: string } | null;

const POPULAR = [
  { ticker: "005930", name: "삼성전자" },
  { ticker: "000660", name: "SK하이닉스" },
  { ticker: "035420", name: "NAVER" },
  { ticker: "035720", name: "카카오" },
  { ticker: "373220", name: "LG에너지솔루션" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "TSLA", name: "Tesla" },
];

export function MarketSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [brokerCreds, setBrokerCreds] = useState<BrokerCreds>(null);
  const router = useRouter();

  useEffect(() => {
    BrokerConfigManager.getDefaultBrokerConfig().then((config) => {
      if (!config) return;
      setBrokerCreds({ type: config.type, appKey: config.credentials.appKey, appSecret: config.credentials.appSecret });
    });
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await api.market.search(q, brokerCreds);
      setResults(data as any[]);
    } catch {}
    finally { setLoading(false); }
  }, [brokerCreds]);

  async function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) {
      if (results.length === 1) {
        router.push(`/market/${results[0].ticker}`);
      } else {
        await search(query);
      }
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">시세 분석</h1>

      {/* 검색창 */}
      <Card className="p-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
            onKeyDown={handleKey}
            placeholder="종목명 또는 코드 검색 (예: 삼성전자, 005930, AAPL)"
            className="w-full bg-muted text-foreground pl-9 pr-4 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground/60"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {results.length > 0 && (
          <div className="mt-2 border rounded-lg overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {results.slice(0, 10).map((r) => (
              <Link
                key={r.ticker}
                href={`/market/${r.ticker}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors border-b last:border-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="min-w-0">
                  <span className="font-medium truncate block">{r.name}</span>
                  <span className="text-muted-foreground text-xs">{r.ticker}</span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{r.market}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* 인기 종목 */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">주요 종목</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {POPULAR.map(({ ticker, name }) => (
            <Link key={ticker} href={`/market/${ticker}`}>
              <Card className="p-3 hover:border-blue-500/40 transition-colors cursor-pointer">
                <div className="font-medium text-sm">{name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{ticker}</div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
