"""LazurOS — the jkOS AI gateway.

Fronts the Ollama instance on the GPU desktop ("compute node"):

- Proxies /api/* to Ollama with streaming pass-through (NDJSON chat tokens).
- Wakes the desktop via Wake-on-LAN when a request arrives while it sleeps
  (AUTO_WAKE), waiting up to WAKE_TIMEOUT_SECONDS before giving up with 503 —
  this is what lets the SylibOS 2am nightly job run against a sleeping desktop.
- Passive endpoints (/health, /models, /ps) never wake the node, so widget
  polling doesn't keep the desktop awake.

Auth: static bearer token or jkOS SSO JWT (see auth.py).
"""

import logging
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

load_dotenv()

import compute  # noqa: E402  (reads env at import; load_dotenv must run first)
from auth import CurrentUser  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("lazuros")

SHELL_URL = os.getenv("SHELL_URL", "http://localhost:3000")
AUTO_WAKE = os.getenv("AUTO_WAKE", "true").lower() in ("1", "true", "yes")
WAKE_TIMEOUT_SECONDS = int(os.getenv("WAKE_TIMEOUT_SECONDS", "45"))
GENERATION_TIMEOUT_SECONDS = int(os.getenv("GENERATION_TIMEOUT_SECONDS", "600"))

_waking = False  # surfaced in /health so UIs can show "waking…"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # One pooled client for the process. Long read timeout: generation streams
    # can pause between tokens; connect stays snappy for liveness checks.
    timeout = httpx.Timeout(connect=5.0, read=GENERATION_TIMEOUT_SECONDS, write=30.0, pool=5.0)
    _app.state.client = httpx.AsyncClient(timeout=timeout)
    log.info("LazurOS up — compute node %s (auto_wake=%s)", compute.OLLAMA_BASE, AUTO_WAKE)
    yield
    await _app.state.client.aclose()


app = FastAPI(title="LazurOS", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[SHELL_URL],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ── Public ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health(request: Request):
    online = await compute.is_online(request.app.state.client)
    return {
        "lazuros": "ok",
        "compute_online": online,
        "compute_ip": compute.COMPUTE_NODE_IP,
        "waking": _waking,
    }


# ── Management (authenticated; never auto-triggered) ─────────────────────────

@app.post("/wake")
async def wake(request: Request, _user: CurrentUser):
    if await compute.is_online(request.app.state.client):
        return {"waking": False, "message": "Compute node is already online"}
    sent = compute.send_wol()
    return {
        "waking": True,
        "message": "Magic packet sent" if sent else "Wake already in progress (or MAC unset)",
    }


@app.get("/models")
async def models(request: Request, _user: CurrentUser):
    return await _passive_ollama(request, "/api/tags")


@app.get("/ps")
async def ps(request: Request, _user: CurrentUser):
    return await _passive_ollama(request, "/api/ps")


async def _passive_ollama(request: Request, path: str):
    """Poll-style read: report sleeping rather than waking the desktop."""
    client = request.app.state.client
    if not await compute.is_online(client):
        return {"sleeping": True, "models": []}
    try:
        r = await client.get(f"{compute.OLLAMA_BASE}{path}", timeout=5.0)
        data = r.json()
        return {"sleeping": False, "models": data.get("models", [])}
    except httpx.HTTPError as e:
        log.warning("passive %s failed: %s", path, e)
        return {"sleeping": True, "models": []}


# ── Ollama proxy (authenticated, streaming, auto-wake) ───────────────────────

# Hop-by-hop headers must not be forwarded either direction.
_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
    "authorization", "cookie",
}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy(request: Request, path: str, _user: CurrentUser):
    global _waking
    if request.method == "OPTIONS":
        return Response(status_code=204)

    client: httpx.AsyncClient = request.app.state.client

    if not await compute.is_online(client):
        if not AUTO_WAKE:
            return JSONResponse({"error": "compute node is offline"}, status_code=503)
        _waking = True
        try:
            awake = await compute.ensure_awake(client, WAKE_TIMEOUT_SECONDS)
        finally:
            _waking = False
        if not awake:
            return JSONResponse(
                {"error": f"compute node did not wake within {WAKE_TIMEOUT_SECONDS}s", "waking": True},
                status_code=503,
            )

    upstream_headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_HEADERS
    }
    upstream = client.build_request(
        request.method,
        f"{compute.OLLAMA_BASE}/api/{path}",
        params=request.query_params,
        headers=upstream_headers,
        content=await request.body(),
    )
    try:
        resp = await client.send(upstream, stream=True)
    except httpx.HTTPError as e:
        log.error("proxy /api/%s failed: %s", path, e)
        return JSONResponse({"error": f"upstream error: {e}"}, status_code=502)

    log.info("proxy %s /api/%s → %s", request.method, path, resp.status_code)
    response_headers = {
        k: v for k, v in resp.headers.items() if k.lower() not in _HOP_HEADERS
    }

    async def body():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(body(), status_code=resp.status_code, headers=response_headers)
