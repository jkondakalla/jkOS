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
│   ├── beigeboard/      @jkos/beigeboard tasks/goals SPA + Node backend
│   └── lazuros/         @jkos/lazuros-backend  AI gateway: job queue + provider/tier composition
├── packages/
│   ├── auth-middleware/ @jkos/auth-middleware  Node JWT middleware (shared issuer/cookie)
│   ├── auth-client/     @jkos/auth-client      frontend auth + preferences hook
│   ├── weave/           @jkos/weave            suite fabric: manifest, resources, dispatch
│   ├── design/          @jkos/design           token CSS + theme factory + responsive breakpoints
│   ├── ui/              @jkos/ui               widget shell, primitives, useBreakpoint + usePointerDrag
│   ├── cards/           @jkos/cards            shared calendar card kit (Day/Week/Month/Year views)
│   ├── suite-manifest/  @jkos/suite-manifest   THE app directory source (registry/nginx/manifest derive)
│   └── suite-prober/    @jkos/suite-prober     conformance instrument (prove + roundtrip)
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

**LazurOS** (AI gateway, `apps/lazuros`) runs `network_mode: host` so it can broadcast
Wake-on-LAN packets to a compute node; nginx reaches it via `host.docker.internal:8080`
(the one host-network peer block). It is now a Weave peer (`/api/lazuros/*`) — see the
LazurOS section below. **SylibOS** (study app, `apps/sylibos`) is a separate development
track — not covered here.

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
(`NO_USER_CONTEXT`) — unless the client is enrolled in `JKOS_DELEGATION_CLIENTS`, in which
case it may mint **on-behalf-of** tokens carrying an `act` claim; `weaveAuth` normalizes
those to the acting user and the write gate lifts `NO_USER_CONTEXT` (the G1 delegation
seam — see [WEAVE.md](WEAVE.md)). Delegation supplies only the *who*; the client still
needs the scope.

### jkAuth module structure

```
server.js           entry — build app, listen
src/config.js       env constants, cookie opts, TTLs, rate-limit budgets
src/db.js           SQLite + migrations (001–016) + app_registry cache
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

### Backend module structure

The backend (CommonJS) mirrors jkAuth's proven `src/` layout:

```
server.js            entry — require app, listen
src/config.js        env constants
src/db.js            SQLite + migrations (runs on require, like jkAuth)
src/crypto.js        AES-256-GCM secret-at-rest + OAuth CSRF state
src/item-fields.js   THE per-column source of truth (pure data, zero deps) —
                     discovery ITEM_SHAPE, the write whitelist, caps, enums all derive
src/schema.js        the validation surface (derived from item-fields)
src/items-store.js   parent cycle-guard, cascade delete, lazy demo seed
src/auth.js          weaveAuth gate + optionalAuth + PUBLIC_PATHS
src/calendar/        provider.js (the CalendarProvider contract + shared writer)
                     + google.js / outlook.js / icloud.js (pure normalize* + fetchWindow)
