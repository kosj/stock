"use client";

import { useState } from "react";
import { ExternalLink, Phone, MapPin, Calendar, Users, Building2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";

function SummarySection({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = summary.length > 200;
  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="text-xs text-muted-foreground mb-1.5 font-medium">사업 내용</div>
      <p className={`text-sm text-muted-foreground leading-relaxed ${!expanded && isLong ? "line-clamp-4" : ""}`}>
        {summary}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {expanded ? <><ChevronUp size={12} /> 접기</> : <><ChevronDown size={12} /> 더 보기</>}
        </button>
      )}
    </div>
  );
}
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatNumber } from "@/lib/utils";
import type { DartCompanyInfo } from "@/lib/server/dart";
import { formatEstDate, formatCorpCls } from "@/lib/server/dart";
import type { FinancialsData } from "@/lib/server/yahoo-finance";

interface Props {
  ticker:     string;
  dart:       (DartCompanyInfo & { available?: boolean; reason?: string }) | null;
  financials: FinancialsData | null;
  loading:    boolean;
}

// ── KSIC 업종코드 → 한국어 업종명 (주요 코드만) ────────────────────────────────
const KSIC_MAP: Record<string, string> = {
  "264": "반도체 제조",
  "261": "전자부품 제조",
  "265": "통신·방송 장비 제조",
  "301": "자동차 제조",
  "621": "소프트웨어 개발·공급",
  "631": "자료 처리·DB·온라인 정보",
  "651": "금융지주회사",
  "641": "예금취급 금융기관",
  "642": "신탁업",
  "721": "연구개발업",
  "201": "화학제품 제조",
  "241": "1차 금속 제조",
  "243": "금속구조물 제조",
  "271": "의약품 제조",
  "521": "소매업",
  "611": "유선통신업",
  "612": "무선통신업",
  "351": "선박 제조",
  "312": "무기·총포탄 제조",
};

function getIndustryName(code: string | null, sector: string | null): string | null {
  if (!code) return sector ?? null;
  const prefix3 = code.slice(0, 3);
  const prefix2 = code.slice(0, 2);
  return KSIC_MAP[prefix3] ?? KSIC_MAP[prefix2] ?? sector ?? `KSIC ${code}`;
}

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

export function CompanyOverviewCard({ ticker, dart, financials, loading }: Props) {
  const hasDart = dart?.available !== false && !!dart?.corp_code;

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>기업 개요</CardTitle></CardHeader>
        <div className="px-4 pb-4 space-y-2">
          {[60, 45, 80, 35].map((w, i) => (
            <div key={i} className="h-4 bg-white/5 rounded animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Card>
    );
  }

  // 표시 데이터 병합 (DART 우선, Yahoo 폴백)
  const corpName  = dart?.corp_name  || financials?.name || ticker;
  const ceo       = dart?.ceo_nm     || null;
  const address   = dart?.adres      || null;
  const phone     = dart?.phn_no     || null;
  const website   = normalizeUrl(dart?.hm_url || null);
  const estDt     = formatEstDate(dart?.est_dt ?? null);
  const accMt     = dart?.acc_mt ? `${parseInt(dart.acc_mt)}월` : null;
  const corpCls   = hasDart ? formatCorpCls(dart?.corp_cls ?? null) : null;
  const industry  = getIndustryName(dart?.induty_code ?? null, financials?.industry ?? null);
  const employees = financials?.employees;
  const marketCap = financials?.market_cap;
  const summary   = financials?.summary;

  const infoGrid: { icon: React.ReactNode; label: string; value: string | null }[] = [
    { icon: <Users     size={12} />, label: "대표이사",   value: ceo },
    { icon: <Calendar  size={12} />, label: "설립일",     value: estDt },
    { icon: <Building2 size={12} />, label: "결산월",     value: accMt },
    { icon: <Building2 size={12} />, label: "법인 구분",  value: corpCls },
    { icon: <TrendingUp size={12}/>, label: "업종",       value: industry },
    {
      icon: <Users size={12} />,
      label: "직원 수",
      value: employees ? `약 ${formatNumber(employees)}명` : null,
    },
    {
      icon: <TrendingUp size={12} />,
      label: "시가총액",
      value: marketCap
        ? marketCap >= 1e12
          ? `${(marketCap / 1e12).toFixed(1)}조`
          : `${(marketCap / 1e8).toFixed(0)}억`
        : null,
    },
    { icon: <Calendar size={12} />, label: "다음 실적", value: financials?.next_earnings_date ?? null },
  ].filter(i => i.value);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>기업 개요</CardTitle>
          {hasDart && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/15 text-blue-300 font-medium">
              DART
            </span>
          )}
          {financials && !hasDart && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-white/8 text-muted-foreground">
              Yahoo Finance
            </span>
          )}
        </div>
      </CardHeader>

      <div className="px-4 pb-4 space-y-4">

        {/* 회사명 + 섹터 */}
        <div>
          <div className="text-base font-semibold">{corpName}</div>
          {financials?.sector && (
            <div className="text-xs text-muted-foreground mt-0.5">{financials.sector}</div>
          )}
        </div>

        {/* 주요 정보 그리드 */}
        {infoGrid.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
            {infoGrid.map(({ icon, label, value }) => (
              <div key={label} className="flex items-start gap-1.5 min-w-0">
                <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-sm font-medium truncate" title={value ?? ""}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 주소 */}
        {address && (
          <div className="flex items-start gap-1.5">
            <MapPin size={12} className="text-muted-foreground mt-0.5 shrink-0" />
            <span className="text-sm text-muted-foreground">{address}</span>
          </div>
        )}

        {/* 연락처 */}
        <div className="flex flex-wrap gap-4">
          {phone && (
            <div className="flex items-center gap-1.5">
              <Phone size={12} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{phone}</span>
            </div>
          )}
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors min-w-0"
            >
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </span>
            </a>
          )}
        </div>

        {/* 사업 내용 */}
        {summary && (
          <SummarySection summary={summary} />
        )}

        {!hasDart && !financials && (
          <p className="text-sm text-muted-foreground/50">기업 정보를 불러올 수 없습니다.</p>
        )}

        {!hasDart && (
          <p className="text-xs text-muted-foreground/40">
            {dart?.reason && dart.reason !== "국내 6자리 종목코드만 지원"
              ? `DART 조회 실패: ${dart.reason}`
              : "DART 데이터 미설정 — Vercel 환경변수 DART_API_KEY 등록 시 대표이사·설립일·주소 등 상세 정보가 표시됩니다."}
          </p>
        )}
      </div>
    </Card>
  );
}
