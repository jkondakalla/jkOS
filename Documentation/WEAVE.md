# jkOS — Weave

**The spec you implement app #9 from.**

Every claim below was re-read in source on 2026-08-26. Where the code and this document
disagree, the code wins and this document is wrong — fix it here the same hour.

---

## 1 · What Weave is for

Each app is built by a fresh agent that has not read the others. Weave exists so that
agent can **decide its own internals freely, as long as its declared inputs and
outputs stay consistent suite-wide.** The declaration is what the *next* agent reads
instead of reading your source.

Three consequences, each of which gets assumed backwards:

- **Weave is a dev-time contract boundary, not a runtime message bus.** Near-zero
  cross-app calls in production is the **expected steady state**, not a defect. Never
  measure Weave by traffic, and never build a probe asking "is anything consuming this
  contract?" — the only way to satisfy it is to invent consumers.
- **A defect is anything that hands a fresh agent wrong or incomplete information.** An
  app serving 30 routes and declaring 8 is broken *even if all 30 work*: the other 22 are
  invisible to everyone who comes after.
- **Two apps with identical tables are not a call for shared code.** PapyrOS and KourOS
  have field-for-field identical `history` tables, invented independently. The fix is a
  **common declared shape** Weave can fan a query over and merge — independent
  implementation, consistent outputs. Each app stays authoritative about itself.

Weave is also the shared backend code (`@jkos/weave/server`) that makes conforming cheap.
Use the helpers; hand-rolling is exactly what drifted before they existed.

---

## 2 · The declaration model

An app publishes two documents about itself. jkAuth's `app_registry` stores only *where*
to find them, never their contents — so a write surface changes with no central edit, and
a malformed declaration's blast radius stays inside one app.

| Document | Answers | Served at | TS shape |
|---|---|---|---|
| **CapabilityDoc** | what can be **DONE** to this app | `GET <apiBase>/capabilities` | `weave/src/capability.ts` |
| **DatasetDoc** | what can be **READ** from it | `GET <apiBase>/datasets` | `weave/src/dataset.ts` |

Both share one envelope — `{ app, version, <list>[] }`, every entry with a string `id` —
validated by the single rule in `weave/src/shared/docShape.js`. Producer throws at boot
(`serveCapabilities`/`serveDatasets`); consumer evicts on read
(`fetchCapabilities`/`fetchDatasets`). One rule, two enforcement points.

⚠️ **`docShape.js` is ESM, not CommonJS.** Vite bundles its named exports for the
browser; no-bundler Node backends `require()` it through Node's `require(ESM)` interop
(fine on the deployed node:20-slim). A `module.exports` form **breaks the rollup build**,
which cannot name-import a workspace CJS module. Do not "fix" it.

**Typed studs.** A `CapabilityDef` declares a typed `body` (input) **and a typed
`returns`** (output); a `DatasetDef` declares a typed `item` row. That symmetry is the
point — a GUI or an AI composer wires one primitive's result into the next without reading
source. `ref: 'beigeboard.items'` says a field *is a task*, not a string. `json` is the
opaque **escape hatch**: legal, but nothing can snap onto a blob.

**Declared == enforced, for reads.** A `FilterField` carries its enforcement mapping
(`column`/`op`) next to its public `name`/`type`/`label`; `filterSpec()` projects that into
the spec `buildItemFilters()` turns into bound SQL. **The declaration is the source; the
SQL derives from it.** A filter with no `op` means the SQL was hand-written elsewhere — a
drift surface. Operators: `eq`, `gt` (the `since` cursor), `prefix` (LIKE, metacharacters
escaped), `tags` (JSON-array membership). Values are always bound.

**`defineCollection` — one spec, no drift.** (`server/collection.js`, subpath
`@jkos/weave/collection`, zero deps.) One typed field list expands into the table DDL +
delta triggers, the typed create/update/delete capabilities, the dataset and its filters,
the column⇄wire transforms, and `.mount(router, db)` for owner-scoped CRUD. Table, routes
and served docs cannot disagree because they are one object. `pnpm new-app`'s backend is a
`defineCollection` plus a `.mount`; BeigeBoard is the fuller reference.

