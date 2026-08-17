# jkOS — Architecture

> Self-hosted productivity suite on TrueNAS SCALE. One pnpm + Turbo monorepo.
> Five core systems, plus apps that ride the same fabric. One screen.

**ORDECK** is the portal — the one screen into your entire digital life. **jkAuth** is
identity and the live app directory. **BeigeBoard** is the primary data app (tasks, goals,
calendars). **Weave** is the connective tissue that lets ORDECK read and write into any app
without either knowing the other's internals. **jkDeploy** is the delivery pipeline. On top of
that backbone, **LazurOS** (the AI gateway) and **PapyrOS** (the audiobook library) are full
Weave peers — each documented in its own section below. (**SylibOS**, the study app, is a
separate development track and is not covered here.)

This document explains how those systems fit together at the architecture level —
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
│   ├── lazuros/         @jkos/lazuros-backend  AI gateway: job queue + provider/tier composition
│   ├── papyros/         @jkos/papyros    audiobook SPA + Node backend (scanner/stream/offline)
│   └── sylibos/         @jkos/sylibos    study app — separate track, off the suite contract
├── packages/
│   ├── auth-middleware/ @jkos/auth-middleware  Node JWT middleware (shared issuer/cookie)
│   ├── auth-client/     @jkos/auth-client      frontend auth + preferences hook
│   ├── weave/           @jkos/weave            suite fabric: manifest, resources, dispatch
│   ├── design/          @jkos/design           token CSS + theme factory + responsive breakpoints
│   ├── ui/              @jkos/ui               widget shell, primitives, useBreakpoint + usePointerDrag
│   ├── cards/           @jkos/cards            shared calendar card kit (Day/Week/Month/Year views)
│   ├── player/          @jkos/player           media primitive: timeline/queue core + MediaBackend + headless engine
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
            /papyros/  → staging-papyros-app:3010   (generated apps-generated-staging.conf)
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

One SQLite database, one `items` table. Five item kinds:
- **goal** — has `done_means`, `target_date`, `status`; owns milestones and tasks
- **milestone** — ordered checkpoint under a goal
- **task** — next action; supports one level of subtasks; can be pinned or focused
- **event** — synced read-only from Google/Outlook/iCloud; shown on the HUD calendar
- **routine** — a commitment to a rhythm, with no finish line. See below.

Items are hierarchical (`parent_id`) and ordered (`position`). The `ext_ref` column
records cross-app provenance (`<app>:<id>`) for Weave-created items.

### Routines — the cadence engine and the routine document

> **Full reference: [ROUTINES.md](ROUTINES.md).** This section is the summary; that
> file is where the vocabulary, the four rules, the endpoints and the known traps
> live. Read it before touching anything routine-shaped.

A routine is the one kind that is never scheduled, never completed, and never rolls up.
It is split across two columns groups that answer two different questions, and the split
is the whole design:

| | column(s) | on | holds |
|---|---|---|---|
| **when** | `cadence_days`, `cadence_count` | the routine | the weekly pattern — day offsets from Monday, plus a target count whose surplus *floats* to the week bench |
| **what** | `spec` | the routine | the **document**: ordered steps, progression *rules*, phases, variant ladders |
| | `prescription`, `cycle_index` | an occurrence | that document **rendered** at this session's cycle, as concrete numbers |
| | `performed` | an occurrence | what the user actually did — the only field the engine reads back |

**Occurrences are ordinary `kind:'task'` rows** minted under the routine
(`ext_ref = 'routine:<id>:<date>'`, unique-indexed). That is the load-bearing decision:
every downstream surface — Today, Week, Calendar, the ORDECK widgets, the weave `items`
dataset, any peer — reads a session as a plain task with zero routine awareness. The
alternative (projecting synthetic items at read time) would have cost a projector in
every consumer and every write path.

**The routine holds rules; the occurrence holds a snapshot.** A step says
*"+10 lb once you top 8 reps"*, not *"135 lb"*. At mint the engine evaluates every rule at
that occurrence's **cycle index** and writes the resulting numbers into `prescription`.
Rendering forward means "make week 6 harder" is one edit to one rule instead of a rewrite
of thirty rows; snapshotting means last Tuesday keeps saying 95 lb after the rule has moved
on, so the log of what you did is measured against the plan you were actually given.

**A cycle is a session you DID, not a week that elapsed** (`advance_on: 'completion'`, the
default). A past occurrence that was never ticked drops out of the ladder and the ones after
it keep their rung — being ill for a week must not march the load past what you can lift.
`advance_on: 'calendar'` opts into the other reading for routines where the date genuinely
drives (a taper, a medication ramp, a syllabus).

**Three rules govern rewriting** (all in `src/routines.js`, which argues each one at length):
1. never mint into the past;
2. a pattern change withdraws only the *untouched future* — completing an occurrence or
   moving it off its minted date hands it to the user permanently;
3. the future is a projection and is re-rendered on every reconcile; today is frozen (the
   day is in progress and may be on screen); the past is a record.

**The library** (`library` table, own `beigeboard.library` resource key) is the vocabulary
of reusable sub-tasks a step is built from — exercises, recipes, drills, chores,
discriminated by `collection`. A step writes `{ ref: 'back-squat' }` and inherits the unit,
rest interval, difficulty ladder and a sane default progression; anything the step states
itself always wins. It is a separate table, not a sixth item kind, precisely because a
library entry has no date, no parent and no completion, and must never appear in a tree
walk or a calendar query.

