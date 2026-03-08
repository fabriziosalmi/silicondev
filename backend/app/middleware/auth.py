"""Local auth middleware: validates a shared secret token between Electron and the backend.

Electron generates a random token at startup, passes it via the SILICON_AUTH_TOKEN
environment variable, and includes it as a Bearer token in every API request.
This prevents other local processes from calling the backend API.
"""

import os
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Paths that don't require authentication
_PUBLIC_PATHS = {"/health", "/docs", "/openapi.json"}

_TOKEN = os.environ.get("SILICON_AUTH_TOKEN", "")


class LocalAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip auth for public endpoints and OPTIONS (CORS preflight)
        if request.url.path in _PUBLIC_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        # If no token was configured, skip auth (dev/standalone mode)
        if not _TOKEN:
            return await call_next(request)

        # Accept token via Authorization header or ?token= query param (for EventSource/SSE)
        auth_header = request.headers.get("authorization", "")
        query_token = request.query_params.get("token", "")
        if auth_header == f"Bearer {_TOKEN}" or query_token == _TOKEN:
            return await call_next(request)

        logger.warning(f"Rejected unauthorized request to {request.url.path}")
        return JSONResponse(
            status_code=403,
            content={"detail": "Unauthorized: invalid or missing auth token"},
        )
