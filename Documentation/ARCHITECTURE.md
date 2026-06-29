# jkOS — Architecture

> Self-hosted productivity suite on TrueNAS SCALE. One pnpm + Turbo monorepo.
> Five systems. One screen.

**ORDECK** is the portal — the one screen into your entire digital life. **jkAuth** is
identity and the live app directory. **BeigeBoard** is the data app (tasks, goals, calendars).
**Weave** is the connective tissue that lets ORDECK read and write into BeigeBoard without
either knowing the other's internals. **jkDeploy** is the delivery pipeline.

This document explains how those five systems fit together at the architecture level —
the mental models, data flows, and design decisions. For the integration contract spec see
[WEAVE.md](WEAVE.md). For running and deploying see [OPERATIONS.md](OPERATIONS.md).

---

## Repo layout

```
jkOS/
├── apps/
│   ├── ordeck/          @jkos/ordeck     portal SPA + HUD engine
│   ├── jkauth/          @jkos/jkauth     SSO, app directory, session store
│   └── beigeboard/      @jkos/beigeboard tasks/goals SPA + Node backend
├── packages/
│   ├── auth-middleware/ @jkos/auth-middleware  Node JWT middleware (shared issuer/cookie)
│   ├── auth-client/     @jkos/auth-client      frontend auth + preferences hook
│   ├── weave/           @jkos/weave            suite fabric: manifest, resources, dispatch
│   ├── design/          @jkos/design           token CSS + theme factory + responsive breakpoints
│   ├── ui/              @jkos/ui               widget shell component + useBreakpoint hook
│   └── cards/           @jkos/cards            shared calendar card kit (Week/Calendar views)
├── infra/
│   ├── nginx/           standalone.conf + weave-proxy*.conf (generated) + compose
│   └── scripts/         lib-deploy.sh (shared deploy routine)
├── jkos-deploy/         FastAPI deploy controller
└── pnpm-workspace.yaml  turbo.json  docker-compose.yml  docker-compose.staging.yml
```

Shared packages are **source-only** (no build step). Consumers' Vite/tsc compile them
via `exports` pointing at `src/`. All JS Docker images build from the **repo root context**
so `@jkos/*` is visible — per-app context breaks shared package resolution.

---

## Runtime topology

```
internet
    │ HTTPS :443
    ▼
standalone-nginx  (infra/nginx, owns both Docker networks)
    │
    ├── jkos.net              → ordeck-shell:80        (jkos-internal)
    ├── auth.jkos.net         → jkos-auth:3100         (jkos-internal)
    ├── beigeboard.jkos.net   → bb-app:3001            (jkos-internal)
    └── staging.jkos.net      → path-routed, admin-gated (nginx-staging-proxy)
            /          → staging-ordeck-shell:80
            /auth/     → staging-jkos-auth:3100
            /beigeboard/ → staging-bb-app:3001
            /deploy/   → jkos-deploy:8000
```

**Two Docker networks.** `jkos-internal` connects prod services. `nginx-staging-proxy`
connects the staging mirrors and the deploy controller. nginx sits on both, creating both
networks — it must start first on a cold start.

**Same-origin peer proxy.** Every app server block in `standalone.conf` includes
`weave-proxy.conf`, which adds `/api/<peer>/*` and `/health/<peer>` location blocks for
every peer. A page served from any `*.jkos.net` origin calls `/api/bb/` same-origin —
the `jkos_token` cookie flows naturally and there is no CORS surface. The staging origin
gets `weave-proxy-staging.conf` (admin-gated copies of the same blocks). Both files are
generated from one PEERS table in `infra/nginx/gen-nginx-weave.mjs`; run `--check` in CI.

**LazurOS** (AI gateway, `apps/lazuros`) runs `network_mode: host` for WoL broadcast;
nginx reaches it via `host.docker.internal`. **SylibOS** (study app, `apps/sylibos`) is a
separate development track — not covered here.

---

## jkAuth: identity + directory

jkAuth has two jobs that live in one process: **token issuer** (the auth core) and **app
directory** (the registry that drives discovery across the whole suite). Keeping them
co-located means the `app_registry` table is the single authoritative source for both
"who can this token reach" and "where is that app" — no drift possible.

### The token model

jkAuth mints **RS256 JWTs** — the private key never leaves the process. Every other
backend verifies using the public key via `@jkos/auth-middleware`.

