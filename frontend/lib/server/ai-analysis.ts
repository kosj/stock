import Anthropic from "@anthropic-ai/sdk";
import type { FinancialsData } from "./yahoo-finance";

// ── 섹터 기준 데이터 ─────────────────────────────────────────────────────────

/**
 * 업종별 적정 PER 기준값 (한국 시장 기준 중간값).
 * 절대치 비교 대신 이 기준 대비 상대 비율로 평가한다.
 * - 성장주(바이오·2차전지): 높은 PER이 정상이므로 기준값을 높게 설정
 * - 가치주(금융·건설·해운): 낮은 PER이 정상이므로 기준값을 낮게 설정
 */
const SECTOR_TYPICAL_PER: Record<string, number> = {
  "바이오":    45,
  "ai/로봇":   40,
  "2차전지":   35,
  "게임":      30,
  "엔터":      28,
  "it":        25,
  "인터넷/it": 25,
  "방산":      22,
  "반도체":    20,
  "소부장":    18,
  "자동차":    9,
  "화학":      13,
  "에너지":    11,
  "소재":      11,
  "철강/소재": 10,
  "금융":      7,
  "건설":      7,
  "해운":      6,
  "유통":      12,
  "통신":      11,
  "물류":      13,
};

/**
 * 종목 섹터명 → ETF 섹터명 정규화 맵.
 * SectorService가 반환하는 ETF 섹터 키와 연결하기 위한 별칭이다.
 * - "게임"/"엔터": 전용 ETF 없음 → "인터넷/IT" ETF를 프록시로 사용
 * - "소부장": 반도체 소·부·장 연계 → "반도체" ETF 프록시
 * - "방산": "AI/로봇" ETF와 모멘텀 유사
 * - "화학": KODEX 에너지화학에 포함 → "에너지" ETF 프록시
 */
const SECTOR_ALIAS: Record<string, string> = {
  "it":     "인터넷/IT",
  "소재":   "철강/소재",
  "게임":   "인터넷/IT",
  "엔터":   "인터넷/IT",
  "소부장": "반도체",
  "방산":   "AI/로봇",
  "화학":   "에너지",
  "통신":   "금융",
  "해운":   "에너지",
  "물류":   "에너지",
  "유통":   "금융",
};

// ── 공통 유틸 ─────────────────────────────────────────────────────────────────

interface SectorPerf { sector: string; change_1m?: number }

