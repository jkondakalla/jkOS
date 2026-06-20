# jkOS — Weave (Suite Interconnection Fabric)

The connective tissue that makes ORDECK *the one-screen portal into your entire digital
life, owned entirely by you*. Weave is the contract + shared code by which every jkOS app
becomes **reachable** (launch/deeplink), **readable** (data slices on the HUD), and
**actionable** (write commands from the HUD) — uniformly, so adding a new app is one
registry row plus one capabilities endpoint, with zero portal code edits.

This doc is the north star. When it disagrees with the code, the code wins — update this.

## Principles

1. **Each app owns its data.** Weave never introduces a central data store. ORDECK reads
   and writes through each app's own API; the app stays the single source of truth.
2. **Discovery over hardcoding.** Apps declare themselves (jkAuth `app_registry`) and what
   can be done to them (`GET /api/capabilities`). The portal consumes declarations, it does
   not embed per-app knowledge.
3. **Pure data, GUI- and AI-composable.** Widgets — including write/command widgets — are
   declarative data (`WidgetSpec`), so the same shape is built by the Workshop GUI and
   emitted by an eventual text→widget AI step.
4. **The edge proxy is the trust boundary.** Cross-app browser calls go same-origin through
   nginx (`/api/<app>/*`), so the `jkos_token` cookie flows and there is no CORS surface.
   Direct cross-origin calls are the exception.
5. **Build the seam, defer the machinery.** Ship the lowest-risk consolidation first;
   gate heavier pieces behind concrete triggers (recorded at the bottom).

## The contract — what an app implements to weave in

Every obligation is met through a **shared `@jkos/weave/server` helper** — never hand-rolled
per app (that is what drifted across the suite before this standard):

| # | Obligation | Shared mechanism |
|---|---|---|
| 1 | **Identity** — verify the user/service behind every call | `weaveAuth(opts)` (wraps `@jkos/auth-middleware` `jkosAuth` + the JWKS→key→dev ladder + prod fatal-guard), edge-proxied so the cookie flows |
| 2 | **Write authorization** | `weaveWriteGate({ scope })` (guest read-only → service `NO_USER_CONTEXT` → scope check) |
| 3 | **Cross-origin** | `weaveCors(originResolver)` (one header block; pluggable origin source) |
| 4 | **Liveness** | `healthHandler(service)` → `{ status:'ok', service }` |
| 5 | **Directory presence** — be discoverable | a row in jkAuth `app_registry` (id, name, origin, allowed_roles, api_base, health_path, capabilities_path, **datasets_path**, ai) |
| 6 | **Capability declaration** — declare what can be *done* | `serveCapabilities(doc)` → `CapabilityDoc` at `GET /api/<app>/capabilities` |
| 7 | **Dataset declaration** — declare what can be *read* | `serveDatasets(doc)` → `DatasetDoc` at `GET /api/<app>/datasets` |
| 8 | **Filtered reads** | `buildItemFilters(query, spec)` + `coerceWeaveColumn(k,v)`; cross-app provenance via an `ext_ref` column |

`/api/<app>/capabilities` and `/api/<app>/datasets` are **app-owned data** served by the app
about itself — the write- and read-side mirrors of `app_registry`. jkAuth stores only *where*
to find them (`capabilities_path` / `datasets_path`), never the declarations themselves.

## Package topology

**Frontend — `@jkos/weave`** (`packages/weave/`, depends on `@jkos/auth-client`):
- `manifest.ts` — `SuiteApp` shape + `SUITE_APPS` static fallback + `apiBase/appOrigin/probeApps/suiteApp/suiteApps` helpers + `setLiveApps` (hydration hook-in).
- `resource.ts` — `usePolledResource` + the keyed `invalidate(...)` bus (`'<app>.<resource>'`).
- `capability.ts` — `FieldType`, `BodyField`, `CapabilityDef`, `CapabilityDoc`.
- `extref.ts` — `extRef(app,id)` / `parseExtRef` (`<app>:<id>` convention).
- `useSuiteApps.ts` — hydrates the manifest from `GET /auth/apps` (registry over static fallback) and calls `setLiveApps`.
- `fetchCapabilities.ts` — fetches + caches an app's `CapabilityDoc` (evicts failed/empty results so a transient outage doesn't permanently disable a command widget).
- `dataset.ts` — the READ contract: `DatasetDef` / `DatasetDoc` (the read-side mirror of `capability.ts`).
- `fetchDatasets.ts` — fetches + caches an app's `DatasetDoc` (same eviction as capabilities).
- `dispatch.ts` — `runCommand(app, cap, body)`: edge-proxied fetch + `invalidate(...cap.invalidates)` on success.
- `weaveClient.ts` — **the one-call peer SDK any app uses**: `weaveClient(app).list/command/capabilities/datasets` (imperative) + `useWeaveList(app, dataset, filters?, opts?)` (the reactive read hook). ORDECK is now one client among equals, not the sole consumer.

