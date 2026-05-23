from datetime import datetime
from pydantic import BaseModel, Field


class PortfolioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None


class PortfolioUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None


class PortfolioOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PositionCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    quantity: int = Field(..., gt=0)
    avg_price: float = Field(..., gt=0)
    stop_loss: float | None = Field(None, gt=0)
    take_profit: float | None = Field(None, gt=0)
    strategy: str | None = None
    notes: str | None = None


class PositionUpdate(BaseModel):
    quantity: int | None = Field(None, gt=0)
    avg_price: float | None = Field(None, gt=0)
    stop_loss: float | None = None
    take_profit: float | None = None
    strategy: str | None = None
    notes: str | None = None


class PositionOut(BaseModel):
    id: int
    portfolio_id: int
    ticker: str
    name: str
    quantity: int
    avg_price: float
    stop_loss: float | None
    take_profit: float | None
    strategy: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PnLOut(BaseModel):
    position_id: int
    ticker: str
    name: str
    quantity: int
    avg_price: float
    current_price: float
    stop_loss: float | None
    take_profit: float | None
    strategy: str | None
    notes: str | None
    pnl_amount: float
    pnl_percent: float
    total_value: float
    cost_basis: float
    is_near_stop: bool
    is_near_target: bool


class PortfolioSummary(BaseModel):
    portfolio_id: int
    name: str
    total_invested: float
    total_value: float
    total_pnl: float
    total_pnl_percent: float
    positions: list[PnLOut]


class WatchlistCreate(BaseModel):
    ticker: str
    name: str
    sector: str | None = None


class WatchlistOut(BaseModel):
    id: int
    ticker: str
    name: str
    sector: str | None
    added_at: datetime

    model_config = {"from_attributes": True}
