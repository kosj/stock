"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";

export function MacroPage() {
  const { data, isLoading, mutate } = useSWR(
    "macro-dashboard",
    () => api.macro.dashboard(),
    { revalidateOnFocus: false },
  );

  const d = data as any;

  const GROUPS = [
    {
      title: "금리",
      items: [
        { key: "us_fed_rate",  label: "미국 기준금리" },
        { key: "us_10y_yield", label: "미국 10년물" },
        { key: "kr_base_rate", label: "한국 기준금리" },
      ],
    },
    {
      title: "환율",
      items: [
        { key: "usd_krw", label: "달러/원" },
        { key: "eur_usd", label: "유로/달러" },
      ],
    },
    {
      title: "인플레이션 (CPI)",
      items: [
        { key: "us_cpi", label: "미국 CPI" },
        { key: "kr_cpi", label: "한국 CPI" },
      ],
    },
    {
      title: "증시 지수",
      items: [
        { key: "kospi",  label: "코스피" },
        { key: "kosdaq", label: "코스닥" },
        { key: "sp500",  label: "S&P 500" },
        { key: "nasdaq", label: "나스닥" },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">거시경제 지표</h1>
          <p className="text-sm text-muted-foreground mt-0.5">금리·환율·인플레이션·증시 지수</p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array(8).fill(0).map((_, i) => (
            <Card key={i} className="h-32 animate-pulse" />
          ))}
        </div>
      )}

      {d && GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {group.title}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.items.map(({ key, label }) => {
              const item = d[key];
              if (!item) return null;
              return (
                <MacroCard key={key} label={label} item={item} />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function MacroCard({ label, item }: { label: string; item: any }) {
  const isPositive = (item.change ?? 0) >= 0;
  const series = item.series?.slice(-30) ?? [];

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold tabular-nums mt-0.5">
            {formatNumber(item.value, 2)} <span className="text-sm text-muted-foreground">{item.unit}</span>
          </div>
        </div>
        <div className={`text-sm font-medium text-right ${colorByChange(item.change)}`}>
          <div>{item.change >= 0 ? "+" : ""}{item.change?.toFixed(3)}</div>
          <div className="text-xs">{item.date}</div>
        </div>
      </div>

      {series.length > 2 && (
        <ResponsiveContainer width="100%" height={60}>
          <LineChart data={series} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Line
              type="monotone"
              dataKey="value"
              stroke={isPositive ? "#22c55e" : "#ef4444"}
              dot={false}
              strokeWidth={1.5}
            />
            <Tooltip
              contentStyle={{ background: "#0d1829", border: "1px solid #1e293b", fontSize: 11 }}
              labelFormatter={(l) => l}
              formatter={(v: any) => [v.toFixed(3), ""]}
            />
            <XAxis dataKey="date" hide />
            <YAxis hide domain={["auto", "auto"]} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
