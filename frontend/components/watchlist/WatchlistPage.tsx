"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
import { api } from "@/lib/api";
import { BrokerConfigManager } from "@/lib/apiConfig";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import {
  Star, StarOff, Search, TrendingUp, TrendingDown,
  Minus, RefreshCw, Trash2, Plus, X,
} from "lucide-react";

type WatchlistItem = {
  id: number;
  ticker: string;
  name: string;
  sector: string;
  added_at: string;
};

type QuoteData = {
  price: number;
  change: number;
  change_pct: number;
};

type SearchResult = {
  ticker: string;
  name: string;
  market: string;
  sector: string;
};

async function fetchWatchlistWithPrices(): Promise<(WatchlistItem & { quote: QuoteData | null })[]> {
  const items = (await api.portfolio.watchlist()) as WatchlistItem[];
  if (!items.length) return [];

  const quotes = await Promise.allSettled(
    items.map((item) => api.market.quote(item.ticker) as Promise<QuoteData>),
  );

  return items.map((item, i) => ({
    ...item,
    quote: quotes[i].status === "fulfilled" ? (quotes[i] as PromiseFulfilledResult<QuoteData>).value : null,
  }));
}

type BrokerCreds = { type: string; appKey: string; appSecret: string } | null;

export function WatchlistPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [brokerCreds, setBrokerCreds] = useState<BrokerCreds>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    BrokerConfigManager.getDefaultBrokerConfig().then((config) => {
      if (!config) return;
      setBrokerCreds({ type: config.type, appKey: config.credentials.appKey, appSecret: config.credentials.appSecret });
    });
  }, []);

  const { data: items, isLoading, mutate } = useSWR(
    "watchlist-with-prices",
    fetchWatchlistWithPrices,
    {
      revalidateOnFocus: false,
      refreshInterval: 60_000,
      dedupingInterval: 30_000,
    },
  );

  // 검색창 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults([]); setSearchOpen(false); return; }

    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.market.search(q, brokerCreds) as SearchResult[];
        setSearchResults(results.slice(0, 8));
        setSearchOpen(results.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleAdd = async (result: SearchResult) => {
    setAdding(result.ticker);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    try {
      await api.portfolio.addWatchlist({
        ticker: result.ticker,
        name: result.name,
        sector: result.sector || "",
      });
      await mutate();
    } catch (e) {
      alert(`추가 실패: ${e instanceof Error ? e.message : "오류 발생"}`);
    } finally {
      setAdding(null);
    }
  };

  const handleRemove = async (id: number, name: string) => {
    if (!confirm(`${name}을(를) 관심 종목에서 삭제하시겠습니까?`)) return;
    setRemoving(id);
    try {
      await api.portfolio.removeWatchlist(id);
      await mutate();
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : "오류 발생"}`);
    } finally {
      setRemoving(null);
    }
  };

  const alreadyWatched = new Set(items?.map((i) => i.ticker) ?? []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || searchResults.length === 0) return;
    const first = searchResults.find((r) => !alreadyWatched.has(r.ticker));
    if (first) handleAdd(first);
  };

  return (
    <div className="p-6 space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
          <h1 className="text-xl font-bold">관심 종목</h1>
          {items && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {items.length}개
            </span>
          )}
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} />
          새로고침
        </button>
      </div>

      {/* 종목 추가 검색 */}
      <div ref={searchRef} className="relative">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted">
          {searching ? (
            <RefreshCw size={15} className="text-muted-foreground animate-spin shrink-0" />
          ) : (
            <Search size={15} className="text-muted-foreground shrink-0" />
          )}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
            placeholder="종목명 또는 티커로 검색하여 추가..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(false); }}>
              <X size={14} className="text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {searchOpen && searchResults.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border shadow-xl overflow-hidden"
            style={{ background: "var(--card)" }}>
            {searchResults.map((result) => {
              const isAlready = alreadyWatched.has(result.ticker);
              return (
                <button
                  key={result.ticker}
                  onClick={() => !isAlready && handleAdd(result)}
                  disabled={isAlready || adding === result.ticker}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors
                    ${isAlready
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-white/5 cursor-pointer"
                    }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-left min-w-0">
                      <div className="font-medium truncate">{result.name}</div>
                      <div className="text-xs text-muted-foreground">{result.ticker} · {result.market}</div>
                    </div>
                    {result.sector && (
                      <Badge variant="blue" className="text-xs shrink-0">{result.sector}</Badge>
                    )}
                  </div>
                  <div className="shrink-0 ml-3">
                    {isAlready ? (
                      <span className="text-xs text-yellow-400 flex items-center gap-1">
                        <Star size={12} className="fill-yellow-400" /> 추가됨
                      </span>
                    ) : (
                      <Plus size={16} className="text-muted-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 종목 목록 */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center gap-3 text-center">
          <StarOff className="w-10 h-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-muted-foreground">관심 종목이 없습니다</p>
            <p className="text-xs text-muted-foreground mt-1">위 검색창에서 종목을 찾아 추가하세요</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const q = item.quote;
            const change = q?.change_pct ?? 0;
            const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
            const isRemoving = removing === item.id;

            return (
              <Card
                key={item.id}
                className="flex items-center justify-between px-4 py-3 hover:border-blue-500/30 transition-colors"
              >
                {/* 종목 정보 */}
                <Link
                  href={`/market/${item.ticker}`}
                  className="flex items-center gap-4 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{item.name}</span>
                      <span className="text-xs text-muted-foreground">{item.ticker}</span>
                      {item.sector && (
                        <Badge variant="blue" className="text-xs hidden sm:inline-flex">{item.sector}</Badge>
                      )}
                    </div>
                  </div>
                </Link>

                {/* 시세 */}
                <div className="flex items-center gap-6 shrink-0">
                  {q ? (
                    <>
                      <div className="text-right hidden sm:block">
                        <div className="font-bold tabular-nums text-sm">{formatNumber(q.price)}원</div>
                        <div className={`flex items-center justify-end gap-1 text-xs ${colorByChange(change)}`}>
                          <Icon size={11} />
                          {formatPercent(change)}
                          <span className="text-muted-foreground">
                            ({change >= 0 ? "+" : ""}{formatNumber(q.change)})
                          </span>
                        </div>
                      </div>
                      {/* 모바일: 등락률만 */}
                      <div className={`sm:hidden text-sm font-bold ${colorByChange(change)}`}>
                        {formatPercent(change)}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">로딩 중...</div>
                  )}

                  {/* 바로가기 + 삭제 */}
                  <div className="flex items-center gap-1">
                    <Link href={`/market/${item.ticker}`}>
                      <Button size="sm" variant="ghost" className="text-xs px-2 h-7 text-blue-400 hover:text-blue-300">
                        차트
                      </Button>
                    </Link>
                    <button
                      onClick={() => handleRemove(item.id, item.name)}
                      disabled={isRemoving}
                      className="p-1.5 rounded text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                      title="관심 종목 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 안내 */}
      {items && items.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          시세는 60초마다 자동 갱신됩니다 · 종목 클릭 시 상세 차트로 이동
        </p>
      )}
    </div>
  );
}
