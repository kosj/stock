"use client";

import { useMemo, useState } from "react";
import {
  PiggyBank,
  Shield,
  ShieldAlert,
  BarChart2,
  TrendingUp,
  DollarSign,
  Calendar,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Target,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatNumber } from "@/lib/utils";
import {
  ACCOUNTS,
  ACCOUNT_ORDER,
  RISK_PROFILES,
  PORTFOLIOS,
  ETF_UNIVERSE,
  computeExpectedReturn,
  riskAssetWeight,
  assetBreakdown,
  projectGrowth,
  computeTaxBenefit,
  DCA_PLANS,
  type AccountType,
  type RiskProfile,
  type AssetClass,
  type GrowthPoint,
} from "@/lib/pension-portfolios";

// ─────────────────────────────────────────────────────────────────────────────

const ASSET_META: Record<AssetClass, { label: string; color: string }> = {
  equity: { label: "주식", color: "#3b82f6" },
  dividend: { label: "배당", color: "#8b5cf6" },
  bond: { label: "채권", color: "#10b981" },
  cash: { label: "현금성", color: "#64748b" },
  gold: { label: "금", color: "#f59e0b" },
};

const won = (n: number) => `${formatNumber(Math.round(n))}원`;
const eok = (n: number) => {
  // 억/만 단위 축약 (평가금액 요약용)
  if (Math.abs(n) >= 100_000_000) {
    const uk = Math.floor(n / 100_000_000);
    const man = Math.round((n % 100_000_000) / 10_000);
    return man > 0 ? `${uk}억 ${formatNumber(man)}만원` : `${uk}억원`;
  }
  if (Math.abs(n) >= 10_000) return `${formatNumber(Math.round(n / 10_000))}만원`;
  return won(n);
};

// ─────────────────────────────────────────────────────────────────────────────

