"use client";

import { useState } from "react";
import {
  TrendingDown, TrendingUp, Minus,
  ChevronDown, ChevronUp,
  ShieldOff, Scissors, Flame, Activity,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { PositionAnalysisResult } from "@/lib/server/position-manager-service";

interface Props {
  result:            PositionAnalysisResult;
  onMarkPyramided?:  () => void;
  markingPyramided?: boolean;
}

const ACTION_CONFIG = {
  SELL: {
    bg:     "bg-red-500/15",
    border: "border-red-500/30",
    text:   "text-red-400",
    label:  "매도",
  },
  BUY: {
    bg:     "bg-emerald-500/15",
    border: "border-emerald-500/30",
    text:   "text-emerald-400",
    label:  "매수",
  },
  HOLD: {
    bg:     "bg-muted",
    border: "border-transparent",
    text:   "text-muted-foreground",
    label:  "보유",
  },
} as const;

export function PositionActionBadge({ result, onMarkPyramided, markingPyramided }: Props) {
  const [open, setOpen] = useState(false);

  const { action, rsi, ma5, peak_price, gross_pnl_pct, net_pnl_pct, atr_pct, volume_ratio, pyramiding_done } = result;
  const cfg     = ACTION_CONFIG[action.type];
  const { meta } = action;
  const config  = meta.config;

  const Icon =
    action.type === "SELL" ? TrendingDown :
    action.type === "BUY"  ? Flame        : Minus;

  const qtyLabel = action.quantity > 0 ? `${action.quantity}주` : "";

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium transition-colors whitespace-nowrap ${cfg.bg} ${cfg.border} ${cfg.text}`}
      >
        <Icon size={11} />
        <span>{cfg.label}</span>
        {qtyLabel && <span className="tabular-nums opacity-80">{qtyLabel}</span>}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 min-w-[320px] max-w-[360px] rounded-lg border shadow-xl p-3 space-y-2.5 text-xs"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">
              {result.name}{" "}
              <span className="text-muted-foreground font-normal">{result.ticker}</span>
            </span>
            <span className={`font-bold text-sm ${cfg.text}`}>
              {cfg.label} {qtyLabel}
            </span>
          </div>

          {/* ATR 변동성 배지 */}
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Activity size={10} />
            <span>ATR(14) 변동성</span>
            <span className="font-semibold text-foreground">{atr_pct.toFixed(2)}%</span>
            <span className="opacity-60">·</span>
            <span>임계값 자동 조정됨</span>
          </div>

          {/* 판단 근거 */}
          <div className={`rounded-md px-2.5 py-2 text-[11px] leading-relaxed ${cfg.bg} ${cfg.text}`}>
            {action.reason}
          </div>

          {/* 핵심 수치 그리드 */}
          <div className="grid grid-cols-3 gap-1.5">
            {/* 세후 순수익률 */}
            <Metric
              label="순수익률(세후)"
              value={`${net_pnl_pct >= 0 ? "+" : ""}${net_pnl_pct.toFixed(2)}%`}
              color={net_pnl_pct >= 0 ? "text-green-400" : "text-red-400"}
              sub={`세전 ${gross_pnl_pct >= 0 ? "+" : ""}${gross_pnl_pct.toFixed(2)}%`}
            />
            {/* 고점 대비 하락률 */}
            <Metric
              label="고점 대비"
              value={`${meta.trailing_drop_pct.toFixed(2)}%`}
              color={meta.trailing_drop_pct <= config.trailing_stop_pct * 0.8 ? "text-red-400" : "text-muted-foreground"}
              sub={`기준 ${config.trailing_stop_pct.toFixed(1)}%`}
            />
            {/* RSI */}
            <Metric
              label="RSI 14"
              value={rsi !== null ? rsi.toFixed(1) : "—"}
              color={
                rsi !== null && rsi >= 75 ? "text-red-400" :
                rsi !== null && rsi <= 30 ? "text-green-400" :
                "text-muted-foreground"
              }
              sub={rsi !== null && rsi >= 75 ? "과매수" : rsi !== null && rsi <= 30 ? "과매도" : "보통"}
            />
          </div>

          {/* 거래량 정보 (피라미딩 관련) */}
          {volume_ratio !== null && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground">거래량 비율</span>
              <span className={`font-semibold tabular-nums ${volume_ratio >= 1.5 ? "text-emerald-400" : "text-muted-foreground"}`}>
                {volume_ratio.toFixed(2)}배
              </span>
              <span className="text-muted-foreground opacity-60">
                {volume_ratio >= 1.5 ? "▲ 거래량 급증 (피라미딩 조건 충족)" : "(기준 1.5배 미달)"}
              </span>
            </div>
          )}

          {/* ATR 기반 동적 임계값 */}
          <div className="space-y-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
              ATR 기반 동적 임계값 (ATR% {atr_pct.toFixed(2)})
            </div>
            <PriceLine
              label={`손절 (${config.stop_loss_pct.toFixed(1)}% = 2×ATR)`}
              price={meta.stop_loss_price}
              current={result.current_price}
              dangerBelow
              icon={<ShieldOff size={10} className="text-red-400" />}
            />
            <PriceLine
              label={`트레일링 (고점 ${config.trailing_stop_pct.toFixed(1)}% = 2.5×ATR, 고점: ${formatNumber(peak_price)})`}
              price={meta.trailing_stop_price}
              current={result.current_price}
              dangerBelow
              icon={<Scissors size={10} className="text-orange-400" />}
            />
            <PriceLine
              label={`익절 (${config.take_profit_pct.toFixed(1)}% = 3×ATR)`}
              price={result.avg_price * (1 + config.take_profit_pct / 100)}
              current={result.current_price}
              dangerBelow={false}
              icon={<TrendingUp size={10} className="text-yellow-400" />}
            />
            <PriceLine
              label={`피라미딩 (${config.pyramiding_pct.toFixed(1)}% = 1×ATR)`}
              price={meta.pyramid_trigger_price}
              current={result.current_price}
              dangerBelow={false}
              icon={<Flame size={10} className="text-emerald-400" />}
            />
          </div>

          {/* MA5 정보 */}
          {ma5 !== null && (
            <div className="text-muted-foreground text-[10px]">
              MA5{" "}
              <span className="tabular-nums text-foreground">{formatNumber(Math.round(ma5))}원</span>
              {result.current_price > ma5
                ? <span className="text-green-400 ml-1">▲ 현재가 위 (단기 상승 추세)</span>
                : <span className="text-red-400 ml-1">▼ 현재가 아래</span>
              }
            </div>
          )}

          {/* 피라미딩 완료 표시 버튼 */}
          {action.type === "BUY" && !pyramiding_done && onMarkPyramided && (
            <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={onMarkPyramided}
                disabled={markingPyramided}
                className="w-full text-[11px] py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 border border-emerald-500/30 transition-colors disabled:opacity-50"
              >
                {markingPyramided ? "처리 중…" : "피라미딩 실행 완료 표시 (이후 재추천 방지)"}
              </button>
            </div>
          )}

          {pyramiding_done && (
            <div className="text-[10px] text-muted-foreground/60">
              이 종목은 피라미딩이 이미 실행되었습니다 (1회 제한).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 하위 컴포넌트 ─────────────────────────────────────────────────────────────

function Metric({
  label, value, color, sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?:  string;
}) {
  return (
    <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={`font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-muted-foreground/60 text-[9px] mt-0.5">{sub}</div>}
    </div>
  );
}

function PriceLine({
  label, price, current, dangerBelow, icon,
}: {
  label:       string;
  price:       number;
  current:     number;
  dangerBelow: boolean;
  icon?:       React.ReactNode;
}) {
  const isDanger = dangerBelow
    ? current <= price * 1.03
    : current >= price * 0.97;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-muted-foreground/70 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span
        className={`tabular-nums font-medium shrink-0 ${isDanger ? "text-yellow-400 font-bold" : "text-muted-foreground"}`}
      >
        {formatNumber(Math.round(price))}원{isDanger && " ⚠"}
      </span>
    </div>
  );
}
