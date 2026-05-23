from fastapi import APIRouter
from app.services.sector_service import SectorService

router = APIRouter()


@router.get("/")
async def get_sectors():
    """섹터별 성과."""
    return await SectorService.get_performance()


@router.get("/rotation")
async def get_rotation():
    """섹터 로테이션 분석."""
    return await SectorService.get_rotation()


@router.get("/{sector}/etfs")
async def get_sector_etfs(sector: str, sort_by: str = "1m"):
    """특정 섹터 관련 ETF 랭킹."""
    return await SectorService.get_sector_etfs(sector, sort_by)