/** 종목 섹터명으로 업종 적정 PER를 조회한다. */
function getSectorTypicalPer(sectorName: string | null): number | null {
  if (!sectorName) return null;
  const lower = sectorName.toLowerCase();
  for (const [key, val] of Object.entries(SECTOR_TYPICAL_PER)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  const aliased = (SECTOR_ALIAS[lower] ?? "").toLowerCase();
  return aliased ? (SECTOR_TYPICAL_PER[aliased] ?? null) : null;
}

/**
 * sectors 배열에서 종목 섹터에 해당하는 1개월 수익률을 반환한다.
 * 1차: 직접 매칭(양방향 includes)
 * 2차: SECTOR_ALIAS 정규화 후 재매칭 (ETF 프록시 방식)
 */
function getSectorChange1m(sectors: SectorPerf[], sectorName: string | null): number | null {
  if (!sectorName || sectors.length === 0) return null;
  const lower = sectorName.toLowerCase();

  let match = sectors.find(s =>
    lower.includes(s.sector.toLowerCase()) || s.sector.toLowerCase().includes(lower)
  );
  if (!match) {
    const aliased = (SECTOR_ALIAS[lower] ?? "").toLowerCase();
    if (aliased) match = sectors.find(s => s.sector.toLowerCase() === aliased);
  }
  return match?.change_1m ?? null;
}

// ── 밸류에이션 점수 (상대평가) ────────────────────────────────────────────────

/**
 * 절대 PER 기준을 폐기하고 '업종 적정 PER 대비 상대 비율'로 평가한다.
 * - ratio = currentPER / sectorTypicalPER: 1.0이 업종 평균, 0.8이면 20% 저평가
 * - Forward PER < Trailing PER이면 이익 성장 기대 → 추가 가점
 * - 섹터 기준이 없을 때는 완화된 절대값 fallback 적용
 */
function calcValuation(f: FinancialsData): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  const { per, forward_per, pbr, roe } = f;
  const sectorName = f.sector || f.industry;
  const typicalPer = getSectorTypicalPer(sectorName);

  if (per != null && per > 0) {
    if (typicalPer != null) {
      const ratio = per / typicalPer;
      if (ratio < 0.5)      { score += 10; notes.push(`PER ${per.toFixed(1)} — 업종 평균(${typicalPer})의 ${(ratio*100).toFixed(0)}% (크게 저평가)`); }
      else if (ratio < 0.8) { score += 6;  notes.push(`PER ${per.toFixed(1)} — 업종 대비 저평가`); }
      else if (ratio < 1.1) { score += 2;  notes.push(`PER ${per.toFixed(1)} — 업종 평균 수준`); }
      else if (ratio < 1.5) { score -= 2;  notes.push(`PER ${per.toFixed(1)} — 업종 대비 다소 고평가`); }
      else if (ratio < 2.0) { score -= 5;  notes.push(`PER ${per.toFixed(1)} — 업종 대비 고평가 (${ratio.toFixed(1)}배)`); }
      else                  { score -= 8;  notes.push(`PER ${per.toFixed(1)} — 업종 대비 과도 고평가 (${ratio.toFixed(1)}배)`); }
    } else {
      // 섹터 기준 없음 → 완화된 절대값 fallback
      if (per < 5)       { score -= 3; notes.push(`PER ${per.toFixed(1)} — 과도 저평가 의심`); }
      else if (per < 15) { score += 4; notes.push(`PER ${per.toFixed(1)} — 저평가`); }
      else if (per < 30) { score += 1; }
      else if (per < 50) { score -= 3; notes.push(`PER ${per.toFixed(1)} — 고평가`); }
      else               { score -= 6; notes.push(`PER ${per.toFixed(1)} — 과도 고평가`); }
    }
  } else if (per != null && per < 0) {
    score -= 5;
    notes.push(`PER 음수 (${per.toFixed(1)}) — 적자 기업`);
  }

  // Forward PER: trailing PER 대비 낮으면 이익 성장 기대를 의미
  if (per != null && per > 0 && forward_per != null && forward_per > 0) {
    const fwdRatio = forward_per / per;
    if (fwdRatio < 0.8)       { score += 4; notes.push(`Forward PER ${forward_per.toFixed(1)} — 이익 고성장 기대`); }
    else if (fwdRatio < 0.95) { score += 2; notes.push(`Forward PER ${forward_per.toFixed(1)} — 이익 성장 기대`); }
    else if (fwdRatio > 1.1)  { score -= 2; notes.push(`Forward PER ${forward_per.toFixed(1)} — 이익 감소 우려`); }
  }

  if (pbr != null) {
    if (pbr < 0.7)      { score += 5; notes.push(`PBR ${pbr.toFixed(2)} — 자산 저평가`); }
    else if (pbr < 1.5) { score += 2; notes.push(`PBR ${pbr.toFixed(2)} — 적정`); }
    else if (pbr >= 4)  { score -= 4; notes.push(`PBR ${pbr.toFixed(2)} — 자산 고평가`); }
  }
  if (roe != null) {
    if (roe > 20)      { score += 4; notes.push(`ROE ${roe.toFixed(1)}% — 우수`); }
    else if (roe > 10) { score += 2; notes.push(`ROE ${roe.toFixed(1)}% — 양호`); }
    else if (roe < 0)  { score -= 4; notes.push(`ROE ${roe.toFixed(1)}% — 자본 훼손`); }
  }
  return { score: Math.min(25, Math.max(0, score)), notes };
}

// ── 성장성 점수 (단기 폭발력 + 장기 추세 혼합) ───────────────────────────────

/**
 * 단일 YoY 지표만 쓰면 기저효과에 왜곡될 수 있다.
 * 가중 혼합: (매출 성장률 × 0.7) + (이익 성장률 × 0.3)
 * - 매출 성장률: 단기 모멘텀 반영 (가중치 70%)
 * - 이익 성장률: 수익 구조의 장기 안정성 반영 (가중치 30%)
 * 영업이익률은 지속 경쟁력 지표로 추가 조정에 사용한다.
 */
