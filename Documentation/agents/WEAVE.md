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
- **Two apps with identical tables are not a call for shared code.** Two apps once
  had field-for-field identical `history` tables, invented independently. The fix is a
  **common declared shape** Weave can fan a query over and merge — independent
  implementation, consistent outputs. Each app stays authoritative about itself.

Weave is also the shared backend code (`@jkos/weave/server`) that makes conforming cheap.
Use the helpers; hand-rolling is exactly what drifted before they existed.

---

## 2 · The declaration model

An app publishes three documents about itself. jkAuth's `app_registry` stores only *where*
to find them, never their contents — so a write surface changes with no central edit, and
a malformed declaration's blast radius stays inside one app.

| Document | Answers | Served at | TS shape |
|---|---|---|---|
| **CapabilityDoc** | what can be **DONE** to this app | `GET <apiBase>/capabilities` | `weave/src/capability.ts` |
| **DatasetDoc** | what can be **READ** from it | `GET <apiBase>/datasets` | `weave/src/dataset.ts` |
| **ActivityDoc** | what the user **DID** here | `GET <apiBase>/activity` | `weave/src/shared/activity.d.ts` |

All three share one envelope — `{ app, version, <list>[] }`, every entry with a string `id`.
The first two are validated by the single rule in `weave/src/shared/docShape.js`; the third
by `weave/src/shared/activity.js`, which additionally checks the events. Producer throws at
boot (`serveCapabilities`/`serveDatasets`/`defineActivity`); consumer evicts on read
(`fetchCapabilities`/`fetchDatasets`/`fetchActivity`). One rule, two enforcement points.

⚠️ **The third is DATA, not a static declaration**, and that difference drives two things.
Its events change every time the user does anything, so `fetchActivity` **never caches**
where its two siblings cache for the life of the page. And it can only be validated
per-request — `defineActivity` checks the *declaration* at boot with an empty event list,
then checks its own answer before serving it.

### 2b · The ext_ref namespace (BB-5)

An `ext_ref` is `"<scheme>:<rest>"` — one opaque string saying "this thing lives at
scheme X with id Y". ⚠️ **Five incompatible schemes shared that one column and nothing
said so; the audit found three of the five.** An AI author reading the dataset docs
could not tell an external catalog id from a suite app's row from an app-private engine
identity, because the column's meaning lived in five source files and no document.

Three classes, allocated so they cannot collide:

| Class | The scheme is… | Example | Declared where |
|---|---|---|---|
| `suite` | a jkOS app id | `beigeboard:41` | `@jkos/suite-manifest` (implicit — never restated) |
| `external` | a third-party catalog | `itunes:1234567` | the writing app's `EXT_REFS` |
| `internal` | an app-private engine identity | `routine:24:2026-08-18` | the writing app's `EXT_REFS` |

Plus `RESERVED_SCHEMES` in `weave/src/shared/extref.js` for suite tooling that no app
owns — `prober:` today, the fifth scheme, which appeared in one file and one comment.

⚠️ **The scheme is the PROVIDER, not the connector.** KourOS's audiobook connector is `meta` and
it writes `itunes:` refs. `meta` says which of our doors the data came through;
`itunes` says whose id it is, and only the second makes the ref resolvable by anyone
else.

Each app declares its own schemes and projects them into its dataset's `ext_ref` field
via `extRefFieldDoc(EXT_REFS)`, so the prose a reader sees is *generated* from the
declaration and cannot drift from it. `pnpm check:refs` proves the allocation is
disjoint, that no source writes or matches an undeclared prefix, and that no declared
scheme is stale.

⚠️ **Why an allocation and not a reformat.** Re-prefixing everything as
`<app>:<scheme>:<id>` would make the first segment always an app id and need no table —
but it is a data migration of a UNIQUE-INDEXED column the routine engine's idempotency
depends on, plus `routines.cadence_skips`, which stores ref *suffixes*. It would look
tidier and tell a reader nothing the declaration does not.

### 2a · The activity contract (XC-2)