Siblings in `@jkos/weave/server`: `defineConnector` (an external API as a peer, secret
server-side), `defineLibraryScanner` (media folder → SQLite catalog), `defineMediaRoutes` +
`decidePlayback` (range streaming, direct→remux→re-encode), `serveSpa` (⚠️ entry document
`no-cache`, missing asset 404s rather than being answered with HTML — that pairing is what
made staging a blank page at 200 on 2026-08-17).

**The trigger engine — the write half of the widget factory.**
`createTriggerEngine`/`resolveBindings`/`validateTriggerTypes`/`triggerWebhook`/
`serverDispatch` express "**WHEN** a capability fires → **DO** another", each DO body slot a
literal or a `{from:'field'}` binding into the event payload. **It has no consumers today
and must not be deleted.** `WidgetSpec` binds a dataset into a primitive tree (read);
`TriggerDef` binds a capability's typed output into another's body (write) — two halves of
one system that never met, and converging them on one binding model is the spec the widget
factory is built from.

---

## 3 · The contract rules

✅ **Decided 2026-08-26.** Rulings, not options. Bias: standardization over flexibility,
and the future-oriented option over the locally cheaper one.

### 3.1 Async results — `resolves` alongside `returns`

A capability declares **`resolves`** alongside **`returns`**.

- **`returns`** describes the HTTP response — for an async capability, a job handle.
- **`resolves`** describes **what the work eventually produces**.
- **`validateTriggerTypes` binds against `resolves`, never `returns`.**
- **Job completion is itself a trigger event.**
- **Any capability declaring `returns: JOB_HANDLE` MUST declare `resolves`.**

⚠️ Every LazurOS capability declares `returns: JOB_HANDLE` — correct for the HTTP
response, useless for composition. Without this rule `validateTriggerTypes` cheerfully
type-checks a job handle into a task title, and the binding vocabulary the widget factory
rests on inherits the hole.

*Decided 2026-08-26; `resolves` is not yet in `capability.ts` and the probe lands in Stage E.*

### 3.2 Pagination — the `since` cursor only