function calcGrowth(f: FinancialsData): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  const { revenue_growth, earnings_growth, operating_margin } = f;

  let composite: number | null = null;
  if (revenue_growth != null && earnings_growth != null) {
    composite = revenue_growth * 0.7 + earnings_growth * 0.3;
    notes.push(`복합 성장률 ${composite.toFixed(1)}% (매출 ${revenue_growth.toFixed(0)}%×0.7 + 이익 ${earnings_growth.toFixed(0)}%×0.3)`);
  } else if (revenue_growth != null) {
    composite = revenue_growth;
  } else if (earnings_growth != null) {
    composite = earnings_growth;
  }

  if (composite != null) {
    if (composite > 30)       { score += 9; notes.push("고성장 구간 — 강한 모멘텀"); }
    else if (composite > 15)  { score += 6; notes.push("성장세 양호"); }
    else if (composite > 5)   { score += 3; }
    else if (composite > 0)   { score += 1; }
    else if (composite > -10) { score -= 3; notes.push(`성장 둔화 (${composite.toFixed(1)}%)`); }
    else                      { score -= 7; notes.push(`역성장 심화 (${composite.toFixed(1)}%)`); }
  }

  // 영업이익률: 장기 수익 구조 품질 반영
  if (operating_margin != null) {
    if (operating_margin > 25)      { score += 4; notes.push(`영업이익률 ${operating_margin.toFixed(1)}% — 고수익 구조`); }
    else if (operating_margin > 10) { score += 2; }
    else if (operating_margin < 0)  { score -= 4; notes.push("영업손실 중"); }
  }
  return { score: Math.min(25, Math.max(0, score)), notes };
}

// ── 기술적 점수 (추세 추종 × 눌림목 복합 조건) ───────────────────────────────

/**
 * 기존의 "RSI 30 미만 → 무조건 고점수" 절대 조건을 폐기한다.
 * 새 전략: '중기 상승 추세(MA60 위) + 단기 눌림목(RSI 40~50)'의 AND 조건이
 * 가장 높은 점수를 받는다. 추세 없이 떨어지는 주식에는 낮은 점수를 준다.
 *
 * 주도 섹터 예외: 섹터 1개월 수익률 +10% 이상이면 RSI 75 이상 과열 구간에서도
 * 감점하지 않는다 (강한 추세 구간에서 과매수 신호가 오래 유지될 수 있음).
 */
