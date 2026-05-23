"""
WebSocket 실시간 가격 스트리밍.
연결 시 ?tickers=005930,000660 쿼리 파라미터로 종목 지정.
5초마다 가격 브로드캐스트.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.services.market_service import MarketService

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    def __init__(self):
        # {ticker: {websocket, ...}}
        self._connections: Dict[str, Set[WebSocket]] = {}
        # {websocket: [tickers]}
        self._ws_tickers: Dict[WebSocket, list[str]] = {}

    async def connect(self, ws: WebSocket, tickers: list[str]) -> None:
        await ws.accept()
        self._ws_tickers[ws] = tickers
        for ticker in tickers:
            self._connections.setdefault(ticker, set()).add(ws)
        logger.info(f"WS connected: {tickers}")

    def disconnect(self, ws: WebSocket) -> None:
        tickers = self._ws_tickers.pop(ws, [])
        for ticker in tickers:
            self._connections.get(ticker, set()).discard(ws)
        logger.info(f"WS disconnected: {tickers}")

    @property
    def active_tickers(self) -> list[str]:
        return [t for t, ws_set in self._connections.items() if ws_set]

    async def broadcast(self, ticker: str, data: dict) -> None:
        ws_set = self._connections.get(ticker, set()).copy()
        dead: Set[WebSocket] = set()
        for ws in ws_set:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


@router.websocket("/ws/prices")
async def price_stream(
    websocket: WebSocket,
    tickers: str = Query(""),
):
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        await websocket.close(code=1008, reason="tickers 파라미터 필요")
        return

    await manager.connect(websocket, ticker_list)

    try:
        while True:
            # 5초마다 가격 업데이트
            for ticker in ticker_list:
                try:
                    quote = await MarketService.get_quote(ticker)
                    if quote:
                        await manager.broadcast(ticker, {"type": "price", **quote})
                except Exception as e:
                    logger.warning(f"WS price fetch [{ticker}]: {e}")

            # heartbeat
            try:
                await websocket.send_json({"type": "heartbeat"})
            except Exception:
                break

            await asyncio.sleep(5)

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
