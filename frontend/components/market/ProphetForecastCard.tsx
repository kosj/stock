"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { ProphetForecastResult, ProphetPoint, ScenarioPoint } from "@/lib/server/prophet-forecast";

interface Props {
  result: ProphetForecastResult | null;
  loading: boolean;
}

const REC_META = {
  strong_buy:  { label: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  buy:         { label: "매수",      color: "text-green-400",   bg: "bg-green-500/10  border-green-500/30"  },
  hold:        { label: "관망",      color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/30" },
  sell:        { label: "매도",      color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30" },
  strong_sell: { label: "강력 매도", color: "text-red-400",     bg: "bg-red-500/10    border-red-500/30"    },
} as const;

// ── SVG helpers ──────────────────────────────────────────────────────────────

const W = 540, H = 165;
const PAD = { t: 14, r: 64, b: 28, l: 52 };
const chartW = W - PAD.l - PAD.r;
const chartH = H - PAD.t - PAD.b;

function scaleX(i: number, total: number) {
  return PAD.l + (i / Math.max(1, total - 1)) * chartW;
}
function scaleY(v: number, minV: number, range: number) {
  return PAD.t + chartH - ((v - minV) / range) * chartH;
}

// ── Tab 1: 과거 정확도 비교 차트 ─────────────────────────────────────────────

function AccuracyChart({
  actual, fit, predictions, currentPrice,
}: {
  actual:       { date: string; price: number }[];
  fit:          ProphetPoint[];
  predictions:  ProphetPoint[];
  currentPrice: number;
}) {
  const totalN = actual.length + predictions.length;
  if (totalN === 0 || actual.length === 0) return null;

  const allVals = [
    ...actual.map(p => p.price),
    ...fit.map(p => p.yhat),
    ...predictions.map(p => p.yhat_upper),
    ...predictions.map(p => p.yhat_lower),
  ].filter(isFinite);
  const minP = Math.min(...allVals) * 0.997;
  const maxP = Math.max(...allVals) * 1.003;
  const range = maxP - minP || 1;

  const histN = actual.length;
  const predN = predictions.length;

  function cx(i: number) { return scaleX(i, totalN); }
  function cy(v: number) { return scaleY(v, minP, range); }

  const actualLine = actual.map((p, i) => `${cx(i)},${cy(p.price)}`).join(" ");
  const fitLine    = fit.map((p, i) => `${cx(i)},${cy(p.yhat)}`).join(" ");
  const predLine   = predictions.map((p, i) => `${cx(histN + i)},${cy(p.yhat)}`).join(" ");

  const isUp = (predictions[predN - 1]?.yhat ?? currentPrice) >= currentPrice;
  const accentColor = isUp ? "#34d399" : "#f87171";
  const bandFill    = isUp ? "#34d39918" : "#f8717118";

  const bandUp = predictions.map((p, i) => `${cx(histN + i)},${cy(p.yhat_upper)}`).join(" ");
  const bandDn = [...predictions].reverse().map((p, i) => `${cx(histN + predN - 1 - i)},${cy(p.yhat_lower)}`).join(" ");

  const mape = fit.length > 0
    ? fit.reduce((s, fp, i) => s + Math.abs((fp.yhat - actual[i].price) / (actual[i].price || 1)), 0) / fit.length * 100
    : null;

  const yTicks = [minP, (minP + maxP) / 2, maxP];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-3">
          {[
            { color: "#ffffffb0", dash: false, label: "실제가" },
            { color: "#60a5fa",   dash: true,  label: "모델 적합" },
            { color: accentColor, dash: false, label: "예측" },
          ].map(({ color, dash, label }) => (
            <span key={label} className="flex items-center gap-1">
              <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth="2"
                strokeDasharray={dash ? "4,2" : "none"} /></svg>
              <span className="text-muted-foreground">{label}</span>
            </span>
          ))}
        </div>
        {mape !== null && (
          <span className="text-muted-foreground">
            과거 오차{" "}
            <span className={mape < 3 ? "text-green-400" : mape < 7 ? "text-yellow-400" : "text-red-400"}>
              {mape.toFixed(1)}%
            </span>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: `${H}px` }}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={cy(v)} x2={PAD.l + chartW} y2={cy(v)} stroke="#ffffff0d" strokeWidth="1" />
            <text x={PAD.l - 5} y={cy(v) + 4} textAnchor="end" fontSize="9" fill="#555">
              {formatNumber(Math.round(v))}
            </text>
          </g>
        ))}
        <line x1={cx(histN - 1)} y1={PAD.t} x2={cx(histN - 1)} y2={PAD.t + chartH}
          stroke="#ffffff35" strokeWidth="1" strokeDasharray="4,3" />
        <polygon points={`${bandUp} ${bandDn}`} fill={bandFill} />
        <polyline points={fitLine}    fill="none" stroke="#60a5fa"   strokeWidth="1.5" strokeDasharray="5,3" opacity="0.75" />
        <polyline points={actualLine} fill="none" stroke="#ffffffb0" strokeWidth="2" />
        {predLine && <polyline points={predLine} fill="none" stroke={accentColor} strokeWidth="2" />}
        <text x={cx(0)}           y={H - 6} textAnchor="start"  fontSize="9" fill="#555">{actual[0]?.date?.slice(5)}</text>
        <text x={cx(histN - 1)}   y={H - 6} textAnchor="middle" fontSize="9" fill="#999">현재</text>
        <text x={cx(totalN - 1)}  y={H - 6} textAnchor="end"    fontSize="9" fill="#555">
          {predictions[predN - 1]?.date?.slice(5)}
        </text>
      </svg>
    </div>
  );
}

