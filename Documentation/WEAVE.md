# jkOS — Weave (Suite Integration Fabric)

The connective tissue that makes ORDECK *the one-screen portal into your entire digital
life, owned entirely by you*. Weave is the contract + shared code by which every jkOS app
becomes **reachable** (launch, deeplink), **readable** (data slices on the HUD), and
**actionable** (write commands from the HUD) — uniformly, so adding a new app is one
registry row plus one capabilities endpoint, with zero portal code edits.

This doc is the specification. For how the pieces fit at the architecture level, see
[ARCHITECTURE.md](ARCHITECTURE.md). When this doc disagrees with the code, the code wins —
update this.

## Principles

1. **Each app owns its data.** Weave never introduces a central data store. ORDECK reads
   and writes through each app's own API; the app stays the single source of truth.
2. **Discovery over hardcoding.** Apps declare themselves (`app_registry`) and what can be
   done to them (`/api/capabilities`, `/api/datasets`). The portal consumes declarations;
   it does not embed per-app knowledge.
3. **Pure data, GUI- and AI-composable.** Widget specs — including write/command widgets —
   are declarative data (`WidgetSpec`), so the same shape is built by the Workshop GUI and
   emitted by an eventual text→widget AI step.
4. **The edge proxy is the trust boundary.** Cross-app browser calls go same-origin through
   nginx (`/api/<app>/*`), so the `jkos_token` cookie flows and there is no CORS surface.
5. **Symmetric fabric.** ORDECK is one client among equals. Any app can reach any peer via
   `weaveClient(app).list/command`. No special portal channel.
6. **Build the seam, defer the machinery.** Ship the lowest-risk consolidation first; gate
   heavier pieces behind concrete triggers (recorded at the bottom).

## The contract — what an app implements to weave in

Every obligation is met through a **shared `@jkos/weave/server` helper** — never
hand-rolled per app (that is what drifted across the suite before this standard):

| # | Obligation | Shared mechanism |
|---|---|---|
| 1 | **Identity** — verify the user/service behind every call | `weaveAuth(opts)` (wraps `jkosAuth` + JWKS→key→dev ladder + prod fatal-guard) |
| 2 | **Write authorization** | `weaveWriteGate({ scope })` (guest read-only → service `NO_USER_CONTEXT` → scope check) |
| 3 | **Cross-origin** | `weaveCors(originResolver)` (one header block; origin list from registry) |
| 4 | **Liveness** | `healthHandler(service)` → `{ status:'ok', service }` |
| 5 | **Directory presence** — be discoverable | a row in jkAuth `app_registry` (id, name, origin, allowed_roles, api_base, health_path, capabilities_path, datasets_path, ai) |
| 6 | **Capability declaration** — declare what can be *done* | `serveCapabilities(doc)` → `CapabilityDoc` at `GET /api/<app>/capabilities` |
| 7 | **Dataset declaration** — declare what can be *read* | `serveDatasets(doc)` → `DatasetDoc` at `GET /api/<app>/datasets` |
| 8 | **Filtered reads** | `buildItemFilters(query, spec)` + `coerceWeaveColumn(k,v)`; cross-app provenance via an `ext_ref` column |

`/api/<app>/capabilities` and `/api/<app>/datasets` are **app-owned data** served by the app
about itself. jkAuth stores only *where* to find them, never the declarations themselves.

## Package topology

### Frontend — `@jkos/weave` (`packages/weave/`)

- `manifest.ts` — `SuiteApp` shape, the `AppId` union (`APP_IDS`, single source for every
  app id in the suite) typing `suiteApp/apiBase/appOrigin` and all weave signatures, `SUITE_APPS`
  static fallback, `probeApps/suiteApps` helpers, `setLiveApps` (hydration hook-in).