**⭐ Declare one shape; do not share an implementation.** Three apps keep a per-user record
of what happened, in four honest schemas: KourOS's `history` and `book_history`,
BeigeBoard's `started_at`/`completed_at` columns on `items`, LazurOS's `jobs` queue.

⚠️ **The first two are field-for-field identical and were invented independently, months
apart.** Read that as the finding rather than as sloppiness — neither author was careless.
The suite had no word for *"this app keeps a record of what the user did"*, so each one
coined a private one and nothing could notice.

The remedy is a **declared shape, not a shared table**. Each app keeps its own ledger, its
own indexes and its own purge story, and merely *answers* in the common shape; `defineActivity`
supplies the envelope and the validation, the app supplies the SQL. Weave fans the question
out and merges (`fetchActivity`). There is no central activity store and there must not be
one — a common table would have meant migrating BeigeBoard's two columns into a row, i.e.
replacing a truthful schema with a uniform one, and making every app's local change a
suite-wide migration.

The event is deliberately small: `id`, `kind` (from the app's own declared closed
vocabulary), `at`, `ref`, `label`, `ms`, `completed`.

- **`at` is the cross-app merge key and the merge is a STRING sort**, so it is held to the
  canonical millisecond-ISO format (XC-1) rather than merely parsed. A second-resolution
  stamp here re-introduces exactly the sort bug `wireTime.js` exists to stop.
- **`ms` means time ACTUALLY spent**, not elapsed wall-clock — one field, one meaning across
  four apps, which is the entire value of having a contract. BeigeBoard and LazurOS report
  `null` rather than a plausible-looking different number.
- **`completed` is tri-state.** `null` is a real answer — either the act has no notion of
  finishing (a BeigeBoard `start`) or it has not finished yet (a queued LazurOS job) — and
  both differ from `false`, which asserts it ran and did not complete.
- **`kinds` are per-app, never a suite-wide enum.** "Listened" and "trained" are different
  acts; flattening them into one vocabulary loses both questions.

Two payoffs, and the second is why it matters most here: *"what did
I do today"* becomes answerable across the suite (the ML corpus for the variance feature),
and **the same mechanism is the suite's action-audit trail**.

The `activity-conformance` prober probe holds the rule from both sides: an app with an
append-only per-user collection and no declaration is a **gap**; an app that declares one
without serving it, or that reaches into another app's source, is **drift**.

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

✅ **LANDED (D13/WV-5).** `resolves` sits on `CapabilityDef` beside `returns`; `validateTriggerTypes`
binds from it when present and refuses a handle binding. The PRESENCE of `resolves` is the async
declaration — there is no separate `async: true` to disagree with it. Held by `86-async-contract`,
which fails a bare-handle capability that declares no result **and one that re-declares the handle
AS the result** — the shape that would satisfy a naive check while reinstating the exact defect.

### 3.2 Pagination — the `since` cursor only

**One primitive: the `since` cursor** (`op: 'gt'` over `updated_at`, stamped by the
collection's delta triggers on insert *and* update).

- **No `offset`** — unstable under concurrent writes, and this suite has a cursor
  precisely because that mattered once.
- **`limit` gets one suite-wide default and maximum, in one shared constant.**
- **Every dataset read accepts both.**

⚠️ **As found:** FIVE hand-rolled clamps that disagreed — KourOS had two in one file, plus
jkAuth's, BeigeBoard's library at a 2000 ceiling, and LazurOS's queue claim.
**You cannot merge a fan-out across apps whose pages have inconsistent bounds**, which is
why this blocked the activity contract rather than being tidy-up.

✅ **LANDED (Stage E6).** One `PAGE_DEFAULT`/`PAGE_MAX`; an app may narrow the max, never widen
it. Held by `check:rulings`.

⚠️ **One deliberate, bounded exception:** KourOS's `/api/albums` browse still pages by `offset`.
The ruling's reason is instability under concurrent writes, and that browse is over a music
catalog that changes only on rescan with a stable `ORDER BY` — so the window is "during a library
scan". **The moment that catalog gains incremental writes** (a user-editable tag, a rating that
reorders) it becomes exactly the bug the ruling describes. Noted at the call site too.

