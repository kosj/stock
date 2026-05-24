"use client";
import useSWR from "swr";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StockChart, RsiChart, MacdChart } from "@/components/charts/StockChart";
import { formatNumber, formatPercent, colorByChange, recommendationColor } from "@/lib/utils";
import { TrendingUp, TrendingDown, RefreshCw, Zap } from "lucide-react";

const PERIODS = ["1m", "3m", "6m", "1y", "2y", "5y"] as const;
type Period = typeof PERIODS[number];

const PERIOD_LABELS: Record<Period, string> = {
  "1m": "1개월", "3m": "3개월", "6m": "6개월",
  "1y": "1년", "2y": "2년", "5y": "5년",
};

export function StockDetailPage({ ticker }: { ticker: string }) {
  const [period, setPeriod] = useState<Period>("1y");
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const { data: quote, mutate: refreshQuote } = useSWR(
    `quote-${ticker}`,
    () => api.market.quote(ticker),
    { refreshInterval: 10_000 },
  );
  const { data: chart, isLoading: chartLoading } = useSWR(
    `chart-${ticker}-${period}`,
    () => api.market.chart(ticker, period),
    { refreshInterval: 30_000 },
  );
  const { data: financials } = useSWR(`financials-${ticker}`, () => api.market.financials(ticker), { refreshInterval: 60_000 });
  const { data: analysis, mutate: refreshAnalysis, isLoading: isAnalyzing } = useSWR(
    `analysis-${ticker}`,
    () => api.analysis.get(ticker),
    { refreshInterval: 30_000 },
  );

  const q = quote as any;
  const c = chart as any;
  const f = financials as any;
  const a = analysis as any;

  const priceChange = q?.change ?? 0;

  return (
    <div className="p-6 space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-2xl font-bold">
              {f?.name ?? q?.name ?? ticker}
            </h1>
            <span className="text-sm text-muted-foreground">{ticker}</span>
            {f?.sector && (
              <Badge variant="blue">{f.sector}</Badge>
            )}
          </div>
          {q && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-3xl font-bold tabular-nums">
                {formatNumber(q.price)}원
              </span>
              <span className={`flex items-center gap-1 text-base font-medium ${colorByChange(priceChange)}`}>
                {priceChange >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {formatPercent(q.change_pct)}
                <span className="text-sm">({priceChange >= 0 ? "+" : ""}{formatNumber(q.change)})</span>
              </span>
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => refreshQuote()}>
          <RefreshCw size={13} />
        </Button>
      </div>

      {/* 차트 */}
      <Card>
        <div className="flex gap-1 mb-3">
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
        {/* 재무 지표 */}
        <Card>
          <CardHeader><CardTitle>재무 지표</CardTitle></CardHeader>
          {f ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                { label: "시가총액",  value: f.market_cap ? `${(f.market_cap / 1e12).toFixed(1)}조` : "-" },
                { label: "PER",       value: f.per ? `${f.per.toFixed(1)}배` : "-" },
                { label: "PBR",       value: f.pbr ? `${f.pbr.toFixed(2)}배` : "-" },
                { label: "ROE",       value: f.roe ? `${f.roe.toFixed(1)}%` : "-" },
                { label: "영업이익률",value: f.operating_margin ? `${f.operating_margin.toFixed(1)}%` : "-" },
                { label: "매출 성장", value: f.revenue_growth ? `${(f.revenue_growth).toFixed(1)}%` : "-" },
                { label: "EPS 성장",  value: f.earnings_growth ? `${(f.earnings_growth).toFixed(1)}%` : "-" },
                { label: "배당수익률",value: f.dividend_yield ? `${f.dividend_yield.toFixed(2)}%` : "-" },
                { label: "베타",      value: f.beta ? f.beta.toFixed(2) : "-" },
                { label: "52주 고가", value: f.week_52_high ? `${formatNumber(f.week_52_high)}원` : "-" },
                { label: "52주 저가", value: f.week_52_low  ? `${formatNumber(f.week_52_low)}원`  : "-" },
                { label: "D/E 비율",  value: f.debt_to_equity ? f.debt_to_equity.toFixed(1) : "-" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">데이터 로딩 중...</div>
          )}
        </Card>

        {/* AI 분석 */}
        <Card>
          <CardHeader>
            <CardTitle>AI 분석</CardTitle>
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
              {/* 투자 의견 */}
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${recommendationColor(a.recommendation)}`}>
                  {a.recommendation}
                </span>
                <div>
                  <div className="text-2xl font-bold">{a.score.toFixed(0)}<span className="text-sm text-muted-foreground">/100</span></div>
                </div>
              </div>

              {/* 점수 바 */}
              <div className="space-y-1.5">
                {[
                  { label: "밸류에이션", score: a.score_breakdown.valuation_score, max: 25 },
                  { label: "성장성",    score: a.score_breakdown.growth_score,    max: 25 },
                  { label: "기술적",    score: a.score_breakdown.technical_score, max: 25 },
                  { label: "섹터",      score: a.score_breakdown.sector_score,    max: 25 },
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

              {/* 종합 의견 */}
              <div className="text-sm leading-relaxed">{a.summary}</div>

              {/* 목표가 / 손절가 */}
              <div className="flex gap-3">
                {a.target_price && (
                  <div className="flex-1 rounded-lg p-2.5 text-center" style={{ background: "rgba(34,197,94,0.08)" }}>
                    <div className="text-xs text-green-400 mb-0.5">목표가</div>
                    <div className="font-bold text-green-400">{formatNumber(a.target_price)}원</div>
                  </div>
                )}
                {a.stop_price && (
                  <div className="flex-1 rounded-lg p-2.5 text-center" style={{ background: "rgba(239,68,68,0.08)" }}>
                    <div className="text-xs text-red-400 mb-0.5">손절가</div>
                    <div className="font-bold text-red-400">{formatNumber(a.stop_price)}원</div>
                  </div>
                )}
              </div>

              {/* 리스크 / 촉매 */}
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
                    {a.catalysts?.map((c: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1">
                        <span className="text-green-400 mt-0.5">•</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 기업 개요 */}
      {f?.summary && (
        <Card>
          <CardHeader><CardTitle>기업 개요</CardTitle></CardHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">{f.summary}</p>
        </Card>
      )}
    </div>
  );
}
