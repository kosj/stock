import Anthropic from "@anthropic-ai/sdk";
import type { FinancialsData } from "./yahoo-finance";

// ── 규칙 기반 스코어링 ──────────────────────────────────────────────────────

function calcValuation(f: FinancialsData): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  const { per, pbr, roe } = f;

  if (per != null) {
    if (per < 0)       { score -= 5;  notes.push(`PER 음수 (${per.toFixed(1)}) - 적자`); }
    else if (per < 10) { score += 10; notes.push(`PER ${per.toFixed(1)} - 저평가`); }
    else if (per < 15) { score += 6;  notes.push(`PER ${per.toFixed(1)} - 적정`); }
    else if (per < 25) { score += 2;  notes.push(`PER ${per.toFixed(1)} - 다소 고평가`); }
    else if (per < 40) { score -= 3;  notes.push(`PER ${per.toFixed(1)} - 고평가`); }
    else               { score -= 8;  notes.push(`PER ${per.toFixed(1)} - 과도 고평가`); }
  }
  if (pbr != null) {
    if (pbr < 0.7)      { score += 7; notes.push(`PBR ${pbr.toFixed(2)} - 자산 저평가`); }
    else if (pbr < 1.5) { score += 3; notes.push(`PBR ${pbr.toFixed(2)} - 적정`); }
    else if (pbr >= 3)  { score -= 4; notes.push(`PBR ${pbr.toFixed(2)} - 자산 고평가`); }
  }
  if (roe != null) {
    if (roe > 20)      { score += 6; notes.push(`ROE ${roe.toFixed(1)}% - 우수`); }
    else if (roe > 10) { score += 2; notes.push(`ROE ${roe.toFixed(1)}% - 양호`); }
    else if (roe < 0)  { score -= 5; notes.push(`ROE ${roe.toFixed(1)}% - 자본 훼손`); }
  }
  return { score: Math.min(25, Math.max(0, score)), notes };
}

function calcGrowth(f: FinancialsData): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  const { revenue_growth, earnings_growth, operating_margin } = f;

  if (revenue_growth != null) {
    if (revenue_growth > 30)        { score += 8; notes.push(`매출 성장률 ${revenue_growth.toFixed(1)}% - 고성장`); }
    else if (revenue_growth > 10)   { score += 4; notes.push(`매출 성장률 ${revenue_growth.toFixed(1)}%`); }
    else if (revenue_growth > 0)    { score += 1; }
    else if (revenue_growth > -10)  { score -= 3; notes.push(`매출 역성장 ${revenue_growth.toFixed(1)}%`); }
    else                            { score -= 7; notes.push(`매출 급감 ${revenue_growth.toFixed(1)}%`); }
  }
  if (earnings_growth != null) {
    if (earnings_growth > 30)       { score += 8; notes.push(`이익 성장률 ${earnings_growth.toFixed(1)}% - 고성장`); }
    else if (earnings_growth > 10)  { score += 4; }
    else if (earnings_growth < -20) { score -= 6; notes.push(`이익 급감 ${earnings_growth.toFixed(1)}%`); }
  }
  if (operating_margin != null) {
    if (operating_margin > 25)      { score += 4; notes.push(`영업이익률 ${operating_margin.toFixed(1)}% - 고수익`); }
    else if (operating_margin > 10) { score += 2; }
    else if (operating_margin < 0)  { score -= 4; notes.push(`영업손실 중`); }
  }
  return { score: Math.min(25, Math.max(0, score)), notes };
}

function calcTechnical(signals: Record<string, unknown>): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  const { rsi, macd_bullish, above_ma20, above_ma60, bb_position_pct } = signals as {
    rsi?: number; macd_bullish?: boolean; above_ma20?: boolean;
    above_ma60?: boolean; bb_position_pct?: number;
  };

  if (rsi != null) {
    if (rsi < 30)       { score += 8; notes.push(`RSI ${rsi.toFixed(0)} - 과매도 (반등 기대)`); }
    else if (rsi < 45)  { score += 3; notes.push(`RSI ${rsi.toFixed(0)} - 중립 하단`); }
    else if (rsi < 60)  { score += 1; }
    else if (rsi < 75)  { score -= 2; notes.push(`RSI ${rsi.toFixed(0)} - 과열 접근`); }
    else                { score -= 6; notes.push(`RSI ${rsi.toFixed(0)} - 과매수`); }
  }
  if (macd_bullish === true)  { score += 4; notes.push("MACD 상승 추세"); }
  if (macd_bullish === false) { score -= 3; notes.push("MACD 하락 추세"); }
  if (above_ma20 === true)    score += 2;
  if (above_ma20 === false)   score -= 2;
  if (above_ma60 === true)    { score += 3; notes.push("60일선 위 - 중기 상승"); }
  if (above_ma60 === false)   { score -= 3; notes.push("60일선 아래 - 중기 하락"); }
  if (bb_position_pct != null) {
    if (bb_position_pct < 15)   { score += 4; notes.push("볼린저밴드 하단 - 반등 가능"); }
    else if (bb_position_pct > 85) { score -= 3; notes.push("볼린저밴드 상단 - 과열"); }
  }
  return { score: Math.min(25, Math.max(0, score)), notes };
}

