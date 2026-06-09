# jkOS — Service Reference

Condensed per-unit reference. Paths are repo-relative. See ARCHITECTURE.md for the
shared-package contract and auth/theme flows.

## Deployable services

| Service | Dir | Package | Container | Port | URL | Role |
|---------|-----|---------|-----------|------|-----|------|
| ORDECK | `apps/ordeck` | `@jkos/ordeck` | `ordeck-shell` | 80 (nginx) | `jkos.net` | hub portal |
| jkAuth | `apps/jkauth` | `@jkos/jkauth` | `jkos-auth` | 3100 | `auth.jkos.net` | hub SSO |
| BeigeBoard | `apps/beigeboard` | `@jkos/beigeboard` (+ `…-backend`) | `bb-app` | 3001 | `beigeboard.jkos.net` | hub app |
| SylibOS | `apps/sylibos` | `@jkos/sylibos` (+ `…-api`) | `sylibos-frontend` / `sylibos-api` | 80 / 8004 | `sylibos.jkos.net` | pluggable app |
| LazurOS | `apps/lazuros` | — (Python) | `lazuros` | 8080 (host net) | internal | hub AI gateway |

### ORDECK — `apps/ordeck`
- Vite SPA (React 18) + `@originjs/vite-plugin-federation`. Served static by nginx.
- Theme/prefs: `src/hooks/useJkOSPreferences.ts` wraps `@jkos/auth-client`'s hook,
  adding CRT scanline var + `ordeck-mode` event via `onApply`.
- AppLauncher fetches `GET /auth/apps`. Widgets in `src/widgets/**`; shell uses `@jkos/ui`.
- Docker: `apps/ordeck/Dockerfile` (root context) → nginx with `apps/ordeck/nginx.conf`.

### jkAuth — `apps/jkauth`
- Express + better-sqlite3 + bcrypt + jsonwebtoken (RS256) + googleapis + express-rate-limit.
- All logic in `server.js`. DB at `DB_PATH` (`/data/jkos-auth.db`), WAL, FK on.
- Migrations run **001_init → 002_user_preferences** (order matters; 002 ALTERs the
  table 001 creates). 002 also self-heals a missing `preferences` column on boot.
- Key routes: `POST /auth/{login,register,logout,refresh,guest}`, `GET /auth/{me,profile,apps,jwks,require-admin,google,google/callback}`, `PATCH /auth/profile`, `GET /health`.
- `require-admin` = nginx `auth_request` target (status-only). `validateRedirectTo`
  allows only `app_registry` origins. No frontend bundle (server-rendered login HTML only).
- Does **not** use `@jkos/auth-middleware` (it is the issuer; verifies inline via `resolveUser`).

### BeigeBoard — `apps/beigeboard`
- Frontend: Vite SPA (React 18). `src/lib/jkauth.ts` re-exports `@jkos/auth-client`;
  `src/lib/theme.ts` holds app-specific helpers (fonts, colors, `halate`, date fmt) — **not** jkOS theme.
- Backend: `backend/server.js` (Express + better-sqlite3 + googleapis). Serves the SPA
  from `STATIC_DIR` (catch-all → `dist/index.html`) and `/api/*`. Auth via
  `@jkos/auth-middleware` (`jkosAuth({publicKey, issuer})`). `req.user.sub` = user id.
- One image (`apps/beigeboard/Dockerfile`): builds SPA, `pnpm deploy` bundles backend.

### SylibOS — `apps/sylibos`
- Frontend: Vite SPA (React 19) + Tailwind v4, Zustand, react-router. Pluggable app.
  - `src/api/auth.ts` re-exports `@jkos/auth-client`; keeps a same-origin `getMe`
    (`/api/auth/me`). `src/lib/theme.ts` keeps SylibOS preset **schemes** + delegates
    jkOS theme to `@jkos/auth-client`'s `applyTheme`.
  - `src/store/authStore.ts` = session init (getMe → refresh → redirect).
- Backend: `backend/index.js` (Express ESM + better-sqlite3 + node-cron). Auth via
  `@jkos/auth-middleware`. Two images (`Dockerfile`, `backend/Dockerfile`), root context.

### LazurOS — `apps/lazuros`
- Python (FastAPI/uvicorn). Ollama proxy + Wake-on-LAN. `network_mode: host` (WoL broadcast).
- `auth.py` verifies jkOS JWTs in Python (separate from `@jkos/auth-middleware`).

## Shared packages — `packages/*`
See ARCHITECTURE.md → "Shared package map". All are `private`, source-only, `@jkos/*`.
`@jkos/auth-middleware` ships dual entry: `index.js` (CJS) + `index.mjs` (ESM).

## Not in prod deploy
- `plugins/*` — ORDECK federation microfrontends (`@jkos/*-plugin`); experimental.
- `services/plex-api`, `services/recipe-api` — Python; not in root compose `include`.
