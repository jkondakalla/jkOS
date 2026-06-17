# jkOS — Architecture

> Self-hosted productivity suite on TrueNAS SCALE. One pnpm + Turbo **monorepo**.
> A **hub platform** (ORDECK, jkAuth, BeigeBoard, LazurOS) hosts **pluggable apps**
> (SylibOS, …). All frontends share `@jkos/*` packages; all share one SSO (jkAuth)
> and one reverse proxy (nginx). Front door: **ORDECK** at `jkos.net`.

## Repo layout

```
jkos/
├── apps/
│   ├── ordeck/            @jkos/ordeck     portal SPA (Vite + module federation)
│   ├── jkauth/            @jkos/jkauth     SSO service (Express, RS256)
│   ├── beigeboard/        @jkos/beigeboard SPA + Node backend (calendar/tasks)
│   ├── lazuros/           Python           AI gateway (Ollama proxy + WoL)
│   └── sylibos/           @jkos/sylibos    SPA + Node backend (OCW)
├── packages/
│   ├── design/            @jkos/design          hub.css tokens + theme appliers
│   ├── auth-client/       @jkos/auth-client      FE auth/preferences contract + hook
│   ├── auth-middleware/   @jkos/auth-middleware  Node JWT verify middleware
│   ├── types/             @jkos/types            ORDECK widget TS types
│   └── ui/                @jkos/ui               ORDECK widget shell + token css
├── plugins/               ORDECK federation microfrontends (experimental, not deployed)
├── services/              Python extras (plex-api, recipe-api — not deployed)
├── infra/                 nginx + plugin-docker
├── jkos-deploy/           deploy controller (FastAPI)
├── Documentation/         ← you are here
└── docker-compose.yml  docker-compose.staging.yml  pnpm-workspace.yaml  turbo.json
```

Workspace globs: `apps/*`, `apps/*/backend`, `packages/*`, `plugins/*`. Python units have no
`package.json` and are skipped by pnpm.

## Shared packages (`@jkos/*`)

| Package | Consumers | Provides |
|---------|-----------|----------|
| `@jkos/design` | ordeck, beigeboard, sylibos, `@jkos/ui`, `@jkos/auth-client` | `applyJkOSMode`, `applyJkOSTheme`, `buildJkOSTheme`; `tokens.css` (hub.css) |
| `@jkos/auth-client` | ordeck, beigeboard, sylibos | types, `normaliseTheme`, `applyTheme`, profile client (`getProfile`/`patchProfile`/`getMe`), `useJkOSPreferences` hook |
| `@jkos/auth-middleware` | beigeboard/backend, sylibos/backend | `jkosAuth({publicKey,issuer})` Express middleware, `verifyToken` |
| `@jkos/ui` | ordeck, beigeboard, sylibos | `WidgetShell`, `SettingsDrawer`/`SettingsSection` (the one suite-wide settings tray) |
| `@jkos/types` | ordeck, plugins | widget manifest/instance TS types |

**Invariant — never duplicate shared logic.** Import `@jkos/auth-client` (frontend) or
`@jkos/auth-middleware` (backend). Per-app copies were deleted; re-adding them is a regression.

## Auth flow (SSO)

jkAuth mints **RS256 JWTs**: `jkos_token` (15-min access) and `jkos_refresh` (30-day rotating),
both `httpOnly` cookies on `COOKIE_DOMAIN` (`.jkos.net` prod / `staging.jkos.net` staging).
Issuer = `JKOS_AUTH_ISSUER`.

- Backends verify via `@jkos/auth-middleware` using the RSA public key + matching issuer. Private key never leaves jkAuth.
- Frontends never see tokens — they use `credentials:'include'` via `@jkos/auth-client`. Post-login redirect → `PORTAL_URL` (ORDECK).
- **Session rotation:** each `/auth/refresh` atomically claims the presented token (`rotated_at`). A token re-presented after rotation → the whole session `family_id` is revoked. Concurrent refreshes within a 10s grace window succeed benignly.
- **Remember me:** access cookie lifetime mirrors the refresh cookie — 30-day persistent when remember, session-only otherwise. Both lifetimes match so the browser keeps the JWT alive and `TOKEN_EXPIRED` → client refreshes cleanly rather than bouncing to login.
- nginx staging gate: `auth_request` → `GET /auth/require-admin` (targets prod auth; admin-only).

## Theme flow

1. User changes theme in any app's settings panel.
2. App calls `patchProfile({ theme | effects })` → `PATCH /auth/profile`; jkAuth stores it in `users.preferences` JSON.
3. On every load, frontends call `getProfile()` and apply via `applyTheme()` (`@jkos/design`): sets `data-mode="paper"|"dark"` on `<html>` + `--accent-raw`/`--accent-2-raw` CSS vars. Identical across all frontends.

Theme stored as flat `{ mode, primary, secondary }`; `normaliseTheme()` migrates the legacy nested shape on read.

## Build system

- **pnpm** workspace (single `pnpm-lock.yaml`) + **Turbo** (`turbo run build|lint|typecheck`).
- Shared packages are **source-only** (no build step); consumers' Vite/tsc compile them via `exports` pointing at `src/`.
- Native modules (`better-sqlite3`, `esbuild`) are allow-listed in root `package.json → pnpm.onlyBuiltDependencies`. jkAuth uses pure-JS **`bcryptjs`** — no compiler toolchain in its image.

## Runtime topology

```
internet → standalone-nginx (infra/nginx) :80/:443
  ├── jkos.net            → ordeck-shell:80
  │     /api/lazuros/*    → host.docker.internal:8080 (prefix stripped, buffering off)
  ├── auth.jkos.net       → jkos-auth:3100
  ├── beigeboard.jkos.net → bb-app:3001
  ├── sylibos.jkos.net    → sylibos-frontend:80  +  /api → sylibos-api:8004
  └── staging.jkos.net    → path-routed, admin-gated
networks: jkos-internal (prod) · nginx-staging-proxy (staging + jkos-deploy)
          both created by infra/nginx/docker-compose.yml
lazuros: network_mode=host (raw LAN for WoL broadcast); nginx reaches it via
         host.docker.internal (extra_hosts: host-gateway)
```

## Environment isolation (prod vs staging)

The suite deploys twice from one codebase. **Code defaults are prod values** — a service started
with no env overrides is a prod service. Staging-only values live exclusively in
`docker-compose.staging.yml`; prod compose files carry no staging values. A merge is safe by
construction.

| Variable | Production | Staging |
|----------|------------|---------|
| `JKOS_COOKIE_SUFFIX` | `` → `jkos_token` | `_staging` → `jkos_token_staging` |
| `JKOS_AUTH_ISSUER` | `jkos-auth` | `jkos-auth-staging` |
| `COOKIE_DOMAIN` | `.jkos.net` | `staging.jkos.net` |
| `JKOS_AUTH_URL` / `VITE_JKOS_AUTH_URL` | `https://auth.jkos.net` | `https://staging.jkos.net` |
| `VITE_BASE` | `/` | `/sylib/`, `/beigeboard/` |
| `PROD_BRANCH` (deploy only) | `main` | `staging` |

All three of {distinct cookie name, distinct issuer, distinct auth gate} must hold together.
If prod behaves like staging, a staging value was written into a prod `docker-compose.yml` —
a one-line, reviewable diff, never a silent code merge.
