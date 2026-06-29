# jkOS — ToDo

Working backlog of planned-but-not-yet-executed work. Each section is written to be
**self-contained** — a future agent (likely Claude Code) should be able to execute it
without re-deriving context. When a section is done, move it to a "Done" note in the
relevant `Documentation/*.md` and delete it here.

---

## 1. From developer SDK → non-technical-user lego-kit

**Status:** Layers A–D DONE (A1–A5, B1–B2, C1–C2, D1–D3 + F4). The program is complete:
typed self-describing contract → self-enforcing gate → one-command scaffold → the three
new brick TYPES (collection / connector / trigger) that inherit it.
**Architecture owner:** Jag. **Implementation:** Claude Code. **Source analysis:**
[CONSOLIDATION.md](CONSOLIDATION.md) + the primitive/lego assessment (this section).
Conformance instrument: [../packages/suite-prober/](../packages/suite-prober/)
(`pnpm prove`; was **0 drift / 9 consolidate / 10 gap**, then **0 drift / 3 consolidate
/ 10 gap / 21 ok** after Layer A; now **0 drift / 3 / 10 / 25 ok** after B1 added the
nginx-coverage probe — and it is **chained into `pnpm test:contracts`**, so drift fails CI).

### Why this is ONE program (not two)

The **end goal** of jkOS: a set of primitives that lets non-technical users build custom apps
that cleanly work together and connect third-party software/devices — used **like legos**.
Two tracks that looked separate are the same problem from outside vs inside:

- **Track A — the container:** make *adding an app* trivial (one descriptor → derive → gate
  → scaffold). Was the old "make future apps trivial to add."
- **Track B — the contents:** make the backend *primitives* into typed, self-describing legos.

They share **one spine: a typed, importable, self-describing data contract + one conformance
gate + one scaffolder.** "Add an app" and "compose a primitive" are the same act at different
scales.

**The unlock that ties it together:** non-technical users will never hand-author specs — they
compose via the Workshop GUI or by describing intent to an AI ("an AI can emit the same shape"
recurs through the code). So **lego-ready ≡ every primitive is fully typed + self-describing +
importable, so a GUI/AI can snap them together safely.** That single property is what Track A's
"descriptor as data" and Track B's "typed capability I/O" are both really chasing.

**Where the stack stands today (the honest read):** the *display/read* half is already
lego-grade — the `WidgetNode` vocabulary ([../apps/ordeck/src/hud/types.ts](../apps/ordeck/src/hud/types.ts)),
the declarative capability/dataset contract, `Binding`, one read path (`useWeaveList`) + one
write path (`runCommand`). The gaps are (1) the contract isn't *complete* (no typed outputs,
ad-hoc field vocab, free-string keys, scraped-not-imported docs) and (2) whole *brick types*
are missing (triggers, connectors, user-definable collections). Layers A–C close (1); Layer D
is (2).

### Decisions already made (do NOT re-litigate)

- **Full canonicalization** — the app **id is the only identifier**; `apiBase`/`healthPath`/bus
  key/scope all derive from it. The slug concept is eliminated.
- **Foundation-first** — Layers A + B now (the "build the current stack cleanly" work), then C;
  Layer D is roadmap, triggered per goal.
- **`sylib`→`sylibos` is DEFERRED** — only `bb`→`beigeboard` happens now (see constraints).

### ⚠️ Hard constraints a cold agent MUST know before touching anything

- **Do NOT edit `apps/sylibos/`.** SylibOS is out of suite scope and off-limits until Jag says
  otherwise. So canonicalization does **`bb`→`beigeboard` only**; leave every `sylib`/`sylibos`
  reference (incl. in shared files like manifest/nginx/registry) untouched so they stay
  consistent with the un-migrated app. Revisit only when Jag includes SylibOS.
- **Suite scope = BeigeBoard / jkAuth / jkDeploy / ORDECK / Weave only.** Skip lazuros + sylibos.
- **Docker builds from the repo ROOT context** so `@jkos/*` source-only packages resolve.
  Per-app context breaks shared-package resolution. Shared packages have **no build step**.
- **nginx confs are bind-mounts → RESTART, not reload.** `weave-proxy.conf` +
  `weave-proxy-staging.conf` are **generated** ([../infra/nginx/gen-nginx-weave.mjs](../infra/nginx/gen-nginx-weave.mjs))
  — never hand-edit; run the script, then `--check`.
- **Prod deploy runs `MANAGE_NGINX=0`** ([../infra/scripts/lib-deploy.sh](../infra/scripts/lib-deploy.sh))
  — a new app's server block / proxy blocks are **inert in prod until nginx is manually restarted**.
