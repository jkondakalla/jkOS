# jkAuth — Audit, Refactor & Upgrade Plan

_Status: 2026-06-17. Two passes done, both **committed to `staging` but NOT yet
deployed** — jkAuth is live on prod+staging; review then deploy via the normal
Sync Staging flow._
- **Pass 1 — clean refactor + safe hardening** (modular split, S1/S3-partial/S4/S7/S8).
- **Pass 2 — security pass + the remember-me fix** (this session): S2, S5, S6, S9,
  S11, S12 fixed, and the headline bug — *"remember me" not auto-logging-in across
  the suite* — resolved. Regression net now **45 assertions, all green**.

**Remember-me fix (headline).** The access cookie was set with `maxAge: 15min`, so
the browser **deleted it after 15 minutes**. A later request then arrived with *no*
access cookie, which app backends report as `UNAUTHENTICATED` (not `TOKEN_EXPIRED`).
BeigeBoard's `apiFetch` only refreshed on `TOKEN_EXPIRED`, so it never used the
valid 30-day refresh cookie and bounced the user to login; ORDECK refreshed on any
401 so it worked — hence the inconsistency. Fix is two-sided: (1) the access cookie
now shares the refresh cookie's lifetime — persistent (30d) when *remember*, session-
only otherwise — so the browser keeps sending the (expiring) JWT and the server can
answer `TOKEN_EXPIRED` → client refreshes; (2) BeigeBoard's `apiFetch` also refreshes
on `UNAUTHENTICATED`, covering sessions issued before this change. There is no stored
password — the httpOnly 30-day refresh cookie *is* the "saved credential", shared
across `*.jkos.net`.

jkAuth is the suite SSO: an Express service that mints **RS256 JWTs** (15-min
access cookie `jkos_token` + 30-day rotating refresh cookie `jkos_refresh`, both
httpOnly on `.jkos.net`), backed by SQLite (`better-sqlite3`), with password
(bcrypt) + Google OAuth login. Every backend verifies tokens through the shared
`@jkos/auth-middleware`. nginx gates staging via `auth_request → /auth/require-admin`.

**Regression net:** `npm test` in `apps/jkauth/` (= `node test/smoke.mjs`) — spawns
the server with an in-process keypair + temp DB and drives every flow (**45
assertions**, four server instances A–D, incl. remember-me cookie attributes,
refresh reuse detection, CSP nonce, audit log, guest/admin bootstrap). Run it
before and after any change; behaviour must stay green.

---

## 1. What was not up to snuff

