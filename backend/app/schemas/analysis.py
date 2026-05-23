from pydantic import BaseModel


class ScoreBreakdown(BaseModel):
    valuation_score: float      # PER/PBR 기반 (0-25)
    growth_score: float         # 성장성 기반 (0-25)
    technical_score: float      # 기술적 분석 기반 (0-25)
    sector_score: float         # 섹터 모멘텀 기반 (0-25)
    total_score: float          # 총점 (0-100)


class AnalysisOut(BaseModel):
    ticker: str
    name: str | None
    recommendation: str         # Strong Buy / Buy / Hold / Sell / Strong Sell
    score: float                # 0-100
    score_breakdown: ScoreBreakdown
    target_price: float | None
    stop_price: float | None
    current_price: float | None
    summary: str                # AI 생성 종합 분석
    valuation_analysis: str
    technical_analysis: str
    risk_factors: list[str]
    catalysts: list[str]
    last_updated: str
