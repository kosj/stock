"""
증권사 API 프록시 엔드포인트.
클라이언트에서 per-request로 API 키를 전달하면 실제 증권사 데이터를 반환.
현재 지원: 한국투자증권 (KIS)
"""
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


class BrokerRequest(BaseModel):
    broker: str
    appKey: str
    appSecret: str
    accountNumber: str | None = None


class PerRequestKISService:
    """요청별 API 키로 동작하는 KIS 서비스 (전역 설정 키 불필요)"""

    def __init__(self, app_key: str, app_secret: str):
        self._app_key = app_key
        self._app_secret = app_secret
        self._access_token: str | None = None
        self._token_expires: datetime | None = None

    async def get_access_token(self) -> str:
        now = datetime.now()
        if self._access_token and self._token_expires and now < self._token_expires:
            return self._access_token

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.KIS_BASE_URL}/oauth2/tokenP",
                json={
                    "grant_type": "client_credentials",
                    "appkey": self._app_key,
                    "appsecret": self._app_secret,
                },
                headers={"Content-Type": "application/json"},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()

        self._access_token = data["access_token"]
        self._token_expires = now + timedelta(
            seconds=int(data.get("expires_in", 86400)) - 300
        )
        return self._access_token

    def _headers(self, token: str, tr_id: str) -> dict:
        return {
            "Authorization": f"Bearer {token}",
            "appkey": self._app_key,
            "appsecret": self._app_secret,
            "tr_id": tr_id,
            "Content-Type": "application/json",
        }

    async def get_price(self, ticker: str) -> dict:
        token = await self.get_access_token()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price",
                params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": ticker},
                headers=self._headers(token, "FHKST01010100"),
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json().get("output", {})

        price = float(data.get("stck_prpr", 0))
        prev = float(data.get("stck_sdpr", price))
        change = price - prev
        return {
            "ticker": ticker,
            "name": data.get("hts_kor_isnm", ""),
            "price": price,
            "change": change,
            "change_pct": round(change / prev * 100, 2) if prev else 0,
            "volume": int(data.get("acml_vol", 0)),
            "high": float(data.get("stck_hgpr", price)),
            "low": float(data.get("stck_lwpr", price)),
            "open": float(data.get("stck_oprc", price)),
            "prev_close": prev,
            "timestamp": datetime.now().isoformat(),
        }

    async def get_index(self, index_code: str) -> dict:
        """국내 주요 지수 조회 (KOSPI: 0001, KOSDAQ: 1001)"""
        token = await self.get_access_token()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-index-price",
                params={
                    "FID_COND_MRKT_DIV_CODE": "U",
                    "FID_INPUT_ISCD": index_code,
                },
                headers=self._headers(token, "FHPUP02100000"),
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json().get("output", {})

        price = float(data.get("bstp_nmix_prpr", 0))
        change = float(data.get("bstp_nmix_prdy_vrss", 0))
        change_pct = float(data.get("bstp_nmix_prdy_ctrt", 0))
        return {"price": price, "change": change, "change_pct": change_pct}


@router.post("/quote/{ticker}")
async def broker_quote(ticker: str, body: BrokerRequest):
    """증권사 API를 통한 실시간 주식 시세 조회"""
    ticker = ticker.upper()

    if body.broker != "kis":
        raise HTTPException(status_code=400, detail=f"지원하지 않는 증권사: {body.broker}")

    try:
        svc = PerRequestKISService(body.appKey, body.appSecret)
        return await svc.get_price(ticker)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"KIS API 오류: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"증권사 API 오류: {e}")


@router.post("/indices")
async def broker_indices(body: BrokerRequest):
    """증권사 API를 통한 주요 지수 조회 (국내는 KIS, 해외는 FDR 폴백)"""
    if body.broker != "kis":
        raise HTTPException(status_code=400, detail=f"지원하지 않는 증권사: {body.broker}")

    try:
        svc = PerRequestKISService(body.appKey, body.appSecret)
        results: dict = {}

        # 국내 지수: KIS API
        for name, code in {"KOSPI": "0001", "KOSDAQ": "1001"}.items():
            try:
                results[name] = await svc.get_index(code)
            except Exception:
                results[name] = None

        # 해외 지수 및 환율: FinanceDataReader 폴백
        from app.services.market_service import MarketService
        foreign = {"S&P500": "SPY", "NASDAQ": "QQQ", "달러/원": "USD/KRW"}
        for name, sym in foreign.items():
            try:
                results[name] = await MarketService.get_quote(sym)
            except Exception:
                results[name] = None

        return results
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"KIS API 오류: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"증권사 API 오류: {e}")
