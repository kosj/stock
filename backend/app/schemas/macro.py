from pydantic import BaseModel


class MacroIndicator(BaseModel):
    name: str
    value: float | None
    prev_value: float | None
    change: float | None
    change_pct: float | None
    unit: str
    date: str
    series: list[dict] | None = None  # [{date, value}, ...]


class MacroDashboard(BaseModel):
    # 금리
    us_fed_rate: MacroIndicator | None = None
    kr_base_rate: MacroIndicator | None = None
    us_10y_yield: MacroIndicator | None = None
    kr_10y_yield: MacroIndicator | None = None

    # 환율
    usd_krw: MacroIndicator | None = None
    eur_usd: MacroIndicator | None = None

    # 인플레이션
    us_cpi: MacroIndicator | None = None
    kr_cpi: MacroIndicator | None = None

    # 증시 지수
    kospi: MacroIndicator | None = None
    kosdaq: MacroIndicator | None = None
    sp500: MacroIndicator | None = None
    nasdaq: MacroIndicator | None = None


class SectorPerformance(BaseModel):
    sector: str
    ticker: str         # ETF ticker
    name: str
    price: float
    change_1d: float
    change_1w: float
    change_1m: float
    change_3m: float
    change_ytd: float


class SectorRotation(BaseModel):
    date: str
    sectors: list[SectorPerformance]
    leading_sectors: list[str]
    lagging_sectors: list[str]
    rotation_theme: str