- **Editing `packages/weave` locally:** pnpm copies it into `.pnpm` — run `pnpm install` after
  editing the package or dev consumers won't see the change.
- **The contract gate must stay green:** `pnpm test:contracts` ([../package.json](../package.json)).
  Its Python half needs `python-jose` (the runtime behind the numeric-`sub` 401 loop).

### Tag legend

`[C#]` = [CONSOLIDATION.md](CONSOLIDATION.md) finding · `[P#]` = lego-polish item ·
`[F#]` = missing brick · `[G#]` = old appendix item now folded in.

---

### Layer A — Foundation: one typed, self-describing contract  ·  ← near-term "clean build"

The shared spine. This is where Track A and Track B actually merge. Do this first; Layer B
verifies it; Layers C/D build on it.

- [x] **A1 · Canonical app identity** `[C1]` — **DONE.** The edge slug is now the app id:
  `apiBase`/`healthPath`/`capabilitiesPath`/`datasetsPath` derive from `id`, the bus key is
  `resourceKey(id,resource)`, and scopes namespace on `id`. Canonicalized **`bb`→`beigeboard`
  only** (SylibOS `sylib` pinned/untouched — off-limits). Edits:
  [../apps/beigeboard/backend/discovery.js](../apps/beigeboard/backend/discovery.js)
  (`invalidates` now `[ITEMS_KEY]` via `resourceKey`), nginx regenerated from
  [../infra/nginx/gen-nginx-weave.mjs](../infra/nginx/gen-nginx-weave.mjs)
  (`/api/beigeboard/`, `/health/beigeboard`; `standalone.conf` needed no edit — the slug lived
  only in the generated `weave-proxy*.conf`), weave doc-comments, and ORDECK
  ([bb.ts](../apps/ordeck/src/lib/bb.ts) + `useHudData.ts` use `apiBase('beigeboard')` /
  `resourceKey`; the rest were comments). Container `bb-app` left as-is (upstream address, not
  an identifier).
- [x] **A2 · One app descriptor as data** `[C2,C3]` — **DONE.** New
  [../packages/suite-manifest/](../packages/suite-manifest/) (zero-dep CJS) exports `APPS` (one
  row/app: `id`,`name`,`origin`,`allowedRoles`,`upstream`=container:port — the *only* stored
  infra field, `health`/`api`/`capabilities`/`datasets`/`ai` flags, `registry:false` for
  LazurOS) + derivation helpers + view builders `registrySeed()`/`manifestApps()`/`peers()`.
  The registry seed ([../apps/jkauth/src/db.js](../apps/jkauth/src/db.js), + migration 014 to
  canonicalize existing rows), `SUITE_APPS`
  ([../packages/weave/src/manifest.ts](../packages/weave/src/manifest.ts)), nginx `PEERS`, AND
  the prober all **derive** from `APPS` via the SAME builders. `check:nginx` guards the
  generated chain (closes **C5**). SylibOS keeps a pinned `apiBase` override (un-migrated slug).
- [x] **A3 · Discovery docs as importable data** `[C3,P4,G2]` — **DONE.** BeigeBoard's
  `CAPABILITIES`/`DATASETS` moved out of inline `const`s into
  [../apps/beigeboard/backend/discovery.js](../apps/beigeboard/backend/discovery.js) (pure data,
  zero deps so offline tooling can `require()` it); `server.js` imports + serves them. The
  prober now imports the real objects instead of scraping JS (`sot-machine-readability` → ok).
  **G2 closed**: the AI endpoints (`/api/ai/parse-task`, `/api/ai/breakdown`) are now the
  declared `parseTask` / `breakdownGoal` capabilities (discoverable + invokable through Weave).
- [x] **A4 · Complete the primitive I/O contract** `[P1,P2,P3,F4-seed]` — **DONE**, in
  [../packages/weave/src/capability.ts](../packages/weave/src/capability.ts) /
  [../packages/weave/src/dataset.ts](../packages/weave/src/dataset.ts):
  - typed capability **`returns`** shape (mirror dataset `item`) — every BeigeBoard capability
    now declares its OUTPUT stud; `createItem`/`completeItem` reuse the shared `ITEM_SHAPE` so
    a capability's output IS provably the `beigeboard.items` row `[P1]`; `doc` field also typed;
  - `FieldType` extended with `json` (the typed escape hatch, used by `importItems`) and `ref`
    (a typed stud: `BodyField.ref = '<app>.<dataset>'`, e.g. `beigeboard.items`) `[P2,F4-seed]`;
  - dataset `filters` are now the SINGLE source for the enforced spec — each `FilterField`
    carries its own `column`/`op`, and the server derives `ITEM_FILTER_SPEC` via the new
    `filterSpec()` helper (`@jkos/weave/server`), so declared-readable == actually-filtered `[P3]`.