**Difficulty moves on two axes.** Numbers (six closed progression types: `fixed`, `linear`,
`double`, `ladder`, `percent`, `autoregulated`) and **variants** — an ordered ladder of
harder movements (`Knee Push-Up → Push-Up → Decline → Archer`), which is the only way
bodyweight work can progress. The variant ladder has its own clock (`variant_every`) so a
step can climb reps every session and movements every six weeks without needing two rules.

**The format is shaped for a mediocre author**, human or AI: one flat document with no
foreign keys, every field optional with a defensible default, closed vocabularies instead
of expressions, slugs instead of ids, and validation split into hard **errors**
(machine-readable `{path, code, message, expected}`, rejected 400) and a **lint** tier
(accepted, warned — *"no step in this routine ever gets harder"*, which is how an
AI-authored routine actually fails). `GET /api/routines/vocabulary` serves every legal
value plus a worked example, derived from the same constants the validator enforces.

The spec lives in `src/routine-spec.js` — zero-dep, pure, no I/O, no `Date` — and is
mirrored for the browser at `src/lib/routine-spec.ts` (the forge previews an unsaved spec,
so it cannot ask the server). The mirror is not trusted: `pnpm check:routine` drives both
implementations through the same matrix of documents × cycles and fails on the first
disagreement.

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
src/routine-spec.js  THE routine document — vocabularies, normalise, validate,
                     render. Zero deps, pure, no I/O, no Date (so the prober can
                     require it and the conformance gate can drive it exhaustively)
src/routines.js      the cadence engine — the mint, the three rewrite rules, the
                     cycle ladder, and the render-at-mint
src/library.js       the reusable sub-tasks a step is built from + the starter set
src/auth.js          weaveAuth gate + optionalAuth + PUBLIC_PATHS
src/calendar/        provider.js (the CalendarProvider contract + shared writer)
                     + google.js / outlook.js / icloud.js (pure normalize* + fetchWindow)