function calcSector(sectors: Record<string, unknown>[], sectorName: string | null): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  if (!sectorName || sectors.length === 0) return { score, notes };

  const match = sectors.find((s: any) =>
    sectorName && sectorName.toLowerCase().includes((s.sector as string)?.toLowerCase())
  ) as any;
  if (match) {
    const m1 = match.change_1m ?? 0;
    if (m1 > 10)      { score += 8; notes.push(`섹터(${match.sector}) 1개월 +${m1.toFixed(1)}% 강세`); }
    else if (m1 > 3)  { score += 3; }
    else if (m1 < -10){ score -= 6; notes.push(`섹터(${match.sector}) 1개월 ${m1.toFixed(1)}% 약세`); }
    else if (m1 < -3) { score -= 2; }
  }
  return { score: Math.min(25, Math.max(0, score)), notes };
}

function toRecommendation(score: number): string {
  if (score >= 75) return "Strong Buy";
  if (score >= 60) return "Buy";
  if (score >= 40) return "Hold";
  if (score >= 25) return "Sell";
  return "Strong Sell";
}

// ── Claude API 분석 텍스트 ──────────────────────────────────────────────────

async function claudeAnalysis(
  ticker: string,
  name: string | null,
  financials: FinancialsData,
  signals: Record<string, unknown>,
  score: number,
  recommendation: string,
  breakdown: Record<string, unknown>,
  apiKey: string,
  position?: { avgPrice: number; quantity: number; pnlPct: number } | null
): Promise<Record<string, unknown>> {
  if (!apiKey) return fallback(ticker, name, score, recommendation, breakdown, position);

  try {
    const client = new Anthropic({ apiKey });
    const allNotes = (breakdown.all_notes as string[]) ?? [];

    const positionSection = position
      ? `\n## 보유 포지션\n보유수량: ${position.quantity}주 | 평균단가: ${position.avgPrice.toLocaleString()}원 | 현재 수익률: ${position.pnlPct >= 0 ? "+" : ""}${position.pnlPct.toFixed(1)}%\n`
      : "";

    const positionInstruction = position
      ? `\n보유 포지션(평균단가 ${position.avgPrice.toLocaleString()}원, 수익률 ${position.pnlPct.toFixed(1)}%)을 고려한 매도/보유/추가매수 여부도 언급하세요.`
      : "";

    const prompt = `당신은 20년 경력의 국내 증권사 수석 애널리스트입니다.
아래 데이터를 기반으로 ${name || ticker}(${ticker})에 대한 투자 분석을 작성하세요.${positionInstruction}

## 기본 분석
- 투자의견: ${recommendation} / 종합 점수: ${score.toFixed(1)}/100
- 밸류에이션: ${(breakdown.valuation_score as number).toFixed(1)}/25 | 성장성: ${(breakdown.growth_score as number).toFixed(1)}/25
- 기술적분석: ${(breakdown.technical_score as number).toFixed(1)}/25 | 섹터: ${(breakdown.sector_score as number).toFixed(1)}/25
${positionSection}
## 재무
PER ${financials.per ?? "N/A"} | PBR ${financials.pbr ?? "N/A"} | ROE ${financials.roe ?? "N/A"}%
영업이익률 ${financials.operating_margin ?? "N/A"}% | 매출성장 ${financials.revenue_growth ?? "N/A"}% | 섹터 ${financials.sector ?? "N/A"}

## 기술
RSI ${(signals.rsi as number | null) ?? "N/A"} | MACD ${(signals.macd_bullish as boolean) ? "상승" : "하락"} | 60일선 ${(signals.above_ma60 as boolean) ? "위" : "아래"} | 52주위치 ${(signals.pos_52w_pct as number | null) ?? "N/A"}%

## 주요 포인트
${allNotes.map((n) => `- ${n}`).join("\n") || "- 데이터 부족"}

JSON으로만 응답:
{"summary":"3-4문장","valuation_analysis":"2-3문장","technical_analysis":"2-3문장","risk_factors":["리스크1","리스크2","리스크3"],"catalysts":["촉매1","촉매2"],"target_price_comment":"한 문장"}`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    let text = (response.content[0] as { type: string; text: string }).text?.trim() ?? "";
    if (text.includes("```json")) text = text.split("```json")[1].split("```")[0].trim();
    else if (text.includes("```")) text = text.split("```")[1].split("```")[0].trim();

    return JSON.parse(text);
  } catch {
    return fallback(ticker, name, score, recommendation, breakdown, position);
  }
}