export function PensionPage() {
  const [account, setAccount] = useState<AccountType>("pension");
  const [risk, setRisk] = useState<RiskProfile>("balanced");

  const portfolio = PORTFOLIOS[account][risk];
  const expectedReturn = useMemo(
    () => computeExpectedReturn(portfolio.holdings),
    [portfolio],
  );
  const riskWeight = useMemo(() => riskAssetWeight(portfolio.holdings), [portfolio]);
  const breakdown = useMemo(() => assetBreakdown(portfolio.holdings), [portfolio]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <header>
        <div className="flex items-center gap-2">
          <PiggyBank size={22} className="text-blue-400" />
          <h1 className="text-xl font-bold">연금·절세계좌 투자 가이드</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          ISA · 연금저축 · IRP · 퇴직연금(DC)에서 절세 효율을 극대화하는 모델 ETF 포트폴리오와
          비중, 장기 수익률 시뮬레이션, 적립식(분할매수) 가이드를 제공합니다.
        </p>
      </header>

      <Disclaimer />

      {/* ── 계좌 선택 탭 ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {ACCOUNT_ORDER.map((key) => {
          const a = ACCOUNTS[key];
          const active = key === account;
          return (
            <button
              key={key}
              onClick={() => setAccount(key)}
              className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      {/* ── 계좌 개요 ─────────────────────────────────────────────────────── */}
      <AccountOverview account={account} />

      {/* ── 위험성향 + 포트폴리오 ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionTitle icon={<BarChart2 size={16} />} title="추천 포트폴리오">
          <div className="flex gap-1.5">
            {(Object.keys(RISK_PROFILES) as RiskProfile[]).map((key) => {
              const r = RISK_PROFILES[key];
              const active = key === risk;
              return (
                <button
                  key={key}
                  onClick={() => setRisk(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </SectionTitle>

        <PortfolioCard
          account={account}
          risk={risk}
          expectedReturn={expectedReturn}
          riskWeight={riskWeight}
          breakdown={breakdown}
        />
      </section>

      {/* ── 장기 수익률 계산기 ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionTitle icon={<DollarSign size={16} />} title="장기 투자 수익률 시뮬레이션" />
        <ReturnCalculator account={account} defaultReturn={expectedReturn} />
      </section>

      {/* ── 분할매수 가이드 ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionTitle icon={<Calendar size={16} />} title="분할매수(적립식) 가이드" />
        <DcaGuide />
      </section>

      {/* ── 투자 방법 가이드 ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionTitle icon={<BookOpen size={16} />} title="투자 방법 가이드" />
        <MethodGuide />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 공통 소품
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="ml-auto">{children}</div>}
    </div>
  );
}

function Disclaimer() {
  return (
    <div
      className="flex gap-2.5 rounded-lg border p-3 text-xs leading-relaxed"
      style={{ borderColor: "var(--border)", background: "var(--muted)" }}
    >
      <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
      <p className="text-muted-foreground">
        본 화면은 <b className="text-foreground">교육·참고용 일반 정보</b>이며 특정 종목의 매수를
        권유하는 투자자문이 아닙니다. 모든 투자 판단과 책임은 투자자 본인에게 있으며 원금 손실이
        발생할 수 있습니다. 기대수익률은 과거 장기 평균에 근거한 <b className="text-foreground">가정치</b>로
        미래 수익을 보장하지 않으며, ETF 종목코드·보수·구성은 변경될 수 있으니 매수 전 최신 정보를
        확인하세요.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 계좌 개요
// ─────────────────────────────────────────────────────────────────────────────

function AccountOverview({ account }: { account: AccountType }) {
  const meta = ACCOUNTS[account];
  return (
    <Card>
      <div className="flex items-start gap-2 mb-3">
        <Shield size={18} className={meta.color} />
        <div>
          <h3 className="font-semibold text-sm">{meta.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.bestFor}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <InfoRow label="세제 혜택" value={meta.taxBenefit} highlight />
        <InfoRow label="납입 한도" value={meta.contributionLimit} />
      </div>

      {meta.riskAssetCap != null && (
        <div className="mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
          <ShieldAlert size={14} className="text-amber-400 shrink-0" />
          <span className="text-muted-foreground">
            위험자산 투자 한도 <b className="text-foreground">{Math.round(meta.riskAssetCap * 100)}%</b> —
            안전자산(채권·예금 등)을 최소 {Math.round((1 - meta.riskAssetCap) * 100)}% 편입해야 합니다.
          </span>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {meta.restrictions.map((r, i) => (
          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
            <span className="text-muted-foreground/50 mt-0.5">·</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: "var(--border)" }}>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-xs ${highlight ? "text-blue-400 font-medium" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 포트폴리오 카드
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioCard({
  account,
  risk,
  expectedReturn,
  riskWeight,
  breakdown,
}: {
  account: AccountType;
  risk: RiskProfile;
  expectedReturn: number;
  riskWeight: number;
  breakdown: Record<AssetClass, number>;
}) {
  const portfolio = PORTFOLIOS[account][risk];
  const profile = RISK_PROFILES[risk];
  const cap = ACCOUNTS[account].riskAssetCap;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`text-sm font-semibold ${profile.color}`}>{profile.label}</span>
        <Badge variant="blue">권장 보유기간 {profile.horizon}</Badge>
        <div className="ml-auto flex items-center gap-1.5 text-sm">
          <TrendingUp size={15} className="text-green-400" />
          <span className="text-muted-foreground">기대수익률</span>
          <b className="text-green-400">연 {expectedReturn.toFixed(1)}%</b>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{profile.desc}</p>
      <p className="text-xs text-muted-foreground mb-3">
        <b className="text-foreground">배분 콘셉트</b> · {portfolio.note}
      </p>

      {/* 자산군 비중 바 */}
      <AssetBar breakdown={breakdown} />

      {/* 위험자산 한도 표시 */}
      {cap != null && (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          위험자산 {riskWeight}% / 한도 {Math.round(cap * 100)}%
          {riskWeight <= cap * 100 ? (
            <span className="text-green-400"> · 규정 충족</span>
          ) : (
            <span className="text-red-400"> · 한도 초과</span>
          )}
        </p>
      )}

      {/* 종목 테이블 */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2 pr-2 font-medium">ETF</th>
              <th className="py-2 px-2 font-medium">종목코드</th>
              <th className="py-2 px-2 font-medium text-right">비중</th>
              <th className="py-2 pl-2 font-medium hidden sm:table-cell">역할</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((h) => {
              const etf = ETF_UNIVERSE[h.etf];
              const asset = ASSET_META[etf.assetClass];
              return (
                <tr key={h.etf} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ background: asset.color }}
                      />
                      <span className="font-medium">{etf.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground sm:hidden">{etf.role}</span>
                  </td>
                  <td className="py-2.5 px-2 text-muted-foreground tabular-nums">{etf.ticker}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums font-semibold">{h.weight}%</td>
                  <td className="py-2.5 pl-2 text-xs text-muted-foreground hidden sm:table-cell">{etf.role}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">
        ※ 표시된 총보수·종목코드는 참고치입니다. 동일 지수를 추종하는 타사 ETF(보수가 더 낮은 상품
        포함)로 대체할 수 있습니다.
      </p>
    </Card>
  );
}

function AssetBar({ breakdown }: { breakdown: Record<AssetClass, number> }) {
  const entries = (Object.keys(breakdown) as AssetClass[])
    .filter((k) => breakdown[k] > 0)
    .sort((a, b) => breakdown[b] - breakdown[a]);

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {entries.map((k) => (
          <div
            key={k}
            style={{ width: `${breakdown[k]}%`, background: ASSET_META[k].color }}
            title={`${ASSET_META[k].label} ${breakdown[k]}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {entries.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: ASSET_META[k].color }} />
            {ASSET_META[k].label} {breakdown[k]}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 장기 수익률 계산기
// ─────────────────────────────────────────────────────────────────────────────

function ReturnCalculator({
  account,
  defaultReturn,
}: {
  account: AccountType;
  defaultReturn: number;
}) {
  const [initialManwon, setInitialManwon] = useState(500); // 초기 투자금 (만원)
  const [monthlyManwon, setMonthlyManwon] = useState(50); // 월 적립 (만원)
  const [years, setYears] = useState(20);
  const [returnPct, setReturnPct] = useState<number | null>(null); // null = 포트폴리오 기대수익률 사용
  const [incomeUnder5500, setIncomeUnder5500] = useState(true);

  const effReturn = returnPct ?? defaultReturn;

  const series = useMemo<GrowthPoint[]>(
    () =>
      projectGrowth({
        initialAmount: initialManwon * 10_000,
        monthlyContribution: monthlyManwon * 10_000,
        years,
        annualReturnPct: effReturn,
      }),
    [initialManwon, monthlyManwon, years, effReturn],
  );

  const last = series[series.length - 1];
  const gain = last.value - last.principal;
  const gainPct = last.principal > 0 ? (gain / last.principal) * 100 : 0;

  const annualContribution = monthlyManwon * 10_000 * 12;
  const tax = useMemo(
    () =>
      computeTaxBenefit({
        account,
        annualContribution,
        years,
        totalGain: gain,
        incomeUnder5500,
      }),
    [account, annualContribution, years, gain, incomeUnder5500],
  );

  const meta = ACCOUNTS[account];

  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
        {/* 입력 */}
        <div className="space-y-3">
          <NumberField
            label="초기 투자금"
            unit="만원"
            value={initialManwon}
            onChange={setInitialManwon}
            step={100}
          />
          <NumberField
            label="월 적립액"
            unit="만원"
            value={monthlyManwon}
            onChange={setMonthlyManwon}
            step={10}
          />
          <NumberField label="투자 기간" unit="년" value={years} onChange={setYears} step={1} min={1} max={60} />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">연 기대수익률</label>
              {returnPct != null && (
                <button
                  onClick={() => setReturnPct(null)}
                  className="text-[11px] text-blue-400 hover:underline"
                >
                  포트폴리오값({defaultReturn.toFixed(1)}%)로
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={effReturn}
                onChange={(e) => setReturnPct(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-sm font-semibold tabular-nums w-14 text-right">
                {effReturn.toFixed(1)}%
              </span>
            </div>
          </div>

          {meta.taxDeductLimit != null && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={incomeUnder5500}
                onChange={(e) => setIncomeUnder5500(e.target.checked)}
                className="accent-blue-500"
              />
              총급여 5,500만원 이하 (세액공제 16.5%)
            </label>
          )}
        </div>

        {/* 결과 */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="납입 원금" value={eok(last.principal)} />
            <Stat label={`${years}년 후 예상 평가금액`} value={eok(last.value)} accent />
            <Stat label="투자 수익" value={eok(gain)} sub={`+${gainPct.toFixed(0)}%`} positive />
            <Stat label={tax.label} value={eok(tax.amount)} sub={tax.kind} positive />
          </div>

          <GrowthChart series={series} />

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <b className="text-foreground">{tax.label}:</b> {tax.detail}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        ※ 매월 말 정액 적립·월복리 가정. 세금·수수료·물가상승률은 단순화했으며, 세액공제 환급액은
        실제 납부세액 한도 내에서만 환급됩니다. 결과는 가정에 따른 추정치입니다.
      </p>
    </Card>
  );
}

function NumberField({
  label,
  unit,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="relative mt-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return onChange(min);
            const clamped = Math.max(min, max != null ? Math.min(max, n) : n);
            onChange(clamped);
          }}
          className="w-full pl-3 pr-12 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          style={{ borderColor: "var(--border)" }}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--border)" }}>
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className={`text-base font-bold mt-0.5 tabular-nums ${accent ? "text-blue-400" : positive ? "text-green-400" : ""}`}>
        {value}
      </p>
      {sub && <p className={`text-[11px] ${positive ? "text-green-400" : "text-muted-foreground"}`}>{sub}</p>}
    </div>
  );
}

// ── 성장 곡선 (자체 SVG) ─────────────────────────────────────────────────────

function GrowthChart({ series }: { series: GrowthPoint[] }) {
  const W = 680;
  const H = 200;
  const pad = { t: 12, r: 12, b: 22, l: 12 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const years = series[series.length - 1].year || 1;
  const maxV = Math.max(...series.map((p) => p.value), 1);

  const x = (yr: number) => pad.l + (yr / years) * innerW;
  const y = (v: number) => pad.t + innerH - (v / maxV) * innerH;

  const valuePath = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${valuePath} L ${x(years).toFixed(1)} ${(pad.t + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;
  const principalPath = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year).toFixed(1)} ${y(p.principal).toFixed(1)}`)
    .join(" ");

  const ticks = [0, Math.round(years / 2), years].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="적립 성장 곡선">
        <defs>
          <linearGradient id="pensionArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#pensionArea)" />
        <path d={valuePath} fill="none" stroke="#3b82f6" strokeWidth="2" />
        <path d={principalPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 6} fontSize="10" fill="#94a3b8" textAnchor={t === 0 ? "start" : t === years ? "end" : "middle"}>
            {t}년
          </text>
        ))}
      </svg>
      <div className="flex gap-4 justify-center mt-1">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block w-3 h-0.5 bg-blue-500" /> 평가금액
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block w-3 h-0.5" style={{ background: "#94a3b8" }} /> 납입 원금
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 분할매수(적립식) 가이드
// ─────────────────────────────────────────────────────────────────────────────

function DcaGuide() {
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Target size={15} className="text-blue-400" />
          왜 정액 분할매수(적립식)인가
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          매월 <b className="text-foreground">같은 금액</b>을 기계적으로 투자하면, 가격이 쌀 때 더 많은
          수량을, 비쌀 때 더 적은 수량을 사게 되어 평균 매입단가가 낮아집니다(코스트 애버리징).
          시점 선택(마켓 타이밍) 부담과 고점 매수 위험을 줄이는 장기 적립의 핵심 원리입니다.
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold mb-1">목표별 권장 적립 스케줄</h3>
        <p className="text-xs text-muted-foreground mb-3">
          급여일 다음 날 <b className="text-foreground">자동이체</b>로 설정해 “먼저 투자하고 남은 돈을 쓰는”
          구조를 만드는 것을 권장합니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-2 pr-2 font-medium">목표</th>
                <th className="py-2 px-2 font-medium text-right">연 납입</th>
                <th className="py-2 px-2 font-medium text-right">월 적립</th>
                <th className="py-2 pl-2 font-medium hidden sm:table-cell">비고</th>
              </tr>
            </thead>
            <tbody>
              {DCA_PLANS.map((p) => (
                <tr key={p.goal} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2.5 pr-2 font-medium">{p.goal}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(p.annual / 10_000)}만원
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-blue-400">
                    {formatNumber(Math.round(p.monthly / 10_000))}만원
                  </td>
                  <td className="py-2.5 pl-2 text-xs text-muted-foreground hidden sm:table-cell">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <TipCard
          title="주기: 매월 정액 적립"
          points={[
            "월 1회 자동이체가 가장 단순하고 실행력이 높음",
            "적립 횟수가 잦을수록(주간 등) 평균화 효과는 커지지만 실익 차이는 미미",
            "연말에 몰아넣기보다 연초부터 매월 나눠 넣어야 과세이연·복리 기간이 길어짐",
          ]}
        />
        <TipCard
          title="금액: 소득의 일정 비율"
          points={[
            "생활비를 제외한 여유자금 내에서, 세액공제 한도(월 75만원)를 1차 목표로",
            "부담되면 월 10~30만원으로 시작해 소득 증가에 맞춰 증액",
            "비상금 3~6개월치를 먼저 확보한 뒤 적립 시작",
          ]}
        />
        <TipCard
          title="하락장 대응"
          points={[
            "지수가 급락해도 적립을 멈추지 않는 것이 핵심(싸게 담는 구간)",
            "여유가 있으면 급락 시 1~2회분을 추가 매수(밸류 애버리징)",
            "개별 종목이 아닌 지수 ETF이므로 ‘물타기’가 아니라 정상 적립",
          ]}
        />
        <TipCard
          title="목돈이 있을 때"
          points={[
            "한 번에 넣기 부담되면 6~12개월에 나눠 분할 진입해 고점 리스크 완화",
            "역사적으로는 일시 투자 기대수익이 약간 높지만, 분할이 심리적 안정에 유리",
            "연금계좌는 연 납입한도가 있으므로 목돈은 ISA·일반계좌와 병행",
          ]}
        />
      </div>
    </div>
  );
}

function TipCard({ title, points }: { title: string; points: string[] }) {
  return (
    <Card>
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      <ul className="space-y-1.5">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
            <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 투자 방법 가이드
// ─────────────────────────────────────────────────────────────────────────────

const METHOD_STEPS: { step: string; title: string; body: string }[] = [
  {
    step: "1",
    title: "계좌 납입 우선순위를 지킨다",
    body:
      "① 연금저축 600만원 → ② IRP 추가 300만원(합산 세액공제 900만원 완성) → ③ ISA 비과세 한도 → ④ 일반계좌 순으로 채웁니다. 세제 혜택이 큰 계좌부터 채우는 것이 가장 확실한 ‘무위험 수익’입니다.",
  },
  {
    step: "2",
    title: "지수 ETF로 폭넓게 분산한다",
    body:
      "개별 종목 대신 미국·전세계 지수 ETF를 코어로, 배당·채권·금을 위성으로 두어 국가·자산·통화를 분산합니다. 연금계좌는 TR(토탈리턴)형·저보수 ETF를 활용하면 분배금 재투자와 비용 면에서 유리합니다.",
  },
  {
    step: "3",
    title: "매월 자동이체로 적립한다",
    body:
      "위 분할매수 가이드대로 급여일 직후 정액 자동이체를 설정해 감정 개입 없이 꾸준히 매수합니다. 시장을 예측해 타이밍을 재기보다 ‘시간을 사는’ 전략이 장기적으로 유리합니다.",
  },
  {
    step: "4",
    title: "연 1회 리밸런싱한다",
    body:
      "목표 비중에서 ±5%p 이상 벗어나면 원래 비중으로 되돌립니다(예: 연말·생일 등 고정일). 오른 자산을 팔고 덜 오른 자산을 사는 규율이 자동으로 ‘고가 매도·저가 매수’를 실행합니다. 연금계좌 내 매매는 과세이연되어 리밸런싱 세금 부담이 없습니다.",
  },
  {
    step: "5",
    title: "인출은 연금으로 천천히",
    body:
      "만 55세 이후·가입 5년 경과 시 연금으로 수령하면 3.3~5.5% 저율 연금소득세만 냅니다. 연 1,500만원 이하로 나눠 수령하면 종합과세를 피할 수 있습니다. 중도 해지(일시 인출)는 16.5% 기타소득세로 혜택이 사라지므로 지양합니다.",
  },
];

function MethodGuide() {
  return (
    <div className="space-y-2.5">
      {METHOD_STEPS.map((s) => (
        <Card key={s.step} className="flex gap-3">
          <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 font-bold text-sm flex items-center justify-center">
            {s.step}
          </span>
          <div>
            <h4 className="text-sm font-semibold">{s.title}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">{s.body}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
