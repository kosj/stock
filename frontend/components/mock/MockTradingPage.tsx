"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import { MockTradeModal } from "./MockTradeModal";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw,
  Plus, RotateCcw, Gamepad2,
} from "lucide-react";
import Link from "next/link";

type Position = {
  id:            number;
  ticker:        string;
  name:          string;
  quantity:      number;
  avg_price:     number;
  current_price: number;
  pnl_amount:    number;
  pnl_pct:       number;
};

type Trade = {
  id:           number;
  ticker:       string;
  name:         string;
  trade_type:   "BUY" | "SELL";
  quantity:     number;
  price:        number;
  total_amount: number;
  created_at:   string;
};

type Account = {
  cash:          number;
  stock_value:   number;
  total_value:   number;
  total_pnl:     number;
  total_pnl_pct: number;
  positions:     Position[];
};

export function MockTradingPage() {
  const [buyOpen,    setBuyOpen]    = useState(false);
  const [sellTarget, setSellTarget] = useState<Position | null>(null);

  const {
    data: account,
    isLoading: accountLoading,
    mutate: mutateAccount,
  } = useSWR<Account>("mock-account", () => api.mock.account() as Promise<Account>, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  });

  const {
    data: trades,
    isLoading: tradesLoading,
    mutate: mutateTrades,
  } = useSWR<Trade[]>("mock-trades", () => api.mock.trades() as Promise<Trade[]>, {
    revalidateOnFocus: false,
  });

  async function handleReset() {
    if (!confirm("계좌를 초기화하면 모든 보유 종목과 거래 내역이 사라집니다.\n1,000만원으로 다시 시작하시겠습니까?")) return;
    try {
      await api.mock.reset();
      await Promise.all([mutateAccount(), mutateTrades()]);
      toast.success("계좌가 초기화되었습니다. (1,000만원)");
    } catch (err: any) {
      toast.error(err.message ?? "초기화 실패");
    }
  }

  function onTraded() {
    mutateAccount();
    mutateTrades();
  }

  const a = account;
  const positions = a?.positions ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gamepad2 size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">모의 투자</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { mutateAccount(); mutateTrades(); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={13} />
            새로고침
          </button>
          <Button size="sm" variant="ghost" onClick={handleReset} className="text-muted-foreground hover:text-red-400 text-xs">
            <RotateCcw size={13} />
            계좌 초기화
          </Button>
        </div>
      </div>

      {/* 계좌 요약 */}
      {accountLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : a && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "보유 현금",  value: `${formatNumber(a.cash)}원` },
            { label: "주식 평가",  value: `${formatNumber(a.stock_value)}원` },
            { label: "총 평가금액", value: `${formatNumber(a.total_value)}원` },
            {
              label: "총 손익",
              value: `${a.total_pnl >= 0 ? "+" : ""}${formatNumber(a.total_pnl)}원`,
              sub:   formatPercent(a.total_pnl_pct),
              color: colorByChange(a.total_pnl),
            },
          ].map(({ label, value, sub, color }) => (
            <Card key={label} className="p-3 min-w-0">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className={`text-lg font-bold mt-0.5 tabular-nums truncate ${color ?? ""}`}>{value}</div>
              {sub && <div className={`text-xs tabular-nums ${color ?? ""}`}>{sub}</div>}
            </Card>
          ))}
        </div>
      )}

      {/* 보유 종목 */}
      <Card>
        <CardHeader>
          <CardTitle>보유 종목</CardTitle>
          <Button size="sm" onClick={() => setBuyOpen(true)}>
            <Plus size={14} /> 종목 매수
          </Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["종목", "수량", "평균단가", "현재가", "손익", "수익률", ""].map((h) => (
                  <th key={h} className="text-left text-xs text-muted-foreground py-2 px-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const Icon = pos.pnl_pct > 0 ? TrendingUp : pos.pnl_pct < 0 ? TrendingDown : Minus;
                return (
                  <tr key={pos.id} className="border-b hover:bg-white/2 transition-colors" style={{ borderColor: "var(--border)" }}>
                    <td className="py-3 px-3">
                      <Link href={`/market/${pos.ticker}`} className="hover:text-blue-400 transition-colors">
                        <div className="font-medium">{pos.name}</div>
                        <div className="text-xs text-muted-foreground">{pos.ticker}</div>
                      </Link>
                    </td>
                    <td className="py-3 px-3 tabular-nums">{formatNumber(pos.quantity)}</td>
                    <td className="py-3 px-3 tabular-nums text-muted-foreground">{formatNumber(pos.avg_price)}</td>
                    <td className="py-3 px-3 tabular-nums font-medium">{formatNumber(pos.current_price)}</td>
                    <td className={`py-3 px-3 tabular-nums font-medium ${colorByChange(pos.pnl_amount)}`}>
                      {pos.pnl_amount >= 0 ? "+" : ""}{formatNumber(pos.pnl_amount)}
                    </td>
                    <td className={`py-3 px-3 tabular-nums ${colorByChange(pos.pnl_pct)}`}>
                      <div className="flex items-center gap-1">
                        <Icon size={11} />
                        {formatPercent(pos.pnl_pct)}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300 text-xs px-2"
                        onClick={() => setSellTarget(pos)}
                      >
                        매도
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!accountLoading && positions.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              보유 종목이 없습니다. &quot;종목 매수&quot; 버튼으로 시작하세요.
            </div>
          )}
        </div>
      </Card>

      {/* 거래 내역 */}
      <Card>
        <CardHeader><CardTitle>거래 내역</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["일시", "종목", "구분", "수량", "단가", "금액"].map((h) => (
                  <th key={h} className="text-left text-xs text-muted-foreground py-2 px-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(trades ?? []).map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-white/2 transition-colors" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(t.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium truncate max-w-[120px]">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.ticker}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      t.trade_type === "BUY"
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-red-500/15 text-red-400"
                    }`}>
                      {t.trade_type === "BUY" ? "매수" : "매도"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 tabular-nums">{formatNumber(t.quantity)}</td>
                  <td className="py-2.5 px-3 tabular-nums text-muted-foreground">{formatNumber(t.price)}</td>
                  <td className="py-2.5 px-3 tabular-nums font-medium">{formatNumber(t.total_amount)}원</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tradesLoading && (trades ?? []).length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-sm">거래 내역이 없습니다.</div>
          )}
        </div>
      </Card>

      {/* 매수 모달 */}
      {buyOpen && a && (
        <MockTradeModal
          mode="BUY"
          cash={a.cash}
          onClose={() => setBuyOpen(false)}
          onTraded={onTraded}
        />
      )}

      {/* 매도 모달 */}
      {sellTarget && a && (
        <MockTradeModal
          mode="SELL"
          cash={a.cash}
          sellTarget={sellTarget}
          onClose={() => setSellTarget(null)}
          onTraded={onTraded}
        />
      )}
    </div>
  );
}
