"""Offline regression tests: python3 -m unittest discover -s backend -p 'test_*.py'."""
import asyncio
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent / "app"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


security = load("legacy_security", "security.py")


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail


class Router:
    def websocket(self, *args, **kwargs):
        return lambda function: function


class Market:
    calls = []

    @staticmethod
    async def get_quote(ticker):
        Market.calls.append(ticker)
        return {"ticker": ticker, "price": 100}


with patch.dict(sys.modules, {
    "fastapi": types.SimpleNamespace(APIRouter=Router, Query=lambda value: value,
        WebSocket=object, WebSocketDisconnect=type("Disconnect", (Exception,), {}),
        HTTPException=HTTPException),
    "app.services.market_service": types.SimpleNamespace(MarketService=Market),
}):
    prices = load("legacy_prices", "ws/prices.py")
    sectors = load("legacy_sectors", "services/sector_service.py")
    krx = load("legacy_krx", "services/krx_service.py")


class Socket:
    def __init__(self):
        self.messages = []
        self.accepted = False
        self.closed = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, value):
        self.messages.append(value)

    async def close(self, **kwargs):
        self.closed = True


class LegacySafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_middleware_fails_closed_before_handler(self):
        calls, messages = [], []

        async def app(scope, receive, send):
            calls.append(scope["path"])

        async def send(message):
            messages.append(message)

        for secret, token, expected in [
            ("", "", 503), ("short", "Bearer short", 503),
            ("s" * 32, "Bearer wrong", 401), ("s" * 32, "Bearer " + "s" * 32, None),
        ]:
            messages.clear()
            await security.InternalAccessMiddleware(app, secret)(
                {"type": "http", "path": "/api/portfolio", "headers": [(b"authorization", token.encode())]}, None, send)
            if expected:
                self.assertEqual(messages[0]["status"], expected)
            else:
                self.assertEqual(calls, ["/api/portfolio"])
        messages.clear()
        await security.InternalAccessMiddleware(app, "")(
            {"type": "websocket", "path": "/ws/prices", "headers": []}, None, send)
        self.assertEqual(messages, [{"type": "websocket.close", "code": 1008, "reason": "Internal authentication required"}])
        await security.InternalAccessMiddleware(app, "")(
            {"type": "http", "path": "/health"}, None, send)
        self.assertIn("/health", calls)

    async def test_ticker_limits_and_deduplication(self):
        self.assertEqual(prices.parse_tickers("005930,AAPL,aapl"), ["005930", "AAPL"])
        for raw in ["", "../secret", "A" * 513, ",".join(f"A{i}" for i in range(21))]:
            with self.assertRaises(ValueError):
                prices.parse_tickers(raw)

    async def test_one_fetch_per_ticker_and_scoped_delivery(self):
        Market.calls.clear()
        manager = prices.ConnectionManager()
        first, second, third = Socket(), Socket(), Socket()
        await manager.connect(first, ["005930"])
        producer = manager._producer
        await manager.connect(second, ["005930"])
        await manager.connect(third, ["AAPL"])
        self.assertIs(producer, manager._producer)
        for _ in range(50):
            if len(Market.calls) == 2 and all(ws.messages for ws in [first, second, third]):
                break
            await asyncio.sleep(0.002)
        self.assertCountEqual(Market.calls, ["005930", "AAPL"])
        for ws, ticker in [(first, "005930"), (second, "005930"), (third, "AAPL")]:
            self.assertEqual([message["ticker"] for message in ws.messages if message["type"] == "price"], [ticker])
            manager.disconnect(ws)
        await asyncio.sleep(0)
        self.assertEqual(manager.active_tickers, [])
        self.assertTrue(producer.done())

    async def test_capacity_reservation(self):
        manager = prices.ConnectionManager()
        with patch.object(prices, "MAX_CONNECTIONS", 1):
            first, rejected = Socket(), Socket()
            await manager.connect(first, ["005930"])
            self.assertFalse(await manager.connect(rejected, ["AAPL"]))
            self.assertFalse(rejected.accepted)
            self.assertTrue(rejected.closed)
            manager.disconnect(first)
            await asyncio.sleep(0)

    async def test_unverified_data_and_unowned_alerts_are_disabled(self):
        for operation in [sectors.SectorService.get_performance, krx.get_dashboard, krx.get_short_selling]:
            with self.assertRaises(HTTPException) as context:
                await operation()
            self.assertEqual(context.exception.status_code, 503)
        alerts = load("legacy_alerts", "services/alert_service.py")
        with self.assertRaises(RuntimeError):
            await alerts.check_alerts()


if __name__ == "__main__":
    unittest.main()