### Security
| # | Severity | Finding |
|---|----------|---------|
| S1 | **High** | **Google account-linking trusted email without checking `verified_email`.** The callback linked a Google login to an existing password account purely by matching email — an unverified Google email matching a victim's jkOS email was an account-takeover vector. _(Fixed today: reject `verified_email === false`.)_ |
| S1 | **High** | Google account-linking trusted email without checking `verified_email`. _(**Fixed** pass 1: reject `verified_email === false`.)_ |
| S2 | High | **No refresh-token reuse/theft detection.** _(**Fixed** pass 2: `sessions.family_id` + `rotated_at`; rotation atomically claims the token, a rotated token re-presented past the grace window revokes the whole family — see `tryRotate`.)_ |
| S3 | Med | **bcrypt 72-byte truncation.** Passwords >72 bytes are silently truncated; also a mild slow-hash DoS. _(**Partial**: 128-char max-length guard, pass 1. Proper fix needs argon2id — **U1, needs input** re: native dep.)_ |
| S4 | Med | **No key rotation path.** _(**Partial**: tokens now signed with `kid:"1"` matching JWKS, pass 1. Full multi-key rotation = **U3, needs input**.)_ |
| S5 | Med | **No audit log.** _(**Fixed** pass 2: `auth_events` table + `logEvent` on login/fail/register/logout/guest/google/refresh-reuse; admin-readable via `GET /auth/events`.)_ |
| S6 | Med | **Rate limiting only on login/register/guest.** _(**Fixed** pass 2: added limiters on `/auth/refresh` (120/15m) and `/auth/google[/callback]` (30/15m); all budgets env-overridable. Per-account lockout deliberately deferred — **needs input**, DoS-by-lockout tradeoff.)_ |
| S7 | Low | Missing hardening headers. _(**Fixed** pass 1.)_ |
| S8 | Low | `_oauth_nonce` cookie not environment-suffixed. _(**Fixed** pass 1.)_ |
| S9 | Low | **Refresh rotation race** — two concurrent refreshes could both succeed. _(**Fixed** pass 2: atomic `UPDATE … WHERE rotated_at IS NULL` claim; the loser within a 10s grace gets a benign no-op success, not a logout.)_ |
| S10 | Low | **CSRF rests entirely on SameSite=Lax + the subdomain model.** Adequate today. _(**Deferred — needs input**: a double-submit token requires every SPA client to send it.)_ |
| S11 | Low | **Inline `<script>`/`<style>`** in the portal blocked a real CSP. _(**Fixed** pass 2: per-request nonce; CSP is now `default-src 'self'` + nonce'd script/style, no `unsafe-inline`.)_ |
| S12 | Info | **Guest seed steals the admin bootstrap.** _(**Fixed** pass 2: the "first user is admin" check counts only non-guest rows, in both register and Google paths.)_ |

### Code / structure
- **One 833-line `server.js`** mixing config, DB, migrations, seeds, token logic, HTML rendering, routes, and OAuth — hard to test, review, and extend. _(Fixed today: modular split.)_
- **No tests.** _(Fixed today: `test/smoke.mjs`.)_
- Repeated `isJson` content-type branching and "resolve-user-or-401" boilerplate across routes.
- Ad-hoc migration runner (manual id checks + self-healing `ALTER`s). Works, but fragile. _(Upgrade: small ordered-migration runner.)_
- `avatar_url` (often a long Google URL) is embedded in every JWT, bloating the cookie.

---

## 2. Done — pass 1: clean refactor (committed, not deployed)

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

## 3. Done — pass 2: security + remember-me (committed, not deployed)

**Remember-me / suite-wide auto-login** (see headline note at top):
- `issueTokens`: access cookie lifetime now mirrors the refresh cookie — persistent (30d) when *remember*, session-only otherwise.
- `apps/beigeboard/src/App.tsx` `apiFetch`: also refreshes on `UNAUTHENTICATED`, not just `TOKEN_EXPIRED` (covers pre-fix sessions + any missing-access-cookie case). ORDECK already refreshed on any 401.

**Refresh-token rotation hardening** (S2/S9) — `src/tokens.js` `tryRotate`:
- New columns `sessions.family_id` + `sessions.rotated_at` (migration `004_session_family`).
- Rotation atomically claims the presented token (`UPDATE … WHERE rotated_at IS NULL`). Winner issues the new pair in the same family; a concurrent loser within `REFRESH_GRACE_MS` (10s, env-overridable) gets a benign success; a rotated token re-presented later → **reuse → the whole family is deleted** and cookies cleared (`code: SESSION_REVOKED`).
- `liveSession` now ignores rotated tokens. `logout` revokes the whole family.

**Audit log** (S5) — `auth_events` table (migration `005_auth_events`) + `logEvent(type, userId, req, meta)` (never throws into the request path). Events: `login`, `login_fail`, `register`, `logout`, `guest_login`, `google_login`, `google_register`, `refresh_reuse`. `GET /auth/events` returns the caller's own events; admins get the whole suite.

**Rate limiting** (S6) — limiters added on `/auth/refresh` and `/auth/google[/callback]`; budgets centralised in `config.js` and env-overridable.

**CSP nonce** (S11) — per-request nonce in `app.js`; CSP is now `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'nonce-…'; script-src 'self' 'nonce-…'`. The portal's inline `<style>`/`<script>` carry the nonce; no `unsafe-inline`.

**Admin bootstrap** (S12) — "first user is admin" counts only non-guest rows (register + Google).

**Migration runner** (U8) — replaced the ad-hoc id checks with an ordered `MIGRATIONS` array + idempotent `addColumn` helper; added `004`/`005`.

Contracts unchanged for existing clients. New: `family_id`/`rotated_at` columns, `auth_events` table, `GET /auth/events`, and the refresh `code: SESSION_REVOKED` (clients treat any non-2xx refresh as "re-login", so this is compatible). Regression net: **45 assertions, all green** (`npm test`).

---

## 4. Remaining backlog — needs your input

1. **U1 — argon2id hashing** (finishes S3). The OWASP-preferred fix, with on-login rehash-from-bcrypt. **Decision:** add the native `argon2` dep (build-time impact on ZFS, like the googleapis concern) **or** the no-new-dep alternative (SHA-256 pre-hash → bcrypt, which removes the 72-byte limit) **or** leave the 128-char guard as-is. _Schema: add `hash_algo`._
2. **U3 — key rotation** (finishes S4). Multi-key JWKS keyed by `kid`; `@jkos/auth-middleware` verifies by header `kid`. **Needs:** provisioning a second keypair + a shared-package change deployed to every backend. Signing-side `kid` is already in place.
3. **S10 — CSRF defence-in-depth.** Double-submit token on state-changing POSTs. **Needs:** a coordinated change to every SPA client to echo the token; SameSite=Lax covers it today.
4. **U6 — email verification / TOTP 2FA.** **Needs:** outbound email (SMTP creds / provider).
5. **Per-account lockout** (rest of S6). **Needs:** a policy call — lockout deters credential-stuffing but enables DoS-by-lockout of a known victim. Recommend soft throttle (backoff) over hard lock.
6. **Slim JWT** — drop `avatar_url` from the access token (cookie bloat), fetch via `/auth/me`. Low risk (`/auth/me` already returns it) but a `req.user` shape change; confirm before doing.

Each item should land with new `smoke.mjs` assertions first.