**Access token** (`jkos_token`, 15-minute TTL, `httpOnly` cookie):
- `sub` — user id (string)
- `azp` — which app the session was minted through (provenance; logged in `auth_events`)
- `aud` — multi-valued array computed from `app_registry.allowed_roles` at mint time:
  the set of app ids the user's role may access. Each backend verifies its own id is in
  `aud` once `JKOS_APP_ID` is set — opt-in for safe rollout.
- `scope` — role-derived named scopes (`beigeboard:read`, `beigeboard:write`, …).
  Capability endpoints check `token.scope ⊇ required`.
- `typ` — `'user'` for human sessions, `'service'` for headless client-credentials tokens

**Refresh token** (`jkos_refresh`, 30-day rotating, `httpOnly` cookie):
Rotated on every use. Reuse detection: `rotated_at` is stamped atomically. Re-presenting
a token past the 10-second grace window (`REFRESH_GRACE_MS`) revokes the entire
`session.family_id` — every device on that login is signed out. Within the grace window,
concurrent refreshes (two browser tabs, a retry) succeed benignly.

**Remember me:** both cookie lifetimes track together. When "remember me" is set, the
access cookie gets a 30-day `Max-Age` (not session-only). This keeps the access JWT alive
across browser restarts so a `TOKEN_EXPIRED` triggers a clean silent refresh rather than
a login bounce.

**Cookie naming** is single-sourced in `@jkos/auth-middleware/index.js`
(`ACCESS_COOKIE_BASE = 'jkos_token'`, suffix from `JKOS_COOKIE_SUFFIX`). jkAuth imports
`cookieName` and `resolveIssuer` from that package — the producer and all verifiers share
one definition and can't silently drift.

### Key rotation

jkAuth publishes RSA public keys at `GET /auth/jwks`. An optional `JKOS_AUTH_PUBLIC_KEY_NEXT`
env var can be pre-published alongside the active key so verifiers cache the new key before
jkAuth starts signing with it, enabling zero-downtime rotation without a deploy gap.

### Service tokens

`POST /auth/token` (client-credentials) issues a short-lived `typ:'service'` token — no
human `sub`, carries `azp` and `scope`. Used by headless callers (the deploy controller,
server-side weave peers). The endpoint is disabled when `JKOS_SERVICE_CLIENTS` is unset;
when set, it is rate-limited on the tight credential budget (a pre-shared secret is
presented). Service tokens can read freely but cannot write per-user data on apps
(`NO_USER_CONTEXT`) until an explicit on-behalf-of delegation seam lands.

### jkAuth module structure

```
server.js           entry — build app, listen
src/config.js       env constants, cookie opts, TTLs, rate-limit budgets
src/db.js           SQLite + migrations (001–013) + app_registry cache
src/tokens.js       sign/issue/clear/rotate, session resolve + tryRotate
src/password.js     SHA-256 pre-hash + bcrypt (cap: no 72-byte truncation)
src/email.js        SMTP transport for 2FA email codes
src/twofactor.js    TOTP + email-code generation + recovery-code management
src/util.js         escHtml, validateRedirectTo
src/views.js        SSR HTML — login/register/dashboard
src/app.js          Express factory — middleware stack + route mounts
src/routes/auth.js       user flows: login, register, logout, guest, refresh, token
src/routes/twofactor.js  2FA verify, setup, recovery
src/routes/profile.js    GET/PATCH /auth/profile, /auth/me, /auth/events, /auth/require-admin
src/routes/weave.js      /auth/apps (directory), /auth/jwks (key publish)
src/routes/google.js     OAuth callback
```

### The staging auth gate

Every location under `staging.jkos.net` runs an `auth_request` to `GET /auth/require-admin`
on **production** jkAuth — not staging jkAuth. This means prod must be healthy before
staging's gated routes work, and staging can never grant itself admin access by cycling its
own auth service.

### Two-factor authentication

jkAuth supports TOTP (authenticator app) and email codes, each independently enrollable.
Recovery codes are generated at enrollment, one-time-use, bcrypt-hashed. The verifier
checks `src/twofactor.js` before issuing tokens when 2FA is active on the account.

---

## The shared error vocabulary

Every auth-related HTTP response in the suite carries a machine-readable `code` field in
the JSON body. The vocabulary is defined once in `packages/auth-middleware/codes.js` and
mirrors to `jkos-deploy/jkos_auth.py` (the Python side). `pnpm test:contracts` asserts
the two are key-for-key equal — a renamed code fails the build before it can cause a silent
client/server mismatch like the `numeric-sub` incident.

Key codes and what clients do with them:

| Code | Meaning | authFetch action |
|------|---------|-----------------|
| `TOKEN_EXPIRED` | access token past `exp` | silent refresh-then-retry |
| `UNAUTHENTICATED` | no / invalid token | silent refresh-then-retry |
| `SESSION_EXPIRED` | refresh token expired | redirect to login |
| `SESSION_REVOKED` | refresh reuse detected, family burned | redirect to login |
| `FORBIDDEN` | role or owner check failed | surface to caller |
| `INSUFFICIENT_SCOPE` | token lacks required capability scope | surface to caller |
| `READ_ONLY` | guest attempted a write | surface to caller |
| `NO_USER_CONTEXT` | service token attempted per-user write | surface to caller |

---

## Theme and preferences

User preferences (theme mode, accent pair, HUD layout, widget settings) are stored as
a JSON blob in `users.preferences` in jkAuth's SQLite. A single `PATCH /auth/profile`
writes it; `GET /auth/profile` reads it. All frontends call these endpoints — there is
no per-app preferences store.

**Theme application:** `applyJkOSTheme({ mode, primary, secondary })` from `@jkos/design`
sets `data-mode` on `<html>` and writes `--accent-raw` / `--accent-2-raw` CSS vars. The
derivation chain in `hub.css` (deepens in paper, uses raw in dark, computes all semantic
aliases) runs purely in CSS from there. Changing a theme in any app takes effect everywhere
on next load.

---

## BeigeBoard: the data app

BeigeBoard is a goal-and-task manager with calendar integration. It is the primary data
app in the suite — most HUD widgets read from or write into it.

### Data model

One SQLite database, one `items` table. Four item kinds:
- **goal** — has `done_means`, `target_date`, `status`; owns milestones and tasks
- **milestone** — ordered checkpoint under a goal
- **task** — next action; supports one level of subtasks; can be pinned or focused
- **event** — synced read-only from Google/Outlook/iCloud; shown on the HUD calendar

Items are hierarchical (`parent_id`) and ordered (`position`). The `ext_ref` column
records cross-app provenance (`<app>:<id>`) for Weave-created items.

Calendar OAuth tokens (Google, Outlook, iCloud) are encrypted at rest with AES-256-GCM
when `CALENDAR_ENC_KEY` is set. Without it, tokens store plaintext (safe no-op, but set
it for real deployments). Calendar sync is pull-only — events are read-only in BeigeBoard.

### The import pipeline

`POST /api/import` accepts a JSON document describing any number of items (goals, tasks,
milestones, events) in nested or flat form, validates the entire document in one pass, then
writes all items in a single transaction. On any validation error, nothing is written.
`?dryRun=1` runs the validation and returns the plan without writing. This is the same
endpoint the Weave `beigeboard.importItems` capability targets — an AI tool that produces
the JSON is a first-class consumer.

### Weave surface

BeigeBoard exposes:
- `GET /api/capabilities` — what ORDECK (and peers) can *do*: `createItem`, `importItems`
- `GET /api/datasets` — what ORDECK can *read*: today's tasks, pinned item, focused item,
  goals in progress, recent events
- Write routes gated on `beigeboard:write` scope via `@jkos/weave/server`'s `weaveWriteGate`

### Shared calendar card kit — `@jkos/cards`

BeigeBoard's Week and Calendar tabs are built on the shared `@jkos/cards` package. The kit
exports `WeekView` and `CalendarView` as fully self-contained, responsive React components.
Each view reads `useBreakpoint()` from `@jkos/ui` and switches internally between an
interactive time/month grid (desktop/tablet) and an agenda layout (mobile). The apps/beigeboard
`views/WeekView.tsx` and `views/CalendarView.tsx` are thin wrappers that inject BeigeBoard's
`DragAdapter` (from `DragProvider`) and colour resolvers (`getAccent` / `sourceOf`). When
imported without a `DragAdapter`, the views run in **read + light** mode (select, toggle,
quick-add — no internal drag), which is how ORDECK will eventually mount them as HUD widgets.

`@jkos/cards` is **source-only** (no build step). It carries its own date/time math in
`datetime.ts`; BeigeBoard's `lib/theme.ts` re-exports these helpers so there is only one
copy. ORDECK already has `@jkos/cards` as a dependency for the widget seam; widget
registration is deferred (see `ToDo.md` §1).

---

## ORDECK: the portal and HUD engine

ORDECK is a static SPA (Vite + React 18) served by nginx. Its main artifact is the
**HUD engine** — a declarative, user-arrangeable widget grid that pulls live data from
every app in the suite.

