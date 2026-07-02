import asyncio
import collections
import os
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from jose import ExpiredSignatureError, JWTError

import jkos_auth

# ── Config ─────────────────────────────────────────────────────────────────────

# Token verification (cookie name, issuer, JWKS/static key) lives in jkos_auth.py
# — a port of the canonical node verifier, so this controller can't drift from the
# rest of the suite the way the old inline jwt.decode did.
STAGING_BRANCH = os.getenv("STAGING_BRANCH", "staging")
# Branch the prod checkout resets to on deploy. Set to "staging" so promoting
# deploys the exact commit just tested on staging.jkos.net — no GitHub merge
# step (the server has no push credentials anyway).
PROD_BRANCH = os.getenv("PROD_BRANCH", "main")

# Paths as THIS container sees them (the host checkouts are bind-mounted here).
PROD_DIR = "/webhost/jkOS"
STAGING_DIR = "/webhost/jkOS-staging"
# The same checkouts as the HOST docker daemon sees them. The deploy scripts run
# `docker run -v ...` for nginx config validation, and bind-mount sources are
# resolved by the host daemon (not this container's fs) — so they need host
# paths. HOST_WEBHOST maps /webhost -> the host's webhost root.
HOST_WEBHOST = os.getenv("HOST_WEBHOST", "/mnt/Luna/Webhost")
HOST_PROD_DIR = f"{HOST_WEBHOST}/jkOS"
HOST_STAGING_DIR = f"{HOST_WEBHOST}/jkOS-staging"
SSL_PATH = os.getenv("SSL_PATH", "/mnt/Luna/Backends/ssl")

# The checkouts are bind-mounted from the host and owned by a different uid than
# this container's root user, so git 2.35.3+ refuses to touch them ("detected
# dubious ownership") — which silently broke both the info cards and every
# fetch/reset in a deploy. safe.directory=* whitelists them and survives the
# ownership flipping between deploys. Use GIT in place of "git" everywhere.
GIT = ["git", "-c", "safe.directory=*"]

# ── State ──────────────────────────────────────────────────────────────────────

LOG_FILE = Path("/var/log/jkos-deploy/last.log")

status: Literal["idle", "running", "done", "error"] = "idle"
current_operation: str = ""
log_lines: collections.deque = collections.deque(maxlen=500)
_log_seq: int = 0
_log_lock = asyncio.Lock()
_log_file: "asyncio.StreamWriter | None" = None

# ── Helpers ────────────────────────────────────────────────────────────────────

async def _log(line: str) -> None:
    global _log_seq
    async with _log_lock:
        _log_seq += 1
        log_lines.append((_log_seq, line))
        try:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a") as f:
                f.write(line + "\n")
        except Exception:
            pass


async def _run(cmd: list[str], env: dict | None = None) -> bool:
    await _log(f"$ {' '.join(cmd)}")
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        async for raw in proc.stdout:
            await _log(raw.decode(errors="replace").rstrip())
        await proc.wait()
    except Exception as e:
        await _log(f"[ERROR] failed to start process: {e}")
        return False
    if proc.returncode != 0:
        await _log(f"[ERROR] exited with code {proc.returncode}")
    return proc.returncode == 0