- [x] **A5 · Derive `invalidates`** `[C4,P4]` — **DONE.** The bus key is computed by
  `resourceKey(id,resource)` (exported from `@jkos/suite-manifest`, re-exported via
  `@jkos/weave`), not a free string: BeigeBoard's `discovery.js` defines `ITEMS_KEY` once and
  both the capability + dataset reference it; ORDECK's `bb.ts`/`useHudData.ts` derive
  `BB_ITEMS = resourceKey('beigeboard','items')` for their `invalidate`/`invalidateOn`.
  (An *enforcing* validator that the three call sites agree is still ToDo **B1**.)

**DoD (A):** ✅ prober shows `beigeboard` as `slug==id: ok`, **0 drift**; ✅ one `APPS` edit
propagates to registry + `SUITE_APPS` + `weave-proxy*.conf` (all derive from the same builders;
`check:nginx` green); ✅ every capability declares typed `returns` (A4); the two remaining
`type:'json'` escapes (`importItems`/`breakdownGoal`) are honest gaps awaiting an array
FieldType (F4).

### Layer B — The gate: correctness self-enforces  ·  ← the feedback loop for AI/Claude

- [x] **B1 · Promote the prober to a gate** `[Phase 0]` — **DONE.** `prove.mjs` is now
  chained into `test:contracts` via a root `pnpm prove` script ([../package.json](../package.json)),
  so a `drift` finding exits non-zero and fails CI. Of the five drift conditions, four already
  emitted `drift` (slug-disagreement-across-sources `30`, registry↔manifest mismatch `40`, bad
  `invalidates` prefix `50`, non-id scope `60`); the missing one — **a registered app with no
  nginx block** — is the new probe
  [90-nginx-coverage.mjs](../packages/suite-prober/src/probes/90-nginx-coverage.mjs): an app
  that advertises an api/health surface but has no peer to route it is `drift` (the registry
  promises an endpoint the edge can't serve — e.g. an APPS row with `api:true` but no `upstream`).
  Verified: injecting such a row makes `pnpm prove` exit 1 with a precise message; the healthy
  suite stays 0 drift. (slug≠id stays `consolidate` not `drift` — SylibOS is intentionally
  `sylib`≠`sylibos` and off-limits, so a blanket slug≠id drift would wrongly fail the gate.)
- [x] **B2 · Capability-completeness probe** — **DONE.**
  [../packages/suite-prober/src/probes/80-capability-completeness.mjs](../packages/suite-prober/src/probes/80-capability-completeness.mjs)
  flags any capability missing a typed `returns`, using the raw `json` escape hatch, and any
  dataset filter lacking its own `column`/`op` (the single-source check). Inspects the IMPORTED
  declarations (depends on A3). Findings are gap/ok only (never drift) — `importItems` +
  `breakdownGoal` surface as honest `json`-escape gaps. Wired via the auto-loading probes dir;
  `prove.mjs` is chained into `test:contracts` by **B1** (still pending). Makes "is this
  primitive lego-ready?" re-runnable.

**DoD (B):** ✅ a malformed app-add fails `pnpm test:contracts` red with a precise message
(`prove` is the last link in the chain; an api/health surface with no nginx peer → `drift` →
exit 1). An *incomplete capability* (raw `json` escape / missing typed `returns`) still surfaces
as a `gap` via probe `80`, not a hard failure — that's deliberate (`importItems`/`breakdownGoal`
are honest `json` gaps awaiting the array FieldType, **F4**), so the gate stays green until F4.

### Layer C — Generation: one command builds a correct, fully-typed app  ·  ← depends on A

