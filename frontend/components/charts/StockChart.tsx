"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
} from "lightweight-charts";
import type { RSPoint } from "@/lib/server/relative-strength";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndicatorPoint {
  time: string;
  value: number;
}

interface StockChartProps {
  candles: Candle[];
  indicators?: Record<string, IndicatorPoint[]>;
  stopLoss?: number | null;
  takeProfit?: number | null;
  height?: number;
  /** 상대 강도 시계열 (기준=100). null이면 토글 버튼 숨김 */
  rsData?: RSPoint[] | null;
  /** RS 요약: { stock_return_1m, index_return_1m, rs_ratio, is_outperformer } */
  rsSummary?: {
    stock_return_1m: number;
    index_return_1m: number;
    rs_ratio: number;
    is_outperformer: boolean;
  } | null;
}

export function StockChart({
  candles,
  indicators = {},
  stopLoss,
  takeProfit,
  height = 420,
  rsData,
  rsSummary,
}: StockChartProps) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const rsContainerRef = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const rsChartRef     = useRef<IChartApi | null>(null);
  const [showMa, setShowMa] = useState(true);
  const [showBb, setShowBb] = useState(false);
  const [showRs, setShowRs] = useState(false);

  // ── 메인 캔들스틱 차트 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !candles.length) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", timeVisible: true },
      width: containerRef.current.clientWidth,
      height,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles as any);

    if (stopLoss) {
      candleSeries.createPriceLine({
        price: stopLoss,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "손절",
      });
    }
    if (takeProfit) {
      candleSeries.createPriceLine({
        price: takeProfit,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "목표",
      });
    }

    if (showMa) {
      const maColors: Record<string, string> = {
        ma5: "#60a5fa", ma20: "#f59e0b", ma60: "#a78bfa", ma120: "#f43f5e",
      };
      for (const [key, color] of Object.entries(maColors)) {
        if (indicators[key]?.length) {
          const s = chart.addSeries(LineSeries, {
            color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
          });
          s.setData(indicators[key] as any);
        }
      }
    }

    if (showBb && indicators.bb_upper?.length) {
      for (const key of ["bb_upper", "bb_mid", "bb_lower"] as const) {
        if (indicators[key]?.length) {
          const s = chart.addSeries(LineSeries, {
            color: "#8b5cf6",
            lineWidth: 1,
            lineStyle: key === "bb_mid" ? LineStyle.Solid : LineStyle.Dotted,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          s.setData(indicators[key] as any);
        }
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, [candles, indicators, stopLoss, takeProfit, showMa, showBb, height]);

  // ── 상대 강도(RS) 서브 차트 ───────────────────────────────────────────────
  useEffect(() => {
    if (!showRs || !rsData?.length || !rsContainerRef.current) return;

    const chart = createChart(rsContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      rightPriceScale: { borderColor: "#1e293b", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#1e293b", visible: false },
      width: rsContainerRef.current.clientWidth,
      height: 90,
    });

    const rsSeries = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    rsSeries.setData(rsData as any);

    // 기준선 (RS = 100, KOSPI와 동일 수익률)
    rsSeries.createPriceLine({
      price: 100,
      color: "#475569",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: "KOSPI",
      axisLabelVisible: false,
    });

    chart.timeScale().fitContent();
    rsChartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (rsContainerRef.current) chart.applyOptions({ width: rsContainerRef.current.clientWidth });
    });
    ro.observe(rsContainerRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, [showRs, rsData]);

  return (
    <div>
      {/* 토글 버튼 행 */}
      <div className="flex flex-wrap gap-2 mb-2">
        <button
          onClick={() => setShowMa((v) => !v)}
          className={`text-xs px-2 py-1 rounded transition-colors ${showMa ? "bg-blue-600/30 text-blue-400" : "text-muted-foreground hover:bg-white/5"}`}
        >
          이동평균
        </button>
        <button
          onClick={() => setShowBb((v) => !v)}
          className={`text-xs px-2 py-1 rounded transition-colors ${showBb ? "bg-purple-600/30 text-purple-400" : "text-muted-foreground hover:bg-white/5"}`}
        >
          볼린저밴드
        </button>
        {rsData && rsData.length > 0 && (
          <button
            onClick={() => setShowRs((v) => !v)}
            className={`text-xs px-2 py-1 rounded transition-colors ${showRs ? "bg-amber-600/30 text-amber-400" : "text-muted-foreground hover:bg-white/5"}`}
          >
            상대강도 (RS)
          </button>
        )}
        {stopLoss   && <span className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400">손절 {stopLoss.toLocaleString()}</span>}
        {takeProfit && <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400">목표 {takeProfit.toLocaleString()}</span>}
      </div>

      {/* 메인 차트 */}
      <div ref={containerRef} style={{ height }} />

      {/* RS 서브 차트 — showRs 토글 시 마운트 */}
      {showRs && rsData && rsData.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-amber-400 font-medium">상대 강도 (vs KOSPI, 기준=100)</span>
            {rsSummary && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${rsSummary.is_outperformer ? "bg-amber-400/15 text-amber-400" : "bg-slate-700 text-slate-400"}`}>
                종목 {rsSummary.stock_return_1m >= 0 ? "+" : ""}{rsSummary.stock_return_1m.toFixed(1)}%
                &nbsp;/&nbsp;
                KOSPI {rsSummary.index_return_1m >= 0 ? "+" : ""}{rsSummary.index_return_1m.toFixed(1)}%
                &nbsp;{rsSummary.is_outperformer ? "▲ 초과수익" : "▼ 미달"}
              </span>
            )}
          </div>
          <div ref={rsContainerRef} style={{ height: 90 }} />
        </div>
      )}
    </div>
  );
}

export function RsiChart({ data, height = 100 }: { data: IndicatorPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#64748b" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderColor: "#1e293b", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#1e293b", visible: false },
      width: containerRef.current.clientWidth,
      height,
    });

    const rsiSeries = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, priceLineVisible: false });
    rsiSeries.setData(data as any);
    rsiSeries.createPriceLine({ price: 70, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dotted, title: "", axisLabelVisible: false });
    rsiSeries.createPriceLine({ price: 30, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dotted, title: "", axisLabelVisible: false });
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [data, height]);

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">RSI (14)</div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}

export function MacdChart({ macd, signal, hist, height = 100 }: {
  macd: IndicatorPoint[]; signal: IndicatorPoint[]; hist: IndicatorPoint[]; height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !macd.length) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#64748b" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", visible: false },
      width: containerRef.current.clientWidth,
      height,
    });

    const histSeries = chart.addSeries(HistogramSeries, { color: "#3b82f6", priceLineVisible: false });
    histSeries.setData(hist.map((d) => ({ ...d, color: d.value >= 0 ? "#22c55e" : "#ef4444" })) as any);

    const macdLine = chart.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 1, priceLineVisible: false });
    macdLine.setData(macd as any);

    const sigLine = chart.addSeries(LineSeries, { color: "#f43f5e", lineWidth: 1, priceLineVisible: false });
    sigLine.setData(signal as any);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [macd, signal, hist, height]);

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">MACD (12,26,9)</div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