- `resource.ts` — `usePolledResource` + keyed `invalidate(...)` bus (`'<app>.<resource>'`). Also exports `subscribe(keys, fn)` so multi-resource consumers join the same bus.
- `capability.ts` — `FieldType`, `BodyField`, `CapabilityDef`, `CapabilityDoc`. `FieldType`
  includes `json` (the typed escape hatch for non-flat bodies/outputs) and `ref` (a typed stud:
  `BodyField.ref = '<app>.<dataset>'`). `CapabilityDef` declares a typed **`returns`** (the
  primitive's OUTPUT, mirror of `DatasetDef.item`) so one lego's result can be wired into the next.
- `dataset.ts` — `DatasetDef`, `DatasetDoc`, `FilterField`/`FilterOp` — the read-side mirror of
  `capability.ts`. A `FilterField` carries its own enforcement mapping (`column`/`op`), so the
  server derives its list filter from the declaration (single source) — see `filterSpec()` below.
- `extref.ts` — `extRef(app,id)` / `parseExtRef` (`<app>:<id>` convention).
- `useSuiteApps.ts` — hydrates the manifest from `GET /auth/apps` and calls `setLiveApps`.
- `fetchCapabilities.ts` — fetches + caches an app's `CapabilityDoc`. Evicts failed/empty results so a transient outage doesn't permanently disable a command widget.
- `fetchDatasets.ts` — fetches + caches an app's `DatasetDoc`. Same eviction semantics.
- `dispatch.ts` — `runCommand(app, cap, body)`: edge-proxied fetch + `invalidate(...cap.invalidates)` on success.
- `weaveClient.ts` — **the one-call peer SDK any app uses**: `weaveClient(app).list/command/capabilities/datasets` (imperative) + `useWeaveList(app, dataset, filters?, opts?)` (reactive read hook).

### Shared — `@jkos/weave/shared` (`packages/weave/src/shared/`)

- `docShape.js` — **single source of truth for the discovery-doc envelope**: `checkDocShape(doc, listKey)` validates `{ app, version, <list>[] }` where every entry has a string `id`. Runs in any runtime (CommonJS) so Node backends `require` it and Vite bundles it for the browser. Used by both `serveCapabilities`/`serveDatasets` (throw on boot if malformed) and `fetchCapabilities`/`fetchDatasets` (evict on read). The authoritative TS shapes remain in `../capability.ts` and `../dataset.ts`.

### Backend — `@jkos/weave/server` (`packages/weave/src/server/`)

Dual CJS+ESM (a nested `src/server/package.json` marks the dir CJS within the otherwise
`type:module` package). Backends `require('@jkos/weave/server')`.

- `cors.js` — `weaveCors(originResolver)`
- `auth.js` — `weaveAuth(opts)` (JWKS fetch + fallback, dev ladder, fatal-guard)
- `writeGate.js` — `weaveWriteGate({ scope })`
- `health.js` — `healthHandler(service)`
- `contracts.js` — `serveCapabilities(doc)`, `serveDatasets(doc)` (validates via `docShape`, throws if malformed)
- `filters.js` — `buildItemFilters(query, spec)`, `filterSpec(filters)` (projects a dataset's
  declared `FilterField[]` → the `{param,column,op}` spec `buildItemFilters` enforces, so declared
  == enforced), `coerceWeaveColumn(k, v)`
- `columns.js` — column coercion constants
- `serverClient.js` — `weaveServerClient(appId, { actingUser? })`: mints/caches a service token via `POST /auth/token`, then calls a peer with `Authorization: Bearer`. Read/aggregate by default; pass `actingUser` (G1) and, if the client is delegation-enrolled, per-user writes commit AS that user.
- `delegation.js` — `applyDelegation(user)`: normalizes a delegated (on-behalf-of) service token to its effective acting user. Run by `weaveAuth` at the identity chokepoint, so every route writes per-user transparently and the write-gate lifts `NO_USER_CONTEXT` for it (G1).
- `collection.js` — `defineCollection(def)` (Layer D / F3): one `CollectionDef` (a name + typed fields) → `.ddl()` (table + delta triggers), typed create/update/delete `.capabilities`, the `.dataset` (+ filters), `.mount(router, db)` (scoped CRUD). One spec, no drift between table/routes/docs. Lean subpath `@jkos/weave/collection` (zero-dep) so a discovery doc derives its docs offline.
- `connector.js` — `defineConnector(def)` (Layer D / F2): wrap an external API/device as a peer — `.capabilities`/`.datasets` are CLEAN Layer-A docs (discoverable like a native app), `.mount(router)` translates each call to the upstream server-side (secret never reaches the browser). Subpath `@jkos/weave/connector`.
- `trigger.js` — the automation engine (Layer D / F1 + F4): `createTriggerEngine({triggers,dispatch})`, `resolveBindings`, `validateTriggerTypes` (the typed-stud fit between a WHEN capability's `returns` and a DO body — F4), `triggerWebhook(engine)`, `serverDispatch({resolve})` (runs per-user cross-app DOs under the triggering user via G1).
- `index.js` / `index.mjs` — re-exports everything above + `jkosAuth`/`requireScope`/`verifyToken` from `@jkos/auth-middleware`

### Backend — jkAuth (`apps/jkauth/src/`)

`routes/weave.js` is the **suite directory**: `GET /auth/apps` (live registry → `SuiteApp[]`) and `GET /auth/jwks` (key publish for verifiers). Token issuance stays in `tokens.js`; profile/identity in `routes/profile.js`. One process, clear route separation.

## Source of truth

jkAuth's `app_registry` is **authoritative**. `useSuiteApps()` hydrates the live manifest
from `GET /auth/apps` and calls `setLiveApps()`, so all `manifest.ts` helpers resolve
against the registry. The static `SUITE_APPS` is only the offline/bootstrap fallback.
Adding an app = one seed row (plus its own deploy/nginx/DNS), not a two-repo edit.

## Security model

Trust boundary = the edge proxy. On top of it, the `jkos_token` access JWT (RS256) carries:

- `azp` — which app the session was minted through (provenance; logged in `auth_events`)
- `aud` — multi-valued, computed from `app_registry.allowed_roles`: the set of app ids
  the user's role may access. Each app verifies its own `JKOS_APP_ID ∈ aud` once the env
  var is set. Opt-in for safe rollout — set it after aud-bearing tokens are flowing.
- `scope` — role-derived named scopes. Capabilities declare `scopes`; the resource app
  checks `token.scope ⊇ required`. The check is rollout-safe: it only enforces when `scope`
  is present, so tokens minted before the change fall through to the role gate rather than
  being rejected mid-session.

**Error codes** — the write gate and middleware emit codes from the shared vocabulary in
`@jkos/auth-middleware/codes.js` (mirrored in `jkos_auth.py`). `authFetch` on the client
branches on `TOKEN_EXPIRED`/`UNAUTHENTICATED` to refresh; everything else surfaces to the
caller. `pnpm test:contracts` asserts Node and Python vocabs are key-for-key equal.

**Service-to-service:** `POST /auth/token` (client-credentials) → `signService()` mints a
`typ:'service'` token (no human `sub`, has `azp` + `scope`). `weaveServerClient(appId)`
uses this: mints/caches one token, calls a peer with `Authorization: Bearer`. Read-capable;
per-user writes are blocked (`NO_USER_CONTEXT`) unless the client is delegation-enrolled
and passes `actingUser` — the G1 on-behalf-of seam (see "The lego-kit primitives" below).

CORS on every backend derives from `app_registry` origins via `weaveCors`.

**Operator config (env):**
- jkAuth: `JKOS_SERVICE_CLIENTS="id:secret:scopeA|scopeB,..."` enables `POST /auth/token` (unset → 503)
- Each resource app: `JKOS_APP_ID=<registry id>` turns on audience enforcement (opt-in)
- Each resource app (headless): `JKOS_SERVICE_CLIENT_ID` + `JKOS_SERVICE_CLIENT_SECRET` + `JKOS_AUTH_URL` for `weaveServerClient`

## Transports — how a call reaches a peer

The fabric is symmetric: any app reaches any peer the same way over one trust model.

**1. Browser → peer: same-origin everywhere.**
Every prod server block in `standalone.conf` includes `infra/nginx/weave-proxy.conf` — a
generated file with `/api/<peer>/*` and `/health/<peer>` locations for every registered peer.
A page on any `*.jkos.net` origin calls `/api/bb/…` same-origin. The `jkos_token` cookie
flows; there is no CORS surface to misconfigure; the peer backend still enforces its own JWT.

Staging's single origin gets `weave-proxy-staging.conf` — the same locations, but each one
admin-gated with `auth_request`. Both files are generated from one `PEERS` table in
`infra/nginx/gen-nginx-weave.mjs`. `node gen-nginx-weave.mjs --check` exits 1 if either file
is out of sync (run in CI). After regenerating, **restart** nginx — the files are bind-mounts;
`reload` won't re-read a replaced inode.

**2. Backend → peer: service tokens.**
`weaveServerClient(appId, { actingUser? })` mints a service token and presents it as
`Authorization: Bearer`. Read/aggregate-capable by default; with `actingUser` and a
delegation-enrolled client, per-user writes commit AS that user (G1).

**3. Cross-origin / off-domain: registry-driven CORS (deferred).**
Promote transport 1 to this only when a peer can't be nginx-proxied (genuinely off-domain or
third-party). Today every suite peer is proxied.

## The command vocabulary (actionable widgets)

The HUD engine (`apps/ordeck/src/hud/`) supports a write family of `WidgetNode` variants:
`form`, `input`, `select`, `toggle`, `button`. Each write node carries a `CommandRef`
(app + capability + body bindings). The `$form` source is injected into scope during
submission so `{ src: '$form', path: 'title' }` resolves to the current field value. The
final request body is `{ ...resolvedBindings, ...$formValues }`.

`runCommand(app, cap, body)` in `@jkos/weave` handles the fetch, then calls
`invalidate(...cap.invalidates)` on success. ORDECK wraps it with a small `useCommand`
loading/error hook. The Workshop composes these as pure data; an AI can emit the same
shape. `COMPONENT_REGISTRY` remains as an escape hatch for genuinely bespoke rendering.

## Adding a new app (full onboarding)

1. Seed an `app_registry` row in jkAuth: `id`, `name`, `origin`, `allowed_roles`,
   `api_base`, `health_path`, `capabilities_path?`, `datasets_path?`, `ai`. This is the
   authoritative directory — ORDECK and all peers discover from it.
2. Add the peer to `infra/nginx/gen-nginx-weave.mjs` PEERS table (upstream, health prefix,
   api prefix), regenerate `weave-proxy.conf` and `weave-proxy-staging.conf`, then restart
   nginx. Verify with `--check`.
3. Add the prod server block to `standalone.conf` (copy BeigeBoard; it `include`s the peer proxy).
4. Wire the backend through `@jkos/weave/server`: `weaveCors` + `weaveAuth` + `weaveWriteGate`
   + `healthHandler`. Serve `serveCapabilities` / `serveDatasets` if it has a write/read surface.
5. DNS in Cloudflare; deploy; restart nginx.

No portal code changes — discovery does the rest.

## The contract gate (`pnpm test:contracts`)

The suite-wide conformance check that prevents the silent drift that caused past incidents
(numeric `sub`, independent re-typings of the issuer string, bespoke per-app FE clients).

Run: `pnpm test:contracts` at the repo root. Exits non-zero if any hard contract fails.
The weave-relevant links: codes-vocab node↔python parity + issuer/cookie single-source
(auth contracts), `docShape`/`CapabilityDef`/`DatasetDef` schema + `AppId` d.ts⇄runtime
parity (weave tests), the lego-brick contracts (`test/lego.mjs`), the discovered write
round-trip (`pnpm roundtrip`), the nginx conf sync (`gen-nginx-weave.mjs --check`), and
the suite prober (`pnpm prove`, fails on `drift`). Full anatomy: [TESTING.md](TESTING.md).

## The lego-kit primitives (Layer D)

Beyond "weave an app in," the suite ships three typed, self-describing *brick types* a
Workshop GUI / an AI emits as pure data; each expands into the Layer-A contract above, so
they snap together safely. See `@jkos/weave/server` (`collection.js` / `connector.js` /
`trigger.js`) and `packages/weave/test/lego.mjs`.

- **Collection** (`defineCollection`, F3) — define a data type once → storage + typed CRUD
  capabilities + a dataset, all from one spec. The scaffolder dogfoods it (`pnpm new-app`'s
  backend is a `defineCollection` + `.mount`).
- **Connector** (`defineConnector`, F2) — wrap a third-party API/device as a peer serving the
  same capability/dataset contract; the upstream call + secret stay server-side.
- **Trigger** (`createTriggerEngine`, F1) — "WHEN a capability fires → DO another," with the DO
  body BOUND to the event payload (F4: typed-stud flow, checked by `validateTriggerTypes`).
- **On-behalf-of delegation** (G1) — a delegation-enrolled service client mints an `act`-bearing
  token (jkAuth `signService` + the `/auth/token` gate); `weaveAuth`/`applyDelegation` normalize it
  to the acting user and `weaveWriteGate` lifts `NO_USER_CONTEXT`. This is what lets a trigger do a
  per-user cross-app write. Enrol a client via `JKOS_DELEGATION_CLIENTS`; it still needs the scope.

## Deferred (designed seams, un-defer triggers)

- **Transport 1→3: registry-driven CORS fallback** — when a genuinely off-domain / third-party
  peer can't be reached through the same-origin edge include.
- **Runtime `app_registry` CRUD** (+ `_cachedAppOrigins` bust + dynamic nginx regen) — when
  apps are added without a deploy (dynamic plugins / third-party registration).
- **Extract the jkAuth directory into its own service** — when it needs different network
  exposure than the token-signing core, or auth latency degrades.

---

*Done since the last revision: `@jkos/weave/server` backend half · `weaveClient`/`useWeaveList`
· `datasets` read contract · same-origin-everywhere edge include (generated `weave-proxy.conf`
+ `weave-proxy-staging.conf`) · `shared/docShape.js` shared validator · `codes.js` shared vocab
· issuer/cookie single-source in `@jkos/auth-middleware` · `jkos_auth.py` Python verifier port
· `pnpm test:contracts` gate (29 auth + 24 weave + token + nginx check) · Layer-D primitives
(`defineCollection` / `defineConnector` / trigger engine) + the G1 on-behalf-of delegation seam,
with `test/lego.mjs` (70 assertions) chained into the weave test) · `AppId`-typed app addressing
(`APP_IDS` union in `manifest.ts`, threaded through every weave signature) · `@jkos/types` and
the deprecated `plugins/*` microfrontend stack deleted (superseded by the native widget engine)
· LazurOS (`apps/lazuros`) rebuilt on `weaveServerClient` + `lib/http.js` as a Node/Weave
job-queue AI gateway — see ARCHITECTURE.md § LazurOS.*
