# jkOS — ToDo

Working backlog of planned-but-not-yet-executed work. Each section is written to be
**self-contained** — a future agent (likely Claude Code) should be able to execute it
without re-deriving context. When a section is done, move it to a "Done" note in the
relevant `Documentation/*.md` and delete it here.

---

## 1. From developer SDK → non-technical-user lego-kit

**Status:** Layer A DONE (A1–A5, not committed); Layers B–D pending. **Architecture
owner:** Jag. **Implementation:** Claude Code. **Source analysis:**
[CONSOLIDATION.md](CONSOLIDATION.md) + the primitive/lego assessment (this section).
Conformance instrument: [../packages/suite-prober/](../packages/suite-prober/)
(`node packages/suite-prober/prove.mjs`; was **0 drift / 9 consolidate / 10 gap**, now
**0 drift / 3 consolidate / 10 gap / 21 ok** after Layer A — the single-source app
directory + bb→beigeboard canonicalization collapsed the SoT-scraping, slug-split, and
scope-split findings).

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

- [ ] **B1 · Promote the prober to a gate** `[Phase 0]` — add drift-level probes (slug≠id,
  registry↔manifest mismatch, bad `invalidates` prefix, a registered app with no nginx block,
  a non-id scope namespace) to [../packages/suite-prober/src/probes/](../packages/suite-prober/src/probes/);
  chain `node packages/suite-prober/prove.mjs` into `test:contracts`
  ([../package.json](../package.json)).
- [x] **B2 · Capability-completeness probe** — **DONE.**
  [../packages/suite-prober/src/probes/80-capability-completeness.mjs](../packages/suite-prober/src/probes/80-capability-completeness.mjs)
  flags any capability missing a typed `returns`, using the raw `json` escape hatch, and any
  dataset filter lacking its own `column`/`op` (the single-source check). Inspects the IMPORTED
  declarations (depends on A3). Findings are gap/ok only (never drift) — `importItems` +
  `breakdownGoal` surface as honest `json`-escape gaps. Wired via the auto-loading probes dir;
  `prove.mjs` is chained into `test:contracts` by **B1** (still pending). Makes "is this
  primitive lego-ready?" re-runnable.

**DoD (B):** a malformed app-add (or an incomplete capability) fails `pnpm test:contracts` red
with a precise message.

### Layer C — Generation: one command builds a correct, fully-typed app  ·  ← depends on A

- [ ] **C1 · `pnpm new-app <id>` scaffolder** `[Phase 2]` — from an `APPS` entry, emit a backend
  wired with the existing `@jkos/weave/server` helpers
  ([../packages/weave/src/server/index.js](../packages/weave/src/server/index.js)), a frontend
  wired with `@jkos/{auth-client,design,ui}`, a root-context `Dockerfile` + per-app compose files
  (matching the `include:` pattern in [../docker-compose.yml](../docker-compose.yml)), and the
  `APPS` entry. Emitted capabilities are Layer-A-conformant (typed `returns`, no raw json);
  validated by existing `checkDocShape`
  ([../packages/weave/src/shared/docShape.js](../packages/weave/src/shared/docShape.js)).
  BeigeBoard stays the **reference app**.
- [ ] **C2 · Generate nginx server blocks** — extend
  [../infra/nginx/gen-nginx-weave.mjs](../infra/nginx/gen-nginx-weave.mjs) to also emit per-app
  `standalone.conf` server blocks from `APPS` (removes the last hand-written nginx step).

**DoD (C):** `pnpm new-app demo` → boots, `/health/demo` responds, appears in `GET /auth/apps`,
shows in the ORDECK launcher with zero portal edits, gate passes; nginx validates in a throwaway
container (`validate_nginx` in [../infra/scripts/lib-deploy.sh](../infra/scripts/lib-deploy.sh));
then remove `demo`.

### Layer D — New primitive TYPES: the missing bricks  ·  ← roadmap, Jag's trigger

Captured but intentionally lighter than A–C (near-term focus is the clean build). Each becomes
*user-grade* only because it inherits Layer A's typed, self-describing contract.

- [ ] **D1 · Collection primitive** `[F3]` — define a data type → auto-generate storage + typed
  CRUD capabilities + a dataset. The backbone for "users create custom apps" *without* a backend
  (today every app hand-rolls a SQLite table + routes + docs).
- [ ] **D2 · Connector primitive** `[F2,G2]` — a uniform way to wrap an external API/device as a
  peer that serves capabilities/datasets. Today Google/Outlook/iCloud/LazurOS are bespoke backend
  code; a user can connect nothing. This is the literal "connect third-party software and devices"
  goal.
- [ ] **D3 · Trigger/automation primitive** `[F1,G1]` — un-defer the cross-app event bus
  ([WEAVE.md:190-204](WEAVE.md)) so "**WHEN** x happens **→ DO** y" is expressible. Needs **G1**
  on-behalf-of delegation (lifts `weaveServerClient`'s `NO_USER_CONTEXT`,
  [../packages/weave/src/server/writeGate.js](../packages/weave/src/server/writeGate.js)) for
  per-user writes. The keystone for apps that *cleanly work together*.
- [ ] **F4 · Reference types + flow** — threads through A4 and D1–D3: typed studs (a field that
  references another primitive's output) so legos connect *to each other*, not just into a card.

### Sequencing & priority

1. **Now (clean build):** Layer A → Layer B. Upgrades existing primitives into typed,
   safely-composable studs and makes correctness self-enforcing.
2. **Next:** Layer C (depends on A's contract).
3. **Roadmap (Jag's trigger):** Layer D in goal order — D1 (users make apps) → D2 (third-party)
   → D3 (automation). Layer A is the prerequisite that makes each D-brick user-grade.

### Definition of done (program)

- [~] `pnpm test:contracts` green (Node halves ✓; Python half needs `python-jose` in the env);
  prober: **0 drift**, `beigeboard` `slug==id: ok`, every capability with a typed `returns` ✅.
  (Prober not yet *chained* into `test:contracts` — that's **B1**.)
- [x] One `APPS` field edit propagates to registry seed + `SUITE_APPS` + `weave-proxy*.conf`;
  `gen-nginx-weave.mjs --check` green.
- [ ] `pnpm new-app demo` end-to-end (boots, discoverable, gate-green), then removed.
- [x] `grep -rn '/api/bb\|bb\.items'` returns only historical doc mentions (migrations 012–014,
  probe-comment examples) + JS property access; `sylib` untouched.
