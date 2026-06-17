# jkAuth — Audit, Refactor & Upgrade Plan

_Status: prepared 2026-06-17 ahead of the security/feature upgrade. The clean
refactor + safe hardening in this doc are **committed but NOT deployed** — jkAuth
is live on prod+staging and the upgrade lands tomorrow. Review, then deploy via
the normal Sync Staging flow._

jkAuth is the suite SSO: an Express service that mints **RS256 JWTs** (15-min
access cookie `jkos_token` + 30-day rotating refresh cookie `jkos_refresh`, both
httpOnly on `.jkos.net`), backed by SQLite (`better-sqlite3`), with password
(bcrypt) + Google OAuth login. Every backend verifies tokens through the shared
`@jkos/auth-middleware`. nginx gates staging via `auth_request → /auth/require-admin`.

**Regression net:** `npm test` in `apps/jkauth/` (= `node test/smoke.mjs`) — spawns
the server with an in-process keypair + temp DB and drives every flow (32
assertions, two server instances). Run it before and after any change; behaviour
must stay green.

---

## 1. What was not up to snuff

### Security
| # | Severity | Finding |
|---|----------|---------|
| S1 | **High** | **Google account-linking trusted email without checking `verified_email`.** The callback linked a Google login to an existing password account purely by matching email — an unverified Google email matching a victim's jkOS email was an account-takeover vector. _(Fixed today: reject `verified_email === false`.)_ |
| S2 | High | **No refresh-token reuse/theft detection.** Refresh tokens rotate, but presenting an already-rotated token just 401s silently instead of invalidating the session family. A stolen-then-rotated token isn't detected. _(Upgrade item — needs a `session_family` column.)_ |
| S3 | Med | **bcrypt 72-byte truncation.** Passwords >72 bytes are silently truncated by bcrypt; no max-length guard (also a mild DoS — bcrypt on a huge string). _(Today: max-length guard. Proper fix: argon2id, see U1.)_ |
| S4 | Med | **No key rotation path.** Single RSA key; JWTs were signed without a `kid` while JWKS advertised `kid:"1"`. _(Today: sign with `kid:"1"`. Upgrade: multi-key JWKS + kid-based verify in the middleware.)_ |
| S5 | Med | **No audit log.** Logins, failures, admin actions, and refreshes leave no durable trail. _(Upgrade: `auth_events` table.)_ |
| S6 | Med | **Rate limiting only on login/register/guest** (10 / 15 min / IP). `/auth/refresh`, `/auth/profile`, `/auth/google` are unthrottled; no account lockout / credential-stuffing defence beyond per-IP. _(Upgrade.)_ |
| S7 | Low | **Missing hardening headers** (`X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control: no-store` on auth JSON). _(Fixed today.)_ |
| S8 | Low | **`_oauth_nonce` cookie not environment-suffixed** — prod/staging Google flows on the shared parent domain could collide. _(Fixed today.)_ |
| S9 | Low | **Refresh rotation race.** `issueTokens` (insert new) then delete old isn't atomic; two concurrent refreshes with the same cookie can both succeed. The SPA client dedups, but the server should too. _(Upgrade: single transaction / rotate-by-id.)_ |
| S10 | Low | **CSRF rests entirely on SameSite=Lax + the subdomain model.** Adequate today (cross-site POSTs don't carry the cookie; *.jkos.net is same-site), but there's no token defence-in-depth if any subdomain is XSS'd. _(Upgrade: evaluate double-submit token for state-changing POSTs.)_ |
| S11 | Low | **Inline `<script>`/`<style>`** in the server-rendered portal block a real `script-src` CSP (only `frame-ancestors` is set). _(Upgrade: nonce or externalise the dashboard JS.)_ |
| S12 | Info | **Guest seed steals the admin bootstrap.** "First registrant becomes admin" counts *all* users, including a seeded `guest`. With `GUEST_PASSWORD` set but no `ADMIN_SEED_*`, the first human is `user` and there's no admin. Prod uses `ADMIN_SEED_*`, so moot — but sharp. _(Upgrade: count only non-guest users, or require an explicit admin seed.)_ |

### Code / structure
- **One 833-line `server.js`** mixing config, DB, migrations, seeds, token logic, HTML rendering, routes, and OAuth — hard to test, review, and extend. _(Fixed today: modular split.)_
- **No tests.** _(Fixed today: `test/smoke.mjs`.)_
- Repeated `isJson` content-type branching and "resolve-user-or-401" boilerplate across routes.
- Ad-hoc migration runner (manual id checks + self-healing `ALTER`s). Works, but fragile. _(Upgrade: small ordered-migration runner.)_
- `avatar_url` (often a long Google URL) is embedded in every JWT, bloating the cookie.

---

## 2. Done today (committed, not deployed)

**Refactor — behaviour-preserving modular split** (`apps/jkauth/`):
```
server.js              entry — build app, listen
src/config.js          env constants, cookie opts, TTLs
src/db.js              database, migrations, seeds, app-registry cache
src/util.js            escHtml, validateRedirectTo, password guard
src/tokens.js          sign/issue/clear/rotate, session resolve + refresh
src/views.js           layout, login/register page, portal dashboard
src/routes/auth.js     /, login, register, logout, guest, me, dashboard
src/routes/profile.js  profile GET/PATCH, apps, require-admin, jwks
src/routes/google.js   Google OAuth
src/app.js             express factory — middleware order + route mounts
test/smoke.mjs         32-assertion regression net (npm test)
```

**Safe hardening** (all covered by the smoke test):
- S1 — reject Google logins with `verified_email === false`.
- S4 — sign access tokens with `kid:"1"` (matches JWKS; sets up rotation).
- S7 — `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` globally; `Cache-Control: no-store` on auth JSON.
- S8 — `_oauth_nonce` gets the env cookie suffix.
- S3 (partial) — reject passwords > 128 chars at register/login.

No token claims, cookie names, routes, or status codes changed — `@jkos/auth-middleware` and every app keep working unchanged.

---

## 3. Upgrade backlog for tomorrow (prioritised)

1. **U1 — argon2id hashing**, pluggable, with on-login rehash-from-bcrypt migration (kills S3 truncation; OWASP-preferred). _Schema: add `hash_algo`._
2. **U2 — refresh-token rotation with reuse detection** (S2/S9): `sessions.family_id`; on reuse of a rotated token, revoke the whole family; rotate inside one transaction.
3. **U3 — key rotation**: multi-key JWKS keyed by `kid`, middleware verifies by header `kid`; env carries current + previous public keys.
4. **U4 — audit log** (S5): `auth_events(user_id, type, ip, ua, at)` for login/fail/refresh/logout/admin; surface recent events in the portal.
5. **U5 — broaden rate limiting + lockout** (S6): throttle `/auth/refresh` & `/auth/google`; per-account failure lockout with backoff.
6. **U6 — email verification** for password signups; consider TOTP 2FA hooks.
7. **U7 — CSP/CSRF hardening** (S10/S11): nonce the inline portal script; evaluate a double-submit CSRF token on POSTs.
8. **U8 — migration runner** cleanup + `auth_events`/`family_id`/`hash_algo` migrations.
9. **U9 — guest/admin bootstrap fix** (S12) + slim JWT (drop `avatar_url`, fetch via `/auth/me`).

Each upgrade item should land with new `smoke.mjs` assertions first.
