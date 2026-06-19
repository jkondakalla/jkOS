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

| # | Obligation | Mechanism |
|---|---|---|
| 1 | **Identity** — verify the user/service behind every call | `@jkos/auth-middleware` on `/api/*`, edge-proxied so the cookie flows |
| 2 | **Directory presence** — be discoverable | a row in jkAuth `app_registry` (id, name, origin, allowed_roles, api_base, health_path, capabilities_path, ai) |
| 3 | **Capability declaration** — declare what can be *done* | `GET /api/capabilities` → `CapabilityDoc` |
| 4 | **Filtered data exposure** — be *readable* with server-side filters | filter params on list endpoints; cross-app provenance via an `ext_ref` column where relevant |

`/api/capabilities` is **app-owned data** served by the app about itself — the write-side
mirror of `app_registry`. jkAuth stores only *where* to find it (`capabilities_path`),
never the capabilities themselves.

## Package topology

**Frontend — `@jkos/weave`** (`packages/weave/`, depends on `@jkos/auth-client`):
- `manifest.ts` — `SuiteApp` shape + `SUITE_APPS` static fallback + `apiBase/appOrigin/probeApps/suiteApp/suiteApps` helpers + `setLiveApps` (hydration hook-in).
- `resource.ts` — `usePolledResource` + the keyed `invalidate(...)` bus (`'<app>.<resource>'`).
- `capability.ts` — `FieldType`, `BodyField`, `CapabilityDef`, `CapabilityDoc`.
- `extref.ts` — `extRef(app,id)` / `parseExtRef` (`<app>:<id>` convention).
- `useSuiteApps.ts` — hydrates the manifest from `GET /auth/apps` (registry over static fallback) and calls `setLiveApps`.
- `fetchCapabilities.ts` — fetches + caches an app's `CapabilityDoc` (evicts failed/empty results so a transient outage doesn't permanently disable a command widget).
- `dispatch.ts` — `runCommand(app, cap, body)`: edge-proxied fetch + `invalidate(...cap.invalidates)` on success.

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
  mirrors the registry origins for cross-origin calls (`SHELL_URL` is always included).

## The command vocabulary (actionable widgets)

The declarative widget engine (`apps/ordeck/src/hud/`) gains a write family — additive
`WidgetNode` variants `form`/`input`/`select`/`toggle`/`button`, a `CommandRef` (app +
capability + body bindings), and a `$form` source the renderer injects into scope so
`{ src: '$form', path: 'title' }` resolves like any binding. The final request body is
`{ ...resolve(cmd.body), ...$formValues }`. A single `runCommand(app, cap, body)` in
`@jkos/weave` does fetch + `invalidate(...cap.invalidates)`; ORDECK wraps it with a small
`useCommand` loading/error hook. The `COMPONENT_REGISTRY` escape hatch remains for the
genuinely bespoke. Because it is all pure data, the Workshop composes it and an AI can emit it.

## Deferred (designed seams, un-defer triggers)

- **Runtime `app_registry` CRUD** (+ `_cachedAppOrigins` bust) — when apps are added without
  a deploy (dynamic plugins / third-party registration).
- **Delete `@jkos/types`** — when a grep of its types is clean across `apps/*` (excl. `plugins/`).
- **Extract the jkAuth directory into its own service** — when it needs different network
  exposure than the token-signing core, or auth latency degrades.
