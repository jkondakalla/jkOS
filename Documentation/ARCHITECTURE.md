# jkOS — Architecture

Self-hosted suite on TrueNAS SCALE: one pnpm + Turbo monorepo, one nginx front door,
one identity provider. **ORDECK** is the portal — a widget HUD reading live data from
every other app. **jkAuth** is the SSO and app directory. **BeigeBoard**, **PapyrOS**,
**KourOS** and **LazurOS** are full peers on the same fabric, each owning its own data
and its own SQLite database. **jkDeploy** is the delivery pipeline. **Weave** is the
contract that lets any of them be reached without the others knowing their internals.

This is the engineering entry point — read this before touching any app. It states what
the code actually does, not what a design doc once proposed; where a claim below can't
be traced to a specific file, it isn't in here. For the integration contract itself, see
[WEAVE.md](WEAVE.md) — this document only summarizes it. For running and deploying, see
[OPERATIONS.md](OPERATIONS.md). For test anatomy, see [TESTING.md](TESTING.md).

---

## 1 · Shape

```
jkOS/
├── apps/
│   ├── ordeck/          static SPA (Vite+React), no backend — nginx serves it
│   ├── jkauth/           SSO + app directory, Node/Express, SSR login views
│   ├── beigeboard/       tasks/goals/routines SPA + Node backend
│   ├── papyros/          audiobook SPA + Node backend
│   ├── kouros/            music SPA + Node backend
│   ├── lazuros/           AI gateway: Node "State node" + Python worker/ + providers/
│   └── sylibos/           study app — SEPARATE TRACK, off the suite contract, off-limits
├── packages/@jkos/
│   ├── auth-middleware   Express JWT verify — the one place every backend checks a token
│   ├── auth-client       frontend auth + preferences hook, theme appliers
│   ├── weave             fabric: manifest, resource bus, capability/dataset types, dispatch
│   ├── design            hub.css tokens + theme factory + responsive breakpoints
│   ├── ui                widget shell, primitives, useBreakpoint, usePointerDrag
│   ├── cards              shared calendar card kit (Week/Calendar views)
│   ├── player             media primitive: timeline/queue math, MediaBackend, headless engine
│   ├── files              Range-stream + path-containment primitive
│   ├── suite-manifest    the app directory's one source row per app
│   └── suite-prober      conformance instrument (prove + roundtrip)
├── music/                Python, numpy+onnxruntime only — OUTSIDE the pnpm workspace
├── infra/nginx/          standalone.conf + generated peer-proxy + compose
├── jkos-deploy/          FastAPI deploy controller, own Compose project
├── scripts/               new-app scaffolder, android-signing, templates
├── test/                  root-level static conformance gates (the `check:*` family)
└── pnpm-workspace.yaml   turbo.json  docker-compose.yml  docker-compose.staging.yml
```