function calcTechnical(
  signals: Record<string, unknown>,
  sectorChange1m: number | null = null,
  isOutperformer = false,
): { score: number; notes: string[] } {
  let score = 12.5;
  const notes: string[] = [];
  const { rsi, macd_bullish, above_ma60, above_ma120, bb_position_pct } = signals as {
    rsi?: number; macd_bullish?: boolean;
    above_ma60?: boolean; above_ma120?: boolean; bb_position_pct?: number;
  };

  const isLeadingSector = sectorChange1m !== null && sectorChange1m > 10;
  if (isLeadingSector) notes.push(`주도 섹터 (+${sectorChange1m!.toFixed(1)}%) — RSI 과열 감점 면제`);

  // RSI × MA60 복합 평가
  if (rsi != null) {
    if (above_ma60 === true) {
      // 60일선 위 = 중기 상승 추세 확인됨
      if (rsi >= 40 && rsi < 50)      { score += 12; notes.push(`RSI ${rsi.toFixed(0)} + MA60 위 — 눌림목 최적 진입`); }
      else if (rsi >= 50 && rsi < 65) { score += 7;  notes.push(`RSI ${rsi.toFixed(0)} + MA60 위 — 상승 추세`); }
      else if (rsi >= 30 && rsi < 40) { score += 5;  notes.push(`RSI ${rsi.toFixed(0)} + MA60 위 — 단기 과매도, 반등 기대`); }
      else if (rsi >= 65 && rsi < 75) { score += 3;  notes.push(`RSI ${rsi.toFixed(0)} + MA60 위 — 강세 지속`); }
      else if (rsi >= 75) {
        if (isLeadingSector)           { score += 3;  notes.push(`RSI ${rsi.toFixed(0)} — 주도 섹터 과열 유지`); }
        else                           { score -= 2;  notes.push(`RSI ${rsi.toFixed(0)} — MA60 위지만 과매수`); }
      } else {
        // rsi < 30, MA60 위에서 극단 과매도 (드문 케이스)
        score += 4; notes.push(`RSI ${rsi.toFixed(0)} + MA60 위 — 극단 과매도, 강반등 기대`);
      }
    } else {
      // 60일선 아래 = 하락 추세 또는 약세
      if (rsi < 30)      { score += 1;  notes.push(`RSI ${rsi.toFixed(0)} — 과매도 (하락 추세 중, 낙폭 과다)`); }
      else if (rsi < 45) { score -= 1; }
      else if (rsi < 65) { score -= 3;  notes.push(`RSI ${rsi.toFixed(0)} + MA60 아래 — 하락 추세`); }
      else               { score -= 6;  notes.push(`RSI ${rsi.toFixed(0)} + MA60 아래 — 하락 중 과열 위험`); }
    }
  } else {
    // RSI 데이터 없을 때 MA60 단독 판단
    if (above_ma60 === true)  { score += 3; notes.push("MA60 위 — 중기 상승"); }
    if (above_ma60 === false) { score -= 3; notes.push("MA60 아래 — 중기 하락"); }
  }

  if (macd_bullish === true)  { score += 4; notes.push("MACD 상승 추세"); }
  if (macd_bullish === false) { score -= 3; notes.push("MACD 하락 추세"); }

  // MA120: 장기 추세 (기존 MA20 대신 사용하여 추세 신뢰도 향상)
  if (above_ma120 === true)  { score += 2; }
  if (above_ma120 === false) { score -= 2; notes.push("MA120 아래 — 장기 하락 추세"); }

  if (bb_position_pct != null) {
    if (bb_position_pct < 15) {
      score += 3; notes.push("볼린저밴드 하단 — 반등 가능");
    } else if (bb_position_pct > 85) {
      if (!isLeadingSector) { score -= 3; notes.push("볼린저밴드 상단 — 과열"); }
    }
  }

  // 상대 강도(RS) 보너스: KOSPI 대비 1개월 초과 수익 종목에 +5점 가산
  // 슬리피지 방어: 거래량 확인 없이 RS 단독으로 진입하면 안 됨.
  // RS Outperformer는 수급·기술적 점수의 보조 지표로만 활용한다.
  if (isOutperformer) {
    score += 5;
    notes.push("KOSPI 대비 초과 수익 (RS Outperformer) +5");
  }

  return { score: Math.min(25, Math.max(0, score)), notes };
}

// ── 섹터 점수 (ETF 프록시 + 카테고리 연동) ───────────────────────────────────

/**
 * getSectorChange1m()이 SECTOR_ALIAS를 통해 ETF 프록시 방식으로 매칭하므로
 * 섹터 데이터가 있을 때 빈 배열로 인한 12.5 고정 문제가 해소된다.
 * change1m을 반환값에 포함하여 calcTechnical의 주도 섹터 예외 처리에 활용한다.
 */
function calcSector(
  sectors: SectorPerf[],
  sectorName: string | null,
): { score: number; notes: string[]; change1m: number | null } {
  let score = 12.5;
  const notes: string[] = [];
  const change1m = getSectorChange1m(sectors, sectorName);

  if (change1m === null) return { score, notes, change1m: null };

  const label = sectorName ?? "";
  if (change1m > 10)       { score += 8; notes.push(`섹터(${label}) 1개월 +${change1m.toFixed(1)}% — 강세`); }
  else if (change1m > 3)   { score += 3; notes.push(`섹터(${label}) 1개월 +${change1m.toFixed(1)}%`); }
  else if (change1m < -10) { score -= 6; notes.push(`섹터(${label}) 1개월 ${change1m.toFixed(1)}% — 약세`); }
  else if (change1m < -3)  { score -= 2; notes.push(`섹터(${label}) 1개월 ${change1m.toFixed(1)}%`); }

  return { score: Math.min(25, Math.max(0, score)), notes, change1m };
}

// ── 추천 텍스트 ───────────────────────────────────────────────────────────────

function toRecommendation(score: number): string {
  if (score >= 75) return "Strong Buy";
  if (score >= 60) return "Buy";
  if (score >= 40) return "Hold";
  if (score >= 25) return "Sell";
  return "Strong Sell";
}