### 3.3 Declaration versioning — fail closed

A consumer reading a **`version` higher than it knows fails closed with a named code.**
Never silently degrades, never guesses at a field. **A declaration is a contract, and a
consumer that half-understands one is worse than a consumer that refuses.**

The code belongs in the single vocabulary at `packages/auth-middleware/codes.js`
(mirrored in jkos-deploy's `jkos_auth.py`; `pnpm test:contracts` asserts the two stay
key-for-key equal) — `DECLARATION_VERSION_UNSUPPORTED`.

⚠️ **As found:** `docShape.js` checked only `typeof doc.version === 'number'` and **nothing
anywhere read the value.**

✅ **LANDED (Stage E6).** A doc whose `version` is newer than the consumer understands is refused
with `DOC_VERSION_UNSUPPORTED`. ⚠️ An **older** version still passes: failing closed means
refusing the future, not the past. Held by `check:rulings`.

### 3.4 Peer-down and idempotency

- **A fan-out always returns an explicit per-app status list alongside the merged data.**
  A partial result must be **visibly partial**, never silently short.
- **Every write capability accepts an optional idempotency key, and the trigger engine
  always sends one.** The engine's key is **DERIVED, never random**: the same trigger + the
  same event yields the same key even reserialised with its keys in another order, which is
  the only property that makes a retry *recognisable* as one. A random key satisfies "has a
  key" and defeats the entire mechanism.

✅ **The fan-out half LANDED (Stage E6)**, and is held by `check:rulings`. `weaveClient` used to
return `[]` on *any* miss — unknown dataset, non-2xx, thrown fetch — so "the peer is down" and
"the peer has no rows" were the same value to the caller. It now returns an explicit per-app
status list and a `partial` flag.
⚠️ **I broke this rule myself in D6** and it is worth knowing why: `fetchActivity` returned a
bare array and mapped a dead peer, a 403 and an unreadable doc all to "contributed nothing",
indistinguishable from "did nothing". Failing soft is right; failing soft INVISIBLY is not.

✅ **THE IDEMPOTENCY HALF LANDED 2026-09-10**, and this section used to claim it already had.
The line above once ended *"so a retried DO cannot double-write"* — which it could not deliver,
**because idempotency is a property of the RECEIVER**, and for a long time `IDEMPOTENCY_FIELD`
had no importer, no app declared the field, no route read it and nothing stored seen keys.
The sending half was always right and worth keeping: a derived key makes a retry *recognisable*.

`packages/weave/src/server/idempotency.js` is the receiving half. `defineCollection` now
**declares** the field on every `create*` capability and its POST route runs `withIdempotency`,
so a repeated key replays the first attempt's status and body with an `Idempotent-Replay: true`
header instead of writing a second row. One `weave_idempotency` table per app database, brought
in by the collection DDL.

⚠️ **A KEY IS SCOPED BY (WRITE DOOR, USER), AND THAT IS A SECURITY PROPERTY.** The engine derives
its key from the trigger and the event, so a per-user delegated DO fans one trigger out to N users
carrying **the same key**. A globally-keyed store would answer user B's write with user A's row —
a 200, someone else's data, and no error anywhere.

⚠️ **THE ROW AND THE KEY ARE ONE TRANSACTION.** Insert the row, then fail before recording the
key, and the retry double-writes anyway: the exact outcome this exists to prevent, reached by a
shorter path. `withIdempotency` owns the transaction rather than leaving `remember()` as a second
call a caller can forget.

✅ **THE HAND-ROLLED DOORS LANDED 2026-09-16.** The collection doors were only half of it: a POST
that does not go through `defineCollection` dropped the key as an unknown body field and still
double-wrote. `withIdempotency` and `IDEMPOTENCY_DDL` are now exported from `@jkos/weave/server`
(and `idempotencyBodyField` from the lean `@jkos/weave/activity`, so a discovery doc can declare
it), and the doors that are never idempotent by construction use them:

- **BeigeBoard `createItem` and `importItems`.** Validation and `?dryRun=1` stay *outside* the
  wrapper — a preview writes nothing and a rejected plan is not a first attempt, so neither may
  consume the key. The import strips the key before reading the document's shape, or the
  single-item form carries it into the item as an unknown field.
- **LazurOS's five job doors.** Each one enqueues work; a repeated key hands back the first job's
  handle, and a replay neither probes nor wakes the backend. The key never reaches the stored
  payload.
- ⚠️ **LazurOS's write-back sends `lazuros:writeback:<job id>`.** A job can legitimately finish
  *twice* — the reaper requeues one that outran its timeout while the first worker is still
  running, and both post DONE — and each DONE used to import the whole tree into BeigeBoard again.
  The job id is the identity of the result, so it is the key; the model's own output can never
  choose it.

Doors that are idempotent by construction do not declare it — a PATCH, a DELETE, the routine
imports (idempotent by slug), a deload (sets an override), a rescan. **The protection is the field
appearing in a capability's declared `body`, never the existence of the constant**, and
`check:rulings` now holds that for every `create*` door, every async door, and every door the
LazurOS write-back targets (derived from its routing table, not listed).

⚠️ **A present key that cannot be honoured is refused, not ignored.** An over-long or non-string
key used to read as "no key", so the write landed with no dedup and a 201 — the outcome the key
exists to prevent, with the key in hand. The field declares `max: 200`; BeigeBoard's contract
smoke violates every declared cap and caught that nothing enforced this one. Every door now
answers `idempotencyKeyError` with 400 VALIDATION. Absent, null and blank are still "no key".

⚠️ **The engine's key is 128 bits.** It was a 32-bit FNV-1a, harmless while nothing read it. Once
a door answers a matching key with the *first* write's response, a collision is a write that
silently never happens — ~1% odds by ten thousand writes to one door for one user. It is a
SHA-256 prefix now (`node:crypto`, still no dependency), and `check:rulings` pins the width.

⚠️ **Retention was declared and never enforced.** `prune()` had no call sites anywhere, so the
30-day ceiling in `idempotency.js` was a function a test called and production never did.
`withIdempotency` now sweeps on the first keyed write per database handle and then at most once a
day — no scheduler, the work rides the traffic that creates the need for it.

⚠️ **Why the gap survived as long as it did is worth more than the fix.** `check:rulings` covered
the *sending* half against an injected dispatcher and proved the key is derived and stable — never
that anything acted on it. The new suite (`packages/weave/test/idempotency.mjs`) writes through
the real generated route into real SQLite and **counts rows**, because a test that only inspected
responses would pass against a door that wrote twice and answered identically both times.

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
exists because three holes once lined up to run eight BeigeBoard and audiobook assertions green
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
  fourth hand-rolled ternary. `test/async-view.mjs` names the audiobook views and
  BeigeBoard's main region; add yours.
