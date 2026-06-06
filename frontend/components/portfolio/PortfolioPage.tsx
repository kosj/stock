"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import { Plus, Trash2, Pencil, RefreshCw, Zap, Check, Building2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { PositionModal } from "./PositionModal";
import { PortfolioCreateModal } from "./PortfolioCreateModal";
import { BrokerHoldingsModal } from "./BrokerHoldingsModal";
import { PositionActionBadge } from "./PositionActionBadge";
import { toast } from "sonner";
import { useRealtimePrices } from "@/lib/websocket";
import { BrokerConfigManager } from "@/lib/apiConfig";
import type { BrokerHolding } from "@/lib/server/providers";
import type { PositionAnalysisResult } from "@/lib/server/position-manager-service";

// summary 캐시에서 positions 변경 후 합계 재계산 (Yahoo 재조회 없이 로컬 계산)
function recalcTotals(cur: any): any {
  const positions: any[] = cur.positions ?? [];
  const total_invested = positions.reduce((s: number, p: any) => s + (p.cost_basis  ?? p.avg_price    * p.quantity), 0);
  const total_value    = positions.reduce((s: number, p: any) => s + (p.total_value ?? p.current_price * p.quantity), 0);
  const total_pnl         = total_value - total_invested;
  const total_pnl_percent = total_invested > 0 ? (total_pnl / total_invested) * 100 : 0;
  return { ...cur, total_invested, total_value, total_pnl, total_pnl_percent };
}

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

  // 피라미딩 완료 표시 — 로딩 중인 position_id Set
  const [pyramidingIds, setPyramidingIds] = useState<Set<number>>(new Set());

  // 증권사 보유종목 가져오기 상태
  const [showBrokerHoldings, setShowBrokerHoldings] = useState(false);
  const [brokerCreds, setBrokerCreds] = useState<{ type: string; appKey: string; appSecret: string } | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const autoSyncedRef = useRef(false); // 자동 동기화는 세션당 1회만

  // DB 기반 브로커 설정 확인
  // ※ BrokerSettingsPage와 동일한 fetcher + 동일한 반환 형식(string[])으로 SWR 캐시 공유
  const { data: configuredBrokers } = useSWR<string[]>(
    "broker-settings-configured",
    () => fetch("/api/settings/broker")
      .then((r) => r.ok ? r.json() : { configured: [] })
      .then((d: { configured?: string[] }) => d.configured ?? []),
    { revalidateOnFocus: false },
  );
  const hasBrokerConfig = (configuredBrokers?.length ?? 0) > 0;

  // 실시간 시세용 크레덴셜은 localStorage에서 유지 (기존 호환)
  useEffect(() => {
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

  // ── 포지션 관리 분석 (ATR 기반 손절·익절·피라미딩) ──────────────────────
  const {
    data: positionAnalysisData,
    mutate: mutatePositionAnalysis,
  } = useSWR<{ results: PositionAnalysisResult[] }>(
    portfolioId ? `position-analysis-${portfolioId}` : null,
    () => api.portfolio.positionAnalysis(portfolioId) as Promise<{ results: PositionAnalysisResult[] }>,
    {
      revalidateOnFocus: false,
      refreshInterval:   300_000,   // 5분
      dedupingInterval:  60_000,
    },
  );
  const positionAnalysisMap = new Map<number, PositionAnalysisResult>(
    positionAnalysisData?.results?.map((r) => [r.position_id, r]) ?? [],
  );

  // 피라미딩 완료 표시 핸들러 — position.notes에 "[pyramided]" 추가
  async function handleMarkPyramided(posId: number, currentNotes: string | null) {
    setPyramidingIds((prev) => new Set([...prev, posId]));
    try {
      const newNotes = currentNotes
        ? `${currentNotes} [pyramided]`
        : "[pyramided]";
      await api.portfolio.updatePosition(posId, { notes: newNotes });
      await Promise.all([mutateSummary(), mutatePositionAnalysis()]);
      toast.success("피라미딩 완료 표시 — 이 종목은 더 이상 추가 매수를 추천하지 않습니다.");
    } catch (err: any) {
      toast.error(err.message ?? "처리 실패");
    } finally {
      setPyramidingIds((prev) => {
        const next = new Set(prev);
        next.delete(posId);
        return next;
      });
    }
  }

  // 포트폴리오 변경 시 요약 데이터 재갱신
  // ※ autoSyncedRef는 여기서 초기화하지 않음 — 포트폴리오를 바꿀 때마다 자동동기화가
  //   재실행되면 새 포트폴리오에 기존 KIS 보유종목 전체가 복사되는 버그 발생
  useEffect(() => {
    if (portfolioId) {
      mutateSummary();
    }
  }, [portfolioId, mutateSummary]);

  // 자동 동기화: 브로커 연동 + 포지션 0개 → 보유종목 자동 가져오기
  const s = summary as any;
  useEffect(() => {
    if (
      !portfolioId             ||   // 포트폴리오 미선택
      !hasBrokerConfig         ||   // 브로커 미연동
      autoSyncedRef.current    ||   // 이미 동기화함
      autoSyncing              ||   // 동기화 진행 중
      s === undefined          ||   // 아직 로딩 중
      (s?.positions?.length ?? -1) !== 0  // 포지션 있음
    ) return;

    autoSyncedRef.current = true;

    (async () => {
      setAutoSyncing(true);
      const toastId = toast.loading("증권사 보유종목 자동 동기화 중…");
      try {
        const res  = await fetch("/api/broker/holdings", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.holdings?.length) {
          toast.dismiss(toastId);
          return;
        }

        const holdings: BrokerHolding[] = data.holdings;
        const today = new Date().toLocaleDateString("ko-KR");

        await Promise.allSettled(
          holdings.map((h) =>
            api.portfolio.addPosition(portfolioId, {
              ticker:      h.ticker,
              name:        h.name,
              quantity:    h.quantity,
              avg_price:   h.avg_price,
              stop_loss:   null,
              take_profit: null,
              strategy:    null,
              notes:       `한국투자증권 연동 (${today})`,
            }),
          ),
        );

        await mutateSummary();
        toast.success(`${holdings.length}개 보유종목 자동 동기화 완료`, { id: toastId });
      } catch {
        toast.dismiss(toastId);
      } finally {
        setAutoSyncing(false);
      }
    })();
  }, [portfolioId, hasBrokerConfig, s, autoSyncing, mutateSummary]);

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
    if (showAddPos || editPosition) return; // 종목 추가/수정 모달 중엔 탭 전환 차단
    setSelectedId(id);
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
      // 삭제된 종목 제거 + 합계 로컬 재계산 — Yahoo 재조회 없음
      mutateSummary(
        (cur: any) => cur ? recalcTotals({ ...cur, positions: (cur.positions ?? []).filter((p: any) => p.position_id !== posId) }) : cur,
        { revalidate: false },
      );
      toast.success("종목 삭제 완료");
    } catch (err: any) {
      await mutateSummary();
      toast.error(err.message ?? "삭제 실패");
    }
  }

  async function handlePortfolioCreated() {
    try {
      const updated = await mutatePortfolios() as any[];
      // 새로 생성된 포트폴리오(최신순 첫 번째)를 자동 선택
      if (updated && updated.length > 0) {
        setSelectedId(updated[0].id);
      }
      setShowCreate(false);
    } catch (err: any) {
      toast.error(err.message ?? "포트폴리오 목록 갱신 실패");
    }
  }

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
              <Card key={label} className="p-3 min-w-0">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={`text-lg font-bold mt-0.5 tabular-nums truncate ${color ?? ""}`}>{value}</div>
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
              <table className="text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    {["종목", "수량", "단가 / 현재가", "손익금 / 수익률", "포지션관리", "손절/목표", ""].map((h) => (
                      <th key={h} className="text-left text-xs text-muted-foreground py-2 px-3 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...(s.positions ?? [])].sort((a: any, b: any) => {
                    const priceA = (rt[a.ticker]?.price ?? a.current_price);
                    const priceB = (rt[b.ticker]?.price ?? b.current_price);
                    const pnlA = ((priceA - a.avg_price) / a.avg_price) * 100;
                    const pnlB = ((priceB - b.avg_price) / b.avg_price) * 100;
                    return pnlB - pnlA;
                  }).map((pos: any) => {
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
                            href={`/market/${pos.ticker}?avg_price=${pos.avg_price}&quantity=${pos.quantity}&portfolio_id=${portfolioId}&position_id=${pos.position_id}`}
                            className="hover:text-blue-400 transition-colors"
                          >
                            <div className="font-medium">{pos.name}</div>
                            <div className="text-xs text-muted-foreground">{pos.ticker}</div>
                          </Link>
                        </td>
                        <td className="py-3 px-3 tabular-nums">{formatNumber(pos.quantity)}</td>
                        <td className="py-3 px-3 tabular-nums">
                          <div className="text-xs text-muted-foreground">{formatNumber(pos.avg_price)}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="font-medium">{formatNumber(currentPrice)}</span>
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
                        <td className="py-3 px-3 tabular-nums">
                          <div className={`font-medium ${colorByChange(pnlAmt)}`}>
                            {pnlAmt >= 0 ? "+" : ""}{formatNumber(pnlAmt)}
                          </div>
                          <div className={`text-xs ${colorByChange(pnlPct)}`}>
                            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                          </div>
                        </td>
                        {/* 포지션 관리 — ATR 기반 손절·익절·피라미딩 판단 */}
                        <td className="py-3 px-3">
                          {(() => {
                            const pa = positionAnalysisMap.get(pos.position_id);
                            if (!pa) {
                              return (
                                <span className="text-xs text-muted-foreground/30 animate-pulse">
                                  분석 중…
                                </span>
                              );
                            }
                            return (
                              <PositionActionBadge
                                result={pa}
                                onMarkPyramided={
                                  pa.action.type === "BUY"
                                    ? () => handleMarkPyramided(pos.position_id, pos.notes ?? null)
                                    : undefined
                                }
                                markingPyramided={pyramidingIds.has(pos.position_id)}
                              />
                            );
                          })()}
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
                  {autoSyncing ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw size={18} className="animate-spin text-blue-400" />
                      <span className="text-blue-400">증권사 보유종목 자동 동기화 중…</span>
                    </div>
                  ) : (
                    <>보유 종목이 없습니다. &quot;종목 추가&quot; 버튼으로 추가하세요.</>
                  )}
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
          onSaved={(data) => {
            setShowAddPos(false);
            setEditPosition(null);

            const tempId = -Date.now(); // 추가 시 임시 ID (클로저 캡처)

            // 낙관적 업데이트: 즉시 캐시 반영
            mutateSummary((cur: any) => {
              if (!cur) return cur;
              if (data.position_id) {
                // 수정: 해당 포지션만 갱신 + 합계 재계산
                const positions = (cur.positions ?? []).map((p: any) =>
                  p.position_id === data.position_id ? { ...p, ...data } : p,
                );
                return recalcTotals({ ...cur, positions });
              }
              // 추가: 임시 포지션 삽입 + 합계 재계산
              const optimistic = {
                position_id: tempId,
                current_price: data.avg_price,
                cost_basis: data.avg_price * data.quantity,
                total_value: data.avg_price * data.quantity,
                pnl_amount: 0,
                pnl_percent: 0,
                is_near_stop: false,
                is_near_target: false,
                price_available: false,
                ...data,
              };
              return recalcTotals({ ...cur, positions: [...(cur.positions ?? []), optimistic] });
            }, { revalidate: false });

            (async () => {
              try {
                if (data.position_id) {
                  // 수정: 서버 저장만, Yahoo 재조회 없음
                  await api.portfolio.updatePosition(data.position_id, data);
                  toast.success("종목 수정 완료");
                } else {
                  // 추가: 서버 저장 + 신규 종목 시세만 조회 (기존 종목 재조회 없음)
                  const [savedPos, quote] = await Promise.all([
                    api.portfolio.addPosition(portfolioId, data) as Promise<any>,
                    api.market.quote(data.ticker).catch(() => null) as Promise<any>,
                  ]);
                  toast.success("종목 추가 완료");

                  const realId   = savedPos?.id ?? tempId;
                  const price    = quote?.price ?? data.avg_price;
                  const hasPrice = !!quote?.price;

                  // 임시 ID → 실제 ID + 실제 시세 반영 + 합계 재계산
                  mutateSummary((cur: any) => {
                    if (!cur) return cur;
                    const positions = (cur.positions ?? []).map((p: any) =>
                      p.position_id === tempId
                        ? {
                            ...p,
                            position_id:     realId,
                            current_price:   price,
                            price_available: hasPrice,
                            total_value:     price * p.quantity,
                            pnl_amount:      Math.round((price - p.avg_price) * p.quantity),
                            pnl_percent:     p.avg_price ? Math.round(((price - p.avg_price) / p.avg_price) * 10000) / 100 : 0,
                          }
                        : p,
                    );
                    return recalcTotals({ ...cur, positions });
                  }, { revalidate: false });
                }
              } catch (err: any) {
                toast.error(err.message ?? "저장 실패 — 다시 시도해주세요");
                mutateSummary(); // 실패 시 서버 상태로 복원
              }
            })();
          }}
        />
      )}

      {/* 증권사 보유종목 가져오기 모달 */}
      {showBrokerHoldings && portfolioId && (
        <BrokerHoldingsModal
          portfolioId={portfolioId}
          onClose={() => setShowBrokerHoldings(false)}
          onImported={() => { mutateSummary(undefined, { revalidate: true }); }}
        />
      )}
    </div>
  );
}