- [x] **C1 · `pnpm new-app <id>` scaffolder** `[Phase 2]` — **DONE.**
  [../scripts/new-app.mjs](../scripts/new-app.mjs) (+ [../scripts/templates/new-app/](../scripts/templates/new-app/),
  wired as `pnpm new-app`). From one `<id>` it: writes a backend wired with `@jkos/weave/server`
  (identity/write-gate/CORS/health/discovery/filters over one SQLite `items` collection), a
  frontend wired with `@jkos/{auth-client,design,ui}` (auth gate + `injectJkOSTheme` + items CRUD),
  a root-context `Dockerfile` + prod/staging compose files (matching the `include:` pattern), AND
  registers the app in the ONE source — `@jkos/suite-manifest` APPS — so the jkAuth registry seed,
  Weave's SUITE_APPS, the nginx peer proxy + server block, and the prober all derive from it (no
  portal edits). Emitted capabilities are Layer-A-conformant (typed `returns`, no raw json),
  validated in-script by `checkDocShape`. Also wires the root `docker-compose.yml` include and
  regenerates nginx; `--remove` cleanly reverses every mutation. BeigeBoard stays the **reference
  app**. Verified: `pnpm new-app demo` → registry/manifest/peers all carry `demo`, full gate green
  (0 drift), then `--remove` returns the tree byte-clean.
- [x] **C2 · Generate nginx server blocks** — **DONE.**
  [../infra/nginx/gen-nginx-weave.mjs](../infra/nginx/gen-nginx-weave.mjs) now also emits
  **apps-generated.conf** (full prod origin server block: HTTP→HTTPS redirect + HTTPS SPA-at-root,
  mirroring the BeigeBoard block) and **apps-generated-staging.conf** (the admin-gated `/<id>/`
  staging subpath, mirroring the `/beigeboard/` location) for every app that opts in with
  `edge:'standard'` in `APPS` (the new `edgeApps()` builder; the scaffolder sets the flag). The
  hand-tuned origins (portal, jkAuth, BeigeBoard, SylibOS, staging shell) set no `edge` and keep
  their bespoke blocks — the generator never rewrites them, so this is safe for the live config.
  Both files are `include`d unconditionally by `standalone.conf` (prod at http{} level, staging
  inside the staging server block) and are empty (header only) until the first `edge` app. Both
  are now mounted into the live nginx container ([../infra/nginx/docker-compose.yml](../infra/nginx/docker-compose.yml))
  **and** into `validate_nginx` ([../infra/scripts/lib-deploy.sh](../infra/scripts/lib-deploy.sh)) —
  without those mounts a deploy restart would reference a missing include and take the edge down.
  So for a standard app there is **no hand-written nginx step left**.

**DoD (C):** `pnpm new-app demo` →
  - ✅ appears in `GET /auth/apps` (registrySeed includes it) + the ORDECK launcher with zero
    portal edits (both derive from the APPS row); ✅ `/health/demo` + `/api/demo/*` peer routes
    and the demo origin server block all generated; ✅ full `pnpm test:contracts` green (Node
    halves + `check:nginx` + `prove`, 0 drift) with demo present; ✅ `--remove` reverts clean.
  - ⏳ **boots** and the throwaway-container `nginx -t` (`validate_nginx`) are deploy-time: this
    box has no host nginx and the user isn't in a docker group, so neither ran locally. The
    generated blocks are brace-balanced and byte-pattern-identical to the live BeigeBoard/staging
    blocks, and `validate_nginx` + the compose mounts are wired, so the deploy-time `nginx -t`
    covers it. A real boot needs `pnpm install` + the TrueNAS docker host.

### Layer D — New primitive TYPES: the missing bricks  ·  DONE 2026-06-27

Each new brick inherits Layer A's typed, self-describing contract, so a GUI/AI snaps them
together safely. All three are pure-data SPEC types + a factory that expands the spec into the
existing Layer-A primitives. Runtime in `@jkos/weave/server`; design-time TS shapes in
`packages/weave/src/{collection,connector,trigger}.ts`; **70-assertion** `test/lego.mjs` chained
into the weave test (so the gate covers them).

- [x] **D1 · Collection primitive** `[F3]` — **DONE.** `defineCollection(def)`
  ([../packages/weave/src/server/collection.js](../packages/weave/src/server/collection.js), lean
  subpath `@jkos/weave/collection`): ONE `CollectionDef` (a name + typed fields) → `.ddl()` (table +
  the weave delta triggers), typed create/update/delete `.capabilities` (each `returns` the row
  shape), the `.dataset` (filters carry their own column/op + the universal `since` cursor),
  `.coerce`/`.toRow`, and `.mount(router, db)` (owner-scoped CRUD). One spec → table + routes +
  discovery docs can't drift. **Dogfooded**: the scaffolder's backend is now a `defineCollection` +
  `ITEMS.mount(app, db)` (server.js/discovery.js templates), re-verified end-to-end (`pnpm new-app
  demo` → derived docs valid, gate 0 drift, `--remove` clean).