**One primitive: the `since` cursor** (`op: 'gt'` over `updated_at`, stamped by the
collection's delta triggers on insert *and* update).

- **No `offset`** — unstable under concurrent writes, and this suite has a cursor
  precisely because that mattered once.
- **`limit` gets one suite-wide default and maximum, in one shared constant.**
- **Every dataset read accepts both.**

⚠️ Today there are four hand-rolled clamps and no shared constant.
`apps/kouros/backend/src/routes/browse.js` uses `clampLimit(limit, 120, 600)` **and**
`clampLimit(limit, 300, 2000)` — *and paginates with `offset`*;
`apps/jkauth/src/routes/weave.js` `Math.min(limit || 50, 200)`;
`apps/beigeboard/backend/src/library.js` `Math.min(2000, max(1, limit || 500))`.
**You cannot merge a fan-out across apps whose pages have inconsistent bounds**, which is
why this blocks the activity contract rather than being tidy-up.

*Decided 2026-08-26; the shared constant and the probe land in Stage E.*

### 3.3 Declaration versioning — fail closed

A consumer reading a **`version` higher than it knows fails closed with a named code.**
Never silently degrades, never guesses at a field. **A declaration is a contract, and a
consumer that half-understands one is worse than a consumer that refuses.**

The code belongs in the single vocabulary at `packages/auth-middleware/codes.js`
(mirrored in jkos-deploy's `jkos_auth.py`; `pnpm test:contracts` asserts the two stay
key-for-key equal) — `DECLARATION_VERSION_UNSUPPORTED`.

⚠️ Today `docShape.js` checks only `typeof doc.version === 'number'` and **nothing
anywhere reads the value.**

*Decided 2026-08-26; the code and the probe land in Stage E.*

### 3.4 Peer-down and idempotency

- **A fan-out always returns an explicit per-app status list alongside the merged data.**
  A partial result must be **visibly partial**, never silently short.
- **Every write capability accepts an optional idempotency key, and the trigger engine
  always sends one**, so a retried DO cannot double-write.

⚠️ The current shape is the one this forbids: `weaveClient(app).list()` returns `[]` on
*any* miss — unknown dataset, non-2xx, thrown fetch — so "the peer is down" and "the peer
has no rows" are the same value to the caller.

*Decided 2026-08-26; the probe lands in Stage E.*

---

## 4 · Building app #9 — the complete checklist

The audit question: *could a fresh agent build app #9 from this document plus the
`new-app` template alone?* Before 2026-08-26: **it would weave in correctly and then fail
roughly six gates**, because the doc covered *integration* and the gates enforce
*conformance*.

⚠️ **Most of this suite's gates do not discover you.** `check:auth`, `check:async-view`
and `check:fields` hold **hand-written per-app tables**; `pnpm test:contracts` is a
hand-written chain of `pnpm --filter` calls; the prober's `BACKEND_DOCS` is a hand-written
list. An app that skips those steps does not *fail* the gate — it is **silently absent
from it**, which is worse. You enlist; the gate does not find you.

### Step 0 — run the scaffolder

```
pnpm new-app <id> [--name "Display Name"] [--port 3010]
pnpm install
```

`scripts/new-app.mjs` does each of the following — every one a step you would otherwise
have to know about:

- writes `apps/<id>/` — backend on `@jkos/weave/server` over one `defineCollection`,
  frontend on `@jkos/{auth-client,design,ui}`, Dockerfile, both compose files;
- **registers the app in `packages/suite-manifest/apps.js`**, the one source the jkAuth
  registry seed, Weave's `SUITE_APPS`, the nginx tables and the prober topology derive from;
- **adds the id to the `APP_IDS` literal tuple in `apps.d.ts`** — a `.d.ts` cannot derive
  literals from CJS, so the tuple is hand-written and the weave test asserts it matches the
  runtime `APPS` ids exactly, in order;
- adds the compose include to the root `docker-compose.yml`;
- regenerates all four nginx includes from `edge:'standard'` — the peer routes
  (`weave-proxy{,-staging}.conf`) **and** your prod server block + admin-gated staging
  subpath (`apps-generated{,-staging}.conf`). You do not hand-edit `standalone.conf`.
- validates the emitted discovery docs with the suite's own `checkDocShape`.

⚠️ **nginx confs are bind-mounts. RESTART nginx — `reload` will not re-read a replaced
inode.** The app id **is** the edge slug, the scope namespace (`<id>:write`) and the
invalidation bus-key prefix (`<id>.<resource>`), all derived. Never re-type the slug.

### Step 1 — the registry row, and when you need a migration

`seedAppRegistry()` runs on **every** jkAuth boot and inserts any missing row, so a
**brand-new** app id gets its `app_registry` row at the next restart with no migration.

⚠️ **It only ever INSERTs. It never UPDATEs.** The moment you change an already-seeded
app's `api_base`, `health_path`, `capabilities_path`, `datasets_path`, `name`, `origin`,
`allowed_roles` or `ai`, **the deployed database keeps the old values forever unless you
write a migration.** That is why migrations 012 (weave metadata), 013 (`datasets_path`)
and 014 (BeigeBoard's `/api/bb` → `/api/beigeboard` rename) exist, and **015** is the
precedent for inserting a late-arriving app (LazurOS) by hand. Every one pulls its values
from `registrySeed()` rather than re-typing them, so the migration cannot drift from the
source. Do the same.

`getAppOrigins()` and `roleClaims()` cache for the process lifetime: **a registry change
needs a jkAuth restart**, not just a redeploy of your app.

### Step 2 — a smoke test, chained into the gate

Write `apps/<id>/backend/test/*.smoke.mjs` that boots the **real** server on a throwaway
port with a temp SQLite DB, then **add `&& pnpm --filter @jkos/<id>-backend test` to the
root `test:contracts` script.** Nothing does this for you; an app that skips it ships with
no coverage and never joins the gate.

⚠️ **Claim your port in `TEST_PORTS`** (`packages/suite-manifest/apps.js`) — the
single-source registry covering service *and* test ports. `portTable()` throws at load on
a duplicate claim, and the prober's `port-registry` probe holds every smoke's
`const PORT = <n>` literal to its claim, so the table and the files cannot drift. It
exists because three holes once lined up to run eight BeigeBoard/PapyrOS assertions green
**against a KourOS server** (3991/3992 were each claimed twice). And assert
`body.service === '<your id>'` in your harness's `waitForHealth()` — the uniform health
payload already carries the app id, and the check that would have caught this is one field
away. If your test picks a *random* port instead, keep the band clear of 3980–3996 — the
registry cannot protect against a random range that overlaps it.

### Step 3 — enlist in the prober

Add a row to `BACKEND_DOCS` in `packages/suite-prober/src/sources.mjs` pointing at your
`backend/discovery.js`, `exported: true`. Without it `capability-completeness` never sees
your declarations — you are not failing the probe, you are **invisible to it**. Keep
`discovery.js` pure data with zero side effects (no env, no DB, no network) so the
prober, a workshop GUI or an AI composer can `require()` it offline.

### Step 4 — frontend conformance

- **`useAuth` is a thin re-export** of `@jkos/auth-client`'s `useAuthProvider` — no local
  `useState`/`useEffect`/`createContext`. Three apps held byte-identical copies of the
  refresh sequence; drop the middle `refreshToken` step in one and that app silently signs
  out every returning user whose access token lapsed while the tab was shut. **Add
  `apps/<id>/src/hooks/useAuth.ts` to the table in `test/auth-single-source.mjs`.**
- **Every rendered input goes through `.jk-field`** (`type="hidden"` is the only
  exemption). Five app-local dialects existed and **not one reset `appearance`**, so under
  every hand-drawn hairline the engine kept painting its own control. **Add `apps/<id>/src`
  to `SCAN_ROOTS` in `test/fields.mjs`** — that gate scans eight named roots, not the repo.
- **The loading/error/empty triad goes through `<AsyncView>`** from `@jkos/ui`, never a
  fourth hand-rolled ternary. `test/async-view.mjs` names PapyrOS files only; add yours.
- **Call `injectJkOSTheme({})`** before React hydrates, setting `data-mode` from the cached
  preference first so there is no flash. The template does both.
- **Define a `typecheck` script.** `pnpm typecheck` is `turbo run typecheck`, which
  **silently skips** any package lacking one and still reports success — invisible by
  construction. The template ships `tsc -b`.

### Step 5 — the image and the environment

`pnpm check:docker` **does** auto-discover `apps/*/Dockerfile`. Three logged traps:

- A Dockerfile with `COPY . .` followed by a frontend build **MUST run `pnpm install`
  between the two.** `inject-workspace-packages=true` hardlink-*copies* peer-declaring
  workspace deps into the consumer's store; the cached manifest-only layer freezes each
  copy with no `src/`, so `tsc -b` dies with `TS2307 Cannot find module '@jkos/weave'`.
- The **deploy bundle must be closed under workspace deps** — every package `pnpm deploy`
  pulls in needs its source copied in *before* the deploy runs, or it lands in `/out` as a
  bare `package.json` and the container crash-loops with `MODULE_NOT_FOUND` at boot.
- **No orphan `backend/Dockerfile`** shadowing the real root-context build.

Document **every** `process.env.*` your backend reads in `.env.example` and pass it in both
compose files. A secret-shaped var read by code and provisioned nowhere is the
`CALENDAR_ENC_KEY` class: BeigeBoard encrypted OAuth refresh tokens with a key that
appeared in no `.env.example` and no compose file, so in every real deployment it was unset
and the secrets sat in plaintext, silently. `env-conformance` reports this — but only for
the three backends in its `BACKENDS` table, so **add yours**.

### Step 6 — deploy

DNS for `<id>.jkos.net` in Cloudflare · deploy · **restart nginx**. The staging and prod
host checkouts are separate clones and `.env` is gitignored, so it will not exist there on
first deploy; `lib-deploy.sh` scaffolds a blank one from `.env.example` so the stack still
comes up, but there are no real secrets until someone SSHes in and fills it. Verify with
`pnpm test:contracts`.

---

## 5 · The obligation table, derived from the gates

One authority. Each obligation names its mechanism **and the gate that enforces it**.
Three qualifiers, all load-bearing: **`pnpm prove` exits non-zero only on `drift`**, so a
probe reporting `gap` is advisory — real information, no teeth; **†** marks a gate holding
a hand-written per-app list you must **enlist** in (§4); **owed** means decided, unbuilt.

| # | Obligation | Mechanism | Enforced by |
|---|---|---|---|
| 1 | Directory presence | one `@jkos/suite-manifest` `APPS` row | `prove` `app-list-parity` + `registry-manifest-fields` (**drift**) |
| 2 | Edge slug == app id | derived | `prove` `slug-vs-id` (**drift**) |
| 3 | Edge reachability | `edge:'standard'` → generated nginx | `check:nginx` (**fails**) + `nginx-coverage` (**drift**) |
| 4 | Identity | `weaveAuth(opts)` | **no gate** — runtime only (`exit(1)` in prod with no key) |
| 5 | Write authorization | `weaveWriteGate({scope})` | app smoke tests only |
| 6 | Scope namespace `<id>:verb` | `scopeFor(id, verb)` | `prove` `scope-identifier` (**drift**) |
| 7 | Cross-origin | `weaveCors(resolver)` | **unenforced** |
| 8 | Liveness | `healthHandler(service)` | `prove --live` `live-health` (**drift**, live only) |
| 9–10 | Capability + dataset declarations | `serveCapabilities`/`serveDatasets` | `docShape` throws at boot; `live-docshape` (**drift**, live) |
| 11–13 | Typed `returns` · no `json` escape · filters carry `column`/`op` | `defineCollection` gives all three free | `capability-completeness` (**gap — advisory**) |
| 14 | Invalidation keys derived | `resourceKey(app, resource)` | `prove` `invalidation-keys` (**drift**) |
| 15 | Discovery docs importable as data | `discovery.js` exports + a `BACKEND_DOCS` row | `sot-machine-readability` (**consolidate — advisory**) † |
| 16 | Discovered write round-trip works | the published contract drives the test | `pnpm roundtrip` (**fails**) — BeigeBoard only |
| 17 | Error codes from one vocabulary | `CODES`/`authError` | jkAuth `test:contracts` node↔python parity (**fails**) |
| 18 | `useAuth` is a thin re-export | `@jkos/auth-client` | `check:auth` (**fails**) † |
| 19 | Inputs through `.jk-field` | `@jkos/ui` + `hub.css` | `check:fields` (**fails**) † |
| 20 | Loading/error/empty via `<AsyncView>` | `@jkos/ui` | `check:async-view` (**fails**) † |
| 21 | Design-factory tokens | `injectJkOSTheme()` | `check:tokens`, `check:responsive`, `check:design` (**fail**) |
| 22 | A `typecheck` script | package.json | `prove` `typecheck-coverage` (**gap — advisory**) |
| 23 | Image builds; deploy bundle closed | root-context Dockerfile | `check:docker` (**fails**) — auto-discovers |
| 24 | Env reads provisioned | `.env.example` + both compose files | `env-conformance` (**gap — advisory**) † |
| 25 | No control bytes in text files | — | `check:text` (**fails**) — auto-discovers, git-wide |
| 26 | A smoke test in the gate | boot the real server | only if you chain it into `test:contracts` † |
| 27 | A unique service + test port | `TEST_PORTS` + `portTable()` in `@jkos/suite-manifest` | `portTable()` throws at load on a duplicate; `prove` `port-registry` (**drift**) holds file literals to claims |
| 28–31 | The four contract rules (§3.1–§3.4) | — | **owed — Stage E**, one probe each |
| 32 | Declared surface covers the mounted routes | — | **owed — Stage E.** `capability-completeness` audits the *typing* of what is declared and never asks whether the declaration covers the code. Would flag today: BeigeBoard 30 routes / 8 declared paths, KourOS 11 undeclared reads, PapyrOS ~6 |

---

## 6 · The server half

**1 · Browser → peer: same-origin everywhere.** Every prod server block includes
`infra/nginx/weave-proxy.conf` — generated `/api/<peer>/*` and `/health/<peer>` locations
for every registered peer. A page on any `*.jkos.net` origin calls `/api/beigeboard/…`
same-origin: the `jkos_token` cookie flows, there is no CORS surface to misconfigure, and
the peer still enforces its own JWT. Staging is one origin, so `weave-proxy-staging.conf`
holds the same locations behind an `auth_request` admin gate. Both generate from `peers()`
in `@jkos/suite-manifest`; `--check` exits 1 if either is stale.

**2 · Backend → peer: service tokens.** `weaveServerClient(appId,{actingUser?})` mints and
caches a service token from jkAuth's client-credentials grant (`POST /auth/token`),
presents it as `Authorization: Bearer`, coalesces concurrent mints into one round-trip and
refreshes once on a 401. Read/aggregate-capable by default.

**3 · Registry-driven CORS.** Deferred; promote only when a peer genuinely cannot be
nginx-proxied. Every suite peer is proxied today.

**Delegation (on-behalf-of).** A service token has no human `sub`, so a per-user write
would orphan rows and the gate rejects it with `NO_USER_CONTEXT`. A delegation-enrolled
client may mint a token carrying an `act` claim; `applyDelegation()` runs at the identity
chokepoint inside `weaveAuth` and rewrites the effective subject to the acting user
(keeping `svc:<id>` for audit), so every route writes per-user with no per-route change.
`act` sits inside the RS256 signature — the trust chain is the client secret plus jkAuth's
allow-list.

### Provisioning — ⚠️ set nowhere today

| Variable | Where | Effect |
|---|---|---|
| `JKOS_SERVICE_CLIENTS` | jkAuth | enables `POST /auth/token`. **Unset → 503** |
| `JKOS_DELEGATION_CLIENTS` | jkAuth | which clients may mint an `act` token |
| `JKOS_SERVICE_CLIENT_ID`/`_SECRET`, `JKOS_AUTH_URL` | each caller | inputs to `weaveServerClient` |
| `JKOS_APP_ID` | each resource app | turns on `aud` enforcement in `verifyOpts` |

⚠️ **`JKOS_SERVICE_CLIENTS` appears in no compose file** — a commented line in
`apps/jkauth/.env.example` and nothing else. So `weaveServerClient` throws on its first
call in **every deployed environment**, and the whole delegation seam with it. Landing it
plus a boot assertion — so an app that *declares* it needs a service client fails loudly
at startup rather than at the first delegated write — is **Stage D item 11**.

⚠️ **`JKOS_APP_ID` is set in no compose file either.** jkAuth computes and mints a
per-role `aud` from `app_registry.allowed_roles` and **nothing verifies it**, including
jkAuth. The mechanism is real and opt-in (`packages/auth-middleware/index.js` adds
`audience` to the verify options only when `appId` resolves); with one cookie for every
`*.jkos.net` host, this claim is the containment. Turning it on per service in both
compose files, with a boot assertion, is **Stage C7 / D11**. Until then do not write
"each app verifies its own id" anywhere — it does not.

**The token.** `jkos_token` (RS256) carries `azp` (which app the session was minted
through — provenance, logged in `auth_events`), `aud` (above), and `scope` (role-derived;
capabilities declare `scopes`, the resource app checks `token.scope ⊇ required`). The scope
check enforces only when `scope` is present, so tokens minted before Weave fall through to
the role gate rather than being rejected mid-session.

---

## 7 · Versioning, and what is still deferred

`CapabilityDoc.version` / `DatasetDoc.version` are numbers. **Bump on a breaking field
change** — a removed field, a renamed field, a type change, a newly-required body field. An
added optional field is not breaking. A consumer reading a version higher than it knows
**fails closed** (§3.3); until that code and probe land in Stage E, treat a bump as a
coordinated change and say so in the commit.

Two designed seams stay deferred, with their un-defer triggers: **transport 1 → 3**
(registry-driven CORS) when a peer genuinely cannot be nginx-proxied; and **runtime
`app_registry` CRUD** — plus a `_cachedAppOrigins` bust and dynamic nginx regeneration —
when apps must be added without a deploy. Today the registry changes only at boot, and both
the origin list and the per-role claims are process-lifetime caches.

---

*See also: `ARCHITECTURE.md` (system level) · `TESTING.md` (`pnpm test:contracts` in full) ·
`RESET.md` (the stage plan the owed items refer to) · `packages/suite-prober/README.md`.*
