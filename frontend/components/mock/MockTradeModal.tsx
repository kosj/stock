"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/lib/utils";
import { X, Search, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

interface SearchResult {
  ticker: string;
  name:   string;
  market?: string;
}

interface SellTarget {
  ticker:    string;
  name:      string;
  quantity:  number; // 보유 수량 최대
  avg_price: number;
}

interface Props {
  mode:        "BUY" | "SELL";
  cash:        number;       // 보유 현금 (매수 시 사용)
  sellTarget?: SellTarget;  // SELL 모드 시 종목 정보
  onClose:     () => void;
  onTraded:    () => void;
}

export function MockTradeModal({ mode, cash, sellTarget, onClose, onTraded }: Props) {
  const isSell = mode === "SELL";

  // 매수: 종목 검색
  const [query,       setQuery]       = useState("");
  const [results,     setResults]     = useState<SearchResult[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [selected,    setSelected]    = useState<SearchResult | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 공통
  const [quantity,    setQuantity]    = useState("");
  const [quotePrice,  setQuotePrice]  = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

  const ticker = isSell ? sellTarget!.ticker : selected?.ticker ?? "";
  const name   = isSell ? sellTarget!.name   : selected?.name   ?? "";

  // 현재가 조회
  const fetchQuote = useCallback(async (t: string) => {
    if (!t) return;
    setQuoteLoading(true);
    try {
      const q = await api.market.quote(t) as any;
      setQuotePrice(q?.price ?? null);
    } catch {
      setQuotePrice(null);
    } finally {
      setQuoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSell) fetchQuote(sellTarget!.ticker);
  }, [isSell, sellTarget, fetchQuote]);

  useEffect(() => {
    if (selected?.ticker) fetchQuote(selected.ticker);
  }, [selected, fetchQuote]);

  // 종목 검색 (매수 모드)
  const handleSearch = (q: string) => {
    setQuery(q);
    setSelected(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.market.search(q) as SearchResult[];
        setResults(data.slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const qty     = Number(quantity) || 0;
  const total   = quotePrice ? Math.round(quotePrice * qty) : 0;
  const canBuy  = !isSell && !!ticker && qty > 0 && !!quotePrice && total <= cash;
  const canSell = isSell && qty > 0 && qty <= (sellTarget?.quantity ?? 0) && !!quotePrice;
  const canSubmit = isSell ? canSell : canBuy;

  async function handleSubmit() {
    if (!ticker || !name || qty <= 0 || !quotePrice) return;
    setSubmitting(true);
    try {
      await api.mock.trade({ ticker, name, trade_type: mode, quantity: qty });
      toast.success(`${name} ${qty}주 ${isSell ? "매도" : "매수"} 완료 (체결가 ${formatNumber(quotePrice)})`);
      onTraded();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "주문 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-sm rounded-xl border p-6 space-y-4"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X size={18} />
        </button>

        <div className="flex items-center gap-2">
          {isSell
            ? <TrendingDown size={18} className="text-red-400" />
            : <TrendingUp   size={18} className="text-blue-400" />}
          <h2 className="text-base font-semibold">{isSell ? "매도" : "매수"} 주문</h2>
        </div>

        {/* 매수: 종목 검색 */}
        {!isSell && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">종목 검색</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="삼성전자, AAPL…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-muted text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {results.length > 0 && !selected && (
              <div className="rounded-lg border border-border overflow-hidden" style={{ background: "var(--card)" }}>
                {results.map((r) => (
                  <button
                    key={r.ticker}
                    type="button"
                    onClick={() => { setSelected(r); setQuery(r.name); setResults([]); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 transition-colors border-b last:border-0 text-left"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.ticker}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <div className="text-xs text-blue-400 bg-blue-500/10 rounded px-2 py-1">
                {selected.name} ({selected.ticker}) 선택됨
              </div>
            )}
          </div>
        )}

        {/* 매도: 종목 정보 */}
        {isSell && (
          <div className="bg-muted rounded-lg px-3 py-2 text-sm">
            <div className="font-medium">{sellTarget!.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {sellTarget!.ticker} · 보유 {sellTarget!.quantity}주 · 평균 {formatNumber(sellTarget!.avg_price)}
            </div>
          </div>
        )}

        {/* 현재가 */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">현재가</span>
          {quoteLoading
            ? <Loader2 size={13} className="animate-spin text-muted-foreground" />
            : <span className="font-bold tabular-nums">{quotePrice ? formatNumber(quotePrice) : "-"}</span>}
        </div>

        {/* 수량 */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">수량 (주)</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min={1}
            max={isSell ? sellTarget?.quantity : undefined}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {isSell && qty > (sellTarget?.quantity ?? 0) && (
            <p className="text-xs text-red-400">보유 수량({sellTarget?.quantity}주) 초과</p>
          )}
          {!isSell && total > cash && qty > 0 && (
            <p className="text-xs text-red-400">잔금 부족 (보유 현금: {formatNumber(cash)}원)</p>
          )}
        </div>

        {/* 예상 금액 */}
        {quotePrice && qty > 0 && (
          <div className="rounded-lg bg-muted px-3 py-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">예상 {isSell ? "수령" : "필요"} 금액</span>
              <span className="font-bold tabular-nums">{formatNumber(total)}원</span>
            </div>
            {!isSell && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">주문 후 잔금</span>
                <span className={total > cash ? "text-red-400" : "text-green-400"}>
                  {formatNumber(cash - total)}원
                </span>
              </div>
            )}
          </div>
        )}

        {/* 버튼 */}
        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={submitting} className="flex-1">취소</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`flex-1 ${isSell ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            {submitting
              ? <><Loader2 size={13} className="animate-spin" /> 처리 중…</>
              : `${isSell ? "매도" : "매수"} 확인`}
          </Button>
        </div>
      </div>
    </div>
  );
}