- [x] **D2 · Connector primitive** `[F2,G2]` — **DONE.** `defineConnector(def)`
  ([../packages/weave/src/server/connector.js](../packages/weave/src/server/connector.js), subpath
  `@jkos/weave/connector`): an upstream base + auth + an endpoint→contract mapping → `.capabilities`/
  `.datasets` are CLEAN Layer-A docs (the connected API is discovered/bound EXACTLY like a native
  app — the lego property) and `.mount(router, {fetch})` translates each call to the upstream
  server-side (secret stays off the browser). Tested against a mock upstream (nested-collection
  mapping, bearer auth, filter passthrough, action body mapping). G2 closed: external integrations
  are a spec, not a fork.
- [x] **D3 · Trigger/automation primitive** `[F1,G1]` — **DONE.** Cross-app "**WHEN** a capability
  fires **→ DO** another," as data. `createTriggerEngine({triggers,dispatch})` +
  `resolveBindings` + `triggerWebhook` + `serverDispatch`
  ([../packages/weave/src/server/trigger.js](../packages/weave/src/server/trigger.js)). **G1**
  un-deferred: jkAuth `signService` mints an `act` (on-behalf-of) claim for a delegation-enrolled
  client (`JKOS_DELEGATION_CLIENTS`, gated in `/auth/token`); `weaveAuth`/`applyDelegation`
  normalize it to the acting user and `weaveWriteGate` lifts `NO_USER_CONTEXT`
  ([../packages/weave/src/server/writeGate.js](../packages/weave/src/server/writeGate.js)), so a
  trigger does a per-user cross-app write AS the triggering user. Contract gate stayed green (no
  token-shape change by default; `act` only when delegating).
- [x] **F4 · Reference types + flow** — **DONE.** The `ref` FieldType (A4 seed) is now load-bearing:
  a trigger's DO body BINDS to the WHEN capability's typed `returns` (`{from:'<field>'}`), and
  `validateTriggerTypes` checks the studs fit (source type → target type, required-unbound, missing
  field). `defineCollection` fields accept `ref`/carry it into the row shape, so a collection row is
  a typed stud another lego (a trigger) snaps onto. The flow connects one lego's OUTPUT to the next's
  INPUT, not just into a card.

### Sequencing & priority

1. ~~**Now (clean build):** Layer A → Layer B.~~ **DONE** — typed self-describing contract +
   self-enforcing gate (`prove` chained into `test:contracts`).
2. ~~**Next:** Layer C.~~ **DONE** — `pnpm new-app <id>` emits a correct, fully-typed app and
   registers it in the one source; no hand-written nginx step left for a standard app.
3. ~~**Roadmap (Jag's trigger):** Layer D in goal order — D1 → D2 → D3.~~ **DONE 2026-06-27** —
   the three brick TYPES (collection / connector / trigger) + F4 typed flow + the G1 delegation
   seam, each inheriting Layer A's contract. `test/lego.mjs` (70 assertions) guards them.

### Definition of done (program)

- [x] `pnpm test:contracts` green (Node halves ✓ + `check:nginx` + `prove`; the jkAuth **Python**
  half still needs `python-jose` in the env — a pre-existing env gap, `CONTRACTS_SKIP_PYTHON=1`
  bypasses for local runs); prober: **0 drift**, `beigeboard` `slug==id: ok`, every capability
  with a typed `returns` ✅. Prober is now **chained** into `test:contracts` (B1).
- [x] One `APPS` field edit propagates to registry seed + `SUITE_APPS` + `weave-proxy*.conf`
  (+ `apps-generated*.conf` for `edge` apps); `gen-nginx-weave.mjs --check` green across all four.
- [x] `pnpm new-app demo` end-to-end: discoverable (registry/manifest/peers/server-block), full
  gate green (0 drift), then `--remove`d clean. (Container **boot** + throwaway `nginx -t` are
  deploy-time — see DoD (C); not runnable on this box.)
- [x] `grep -rn '/api/bb\|bb\.items'` returns only historical doc mentions (migrations 012–014,
  probe-comment examples) + JS property access; `sylib` untouched.
- [x] **Layer D**: `defineCollection` / `defineConnector` / the trigger engine each turn ONE pure-
  data spec into the Layer-A contract; `test/lego.mjs` (70 assertions) proves it incl. real-SQLite
  CRUD over a generated collection, a mock-upstream connector, the G1 write-gate lift, and the F4
  stud-fit check. The scaffolder dogfoods `defineCollection`. weave `tsc` clean; weave test 36 +
  lego 70; jkAuth contract gate green (Node).