`pnpm-workspace.yaml` globs exactly `apps/*`, `apps/*/backend`, and `packages/*` — three
patterns, nothing else. `music/` is Python and is **not matched by any of them**, on
purpose: it keeps the two-line dependency budget (`numpy` + `onnxruntime`, no `torch`,
no fallback) honest and Python off the node gate entirely. It runs its own test suite
(`./.venv/bin/python -m unittest discover`) that `pnpm test:contracts` never touches.
`sylibos` sits inside the workspace glob but is a deliberately separate track — different
toolchain (React 19 + Tailwind v4 vs. the suite's React 18 + plain CSS) — and is excluded
from suite-wide sweeps by convention, not by tooling.

Shared `@jkos/*` packages are **source-only** — no build step. Consumers' Vite/tsc compile
them straight from `src/` via `exports`. Every Docker image builds from the **repo root
context** (`context: ../..` in each app's compose file) so `@jkos/*` resolves; a per-app
build context breaks shared-package resolution.

---

## 2 · Runtime topology

One standalone nginx container (`infra/nginx/`) owns both Docker networks and fronts prod
and staging from a single checkout:

```
internet
    │ HTTPS :443  (Cloudflare Origin Certificate, *.jkos.net)
    ▼
standalone-nginx
    ├── jkos.net              → ordeck-shell:80
    ├── auth.jkos.net         → jkos-auth:3100
    ├── beigeboard.jkos.net   → bb-app:3001
    ├── papyros.jkos.net      → papyros-app:3010    (generated, apps-generated.conf)
    ├── kouros.jkos.net       → kouros-app:3011      (generated, apps-generated.conf)
    ├── sylibos.jkos.net      → (separate track)
    └── staging.jkos.net      → path-routed, admin-gated
            /          → staging-ordeck-shell:80
            /auth/     → staging-jkos-auth:3100
            /beigeboard/ → staging-bb-app:3001
            /papyros/  → staging-papyros-app:3010   (apps-generated-staging.conf)
            /kouros/   → staging-kouros-app:3011    (apps-generated-staging.conf)
            /deploy/   → jkos-deploy:8000
```

LazurOS runs `network_mode: host` (it needs to broadcast raw Wake-on-LAN packets) and is
reached at `host.docker.internal:8080` — the one host-network peer block.

**Two Docker networks.** `jkos-internal` carries prod services; `nginx-staging-proxy`
carries the staging mirrors plus jkos-deploy. nginx joins both and must start first on a
cold boot (it creates them).

**`standalone.conf` is a *file* bind-mount, and its inode pins across `git reset`.**
Reloading nginx after a deploy serves the stale inode; **restart, don't reload.**
`jkos-deploy`'s pipeline does this correctly — see §7.

**Adding a "standard" app** (SPA at root, one upstream) is `pnpm new-app <id>`: it writes
one row to `@jkos/suite-manifest`, and `infra/nginx/gen-nginx-weave.mjs` regenerates the
server block (`apps-generated*.conf`) and the peer-proxy routes from it. A bespoke origin
(the portal, jkAuth, sylibos) is hand-written in `standalone.conf` instead. `--check`
guards that the generated files match; it runs in `pnpm test:contracts`.

**Same-origin peer proxy.** Every server block includes `weave-proxy.conf`, adding
`/api/<peer>/*` and `/health/<peer>` for every registered peer. A page on any `*.jkos.net`
origin calls a sibling app same-origin — the `jkos_token` cookie flows, there is no CORS
surface. Prod and staging get separate generated files (`weave-proxy.conf` /
`weave-proxy-staging.conf`), both derived from one `PEERS` table so they can't drift.

**Data.** Each app's SQLite lives on the NAS under
`/mnt/Luna/Backends/{Production,Staging}/<app>-data`, bind-mounted read-write into its
container. Media libraries mount read-only (`AUDIOBOOKS_DIR`, `MUSIC_DIR`). TLS material
is a flat `cert.pem`/`key.pem` under `/mnt/Luna/Backends/ssl`, mounted into nginx.

**Prod/staging isolation** is three env-var facts that must move together: the cookie name
(`jkos_token` vs `jkos_token_staging`), the JWT issuer (`jkos-auth` vs `jkos-auth-staging`),
and the staging admin gate — every `staging.jkos.net` location runs `auth_request` against
**production** jkAuth's `/auth/require-admin`, not staging's own, so staging can never
grant itself admin by cycling its own auth service. Code defaults are prod values; staging
overrides live exclusively in `docker-compose.staging.yml`, so a merge into prod is safe
by construction.

---

## 3 · The fabric, in one page

Full contract: [WEAVE.md](WEAVE.md) (being rewritten alongside this doc — read it for the
transport model, the capability/dataset shapes, and onboarding steps). What matters here:

**Apps declare, they don't call.** Each backend ships a `discovery.js` at its root (most
apps; LazurOS names its equivalent `docs.js`) — plain data, zero side effects, safe to
`require()` with no env, no DB, no network. It lists **capabilities** (what can be done —
`createItem`, `importRoutine`, …) and **datasets** (what can be read, with declared
filters). `packages/weave/src/shared/docShape.js`'s `checkDocShape` validates the same
envelope shape on both the serving side (boot-time throw) and the reading side (evict a
malformed doc rather than trust it).

**Discovery over hardcoding.** Apps register in jkAuth's `app_registry`; ORDECK and every
peer read that registry rather than embedding per-app knowledge. Adding an app is one DB
row (and, per §2, one nginx generator run) — *near*-zero portal code changes: two hardcoded
per-app branches survive in code documented as app-agnostic (LazurOS's write-back target
table and ORDECK's `if (a.id === 'lazuros')` systems-panel branch — the reset's WV-6), and
they are the exception that proves where the bar is.

**Zero cross-app runtime calls is the steady state, not a gap.** Each app is built to own
its data and be legible to a fresh reader — human or AI — composing against its
*declaration*, not its source. Weave exists so that declaration can be trusted without
reading the app's internals; measuring "how much traffic crosses between apps" is the
wrong axis. `packages/suite-prober` is the instrument built for the right one: it loads
the same source-of-truth files (registry, manifest, nginx config, each app's
discovery/docs file) and asserts they agree — declared filters actually enforced,
invalidation keys actually fired, nginx routes actually covering what's registered. It
reports findings in five buckets (`drift` / `consolidate` / `gap` / `info` / `ok`) and only
`drift` — a hard disagreement between two sources that both claim authority — fails the
build. `pnpm prove` runs it in file mode; `--live <url>` turns on a handful of
liveness-only probes against a deployed stack.

**The edge proxy is the trust boundary**, not app-side CORS — see §2. Every backend still
verifies its own JWT independently; the proxy only removes the need for cross-origin
requests.

---

## 4 · The apps

**jkAuth** (`apps/jkauth`, port 3100) is identity and the app directory in one process —
co-located so `app_registry` is the single source for both "what can this token reach" and
"where does this app live." Node/Express + SQLite (WAL). Mints RS256 JWTs (private key
never leaves the process; other backends verify via the published JWKS and
`@jkos/auth-middleware`). The access token (`jkos_token`, 15-minute TTL, httpOnly) carries
`sub` (stringified user id — a deliberate fix: python-jose ≥3.4 and PyJWT ≥2.10 reject a
numeric `sub`), `scope` (role-derived, checked by resource apps), `azp` (which app minted
the session, best-effort provenance), and `aud` — computed at mint time from
`app_registry.allowed_roles` into the set of app ids the user's role may reach. **`aud` is
minted but verified nowhere, including by jkAuth's own `resolveUser`** (`tokens.js`'s two
`jwt.verify` calls pass no `audience`). Verification is real code — `@jkos/auth-middleware`
only adds `opts.audience` when an `appId` is supplied — but it is gated on `JKOS_APP_ID`,
which **no compose file sets**. With one cookie shared across every `*.jkos.net` subdomain,
this is the containment that is currently off; turning it on (per service, both compose
files, plus a boot assertion) is planned, not done. The refresh token (`jkos_refresh`,
30-day, rotating) burns its whole session family on reuse outside a short grace window.
User preferences (theme, HUD layout, widget placement) are a JSON blob in `users.preferences`,
read/written by `GET`/`PATCH /auth/profile` — every frontend calls this endpoint for the
values it stores there.

