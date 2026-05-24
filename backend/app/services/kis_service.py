"""
한국투자증권 Open API 추상화 계층.
KIS_MODE=mock  → MockKISService (개발용 샘플 데이터)
KIS_MODE=real  → RealKISService (실제 API 호출)
"""
from abc import ABC, abstractmethod
from datetime import datetime
import random
from app.config import settings


class KISInterface(ABC):
    @abstractmethod
    async def get_access_token(self) -> str: ...

    @abstractmethod
    async def get_balance(self) -> dict: ...

    @abstractmethod
    async def get_price(self, ticker: str) -> dict: ...

    @abstractmethod
    async def get_positions(self) -> list[dict]: ...


# ---------------------------------------------------------------------------
# Mock 서비스 (KIS API 키 없이 개발 가능)
# ---------------------------------------------------------------------------

MOCK_PORTFOLIO = [
    {
        "ticker": "005930", "name": "삼성전자",
        "quantity": 100, "avg_price": 72000.0,
        "sector": "반도체", "market": "KOSPI",
    },
    {
        "ticker": "000660", "name": "SK하이닉스",
        "quantity": 30, "avg_price": 185000.0,
        "sector": "반도체", "market": "KOSPI",
    },
    {
        "ticker": "035420", "name": "NAVER",
        "quantity": 10, "avg_price": 215000.0,
        "sector": "인터넷", "market": "KOSPI",
    },
    {
        "ticker": "051910", "name": "LG화학",
        "quantity": 5, "avg_price": 410000.0,
        "sector": "화학/배터리", "market": "KOSPI",
    },
    {
        "ticker": "373220", "name": "LG에너지솔루션",
        "quantity": 8, "avg_price": 380000.0,
        "sector": "배터리", "market": "KOSPI",
    },
]

MOCK_PRICES: dict[str, float] = {
    "005930": 74500.0,
    "000660": 198000.0,
    "035420": 207000.0,
    "051910": 385000.0,
    "373220": 362000.0,
}


class MockKISService(KISInterface):
    async def get_access_token(self) -> str:
        return "mock_access_token"

    async def get_balance(self) -> dict:
        positions = await self.get_positions()
        total_value = sum(
            p["quantity"] * MOCK_PRICES.get(p["ticker"], p["avg_price"])
            for p in positions
        )
        total_cost = sum(p["quantity"] * p["avg_price"] for p in positions)
        return {
            "account": "12345678-01",
            "total_value": total_value,
            "total_cost": total_cost,
            "pnl": total_value - total_cost,
            "pnl_pct": (total_value - total_cost) / total_cost * 100 if total_cost > 0 else 0,
            "cash": 5_000_000.0,
        }

    async def get_price(self, ticker: str) -> dict:
        base = MOCK_PRICES.get(ticker, 50000.0)
        # 실제처럼 약간의 랜덤 변동
        noise = random.uniform(-0.01, 0.01)
        price = base * (1 + noise)
        prev = base
        change = price - prev
        return {
            "ticker": ticker,
            "price": round(price, 0),
            "change": round(change, 0),
            "change_pct": round(change / prev * 100, 2),
            "volume": random.randint(500_000, 5_000_000),
            "high": round(price * 1.015, 0),
            "low": round(price * 0.985, 0),
            "open": round(prev * 1.002, 0),
            "prev_close": round(prev, 0),
            "timestamp": datetime.now().isoformat(),
        }

    async def get_positions(self) -> list[dict]:
        result = []
        for p in MOCK_PORTFOLIO:
            current_price = MOCK_PRICES.get(p["ticker"], p["avg_price"])
            result.append({
                **p,
                "current_price": current_price,
                "pnl": (current_price - p["avg_price"]) * p["quantity"],
                "pnl_pct": (current_price - p["avg_price"]) / p["avg_price"] * 100,
            })
        return result


# ---------------------------------------------------------------------------
# Real 서비스 (실제 KIS Open API)
# ---------------------------------------------------------------------------