src/routes/          items.js · import.js · ai.js · calendar.js
src/app.js           express factory
```

`discovery.js` (the served capability/dataset docs) stays at the backend root and is
offline-`require`-able — the prober reads it without booting anything.

### Weave surface

BeigeBoard exposes:
- `GET /api/capabilities` — what ORDECK (and peers) can *do*: `createItem`, `completeItem`,
  `updateItem`, `deleteItem`, `importItems`, plus the AI seams `parseTask`/`breakdownGoal`
- `GET /api/datasets` — what ORDECK can *read*: the `items` dataset with declared filters
  (kind, completed, date windows, `ext_ref_prefix`, `?since` delta cursor)
- Write routes gated on `beigeboard:write` scope via `@jkos/weave/server`'s `weaveWriteGate`

### Shared calendar card kit — `@jkos/cards`

BeigeBoard's Week and Calendar tabs are built on the shared `@jkos/cards` package. The kit
exports `WeekView` and `CalendarView` as fully self-contained, responsive React components.
Each view reads `useBreakpoint()` from `@jkos/ui` and switches internally between an
interactive time/month grid (desktop/tablet) and an agenda layout (mobile). The apps/beigeboard
`views/WeekView.tsx` and `views/CalendarView.tsx` are thin wrappers that inject BeigeBoard's
`DragAdapter` (from `DragProvider`) and colour resolvers (`getAccent` / `sourceOf`). When
imported without a `DragAdapter`, the views run in **read + light** mode (select, toggle,
quick-add — no internal drag), which is how ORDECK mounts the Week view as a HUD widget.

`@jkos/cards` is **source-only** (no build step). It carries its own date/time math in
`datetime.ts`; BeigeBoard's `lib/theme.ts` re-exports these helpers so there is only one
copy. ORDECK mounts exactly one kit view (`bb-week`) — the v5 catalog cull retired the
Day/Month/Year mounts as redundant with the denser built-in cards.

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

**Built-in catalog (v5, `hud/state.ts`).** Ten widgets, culled + redesigned for information
density: Clock, Weather (a real spec — icon/temp/hi-lo row + hourly strip), Today (agenda +
progress head + inline quick-add command form), Calendar (month dot molecule), Week
(`@jkos/cards`), Systems (probes + uptime bar), Alerts, Study, Focus, Pinned. The one-number
cards (progress, uptime) and the standalone add-task cards were folded into their parents;
`HUD_STATE_VERSION` 5 rebuilds older docs from these defaults. Cards must always fill their
allotted grid cell (`.hud-cell > *` stretches; card roots never set `flex: none`).

**Published-widget merge.** On load, the HUD fetches `GET /auth/widgets` (via `authFetch`,
so an expired access token refreshes instead of silently 401ing) and merges the registry
over the user doc with `mergePublished`: a published def always wins under its id — that is
what makes edit → re-publish visible; a placed card still at the old def's default footprint
snaps to a re-published size (a user-resized card keeps its size); and defs that are neither
built-in, published, nor placed are dropped, so unpublished widgets don't linger.

### The Widget Workshop

An admin-only panel at `/widgets` where an operator composes `WidgetSpec` documents
interactively with a live preview. Publishing writes the spec to jkAuth preferences,
making it available on every user's HUD shelf — no redeploy, no build step. The Workshop
produces the same pure-data spec shape that an AI step will eventually generate.

### App launcher

The top strip fetches `GET /auth/apps` (the jkAuth registry) to populate the app switcher.
New apps appear automatically when a row is added to `app_registry` — zero portal code changes.

---

## LazurOS: the AI gateway

LazurOS is the suite's AI gateway — an always-on Node/Express service (the "State node")
that accepts capability calls and open-ended queries, routes them to a tier of compute
backends, and returns **async jobs**. Heavy inference runs on a separate compute node; the
State node only routes, queues, and tracks. This section documents the shipped state; the
remaining go-live plan is [ToDo.md §1](ToDo.md). **Built (Phases 0–6
of 8):** the State node, job queue, compute-backend abstraction, the compute-node worker,
the Tier-0 (STT/TTS/embedding) and Tier-1 (web search) providers, and delegated write-back.
These are code-complete and unit-tested but not yet exercised against live runtimes — they
go live once `prompts.json`, a reachable Ollama/whisper/piper, and Emily's MAC/IP exist.
**Pending (Phases 5/7/8):** real Tier-2 WoL round-trip, the BeigeBoard `/api/ai/*` cutover,
and ORDECK widgets.

### The composability mandate

LazurOS ships to other self-hosters with different hardware, so **no hardware fact lives in
code** — no model tags, GPU names, IPs, MACs, or tier counts. Every swappable piece is a
**provider**: a plain object satisfying a function-shaped contract, built by a
`createXProvider(config)` factory (a closure — no classes, no `extends`), and composed at
startup by reading a mounted `deployment.json`. The provider contracts (`backend/providers/contracts.md`):
`InferenceProvider`, `SttProvider`, `TtsProvider`, `EmbeddingProvider`, `WebSearchProvider`,
and `ComputeBackend` (wraps an inference provider with `probe()`/`wake()` reachability —
`always-on` for a local node, `wol` for a Wake-on-LAN burst node). Each ships ≥1 reference
factory (e.g. STT → an OpenAI-compatible `/v1/audio/transcriptions` server; embeddings → the
edge node's own Ollama; web search → SearXNG or a DDGS sidecar), selected per-slot by config.
Adding a runtime is one factory file + one line in `lib/composeProviders.js`; the
router, queue, and routes never change. Jag's two-node Luna/Emily setup is just one
`deployment.json` (`deployment.jag.json`); a single-node self-hoster uses
`deployment.example.json` unchanged.

### Tier registry (data, not branches)

A deployment's `tiers` array is an ordered escalation ladder; each tier names a
`computeBackend` and the intents it handles. A capability declares `targetTier: 'highest' |
'lowest'` (never a literal number — a doc must not assume how many tiers exist); the route
handler resolves that against the loaded registry at request time. The same handler code runs
a one-tier always-on deployment and a three-tier WoL-burst deployment.

### Job queue + ComputeBackend

Capability calls are async. `POST /api/lazuros/<cap>` creates a job and returns
`202 { job_id }`; the handler resolves the tier, then `probe()`s its backend — if offline, the
job is marked `PENDING_WAKEUP` and the backend is best-effort `wake()`d (a WoL magic packet for
a `wol` backend; a no-op for `always-on`). One SQLite `jobs` table (WAL) tracks the lifecycle
`PENDING → PENDING_WAKEUP → IN_PROGRESS → DONE | FAILED`. The compute-node **worker**
(`apps/lazuros/worker/worker.py` — stdlib-only, so a node needs nothing but `python3`) drains
the queue over a bearer-gated `/internal` API: poll `PENDING`, atomically claim
(`PENDING → IN_PROGRESS`, so two workers can't both run a job), run inference via the
node-local runtime, post the result. It hardcodes no model tag or prompt string — both load
from node-local `models.json` / `prompts.json` (its own slice of deployment config). Every
mutation bumps `updated_at` — the poll-resource invalidation signal the `jobs` dataset's
`since` cursor reads (Weave has no imperative `invalidate()`).

### Delegated write-back (G1)

When the worker reports a DONE result for a write-capable capability (`parse-task`,
`breakdown-goal`), the **State node** — not the worker — commits it into the target app AS the
acting user, via `weaveServerClient`'s on-behalf-of path (`lib/writeback.js`). Keeping this on
the State node means the delegation secret never leaves it for a compute node. It requires the
`lazuros` service client to be enrolled in jkAuth's `JKOS_DELEGATION_CLIENTS` and to hold
`beigeboard:write` (delegation supplies only the *who*, never the scope). `parse-document` is
review-first — its result is stored for human review, never auto-written — and write-back is
best-effort: a failure is recorded on the job but never voids the result.

### Weave surface

LazurOS weaves in like any app: a row in jkAuth `app_registry` (`ai: 1`, roles `admin,user`,
origin `''` — an internal gateway with no launcher tile), `GET /api/lazuros/capabilities`
(`parse-task`, `breakdown-goal`, `parse-document`, `widget-generate`, `query`) and
`GET /api/lazuros/datasets` (`jobs`). Capability writes are gated on `lazuros:write` via
`weaveWriteGate`; a job's owner is the authenticated token `sub` (never a request-body field).
Health is the bespoke host-network path `/api/lazuros/health` (the host-network nginx block
doesn't proxy `/health/<id>`). The registry row, manifest entry, and nginx peer all derive from
the single source `@jkos/suite-manifest` (jkAuth migration `015` backfills the live DB).

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

`pnpm test:contracts` is the suite-wide gate. It chains the auth contracts + python
bridge, the jkAuth/BeigeBoard/LazurOS behavioural smokes, the weave + lego-brick tests,
the write round-trip, the six static conformance checks (tokens/nginx/responsive/drag/
cards/hud), and the suite prober. Full anatomy: [TESTING.md](TESTING.md).

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