**BeigeBoard** (`apps/beigeboard`, port 3001) is the primary data app — goals, tasks,
milestones, calendar-synced events, and routines (a commitment to a rhythm — see
[ROUTINES.md](ROUTINES.md) for the cadence engine, the spec document, and the mint rules).
Node/Express backend, one SQLite database (WAL), one `items` table holding all five kinds
(`task`/`event`/`goal`/`milestone`/`routine` — a routine's occurrences are themselves
ordinary `task` rows) plus a separate `library` table for reusable sub-tasks a routine step
can reference. `discovery.js` at the backend
root declares `createItem`/`completeItem`/`updateItem`/`deleteItem`/`importItems`/
`importRoutine`/`importLibrary` as capabilities and `items`/`routines`/`library` as
datasets. Calendar sync (Google/Outlook/iCloud) is pull-only; OAuth tokens are
AES-256-GCM-encrypted at rest when `CALENDAR_ENC_KEY` is set (plaintext otherwise — a
safe no-op, not a default to ship with). Its Week/Calendar tabs are thin wrappers over the
shared `@jkos/cards` kit.

**PapyrOS** (`apps/papyros`, port 3010) is a fully-native multi-user audiobook library —
its own scanner, catalog, and Range-streamed playback backend; not a client of any external
media server. One SQLite database split on a scope boundary: `books` is a hand-rolled,
scanner-populated shared catalog (no `user_id` — every user sees the same library);
`progress`/`bookmarks`/`clubs`/`club_members`/`history` are genuine per-user
`defineCollection`s. The scanner and the streaming routes are both thin app config over
shared Weave "bricks" (`defineLibraryScanner`, `defineMediaRoutes` — see §5). Metadata
enrichment calls the iTunes Search API (`defineConnector`, keyless) — the only external
network call the app makes. The player is a thin adapter over `@jkos/player` (consumer #1).

**KourOS** (`apps/kouros`, port 3011) is the music-library counterpart, built on the same
bricks with zero brick changes — proof the scanner/media-routes abstraction generalizes.
One SQLite database: `tracks` is the scanner-populated shared catalog (`unit: 'file'`, one
row per audio file, versus PapyrOS's `unit: 'dir'`); `playlists`/`history`/`ratings` are
`defineCollection`s. Streaming is direct-play only — no compat-remux ladder, unlike
PapyrOS's Firefox m4b workaround. `MUSIC_DIR` and the library bind-mount are environment
knobs with no hardcoded NAS path (unlike PapyrOS's `AUDIOBOOKS_DIR`); the compose file
documents at length why the obvious host path (`/mnt/Luna/Plex/Music`) is wrong on the
TrueNAS host itself (the real data is under `/mnt/Luna/Luna/Plex/Music` — a CIFS-share vs.
host-dataset spelling mismatch that mounts cleanly empty rather than failing). The player
is `@jkos/player`'s second consumer, with its own queue/shuffle/repeat preferences
persisted to `localStorage` (`kouros.player.queue`, `kouros.player.rate`) — see §5 for why
that matters. A separate discovery layer (`backend/src/discover/`) serves similarity/radio/
vibe-map results sourced from `music/`'s offline-computed vector index, mounted in as
`VECTOR_DB_PATH`; when that file is absent every discovery surface degrades to metadata
affinity rather than breaking.

**LazurOS** (`apps/lazuros`, host network, port 8080) is the suite's AI gateway — an
always-on Node "State node" plus a Python worker on the compute node. Every capability call
is **asynchronous**: `POST /api/lazuros/<cap>` returns `202 {job_id}`, and callers poll. One
SQLite `jobs` table (WAL) tracks `PENDING → PENDING_WAKEUP → IN_PROGRESS → DONE|FAILED`; a
sleeping compute backend gets a best-effort Wake-on-LAN burst. No hardware fact — model
tags, IPs, MACs — lives in code; every swappable piece is a provider built from a mounted
`deployment.json`, so the same image runs any self-hoster's hardware. It is code-complete
and gated but **has never been run against a live inference runtime.** Delegated write-back
(a worker result committed into e.g. BeigeBoard on behalf of the requesting user) requires
the `lazuros` service client to be enrolled in `JKOS_SERVICE_CLIENTS` and
`JKOS_DELEGATION_CLIENTS` — **neither is set in any compose file today**, so the write-back
path 503s on first call in any deployed environment. There is exactly one AI-related user
preference in the suite, `preferences.lazuros.enabled` (owned by jkAuth, read by other apps
only to hide their own AI surfaces) — no per-user model or gateway URL.

**jkDeploy** (`jkos-deploy/`) is a FastAPI server behind `staging.jkos.net/deploy/`, its own
isolated Compose project (it cannot redeploy itself). `jkos_auth.py` is a Python port of
`@jkos/auth-middleware` — same issuer, same cookie name, same JWKS/RS256 verify — so an
operator's jkOS session gates deploy actions, and the shared error-code vocabulary
(`packages/auth-middleware/codes.js`, mirrored into this file and asserted key-for-key equal
by `pnpm test:contracts`) can't silently drift between the two languages. "Deploy Staging"
and "Promote to Production" both call `infra/scripts/lib-deploy.sh`: fetch + hard-reset the
target checkout, `docker compose up --build -d`, verify every container is actually
`running`, then (staging only) validate and restart nginx. Promotion resets the prod
checkout to `origin/<PROD_BRANCH>` (default `staging`) — there is no merge step and no push
credential on the server, so it ships exactly the commit already tested on staging.

**SylibOS** (`apps/sylibos`) is a separate development track (React 19 + Tailwind v4) with
its own toolchain, deliberately off the suite contract. Do not edit it in a suite-wide
sweep; nothing in this document describes its internals.

---

## 5 · The data layer

Every backend (jkAuth, BeigeBoard, PapyrOS, KourOS, LazurOS) runs SQLite in WAL mode,
opened directly in-process (`better-sqlite3`) with a hand-rolled migration ladder that runs
on require/boot — no separate migration tool. Two shapes recur across apps:

- **Scanner-populated shared catalogs** (`books`, `tracks`) — hand-rolled migrations with
  no `user_id`, because the row's owner is the filesystem scan, not a user.
- **Per-user CRUD collections** (`progress`, `bookmarks`, `clubs`, `history`, `playlists`,
  `ratings`, BeigeBoard's `items`) — built from `@jkos/weave/collection`'s
  `defineCollection`, a single spec that derives the table DDL, the CRUD routes, and the
  served capability/dataset docs together, so they cannot drift from each other. An
  `only: ['create']` option (used by every `history` table) removes update/delete routes
  entirely rather than merely denying them at runtime.

`@jkos/weave/server` also exports two higher-level bricks that PapyrOS and KourOS both
build their backends on with **zero brick-level changes between them** — `defineLibraryScanner`
(folder walk → ffprobe pool → mtime-incremental skip → upsert → prune, parameterized by
`unit: 'dir' | 'file'`) and `defineMediaRoutes` (Range-stream/cover/download, built on
`@jkos/files`' `rangeStream`/`containPath`). Common plumbing — `weaveAuth`, `weaveWriteGate`,
`healthHandler`, `serveCapabilities`/`serveDatasets`, `buildItemFilters` — lives in the same
package so declared dataset filters and enforced query filters are the same code, not two
hand-typed lists that can disagree.

⚠️ **`localStorage` is not dead** despite the theme/preferences model in §4: **PapyrOS,
KourOS, and ORDECK each persist real per-app state client-side that never touches jkAuth.**
PapyrOS and KourOS both persist volume/mute through `@jkos/player`'s `persistVolume`
(keyed per app; PapyrOS also persists playback rate — KourOS wires the same
`storageKey` but exposes no rate control to write it). KourOS separately persists queue
shuffle/repeat/crossfade prefs under `kouros.player.queue`; ORDECK persists its weather
widget's location/API-key config under a dedicated key. None of this round-trips through
`PATCH /auth/profile`, so it does not follow the user across devices the way theme mode and
HUD layout do. (BeigeBoard's only `localStorage` touch is a pre-hydration read of the
shared `jkos-mode` key that `@jkos/design` itself writes — a flash-avoidance cache of the
server-stored value, not an independent store.)

---

## 6 · The design factory

`packages/design` is the single source for suite styling: `buildJkOSTheme()` derives a
per-app theme (accent pair, neutrals, radius, fonts, responsive breakpoints) and
`hub.css` is the token sheet every app's CSS is built against — mode (paper/dark) and
motion axes are runtime attributes on `<html>`, not separate stylesheets. Because jkAuth is
static-served rather than bundled through the same Vite pipeline as the React apps, it
consumes a **generated mirror** of `hub.css` rather than importing the package directly;
`pnpm check:tokens` asserts the mirror and the source haven't drifted, and `sync-tokens.mjs`
regenerates it. `pnpm check:design` re-derives the `/design` reference page's inlined CSS
and fails if it's stale.

This section is deliberately short — the reset's Stage F restructures the factory, and a
longer description here would just be more surface to go stale before that lands.

---

## 7 · The gate

`pnpm test:contracts` is the suite-wide gate (root `package.json`), and it's a straight
chain — first failure stops the run. It boots and smoke-tests jkAuth (`test:contracts` +
`test`), `@jkos/weave`, `@jkos/player`, BeigeBoard's backend, then `pnpm roundtrip` (a live
write round-trip across the fabric), then LazurOS's backend, `@jkos/files`, PapyrOS's
backend, KourOS's backend, and the `@jkos/cards` logic suite. After the behavioral smokes
it runs fifteen static conformance checks — `check:tokens`, `check:nginx`, `check:responsive`,
`check:drag`, `check:cards`, `check:routine`, `check:hud`, `check:docker`, `check:async-view`,
`check:overlay`, `check:design`, `check:fields`, `check:scroll`, `check:text`, `check:auth`
— each a small Node script under `test/` or an app's own `scripts/`, asserting one
suite-wide invariant by re-deriving it from source rather than trusting a doc. It finishes
with `pnpm prove` (§3). None of this touches `music/`, which runs its own unittest suite
outside the pnpm workspace (§1) — a green `test:contracts` says nothing about it.

`pnpm prove` (`packages/suite-prober/prove.mjs`) is the conformance instrument on its own:
it loads the registry, the manifest, every app's discovery/docs file, and the generated
nginx config as data, runs each probe in `src/probes/`, and buckets findings as `drift` /
`consolidate` / `gap` / `info` / `ok`. Only `drift` — two sources that both claim authority
and disagree — fails the run; the rest are logged as opportunities. `--live <url>` (with
`--token`) turns on liveness-only probes against a deployed stack instead of the checked-out
files, for a post-deploy smoke.

Full anatomy of both: [TESTING.md](TESTING.md).

---

## 8 · Where to go next

- **Testing** — harness structure, how to add a smoke/probe/gate: [TESTING.md](TESTING.md).
- **Operations** — running locally, deploying, rotating keys, backups:
  [OPERATIONS.md](OPERATIONS.md).
- **The integration contract** — what an app implements to weave in, the transport and
  security model: [WEAVE.md](WEAVE.md).
- **Routines** — the cadence engine, the spec document, the mint rules:
  [ROUTINES.md](ROUTINES.md).
- **The music/LazurOS design record** — why the vector space and the AI gateway are built
  the way they are: [ALGORITHMS.md](ALGORITHMS.md).