`resource.ts` also exports `subscribe(keys, fn)` so multi-resource consumers (the widget
engine's fetch sources) join the same invalidation bus instead of inventing a refresh signal.

**Backend — `@jkos/weave/server`** (`packages/weave/src/server/`, dual CJS+ESM like
`@jkos/auth-middleware`, depends on it): the shared Express interop every backend weaves in
with — `weaveCors`, `weaveAuth`, `weaveWriteGate`, `healthHandler`, `serveCapabilities`,
`serveDatasets`, `buildItemFilters`, `coerceWeaveColumn` — plus `weaveServerClient(appId)`,
the headless peer client (mints/caches a service token, calls a peer with `Authorization:
Bearer`; read/aggregate-capable, per-user writes await the on-behalf-of seam). Re-exports
`jkosAuth`/`requireScope`/`verifyToken`. Backends `require('@jkos/weave/server')`; the
frontend `.` export stays TS for Vite. (A nested `src/server/package.json` marks the dir
CommonJS within the otherwise-`type:module` package.)

`useHudShelf` / `HudRef` stay in `@jkos/auth-client` — they mutate the preferences blob;
the package boundary follows *who owns the data* (prefs vs an app's API).

**Backend — jkAuth** (`apps/jkauth/src/`): `routes/profile.js` is identity only; the suite
directory/registry/JWKS/events live in `routes/weave.js`. Token issuance stays in
`tokens.js` (the auth core). One process, two route modules.

## Source of truth

jkAuth's `app_registry` is **authoritative**. `useSuiteApps()` hydrates the live manifest
from `GET /auth/apps` and calls `setLiveApps()`, so the plain `manifest.ts` helpers resolve
against the registry. The static `SUITE_APPS` is only the offline/bootstrap fallback. Adding
an app = one seed row (plus its own deploy/nginx/DNS), not a two-repo edit.

## Security model (maximal)

Trust boundary = the edge proxy. On top of it, the `jkos_token` access JWT (RS256, minted in
`tokens.js`) carries:
- `azp` — which app the session was minted through (provenance; logged in `auth_events`).
- `aud` — **multi-valued**, computed from `app_registry.allowed_roles`: the set of app ids
  the user's role may access. Each app verifies its own `JKOS_APP_ID ∈ aud`. This gives real
  audience enforcement without breaking the single shared SSO cookie.
- `scope` — role-derived named scopes (`*:read`, `*:write`, …). Capabilities declare
  `scopes`; the resource app checks `token.scope ⊇ required`.

**Service-to-service:** `POST /auth/token` (client-credentials, pre-shared secret) →
`signService()` mints a `typ:'service'` token (no human `sub`, has `azp` + `scope`).
`@jkos/auth-middleware` distinguishes `req.user.typ` ('user' | 'service'); apps opt in per
route. Service tokens are the seam for headless cross-app calls (cron/agent/webhook).
**Note:** a service token has no user context, so it cannot (yet) write *per-user* data —
BeigeBoard rejects service tokens on item writes (`NO_USER_CONTEXT`) until an explicit
on-behalf-of mechanism lands. The endpoint is rate-limited on the tight credential budget
(it carries a secret) and refuses to mint a token with no grantable scope.

**Enforcement, in practice:** capability `scopes` are not decorative — BeigeBoard gates its
write routes on `beigeboard:write`. The check is rollout-safe: it only enforces when the
token actually carries a `scope` array, so tokens minted before this change fall through to
the role gate (guests stay read-only) rather than being rejected mid-session.

CORS on every backend derives its allowlist from `app_registry` origins.

**Operator config (env):**
- jkAuth: `JKOS_SERVICE_CLIENTS="id:secret:scopeA|scopeB,..."` enables `POST /auth/token`
  (unset → 503, no service tokens exist).
- Each resource app: `JKOS_APP_ID=<registry id>` turns on audience enforcement (the
  token's `aud` must include it). **Opt-in for safe rollout** — leave it unset until
  aud-bearing tokens are flowing suite-wide (i.e. after jkAuth ships this change), then
  set it per app to start rejecting tokens not minted for that app. Use `requireScope()`
  from `@jkos/auth-middleware` to gate write routes on named scopes.
- BeigeBoard (and peers): `ALLOWED_ORIGINS="https://a.jkos.net,https://b.jkos.net"`
  mirrors the registry origins for the genuine cross-origin calls (`SHELL_URL` always included).
- A backend acting headlessly (`weaveServerClient`) sets `JKOS_SERVICE_CLIENT_ID` +
  `JKOS_SERVICE_CLIENT_SECRET` (one of jkAuth's `JKOS_SERVICE_CLIENTS`) + `JKOS_AUTH_URL`.

## Transports — how a call reaches a peer

The fabric is **symmetric**: any app reaches any peer the same way, via one of three transports
over the single trust model (edge = boundary; authorization lives in the JWT `aud`/`scope`):

1. **Browser → peer: same-origin everywhere.** Every prod origin includes
   `infra/nginx/weave-proxy.conf` (the `/api/<peer>/*` + `/health/<peer>` blocks), so a page on
   any `*.jkos.net` app calls `/api/<peer>/…` **same-origin** — the `jkos_token` cookie flows,
   there is no CORS surface to misconfigure, and the peer backend still enforces its own JWT.
   The include is generated from one table (`infra/nginx/gen-nginx-weave.mjs`, `--check` in CI)
   and bind-mounted alongside `standalone.conf` (restart nginx, don't reload). Staging is
   single-origin and keeps its own admin-gated copies inline.
2. **Backend → peer: service tokens.** `weaveServerClient(appId)` mints a `typ:'service'`
   token (client-credentials) and presents it as `Authorization: Bearer`. Read/aggregate-capable;
   per-user writes await the on-behalf-of seam.
3. **Cross-origin / off-domain: registry-driven CORS.** *Deferred* — promote transport (1)→this
   only when a peer can't be nginx-proxied (a genuinely off-domain / third-party app).

Because reachability is now universal, **authorization is the gate**: turn on `JKOS_APP_ID` per
backend (token `aud` must include it) once aud-bearing tokens flow, and keep `weaveWriteGate`
scopes. Both are opt-in / rollout-safe.

## The command vocabulary (actionable widgets)

The declarative widget engine (`apps/ordeck/src/hud/`) gains a write family — additive
`WidgetNode` variants `form`/`input`/`select`/`toggle`/`button`, a `CommandRef` (app +
capability + body bindings), and a `$form` source the renderer injects into scope so
`{ src: '$form', path: 'title' }` resolves like any binding. The final request body is
`{ ...resolve(cmd.body), ...$formValues }`. A single `runCommand(app, cap, body)` in
`@jkos/weave` does fetch + `invalidate(...cap.invalidates)`; ORDECK wraps it with a small
`useCommand` loading/error hook. The `COMPONENT_REGISTRY` escape hatch remains for the
genuinely bespoke. Because it is all pure data, the Workshop composes it and an AI can emit it.

## Adding a new app (the whole onboarding)

1. Seed an `app_registry` row in jkAuth (id, name, origin, allowed_roles, api_base,
   health_path, capabilities_path?, datasets_path?, ai). This is the authoritative directory.
2. If the app exposes an API/health for peers, add its `/api/<id>/` + `/health/<id>` to
   `infra/nginx/gen-nginx-weave.mjs` and regenerate `weave-proxy.conf` (every origin gets it).
3. Add its prod server block to `standalone.conf` (copy BeigeBoard; it `include`s the peer proxy).
4. Wire its backend through `@jkos/weave/server` (weaveCors/weaveAuth/weaveWriteGate/health),
   and serve `serveCapabilities`/`serveDatasets` if it has a write/read surface.
5. DNS in Cloudflare; deploy; restart nginx (bind-mount).

No portal code changes — discovery does the rest.

## Deferred (designed seams, un-defer triggers)

- **Cross-app event/notification bus** — when a peer must *push* a change (reactive interop),
  not be polled. Today the invalidation bus is in-process / frontend only.
- **On-behalf-of delegation** (service token + acting-user claim) — when a headless caller must
  write *per-user* data; lifts `weaveServerClient`'s read-only-writes limit (`NO_USER_CONTEXT`).
- **Transport (1)→(3): registry-driven CORS fallback** — when a genuinely off-domain /
  third-party peer can't be reached through the same-origin edge include.
- **Runtime `app_registry` CRUD** (+ `_cachedAppOrigins` bust, + dynamic `weave-proxy.conf`
  regen) — when apps are added without a deploy (dynamic plugins / third-party registration).
- **Delete `@jkos/types`** — apps no longer import it, but the deprecated `plugins/*` (MF-remote
  microfrontends, superseded by the native widget engine, not deployed) still do. Prune it with
  those plugins.
- **Extract the jkAuth directory into its own service** — when it needs different network
  exposure than the token-signing core, or auth latency degrades.

*(Done since the last revision: `@jkos/weave/server` backend half + `weaveClient`/`useWeaveList`
+ the `datasets` read contract + same-origin-everywhere edge include.)*
