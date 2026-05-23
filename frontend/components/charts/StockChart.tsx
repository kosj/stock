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
}

export function StockChart({
  candles,
  indicators = {},
  stopLoss,
  takeProfit,
  height = 420,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [showMa, setShowMa] = useState(true);
  const [showBb, setShowBb] = useState(false);

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

    // 캔들스틱 (v5 API)
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

    // 이동평균선
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

    // 볼린저 밴드
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

  return (
    <div>
      <div className="flex gap-2 mb-2">
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
        {stopLoss && <span className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400">손절 {stopLoss.toLocaleString()}</span>}
        {takeProfit && <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400">목표 {takeProfit.toLocaleString()}</span>}
      </div>
      <div ref={containerRef} style={{ height }} />
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
