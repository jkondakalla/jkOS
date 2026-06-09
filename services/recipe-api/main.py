"""Recipe API — jkHUB service.

Requires env vars:
  JKOS_AUTH_PUBLIC_KEY  — RSA public key from jkos-auth (copy from jkos-auth/.env)
  SHELL_URL             — e.g. https://YOUR_DOMAIN
  LAZUROS_URL           — e.g. http://ordeck-lazuros:8003
  LAZUROS_TOKEN         — API token from ORDECK Settings → API Tokens
  LAZUROS_DEFAULT_MODEL — e.g. llama3.2  (optional, default: llama3.2)
"""
import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth import CurrentUser

SHELL_URL             = os.getenv("SHELL_URL",             "http://localhost:3000")
LAZUROS_URL           = os.getenv("LAZUROS_URL",           "http://localhost:8080").rstrip("/")
LAZUROS_TOKEN         = os.getenv("LAZUROS_TOKEN",         "")
LAZUROS_DEFAULT_MODEL = os.getenv("LAZUROS_DEFAULT_MODEL", "llama3.2")

app = FastAPI(title="Recipe API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[SHELL_URL],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

_ai_headers = {"Authorization": f"Bearer {LAZUROS_TOKEN}"} if LAZUROS_TOKEN else {}


async def _ai_chat(messages: list[dict], model: str | None = None) -> str:
    """Single call to LazurOS → Ollama. Returns assistant reply text."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(
            f"{LAZUROS_URL}/api/chat",
            json={"model": model or LAZUROS_DEFAULT_MODEL, "messages": messages, "stream": False},
            headers=_ai_headers,
        )
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "")


# ── Public endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "recipe"}


# ── Protected endpoints ───────────────────────────────────────────────────────

class SuggestRequest(BaseModel):
    prompt: str
    model: str | None = None


@app.post("/api/recipes/suggest")
async def suggest(body: SuggestRequest, _user: CurrentUser) -> dict:
    """Generate a complete recipe from ingredients, meal type, or dietary preference."""
    if not body.prompt.strip():
        raise HTTPException(400, "prompt is required")

    try:
        reply = await _ai_chat(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful chef. Given ingredients, a meal type, or dietary preference, "
                        "suggest one complete recipe. Include: recipe name, ingredient list with amounts, "
                        "and numbered step-by-step instructions. Be concise and practical."
                    ),
                },
                {"role": "user", "content": body.prompt.strip()},
            ],
            model=body.model,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"AI service returned {e.response.status_code}")
    except httpx.RequestError:
        raise HTTPException(503, "AI service unavailable")
    return {"recipe": reply}
