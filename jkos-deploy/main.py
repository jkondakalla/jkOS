import asyncio
import collections
import os
from typing import Literal

from fastapi import Cookie, Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from jose import JWTError, jwt

# ── Config ─────────────────────────────────────────────────────────────────────

PUBLIC_KEY = os.getenv("JKOS_AUTH_PUBLIC_KEY", "").replace("\\n", "\n")
STAGING_BRANCH = os.getenv("STAGING_BRANCH", "staging")

PROD_DIR = "/webhost/jkOS"
STAGING_DIR = "/webhost/jkOS-staging"

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
            "git", "-C", directory, "log", "-1", "--pretty=format:%H|||%s|||%ai",
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
            "git", "-C", directory, "rev-parse", "--abbrev-ref", "HEAD",
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

async def get_admin(jkos_token: str | None = Cookie(None)):
    if not jkos_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(
            jkos_token,
            PUBLIC_KEY,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("iss") != "jkos-auth":
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
    return {"staging": staging_info, "prod": prod_info, "status": status, "operation": current_operation}


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
                    ["git", "-C", STAGING_DIR, "fetch", "origin"],
                    ["git", "-C", STAGING_DIR, "reset", "--hard", f"origin/{STAGING_BRANCH}"],
                    ["docker", "compose", "-f", f"{STAGING_DIR}/docker-compose.staging.yml", "up", "--build", "-d"],
                    ["docker", "exec", "standalone-nginx", "nginx", "-t"],
                    # restart, not reload: standalone.conf is a FILE bind-mount.
                    # git reset --hard swaps the file inode, and nginx -s reload
                    # keeps reading the old (pinned) inode — so conf changes
                    # silently never apply. A restart re-resolves the mount.
                    ["docker", "restart", "standalone-nginx"],
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
                "Deploying main to production...",
                [
                    ["git", "-C", PROD_DIR, "fetch", "origin"],
                    ["git", "-C", PROD_DIR, "reset", "--hard", "origin/main"],
                    ["docker", "compose", "-f", f"{PROD_DIR}/docker-compose.yml", "up", "--build", "-d"],
                    ["docker", "exec", "standalone-nginx", "nginx", "-t"],
                    # restart, not reload — see staging_sync for the inode rationale.
                    ["docker", "restart", "standalone-nginx"],
                ],
            )

    asyncio.create_task(run())
    return {"ok": True, "message": "Production deploy started"}
