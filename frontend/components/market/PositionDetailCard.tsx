"use client";

import { ShieldOff, Scissors, TrendingUp, Flame, Activity, BarChart2 } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { PositionAnalysisResult } from "@/lib/server/position-manager-service";

interface Props {
  result:  PositionAnalysisResult;
  loading: boolean;
}

const ACTION_STYLE = {
  SELL: { bg: "bg-red-500/10",     border: "border-red-500/25",     text: "text-red-400",     label: "매도 권고" },
  BUY:  { bg: "bg-emerald-500/10", border: "border-emerald-500/25", text: "text-emerald-400", label: "추가 매수 권고" },
  HOLD: { bg: "bg-muted/40",       border: "border-transparent",    text: "text-muted-foreground", label: "보유 유지" },
} as const;

export function PositionDetailCard({ result, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border p-4 animate-pulse"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="h-4 bg-muted rounded w-40 mb-3" />
        <div className="h-3 bg-muted/60 rounded w-full mb-2" />
        <div className="h-3 bg-muted/60 rounded w-3/4" />
      </div>
    );
  }

  const { action, rsi, ma5, peak_price, gross_pnl_pct, net_pnl_pct, atr_pct, volume_ratio, pyramiding_done } = result;
  const { meta } = action;
  const config   = meta.config;
  const style    = ACTION_STYLE[action.type];

  const takeProfitPrice = result.avg_price * (1 + config.take_profit_pct / 100);

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* 헤더 */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-y-2 border-b"
        style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">ATR 기반 포지션 관리</span>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style.bg} ${style.border} ${style.text}`}>
          {style.label}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* 판단 근거 */}
        <div className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed ${style.bg} ${style.text}`}>
          {action.reason}
        </div>

        {/* 손익 + 변동성 지표 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric
            label="세후 순수익률"
            value={`${net_pnl_pct >= 0 ? "+" : ""}${net_pnl_pct.toFixed(2)}%`}
            sub={`세전 ${gross_pnl_pct >= 0 ? "+" : ""}${gross_pnl_pct.toFixed(2)}%`}
            color={net_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}
          />
          <Metric
            label="ATR(14) 변동성"
            value={`${atr_pct.toFixed(2)}%`}
            sub="14일 평균 진폭"
            color="text-muted-foreground"
            icon={<Activity size={10} />}
          />
          <Metric
            label="RSI 14"
            value={rsi !== null ? rsi.toFixed(1) : "—"}
            sub={rsi !== null ? (rsi >= 75 ? "과매수" : rsi <= 30 ? "과매도" : "중립") : "데이터 없음"}
            color={rsi !== null && rsi >= 75 ? "text-red-400" : rsi !== null && rsi <= 30 ? "text-green-400" : "text-muted-foreground"}
          />
          <Metric
            label="거래량 비율"
            value={volume_ratio !== null ? `${volume_ratio.toFixed(2)}배` : "—"}
            sub={volume_ratio !== null ? (volume_ratio >= 1.5 ? "급증 (피라미딩 충족)" : "기준 미달") : "데이터 없음"}
            color={volume_ratio !== null && volume_ratio >= 1.5 ? "text-emerald-400" : "text-muted-foreground"}
          />
        </div>

        {/* ATR 동적 임계값 기준가 */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            ATR 기반 동적 기준가 (ATR% {atr_pct.toFixed(2)})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            <PriceLine
              icon={<ShieldOff size={11} className="text-red-400 shrink-0" />}
              label={`손절 ${config.stop_loss_pct.toFixed(1)}% (2×ATR)`}
              price={meta.stop_loss_price}
              current={result.current_price}
              dangerBelow
            />
            <PriceLine
              icon={<Scissors size={11} className="text-orange-400 shrink-0" />}
              label={`트레일링 ${config.trailing_stop_pct.toFixed(1)}% (2.5×ATR) — 고점 ${formatNumber(peak_price)}원`}
              price={meta.trailing_stop_price}
              current={result.current_price}
              dangerBelow
            />
            <PriceLine
              icon={<TrendingUp size={11} className="text-yellow-400 shrink-0" />}
              label={`익절 +${config.take_profit_pct.toFixed(1)}% (3×ATR)`}
              price={takeProfitPrice}
              current={result.current_price}
              dangerBelow={false}
            />
            <PriceLine
              icon={<Flame size={11} className="text-emerald-400 shrink-0" />}
              label={`피라미딩 +${config.pyramiding_pct.toFixed(1)}% (1×ATR)`}
              price={meta.pyramid_trigger_price}
              current={result.current_price}
              dangerBelow={false}
            />
          </div>
        </div>

        {/* MA5 추세 + 피라미딩 상태 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {ma5 !== null && (
            <span className="text-muted-foreground">
              MA5 <span className="tabular-nums text-foreground font-medium">{formatNumber(Math.round(ma5))}원</span>
              {result.current_price > ma5
                ? <span className="text-green-400 ml-1">▲ 단기 상승 추세</span>
                : <span className="text-red-400 ml-1">▼ 단기 하락 추세</span>
              }
            </span>
          )}
          <span className={pyramiding_done ? "text-muted-foreground/50" : "text-muted-foreground"}>
            피라미딩 {pyramiding_done ? "실행 완료 (1회 제한)" : "미실행"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label, value, sub, color, icon,
}: {
  label:  string;
  value:  string;
  sub?:   string;
  color:  string;
  icon?:  React.ReactNode;
}) {
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`font-bold tabular-nums text-sm ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

function PriceLine({
  icon, label, price, current, dangerBelow,
}: {
  icon:        React.ReactNode;
  label:       string;
  price:       number;
  current:     number;
  dangerBelow: boolean;
}) {
  const isDanger = dangerBelow ? current <= price * 1.03 : current >= price * 0.97;
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span className={`text-xs tabular-nums font-medium shrink-0 ${isDanger ? "text-yellow-400 font-bold" : "text-muted-foreground"}`}>
        {formatNumber(Math.round(price))}원{isDanger && " ⚠"}
      </span>
    </div>
  );
}