// ── Tab 2: Bull / Base / Bear 시나리오 팬 차트 ───────────────────────────────

function ScenarioFanChart({
  history, bull, base, bear, currentPrice,
}: {
  history:      { date: string; price: number }[];
  bull:         ScenarioPoint[];
  base:         ScenarioPoint[];
  bear:         ScenarioPoint[];
  currentPrice: number;
}) {
  const histN  = history.length;
  const predN  = bull.length;
  const totalN = histN + predN;

  if (totalN === 0 || predN === 0) return null;

  const allVals = [
    ...history.map(p => p.price),
    ...bull.map(p => p.price),
    ...bear.map(p => p.price),
  ].filter(isFinite);
  const minP  = Math.min(...allVals) * 0.994;
  const maxP  = Math.max(...allVals) * 1.006;
  const range = maxP - minP || 1;

  function cx(i: number) { return scaleX(i, totalN); }
  function cy(v: number) { return scaleY(v, minP, range); }

  // History actual line
  const histLine  = history.map((p, i) => `${cx(i)},${cy(p.price)}`).join(" ");

  // Scenario lines (offset by histN)
  const bullLine = bull.map((p, i) => `${cx(histN + i)},${cy(p.price)}`).join(" ");
  const baseLine = base.map((p, i) => `${cx(histN + i)},${cy(p.price)}`).join(" ");
  const bearLine = bear.map((p, i) => `${cx(histN + i)},${cy(p.price)}`).join(" ");

  // Fill polygons
  // Bull-to-base fill (green, between bull and base lines)
  const bullBaseTop = bull.map((p, i) => `${cx(histN + i)},${cy(p.price)}`).join(" ");
  const bullBaseBot = [...base].reverse().map((p, i) => `${cx(histN + predN - 1 - i)},${cy(p.price)}`).join(" ");

  // Base-to-bear fill (red, between base and bear lines)
  const baseBearTop = base.map((p, i) => `${cx(histN + i)},${cy(p.price)}`).join(" ");
  const baseBearBot = [...bear].reverse().map((p, i) => `${cx(histN + predN - 1 - i)},${cy(p.price)}`).join(" ");

  // Y-axis ticks
  const yTicks = [minP, (minP + maxP) / 2, maxP];

  // Divider x
  const divX = cx(histN - 1);

  // End prices for labels
  const bullEnd = bull[predN - 1];
  const baseEnd = base[predN - 1];
  const bearEnd = bear[predN - 1];

  const labelX = PAD.l + chartW + 4;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4 px-1 text-xs">
        {[
          { color: "#34d399", label: "Bull (최고)" },
          { color: "#60a5fa", label: "Base (평균)" },
          { color: "#f87171", label: "Bear (최악)" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth="2" /></svg>
            <span className="text-muted-foreground">{label}</span>
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: `${H}px` }}>
        {/* Grid */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={cy(v)} x2={PAD.l + chartW} y2={cy(v)} stroke="#ffffff0d" strokeWidth="1" />
            <text x={PAD.l - 5} y={cy(v) + 4} textAnchor="end" fontSize="9" fill="#555">
              {formatNumber(Math.round(v))}
            </text>
          </g>
        ))}

        {/* Fill: Bull ~ Base (green) */}
        <polygon points={`${bullBaseTop} ${bullBaseBot}`} fill="#34d39920" />
        {/* Fill: Base ~ Bear (red) */}
        <polygon points={`${baseBearTop} ${baseBearBot}`} fill="#f8717120" />

        {/* Current divider */}
        <line x1={divX} y1={PAD.t} x2={divX} y2={PAD.t + chartH}
          stroke="#ffffff40" strokeWidth="1" strokeDasharray="4,3" />

        {/* History line */}
        <polyline points={histLine} fill="none" stroke="#ffffff55" strokeWidth="1.5" />

        {/* Scenario lines */}
        <polyline points={bullLine} fill="none" stroke="#34d399" strokeWidth="2" />
        <polyline points={baseLine} fill="none" stroke="#60a5fa" strokeWidth="2" strokeDasharray="6,2" />
        <polyline points={bearLine} fill="none" stroke="#f87171" strokeWidth="2" />

        {/* Horizontal dotted line at current price */}
        <line
          x1={divX} y1={cy(currentPrice)}
          x2={PAD.l + chartW} y2={cy(currentPrice)}
          stroke="#ffffff25" strokeWidth="1" strokeDasharray="2,4"
        />

        {/* End-price labels */}
        {bullEnd && (
          <text x={labelX} y={cy(bullEnd.price) + 4} fontSize="9" fill="#34d399" fontWeight="600">
            {formatNumber(Math.round(bullEnd.price))}
          </text>
        )}
        {baseEnd && (
          <text x={labelX} y={cy(baseEnd.price) + 4} fontSize="9" fill="#60a5fa">
            {formatNumber(Math.round(baseEnd.price))}
          </text>
        )}
        {bearEnd && (
          <text x={labelX} y={cy(bearEnd.price) + 4} fontSize="9" fill="#f87171">
            {formatNumber(Math.round(bearEnd.price))}
          </text>
        )}

        {/* X-axis labels */}
        <text x={cx(0)}           y={H - 6} textAnchor="start"  fontSize="9" fill="#555">{history[0]?.date?.slice(5)}</text>
        <text x={divX}            y={H - 6} textAnchor="middle" fontSize="9" fill="#999">현재</text>
        <text x={cx(totalN - 1)}  y={H - 6} textAnchor="end"    fontSize="9" fill="#555">{bull[predN - 1]?.date?.slice(5)}</text>
      </svg>
    </div>
  );
}

