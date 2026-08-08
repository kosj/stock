"use client";
import useSWR from "swr";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { BrokerConfigManager } from "@/lib/apiConfig";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StockChart, RsiChart, MacdChart } from "@/components/charts/StockChart";
import { formatNumber, formatPercent, colorByChange, recommendationColor } from "@/lib/utils";
import { TrendingUp, TrendingDown, RefreshCw, Zap, Calendar, DollarSign, Target } from "lucide-react";
import { PullbackCard } from "./PullbackCard";
import { ProfitTakingCard } from "./ProfitTakingCard";
import { StopLossCard } from "./StopLossCard";
import { ProphetForecastCard } from "./ProphetForecastCard";
import { AlgorithmSignalCard } from "./AlgorithmSignalCard";
import { PositionDetailCard } from "./PositionDetailCard";
import { CompanyOverviewCard } from "./CompanyOverviewCard";
import { SupplyDemandCard } from "./SupplyDemandCard";
import type { PullbackResult } from "@/lib/server/pullback-analysis";
import type { ProfitTakingResult } from "@/lib/server/profit-taking";
import type { StopLossResult } from "@/lib/server/stop-loss-signal";
import type { ProphetForecastResult } from "@/lib/server/prophet-forecast";
import type { DartCompanyInfo } from "@/lib/server/dart";
import type { PositionAnalysisResult } from "@/lib/server/position-manager-service";
import type { InvestorTrendResult } from "@/lib/server/investor-trend";

const PERIODS = ["1m", "3m", "6m", "1y", "2y", "5y"] as const;
type Period = typeof PERIODS[number];

const PERIOD_LABELS: Record<Period, string> = {
  "1m": "1개월", "3m": "3개월", "6m": "6개월",
  "1y": "1년", "2y": "2년", "5y": "5년",
};

interface Props {
  ticker:        string;
  avgPrice?:     number | null;
  quantity?:     number | null;
  portfolioId?:  number | null;
  positionId?:   number | null;
  /** page.tsx 서버 fetch — 수급 분석 초기 데이터 */
  investorTrend?: InvestorTrendResult | null;
}

