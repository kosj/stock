from fastapi import APIRouter, Header
from typing import Optional
from app.services.macro_service import MacroService

router = APIRouter()


@router.get("/")
async def get_macro_dashboard(
    x_fred_key: Optional[str] = Header(None, alias="X-Fred-Key"),
):
    """거시경제 지표 대시보드."""
    return await MacroService.get_dashboard(fred_api_key=x_fred_key or "")