class RealKISService(KISInterface):
    def __init__(self, appkey: str = "", appsecret: str = "", account: str = ""):
        self._appkey = appkey or settings.KIS_APPKEY
        self._appsecret = appsecret or settings.KIS_APPSECRET
        self._account = account or settings.KIS_ACCOUNT
        self._base_url = settings.KIS_BASE_URL
        self._access_token: str | None = None
        self._token_expires: datetime | None = None

    async def get_access_token(self) -> str:
        now = datetime.now()
        if self._access_token and self._token_expires and now < self._token_expires:
            return self._access_token

        import httpx
        from datetime import timedelta
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base_url}/oauth2/tokenP",
                json={
                    "grant_type": "client_credentials",
                    "appkey": self._appkey,
                    "appsecret": self._appsecret,
                },
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            self._access_token = data["access_token"]
            self._token_expires = now + timedelta(seconds=int(data.get("expires_in", 86400)) - 300)
        return self._access_token

    def _headers(self, token: str, tr_id: str) -> dict:
        return {
            "Authorization": f"Bearer {token}",
            "appkey": self._appkey,
            "appsecret": self._appsecret,
            "tr_id": tr_id,
            "Content-Type": "application/json",
        }

    async def get_indices(self) -> dict:
        """KOSPI, KOSDAQ 지수 조회."""
        token = await self.get_access_token()
        import httpx
        index_map = {"KOSPI": "0001", "KOSDAQ": "1001"}
        result: dict = {}
        async with httpx.AsyncClient() as client:
            for name, code in index_map.items():
                try:
                    resp = await client.get(
                        f"{self._base_url}/uapi/domestic-stock/v1/quotations/inquire-index-price",
                        params={"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": code},
                        headers=self._headers(token, "FHPUP02100000"),
                        timeout=5.0,
                    )
                    data = resp.json().get("output", {})
                    price = float(data.get("bstp_nmix_prpr", 0))
                    prev  = float(data.get("bstp_nmix_sdpr", price))
                    change = price - prev
                    result[name] = {
                        "price": price,
                        "change": change,
                        "change_pct": change / prev * 100 if prev else 0,
                    }
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"KIS index {name}: {e}")
                    result[name] = None
        return result

    async def get_balance(self) -> dict:
        token = await self.get_access_token()
        acct = self._account
        acct_no = acct[:8]
        acct_prod = acct[8:] if len(acct) > 8 else "01"
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.KIS_BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance",
                params={
                    "CANO": acct_no, "ACNT_PRDT_CD": acct_prod,
                    "AFHR_FLPR_YN": "N", "OFL_YN": "N", "INQR_DVSN": "02",
                    "UNPR_DVSN": "01", "FUND_STTL_ICLD_YN": "N",
                    "FNCG_AMT_AUTO_RDPT_YN": "N", "PRCS_DVSN": "01", "CTX_AREA_FK100": "", "CTX_AREA_NK100": "",
                },
                headers=self._headers(token, "TTTC8434R"),
            )
            resp.raise_for_status()
            return resp.json()

    async def get_price(self, ticker: str) -> dict:
        token = await self.get_access_token()
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price",
                params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": ticker},
                headers=self._headers(token, "FHKST01010100"),
            )
            resp.raise_for_status()
            data = resp.json().get("output", {})
            price = float(data.get("stck_prpr", 0))
            prev = float(data.get("stck_sdpr", price))
            change = price - prev
            return {
                "ticker": ticker,
                "price": price,
                "change": change,
                "change_pct": change / prev * 100 if prev else 0,
                "volume": int(data.get("acml_vol", 0)),
                "high": float(data.get("stck_hgpr", price)),
                "low": float(data.get("stck_lwpr", price)),
                "open": float(data.get("stck_oprc", price)),
                "prev_close": prev,
                "timestamp": datetime.now().isoformat(),
            }

    async def get_positions(self) -> list[dict]:
        raw = await self.get_balance()
        output1 = raw.get("output1", [])
        result = []
        for item in output1:
            result.append({
                "ticker": item.get("pdno", ""),
                "name": item.get("prdt_name", ""),
                "quantity": int(item.get("hldg_qty", 0)),
                "avg_price": float(item.get("pchs_avg_pric", 0)),
                "current_price": float(item.get("prpr", 0)),
                "pnl": float(item.get("evlu_pfls_amt", 0)),
                "pnl_pct": float(item.get("evlu_pfls_rt", 0)),
                "sector": "",
                "market": "KOSPI",
            })
        return result


def get_kis_service() -> KISInterface:
    if settings.KIS_MODE == "real":
        return RealKISService()
    return MockKISService()


kis_service = get_kis_service()
