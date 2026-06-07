"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import type { InvestorTrendResult } from "@/lib/server/investor-trend";

interface Props {
  data: InvestorTrendResult | null;
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <p className="font-medium mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className={`font-semibold ${p.value >= 0 ? "text-blue-400" : "text-red-400"}`}>
            {p.value >= 0 ? "+" : ""}{p.value.toFixed(1)}억원
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 수급 분석 카드 — 최근 5영업일 외국인/기관 순매수 막대그래프
 *
 * @remarks
 * 실전 활용 주의사항:
 * - 외국인 순매수가 3일 연속 양수이고 거래량이 증가 추세일 때 강한 수급 신호다.
 * - 기관은 단기 매매가 잦으므로 외국인과 기관 모두 순매수일 때 가장 신뢰도 높다.
 * - 프로그램 매매가 집중되는 선물옵션 만기주간에는 수급 신호가 왜곡될 수 있다.
 */
export function SupplyDemandCard({ data }: Props) {
  if (!data) return null;

  const days = data.days;

  if (days.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>수급 분석</CardTitle>
        </CardHeader>
        <div className="text-sm text-muted-foreground py-4 text-center">
          수급 데이터를 불러올 수 없습니다. (해외 종목 또는 데이터 없음)
        </div>
      </Card>
    );
  }

  // 5일 누적 순매수 계산
  const foreignTotal      = days.reduce((s, d) => s + d.foreign_net, 0);
  const institutionTotal  = days.reduce((s, d) => s + d.institution_net, 0);

  const summaryItems = [
    {
      label: "외국인 5일 누계",
      value: foreignTotal,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "기관 5일 누계",
      value: institutionTotal,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>수급 분석</CardTitle>
        <span className="text-xs text-muted-foreground">최근 5영업일 외국인/기관 순매수 (억원)</span>
      </CardHeader>

      {/* 누계 요약 */}
      <div className="flex gap-3 mb-4">
        {summaryItems.map(({ label, value, color, bg }) => (
          <div
            key={label}
            className={`flex-1 rounded-lg px-3 py-2 text-center ${bg}`}
          >
            <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
            <div className={`font-bold text-sm ${color}`}>
              {value >= 0 ? "+" : ""}{value.toFixed(1)}억원
            </div>
          </div>
        ))}
      </div>

      {/* 막대 그래프 */}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={days}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="30%"
          barGap={2}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(v: string) => v.slice(5)} // MM-DD만 표시
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}억`}
            width={45}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value: string) => (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{value}</span>
            )}
          />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
          <Bar dataKey="foreign_net" name="외국인" radius={[3, 3, 0, 0]}>
            {days.map((d) => (
              <Cell
                key={d.date}
                fill={d.foreign_net >= 0 ? "#3b82f6" : "#ef4444"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
          <Bar dataKey="institution_net" name="기관" radius={[3, 3, 0, 0]}>
            {days.map((d) => (
              <Cell
                key={d.date}
                fill={d.institution_net >= 0 ? "#f59e0b" : "#f87171"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-muted-foreground/50 mt-2">
        * Naver Finance 제공. 데이터 지연이 있을 수 있습니다.
      </p>
    </Card>
  );
}
