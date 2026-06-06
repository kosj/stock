"use client";

import { useState } from "react";
import {
  TrendingDown, TrendingUp, Minus,
  ChevronDown, ChevronUp,
  ShieldOff, Scissors, Flame,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { PositionAnalysisResult } from "@/lib/server/position-manager-service";

interface Props {
  result:            PositionAnalysisResult;
  /** 피라미딩 완료 표시 버튼 클릭 시 콜백 (notes에 [pyramided] 추가) */
  onMarkPyramided?:  () => void;
  markingPyramided?: boolean;
}

// ── 액션 유형별 스타일 설정 ───────────────────────────────────────────────────

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

// 매도 이유 분류
function isSellReason(reason: string): "stop_loss" | "trailing" | "take_profit" {
  if (reason.includes("[손절]"))           return "stop_loss";
  if (reason.includes("[트레일링"))        return "trailing";
  return "take_profit";
}

export function PositionActionBadge({ result, onMarkPyramided, markingPyramided }: Props) {
  const [open, setOpen] = useState(false);

  const { action, rsi, ma5, peak_price, pnl_pct, pyramiding_done } = result;
  const cfg = ACTION_CONFIG[action.type];

  // 액션 유형 아이콘 선택
  const Icon =
    action.type === "SELL" ? TrendingDown :
    action.type === "BUY"  ? Flame        : Minus;

  // 수량 표시 (HOLD는 수량 없음)
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
          className="absolute z-50 top-full left-0 mt-1 min-w-[300px] max-w-[340px] rounded-lg border shadow-xl p-3 space-y-2.5 text-xs"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">
              {result.name} <span className="text-muted-foreground font-normal">{result.ticker}</span>
            </span>
            <span className={`font-bold text-sm ${cfg.text}`}>
              {cfg.label} {qtyLabel}
            </span>
          </div>

          {/* 판단 근거 */}
          <div
            className={`rounded-md px-2.5 py-2 text-[11px] leading-relaxed ${cfg.bg} ${cfg.text}`}
          >
            {action.reason}
          </div>

          {/* 핵심 수치 그리드 */}
          <div className="grid grid-cols-3 gap-1.5">
            {/* 현재 수익률 */}
            <Metric
              label="현재 수익률"
              value={`${pnl_pct >= 0 ? "+" : ""}${pnl_pct.toFixed(2)}%`}
              color={pnl_pct >= 0 ? "text-green-400" : "text-red-400"}
            />
            {/* 고점 대비 하락률 */}
            <Metric
              label="고점 대비"
              value={`${action.meta.trailing_drop_pct.toFixed(2)}%`}
              color={action.meta.trailing_drop_pct <= -5 ? "text-red-400" : "text-muted-foreground"}
            />
            {/* RSI */}
            <Metric
              label="RSI 14"
              value={rsi !== null ? rsi.toFixed(1) : "—"}
              color={rsi !== null && rsi >= 75 ? "text-red-400" : rsi !== null && rsi <= 30 ? "text-green-400" : "text-muted-foreground"}
            />
          </div>

          {/* 기준가 요약 */}
          <div className="space-y-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">주요 기준가</div>
            <PriceLine
              label="손절 발동가 (−7%)"
              price={action.meta.stop_loss_price}
              current={result.current_price}
              dangerBelow
              icon={<ShieldOff size={10} className="text-red-400" />}
            />
            <PriceLine
              label={`트레일링 스탑 (고점 −8%, 고점: ${formatNumber(peak_price)})`}
              price={action.meta.trailing_stop_price}
              current={result.current_price}
              dangerBelow
              icon={<Scissors size={10} className="text-orange-400" />}
            />
            <PriceLine
              label="피라미딩 발동가 (+5%)"
              price={action.meta.pyramid_trigger_price}
              current={result.current_price}
              dangerBelow={false}
              icon={<Flame size={10} className="text-emerald-400" />}
            />
          </div>

          {/* MA5 정보 */}
          {ma5 !== null && (
            <div className="text-muted-foreground text-[10px]">
              MA5: <span className="tabular-nums text-foreground">{formatNumber(Math.round(ma5))}원</span>
              {result.current_price > ma5
                ? <span className="text-green-400 ml-1">▲ 현재가 위 (상승 추세)</span>
                : <span className="text-red-400 ml-1">▼ 현재가 아래</span>
              }
            </div>
          )}

          {/* 피라미딩 완료 표시 버튼 (BUY 추천일 때만) */}
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

          {/* 피라미딩 이미 완료된 경우 */}
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

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={`font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function PriceLine({
  label, price, current, dangerBelow, icon,
}: {
  label:      string;
  price:      number;
  current:    number;
  dangerBelow: boolean;
  icon?:      React.ReactNode;
}) {
  const isDanger = dangerBelow ? current <= price * 1.03 : current >= price * 0.97;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-muted-foreground/70 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span className={`tabular-nums font-medium shrink-0 ${isDanger ? "text-yellow-400 font-bold" : "text-muted-foreground"}`}>
        {formatNumber(price)}원
        {isDanger && " ⚠"}
      </span>
    </div>
  );
}
