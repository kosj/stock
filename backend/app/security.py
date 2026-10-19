"""Legacy backend is an internal service, not a user authentication boundary."""
from __future__ import annotations

import secrets


def authorized_internal(secret: str, authorization: str) -> bool:
    # An unset or weak development value must never expose legacy user tables.
    if len(secret) < 32 or not authorization.startswith("Bearer "):
        return False
    return secrets.compare_digest(authorization[7:].encode(), secret.encode())


class InternalAccessMiddleware:
    """Protect HTTP and WebSocket routes before route handlers or DB dependencies."""

    def __init__(self, app, secret: str):
        self.app = app
        self.secret = secret

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or scope.get("path") in ("/", "/health"):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        authorization = headers.get(b"authorization", b"").decode("latin-1")
        if authorized_internal(self.secret, authorization):
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008, "reason": "Internal authentication required"})
            return
        body = b'{"detail":"Legacy backend requires internal authentication"}'
        await send({"type": "http.response.start", "status": 503 if len(self.secret) < 32 else 401,
                    "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": body})