- **A 3-D view renders through `@jkos/scene`** — never a hand-made `getContext('webgl2')`.
  `useScene` (`/react`) owns the canvas's life: context loss and restore, visibility, resize,
  theme re-reads, a frame loop that runs only while something moves, and giving the context
  back on unmount (browsers cap live contexts; the oldest dies — and an immediate release
  breaks StrictMode in dev). The view brings a renderer (`create`) and a draw (`frame`);
  `/math` has the orbit rig, the solved spring, picking and a matrix-as-texture layout, pure
  and worker-safe; `useOrbitControls` binds drag and arrow keys through `@jkos/ui`'s one
  gesture engine. No three.js, on purpose — the whole of what a view needs is in the package.
  **Add your component to `VIEWS` in `test/scene.mjs`**, which otherwise fails it as an
  unlisted WebGL component. KourOS's `ridges3d/RidgeStage.tsx` is the small worked example.
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
| 6 | Scope namespace `<id>:verb`, declared on every write capability | `scopeFor(id, verb)`; `scope`/`scopes` on each non-GET capability, then `node packages/suite-manifest/scripts/gen-scopes.mjs` | `prove` `scope-identifier` (**drift**) + `check:scopes` (**fails** on an undeclared write scope or a stale jkAuth copy) |
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
| 28–31 | The four contract rules (§3.1–§3.4) | — | ✅ **enforced** — `check:rulings` + `86-async-contract`. Rule 4's *receiver* half is declared on every non-idempotent door and held by `check:rulings`; each door's own smoke writes twice and counts rows (§3.4) |
| 32 | Declared surface covers the mounted routes | mark an exception `// app-private: why` at its own source line | ✅ **enforced** — `prove` `98-surface-coverage`. All four backends report full coverage (69 mounted routes). ⚠️ A declared path covers at most **one** segment beneath it: `/items` covers `/items/:id`, and `/items/:id/deps` must declare itself |
| 33 | A 3-D view on the one engine | `useScene` from `@jkos/scene/react`, no `getContext('webgl…')` of its own | `check:scene` (**fails**) † — and it fails a WebGL component it does not know |

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

**A live channel (SSE).** The suite has two: jkDeploy's log stream and KourOS's listening
session (`apps/kouros/backend/src/session/routes.js` + `apps/kouros/src/session/client.ts`,
the fuller of the two). What a new one must do, each learned the hard way:
- **Down by SSE, up by POST — no WebSocket dependency.** Writes stay POST/PATCH/DELETE so the
  write gate and the scope apply (never PUT). The stream route carries `// app-private:`; the
  document it streams is declared as a dataset, the doors as capabilities.
- **Read it with `fetch`, through `authFetch` — never `EventSource`**, which cannot see a status
  code: a 401 on open is invisible to it and it reconnects into the same 401 for ever, where
  `authFetch` refreshes once, deduped across tabs.
- **The server ends the stream at the token's `exp`** with an event saying so; a channel checked
  once at open must not outlive its credential.
- **`X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`, and a comment ping under
  the edge's 60 s read timeout** — no nginx change needed.
- **A reconnect starts from a snapshot**, not a replay, with jittered backoff.
- **An open socket is not presence.** A client that loses signal closes nothing; if liveness
  matters, it needs an application heartbeat (TRAPS.md). And a hub of connections held in memory
  is correct only for a single process — say so where it is built.

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
through — provenance, logged in `auth_events`), `aud` (above), and `scope` (role-derived and
DECLARATION-derived: capabilities declare `scopes`, jkAuth grants `<id>:read` plus only what an
app declares — with the create/update/delete ladder under a declared `write` — and the resource
app checks `token.scope ⊇ required`. A new scope needs `gen-scopes.mjs` rerun and jkAuth
redeployed). The scope
check enforces only when `scope` is present, so tokens minted before Weave fall through to
the role gate rather than being rejected mid-session.

---

## 7 · Versioning, and what is still deferred

`CapabilityDoc.version` / `DatasetDoc.version` are numbers. **Bump on a breaking field
change** — a removed field, a renamed field, a type change, a newly-required body field. An
added optional field is not breaking. A consumer reading a version higher than it knows
**fails closed** (§3.3) with `DOC_VERSION_UNSUPPORTED`, and `check:rulings` holds it. Treat a bump
as a coordinated change and say so in the commit.

Two designed seams stay deferred, with their un-defer triggers: **transport 1 → 3**
(registry-driven CORS) when a peer genuinely cannot be nginx-proxied; and **runtime
`app_registry` CRUD** — plus a `_cachedAppOrigins` bust and dynamic nginx regeneration —
when apps must be added without a deploy. Today the registry changes only at boot, and both
the origin list and the per-role claims are process-lifetime caches.

---

*See also: `ARCHITECTURE.md` (system level) · `TESTING.md` (`pnpm test:contracts` in full) ·
`packages/suite-prober/README.md`.*
