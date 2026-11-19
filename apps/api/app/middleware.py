"""ASGI middleware: request ids, request size limits, access log, per-IP rate limiting."""

from __future__ import annotations

import json
import logging
import re
import secrets
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .logging_setup import request_id_var

log = logging.getLogger("sem_studio.http")
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{8,64}$")

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


class _TooLarge(Exception):
    pass


async def _send_json(send: Send, status: int, body: dict[str, Any], headers: list[tuple[bytes, bytes]]) -> None:
    raw = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode()), *headers],
        }
    )
    await send({"type": "http.response.body", "body": raw})


class RequestMiddleware:
    """Outermost layer. Assigns X-Request-ID, enforces body limits before any parsing, logs one line per request."""

    def __init__(self, app: Callable, max_body: Callable[[str, str], int]):
        self.app = app
        self.max_body = max_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope["headers"]}
        incoming = headers.get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _SAFE_ID.match(incoming) else secrets.token_hex(8)
        token = request_id_var.set(rid)
        rid_header = [(b"x-request-id", rid.encode())]
        started = time.monotonic()
        status_holder = [0]
        method, path = scope["method"], scope["path"]
        limit = self.max_body(method, path)

        async def send_wrapped(msg: dict[str, Any]) -> None:
            if msg["type"] == "http.response.start":
                status_holder[0] = msg["status"]
                msg = {**msg, "headers": [*msg.get("headers", []), *rid_header]}
            await send(msg)

        try:
            declared = headers.get(b"content-length")
            if declared is not None and declared.isdigit() and int(declared) > limit:
                await _send_json(
                    send_wrapped,
                    413,
                    {
                        "error": {
                            "code": "REQUEST_TOO_LARGE",
                            "message": "The request body is too large.",
                            "requestId": rid,
                        }
                    },
                    [],
                )
                return

            received = [0]

            async def receive_limited() -> dict[str, Any]:
                msg = await receive()
                if msg["type"] == "http.request":
                    received[0] += len(msg.get("body", b""))
                    if received[0] > limit:
                        raise _TooLarge
                return msg

            try:
                await self.app(scope, receive_limited, send_wrapped)
            except _TooLarge:
                if status_holder[0] == 0:
                    await _send_json(
                        send_wrapped,
                        413,
                        {
                            "error": {
                                "code": "REQUEST_TOO_LARGE",
                                "message": "The request body is too large.",
                                "requestId": rid,
                            }
                        },
                        [],
                    )
            except Exception as e:  # last resort: JSON 500 with request id and CORS, never a trace
                log.error("unhandled exception", extra={"error_type": type(e).__name__})
                if status_holder[0] == 0:
                    await _send_json(
                        send_wrapped,
                        500,
                        {
                            "error": {
                                "code": "INTERNAL_ERROR",
                                "message": "An internal error occurred.",
                                "requestId": rid,
                            }
                        },
                        [],
                    )
        finally:
            log.info(
                "request",
                extra={
                    "method": method,
                    "path": path,
                    "status": status_holder[0],
                    "duration_ms": int((time.monotonic() - started) * 1000),
                },
            )
            request_id_var.reset(token)


class TokenBucket:
    """Per-key token bucket held in process memory: limits are per API instance, not global.

    With several API replicas the effective limit is replicas x rate; use an edge limiter for a hard cap.
    """

    def __init__(self, per_minute: int, burst: int | None = None, clock: Callable[[], float] = time.monotonic):
        self.rate = per_minute / 60.0
        self.capacity = float(burst if burst is not None else max(1, per_minute))
        self.clock = clock
        self._lock = threading.Lock()
        self._buckets: dict[str, tuple[float, float]] = {}

    def take(self, key: str) -> float:
        """0.0 if allowed, else seconds until a token is available."""
        if self.rate <= 0:
            return 0.0
        with self._lock:
            now = self.clock()
            tokens, last = self._buckets.get(key, (self.capacity, now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens >= 1:
                self._buckets[key] = (tokens - 1, now)
                if len(self._buckets) > 10_000:  # bound memory
                    self._buckets = {k: v for k, v in self._buckets.items() if v[0] < self.capacity}
                return 0.0
            self._buckets[key] = (tokens, now)
            return (1 - tokens) / self.rate
