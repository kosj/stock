"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import { Plus, Trash2, Pencil, RefreshCw, TrendingUp, TrendingDown, Zap, Check, Building2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { PositionModal } from "./PositionModal";
import { PortfolioCreateModal } from "./PortfolioCreateModal";
import { BrokerHoldingsModal } from "./BrokerHoldingsModal";
import { PullbackBadge } from "./PullbackBadge";
import { ProfitTakingBadge } from "./ProfitTakingBadge";
import { StopLossBadge } from "./StopLossBadge";
import { toast } from "sonner";
import { useRealtimePrices } from "@/lib/websocket";
import { BrokerConfigManager } from "@/lib/apiConfig";
import type { PullbackResult } from "@/lib/server/pullback-analysis";
import type { ProfitTakingResult } from "@/lib/server/profit-taking";
import type { StopLossResult } from "@/lib/server/stop-loss-signal";

export function PortfolioPage() {
  const { data: portfolios, mutate: mutatePortfolios } = useSWR("portfolios", () => api.portfolio.list());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editPosition, setEditPosition] = useState<any | null>(null);
  const [showAddPos, setShowAddPos] = useState(false);

  // 이름 편집 상태
  const [editingPortfolioId, setEditingPortfolioId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // AI 갱신 상태
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const autoFillAbortRef = useRef<AbortController | null>(null);

  // 증권사 보유종목 가져오기 상태
  const [showBrokerHoldings, setShowBrokerHoldings] = useState(false);
  const [hasBrokerConfig, setHasBrokerConfig] = useState(false);
  const [brokerCreds, setBrokerCreds] = useState<{ type: string; appKey: string; appSecret: string } | null>(null);

  // 브로커 설정 확인 + 크레덴셜 로드
  useEffect(() => {
    setHasBrokerConfig(BrokerConfigManager.getConfiguredBrokers().length > 0);
    BrokerConfigManager.getDefaultBrokerConfig().then((config) => {
      if (!config) return;
      setBrokerCreds({ type: config.type, appKey: config.credentials.appKey, appSecret: config.credentials.appSecret });
    });
  }, []);

  const portfolio = (portfolios as any[])?.find((p) => p.id === selectedId) ??
                    (portfolios as any[])?.[0];
  const portfolioId = portfolio?.id;

  const brokerKey = brokerCreds?.type ?? "none";
  const { data: summary, mutate: mutateSummary, isValidating } = useSWR(
    portfolioId ? `portfolio-summary-${portfolioId}-${brokerKey}` : null,
    () => api.portfolio.summary(portfolioId, brokerCreds),
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    },
  );

  const tickers = (summary as any)?.positions?.map((p: any) => p.ticker) ?? [];
  const rt = useRealtimePrices(tickers);

  // ── 눌림목 분석 ─────────────────────────────────────────────────────────────
  const { data: pullbackData } = useSWR<PullbackResult[]>(
    tickers.length > 0 ? `pullback-${tickers.join(",")}` : null,
    async () => {
      const res = await fetch("/api/analysis/pullback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 300_000,    // 5분마다 갱신
      dedupingInterval: 60_000,
    },
  );
  const pullbackMap = new Map<string, PullbackResult>(
    pullbackData?.map((r) => [r.ticker, r]) ?? [],
  );

  // ── 익절 시그널 분석 ──────────────────────────────────────────────────────
  const { data: profitTakingData } = useSWR<ProfitTakingResult[]>(
    tickers.length > 0 ? `profit-taking-${tickers.join(",")}` : null,
    async () => {
      const res = await fetch("/api/analysis/profit-taking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 300_000,
      dedupingInterval: 60_000,
    },
  );
  const profitTakingMap = new Map<string, ProfitTakingResult>(
    profitTakingData?.map((r) => [r.ticker, r]) ?? [],
  );

  // ── 손절 시그널 분석 ──────────────────────────────────────────────────────
  const { data: stopLossData } = useSWR<StopLossResult[]>(
    tickers.length > 0 ? `stop-loss-${tickers.join(",")}` : null,
    async () => {
      const res = await fetch("/api/analysis/stop-loss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    {
      revalidateOnFocus: false,
      refreshInterval: 300_000,
      dedupingInterval: 60_000,
    },
  );
  const stopLossMap = new Map<string, StopLossResult>(
    stopLossData?.map((r) => [r.ticker, r]) ?? [],
  );

  // 포트폴리오 변경 시 요약 데이터 재갱신
  useEffect(() => {
    if (portfolioId) {
      mutateSummary();
    }
  }, [portfolioId, mutateSummary]);

  // ── AI 전체 갱신 ────────────────────────────────────────────────────────
  const autoFillPositions = useCallback(async (id: number) => {
    if (!id) return;
    // 이전 요청 취소
    autoFillAbortRef.current?.abort();
    const controller = new AbortController();
    autoFillAbortRef.current = controller;

    setAutoFillLoading(true);
    const toastId = toast.loading("AI 분석 중… 손절가·목표가·전략 갱신");
    try {
      await api.portfolio.autoFill(id);
      if (!controller.signal.aborted) {
        await mutateSummary();
        toast.success("AI 갱신 완료", { id: toastId });
      } else {
        toast.dismiss(toastId);
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        toast.error("AI 갱신 실패: " + (err.message ?? "오류"), { id: toastId });
      }
    } finally {
      if (!controller.signal.aborted) setAutoFillLoading(false);
    }
  }, [mutateSummary]);

  // ── 포트폴리오 탭 선택 ──────────────────────────────────────────────────
  function handleSelectPortfolio(id: number) {
    if (editingPortfolioId) return; // 이름 편집 중엔 탭 전환 무시
    setSelectedId(id);
    autoFillPositions(id);
  }

  // ── 이름 편집 ───────────────────────────────────────────────────────────
  function startRename(id: number, currentName: string) {
    setEditingPortfolioId(id);
    setEditingName(currentName);
    setTimeout(() => nameInputRef.current?.select(), 30);
  }

  async function commitRename() {
    if (!editingPortfolioId) return;
    const name = editingName.trim();
    if (!name) { setEditingPortfolioId(null); return; }
    try {
      await api.portfolio.update(editingPortfolioId, { name });
      await mutatePortfolios();
      toast.success("이름 변경 완료");
    } catch (err: any) {
      toast.error(err.message ?? "이름 변경 실패");
    } finally {
      setEditingPortfolioId(null);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") setEditingPortfolioId(null);
  }

  // ── 포트폴리오 삭제 ─────────────────────────────────────────────────────
  async function deletePortfolio(id: number) {
    if (!confirm("포트폴리오를 삭제하시겠습니까?")) return;
    try {
      // 낙관적 업데이트: 먼저 UI에서 제거
      const newPortfolios = (portfolios as any[])?.filter((p) => p.id !== id) ?? [];
      await mutatePortfolios(newPortfolios, false);

      // API 호출
      await api.portfolio.delete(id);

      // 삭제된 포트폴리오가 선택된 상태였으면 첫 번째 남은 포트폴리오 선택
      if (selectedId === id) {
        setSelectedId(newPortfolios[0]?.id ?? null);
        // 요약 데이터도 초기화
        await mutateSummary();
      }

      toast.success("삭제 완료");
    } catch (err: any) {
      // 오류 발생 시 원래 데이터로 복구
      await mutatePortfolios();
      toast.error(err.message ?? "삭제 실패");
    }
  }

  async function deletePosition(posId: number) {
    if (!confirm("종목을 삭제하시겠습니까?")) return;
    try {
      await api.portfolio.deletePosition(posId);
      // optimistic update: 목록에서 즉시 제거 후 서버 재검증
      await mutateSummary(
        (cur: any) =>
          cur
            ? {
                ...cur,
                positions: (cur.positions ?? []).filter(
                  (p: any) => p.position_id !== posId,
                ),
              }
            : cur,
        { revalidate: true },
      );
      toast.success("종목 삭제 완료");
    } catch (err: any) {
      await mutateSummary(); // 실패 시 서버 상태로 복원
      toast.error(err.message ?? "삭제 실패");
    }
  }

  async function handlePortfolioCreated() {
    try {
      await mutatePortfolios();
      setShowCreate(false);
    } catch (err: any) {
      toast.error(err.message ?? "포트폴리오 목록 갱신 실패");
    }
  }

  const s = summary as any;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">포트폴리오</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> 새 포트폴리오
        </Button>
      </div>

      {/* 포트폴리오 탭 */}
      {(portfolios as any[])?.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          {(portfolios as any[]).map((p) => {
            const isActive = portfolio?.id === p.id;
            const isEditingThis = editingPortfolioId === p.id;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => !isEditingThis && handleSelectPortfolio(p.id)}
              >
                {/* 이름 또는 인라인 편집 인풋 */}
                {isEditingThis ? (
                  <input
                    ref={nameInputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleRenameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent outline-none border-b border-white/60 min-w-0 w-24 text-sm"
                    autoFocus
                  />
                ) : (
                  <span className="truncate max-w-[120px]">{p.name}</span>
                )}

                {isActive && !isEditingThis && (
                  <>
                    {/* AI 갱신 로딩 표시 */}
                    {autoFillLoading && (
                      <Zap size={11} className="text-yellow-300 animate-pulse shrink-0" />
                    )}
                    {/* 이름 편집 버튼 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(p.id, p.name); }}
                      className="text-blue-200 hover:text-white shrink-0"
                      title="이름 변경"
                    >
                      <Pencil size={11} />
                    </button>
                    {/* 삭제 버튼 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePortfolio(p.id); }}
                      className="text-blue-200 hover:text-white shrink-0"
                      title="포트폴리오 삭제"
                    >
                      ×
                    </button>
                  </>
                )}

                {/* 이름 편집 확인 버튼 */}
                {isEditingThis && (
                  <button
                    onClick={(e) => { e.stopPropagation(); commitRename(); }}
                    className="text-green-300 hover:text-green-200 shrink-0"
                  >
                    <Check size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 요약 카드 */}
      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "투자원금",  value: `${formatNumber(s.total_invested)}원` },
              { label: "평가금액",  value: `${formatNumber(s.total_value)}원` },
              { label: "손익",      value: `${formatNumber(s.total_pnl)}원`,        color: colorByChange(s.total_pnl) },
              { label: "수익률",    value: formatPercent(s.total_pnl_percent),       color: colorByChange(s.total_pnl_percent) },
            ].map(({ label, value, color }) => (
              <Card key={label} className="p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={`text-xl font-bold mt-0.5 tabular-nums ${color ?? ""}`}>{value}</div>
              </Card>
            ))}
          </div>

          {/* 종목 테이블 */}
          <Card>
            <CardHeader>
              <CardTitle>보유 종목</CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => portfolioId && autoFillPositions(portfolioId)}
                  disabled={autoFillLoading}
                  title="AI 손절·목표·전략 갱신"
                >
                  <Zap size={13} className={autoFillLoading ? "animate-pulse text-yellow-400" : ""} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => mutateSummary()}
                  disabled={isValidating}
                  title="보유 종목 데이터 새로고침"
                >
                  <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} />
                </Button>
                {hasBrokerConfig && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowBrokerHoldings(true)}
                    title="증권사 보유종목 가져오기"
                  >
                    <Building2 size={13} />
                    <span className="hidden sm:inline ml-1">보유종목 가져오기</span>
                  </Button>
                )}
                <Button size="sm" onClick={() => setShowAddPos(true)}>
                  <Plus size={14} /> 종목 추가
                </Button>
              </div>
            </CardHeader>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    {["종목", "수량", "평균단가", "현재가", "손익금", "수익률", "눌림목", "손절신호", "익절신호", "손절/목표", "대응전략", ""].map((h) => (
                      <th key={h} className="text-left text-xs text-muted-foreground py-2 px-3 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.positions?.map((pos: any) => {
                    const live = rt[pos.ticker];
                    const currentPrice = live?.price ?? pos.current_price;
                    const costBasis = pos.avg_price * pos.quantity;
                    const totalVal = currentPrice * pos.quantity;
                    const pnlAmt = totalVal - costBasis;
                    const pnlPct = (pnlAmt / costBasis) * 100;
                    return (
                      <tr
                        key={pos.position_id}
                        className={`border-b transition-colors hover:bg-white/2 ${
                          pos.is_near_stop ? "bg-red-500/5" : pos.is_near_target ? "bg-green-500/5" : ""
                        }`}
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="py-3 px-3">
                          <Link
                            href={`/market/${pos.ticker}?avg_price=${pos.avg_price}&quantity=${pos.quantity}`}
                            className="hover:text-blue-400 transition-colors"
                          >
                            <div className="font-medium">{pos.name}</div>
                            <div className="text-xs text-muted-foreground">{pos.ticker}</div>
                          </Link>
                        </td>
                        <td className="py-3 px-3 tabular-nums">{formatNumber(pos.quantity)}</td>
                        <td className="py-3 px-3 tabular-nums">{formatNumber(pos.avg_price)}원</td>
                        <td className="py-3 px-3 tabular-nums">
                          <div className="flex items-center gap-1">
                            {formatNumber(currentPrice)}원
                            {live ? (
                              <span className={`text-xs ${colorByChange(live.change_pct)}`}>
                                {live.change_pct !== undefined ? formatPercent(live.change_pct) : ""}
                              </span>
                            ) : !pos.price_available && (
                              <span
                                className="text-yellow-500"
                                title="Yahoo Finance에서 시세를 조회할 수 없어 평균단가로 표시합니다"
                              >
                                <AlertTriangle size={11} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`py-3 px-3 tabular-nums font-medium ${colorByChange(pnlAmt)}`}>
                          {pnlAmt >= 0 ? "+" : ""}{formatNumber(pnlAmt)}원
                        </td>
                        <td className={`py-3 px-3 tabular-nums font-medium ${colorByChange(pnlPct)}`}>
                          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                        </td>
                        <td className="py-3 px-3">
                          {pullbackMap.has(pos.ticker) ? (
                            <PullbackBadge result={pullbackMap.get(pos.ticker)!} />
                          ) : (
                            <span className="text-xs text-muted-foreground/30 animate-pulse">분석 중…</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {pnlPct < 0 ? (
                            stopLossMap.has(pos.ticker) ? (
                              <StopLossBadge result={stopLossMap.get(pos.ticker)!} />
                            ) : (
                              <span className="text-xs text-muted-foreground/30 animate-pulse">분석 중…</span>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground/30">수익중</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {pnlPct > 0 ? (
                            profitTakingMap.has(pos.ticker) ? (
                              <ProfitTakingBadge result={profitTakingMap.get(pos.ticker)!} />
                            ) : (
                              <span className="text-xs text-muted-foreground/30 animate-pulse">분석 중…</span>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground/30">손실중</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-0.5">
                            {pos.stop_loss ? (
                              <span className={`text-xs text-red-400 ${pos.is_near_stop ? "font-semibold" : ""}`}>
                                손절 {formatNumber(pos.stop_loss)}{pos.is_near_stop && " ⚠"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">손절 -</span>
                            )}
                            {pos.take_profit ? (
                              <span className={`text-xs text-green-400 ${pos.is_near_target ? "font-semibold" : ""}`}>
                                목표 {formatNumber(pos.take_profit)}{pos.is_near_target && " ✓"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">목표 -</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 max-w-[180px]">
                          {pos.strategy ? (
                            <div className="text-xs text-muted-foreground truncate" title={pos.strategy}>
                              {pos.strategy}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex gap-1">
                            <button
                              onClick={() => setEditPosition(pos)}
                              className="p-1.5 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deletePosition(pos.position_id)}
                              className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!s.positions?.length && (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  보유 종목이 없습니다. &quot;종목 추가&quot; 버튼으로 추가하세요.
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* 로딩 중 */}
      {portfolios === undefined && (
        <div className="py-20 text-center text-muted-foreground text-sm animate-pulse">
          불러오는 중...
        </div>
      )}

      {/* 포트폴리오 없음 */}
      {portfolios !== undefined && !(portfolios as any[]).length && (
        <div className="py-20 text-center space-y-3">
          <p className="text-muted-foreground text-sm">포트폴리오가 없습니다.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            새 포트폴리오 만들기
          </button>
        </div>
      )}

      {/* 포트폴리오 생성 모달 */}
      {showCreate && (
        <PortfolioCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handlePortfolioCreated}
        />
      )}

      {/* 종목 추가/수정 모달 */}
      {(showAddPos || editPosition) && portfolioId && (
        <PositionModal
          portfolioId={portfolioId}
          initial={editPosition}
          onClose={() => { setShowAddPos(false); setEditPosition(null); }}
          onSaved={() => { mutateSummary(); setShowAddPos(false); setEditPosition(null); }}
        />
      )}

      {/* 증권사 보유종목 가져오기 모달 */}
      {showBrokerHoldings && portfolioId && (
        <BrokerHoldingsModal
          portfolioId={portfolioId}
          onClose={() => setShowBrokerHoldings(false)}
          onImported={() => { mutateSummary(); }}
        />
      )}
    </div>
  );
}
