from fastapi import APIRouter, HTTPException, Query
from app.services import krx_service

router = APIRouter()


@router.get("/")
async def get_dashboard():
    """국내 증시 전체 대시보드 (자금흐름 + 투자자동향 + 업종지수 + 공매도)."""
    try:
        return await krx_service.get_dashboard()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"KRX API 오류: {e}")


@router.get("/investor")
async def get_investor():
    """투자자별 매매동향 (KOSPI/KOSDAQ)."""
    try:
        return await krx_service.get_investor_trends()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"KRX API 오류: {e}")


@router.get("/sector")
async def get_sector():
    """업종별 주가지수 (KOSPI/KOSDAQ)."""
    try:
        return await krx_service.get_sector_index()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"KRX API 오류: {e}")


@router.get("/short-selling")
async def get_short_selling():
    """공매도 현황 (시장별 + 상위 종목)."""
    try:
        return await krx_service.get_short_selling()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"KRX API 오류: {e}")


@router.get("/debug")
async def debug_raw(
    bld: str = Query("dbms/MDC/STAT/standard/MDCSTAT02301"),
    trd_dd: str = Query(""),
):
    """KRX 원시 응답 확인용 (개발/디버그). ?bld=...&trd_dd=YYYYMMDD"""
    extra = {}
    if trd_dd:
        extra["trdDd"] = trd_dd
    else:
        extra["trdDd"] = krx_service._last_trading_day()
        extra["mktId"]  = "STK"
    return await krx_service.get_raw(bld, extra)
