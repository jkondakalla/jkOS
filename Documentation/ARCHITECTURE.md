# jkOS — Architecture

> Self-hosted productivity suite on TrueNAS SCALE. One pnpm + Turbo **monorepo**.
> A **hub platform** (ORDECK, jkAuth, BeigeBoard, LazurOS) hosts **pluggable apps**
> (SylibOS, …). All frontends share `@jkos/*` packages; all share one SSO (jkAuth)
> and one reverse proxy (nginx). Front door: **ORDECK** at `jkos.net`.

## Repo layout

```
jkos/                      single git repo (was a polyrepo; consolidated)
├── apps/
│   ├── ordeck/            @jkos/ordeck     portal SPA (Vite + module federation)
│   ├── jkauth/            @jkos/jkauth     SSO service (Express, RS256)        [hub]
│   ├── beigeboard/        @jkos/beigeboard SPA + Node backend (calendar/tasks) [hub]
│   ├── lazuros/           Python service   AI gateway (Ollama proxy + WoL)     [hub]
│   └── sylibos/           @jkos/sylibos    SPA + Node backend (OCW scheduler)  [app]
├── packages/             shared libraries — the contract every consumer references
│   ├── design/           @jkos/design          hub.css tokens + theme appliers
│   ├── auth-client/      @jkos/auth-client      FE auth/preferences contract + hook
│   ├── auth-middleware/  @jkos/auth-middleware  Node JWT verify middleware (CJS+ESM)
│   ├── types/            @jkos/types            ORDECK widget/shared TS types
│   └── ui/               @jkos/ui               ORDECK widget shell + token css
├── plugins/              ORDECK federation microfrontends (not in prod deploy)
├── services/             extra Python services (plex-api, recipe-api)
├── infra/                nginx (reverse proxy) + plugin-docker
├── jkos-deploy/          deploy controller (FastAPI) behind staging.jkos.net/deploy
├── Documentation/        ← you are here
├── pnpm-workspace.yaml  turbo.json  tsconfig.base.json
└── docker-compose.yml   docker-compose.staging.yml   (root `include:` per service)
```

Workspace globs: `apps/*`, `apps/*/backend`, `packages/*`, `plugins/*`. Python units
(`apps/lazuros`, `services/*`) have no `package.json` and are skipped by pnpm.

## Shared package map (`@jkos/*`)

| Package | Consumed by | Provides |
|---------|-------------|----------|
| `@jkos/design` | ordeck, beigeboard, sylibos, `@jkos/ui`, `@jkos/auth-client` | `applyJkOSMode`, `applyJkOSTheme`; `@jkos/design/tokens.css` (hub.css) |
| `@jkos/auth-client` | ordeck, beigeboard, sylibos | types, defaults, `normaliseTheme`, `applyTheme`, profile client (`getProfile`/`patchProfile`/`getMe`/…), `useJkOSPreferences` hook |
| `@jkos/auth-middleware` | beigeboard/backend, sylibos/backend | `jkosAuth({publicKey,issuer})` Express middleware, `verifyToken` |
| `@jkos/ui` | ordeck | `WidgetShell`, `@jkos/ui/tokens.css` (re-imports design tokens) |
| `@jkos/types` | ordeck, plugins | widget manifest/instance TS types |

**Invariant — do not duplicate shared logic.** If auth/theme/preferences logic is
needed, import it from `@jkos/auth-client` (frontend) or `@jkos/auth-middleware`
(backend). The old per-app copies were deleted; re-adding them is a regression.

## Auth flow (SSO)

- **jkAuth** (`apps/jkauth/server.js`) mints **RS256 JWTs**: `jkos_token` (15 min)
  and `jkos_refresh` (30 d), both `httpOnly` cookies scoped to `COOKIE_DOMAIN`
  (`.jkos.net` prod / `staging.jkos.net` staging). Issuer = `JKOS_AUTH_ISSUER`
  (`jkos-auth` prod, `jkos-auth-staging` staging).
- Backends verify the token with **`@jkos/auth-middleware`** using the RSA **public
  key** (`JKOS_AUTH_PUBLIC_KEY`) + matching issuer. Private key never leaves jkAuth.
- Frontends never see tokens; they call jkAuth endpoints with `credentials:'include'`
  via `@jkos/auth-client`. Post-login redirect → `PORTAL_URL` (ORDECK).
- nginx staging gate uses `auth_request` → `GET /auth/require-admin` (admin-only).

## Theme flow (controlled from auth, applied suite-wide)

1. User changes theme/effects in any app's settings panel.
2. App calls `patchProfile({ theme | effects | lazuros })` → `PATCH /auth/profile`
   (jkAuth stores it in `users.preferences` JSON).
3. On load every frontend calls `getProfile()` (`@jkos/auth-client`) and applies it
   via `applyTheme()` (`@jkos/design`): sets `data-mode="paper"|"dark"` on `<html>`
   + `--accent`/`--hub-*` CSS vars. **Identical across all three frontends.**
- Theme is stored **flat** `{ mode, primary, secondary }`; `normaliseTheme()` migrates
  the legacy nested `{ dark, light }` shape on read.
- ORDECK extends application with CRT overlay vars + an `ordeck-mode` event via the
  hook's `onApply` option — it does **not** fork the hook.

## Build system

- **pnpm** workspace (single `pnpm-lock.yaml`) + **Turbo** (`turbo run build|lint|typecheck`).
- Shared `@jkos/*` packages are **source-only** (no build step); consumers' Vite/tsc
  compile them via package `exports` pointing at `src`.
- Native modules (`bcrypt`, `better-sqlite3`, `esbuild`) are allow-listed in root
  `package.json` → `pnpm.onlyBuiltDependencies` (pnpm 10 blocks build scripts by default).

## Runtime topology

```
internet → standalone-nginx (infra/nginx) :80/:443
  ├── jkos.net            → ordeck-shell:80
  ├── auth.jkos.net       → jkos-auth:3100
  ├── beigeboard.jkos.net → bb-app:3001
  ├── sylibos.jkos.net    → sylibos-frontend:80  +  /api → sylibos-api:8004
  └── staging.jkos.net    → path-routed, admin-gated (see OPERATIONS.md)
networks: jkos-internal (prod) · nginx-staging-proxy (staging + jkos-deploy)
          both created by infra/nginx/docker-compose.yml
```

See **SERVICES.md** for per-service detail, **OPERATIONS.md** for build/deploy/staging.