### The HUD engine (`src/hud/`)

The engine evaluates `WidgetSpec` documents — pure data descriptions of a widget's layout,
data sources, and rendering. Nothing in the engine is BeigeBoard-specific or hardcoded to
a particular app; each spec describes *what to show* and *where to read it from*.

Key concepts:

**WidgetSpec → WidgetNode tree.** A spec describes a tree of nodes: `text`, `value`,
`list`, `clock`, `calendar`, plus write family (`form`, `input`, `select`, `toggle`,
`button`). Each node can bind its value to a data source: `$clock` (local time), a Weave
dataset read (via `useWeaveList`), a capability's output.

**Source binding.** `engine.ts` evaluates bindings at render time. The `$form` source is
injected into scope during a form submission so `{ src: '$form', path: 'title' }` resolves
to the current form field value. The final command body is `{ ...resolvedBindings, ...$formValues }`.

**Invalidation bus.** `@jkos/weave`'s `resource.ts` exports a keyed `invalidate(key)`
bus. When a capability fires (`runCommand`), it calls `invalidate(...cap.invalidates)`.
Any `useWeaveList` or `usePolledResource` subscribed to that key re-fetches. The clock
widget drives its own local interval; everything else subscribes to the bus.

**Layout persistence.** Widget placement (position, size, which widgets are on the shelf
vs placed) is stored in `users.preferences` in jkAuth, not in any ORDECK-side storage.
The layout follows the user across devices.

**ErrorBoundary per card.** Each widget card has its own `ErrorBoundary`. A failed widget
resets on spec edit (`resetKey` prop) and doesn't take down the grid.

### The Widget Workshop

An admin-only panel at `/widgets` where an operator composes `WidgetSpec` documents
interactively with a live preview. Publishing writes the spec to jkAuth preferences,
making it available on every user's HUD shelf — no redeploy, no build step. The Workshop
produces the same pure-data spec shape that an AI step will eventually generate.

### App launcher

The top strip fetches `GET /auth/apps` (the jkAuth registry) to populate the app switcher.
New apps appear automatically when a row is added to `app_registry` — zero portal code changes.

---

## Weave: the integration fabric

Weave is the contract and shared code by which every jkOS app becomes reachable (launch,
deeplink), readable (data slices on the HUD), and actionable (write commands from the HUD).

The full contract spec, transport model, security model, and onboarding steps live in
[WEAVE.md](WEAVE.md). The key mental models:

**Discovery over hardcoding.** Apps register in jkAuth's `app_registry`. ORDECK reads the
registry; it does not embed per-app knowledge. Adding an app = one DB row.

**Symmetric fabric.** ORDECK is one client among equals. Any app can read from or write to
any peer via `weaveClient(app).list/command`. The portal has no special channel.

**Each app owns its data.** Weave never introduces a central data store. ORDECK reads and
writes through each app's own API; the app is always the single source of truth.

**The edge proxy is the trust boundary.** Cross-app browser calls go same-origin through
nginx's peer-proxy include. The `jkos_token` cookie flows; there is no CORS surface to
misconfigure. Each backend still enforces its own JWT.

### Shared contract enforcement

`packages/weave/src/shared/docShape.js` exports `checkDocShape` — the single validator for
the CapabilityDoc and DatasetDoc envelope (`{ app, version, <list>[] }` where every entry
has a string `id`). Backends validate at boot (throw); the frontend validates on read
(evicts malformed docs instead of silently using them). Same validator, both sides.

`pnpm test:contracts` is the suite-wide gate:
- 29 auth contract assertions (codes vocab, issuer/cookie single-source)
- 24 Weave contract assertions (docShape, capability/dataset schema)
- Token shape verification
- nginx config check (`gen-nginx-weave.mjs --check`)

---

## jkDeploy: the delivery pipeline

jkDeploy is a FastAPI server that turns a single-button web UI at `staging.jkos.net/deploy/`
into a safe, auditable deploy pipeline. It lives in `jkos-deploy/` and runs as an isolated
Compose project — it cannot redeploy itself.

### Auth

`jkos_auth.py` is a Python port of `@jkos/auth-middleware` — same issuer, same cookie name
(sourced from `codes.js`), same JWKS fetch and RS256 verify logic. The deploy controller
uses it to verify the operator's jkOS session before allowing any deploy action. Because it
shares the canonical codes vocabulary, a changed error code fails `pnpm test:contracts`
before it could cause a silent mismatch in the Python verifier.

### Two actions, one shared routine

