from fastapi import APIRouter
from app.services.macro_service import MacroService

router = APIRouter()


@router.get("/")
async def get_macro_dashboard():
    """거시경제 지표 대시보드."""
    return await MacroService.get_dashboard()