// ── Claude API 분석 텍스트 ────────────────────────────────────────────────────

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
    // 기본값(timeout 10분, maxRetries 2)은 maxDuration 30~60초 라우트에서
    // 함수 타임아웃을 유발한다. 실패 시 룰 기반 폴백이 있으므로 짧게 자른다.
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
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
PER ${financials.per ?? "N/A"} | Forward PER ${financials.forward_per ?? "N/A"} | PBR ${financials.pbr ?? "N/A"} | ROE ${financials.roe ?? "N/A"}%
영업이익률 ${financials.operating_margin ?? "N/A"}% | 섹터 ${financials.sector ?? "N/A"}

## 기술
RSI ${(signals.rsi as number | null) ?? "N/A"} | MACD ${(signals.macd_bullish as boolean) ? "상승" : "하락"} | MA60 ${(signals.above_ma60 as boolean) ? "위" : "아래"} | 52주위치 ${(signals.pos_52w_pct as number | null) ?? "N/A"}%

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
    valuation_analysis: `밸류에이션 점수 ${(breakdown.valuation_score as number).toFixed(0)}/25점. 업종 상대 PER 기준으로 평가되었습니다.`,
    technical_analysis: `기술적 점수 ${(breakdown.technical_score as number).toFixed(0)}/25점. MA60 기준 추세와 눌림목 조건이 반영되었습니다.`,
    // AI 미연결 시 일반론 문구임을 명시 — 종목별 분석처럼 보이면 오독을 부른다
    risk_factors: ["[룰 기반 일반론 — AI 미연결] 거시경제 불확실성", "환율 변동 리스크", "업종 경쟁 심화"],
    catalysts: ["[룰 기반 일반론 — AI 미연결] 실적 개선 기대", "섹터 모멘텀 회복"],
    target_price_comment: "룰 기반 자동 산출입니다(AI 미연결). 컨센서스·52주 밴드 기반 참고치.",
  };
}

// ── 메인 분석 ─────────────────────────────────────────────────────────────────

export async function analyzeStock(
  ticker: string,
  financials: FinancialsData,
  signals: Record<string, unknown>,
  sectors: SectorPerf[],
  anthropicApiKey = "",
  avgPrice: number | null = null,
  quantity: number | null = null,
  isOutperformer = false,
) {
  const sectorName = financials.sector || financials.industry;
  const v = calcValuation(financials);
  const g = calcGrowth(financials);
  // calcSector → change1m → calcTechnical (주도 섹터 예외 처리 연동)
  const s = calcSector(sectors, sectorName);
  const t = calcTechnical(signals, s.change1m, isOutperformer);

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

  // 차트 실패 시 52주 고가를 현재가로 쓰면 수익률·목표가가 조용히 왜곡된다 → null 유지
  const current = (signals.current_price as number | null) || null;

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

  // 목표가: 애널리스트 컨센서스 우선(현재가 위일 때만 신뢰). 없으면 52주 고가를
  // 상한 근거로 사용, 그것도 없으면 표시하지 않는다 — 기존 ×1.2 고정 배수는
  // 근거 없는 수치가 "목표가"로 강조되는 문제였다.
  const consensus = (financials as { analyst_mean_target?: number | null }).analyst_mean_target ?? null;
  const targetPrice =
    current && ["Buy", "Strong Buy"].includes(recommendation)
      ? consensus && consensus > current
        ? Math.round(consensus)
        : financials.week_52_high && financials.week_52_high > current
          ? Math.round(financials.week_52_high)
          : null
      : null;
  // 손절가: 고정 -8% 대신 52주 밴드폭 기반 변동성 반영(밴드폭 25%를 1로 정규화,
  // -5%~-12% 클램프). 저변동주는 얕게, 고변동주는 깊게.
  const bandW = current && financials.week_52_high && financials.week_52_low
    ? (financials.week_52_high - financials.week_52_low) / current : null;
  const stopFrac = bandW ? Math.min(0.12, Math.max(0.05, 0.08 * (bandW / 0.25))) : 0.08;
  const stopPrice = current ? Math.round(current * (1 - stopFrac)) : null;

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
