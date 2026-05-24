"""
AI 분석 서비스.
1단계: 규칙 기반 스코어링 (0-100점)
2단계: Claude API로 전문 분석 텍스트 생성
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from app.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 규칙 기반 스코어링
# ---------------------------------------------------------------------------

def _calc_valuation_score(financials: dict) -> tuple[float, list[str]]:
    """PER, PBR, ROE 기반 밸류에이션 점수 (0-25)."""
    score = 12.5  # 중립 기준
    notes = []

    per = financials.get("per")
    pbr = financials.get("pbr")
    roe = financials.get("roe")

    if per is not None:
        if per < 0:
            score -= 5; notes.append(f"PER 음수 ({per:.1f}) - 적자 기업")
        elif per < 10:
            score += 10; notes.append(f"PER {per:.1f} - 저평가 구간")
        elif per < 15:
            score += 6; notes.append(f"PER {per:.1f} - 적정 밸류")
        elif per < 25:
            score += 2; notes.append(f"PER {per:.1f} - 다소 고평가")
        elif per < 40:
            score -= 3; notes.append(f"PER {per:.1f} - 고평가")
        else:
            score -= 8; notes.append(f"PER {per:.1f} - 과도한 고평가")

    if pbr is not None:
        if pbr < 0.7:
            score += 7; notes.append(f"PBR {pbr:.2f} - 자산 대비 저평가")
        elif pbr < 1.5:
            score += 3; notes.append(f"PBR {pbr:.2f} - 적정")
        elif pbr < 3:
            score += 0
        else:
            score -= 4; notes.append(f"PBR {pbr:.2f} - 자산 대비 고평가")

    if roe is not None:
        if roe > 20:
            score += 6; notes.append(f"ROE {roe:.1f}% - 우수한 자본효율")
        elif roe > 10:
            score += 2; notes.append(f"ROE {roe:.1f}% - 양호")
        elif roe < 0:
            score -= 5; notes.append(f"ROE {roe:.1f}% - 자본 훼손")

    return min(25, max(0, score)), notes


def _calc_growth_score(financials: dict) -> tuple[float, list[str]]:
    """성장성 점수 (0-25)."""
    score = 12.5
    notes = []

    rev_growth = financials.get("revenue_growth")
    earn_growth = financials.get("earnings_growth")
    op_margin = financials.get("operating_margin")

    if rev_growth is not None:
        if rev_growth > 30:
            score += 8; notes.append(f"매출 성장률 {rev_growth:.1f}% - 고성장")
        elif rev_growth > 10:
            score += 4; notes.append(f"매출 성장률 {rev_growth:.1f}% - 성장세")
        elif rev_growth > 0:
            score += 1
        elif rev_growth > -10:
            score -= 3; notes.append(f"매출 역성장 {rev_growth:.1f}%")
        else:
            score -= 7; notes.append(f"매출 급감 {rev_growth:.1f}%")

    if earn_growth is not None:
        if earn_growth > 30:
            score += 8; notes.append(f"이익 성장률 {earn_growth:.1f}% - 고성장")
        elif earn_growth > 10:
            score += 4
        elif earn_growth < -20:
            score -= 6; notes.append(f"이익 급감 {earn_growth:.1f}%")

    if op_margin is not None:
        if op_margin > 25:
            score += 4; notes.append(f"영업이익률 {op_margin:.1f}% - 고수익")
        elif op_margin > 10:
            score += 2
        elif op_margin < 0:
            score -= 4; notes.append(f"영업손실 중")

    return min(25, max(0, score)), notes


def _calc_technical_score(signals: dict) -> tuple[float, list[str]]:
    """기술적 지표 점수 (0-25)."""
    score = 12.5
    notes = []

    rsi = signals.get("rsi")
    macd_bullish = signals.get("macd_bullish")
    above_ma20 = signals.get("above_ma20")
    above_ma60 = signals.get("above_ma60")
    bb_pos = signals.get("bb_position_pct")
    pos_52w = signals.get("pos_52w_pct")

    if rsi is not None:
        if rsi < 30:
            score += 8; notes.append(f"RSI {rsi:.0f} - 과매도 구간 (반등 기대)")
        elif rsi < 45:
            score += 3; notes.append(f"RSI {rsi:.0f} - 중립 하단")
        elif rsi < 60:
            score += 1
        elif rsi < 75:
            score -= 2; notes.append(f"RSI {rsi:.0f} - 과열 접근")
        else:
            score -= 6; notes.append(f"RSI {rsi:.0f} - 과매수 구간")

    if macd_bullish is True:
        score += 4; notes.append("MACD 상승 추세")
    elif macd_bullish is False:
        score -= 3; notes.append("MACD 하락 추세")

    if above_ma20 is True:
        score += 2
    elif above_ma20 is False:
        score -= 2

    if above_ma60 is True:
        score += 3; notes.append("60일선 위 - 중기 상승추세")
    elif above_ma60 is False:
        score -= 3; notes.append("60일선 아래 - 중기 하락추세")

    if bb_pos is not None:
        if bb_pos < 15:
            score += 4; notes.append("볼린저밴드 하단 근접 - 반등 가능")
        elif bb_pos > 85:
            score -= 3; notes.append("볼린저밴드 상단 돌파 - 과열")

    return min(25, max(0, score)), notes


def _calc_sector_score(sector_data: list[dict], sector_name: str | None) -> tuple[float, list[str]]:
    """섹터 모멘텀 점수 (0-25)."""
    score = 12.5
    notes = []

    if not sector_data or not sector_name:
        return score, notes

    for s in sector_data:
        if sector_name and sector_name.lower() in s.get("sector", "").lower():
            m1 = s.get("change_1m", 0)
            m3 = s.get("change_3m", 0)
            if m1 > 10:
                score += 8; notes.append(f"소속 섹터({s['sector']}) 1개월 +{m1:.1f}% 강세")
            elif m1 > 3:
                score += 3
            elif m1 < -10:
                score -= 6; notes.append(f"소속 섹터({s['sector']}) 1개월 {m1:.1f}% 약세")
            elif m1 < -3:
                score -= 2
            if m3 > 20:
                score += 4; notes.append(f"3개월 섹터 모멘텀 강함 (+{m3:.1f}%)")
            break

    return min(25, max(0, score)), notes


def _score_to_recommendation(score: float) -> str:
    if score >= 75:   return "Strong Buy"
    if score >= 60:   return "Buy"
    if score >= 40:   return "Hold"
    if score >= 25:   return "Sell"
    return "Strong Sell"


# ---------------------------------------------------------------------------
# Claude API 분석
# ---------------------------------------------------------------------------

async def _claude_analysis(
    ticker: str,
    name: str | None,
    financials: dict,
    signals: dict,
    score: float,
    recommendation: str,
    score_notes: dict,
    anthropic_api_key: str = "",
) -> dict:
    api_key = anthropic_api_key or settings.ANTHROPIC_API_KEY
    if not api_key:
        return _fallback_analysis(ticker, name, score, recommendation, score_notes)

    try:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=api_key)

        prompt = f"""당신은 20년 경력의 국내 증권사 수석 애널리스트입니다.