**Deploy Staging** — pulls `origin/staging` into the staging checkout, rebuilds, verifies.

**Promote to Production** — runs the same pipeline against the prod checkout, resetting to
`origin/PROD_BRANCH` (default `staging`, so the exact commit just tested on staging ships).
There is no separate merge step; the server has no push credentials.

Both call into `infra/scripts/lib-deploy.sh`:
1. **Copy-and-reexec** — copies the script to a temp dir and re-executes from there so a
   `git reset --hard` mid-flight can't corrupt the running shell.
2. **Fetch + reset** — `git -c 'safe.directory=*' fetch origin && reset --hard origin/<branch>`.
3. **`docker compose up --build -d`** — rebuilds changed images, starts all services.
4. **Container health verify** — waits 5s, then inspects every container; fails the deploy
   if any is not `running` (green = actually up, not just started).
5. **nginx step (staging only)** — validates the new config in a throwaway container, then
   `docker restart standalone-nginx`. Prod deploys skip nginx (`MANAGE_NGINX=0`) — the
   standalone-nginx bind-mounts its config from the staging checkout, so a prod deploy
   must not restart it with potentially unvalidated config.

---

## Prod / staging isolation

The suite deploys twice from one codebase. **Code defaults are prod values** — a service
started with no env overrides is a prod service. Staging overrides live exclusively in
`docker-compose.staging.yml`; a merge into prod is safe by construction.

Three invariants that must all hold together:

| | Production | Staging |
|--|------------|---------|
| **Cookie name** | `jkos_token` | `jkos_token_staging` |
| **Issuer** | `jkos-auth` | `jkos-auth-staging` |
| **Auth gate domain** | `auth.jkos.net` | prod `auth.jkos.net` (staging gates against prod) |

If prod starts behaving like staging (or vice versa), one of these three has leaked across
the boundary — it will be a one-line, reviewable env var diff, never a silent code change.

---

## Shared packages (`@jkos/*`)

| Package | Consumers | Provides |
|---------|-----------|----------|
| `@jkos/auth-middleware` | jkauth, beigeboard/backend, jkos-deploy (via py port) | `jkosAuth` Express middleware, `verifyToken`, `requireScope`; `resolveIssuer`/`cookieName` (single-source); `CODES` vocab; dual CJS+ESM |
| `@jkos/auth-client` | ordeck, beigeboard | `useJkOSPreferences` hook, `getProfile`/`patchProfile`/`getMe`, `normaliseTheme`, `authFetch` (refresh-aware) |
| `@jkos/weave` | ordeck, beigeboard | `useWeaveList`, `runCommand`, `usePolledResource`/`invalidate`, `useSuiteApps`, `weaveClient`, capability/dataset types |
| `@jkos/weave/server` | jkauth/backend, beigeboard/backend | `weaveCors`, `weaveAuth`, `weaveWriteGate`, `healthHandler`, `serveCapabilities`, `serveDatasets`, `buildItemFilters`, `weaveServerClient`; dual CJS+ESM |
| `@jkos/design` | ordeck, beigeboard, jkauth (via hub.css mirror) | `buildJkOSTheme` (per-app accent/neutrals/radius/fonts/responsive), `applyJkOSMode`, `applyJkOSTheme`; `hub.css` token sheet (incl. responsive card-scale tokens + `@media` overrides); `STORAGE_KEYS`; `packages/design/responsive/breakpoints.ts` (canonical 3-tier breakpoints, pinned by `pnpm check:responsive`) |
| `@jkos/ui` | ordeck, beigeboard, @jkos/cards | `WidgetShell`, `SettingsDrawer`/`SettingsSection`; `Lab`/`TButton`/`Press`/`Well`/`Sheet`/`Bubble`/`Pill` primitives (auto-consume responsive scale tokens); `useBreakpoint()` hook (mobile/tablet/desktop, backed by canonical breakpoints) |
| `@jkos/cards` | beigeboard, ordeck (seam) | Shared calendar card kit: `cardSurface()` factory, `TaskChip`/`TimeBlock`/`AllDayBar`/`TimelinePreview`/`CardFrame`, responsive `WeekView`+`CalendarView` (grid on desktop/tablet, agenda on mobile); pure date/time/grid math in `datetime.ts`; `DragAdapter` interface decouples drag from the kit |

**Invariant — never duplicate shared logic.** Import `@jkos/auth-client` (frontend) or
`@jkos/auth-middleware`/`@jkos/weave/server` (backend). Per-app copies are regressions.
