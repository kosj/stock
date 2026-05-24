"use client";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatNumber, formatPercent, colorByChange } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { BrokerConfigManager } from "@/lib/apiConfig";

export function DashboardPage() {
  // KIS API 설정이 있으면 자동으로 사용
  const fetchIndices = async () => {
    const kisConfig = BrokerConfigManager.getBrokerConfig('kis');
    if (kisConfig) {
      return api.broker.indices('kis', kisConfig.appKey, kisConfig.appSecret);
    }
    return api.market.indices();
  };

  const { data: indicesRaw, isLoading: idxLoading, mutate: refreshIdx } = useSWR<any>(
    "market-indices",
    fetchIndices,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 0
    },
  );
  const indices = indicesRaw as any;

  const { data: portfoliosRaw, mutate: refreshPortfolios } = useSWR<any>(
    "portfolios",
    () => api.portfolio.list(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 0
    },
  );
  const portfolios = portfoliosRaw as any[];
  const firstPortfolioId = portfolios?.[0]?.id;
  const { data: summaryRaw } = useSWR<any>(
    firstPortfolioId ? `portfolio-summary-${firstPortfolioId}` : null,
    () => api.portfolio.summary(firstPortfolioId!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 0
    },
  );
  const summary = summaryRaw as any;

  const INDEX_MAP: Record<string, string> = {
    KOSPI: "코스피",
    KOSDAQ: "코스닥",
    "S&P500": "S&P500",
    NASDAQ: "나스닥",
    "달러/원": "USD/KRW",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">대시보드</h1>
        <button
          onClick={() => refreshIdx()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} />
          새로고침
        </button>
      </div>

      {/* 주요 지수 */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">주요 지수</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(INDEX_MAP).map(([key, label]) => {
            const d = (indices as any)?.[key];
            const change = d?.change_pct ?? 0;
            const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
            const colorClass = change > 0 ? "text-green-400" : change < 0 ? "text-red-400" : "text-muted-foreground";
            return (
              <Card key={key} className="p-3">
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                {idxLoading ? (
                  <div className="h-6 w-20 bg-muted animate-pulse rounded" />
                ) : (
                  <>
                    <div className="text-lg font-bold tabular-nums">
                      {formatNumber(d?.price, key === "달러/원" ? 1 : 0)}
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${colorClass}`}>
                      <Icon size={11} />
                      {formatPercent(change)}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* 포트폴리오 요약 */}
      {summary && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              포트폴리오 — {summary.name}
            </h2>
            <Link href="/portfolio" className="text-xs text-blue-400 hover:text-blue-300">
              전체 보기 →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "투자원금",   value: formatNumber(summary.total_invested) + "원" },
              { label: "평가금액",   value: formatNumber(summary.total_value) + "원" },
              {
                label: "손익",
                value: formatNumber(summary.total_pnl) + "원",
                color: colorByChange(summary.total_pnl),
              },
              {
                label: "수익률",
                value: formatPercent(summary.total_pnl_percent),
                color: colorByChange(summary.total_pnl_percent),
              },
            ].map(({ label, value, color }) => (
              <Card key={label} className="p-3">
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className={`text-lg font-bold tabular-nums ${color ?? ""}`}>{value}</div>
              </Card>
            ))}
          </div>

          {/* 알림 종목 */}
          {summary.positions?.some((p: any) => p.is_near_stop || p.is_near_target) && (
            <Card className="border-yellow-500/30">
              <div className="text-xs font-semibold text-yellow-400 mb-2">⚠ 알림 종목</div>
              {summary.positions
                .filter((p: any) => p.is_near_stop || p.is_near_target)
                .map((p: any) => (
                  <div key={p.position_id} className="flex items-center justify-between text-sm py-1">
                    <Link href={`/market/${p.ticker}`} className="font-medium hover:text-blue-400">
                      {p.name}
                    </Link>
                    {p.is_near_stop && (
                      <span className="text-xs text-red-400">손절가 근접 ({formatNumber(p.stop_loss)}원)</span>
                    )}
                    {p.is_near_target && (
                      <span className="text-xs text-green-400">목표가 근접 ({formatNumber(p.take_profit)}원)</span>
                    )}
                  </div>
                ))}
            </Card>
          )}
        </section>
      )}

      {/* 빠른 링크 */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">빠른 이동</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/portfolio",  label: "포트폴리오 관리",  desc: "보유 종목 현황 및 손익" },
            { href: "/market",     label: "시세 조회",        desc: "차트·재무·AI 분석" },
            { href: "/macro",      label: "거시경제 지표",    desc: "금리·환율·인플레이션" },
            { href: "/sectors",    label: "섹터 로테이션",    desc: "반도체·바이오·AI 동향" },
          ].map(({ href, label, desc }) => (
            <Link key={href} href={href}>
              <Card className="p-3 hover:border-blue-500/40 transition-colors cursor-pointer h-full">
                <div className="font-medium text-sm mb-0.5">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