type BrokerCreds = { type: string; appKey: string; appSecret: string } | null;

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export function StockDetailPage({
  ticker, avgPrice, quantity, portfolioId, positionId, investorTrend,
}: Props) {
  const [period, setPeriod] = useState<Period>("1y");
  const [brokerCreds, setBrokerCreds] = useState<BrokerCreds>(null);
  const [brokerCredsLoaded, setBrokerCredsLoaded] = useState(false);

  useEffect(() => {
    BrokerConfigManager.getDefaultBrokerConfig().then((config) => {
      if (config?.credentials) {
        setBrokerCreds({
          type:      config.type,
          appKey:    config.credentials.appKey,
          appSecret: config.credentials.appSecret,
        });
      }
      setBrokerCredsLoaded(true);
    });
  }, []);

  const swrConfig = {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    dedupingInterval: 0,
  };

  const { data: quoteYahoo } = useSWR(
    `quote-${ticker}-yahoo`,
    () => api.market.quote(ticker),
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 60_000 },
  );

  const { data: quoteBroker, mutate: refreshQuote } = useSWR(
    brokerCredsLoaded ? `quote-${ticker}-${brokerCreds?.type ?? "yahoo"}` : null,
    () => api.market.quote(ticker, brokerCreds ?? undefined),
    { ...swrConfig, refreshInterval: 30_000 },
  );

  const quote = quoteBroker ?? quoteYahoo;

  async function handleForceRefresh() {
    const fresh = await api.market.quote(ticker, brokerCreds ?? undefined, true);
    await refreshQuote(fresh as any, { revalidate: false });
  }

  const { data: chart, isLoading: chartLoading } = useSWR(
    `chart-${ticker}-${period}`,
    () => api.market.chart(ticker, period),
    swrConfig,
  );
  const { data: financials } = useSWR(
    `financials-${ticker}`,
    () => api.market.financials(ticker),
    swrConfig,
  );

  const analysisKey = avgPrice
    ? `analysis-${ticker}-${avgPrice}-${quantity ?? 0}`
    : `analysis-${ticker}`;
  const { data: analysis, mutate: refreshAnalysis, isLoading: isAnalyzing } = useSWR(
    analysisKey,
    () => api.analysis.get(ticker, undefined, avgPrice ?? undefined, quantity ?? undefined),
    swrConfig,
  );

  const hasPosition = avgPrice != null && avgPrice > 0;

  const { data: stopLossRaw, isLoading: isStopLossLoading } = useSWR<StopLossResult[]>(
    hasPosition ? `stop-loss-${ticker}` : null,
    async () => {
      const res = await fetch("/api/analysis/stop-loss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );
  const stopLossResult = stopLossRaw?.[0] ?? null;

  const { data: profitTakingRaw, isLoading: isProfitTakingLoading } = useSWR<ProfitTakingResult[]>(
    hasPosition ? `profit-taking-${ticker}` : null,
    async () => {
      const res = await fetch("/api/analysis/profit-taking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );
  const profitTakingResult = profitTakingRaw?.[0] ?? null;

  const { data: prophetRaw, isLoading: isProphetLoading } = useSWR<ProphetForecastResult[]>(
    `prophet-${ticker}`,
    async () => {
      const res = await fetch("/api/analysis/prophet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 600_000 },
  );
  const prophetResult = prophetRaw?.[0] ?? null;

  const { data: positionAnalysisData, isLoading: isPositionAnalysisLoading } =
    useSWR<{ results: PositionAnalysisResult[] }>(
      hasPosition && portfolioId ? `position-analysis-${portfolioId}` : null,
      () => api.portfolio.positionAnalysis(portfolioId!) as Promise<{ results: PositionAnalysisResult[] }>,
      { revalidateOnFocus: false, dedupingInterval: 300_000 },
    );
  const positionAnalysis = positionAnalysisData?.results?.find(
    (r) => r.position_id === positionId,
  ) ?? null;

  const { data: pullbackRaw, isLoading: isPullbackLoading } = useSWR<PullbackResult[]>(
    `pullback-${ticker}`,
    async () => {
      const res = await fetch("/api/analysis/pullback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
      });
      if (!res.ok) return [];
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );
  const pullbackResult = pullbackRaw?.[0] ?? null;

  const { data: dartRaw, isLoading: isDartLoading } = useSWR<DartCompanyInfo & { available?: boolean }>(
    `dart-company-${ticker}`,
    () => fetch(`/api/market/dart-company/${ticker}`).then(r => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 86_400_000 },
  );

  const q = quote as any;
  const c = chart as any;
  const f = financials as any;
  const a = analysis as any;

  const priceChange    = q?.change ?? 0;
  const currentPrice   = q?.price;
  const positionPnlPct = hasPosition && currentPrice
    ? ((currentPrice - avgPrice!) / avgPrice!) * 100
    : null;

  // 차트 응답에서 RS 데이터 추출
  const rsData    = c?.rs?.rs_series ?? null;
  const rsSummary = c?.rs
    ? {
        stock_return_1m:  c.rs.stock_return_1m,
        index_return_1m:  c.rs.index_return_1m,
        rs_ratio:         c.rs.rs_ratio,
        is_outperformer:  c.rs.is_outperformer,
      }
    : null;

  return (
    <div className="p-6 space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <h1 className="text-2xl font-bold break-keep">
              {f?.name ?? q?.name ?? ticker}
            </h1>
            <span className="text-sm text-muted-foreground shrink-0">{ticker}</span>
            {f?.sector && <Badge variant="blue">{f.sector}</Badge>}
            {q?.source && q.source !== "yahoo" && (
              <Badge variant="green">{(q.source as string).toUpperCase()} 시세</Badge>
            )}
          </div>
          {q && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              <span className="text-3xl font-bold tabular-nums">
                {formatNumber(q.price)}
              </span>
              <span className={`flex items-center gap-1 text-base font-medium ${colorByChange(priceChange)}`}>
                {priceChange >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {formatPercent(q.change_pct)}
                <span className="text-sm">({priceChange >= 0 ? "+" : ""}{formatNumber(q.change)})</span>
              </span>
            </div>
          )}
          {hasPosition && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-sm">
              <span className="text-muted-foreground">
                {quantity ? `보유 ${formatNumber(quantity)}주 · ` : ""}평균단가 {formatNumber(avgPrice!)}
              </span>
              {positionPnlPct !== null && (
                <span className={`font-semibold ${colorByChange(positionPnlPct)}`}>
                  {positionPnlPct >= 0 ? "+" : ""}{positionPnlPct.toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={handleForceRefresh}>
          <RefreshCw size={13} />
        </Button>
      </div>

      {/* 기업 개요 */}
      <CompanyOverviewCard
        ticker={ticker}
        dart={dartRaw ?? null}
        financials={f ?? null}
        loading={isDartLoading}
      />

      {/* 차트 */}
      <Card>
        <div className="flex flex-wrap gap-1 mb-3">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                period === p ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-white/5"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        {chartLoading ? (
          <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">
            차트 로딩 중...
          </div>
        ) : c?.candles?.length ? (
          <div className="space-y-3">
            <StockChart
              candles={c.candles}
              indicators={c.indicators}
              stopLoss={undefined}
              takeProfit={undefined}
              rsData={rsData}
              rsSummary={rsSummary}
            />
            {c.indicators?.rsi?.length > 0 && (
              <RsiChart data={c.indicators.rsi} />
            )}
            {c.indicators?.macd?.length > 0 && (
              <MacdChart
                macd={c.indicators.macd}
                signal={c.indicators.macd_signal ?? []}
                hist={c.indicators.macd_hist ?? []}
              />
            )}
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            차트 데이터를 불러올 수 없습니다.
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        {/* 재무 지표 + 포워드 컨센서스 + 주요 일정 */}
        <Card>
          <CardHeader><CardTitle>재무 지표</CardTitle></CardHeader>
          {f ? (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  // 국내(6자리 코드)만 원화 "조" 단위 — 미국 종목은 달러를 조로 오표기했었다
                  { label: "시가총액",   value: f.market_cap
                      ? /^\d{6}$/.test(ticker)
                        ? `${(f.market_cap / 1e12).toFixed(1)}조`
                        : `$${(f.market_cap / 1e9).toFixed(1)}B`
                      : "-" },
                  { label: "PER",        value: f.per ? `${f.per.toFixed(1)}배` : "-" },
                  { label: "Fwd PER",    value: f.forward_per ? `${f.forward_per.toFixed(1)}배` : "-" },
                  { label: "PBR",        value: f.pbr ? `${f.pbr.toFixed(2)}배` : "-" },
                  { label: "ROE",        value: f.roe ? `${f.roe.toFixed(1)}%` : "-" },
                  { label: "영업이익률", value: f.operating_margin ? `${f.operating_margin.toFixed(1)}%` : "-" },
                  { label: "매출 성장",  value: f.revenue_growth ? `${f.revenue_growth.toFixed(1)}%` : "-" },
                  { label: "EPS 성장",   value: f.earnings_growth ? `${f.earnings_growth.toFixed(1)}%` : "-" },
                  { label: "배당수익률", value: f.dividend_yield ? `${f.dividend_yield.toFixed(2)}%` : "-" },
                  { label: "베타",       value: f.beta ? f.beta.toFixed(2) : "-" },
                  { label: "52주 고가",  value: f.week_52_high ? `${formatNumber(f.week_52_high)}` : "-" },
                  { label: "52주 저가",  value: f.week_52_low  ? `${formatNumber(f.week_52_low)}`  : "-" },
                  { label: "D/E 비율",   value: f.debt_to_equity ? f.debt_to_equity.toFixed(1) : "-" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums">{value}</span>
                  </div>
                ))}
              </div>

              {/* ── 포워드 컨센서스 섹션 ─────────────────────────────────────── */}
              {(f.analyst_mean_target || f.consensus_gap_pct != null) && (
                <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Target size={12} />
                    애널리스트 컨센서스
                    {f.analyst_count && (
                      <span className="text-muted-foreground/60 font-normal">
                        ({f.analyst_count}명)
                      </span>
                    )}
                  </div>

                  {f.analyst_mean_target && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">평균 목표주가</span>
                      <span className="font-medium tabular-nums">{formatNumber(f.analyst_mean_target)}</span>
                    </div>
                  )}
                  {f.analyst_high_target && f.analyst_low_target && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">목표가 범위</span>
                      <span className="font-medium tabular-nums text-xs">
                        {formatNumber(f.analyst_low_target)} ~ {formatNumber(f.analyst_high_target)}
                      </span>
                    </div>
                  )}
                  {f.consensus_gap_pct != null && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">괴리율</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold tabular-nums ${
                          f.consensus_gap_pct >= 20
                            ? "text-green-400"
                            : f.consensus_gap_pct >= 0
                            ? "text-blue-400"
                            : "text-red-400"
                        }`}>
                          {f.consensus_gap_pct >= 0 ? "+" : ""}{f.consensus_gap_pct.toFixed(1)}%
                        </span>
                        {f.consensus_gap_pct >= 20 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-400/15 text-green-400 font-medium">
                            저평가 시그널
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 주요 일정 */}
              {(f.next_earnings_date || f.ex_dividend_date || f.dividend_date) && (
                <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Calendar size={12} />
                    주요 일정
                  </div>
                  {f.next_earnings_date && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Zap size={11} className="text-yellow-400" />
                        실적발표 예정
                      </span>
                      <span className="font-medium text-yellow-400">{formatDate(f.next_earnings_date)}</span>
                    </div>
                  )}
                  {f.ex_dividend_date && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <DollarSign size={11} className="text-green-400" />
                        배당락일
                      </span>
                      <span className="font-medium text-green-400">{formatDate(f.ex_dividend_date)}</span>
                    </div>
                  )}
                  {f.dividend_date && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <DollarSign size={11} className="text-blue-400" />
                        배당지급일
                      </span>
                      <span className="font-medium text-blue-400">{formatDate(f.dividend_date)}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground text-sm">데이터 로딩 중...</div>
          )}
        </Card>

        {/* AI 분석 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              AI 분석
              {hasPosition && (
                <span className="text-xs font-normal text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                  포지션 반영
                </span>
              )}
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => refreshAnalysis()} disabled={isAnalyzing}>
              <Zap size={13} className={isAnalyzing ? "animate-pulse text-yellow-400" : ""} />
              {isAnalyzing ? "분석 중..." : "재분석"}
            </Button>
          </CardHeader>
          {isAnalyzing && (
            <div className="py-8 text-center text-muted-foreground text-sm animate-pulse">
              AI가 분석 중입니다...
            </div>
          )}
          {a && !isAnalyzing && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${recommendationColor(a.recommendation)}`}>
                  {a.recommendation}
                </span>
                <div className="text-2xl font-bold">
                  {a.score.toFixed(0)}
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                {a.pnl_pct != null && (
                  <div className={`ml-auto text-sm font-semibold ${colorByChange(a.pnl_pct)}`}>
                    내 수익률&nbsp;{a.pnl_pct >= 0 ? "+" : ""}{a.pnl_pct.toFixed(1)}%
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                {[
                  { label: "밸류에이션", score: a.score_breakdown.valuation_score, max: 25 },
                  { label: "성장성",     score: a.score_breakdown.growth_score,    max: 25 },
                  { label: "기술적",     score: a.score_breakdown.technical_score, max: 25 },
                  { label: "섹터",       score: a.score_breakdown.sector_score,    max: 25 },
                ].map(({ label, score, max }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-muted-foreground">{label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${(score / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right tabular-nums">{score.toFixed(1)}/{max}</span>
                  </div>
                ))}
              </div>

              <div className="text-sm leading-relaxed">{a.summary}</div>

              <div className="flex gap-3">
                {a.target_price && (
                  <div className="flex-1 rounded-lg p-2.5 text-center" style={{ background: "rgba(34,197,94,0.08)" }}>
                    <div className="text-xs text-green-400 mb-0.5">목표가</div>
                    <div className="font-bold text-green-400">{formatNumber(a.target_price)}</div>
                    {hasPosition && (
                      <div className="text-xs text-green-400/70 mt-0.5">
                        평단 대비 +{(((a.target_price - avgPrice!) / avgPrice!) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                )}
                {a.stop_price && (
                  <div className="flex-1 rounded-lg p-2.5 text-center" style={{ background: "rgba(239,68,68,0.08)" }}>
                    <div className="text-xs text-red-400 mb-0.5">손절가</div>
                    <div className="font-bold text-red-400">{formatNumber(a.stop_price)}</div>
                    {hasPosition && (
                      <div className="text-xs text-red-400/70 mt-0.5">
                        평단 대비 {(((a.stop_price - avgPrice!) / avgPrice!) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-red-400 font-semibold mb-1.5">리스크 요인</div>
                  <ul className="space-y-1">
                    {a.risk_factors?.map((r: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1">
                        <span className="text-red-400 mt-0.5">•</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-green-400 font-semibold mb-1.5">상승 촉매</div>
                  <ul className="space-y-1">
                    {a.catalysts?.map((cat: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1">
                        <span className="text-green-400 mt-0.5">•</span>{cat}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 수급 분석 — 국내 종목 전용 (page.tsx 서버 fetch 결과) */}
      <SupplyDemandCard data={investorTrend ?? null} />

      {/* 앙상블 알고리즘 신호 */}
      <AlgorithmSignalCard prophet={prophetResult} loading={isProphetLoading} />

      {/* Prophet 가격 예측 */}
      <ProphetForecastCard result={prophetResult} loading={isProphetLoading} />

      {/* 포지션 관리 */}
      {hasPosition && portfolioId && (positionAnalysis || isPositionAnalysisLoading) && (
        <PositionDetailCard
          result={positionAnalysis!}
          loading={isPositionAnalysisLoading || !positionAnalysis}
        />
      )}

      {/* 손절 시그널 */}
      {(!hasPosition || positionPnlPct === null || positionPnlPct < 0) && (
        <StopLossCard result={stopLossResult} loading={isStopLossLoading} avgPrice={avgPrice} />
      )}

      {/* 익절 시그널 */}
      {(!hasPosition || positionPnlPct === null || positionPnlPct > 0) && (
        <ProfitTakingCard result={profitTakingResult} loading={isProfitTakingLoading} />
      )}

      {/* 눌림목 패턴 분석 */}
      <PullbackCard result={pullbackResult} loading={isPullbackLoading} />
    </div>
  );
}
