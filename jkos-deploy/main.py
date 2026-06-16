import asyncio
import collections
import os
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from jose import JWTError, jwt

# ── Config ─────────────────────────────────────────────────────────────────────

PUBLIC_KEY = os.getenv("JKOS_AUTH_PUBLIC_KEY", "").replace("\\n", "\n")
# jkos-deploy lives in the staging environment, so it verifies staging tokens:
# cookie name jkos_token_staging (suffix) and issuer jkos-auth-staging. These
# default to the prod values so the controller still works if run unscoped.
COOKIE_NAME = "jkos_token" + os.getenv("JKOS_COOKIE_SUFFIX", "")
EXPECTED_ISSUER = os.getenv("JKOS_AUTH_ISSUER", "jkos-auth")
STAGING_BRANCH = os.getenv("STAGING_BRANCH", "staging")
# Branch the prod checkout resets to on deploy. Set to "staging" so promoting
# deploys the exact commit just tested on staging.jkos.net — no GitHub merge
# step (the server has no push credentials anyway).
PROD_BRANCH = os.getenv("PROD_BRANCH", "main")

PROD_DIR = "/webhost/jkOS"
STAGING_DIR = "/webhost/jkOS-staging"

# The checkouts are bind-mounted from the host and owned by a different uid than
# this container's root user, so git 2.35.3+ refuses to touch them ("detected
# dubious ownership") — which silently broke both the info cards and every
# fetch/reset in a deploy. safe.directory=* whitelists them and survives the
# ownership flipping between deploys. Use GIT in place of "git" everywhere.
GIT = ["git", "-c", "safe.directory=*"]

# ── State ──────────────────────────────────────────────────────────────────────

deploy_lock = asyncio.Lock()
status: Literal["idle", "running", "done", "error"] = "idle"
current_operation: str = ""
log_lines: collections.deque = collections.deque(maxlen=500)
_log_seq: int = 0
_log_lock = asyncio.Lock()

# ── Helpers ────────────────────────────────────────────────────────────────────

async def _log(line: str) -> None:
    global _log_seq
    async with _log_lock:
        _log_seq += 1
        log_lines.append((_log_seq, line))


async def _run(cmd: list[str]) -> bool:
    await _log(f"$ {' '.join(cmd)}")
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
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


async def _run_sequence(operation: str, sequence: list[list[str]]) -> None:
    global status, current_operation
    status = "running"
    current_operation = operation
    await _log(f"=== {operation} ===")
    for cmd in sequence:
        ok = await _run(cmd)
        if not ok:
            await _log("=== FAILED — aborting sequence ===")
            status = "error"
            current_operation = ""
            return
    await _log("=== DONE ===")
    status = "done"
    current_operation = ""


# ── Auth ───────────────────────────────────────────────────────────────────────

async def get_admin(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(
            token,
            PUBLIC_KEY,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("iss") != EXPECTED_ISSUER:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI()


@app.get("/")
async def root():
    return FileResponse("/app/static/index.html")


@app.get("/health")
async def health():
    return {"ok": True}


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


@app.post("/staging/sync")
async def staging_sync(_=Depends(get_admin)):
    if deploy_lock.locked():
        raise HTTPException(status_code=409, detail="A deploy is already in progress")

    async def run():
        async with deploy_lock:
            await _run_sequence(
                "Syncing staging from GitHub...",
                [
                    [*GIT, "-C", STAGING_DIR, "fetch", "origin"],
                    [*GIT, "-C", STAGING_DIR, "reset", "--hard", f"origin/{STAGING_BRANCH}"],
                    ["docker", "compose", "-f", f"{STAGING_DIR}/docker-compose.staging.yml", "up", "--build", "-d"],
                    ["docker", "exec", "standalone-nginx", "nginx", "-t"],
                    # Recreate the nginx container, not just reload: standalone.conf is a
                    # FILE bind-mount (inode-pinned — reload silently reads the old inode
                    # after git reset swaps the file). `up` recreates it so the new conf
                    # is read; --build is a cheap no-op for the now stock-nginx image.
                    ["docker", "compose", "-f", f"{STAGING_DIR}/infra/nginx/docker-compose.yml", "up", "--build", "-d"],
                ],
            )

    asyncio.create_task(run())
    return {"ok": True, "message": "Staging sync started"}


@app.post("/prod/deploy")
async def prod_deploy(_=Depends(get_admin)):
    if deploy_lock.locked():
        raise HTTPException(status_code=409, detail="A deploy is already in progress")

    async def run():
        async with deploy_lock:
            await _run_sequence(
                f"Deploying {PROD_BRANCH} to production...",
                [
                    [*GIT, "-C", PROD_DIR, "fetch", "origin"],
                    [*GIT, "-C", PROD_DIR, "reset", "--hard", f"origin/{PROD_BRANCH}"],
                    ["docker", "compose", "-f", f"{PROD_DIR}/docker-compose.yml", "up", "--build", "-d"],
                    ["docker", "exec", "standalone-nginx", "nginx", "-t"],
                    # restart, not reload — see staging_sync for the inode rationale.
                    ["docker", "restart", "standalone-nginx"],
                ],
            )

    asyncio.create_task(run())
    return {"ok": True, "message": "Production deploy started"}
