"""One bounded quote producer per process; legacy access middleware authenticates first."""
from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.services.market_service import MarketService

logger = logging.getLogger(__name__)
router = APIRouter()
MAX_CONNECTIONS = 64
MAX_TICKERS_PER_CONNECTION = 20
MAX_ACTIVE_TICKERS = 128
TICKER_PATTERN = re.compile(r"(?:[0-9]{6}|[A-Z][A-Z0-9.-]{0,14})", re.ASCII)


def parse_tickers(raw: str) -> list[str]:
    if len(raw) > 512:
        raise ValueError("Ticker list too long")
    tickers = list(dict.fromkeys(part.strip().upper() for part in raw.split(",") if part.strip()))
    if not tickers or len(tickers) > MAX_TICKERS_PER_CONNECTION:
        raise ValueError("Specify between 1 and 20 tickers")
    if any(not TICKER_PATTERN.fullmatch(ticker) for ticker in tickers):
        raise ValueError("Invalid ticker")
    return tickers


class ConnectionManager:
    def __init__(self):
        self._ws_tickers: dict[WebSocket, list[str]] = {}
        self._producer: asyncio.Task | None = None

    @property
    def active_tickers(self) -> list[str]:
        return sorted({ticker for tickers in self._ws_tickers.values() for ticker in tickers})

    async def connect(self, ws: WebSocket, tickers: list[str]) -> bool:
        if len(self._ws_tickers) >= MAX_CONNECTIONS or len(set(self.active_tickers) | set(tickers)) > MAX_ACTIVE_TICKERS:
            await ws.close(code=1013, reason="Stream capacity reached")
            return False
        # Reserve before yielding so concurrent accept calls cannot bypass limits.
        self._ws_tickers[ws] = tickers
        try:
            await ws.accept()
        except BaseException:
            self.disconnect(ws)
            raise
        if self._producer is None or self._producer.done():
            self._producer = asyncio.create_task(self._produce())
        return True

    def disconnect(self, ws: WebSocket) -> None:
        self._ws_tickers.pop(ws, None)
        if not self._ws_tickers and self._producer is not None:
            # Let a producer disconnect its final failed recipient without cancelling itself.
            if self._producer is not asyncio.current_task():
                self._producer.cancel()
            self._producer = None

    async def _send(self, ws: WebSocket, data: dict) -> None:
        try:
            await asyncio.wait_for(ws.send_json(data), timeout=2)
        except Exception:
            self.disconnect(ws)
            try:
                await asyncio.wait_for(ws.close(code=1011), timeout=1)
            except Exception:
                pass

    async def broadcast(self, ticker: str, data: dict) -> None:
        recipients = [ws for ws, tickers in list(self._ws_tickers.items()) if ticker in tickers]
        await asyncio.gather(*(self._send(ws, data) for ws in recipients))

    async def _produce(self) -> None:
        semaphore = asyncio.Semaphore(4)

        async def update(ticker: str):
            async with semaphore:
                try:
                    quote = await asyncio.wait_for(MarketService.get_quote(ticker), timeout=8)
                    if quote:
                        await self.broadcast(ticker, {"type": "price", **quote})
                except Exception as error:
                    logger.warning("WS price fetch [%s]: %s", ticker, error)

        try:
            while self._ws_tickers:
                await asyncio.gather(*(update(ticker) for ticker in self.active_tickers))
                await asyncio.gather(*(self._send(ws, {"type": "heartbeat"}) for ws in list(self._ws_tickers)))
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            pass


manager = ConnectionManager()


@router.websocket("/ws/prices")
async def price_stream(websocket: WebSocket, tickers: str = Query("")):
    # InternalAccessMiddleware checks Authorization before this handler can accept.
    try:
        ticker_list = parse_tickers(tickers)
    except ValueError as error:
        await websocket.close(code=1008, reason=str(error))
        return
    if not await manager.connect(websocket, ticker_list):
        return
    try:
        while True:
            message = await websocket.receive_text()
            if len(message) > 4096:
                await websocket.close(code=1009, reason="Message too large")
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