아래 데이터를 기반으로 {name or ticker}({ticker})에 대한 투자 분석을 작성하세요.

## 기본 분석 결과
- 투자의견: {recommendation}
- 종합 점수: {score:.1f}/100
- 밸류에이션 점수: {score_notes.get('valuation_score', 0):.1f}/25
- 성장성 점수: {score_notes.get('growth_score', 0):.1f}/25
- 기술적 분석: {score_notes.get('technical_score', 0):.1f}/25
- 섹터 모멘텀: {score_notes.get('sector_score', 0):.1f}/25

## 재무 지표
- PER: {financials.get('per', 'N/A')}배
- PBR: {financials.get('pbr', 'N/A')}배
- ROE: {financials.get('roe', 'N/A')}%
- 영업이익률: {financials.get('operating_margin', 'N/A')}%
- 매출 성장률: {financials.get('revenue_growth', 'N/A')}%
- 이익 성장률: {financials.get('earnings_growth', 'N/A')}%
- 섹터: {financials.get('sector', 'N/A')}

## 기술적 신호
- RSI: {signals.get('rsi', 'N/A')}
- MACD 방향: {'상승' if signals.get('macd_bullish') else '하락'}
- 20일선 대비: {'위' if signals.get('above_ma20') else '아래'}
- 60일선 대비: {'위' if signals.get('above_ma60') else '아래'}
- 52주 위치: {signals.get('pos_52w_pct', 'N/A')}%

## 주요 분석 포인트
{chr(10).join('- ' + n for n in (score_notes.get('all_notes', []) or []))}