function fallback(
  ticker: string,
  name: string | null,
  score: number,
  recommendation: string,
  breakdown: Record<string, unknown>,
  position?: { avgPrice: number; quantity: number; pnlPct: number } | null
): Record<string, unknown> {
  const n = name || ticker;
  const sentiment = score >= 60 ? "긍정적" : score >= 40 ? "중립적" : "부정적";
  const posNote = position
    ? ` 현재 평균단가 ${position.avgPrice.toLocaleString()}원 대비 ${position.pnlPct >= 0 ? "+" : ""}${position.pnlPct.toFixed(1)}% 수익률입니다.`
    : "";
  return {
    summary: `${n}은(는) 종합 점수 ${score.toFixed(0)}점으로 ${recommendation} 의견입니다.${posNote} ${sentiment} 흐름이 관찰됩니다. 분할 접근을 권고합니다.`,
    valuation_analysis: `밸류에이션 점수 ${(breakdown.valuation_score as number).toFixed(0)}/25점. 업종 평균 대비 검토 필요.`,
    technical_analysis: `기술적 점수 ${(breakdown.technical_score as number).toFixed(0)}/25점. 이동평균선 배열 모니터링 권고.`,
    risk_factors: ["거시경제 불확실성", "환율 변동 리스크", "업종 경쟁 심화"],
    catalysts: ["실적 개선 기대", "섹터 모멘텀 회복"],
    target_price_comment: "현 주가 대비 적정 밸류에이션 기반 목표가 산정 필요.",
  };
}

// ── 메인 분석 ───────────────────────────────────────────────────────────────

export async function analyzeStock(
  ticker: string,
  financials: FinancialsData,
  signals: Record<string, unknown>,
  sectors: Record<string, unknown>[],
  anthropicApiKey = "",
  avgPrice: number | null = null,
  quantity: number | null = null,
) {
  const sectorName = financials.sector || financials.industry;
  const v = calcValuation(financials);
  const g = calcGrowth(financials);
  const t = calcTechnical(signals);
  const s = calcSector(sectors, sectorName);

  const total = v.score + g.score + t.score + s.score;
  const recommendation = toRecommendation(total);
  const allNotes = [...v.notes, ...g.notes, ...t.notes, ...s.notes];

  const breakdown = {
    valuation_score:  Math.round(v.score * 10) / 10,
    growth_score:     Math.round(g.score * 10) / 10,
    technical_score:  Math.round(t.score * 10) / 10,
    sector_score:     Math.round(s.score * 10) / 10,
    total_score:      Math.round(total * 10) / 10,
    all_notes:        allNotes,
  };

  const current = (signals.current_price as number | null) || financials.week_52_high;

  // 보유 포지션 컨텍스트 계산
  const position =
    avgPrice && avgPrice > 0 && current
      ? {
          avgPrice,
          quantity: quantity ?? 0,
          pnlPct: ((current - avgPrice) / avgPrice) * 100,
        }
      : null;

  const aiData = await claudeAnalysis(
    ticker, financials.name, financials, signals,
    total, recommendation, breakdown, anthropicApiKey, position
  );

  const targetPrice = current && ["Buy", "Strong Buy"].includes(recommendation)
    ? Math.round(current * 1.2) : null;
  const stopPrice = current ? Math.round(current * 0.92) : null;

  return {
    ticker,
    name:               financials.name,
    recommendation,
    score:              Math.round(total * 10) / 10,
    score_breakdown:    breakdown,
    target_price:       targetPrice,
    stop_price:         stopPrice,
    current_price:      current,
    avg_price:          avgPrice,
    quantity:           quantity,
    pnl_pct:            position?.pnlPct ?? null,
    summary:            aiData.summary ?? "",
    valuation_analysis: aiData.valuation_analysis ?? "",
    technical_analysis: aiData.technical_analysis ?? "",
    risk_factors:       aiData.risk_factors ?? [],
    catalysts:          aiData.catalysts ?? [],
    last_updated:       new Date().toISOString(),
  };
}
