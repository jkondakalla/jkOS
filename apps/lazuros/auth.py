"""Auth for LazurOS — two accepted credentials:

1. Static bearer token (LAZUROS_TOKEN): server-to-server callers
   (SylibOS/BeigeBoard backends, CLI usage).
2. jkOS SSO JWT (jkos_token cookie, RS256): browser callers reaching us
   through the hub's /api/lazuros proxy on jkos.net — same public key +
   issuer contract as @jkos/auth-middleware, verified here in Python.

If neither credential is configured, access is open — only safe when port
8080 is firewalled from WAN.
"""

import hmac
import os
from typing import Annotated

import jwt
from fastapi import Cookie, Depends, Header, HTTPException

LAZUROS_TOKEN = os.getenv("LAZUROS_TOKEN", "")
JKOS_AUTH_PUBLIC_KEY = os.getenv("JKOS_AUTH_PUBLIC_KEY", "").replace("\\n", "\n").strip()
JKOS_AUTH_ISSUER = os.getenv("JKOS_AUTH_ISSUER", "jkos-auth")


def _verify_jwt(token: str) -> dict | None:
    if not JKOS_AUTH_PUBLIC_KEY:
        return None
    try:
        return jwt.decode(
            token,
            key=JKOS_AUTH_PUBLIC_KEY,
            algorithms=["RS256"],
            issuer=JKOS_AUTH_ISSUER,
            options={"verify_aud": False},
        )
    except jwt.InvalidTokenError:
        return None


def get_current_user(
    authorization: str | None = Header(None),
    jkos_token: str | None = Cookie(None),
):
    if not LAZUROS_TOKEN and not JKOS_AUTH_PUBLIC_KEY:
        # Nothing configured — open access (firewalled homelab fallback).
        return {}

    if authorization and authorization.startswith("Bearer "):
        bearer = authorization[7:]
        if LAZUROS_TOKEN and hmac.compare_digest(bearer, LAZUROS_TOKEN):
            return {"via": "token"}
        claims = _verify_jwt(bearer)  # JWT in the header also works
        if claims:
            return {"via": "jwt", "sub": claims.get("sub"), "role": claims.get("role")}

    if jkos_token:
        claims = _verify_jwt(jkos_token)
        if claims:
            return {"via": "jwt", "sub": claims.get("sub"), "role": claims.get("role")}

    raise HTTPException(status_code=401, detail="Authentication required")


CurrentUser = Annotated[dict, Depends(get_current_user)]
