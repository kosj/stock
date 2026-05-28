"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import { X, Download, Loader2, AlertCircle, Building2 } from "lucide-react";
import { toast } from "sonner";
import { BrokerConfigManager } from "@/lib/apiConfig";
import type { BrokerHolding } from "@/lib/server/providers";

interface Props {
  portfolioId: number;
  onClose: () => void;
  onImported: () => void;
}

export function BrokerHoldingsModal({ portfolioId, onClose, onImported }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-config">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [holdings, setHoldings] = useState<BrokerHolding[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const config = await BrokerConfigManager.getDefaultBrokerConfig();
        if (!config) {
          setStatus("no-config");
          return;
        }

        const res = await fetch("/api/broker/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config.credentials),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        setHoldings(data.holdings ?? []);
        // 기본으로 전체 선택
        setSelected(new Set((data.holdings ?? []).map((h: BrokerHolding) => h.ticker)));
        setStatus("ready");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }

    load();
  }, []);

  function toggleAll() {
    if (selected.size === holdings.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(holdings.map((h) => h.ticker)));
    }
  }

  function toggle(ticker: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  async function handleImport() {
    const targets = holdings.filter((h) => selected.has(h.ticker));
    if (!targets.length) {
      toast.error("가져올 종목을 선택해주세요.");
      return;
    }

    setImporting(true);

    // 현재 포트폴리오 positions 조회 → ticker별 기존 position id 매핑
    let existingPositions: any[] = [];
    try {
      existingPositions = (await api.portfolio.positions(portfolioId)) as any[];
    } catch { /* 조회 실패해도 전체 신규 추가로 진행 */ }
    const existingByTicker = new Map(existingPositions.map((p: any) => [p.ticker, p]));

    let addedCount = 0;
    let updatedCount = 0;
    let failCount = 0;
    const today = new Date().toLocaleDateString("ko-KR");

    for (const h of targets) {
      try {
        const existing = existingByTicker.get(h.ticker);
        if (existing) {
          // 기존 포지션: 수량·평균가 갱신 (손절/목표가·전략은 유지)
          await api.portfolio.updatePosition(existing.id, {
            quantity: h.quantity,
            avg_price: h.avg_price,
            notes: `한국투자증권 연동 갱신 (${today})`,
          });
          updatedCount++;
        } else {
          // 신규 포지션 추가
          await api.portfolio.addPosition(portfolioId, {
            ticker: h.ticker,
            name: h.name,
            quantity: h.quantity,
            avg_price: h.avg_price,
            stop_loss: null,
            take_profit: null,
            strategy: null,
            notes: `한국투자증권 연동 (${today})`,
          });
          addedCount++;
        }
      } catch {
        failCount++;
      }
    }

    setImporting(false);

    const successCount = addedCount + updatedCount;
    if (successCount > 0) {
      const parts: string[] = [];
      if (addedCount > 0) parts.push(`${addedCount}개 신규 추가`);
      if (updatedCount > 0) parts.push(`${updatedCount}개 갱신`);
      const msg = parts.join(", ");
      if (failCount === 0) toast.success(msg + " 완료");
      else toast.warning(`${msg} 완료, ${failCount}개 실패`);
      onImported();
      onClose();
    } else {
      toast.error("종목 추가/갱신에 실패했습니다.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-xl rounded-xl border flex flex-col"
        style={{ background: "var(--card)", borderColor: "var(--border)", maxHeight: "80vh" }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-blue-400" />
            <h2 className="text-base font-semibold">증권사 보유종목 가져오기</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* 로딩 */}
          {status === "loading" && (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">보유종목 조회 중…</span>
            </div>
          )}

          {/* 설정 없음 */}
          {status === "no-config" && (
            <div className="py-12 flex flex-col items-center gap-3 text-center">
              <AlertCircle size={28} className="text-yellow-400" />
              <p className="text-sm text-muted-foreground">
                연동된 증권사 API 키가 없습니다.
                <br />
                <span className="text-foreground font-medium">설정 → API 설정</span>에서 한국투자증권 API 키와 계좌번호를 입력해주세요.
              </p>
              <Button variant="ghost" size="sm" onClick={onClose}>닫기</Button>
            </div>
          )}

          {/* 에러 */}
          {status === "error" && (
            <div className="py-12 flex flex-col items-center gap-3 text-center">
              <AlertCircle size={28} className="text-red-400" />
              <p className="text-sm text-muted-foreground">
                보유종목 조회에 실패했습니다.
              </p>
              <p className="text-xs text-red-400 max-w-sm">{errorMsg}</p>
              <Button variant="ghost" size="sm" onClick={onClose}>닫기</Button>
            </div>
          )}

          {/* 보유종목 목록 */}
          {status === "ready" && (
            <>
              {holdings.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  보유 종목이 없습니다.
                </div>
              ) : (
                <>
                  {/* 전체 선택 */}
                  <div className="flex items-center justify-between mb-3 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.size === holdings.length}
                        onChange={toggleAll}
                        className="accent-blue-500"
                      />
                      <span className="text-muted-foreground">전체 선택</span>
                    </label>
                    <span className="text-xs text-muted-foreground">{selected.size}/{holdings.length}개 선택</span>
                  </div>

                  <div className="space-y-2">
                    {holdings.map((h) => (
                      <label
                        key={h.ticker}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selected.has(h.ticker)
                            ? "border-blue-500/40 bg-blue-500/5"
                            : "border-transparent hover:bg-white/3"
                        }`}
                        style={{ borderColor: selected.has(h.ticker) ? undefined : "var(--border)" }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(h.ticker)}
                          onChange={() => toggle(h.ticker)}
                          className="accent-blue-500 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium text-sm">{h.name}</span>
                              <span className="text-xs text-muted-foreground ml-2">{h.ticker}</span>
                            </div>
                            <span className={`text-sm font-medium tabular-nums ${colorByChange(h.pnl_rate)}`}>
                              {h.pnl_rate >= 0 ? "+" : ""}{h.pnl_rate.toFixed(2)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            <span>{formatNumber(h.quantity)}주</span>
                            <span>평균 {formatNumber(h.avg_price)}</span>
                            <span>현재 {formatNumber(h.current_price)}</span>
                            <span className={colorByChange(h.pnl_amount)}>
                              {h.pnl_amount >= 0 ? "+" : ""}{formatNumber(h.pnl_amount)}
                            </span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        {status === "ready" && holdings.length > 0 && (
          <div className="flex justify-end gap-2 p-5 pt-3 border-t shrink-0" style={{ borderColor: "var(--border)" }}>
            <Button variant="ghost" onClick={onClose} disabled={importing}>취소</Button>
            <Button onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? (
                <><Loader2 size={14} className="animate-spin" /> 추가 중…</>
              ) : (
                <><Download size={14} /> {selected.size}개 포트폴리오에 추가</>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
