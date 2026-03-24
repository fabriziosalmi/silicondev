"""Lightweight in-memory rate limiter for sensitive endpoints.

Uses a fixed-window counter keyed by client IP.  No external dependencies.
"""

import time
import logging
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Endpoints subject to rate limiting and their per-window limits.
_RATE_LIMITS: dict[str, int] = {
    "/terminal/exec": 30,
    "/terminal/run": 30,
    "/sandbox/exec": 30,
    "/engine/generate": 20,
    "/engine/generate-stream": 20,
    "/preview/start": 10,
    "/preview/stop": 10,
}

_WINDOW_SECONDS = 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, window: int = _WINDOW_SECONDS):
        super().__init__(app)
        self._window = window
        # {(ip, path): (window_start, count)}
        self._counters: dict[tuple[str, str], tuple[float, int]] = defaultdict(
            lambda: (0.0, 0)
        )

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        limit = next(
            (v for k, v in _RATE_LIMITS.items() if path.startswith(k)), None
        )
        if limit is None:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        key = (client_ip, path)
        now = time.monotonic()
        window_start, count = self._counters[key]

        if now - window_start > self._window:
            # New window
            self._counters[key] = (now, 1)
        elif count >= limit:
            logger.warning("Rate limit hit: %s on %s (%d/%d)", client_ip, path, count, limit)
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded ({limit} req/{self._window}s)"},
            )
        else:
            self._counters[key] = (window_start, count + 1)

        return await call_next(request)
