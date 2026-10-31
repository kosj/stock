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
  Plus, RotateCcw, Gamepad2, Bot, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Pencil,
} from "lucide-react";
import Link from "next/link";
import type { periodPerformance } from "@/lib/core/performance";

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
  cash:                number;
  stock_value:         number;
  total_value:         number;
  total_pnl:           number;
  total_pnl_pct:       number | null;
  account_epoch: number;
  realized_pnl: number;
  unrealized_pnl: number;
  recorded_costs: number;
  cost_history_complete: boolean;
  baseline_at: string;
  valuation_stale: boolean;
  auto_trade_capital:  number | null;
  positions:           Position[];
  performance?: ReturnType<typeof periodPerformance>;
};

type AutoTradeDetail = {
  ticker:  string;
  name:    string;
  action:  "BUY" | "SELL" | "SKIP";
  reason:  string;
  qty?:    number;
  price?:  number;
  error?: string;
  execution_mode?: "risk" | "rebalance";
};

type AutoTradeLog = {
  id:               number;
  run_at:           string;
  tickers_analyzed: number;
  trades_buy:       number;
  trades_sell:      number;
  skipped:          number;
  details:          AutoTradeDetail[] | string;
  error?:           string;
};

export function MockTradingPage() {
  const [buyOpen,    setBuyOpen]    = useState(false);
  const [sellTarget, setSellTarget] = useState<Position | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [cashEditing, setCashEditing] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [logOffset, setLogOffset] = useState(0);

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

  const {
    data: logPage,
    error: logError,
    mutate: mutateAutoLogs,
  } = useSWR<{ items: AutoTradeLog[]; nextOffset: number | null }>(["mock-auto-trade-logs", logOffset], () => api.mock.autoTradeLogs(logOffset, 5) as Promise<{ items: AutoTradeLog[]; nextOffset: number | null }>, {
    revalidateOnFocus: false,
  });
  const autoLogs = logPage?.items ?? [];

  async function handleSaveCash() {
    const cash = Number(cashInput.replace(/,/g, ""));
    if (isNaN(cash) || cash < 0) {
      toast.error("올바른 금액을 입력해주세요.");
      return;
    }
    setCashSaving(true);
    try {
      await api.mock.setCash(cash);
      await mutateAccount();
      setCashEditing(false);
      toast.success(`보유 현금이 ${formatNumber(cash)}원으로 조정됐습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setCashSaving(false);
    }
  }

  async function handleAutoTrade() {
    setAutoRunning(true);
    const toastId = toast.loading("자동매매 실행 중… (Top20 Sell-First → Buy-Next)");
    try {
      const result = await api.mock.autoTrade() as { trades_buy: number; trades_sell: number; skipped: number; error?: string };
      await Promise.all([mutateAccount(), mutateTrades(), mutateAutoLogs()]);
      const msg = `매수 ${result.trades_buy}건 · 매도 ${result.trades_sell}건 · 스킵 ${result.skipped}건`;
      if (result.error) toast.error(`자동매매 오류: ${result.error}`, { id: toastId });
      else toast.success(`자동매매 완료 — ${msg}`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "자동매매 실패", { id: toastId });
    } finally {
      setAutoRunning(false);
    }
  }

  async function handleReset() {
    if (!confirm("계좌를 초기화하면 모든 보유 종목과 거래 내역이 사라집니다.\n1,000만원으로 다시 시작하시겠습니까?")) return;
    try {
      await api.mock.reset();
      setLogOffset(0);
      await Promise.all([mutateAccount(), mutateTrades(), mutateAutoLogs()]);
      toast.success("계좌가 초기화되었습니다. (1,000만원)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "초기화 실패");
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
          {/* 보유 현금 — 인라인 편집 가능 */}
          <Card className="p-3 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">보유 현금</span>
              {!cashEditing && (
                <button
                  onClick={() => { setCashInput(String(a.cash)); setCashEditing(true); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="현금 조정"
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>
            {cashEditing ? (
              <div className="mt-1 space-y-1.5">
                <input
                  type="number"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveCash(); if (e.key === "Escape") setCashEditing(false); }}
                  className="w-full px-2 py-1 rounded border border-border bg-muted text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                  min={0}
                />
                <div className="flex gap-1">
                  <button
                    onClick={handleSaveCash}
                    disabled={cashSaving}
                    className="flex-1 text-xs py-0.5 rounded bg-blue-600/80 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
                  >
                    {cashSaving ? "저장 중…" : "저장"}
                  </button>
                  <button
                    onClick={() => setCashEditing(false)}
                    className="flex-1 text-xs py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-lg font-bold mt-0.5 tabular-nums truncate">{formatNumber(a.cash)}원</div>
            )}
          </Card>

          {/* 나머지 카드 */}
          {[
            { label: "주식 평가",   value: `${formatNumber(a.stock_value)}원` },
            { label: "총 평가금액", value: `${formatNumber(a.total_value)}원` },
            {
              label: "장부 기준 손익",
              value: `${a.total_pnl >= 0 ? "+" : ""}${formatNumber(a.total_pnl)}원`,
              sub:   a.total_pnl_pct === null ? "수익률 산정 불가" : formatPercent(a.total_pnl_pct),
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

      {a && <div className="text-xs text-muted-foreground space-y-1">
        {a.performance?.available ? <div className="rounded-lg border p-3 space-y-1">
          <p className="font-medium text-foreground">관측기간 수익률 {formatPercent(a.performance.returnPct)}</p>
          <p>{new Date(a.performance.from).toLocaleString("ko-KR")} ~ {new Date(a.performance.to).toLocaleString("ko-KR")} · 관측 {a.performance.samples}회</p>
          <p>입출금 시점을 반영한 Modified Dietz 수익률입니다. 과거 장부 기준 손익과 계산 기간이 다릅니다.</p>
          <p>{a.performance.benchmarkPct === null ? "동일 시각 KOSPI 관측값이 없어 비교를 보류합니다."
            : `같은 관측기간 KOSPI ${formatPercent(a.performance.benchmarkPct)}${a.performance.excessPct === null ? " · 입출금이 있어 단순 초과수익률을 표시하지 않습니다." : ` · 차이 ${formatPercent(a.performance.excessPct)}p`}`}</p>
        </div> : <p>{a.performance?.reason ?? "성과 관측 데이터 준비 중"}</p>}
        <p>실현손익 {formatNumber(a.realized_pnl)}원 · 미실현손익 {formatNumber(a.unrealized_pnl)}원 · 기록된 거래비용 {formatNumber(a.recorded_costs)}원</p>
        <p>장부 기준: {new Date(a.baseline_at).toLocaleString("ko-KR")} 취득원가 + 현금 + 순입출금. 최초 투자 이후 전체 수익률이나 해당 날짜 이후의 기간 수익률은 아닙니다.</p>
        {!a.cost_history_complete && <p>일부 과거 거래의 비용 내역이 없습니다.</p>}
        {a.valuation_stale && <p className="text-amber-400">일부 시세 누락: 평단가로 표시한 잠정 평가입니다.</p>}
      </div>}

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

      {/* 자동매매 패널 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-blue-400" />
            <CardTitle>자동매매</CardTitle>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Top20 · 최대 5종목</span>
          </div>
          <Button
            size="sm"
            onClick={handleAutoTrade}
            disabled={autoRunning}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {autoRunning
              ? <><RefreshCw size={13} className="animate-spin" /> 분석 중…</>
              : <><Bot size={13} /> 지금 실행</>}
          </Button>
        </CardHeader>

        {/* 전략 설명 */}
        <div className="px-5 pb-4 space-y-3">
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/40 rounded-lg px-3 py-2.5">
            <div><span className="text-green-400 font-medium">매수 조건:</span> 검증된 최신 주간 추천 상위 5위 이내 — 빈 슬롯만큼 균등 비중 매수</div>
            <div><span className="text-red-400 font-medium">매도 조건:</span> 손절 −5% 이하 · 순위 15위 초과 또는 추천 이탈 → 전량 청산</div>
            <div><span className="text-blue-400 font-medium">포지션:</span> 최대 5종목, 슬롯별 예산에 종목·섹터별 금액 비중 한도 적용</div>
            <div>장중 손절 점검은 시세가 유효할 때 수행합니다. 예약 지연·시세 장애로 −5% 체결가격이 보장되지는 않습니다.</div>
          </div>

          {/* 실행 이력 */}
          {logError && <p className="text-xs text-red-400">실행 이력 조회 실패. 새로고침 후 다시 확인하세요.</p>}
          {!logError && logPage && autoLogs.length === 0 && <p className="text-xs text-muted-foreground">실행 이력이 없습니다.</p>}
          <div className="flex gap-2 text-xs">
            <Button variant="ghost" disabled={logOffset === 0} onClick={() => setLogOffset(Math.max(0, logOffset - 5))}>이전 이력</Button>
            <Button variant="ghost" disabled={logPage?.nextOffset == null} onClick={() => setLogOffset(logPage?.nextOffset ?? logOffset)}>다음 이력</Button>
          </div>
          {(autoLogs ?? []).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">최근 실행 이력</div>
              {(autoLogs ?? []).slice(0, 5).map((log) => {
                const details: AutoTradeDetail[] = typeof log.details === "string"
                  ? JSON.parse(log.details || "[]")
                  : log.details ?? [];
                const isExpanded = expandedLog === log.id;

                return (
                  <div key={log.id} className="rounded-lg border text-xs" style={{ borderColor: "var(--border)" }}>
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/3 transition-colors"
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-muted-foreground whitespace-nowrap">
                          {new Date(log.run_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {details[0]?.execution_mode === "risk" ? " · 손절 점검" : details[0]?.execution_mode === "rebalance" ? " · 리밸런싱" : ""}
                        </span>
                        {log.error ? (
                          <span className="text-red-400 flex items-center gap-1"><XCircle size={11} /> 오류</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="text-green-400">매수 {log.trades_buy}</span>
                            <span className="text-red-400">매도 {log.trades_sell}</span>
                            <span className="text-muted-foreground">스킵 {log.skipped}</span>
                          </span>
                        )}
                      </div>
                      {isExpanded ? <ChevronUp size={13} className="text-muted-foreground shrink-0" /> : <ChevronDown size={13} className="text-muted-foreground shrink-0" />}
                    </button>

                    {isExpanded && (
                      <div className="border-t px-3 py-2 space-y-1" style={{ borderColor: "var(--border)" }}>
                        {log.error && <p className="text-red-400">{log.error}</p>}
                        {details.filter(d => d.action === "SKIP" && d.error).map((d, i) => (
                          <p key={`issue-${i}`} className="text-amber-400">{d.name}: {d.reason} ({d.error})</p>
                        ))}
                        {details.filter(d => d.action !== "SKIP").map((d, i) => (
                          <div key={i} className="flex items-start gap-2">
                            {d.action === "BUY"
                              ? <CheckCircle size={11} className="text-green-400 mt-0.5 shrink-0" />
                              : <XCircle size={11} className="text-red-400 mt-0.5 shrink-0" />}
                            <div className="min-w-0">
                              <span className={`font-medium ${d.action === "BUY" ? "text-green-400" : "text-red-400"}`}>
                                [{d.action}] {d.name}
                              </span>
                              {d.qty && d.price && (
                                <span className="text-muted-foreground ml-1">{d.qty}주 @ {formatNumber(d.price)}</span>
                              )}
                              <div className="text-muted-foreground/70 truncate">{d.reason}</div>
                            </div>
                          </div>
                        ))}
                        {details.filter(d => d.action === "SKIP").length > 0 && (
                          <div className="text-muted-foreground/50">
                            매매 보류 {details.filter(d => d.action === "SKIP").length}건
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* 거래 내역 */}
      <Card>
        <CardHeader><CardTitle>거래 내역</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
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
                    <div className="font-medium">{t.name}</div>
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
          accountEpoch={a.account_epoch}
          onClose={() => setBuyOpen(false)}
          onTraded={onTraded}
        />
      )}

      {/* 매도 모달 */}
      {sellTarget && a && (
        <MockTradeModal
          mode="SELL"
          cash={a.cash}
          accountEpoch={a.account_epoch}
          sellTarget={sellTarget}
          onClose={() => setSellTarget(null)}
          onTraded={onTraded}
        />
      )}
    </div>
  );
}