다음 형식의 JSON으로 응답하세요:
{{
  "summary": "3-4문장의 종합 투자 의견",
  "valuation_analysis": "밸류에이션 분석 2-3문장",
  "technical_analysis": "기술적 분석 2-3문장",
  "risk_factors": ["리스크 요인 1", "리스크 요인 2", "리스크 요인 3"],
  "catalysts": ["상승 촉매 1", "상승 촉매 2"],
  "target_price_comment": "목표주가 근거 한 문장"
}}"""

        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )

        # Claude 응답은 여러 텍스트 블록으로 나뉘어 반환될 수 있으므로 모두 합칩니다.
        text_blocks = []
        for block in getattr(response, "content", []) or []:
            if getattr(block, "type", None) == "text":
                block_text = getattr(block, "text", None)
                if block_text:
                    text_blocks.append(block_text)

        text = "".join(text_blocks).strip()
        if not text:
            raise ValueError("Claude returned no text content")

        # JSON 파싱
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        data = json.loads(text)
        return data

    except Exception as e:
        logger.error(f"Claude API error: {e}. raw response: {repr(text) if 'text' in locals() else 'n/a'}")
        return _fallback_analysis(ticker, name, score, recommendation, score_notes)


def _fallback_analysis(ticker: str, name: str | None, score: float, recommendation: str, score_notes: dict) -> dict:
    n = name or ticker
    sentiment = "긍정적" if score >= 60 else ("중립적" if score >= 40 else "부정적")
    return {
        "summary": f"{n}은(는) 현재 종합 점수 {score:.0f}점으로 {recommendation} 의견입니다. "
                   f"밸류에이션과 기술적 지표 종합 시 {sentiment} 흐름이 관찰됩니다. "
                   f"단기 변동성에 유의하며 분할 접근을 권고합니다.",
        "valuation_analysis": f"밸류에이션 점수 {score_notes.get('valuation_score', 0):.0f}/25점. "
                              "업종 평균 대비 상대 밸류에이션 검토 필요.",
        "technical_analysis": f"기술적 분석 점수 {score_notes.get('technical_score', 0):.0f}/25점. "
                              "이동평균선 배열 및 거래량 추이 모니터링 권고.",
        "risk_factors": ["거시경제 불확실성", "환율 변동 리스크", "업종 경쟁 심화"],
        "catalysts": ["실적 개선 기대", "섹터 모멘텀 회복"],
        "target_price_comment": "현 주가 대비 적정 밸류에이션 기반 목표가 산정 필요.",
    }


# ---------------------------------------------------------------------------
# 메인 분석 함수
# ---------------------------------------------------------------------------

async def analyze_stock(
    ticker: str,
    financials: dict,
    candle_signals: dict,
    sector_data: list[dict],
    anthropic_api_key: str = "",
) -> dict:
    sector_name = financials.get("sector") or financials.get("industry")

    v_score, v_notes = _calc_valuation_score(financials)
    g_score, g_notes = _calc_growth_score(financials)
    t_score, t_notes = _calc_technical_score(candle_signals)
    s_score, s_notes = _calc_sector_score(sector_data, sector_name)

    total = v_score + g_score + t_score + s_score
    recommendation = _score_to_recommendation(total)
    all_notes = v_notes + g_notes + t_notes + s_notes

    score_breakdown = {
        "valuation_score": round(v_score, 1),
        "growth_score": round(g_score, 1),
        "technical_score": round(t_score, 1),
        "sector_score": round(s_score, 1),
        "total_score": round(total, 1),
        "all_notes": all_notes,
    }

    ai_data = await _claude_analysis(
        ticker,
        financials.get("name"),
        financials,
        candle_signals,
        total,
        recommendation,
        score_breakdown,
        anthropic_api_key=anthropic_api_key,
    )

    # 목표가/손절가 산출 (현재가 기반)
    current = candle_signals.get("current_price") or financials.get("week_52_high")
    target_price = round(current * 1.20, 0) if current and recommendation in ("Buy", "Strong Buy") else None
    stop_price   = round(current * 0.92, 0) if current else None

    return {
        "ticker": ticker,
        "name": financials.get("name"),
        "recommendation": recommendation,
        "score": round(total, 1),
        "score_breakdown": score_breakdown,
        "target_price": target_price,
        "stop_price": stop_price,
        "current_price": current,
        "summary": ai_data.get("summary", ""),
        "valuation_analysis": ai_data.get("valuation_analysis", ""),
        "technical_analysis": ai_data.get("technical_analysis", ""),
        "risk_factors": ai_data.get("risk_factors", []),
        "catalysts": ai_data.get("catalysts", []),
        "last_updated": datetime.now().isoformat(),
    }
