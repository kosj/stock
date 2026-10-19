"""Legacy sector catalog is unavailable until its corrupted source is restored.

Do not infer ETF names or sector membership from damaged text.
"""
from fastapi import HTTPException


def unavailable():
    raise HTTPException(status_code=503, detail="Legacy sector catalog requires verified source restoration; use the maintained Next API")


class SectorService:
    @staticmethod
    async def get_performance() -> list[dict]:
        unavailable()

    @staticmethod
    async def get_sector_etfs(sector: str, sort_by: str = "1m") -> list[dict]:
        unavailable()

    @staticmethod
    async def get_rotation() -> dict:
        unavailable()


sector_service = SectorService()