async def _git_info(directory: str) -> dict:
    try:
        proc = await asyncio.create_subprocess_exec(
            *GIT, "-C", directory, "log", "-1", "--pretty=format:%H|||%s|||%ai",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return {"branch": "unknown", "commit_hash": "unknown", "commit_msg": "unknown", "commit_date": "unknown"}
        parts = out.decode().strip().split("|||")
        commit_hash = parts[0] if parts else "unknown"
        commit_msg  = parts[1] if len(parts) > 1 else "unknown"
        commit_date = parts[2] if len(parts) > 2 else "unknown"

        bp = await asyncio.create_subprocess_exec(
            *GIT, "-C", directory, "rev-parse", "--abbrev-ref", "HEAD",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        bout, _ = await bp.communicate()
        branch = bout.decode().strip() if bp.returncode == 0 else "unknown"

        return {"branch": branch, "commit_hash": commit_hash, "commit_msg": commit_msg, "commit_date": commit_date}
    except Exception:
        return {"branch": "unknown", "commit_hash": "unknown", "commit_msg": "unknown", "commit_date": "unknown"}


async def _run_script(operation: str, script: str, env: dict[str, str]) -> None:
    """Stream a single deploy script and set terminal status from its exit code.

    The deploy steps live in infra/scripts/*.sh (one source of truth shared with
    by-hand host runs); this just execs the script with the right env and relays
    its output. The script prints its own section headers; we own the final
    DONE/FAILED line so it's authoritative regardless of what the script logs.
    """
    global status, current_operation
    current_operation = operation
    try:
        ok = await _run(["bash", script], env={**os.environ, **env})
    except Exception as e:  # never leave status stuck at "running" — that 409s every future deploy
        await _log(f"[ERROR] deploy crashed: {e}")
        ok = False
    await _log("=== DONE ===" if ok else "=== FAILED — see log above ===")
    status = "done" if ok else "error"
    current_operation = ""


def _start(operation: str, script: str, env: dict[str, str]) -> dict:
    """Guard against concurrent deploys, then kick one off in the background.

    The guard MUST be synchronous: an async check would let two requests that
    arrive in the same tick both pass before either flips the flag (the old
    deploy_lock.locked() check did exactly that — a double-click queued a second
    deploy). asyncio is single-threaded, so setting status here (no await in
    between) is atomic against other requests.
    """
    global status, current_operation
    if status == "running":
        # Same { error, code } envelope as every other response so a client parses
        # one shape; DEPLOY_IN_PROGRESS is local (not an auth wire code).
        raise HTTPException(status_code=409, detail={"error": "A deploy is already in progress", "code": "DEPLOY_IN_PROGRESS"})
    status = "running"
    current_operation = operation
    log_lines.clear()  # fresh panel per deploy; _log_seq stays monotonic for SSE clients
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOG_FILE.write_text("")
    except Exception:
        pass

    async def run():
        global status, current_operation
        try:
            await _log(f"=== {operation} ===")
            await _run_script(operation, script, env)
        except Exception:
            # Last-resort guard: if anything above (even _log) blows up, release
            # the lock so the next deploy isn't permanently 409'd.
            status = "error"
            current_operation = ""

    asyncio.create_task(run())
    return {"ok": True, "message": f"{operation} started"}


# ── Auth ───────────────────────────────────────────────────────────────────────

async def get_admin(request: Request):
    # 401s carry a `code` matching the node middleware's vocabulary (TOKEN_EXPIRED
    # / UNAUTHENTICATED) so the browser console can tell a refreshable expiry from a
    # real auth failure — and refresh-once-then-surface instead of looping to login.
    token = request.cookies.get(jkos_auth.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail={"error": "Not authenticated", "code": jkos_auth.CODES["UNAUTHENTICATED"]})
    try:
        # verify_token may fetch JWKS, so run it off the event loop. It verifies
        # signature, exp and issuer; an invalid token (or bad issuer) raises.
        payload = await asyncio.get_event_loop().run_in_executor(None, jkos_auth.verify_token, token)
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail={"error": "Token expired", "code": jkos_auth.CODES["TOKEN_EXPIRED"]})
    except JWTError:
        raise HTTPException(status_code=401, detail={"error": "Invalid token", "code": jkos_auth.CODES["UNAUTHENTICATED"]})
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail={"error": "Admin access required", "code": jkos_auth.CODES["FORBIDDEN"]})
    return payload


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI()


@app.get("/")
async def root():
    return FileResponse("/app/static/index.html")


@app.get("/jkos-tokens.css")
async def tokens_css():
    # Committed mirror of @jkos/design/tokens/hub.css (see scripts/sync-tokens.mjs) —
    # the console styles itself from the suite token chain like every other app.
    return FileResponse("/app/static/jkos-tokens.css", media_type="text/css")


@app.get("/health")
async def health():
    # Match @jkos/weave/server's healthHandler shape so the portal's systems panel
    # reads every service's health with one parser.
    return {"status": "ok", "service": "jkos-deploy"}


@app.get("/info")
async def info(_=Depends(get_admin)):
    staging_info, prod_info = await asyncio.gather(
        _git_info(STAGING_DIR),
        _git_info(PROD_DIR),
    )
    return {
        "staging": staging_info,
        "prod": prod_info,
        "status": status,
        "operation": current_operation,
        "branches": {"staging": STAGING_BRANCH, "prod": PROD_BRANCH},
    }


@app.get("/logs/stream")
async def logs_stream(_=Depends(get_admin)):
    async def generator():
        current = list(log_lines)
        last_seq = 0
        for seq, line in current:
            yield f"data: {line}\n\n"
            last_seq = seq

        idle_ticks = 0
        while True:
            await asyncio.sleep(1)
            current = list(log_lines)
            new_items = [(s, l) for s, l in current if s > last_seq]
            for seq, line in new_items:
                yield f"data: {line}\n\n"
                last_seq = seq
            if new_items:
                idle_ticks = 0
            else:
                idle_ticks += 1
                if idle_ticks >= 15:
                    yield ": keepalive\n\n"
                    idle_ticks = 0

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.get("/logs/raw")
async def logs_raw(_=Depends(get_admin)):
    """Return the full untruncated log for the last deploy run."""
    if not LOG_FILE.exists():
        return PlainTextResponse("(no log yet)", media_type="text/plain")
    return PlainTextResponse(LOG_FILE.read_text(errors="replace"), media_type="text/plain")


@app.post("/staging/sync")
async def staging_sync(_=Depends(get_admin)):
    return _start(
        "Syncing staging from GitHub...",
        f"{STAGING_DIR}/infra/scripts/deploy-staging.sh",
        {
            "ENV_NAME": "staging",
            "REPO_DIR": STAGING_DIR,
            "HOST_REPO_DIR": HOST_STAGING_DIR,
            "BRANCH": STAGING_BRANCH,
            "COMPOSE_FILE": "docker-compose.staging.yml",
            "SSL_PATH": SSL_PATH,
        },
    )


@app.post("/prod/deploy")
async def prod_deploy(_=Depends(get_admin)):
    return _start(
        f"Deploying {PROD_BRANCH} to production...",
        f"{PROD_DIR}/infra/scripts/deploy-prod.sh",
        {
            "ENV_NAME": "production",
            "REPO_DIR": PROD_DIR,
            "HOST_REPO_DIR": HOST_PROD_DIR,
            "BRANCH": PROD_BRANCH,
            "COMPOSE_FILE": "docker-compose.yml",
            "SSL_PATH": SSL_PATH,
        },
    )
