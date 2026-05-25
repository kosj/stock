"use client";
import { CheckCircle2, XCircle, TrendingDown } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import type { PullbackResult } from "@/lib/server/pullback-analysis";

interface Props {
  result: PullbackResult | null;
  loading?: boolean;
}

const SIGNAL_CONFIG = {
  strong:   { label: "강한 눌림목", bg: "bg-emerald-500/15", text: "text-emerald-400", bar: "bg-emerald-500" },
  moderate: { label: "눌림목 탐지", bg: "bg-blue-500/15",    text: "text-blue-400",    bar: "bg-blue-500"    },
  weak:     { label: "약한 신호",   bg: "bg-yellow-500/15",  text: "text-yellow-400",  bar: "bg-yellow-500"  },
  none:     { label: "신호 없음",   bg: "bg-muted",           text: "text-muted-foreground", bar: "bg-muted-foreground" },
};

export function PullbackCard({ result, loading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown size={15} className="text-blue-400" />
          눌림목 패턴 분석
        </CardTitle>
      </CardHeader>

      {loading && (
        <div className="py-8 text-center text-muted-foreground text-sm animate-pulse">
          패턴 분석 중...
        </div>
      )}

      {!loading && !result && (
        <div className="py-6 text-center text-muted-foreground text-sm">
          데이터를 불러오지 못했습니다.
        </div>
      )}

      {!loading && result && (
        <div className="space-y-4">
          {result.insufficient_data ? (
            <div className="py-4 text-center text-muted-foreground text-sm">
              차트 데이터가 부족합니다 (최소 30거래일 필요).
            </div>
          ) : (
            <>
              {/* 신호 + 점수 */}
              <div className="flex items-center gap-3">
                {(() => {
                  const cfg = SIGNAL_CONFIG[result.signal];
                  return (
                    <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${cfg.bg} ${cfg.text}`}>
                      <TrendingDown size={13} />
                      {cfg.label}
                    </span>
                  );
                })()}
                <div className="text-2xl font-bold">
                  {result.score}
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
              </div>

              {/* 점수 바 */}
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${SIGNAL_CONFIG[result.signal].bar}`}
                  style={{ width: `${result.score}%` }}
                />
              </div>

              {/* 2컬럼: 4단계 필터 | 핵심 지표 */}
              <div className="grid md:grid-cols-2 gap-4 pt-1">
                {/* 4단계 필터 */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">4단계 필터링</div>
                  {result.stages.map((s) => (
                    <div key={s.stage} className="flex items-start gap-2">
                      {s.pass
                        ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                        : <XCircle     size={14} className="text-muted-foreground/40 shrink-0 mt-0.5" />
                      }
                      <div className="min-w-0">
                        <div className={`text-xs font-medium ${s.pass ? "" : "text-muted-foreground"}`}>
                          {s.stage}단계 · {s.label}
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5 break-words">
                          {s.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 핵심 지표 */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">핵심 지표</div>
                  <div className="grid grid-cols-2 gap-2">
                    {result.ma20_distance_pct != null && (
                      <Metric
                        label="20일선 이격"
                        value={`${result.ma20_distance_pct > 0 ? "+" : ""}${result.ma20_distance_pct.toFixed(1)}%`}
                        color={result.ma20_distance_pct >= 0 && result.ma20_distance_pct <= 3
                          ? "text-emerald-400"
                          : result.ma20_distance_pct > 3
                          ? "text-yellow-400"
                          : "text-red-400"}
                      />
                    )}
                    {result.rsi != null && (
                      <Metric
                        label="RSI"
                        value={result.rsi.toFixed(1)}
                        color={result.rsi >= 35 && result.rsi <= 60
                          ? "text-blue-400"
                          : result.rsi < 35
                          ? "text-emerald-400"
                          : "text-yellow-400"}
                      />
                    )}
                    {result.volume_surge_ratio != null && (
                      <Metric
                        label="기준봉 거래량"
                        value={`${result.volume_surge_ratio.toFixed(1)}배`}
                        color="text-yellow-400"
                      />
                    )}
                    {result.volume_decline_ratio != null && (
                      <Metric
                        label="현재 거래량"
                        value={`${result.volume_decline_ratio.toFixed(0)}%`}
                        color={result.volume_decline_ratio <= 30 ? "text-emerald-400" : "text-yellow-400"}
                        sub="기준봉 대비"
                      />
                    )}
                    {result.ma20 != null && (
                      <Metric
                        label="20일선"
                        value={result.ma20.toLocaleString("ko-KR")}
                        color="text-foreground"
                      />
                    )}
                    {result.base_candle_date && (
                      <Metric
                        label="기준봉 발생"
                        value={`${result.base_candle_days_ago}일 전`}
                        sub={result.base_candle_date}
                        color="text-foreground"
                      />
                    )}
                  </div>

                  {/* OBV 다이버전스 알림 */}
                  {result.obv_divergence && (
                    <div className="mt-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-400">
                      OBV 다이버전스 감지 — 주가 하락 중 거래량 유지 (매집 가능성)
                    </div>
                  )}

                  {/* 20일선 추세 */}
                  {result.ma20_trending_up != null && (
                    <div className={`text-xs mt-1 ${result.ma20_trending_up ? "text-emerald-400" : "text-red-400"}`}>
                      20일선 {result.ma20_trending_up ? "우상향 ↗" : "하락 ↘"}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}
