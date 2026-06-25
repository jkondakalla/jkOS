"""jkos_auth.py — the suite's JWT verifier, in Python.

A faithful port of @jkos/auth-middleware (the canonical node verifier) so a
jkAuth-minted token verifies identically here, across the language boundary.

Why this module exists: jkos-deploy used to hand-roll a one-off ``jwt.decode``
that drifted from the node side and 401'd every valid token —

  * once when python-jose 3.5 began enforcing RFC-7519's string ``sub`` (that's
    the redirect loop that took down staging.jkos.net/deploy on 2026-06-23), and
  * it would have again the moment jkAuth promoted its NEXT signing key, because
    it only ever knew one STATIC public key and never read jkAuth's /auth/jwks.

So this mirrors the node ladder: prefer JWKS-by-``kid`` (rotation-safe), fall
back to the static public key (so a briefly-unreachable jkAuth doesn't take the
console down either). Same env contract as @jkos/auth-middleware:

  JKOS_AUTH_JWKS_URI    when set, fetch keys here and pick by the token's ``kid``
  JKOS_AUTH_PUBLIC_KEY  static PEM fallback (and the only key before rotation)
  JKOS_AUTH_ISSUER      verified ``iss`` (default 'jkos-auth'; staging: -staging)
  JKOS_COOKIE_SUFFIX    cookie name = 'jkos_token' + suffix
  JKOS_APP_ID           when set, ``aud`` MUST include it (opt-in audience check)
"""

import json
import os
import threading
import time
import urllib.request

from jose import JWTError, jwk, jwt

# ── Canonical error-code vocabulary ─────────────────────────────────────────────
# Python mirror of @jkos/auth-middleware/codes.js — the suite's machine-readable
# `code` field. The browser console (auth-client's authFetch) refreshes-then-retries
# on UNAUTHENTICATED / TOKEN_EXPIRED, so this controller MUST spell them the same way
# the node verifier does. `pnpm test:contracts` reads this dict and asserts it stays
# key-for-key equal to the node CODES, so a rename on either side fails the build.
CODES = {
    "UNAUTHENTICATED": "UNAUTHENTICATED",
    "TOKEN_EXPIRED": "TOKEN_EXPIRED",
    "FORBIDDEN": "FORBIDDEN",
    "INSUFFICIENT_SCOPE": "INSUFFICIENT_SCOPE",
    "NO_AUTH": "NO_AUTH",
    "READ_ONLY": "READ_ONLY",
    "NO_USER_CONTEXT": "NO_USER_CONTEXT",
    "SESSION_EXPIRED": "SESSION_EXPIRED",
    "SESSION_REVOKED": "SESSION_REVOKED",
}

# ── Config (one source of truth, same contract as the node middleware) ──────────
# These two literals mirror @jkos/auth-middleware's ISSUER_DEFAULT / ACCESS_COOKIE_BASE;
# `pnpm test:contracts` asserts they stay equal so the default issuer and the cookie
# the verifiers read can't silently diverge across the language boundary.
ISSUER_DEFAULT = "jkos-auth"
ACCESS_COOKIE_BASE = "jkos_token"
COOKIE_NAME = ACCESS_COOKIE_BASE + os.getenv("JKOS_COOKIE_SUFFIX", "")
EXPECTED_ISSUER = os.getenv("JKOS_AUTH_ISSUER", ISSUER_DEFAULT)
STATIC_PUBLIC_KEY = os.getenv("JKOS_AUTH_PUBLIC_KEY", "").replace("\\n", "\n")
JWKS_URI = os.getenv("JKOS_AUTH_JWKS_URI", "").strip()
APP_ID = os.getenv("JKOS_APP_ID") or None

# Match the node resolver's timings: refresh the whole set every 10 min, and
# throttle refetch-on-unknown-kid to once per 30 s so a barrage of bad/old tokens
# can't hammer jkAuth.
_CACHE_MAX_S = 10 * 60
_MIN_REFETCH_S = 30

# ── JWKS resolver (port of makeJwksResolver) ────────────────────────────────────
_lock = threading.Lock()
_keys: dict = {}          # kid -> constructed jose key
_fetched_at = 0.0


def _refresh() -> None:
    """Fetch /auth/jwks and rebuild the kid -> key cache. Raises on network error."""
    global _keys, _fetched_at
    req = urllib.request.Request(JWKS_URI, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = json.loads(resp.read().decode())
    nxt = {}
    for entry in body.get("keys", []):
        kid = entry.get("kid")
        if not kid:
            continue
        try:
            nxt[kid] = jwk.construct(entry, "RS256")
        except Exception:
            continue  # skip an unparseable key rather than poisoning the cache
    if nxt:
        _keys = nxt
        _fetched_at = time.monotonic()


def _jwks_key(kid):
    """Constructed key for ``kid`` from the live JWKS, or None.

    Serves from cache; (re)fetches when the cache is empty, stale, or the kid is
    unknown (a rotation just happened) — throttled. If JWKS is unreachable and
    nothing is cached, returns None so the caller can fall back to the static key.
    """
    if not JWKS_URI or not kid:
        return None
    with _lock:
        stale = (time.monotonic() - _fetched_at) >= _CACHE_MAX_S
        if kid in _keys and not stale:
            return _keys[kid]
        if not _keys or stale or (time.monotonic() - _fetched_at) >= _MIN_REFETCH_S:
            try:
                _refresh()
            except Exception:
                if not _keys:
                    return None
        return _keys.get(kid)


def _resolve_key(kid):
    # JWKS first (rotation-aware); static PEM as the fallback. A mismatched key
    # just fails the signature check in verify_token, so falling back is always
    # safe — never a bypass.
    key = _jwks_key(kid)
    if key is not None:
        return key
    if STATIC_PUBLIC_KEY:
        return STATIC_PUBLIC_KEY
    raise JWTError("no verifying key available (set JKOS_AUTH_JWKS_URI or JKOS_AUTH_PUBLIC_KEY)")


def verify_token(token: str) -> dict:
    """Verify a jkAuth RS256 token and return its claims, or raise JWTError.

    Blocking (may fetch JWKS on a cache miss) — call from an async handler via
    ``run_in_executor`` so it never stalls the event loop.
    """
    kid = jwt.get_unverified_header(token).get("kid")
    key = _resolve_key(kid)
    # Signature, exp, and iss ARE verified (issuer moved into decode to match the
    # node side); aud only when APP_ID is set. verify_sub stays OFF as
    # defense-in-depth: jkAuth now mints a string `sub` so this is moot, but it
    # stops a future numeric-sub regression from looping the console again.
    return jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        issuer=EXPECTED_ISSUER,
        audience=APP_ID,
        options={"verify_aud": bool(APP_ID), "verify_sub": False},
    )