src/routes/          items.js · routines.js · import.js · calendar.js
src/app.js           express factory
```

`discovery.js` (the served capability/dataset docs) stays at the backend root and is
offline-`require`-able — the prober reads it without booting anything.

### Weave surface

BeigeBoard exposes:
- `GET /api/capabilities` — what ORDECK (and peers) can *do*: `createItem`, `completeItem`,
  `updateItem`, `deleteItem`, `importItems`, `importRoutine`, `importLibrary`
- `GET /api/datasets` — what ORDECK can *read*: the `items` dataset with declared filters
  (kind, completed, date windows, `ext_ref_prefix`, `?since` delta cursor), plus `routines`
  (each routine with its spec normalised and library refs resolved) and `library`
- Write routes gated on `beigeboard:write` scope via `@jkos/weave/server`'s `weaveWriteGate`

The routine surface additionally serves `GET /api/routines/vocabulary` (every legal value +
a worked example — read it before authoring), `GET /api/routines/:id/preview?cycles=N` (the
next N sessions as concrete numbers, written nowhere), and `POST /api/routines/import`
(one document → one routine, idempotent by slug, `?dryRun=1` to validate and render only).

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
remaining go-live plan is [ToDo.md §1](ToDo.md). Bring-up runbook:
[LAZUROS_STARTUP.md](LAZUROS_STARTUP.md). **Built (Phases 0–6 **and 8**):** the State node,
job queue, compute-backend abstraction, the compute-node worker, the Tier-0 (STT/TTS/embedding)
and Tier-1 (web search) providers, delegated write-back, and the two ORDECK WidgetSpecs
(authored + committed, awaiting a publish click). These are code-complete and unit-tested but
not yet exercised against live runtimes — they go live once `prompts.json`, a reachable
Ollama/whisper/piper, and Emily's MAC/IP exist. **Pending (Phases 5 and 7):** the real Tier-2
WoL round-trip, and BeigeBoard's AI, which must be **built** on LazurOS rather than migrated —
BB's old `/api/ai/*` path was a *synchronous* proxy to an Ollama-shaped `POST /api/chat` that
the rebuilt LazurOS no longer serves, so it was deleted outright (2026-07-13) rather than left
to rot. LazurOS is *asynchronous* (`202 {job_id}` → poll), so BB's replacement has to grow
job-polling UX, and its results land through delegated write-back into the ordinary
`createItem` / `importItems` surface — no second AI surface on BB.

**Gate hardening (2026-07-13, done — [ToDo.md](ToDo.md) "Done so far"):** the Python worker smoke — 19 assertions over the
poll→claim→render→infer→post loop, including the lost-claim race and the unconfigured-cap /
infer-error → `FAILED` paths — now rides the node gate via `backend/test/worker-py.smoke.mjs`,
which spawns `python3` and skips **only** when python3 itself is absent (an import failure
fails the gate: `worker.py` is stdlib-only by mandate, so a failed import is a regression, not
an environment gap). `deployment.example.json` **and** `deployment.jag.json` are pinned to
`validateDeploymentConfig` in `providers.smoke.mjs`. The `jobs` dataset declares **and**
enforces `capability` (eq) + `since` (delta cursor over `updated_at`, exclusive `gt`) via
`@jkos/weave/server`'s `buildItemFilters`/`filterSpec` — declared == enforced from one spec;
`user_id` stays outside the generic spec because it is the owner pin, not a caller filter.
Known inherited wrinkle, deliberately not fixed here: `updated_at` is second-resolution
`datetime('now')` — the same same-second `since`-collision class BeigeBoard's items fixed with
ms-ISO stamps (migration 8), never propagated to the shared `defineCollection` brick, PapyrOS,
or LazurOS. Suite-wide fix, parked.

**There is exactly one AI preference in the suite: `preferences.lazuros.enabled`,** the
kill switch, owned by the jkAuth portal. There is deliberately no per-user gateway URL or
model — the gateway is one fixed edge path (`/api/lazuros`) and each tier picks its model
from the `deployment.json` mounted on the machine that runs it. Apps only *read* `enabled`,
to hide their own AI surfaces.

**The edge preserves the `/api/lazuros` prefix** — the one peer block that does. Every other
app's routes are bare (`/api/items`) and nginx rewrites the prefix away; the State node instead
registers its routes at the full paths its capability doc advertises, so stripping would 404
everything it declares. The prober derives which of the two an app is (do its declared
capability paths carry the prefix?) and fails the pair that disagrees.

**Health reports compute, not just process.** LazurOS is the one app that can be perfectly
healthy while the machine that does the thinking is asleep — that is what a `wol` backend *is*.
So `/api/lazuros/health` carries `compute_online` plus a per-backend map (probed in parallel,
500ms each, cached 5s), and `status:'ok'` with `compute_online:false` is the normal resting
state of the Emily tier, rendered as a warn ("gpu asleep") rather than a fault. The shared
`healthHandler(service, details?)` grew the opt-in seam for this; the uniform keys stay first.

**The test console** (`backend/console/`, served at `/api/lazuros/console`, exposed at
`https://staging.jkos.net/LazurOS` behind the staging admin gate) is LazurOS's only first-party
UI: pick a capability, submit, watch the job walk its states. Its form is *derived* from
`/api/lazuros/capabilities` and it speaks only the public HTTP contract a peer would, so it
proves the real path rather than a console-shaped one.

### The composability mandate

LazurOS ships to other self-hosters with different hardware, so **no hardware fact lives in
code** — no model tags, GPU names, IPs, MACs, or tier counts. Every swappable piece is a
**provider**: a plain object satisfying a function-shaped contract, built by a
`createXProvider(config)` factory (a closure — no classes, no `extends`), and composed at
startup by reading a mounted `deployment.json`. The provider contracts (`backend/providers/contracts.md`):
`InferenceProvider`, `SttProvider`, `TtsProvider`, `EmbeddingProvider`, `WebSearchProvider`,
and `ComputeBackend` (wraps an inference provider with `probe()`/`wake()` reachability —
`always-on` for a local node, `wol` for a Wake-on-LAN burst node). Every network-backed
provider builds its requests through one transport module, `lib/http.js`: `normalizeBaseUrl`
validates a slot's `baseUrl` at factory (boot) time — required, http(s) only, no `endpoint`
alias, no hardcoded localhost fallback — so a malformed `deployment.json` fails at startup
naming the slot, never mid-request; `providerFetch` wraps every outbound call in an
`AbortSignal` timeout and maps failures to three uniform shapes (`"<what> failed: <status>"`,
`"<what> timed out after <ms>ms"`, `"<what> unreachable: <cause>"`). Each ships ≥1 reference
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
the queue over a bearer-gated `/internal` API: poll claimable jobs (`PENDING` or a
woken `PENDING_WAKEUP` — both must drain, or a job sent to a sleeping backend would strand
even after it boots, since nothing else transitions `PENDING_WAKEUP` back to `PENDING`),
atomically claim (→ `IN_PROGRESS`, so two workers can't both run a job), run inference via the
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

## PapyrOS: the audiobook app

PapyrOS is a fully-native multi-user audiobook library — its own filesystem scanner,
catalog, and Range-streamed playback backend, gated by jkAuth like every other suite app.
It is not a client of Audiobookshelf or any other media server; the only external call it
makes is the iTunes Search API, used solely to enrich metadata (an Open Library + Audible/
Audnexus multi-source expansion is approved and specced in ToDo §2 6.5e, not yet built).
Waves 1–5 (scaffold, scanner/catalog, playback backend, metadata connector, frontend
SPA+PWA), the 6.x live-hardening batch, and Waves 7.1/7.3 (offline cache + offline
serving) are code-complete and deployed live to staging; 7.2 (offline write queue) and
Wave 8 (book club + ORDECK widget) remain.

### Data model

One SQLite database, split on a scope boundary:
- **`books`** — a hand-rolled migration (not a `defineCollection`), because it's
  populated by the library scanner, not user CRUD, and has no `user_id`: every user sees
  the same shared catalog. Columns: `path` (unique, absolute folder), scalar metadata
  (`title`/`subtitle`/`author`/`narrator`/`series`/`series_seq`/`year`/`genres`/`description`),
  `duration`, `files`/`chapters` (JSON-array TEXT columns), `cover_path`, `metadata_source`
  (`embedded` | `itunes` | `manual`), `ext_ref`, `mtime` (scan skip cursor), `updated_at`
  (delta-cursor, `books_touch_updated` trigger). The served list shape (`BOOK_SHAPE` in
  `discovery.js`) deliberately omits `files`/`chapters`/`path`/`description` — those are
  detail-only weight, served by `GET /api/book/:id`. Note: `subtitle` and `series_seq`
  are schema'd, served, and rendered, but currently have **no writer** — neither the
  scanner's upsert nor `matchBook` populates them, so they read as `NULL` today.
- **`progress` / `bookmarks` / `clubs` / `club_members`** — four genuine per-user
  collections, each a one-line `defineCollection` in `discovery.js` (`scoped: true`), so
  table DDL, CRUD routes, and the served capability/dataset docs derive from one spec.
  `progress`/`bookmarks` carry a `book_ref` (typed `ref` stud at `papyros.books`); `clubs`
  has a `current_pick` ref; `club_members` joins a club to a jkAuth `sub`. `clubs`/
  `club_members` being owner-scoped means a member currently only sees rows *they*
  created — a shared roster/"who's caught up" view needs a bespoke membership-gated read,
  deferred to a later wave.
- **`history`** (§3 17.4, 2026-07-15) — append-only per-user play events
  (`item_ref`/`started_at`/`ms_played`/`completed`), a `defineCollection` with
  `only: ['create']` so `updateHistory`/`deleteHistory` capabilities and their routes are
  never emitted (PATCH/DELETE genuinely don't exist, not merely denied). The frontend
  adapter records one row per listening session — opened on the paused→playing edge,
  closed (POSTed) on pause / book switch / page-hidden — where hidden immediately
  reopens when still playing, since audio keeps going under a locked screen. `ms_played`
  is wall-clock. Best-effort telemetry: writes bypass the offline queue by design.

### The scanner (`backend/src/library/`)

Since §3 17.2 (2026-07-15) `scan.js` is a ~90-line **app config over the
`defineLibraryScanner` brick** (`@jkos/weave/libraryScanner`): the generic ladder —
folder walk, concurrency-4 ffprobe pool, mtime-incremental skip, `ON CONFLICT(path)`
upsert, vanished-row prune, single-file-only chapter trust, embedded-art→folder-image
cover ladder — lives in the brick; papyros supplies `AUDIO_EXTENSIONS`, its `mapTags`
(title-fallback / series-guard / `metadata_source` glue), and the column list.
`probe.js` keeps the app-specific `mapTagsToColumns`/`extractYear`/`parseGenres` and
re-exports `probeFile`/`parseProbe` from the brick. `createScanner` kept its exact prior
signature, so everything below still holds. It walks `AUDIOBOOKS_DIR` one level deep —
**one subfolder = one book** — recursing further only to collect audio files
(per-disc rips). Runs
non-blocking at boot (`server.js` fires `scanner.scanLibrary()` after `app.listen()`,
uncaught so a scan failure can't crash the process) and again on-demand via the admin-only
`rescanLibrary` capability; a scan already in flight is joined, not duplicated. Per book: a
bounded worker pool (default 4) runs `probe.js`'s `ffprobe` wrapper over every audio file,
orders tracks by embedded `track` tag then filename (numeric-aware), sums durations, and
extracts a cover (embedded art via `ffmpeg -an -c:v copy`, else a folder-level
`cover.*`). Folder `mtime` is compared against the stored row on every pass — an unchanged
folder is skipped entirely (no reprobe); a folder no longer present is deleted. Chapters are
only trusted from a genuinely single-file book's embedded chapter list — a multi-file book's
chapter model is the player's cumulative-offset math (below), not fabricated at scan time.
Two hygiene rules keep tag junk out of the catalog: an `album` equal to the book's FINAL
title (standalone rips near-always tag it that way) maps to **no** series — guarded both in
the probe tag mapping and again at row assembly against the folder-name title fallback
(migration 7 healed pre-guard rows) — and noise genres ("Audiobook(s)", "(Un)abridged")
are filtered at parse, match-write, AND both serve sites, so pre-filter rows heal without
a rescan. After every scan (boot or admin rescan) the scanner fires an `onScanComplete`
hook; server.js uses it to run the enrichment sweep (`PAPYROS_AUTO_ENRICH=1`) and the
compat pre-generation pass (`PAPYROS_AUTO_COMPAT=1`) — both compose-set, never in tests.

### Streaming (`backend/src/media.js`)

Since §3 17.1 + 17.3 (2026-07-15) `media.js` is ~213 lines of **app config over the
`defineMediaRoutes` brick** (`@jkos/weave/mediaRoutes`, the 4th brick type), which itself
sits on **`@jkos/files`** (`rangeStream` + `containPath` — the Range implementation,
extracted per 17.1). The wire is unchanged: `GET /api/stream/:bookId/:fileIndex` serves
single-range `Range` requests (`bytes=start-end` / `start-` / `-suffix`) as `206` with
`Content-Range`/`Accept-Ranges`, the full file as `200`, unsatisfiable as `416`. Papyros
supplies the two containment-checked resolvers (`resolveFile`/`resolveCover` — paths
re-resolved against `audiobooksDir` on every request, never trusted from the DB row),
the mime maps, and the compat ladder as data; `GET /api/cover/:bookId` and
`GET /api/download/:bookId` (single file direct, multi-file zip via app-injected
`archiver`, store-only) come from the brick. The app-specific `GET /api/book/:id` detail
route stays in media.js, asking the brick's `prepared()` for per-file `compat_ready`.

**The compat pipeline (Firefox).** Firefox's strict `mp4parse` demuxer rejects the moov
box on some otherwise-valid m4b files (`NS_ERROR_DOM_MEDIA_METADATA_ERR`) that ffmpeg
decodes cleanly. media.js therefore serves a two-rung ladder of normalized variants:
`?compat=1` is a lossless `-map 0:a:0 -c copy -movflags +faststart` remux, `?compat=2` an
aac re-encode — cached under `/data/compat/<bookId>-<fileIndex>.c<level>.m4a`,
source-mtime-invalidated, generated via async-spawned ffmpeg (tmp file + atomic rename,
process-wide single-flight keyed `id:file:level`). `POST /api/stream/:id/:idx/prepare
{level}` starts/joins a generation (202 → poll → `{ready:true}`). The ladder's rungs are
papyros-supplied **data** (`{level, strategy, ext, args, satisfies}`); the brick owns the
invariants (freshness = `exists && size>0 && mtime≥source`; generation only on `prepare`,
never the read path; `spawn` never `spawnSync`; atomic rename on exit 0 — each pinned by
`packages/weave/test/mediaRoutes.mjs`'s text-scan gate). `prepareAllCompat` pre-generates
every level-1 variant post-scan, `GET /api/book/:id` reports per-file `compat_ready`, and
the player STARTS ready files on the normalized container; a decode error at play time
auto-escalates the ladder (prepare → poll → reload at the same position) before
surfacing an error.

**The generalization shipped (17.3).** The brick exports `decidePlayback({ladder, source,
client, requestedLevel})` — a pure decision engine with two modes over one ladder:
capability-driven (walk to the lowest rung the client can consume — Jellyfin's
direct-play → direct-stream → transcode form, which a video app inherits as rungs 0–2 of
its HLS/ABR ladder) and explicit (`requestedLevel` resolves `?compat=N`, papyros's wire).

### The iTunes connector (`backend/discovery.js`)

`META` is the suite's first `defineConnector` — a keyless, unauthenticated
(`auth.kind: 'none'`) wrapper around `GET https://itunes.apple.com/search`, mapped to a
typed `metadataSearch` dataset row (id/title/author/cover/description/year/genre). Manual
flow: a listener searches and applies one candidate via `matchBook` (writes
author/description/year/genres + `metadata_source:'itunes'` + `ext_ref`, best-effort
600x600 cover download; a failed artwork fetch doesn't fail the match). `matchAllMissing`
(core: `runEnrichmentSweep`, also fired automatically after every scan when
`PAPYROS_AUTO_ENRICH=1`) sweeps every `embedded`-sourced book missing an author, cover,
**or description** and applies the best candidate — policy relaxed 2026-07-10 from
exact-only to a knockoff-filtered ladder ("Summary of …"-mill listings can never apply):
exact title+author → exact author → exact-or-subtitle-extension title → top remaining
candidate, each applied row tagged `via` with which rung matched. Normalization tolerates
iTunes' fixed formatting conventions ((Un)abridged suffix, space-before-punctuation,
author-separator styles, role annotations) but is never fuzzy. A book lands in `review`
only when search errored or returned nothing usable. Sequential, ~250ms between books,
capped at 50/run.

### Player — a thin adapter over `@jkos/player` (since Wave 15, 2026-07-14)

The player speaks one number, `globalPos`: seconds across the *whole* book with its files
concatenated in `files[].index` order. As of §3 Wave 15 the machinery that implements this
lives in **`@jkos/player`** (see the shared-packages table): the pure timeline math
(`buildTimeline`/`locate`/`toGlobal` — lifted verbatim from papyros's old `position.ts`,
boundary rule intact: a position landing exactly on a file edge belongs to the *later*
file at offset 0), the `MediaBackend` seam wrapping the one stable-identity `<audio>`
element, and the headless engine hook (progress/bookmark write choreography — the
debounced find-or-create upsert itself now lives in `@jkos/weave/resumeCursor`, 16.4 —
sleep timer, volume/mute with optional persistence (16.2), the compat-recovery ladder).
MediaSession is no longer inside the engine: Wave 16.3 lifted it into
`@jkos/player/services`' `useMediaSession` (composed by the adapter, now with the
previously missing `setPositionState` so the lock-screen scrubber tracks the real
position); the same services layer carries the offline write queue (16.5 —
`apps/papyros/src/offline/writes.ts` wraps `api.ts`'s progress/bookmark writes; online
behavior unchanged, offline writes queue in IndexedDB and replay with `?since=`
reconciliation, the race the `progress` UNIQUE index + upsert trigger, 17.5, closes
server-side). What remains in `apps/papyros/src/player/` is
the **adapter**: `usePlayerEngine.ts` builds a `PlayerEngineConfig` from `../api.ts` +
`./controller.ts` (every URL and request-body shape byte-identical to the pre-migration
engine, incl. `?compat=<n>` and POST `<streamUrl>/prepare`), composes `useMediaSession`
and the 17.4 history-session recorder next to the engine, and re-exposes the engine
under PapyrOS's original names (`book`/`chapterLabel`/`prevChapter`/`sleepMode:'chapter'`).
`PlayerBar.tsx` was rebased onto the `@jkos/player/ui` kit at 16.6 (shell + stock
transport controls, markup byte-identical); the audiobook-specific bookmarks menu and
mobile More sheet stay papyros-owned. Chapter nav falls back to
one nav-point per file when the book has no real embedded chapters. The bar's scrubber is
the CURRENT CHAPTER's timeline (elapsed/length), not the whole book; crossing chapters is
the prev/next buttons' job. The engine surfaces playback failures (an `error` state mapped
from the backend's classified error vocabulary — decode failures first auto-recover
through the compat ladder above) and broadcasts its position (~1/s) through
`player/controller.ts`, which BookDetail's chapter-progress fills subscribe to.

### PWA foundation

`public/sw.js` is **online-first** throughout: navigations and static assets are
network-first with a cached fallback, and API requests always reach the network when it's
up. Offline media (Waves 7.1/7.3): the in-app download pipeline (`src/offline/` — Cache
`papyros-media-v1` holding full-200 per-file stream bodies + cover + detail JSON, IDB
`papyros-offline` bookkeeping where a `books` row existing ⇔ fully cached; storage
estimate + eviction UI in the SettingsDrawer, per-book badges via one
`useSyncExternalStore` store) is the ONLY cache writer; the SW's `serveMedia()` serves
stream/cover/book GETs from that cache only when the network fetch itself rejects,
answering offline Range requests as 206 slices of the cached body via lazy `Blob.slice`
(disk-backed — no whole-file memory spike). The 7.2 offline write queue
(progress/bookmarks with `?since=` reconciliation) is not yet built.
`manifest.webmanifest` declares a standalone-display installable app (SVG + 192/512 PNG
icons, theme/background colors).

---

## KourOS: the music app

KourOS (`kouros`, port 3011) is the second consumer of the §3 Wave-17 backend bricks —
scaffolded 2026-07-15 (18.1) and built out onto the bricks the same day (18.2). It follows
PapyrOS's proven split (scanner-written shared catalog + per-user `defineCollection`s +
`defineMediaRoutes`) with zero brick changes, proving the bricks' second-consumer claim for
real rather than just in `packages/weave/test/libraryScanner.mjs`'s hermetic music-vocabulary
suite. The frontend is the real library UI (18.3 — Home/Artists/Artist/Album/Search over the
contract below) plus the `musicPlayer()` queue/transport (18.4); both landed 2026-07-15.
Gapless/crossfade (18.5) and playlists (18.6) landed 2026-07-16 — Wave 18 complete.

### Data model

One SQLite database, split on the same scope boundary as PapyrOS:
- **`tracks`** — a hand-rolled migration (not a `defineCollection`), same reasoning as
  papyros's `books`: populated by the library scanner, not user CRUD, no `user_id` — every
  user sees the same shared catalog. Columns: `path` (unique, absolute FILE path — not a
  folder, see below), `title`/`artist`/`album`/`albumartist`/`track_no`/`disc_no`/`year`/
  `genres`, `duration`, `files`/`chapters` (the brick's own JSON-array TEXT columns —
  `files` always holds exactly one entry, `chapters` always `[]`; a per-track row has
  nothing to aggregate), `cover_path`, `mtime` (scan skip cursor), `updated_at`
  (delta-cursor, `tracks_touch_updated` trigger). `TRACK_SHAPE` (`discovery.js`) excludes
  `path`/`files`/`chapters` from the served list row, same asymmetry as `BOOK_SHAPE`.
  Artist→album→track hierarchy is DERIVED at read time from the `tracks` dataset's filters
  (`?artist=X`, then `?artist=X&album=Y`) — there is no separate `artists`/`albums` table.
- **`playlists`** — one `defineCollection` (`scoped: true`): `name`/`description`/
  `track_refs`. `track_refs` is a `list: true` field (the `tags`-convention JSON-array-TEXT
  shape — `packages/weave/src/server/columns.js`'s `coerceWeaveColumn` stringifies an array
  as-is, `collection.js`'s `toRow()` parses it back), not a join table: reordering (18.6) is
  "PATCH the whole array back", the simplest shape that round-trips.
- **`history`** — append-only per-user play events (`item_ref`/`started_at`/`ms_played`/
  `completed`), a `defineCollection` with `only: ['create']` — the exact same knob papyros's
  17.4 added, so `updateHistory`/`deleteHistory` and their routes never exist.
- **`ratings`** — `track_ref` + `rating`, one `defineCollection` PLUS a hand-added composite
  `UNIQUE(user_id, track_ref)` index and an upsert-on-conflict `BEFORE INSERT` trigger, both
  in the SAME migration as the collection's own `ddl()`. This is the papyros 17.5 lesson
  (`progress`'s missing unique index let a two-tab race create duplicate rows, fixed only
  after live data existed, needing a dedupe-then-`ALTER` migration) applied from day one:
  `ratings` never ships without the constraint, so there's nothing to dedupe. The trigger
  deletes the caller's existing `(user_id, track_ref)` row immediately before a colliding
  INSERT, so a second "rate this track" POST replaces the rating (new autoincrement id,
  same one-row-per-user-per-track outcome) instead of a raw `SQLITE_CONSTRAINT_UNIQUE`
  bubbling up as defineCollection's generic 500.

### The scanner (`backend/src/library/`)

`scan.js` is app config over `defineLibraryScanner` (`@jkos/weave/libraryScanner`, §3 17.2)
using the brick's **second unit shape**, `unit: 'file'` — one row per audio file anywhere
under `MUSIC_DIR` (mp3/m4a/aac/flac/ogg/opus/wav), not one row per folder the way papyros's
`unit: 'dir'` aggregates a multi-file book. `tags.js` holds the pure helpers
(`extractYear`/`parseGenres`, mirroring the pure half of papyros's `probe.js`); `mapTags`
maps a track's own tags (a 'file'-unit ctx always has exactly one file, no multi-file choice
to make) straight onto the `tracks` columns, falling back to the folder-basename-derived
`unitName` for a missing title. One naming note worth recording: ffprobe's GENERIC tag key
for an album-artist field is `album_artist` (with underscore) across every container this
app scans — verified directly (ffmpeg normalizes MP4's `aART` atom, ID3's `TPE2` frame, and
a FLAC/Ogg Vorbis-comment `ALBUMARTIST` field all down to that one key on the way out), even
though the ToDo's own prose names the tag `albumartist` (the Vorbis-comment SPELLING). The
`tracks` table COLUMN is named `albumartist` (no underscore, matching the ToDo's literal
wording); `scan.js`'s `mapTags` is the one place the two names meet, and it falls back to
the plain `artist` tag when a file carries no dedicated album-artist tag at all (the common
case for a standalone single). `track`/`disc` are parsed via the brick's own
`parseTrackNumber` (pulls the leading integer out of an `"N/total"`-style tag).

### Streaming (`backend/src/media.js`)

App config over `defineMediaRoutes` (§3 17.3), **direct-play only** — no `ladder`/`cacheDir`
in the spec (the brick skips mounting `POST .../prepare` entirely when no ladder is
supplied; every extension `scan.js` catalogs plays natively in every evergreen browser, so
there is no known Firefox-m4b-style compat gap to paper over yet). `resolveFile` is simpler
than papyros's: a 'file'-unit `tracks.path` is ALREADY the whole absolute file path (the
scanner's `collectFileUnits` writes `unitPath = the file's own absolute path`), so
containment-checking that path directly against `MUSIC_DIR` is the entire resolution — no
folder-plus-relative-path join. `fileIndex` is always `0` (a track is always exactly one
file), which keeps the wire identical to papyros's `/api/stream/:id/:fileIndex` shape
without ever exercising the brick's multi-file zip-download branch — this app carries no
`archiver` dependency because that branch is never reached. Cover art uses the brick's
DEFAULT `extractCover` (embedded art via `ffmpeg -an -c:v copy`, else a folder-level
`cover.*`) — no custom hook needed.

### The frontend + player (`src/`)

Five hash-routed library views (18.3 — Home with recently-added + recently-played-resolved-
from-`history`, Artists/Artist/Album derived client-side from the one-shot `tracks` fetch,
Search over the prefix filters) on the Wave-20 primitives (`<AppShell>`, `<AsyncView>`,
`<CoverArt>`/`<MediaGrid>`); identity is indigo/amber on factory-default Plex sans (no serif —
a dense grid app, deliberately unlike papyros's bookish Fraunces). Playlists (18.6) ride the
`playlists` collection: list/detail views, inline create/rename/delete, drag reorder via
`@jkos/ui`'s `usePointerDrag` (distance on pointer, hold on touch) persisting the whole
`track_refs` array optimistically with revert-on-failure, and an add-to-playlist picker on
`TrackRow`.

The player (18.4) is the `@jkos/player` primitive's consumer #2 — the QUEUE is composed in
app code (`src/player/usePlayerEngine.ts`) over `@jkos/player/core`'s pure reducers; every
change of what's playing funnels through `controller.ts`'s `requestPlay`, and end-of-track
auto-advance watches the engine's public `playing`/`globalPos`/`total` surface. History
records one row per listening session (papyros's 17.4 recorder pattern including the
screen-lock hidden-reopen fix; a track change is always a session boundary). 18.5 swaps the
backend for `createGaplessDualBackend` (`@jkos/player/backend`): two elements, standby
preloads ~15 s out, gapless swap or 0–12 s crossfade, adapter⇄backend swap handshake with a
one-shot load-ack so no double-load reintroduces the gap — full design, the queue-composition
verdict (the primitive's two known gaps), and one known ms-scale stale-swap micro-race live in
[PLAYER_PARITY.md](PLAYER_PARITY.md) §3's status blocks.

### Library mount — flagged for Jag

Unlike papyros's `AUDIOBOOKS_DIR` (bind-mounted read-only from
`/mnt/Luna/Luna/Plex/Audiobooks` in both compose files), **no NAS path is hardcoded anywhere
for KourOS.** `MUSIC_DIR` defaults to a local dev-only sibling folder that doesn't need to
exist (the scanner degrades to a harmless 0-track no-op when it's missing); `.env.example`
documents the knob. The real music library mount — the env value AND the docker-compose
volume bind — is Jag's own decision, deliberately left open (same as 18.1 flagged it).

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
   pre-flights every file `standalone.conf` `include`s against the LIVE container: if one
   is missing (a restart cannot add a bind-mount), it **self-heals by recreating** the
   container via `docker compose up -d` on `infra/nginx`; otherwise a plain
   `docker restart standalone-nginx` refreshes the pinned inodes. Either way it finishes
   with an in-container `nginx -t`. Prod deploys skip nginx (`MANAGE_NGINX=0`) — the
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
| `@jkos/weave` | ordeck, beigeboard, papyros, @jkos/player | `useWeaveList`, `runCommand`, `usePolledResource`/`invalidate`, `useSuiteApps`, `weaveClient`, capability/dataset types; `connectorPair` (20.4 — a peer's declared read + write capability → the `{search, apply}` pair `<MatchPanel>` is fed); `./resumeCursor` `createResumeCursor` + `useResumeCursor` (16.4 — the debounced find-or-create upsert: 5s window, skip-unchanged, serialized single-flight, outgoing-key guard; framework-free core + React face) |
| `@jkos/weave/server` | jkauth/backend, beigeboard/backend, papyros/backend, lazuros/backend | `weaveCors`, `weaveAuth`, `weaveWriteGate`, `healthHandler`, `serveCapabilities`, `serveDatasets`, `buildItemFilters`, `weaveServerClient`; the lego bricks — `defineCollection` (incl. `only: [...]` append-only selection, 17.4), `defineConnector` (incl. the in-process `call()` read surface, 17.6), triggers, `defineLibraryScanner` (17.2 — walk → ffprobe pool → mtime-skip → upsert → prune; `unit: 'dir' | 'file'`), `defineMediaRoutes` (17.3 — stream/cover/download + the pure `decidePlayback` engine); dual CJS+ESM |
| `@jkos/files` | papyros/backend (via `defineMediaRoutes`); music app next | CJS: `rangeStream(res, absPath, opts)` (full 200/206/416, `Accept-Ranges`/`Content-Range`) + `containPath(root, rel)` — the Range-streaming primitive extracted from papyros `media.js` (17.1) |
| `@jkos/design` | ordeck, beigeboard, jkauth (via hub.css mirror) | `buildJkOSTheme` (per-app accent/neutrals/radius/fonts/responsive), `applyJkOSMode`, `applyJkOSTheme`; `hub.css` token sheet (incl. responsive card-scale tokens + `@media` overrides); `STORAGE_KEYS`; `packages/design/responsive/breakpoints.ts` (canonical 3-tier breakpoints, pinned by `pnpm check:responsive`) |
| `@jkos/ui` | ordeck, beigeboard, papyros, @jkos/cards, @jkos/player | `WidgetShell`, `SettingsDrawer`/`SettingsSection`; `Lab`/`TButton`/`Press`/`Well`/`Sheet`/`Bubble`/`Pill` primitives — polymorphic over `as` since 16.1 (`ComponentPropsWithoutRef<E>`, so `disabled`/`type`/`href` type-check per element); `useBreakpoint()` + `usePointerDrag`; the Wave-20 shells: `<AppShell>` (20.1 — guard→header→SettingsDrawer→prefs via injected selector hooks, keeps the package decoupled from `@jkos/auth-client`), `<AsyncView>` (20.3 — loading→error→empty→children), `<CoverArt>`/`<MediaGrid density>` (20.2 — ladder in `@jkos/design` `responsive/mediaGrid.ts`), `<MatchPanel>` (20.4 — presentational search→candidates→apply fed an injected `{search, apply}` pair) |
| `@jkos/cards` | beigeboard, ordeck (seam) | Shared calendar card kit: `cardSurface()` factory, `TaskChip`/`TimeBlock`/`AllDayBar`/`TimelinePreview`/`CardFrame`, responsive `WeekView`+`CalendarView` (grid on desktop/tablet, agenda on mobile); pure date/time/grid math in `datetime.ts`; `DragAdapter` interface decouples drag from the kit |
| `@jkos/player` | papyros (consumer #1; music app is #2, §3 Wave 18) | Media primitive ([PLAYER_PARITY.md](PLAYER_PARITY.md)): `./core` pure timeline math (`buildTimeline`/`locate`/`toGlobal`/`navPoints`/`fmtClock` — lifted verbatim from papyros `position.ts`) + pure `Queue` reducers (seeded stable shuffle, repeat, reorder); `./backend` the `MediaBackend` seam + `createHtmlMediaBackend` (one impl for `<audio>` and `<video>`, classified `BackendError` vocabulary spanning both error channels); `./engine` the headless `usePlayerEngine` hook (injected `ItemLoader`/`ProgressStore`/`BookmarkStore`/`PlayerUrls`/`Transport`/`CompatPolicy` seams; preserves the six load-bearing invariants — stable-identity backend, refs-in-listeners, `reqSeq` load guard, serialized single-flight progress writes, `recoveringRef` reentrancy, autoplay-veto surfacing; + volume/mute, 16.2); `./services` (Wave 16 — `useMediaSession` incl. `setPositionState` (16.3), the offline write queue `createWriteQueue`/`writeQueue`/`queueStorage` (16.5)); `./ui` (16.6 — `<PlayerBar>` slotted shell, stock transport controls, segment-aware `<Scrubber>`, `<QueuePanel>`, `<NowPlaying>`, `<SegmentList>`, tokens-only `player-ui.css`); `./factory` (16.7 — pure `createPlayer(spec)` + `audiobookPlayer`/`musicPlayer`/`videoPlayer` presets, capability-driven control recipes) |

**Invariant — never duplicate shared logic.** Import `@jkos/auth-client` (frontend) or
`@jkos/auth-middleware`/`@jkos/weave/server` (backend). Per-app copies are regressions.