// ── Scenario summary row ──────────────────────────────────────────────────────

function ScenarioSummary({
  scenarios, currentPrice,
}: {
  scenarios:    ProphetForecastResult["scenarios"];
  currentPrice: number;
}) {
  const items = [
    {
      key: "bull",
      label: "Bull",
      sub: "최고",
      price: scenarios.bull_price_30d,
      ret:   scenarios.bull_return_30d,
      color: "text-emerald-400",
      bg:    "bg-emerald-500/8 border-emerald-500/20",
    },
    {
      key: "base",
      label: "Base",
      sub: "평균",
      price: scenarios.base_price_30d,
      ret:   scenarios.base_return_30d,
      color: "text-blue-400",
      bg:    "bg-blue-500/8 border-blue-500/20",
    },
    {
      key: "bear",
      label: "Bear",
      sub: "최악",
      price: scenarios.bear_price_30d,
      ret:   scenarios.bear_return_30d,
      color: "text-red-400",
      bg:    "bg-red-500/8 border-red-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(({ key, label, sub, price, ret, color, bg }) => (
        <div key={key} className={`rounded-lg border p-3 ${bg}`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-xs font-bold ${color}`}>{label}</span>
            <span className="text-xs text-muted-foreground">({sub})</span>
          </div>
          <div className={`text-base font-bold tabular-nums ${color}`}>
            {formatNumber(Math.round(price))}
          </div>
          <div className={`text-xs font-medium tabular-nums mt-0.5 ${color}`}>
            {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {ret >= 0 ? "▲" : "▼"} {formatNumber(Math.round(Math.abs(price - currentPrice)))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

type Tab = "scenario" | "accuracy";

export function ProphetForecastCard({ result, loading }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState<Tab>("scenario");

  if (loading) {
    return (
      <div className="rounded-xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="h-4 bg-white/5 rounded w-40" />
        <div className="h-44 bg-white/3 rounded" />
      </div>
    );
  }

  if (!result || result.insufficient_data) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        Prophet 예측: 데이터 부족 (최소 30거래일 필요)
      </div>
    );
  }

  const meta  = REC_META[result.recommendation];
  const isUp  = result.predicted_return_30d >= 0;
  const r2Pct = Math.round(result.r_squared * 100);

  const TrendIcon =
    result.trend_direction === "up"   ? TrendingUp   :
    result.trend_direction === "down" ? TrendingDown  : Minus;
  const trendColor =
    result.trend_direction === "up"   ? "text-green-400" :
    result.trend_direction === "down" ? "text-red-400"   : "text-muted-foreground";

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Prophet 가격 예측</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${meta.bg} ${meta.color}`}>
            {meta.label}
          </span>
          <span className={`text-xs tabular-nums font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
            {result.predicted_return_30d >= 0 ? "+" : ""}{result.predicted_return_30d.toFixed(1)}%
            <span className="text-muted-foreground font-normal ml-1">(Base·30일)</span>
          </span>
        </div>
        {expanded
          ? <ChevronUp  size={15} className="text-muted-foreground" />
          : <ChevronDown size={15} className="text-muted-foreground" />
        }
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">

          {/* 탭 */}
          <div className="flex gap-1 p-0.5 rounded-lg w-fit"
            style={{ background: "var(--background)" }}>
            {([
              { id: "scenario", label: "시나리오" },
              { id: "accuracy", label: "과거 적합" },
            ] as { id: Tab; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  tab === id
                    ? "bg-white/10 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 시나리오 탭 */}
          {tab === "scenario" && (
            <>
              {/* 30일 시나리오 요약 카드 */}
              <ScenarioSummary
                scenarios={result.scenarios}
                currentPrice={result.current_price}
              />

              {/* 팬 차트 */}
              <ScenarioFanChart
                history={result.history_actual}
                bull={result.scenarios.bull}
                base={result.scenarios.base}
                bear={result.scenarios.bear}
                currentPrice={result.current_price}
              />

              {/* 7거래일 상세 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                      {["날짜", "Bull", "Base", "Bear"].map(h => (
                        <th key={h} className="text-left text-muted-foreground py-1.5 px-2 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.scenarios.bull.slice(0, 7).map((b, i) => {
                      const bs = result.scenarios.base[i];
                      const br = result.scenarios.bear[i];
                      const bullRet = ((b.price  - result.current_price) / result.current_price) * 100;
                      const baseRet = ((bs.price - result.current_price) / result.current_price) * 100;
                      const bearRet = ((br.price - result.current_price) / result.current_price) * 100;
                      return (
                        <tr key={b.date} className="border-b hover:bg-white/2"
                          style={{ borderColor: "var(--border)" }}>
                          <td className="py-1.5 px-2 text-muted-foreground">{b.date}</td>
                          <td className="py-1.5 px-2 tabular-nums text-emerald-400 font-medium">
                            {formatNumber(Math.round(b.price))}
                            <span className="opacity-60 ml-1">({bullRet >= 0 ? "+" : ""}{bullRet.toFixed(1)}%)</span>
                          </td>
                          <td className="py-1.5 px-2 tabular-nums text-blue-400">
                            {formatNumber(Math.round(bs.price))}
                            <span className="opacity-60 ml-1">({baseRet >= 0 ? "+" : ""}{baseRet.toFixed(1)}%)</span>
                          </td>
                          <td className="py-1.5 px-2 tabular-nums text-red-400">
                            {formatNumber(Math.round(br.price))}
                            <span className="opacity-60 ml-1">({bearRet >= 0 ? "+" : ""}{bearRet.toFixed(1)}%)</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 과거 적합 탭 */}
          {tab === "accuracy" && (
            <>
              <AccuracyChart
                actual={result.history_actual}
                fit={result.history_fit}
                predictions={result.predictions}
                currentPrice={result.current_price}
              />

              {/* 30일 예측 vs 실제 오차 계산 */}
              {(() => {
                const hist = result.history_actual;
                const fit  = result.history_fit;
                const n    = hist.length;
                if (n < 32 || fit.length < 32) return null;
                const startPrice     = hist[n - 31].price;
                const actualNow      = result.current_price;
                const fitNow         = fit[fit.length - 1]?.yhat;
                if (!startPrice || !fitNow) return null;
                const actualRet30    = (actualNow - startPrice) / startPrice * 100;
                const predictedRet30 = (fitNow   - startPrice) / startPrice * 100;
                const errPct         = actualRet30 - predictedRet30;
                const errColor       = Math.abs(errPct) < 3 ? "text-green-400" : Math.abs(errPct) < 7 ? "text-yellow-400" : "text-red-400";
                return (
                  <div className="rounded-lg p-3 border" style={{ background: "var(--background)", borderColor: "var(--border)" }}>
                    <div className="text-xs text-muted-foreground mb-2 font-medium">과거 30일 예측 정확도</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">실제 수익률</div>
                        <div className={`text-sm font-semibold tabular-nums ${actualRet30 >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {actualRet30 >= 0 ? "+" : ""}{actualRet30.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">예측 수익률</div>
                        <div className={`text-sm font-semibold tabular-nums ${predictedRet30 >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {predictedRet30 >= 0 ? "+" : ""}{predictedRet30.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">오차</div>
                        <div className={`text-sm font-semibold tabular-nums ${errColor}`}>
                          {errPct >= 0 ? "+" : ""}{errPct.toFixed(1)}%p
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 통계 그리드 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "7일 예측",    value: `${result.predicted_return_7d  >= 0 ? "+" : ""}${result.predicted_return_7d.toFixed(1)}%`,  color: result.predicted_return_7d  >= 0 ? "text-green-400" : "text-red-400" },
                  { label: "30일 예측",   value: `${result.predicted_return_30d >= 0 ? "+" : ""}${result.predicted_return_30d.toFixed(1)}%`, color: result.predicted_return_30d >= 0 ? "text-green-400" : "text-red-400" },
                  { label: "연간 추세",   value: `${result.trend_slope_annual_pct.toFixed(1)}%`, color: trendColor },
                  { label: "모델 적합도", value: `R² ${r2Pct}%`, color: r2Pct >= 60 ? "text-blue-400" : "text-yellow-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg p-2.5" style={{ background: "var(--background)" }}>
                    <div className="text-xs text-muted-foreground mb-1">{label}</div>
                    <div className={`text-sm font-semibold tabular-nums ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <TrendIcon size={14} className={trendColor} />
                <span className={`text-xs font-medium ${trendColor}`}>
                  {result.trend_direction === "up" ? "장기 상승 추세" : result.trend_direction === "down" ? "장기 하락 추세" : "추세 불명확"}
                </span>
                {result.changepoint_dates.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">
                    추세 변화점: {result.changepoint_dates.slice(0, 3).join(", ")}
                  </span>
                )}
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground/40">
            시나리오: Prophet 추세강도 × 0.55 + 잔차 σ × 0.8 의 누적 편차 (Bear는 ×1.15 비대칭). 투자 손익 보장 불가.
          </p>
        </div>
      )}
    </div>
  );
}
