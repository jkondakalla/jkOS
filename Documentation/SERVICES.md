# jkOS — Service Reference

Per-unit reference. Paths are repo-relative. See ARCHITECTURE.md for the shared-package
contract, auth/theme flows, and env isolation.

## Deployable services

| Service | Dir | Container | Port | URL |
|---------|-----|-----------|------|-----|
| ORDECK | `apps/ordeck` | `ordeck-shell` | 80 | `jkos.net` |
| jkAuth | `apps/jkauth` | `jkos-auth` | 3100 | `auth.jkos.net` |
| BeigeBoard | `apps/beigeboard` | `bb-app` | 3001 | `beigeboard.jkos.net` |
| SylibOS | `apps/sylibos` | `sylibos-frontend` / `sylibos-api` | 80 / 8004 | `sylibos.jkos.net` |
| LazurOS | `apps/lazuros` | `lazuros` | 8080 (host) | internal |

### ORDECK — `apps/ordeck`

Vite SPA (React 18) + `@originjs/vite-plugin-federation`. Served static by nginx.

- Theme/prefs: `src/hooks/useJkOSPreferences.ts` wraps `@jkos/auth-client`'s hook, adds CRT scanline var + `ordeck-mode` event via `onApply`.
- AppLauncher fetches `GET /auth/apps`. Widgets in `src/widgets/**`; shell uses `@jkos/ui`.
- Docker: `apps/ordeck/Dockerfile` (root context) → nginx with `apps/ordeck/nginx.conf`. Build args `VITE_JKOS_AUTH_URL` / `VITE_PLUGIN_BASE_URL` (prod defaults baked in).
- Staging: built with `VITE_JKOS_AUTH_URL=https://staging.jkos.net` (same-origin auth); serves at the `staging.jkos.net` root. HUD data feeds use the same absolute paths as prod (`/api/lazuros/`, `/api/bb/`, etc.) routed to staging upstreams.

### jkAuth — `apps/jkauth`

Express + better-sqlite3 + **bcryptjs** + jsonwebtoken (RS256) + express-rate-limit.
Google OAuth via native `fetch` (no googleapis SDK).

**Module structure:**
```
server.js              entry — build app, listen
src/config.js          env constants, cookie opts, TTLs, rate-limit budgets
src/db.js              database, migrations (001–005), seeds, app-registry cache
src/util.js            escHtml, validateRedirectTo, password guard
src/tokens.js          sign/issue/clear/rotate, session resolve + refresh (tryRotate)
src/views.js           layout, login/register/dashboard HTML
src/app.js             express factory — middleware order + route mounts
src/routes/auth.js     /, login, register, logout, guest, me, dashboard
src/routes/profile.js  profile GET/PATCH, apps, require-admin, jwks, events
src/routes/google.js   Google OAuth
```

**DB:** SQLite at `DB_PATH` (`/data/jkos-auth.db`), WAL + FK on. Migrations run in order:
001 base schema → 002 `users.preferences` → 003 `sessions.remember_me` → 004 `sessions.family_id`/`rotated_at` → 005 `auth_events`. Self-healing `addColumn` — safe to run on existing DBs.

**Security features (current):**
- Refresh-token reuse detection: rotation atomically claims the token (`rotated_at`). A rotated token re-presented past the 10s grace window (`REFRESH_GRACE_MS`) revokes the whole `family_id`; `logout` does too.
- Audit log: `auth_events` table — login/fail/register/logout/guest/google/refresh-reuse. `GET /auth/events` (user sees own; admin sees all).
- CSP: per-request nonce; `default-src 'self'` + nonce'd script/style, no `unsafe-inline`.
- Google login: rejects `verified_email === false` to prevent account-takeover via unverified Google emails.
- Rate limiting on login, register, guest, refresh, and Google endpoints; budgets in `src/config.js`, all env-overridable.

**Key routes:** `POST /auth/{login,register,logout,refresh,guest}`, `GET /auth/{me,profile,apps,jwks,require-admin,google,google/callback,events}`, `PATCH /auth/profile`, `GET /health`.

**Smoke test:** `npm test` in `apps/jkauth/` — spawns in-process with a temp DB + keypair and exercises every auth flow. Run before and after any change.

Does **not** use `@jkos/auth-middleware` (it is the issuer; verifies inline via `resolveUser`).

### BeigeBoard — `apps/beigeboard`

Goal-planning app. One `items` table, four kinds: `goal` (title + `done_means` + `target_date` + `status`), `milestone` (ordered checkpoint under goal), `task` (next action, one level of subtasks), `event` (synced, read-only). Goal fields were added via migration onto the base items table — change the `CREATE TABLE` and migration together.

- Frontend: Vite SPA (React 18). `src/lib/jkauth.ts` re-exports `@jkos/auth-client`; `src/lib/theme.ts` holds app helpers (fonts, date fmt, `halate`) — not jkOS theme.
- Backend: `backend/server.js` (Express + better-sqlite3 + googleapis). Serves SPA from `STATIC_DIR` + `/api/*`. Auth via `@jkos/auth-middleware`. `req.user.sub` = user id.
- Routes: `GET/POST /api/items`, `PATCH/DELETE /api/items/:id`; Google/Outlook/iCloud calendar sync (`/api/auth/<provider>*`, `/api/calendar/<provider>/sync`); AI `POST /api/ai/{parse-task,breakdown}` (gated by `lazuros.enabled` + `BB_AI_ENABLED`).
- One Docker image (`apps/beigeboard/Dockerfile`): builds SPA + `pnpm deploy` bundles backend.
- Calendar drag uses a 4px click-vs-drag threshold (`providers/DragProvider`) so taps select/create and only real movement reschedules.

### SylibOS — `apps/sylibos`

> Do not edit `apps/sylibos/` without explicit instructions.

Pluggable learning app. Frontend: Vite SPA (React 19) + Tailwind v4. Backend: Express ESM + better-sqlite3 + node-cron. Two Docker images (frontend + api), root context.

- Frontend auth: `src/api/auth.ts` re-exports `@jkos/auth-client`; `src/store/authStore.ts` drives session init (getMe → refresh → redirect).
- Backend auth: `@jkos/auth-middleware`.

**CourseProcessor** (`apps/sylibos/CourseProcessor/`) — Python OCW ingest pipeline. Entry: `library_cli.py` (inspect/build/load/build-dir/batch). Ingest ladder: structured parse → heuristic HTML walk → AI rung (only with `--ai`). `build-dir`/`batch` output per-course concept-tree artifacts under `ProcessedCourses/` (course/tree/concepts/exercises/lessons/videos.json). Served read-only by `backend/processed.js` under `/api/processed`. Real test fixtures: `/mnt/Luna/Open Courseware/`; venv: `CourseProcessor/.venv`.

### LazurOS — `apps/lazuros`

Python (FastAPI/uvicorn + httpx). Streams Ollama API through to `COMPUTE_NODE_IP:11434`, NDJSON unbuffered. `network_mode: host` for WoL broadcast; nginx reaches it via `host.docker.internal`.

- Passive endpoints (`/health`, `/models`, `/ps`) report status, never wake the node. `/api/*` auto-wakes a sleeping node (magic packet + `WAKE_TIMEOUT_SECONDS` wait). `POST /wake` = explicit.
- Auth: `LAZUROS_TOKEN` static bearer (server-to-server) **or** jkOS SSO JWT (cookie or bearer), verified via PyJWT RS256.

## Shared packages

See ARCHITECTURE.md → "Shared packages". All are `private`, source-only, `@jkos/*`.
`@jkos/auth-middleware` ships dual entry: `index.js` (CJS) + `index.mjs` (ESM).
