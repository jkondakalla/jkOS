# jkOS — Suite Consolidation Report

> Research findings from the **synthetic sixth consumer** — a read-only harness
> (`packages/suite-prober`) that acts as an app touching every pathway in all five
> systems, then asserts the cross-system invariants such an app would rely on.
>
> This is a *researcher's* report. It identifies what can be consolidated, unified, or
> optimized. It does **not** change any of the five systems. Reproduce with
> `node packages/suite-prober/prove.mjs`.

## Method

I built a sixth app that does what every real consumer does — discover the suite from
`/auth/apps`, resolve each app's edge paths and capability/dataset docs, read and write
through Weave — except it reads the source-of-truth *files* so it runs without a
deployment. It is data-driven and expandable (add an app or an invariant as data, not
code). Findings below are tagged with the prober's classification:

- **drift** — two sources that already claim to agree, disagreeing (a real defect).
- **consolidate** — the same truth typed in N places; could collapse to one source.
- **gap** — a missing enforcement or capability a new app would trip on.

> **Status update (2026-07-01, preAlpha sweep).** This report is the original research
> snapshot; most of it is now CLOSED. C1–C3+C5: the app directory single-sources from
> `@jkos/suite-manifest` (registry seed, SUITE_APPS, nginx peers all derive; an `AppId`
> typed union guards call sites). C4: `useWeaveList` derives its bus subscription from
> `resourceKey(app, dataset)` — no caller-typed key. G1: the on-behalf-of delegation
> seam is built (`weaveServerClient(app, { actingUser })` + jkAuth `act` claim). G2 is
> pending the LazurOS Phase 7 cutover. Current headline: **drift 0 · consolidate 1
> (the off-limits SylibOS slug) · gap 7 · ok 39** — reproduce with `pnpm prove`.

## Run summary (original snapshot)

```
topology: 6 apps · 5 registry rows · 4 manifest entries · 4 nginx peers · 9 codes
drift 0   consolidate 9   gap 10   info 8   ok 7
```

**The honest headline:** there is **no drift**. `pnpm test:contracts` keeps the hard
contracts green and they *are* green. Every finding below lives one layer *beneath* that
gate — duplicated truth and unenforced coupling that no single test owns because each
one spans systems. That is precisely the class of trap the suite has been hunting
(`Documentation/JKAUTH_REFACTOR.md`, the numeric-sub incident): cheap to collapse now,
expensive once it drifts.

---

## The through-line: one app wears up to four names

Almost every consolidation finding is the same root cause. A jkOS app has a **canonical
id** (`beigeboard`) but is *reached* by a **slug** (`bb`) that is not derivable from the
id, and is *scoped* by yet another spelling. The single fact "this app is BeigeBoard" is
re-typed, in three different vocabularies, across the suite:

| Concern | Identifier used | Where | Evidence |
|---|---|---|---|
| Registry id / token `aud` | `beigeboard` | jkAuth `app_registry` | [db.js:239](../apps/jkauth/src/db.js#L239) |
| Edge proxy + health path | `bb` | registry `api_base`, manifest, nginx | [db.js:239](../apps/jkauth/src/db.js#L239), [manifest.ts:48](../packages/weave/src/manifest.ts#L48), [gen-nginx-weave.mjs:46](../infra/nginx/gen-nginx-weave.mjs#L46) |
| Invalidation bus key | `bb` (`bb.items`) | capability + dataset docs | [server.js:745](../apps/beigeboard/backend/server.js#L745), [server.js:806](../apps/beigeboard/backend/server.js#L806) |
| Capability scope namespace | `beigeboard` (`beigeboard:write`) | capability docs | [server.js:745](../apps/beigeboard/backend/server.js#L745) |

`sylibos → sylib` is the same split in three sources. `auth` and `lazuros` happen to
match (id == slug) — by luck, not by rule. **Nothing enforces that the four spellings
agree;** they agree today because a human kept them aligned by hand.

> **The unification.** Adopt one canonical app id and *derive* everything else from it:
> `apiBase = '/api/' + id`, `healthPath = '/health/' + id`, bus key = `id + '.' + resource`,
> scope = `id + ':' + verb`. The slug stops existing. Adding an app becomes one
> registry row; the proxy path, health path, bus key, and scope all fall out of the id.
> (Researcher's note only — not done here.)

---

## Consolidation opportunities

### C1 — App identity: id vs slug vs scope-namespace  ⊕ *the big one*
The table above. One app, up to four spellings, four hand-synced sources, zero
enforcement. Everything in this section is a symptom of C1; fixing C1 dissolves most of
them. Prober: `slug-vs-id`, `scope-identifier`.

### C2 — Two app lists that already disagree  ⊕
The authoritative `app_registry` seed and the Weave `SUITE_APPS` manifest are two
hand-maintained copies of the same rows (`api_base`, `health_path`,
`capabilities_path`, `datasets_path`). The manifest calls itself "the static fallback"
([manifest.ts:13-18](../packages/weave/src/manifest.ts#L13-L18)) — but a fallback that
is a second copy is a drift surface. They **already** disagree on membership:

- `ordeck`, `staging` — in the registry seed, absent from the manifest.
- `lazuros` — in the manifest, absent from the registry.

7 integration-field values are duplicated verbatim between the two
([db.js:239-243](../apps/jkauth/src/db.js#L239-L243) ↔
[manifest.ts:47-50](../packages/weave/src/manifest.ts#L47-L50)). They are equal today;
nothing keeps them equal. Prober: `app-list-parity`, `registry-manifest-fields`.

> **The unification.** Generate `SUITE_APPS` from the registry seed (the static
> fallback becomes a build artifact of the authoritative list), or ship the seed as a
> shared JSON the manifest imports. One list, one membership, no hand-sync.

### C3 — Sources of truth are private module-locals, not data  ⊕ *meta*
The reason C1 and C2 can hide is that the suite's truths are **not exported as data**.
The prober had to regex-scrape every one of them except `CODES`:

| Table | Exported as data? | File |
|---|---|---|
| `CODES` vocabulary | ✅ `require()`-able | [codes.js](../packages/auth-middleware/codes.js) |
| `app_registry` seed | ❌ const in a migration closure | [db.js](../apps/jkauth/src/db.js) |
| `SUITE_APPS` manifest | ❌ TS module-local (Vite-only) | [manifest.ts](../packages/weave/src/manifest.ts) |
| nginx `PEERS` | ❌ const in the generator | [gen-nginx-weave.mjs](../infra/nginx/gen-nginx-weave.mjs) |
| `CAPABILITIES` / `DATASETS` | ❌ inline consts in the server | [server.js:730](../apps/beigeboard/backend/server.js#L730) |

`CODES` is the proof of the pattern that works: because it is data, one generic test
(`test:contracts`) checks node↔python parity. Every other table needs a *bespoke*
hand-written cross-check — which is why most of them have none. Prober:
`sot-machine-readability`.

> **The unification.** Export each table as data (a JSON or a tiny module). Then a
> single generic conformance test validates all of them, the way the prober now does —
> and the prober's scrapers become imports. This is the enabler for C1/C2.

### C4 — The invalidation-key triple  ⊕ / ▲
`bb.items` is a free-form string that must match in **three** independent places for a
HUD widget to refresh after a write:

1. the capability's `invalidates` (writer side) — [server.js:745](../apps/beigeboard/backend/server.js#L745)
2. the dataset's `invalidates` (reader side) — [server.js:806](../apps/beigeboard/backend/server.js#L806)
3. the widget's `invalidateOn` passed into `useWeaveList` — [weaveClient.ts:81-98](../packages/weave/src/weaveClient.ts#L81-L98)

`useWeaveList` forwards `opts.invalidateOn` straight to the bus
([resource.ts:24](../packages/weave/src/resource.ts#L24),
[resource.ts:32](../packages/weave/src/resource.ts#L32)); the caller supplies the key.
A typo (`beigeboard.items` vs `bb.items`) does not error — the write succeeds, the
widget just silently never refreshes. No validator asserts the three agree. Prober:
`invalidation-keys`.

> **The unification.** Derive the bus key from the dataset id (C1: `app.dataset`), and
> have `runCommand`/`useWeaveList` compute it instead of accepting a literal. The triple
> collapses to one derived value.

### C5 — nginx upstream table vs registry paths  ⊕
`gen-nginx-weave.mjs --check` guards that the two generated `.conf` files match the
`PEERS` table — but **not** that `PEERS` matches the registry. The generator's own
comment admits it ([gen-nginx-weave.mjs:24-28](../infra/nginx/gen-nginx-weave.mjs#L24-L28)):
"this table … must stay consistent with the registry's api_base/health_path." That
consistency is a code comment, not a test. `apiPrefix: '/api/bb/'` in `PEERS` and
`api_base: '/api/bb'` in the registry are two declarations of one fact. Prober:
`slug-vs-id` (lists nginx among the 4 sources).

> **The unification.** Generate the `PEERS` *edge paths* from the registry (only the
> `container:port` upstream is genuine infra and stays). `--check` then guards the whole
> chain, not just the leaf.

---

## Architectural gaps (what a new app trips on)

These are not duplication — they are missing seams. A real sixth app hits each one.

### G1 — Backend→peer per-user writes are blocked  ▲
`weaveServerClient` can read a peer but **cannot write per-user data**: a service token
hits `NO_USER_CONTEXT` ([writeGate.js:34-35](../packages/weave/src/server/writeGate.js#L34-L35)).
The on-behalf-of delegation seam is unbuilt. Any feature shaped "LifeGrid's backend
creates a BeigeBoard task for a user" is architecturally impossible today. This is the
single hardest wall the sixth app meets. Prober: `pathway-helpers` (weave.server-client).

### G2 — AI endpoints bypass the capability fabric  ▲
`POST /api/ai/parse-task` ([server.js:1450](../apps/beigeboard/backend/server.js#L1450))
and `POST /api/ai/breakdown` ([server.js:1525](../apps/beigeboard/backend/server.js#L1525))
are **not** in the `CAPABILITIES` doc. No HUD widget can discover or invoke them through
Weave — they are a parallel, undiscoverable surface. The suite's whole premise is
"discovery over hardcoding"; these two escape it. Prober: `pathway-helpers`.

### G3 — Service-token enablement is silent  ▲
`weaveServerClient` calls `POST /auth/token`, which is disabled unless
`JKOS_SERVICE_CLIENTS` is set. No contract test asserts the env is present for a given
service client, so a new backend consumer fails at runtime, not at build. Prober:
`pathway-helpers` (jkauth.service-token).

### G4 — Published widgets are global, not role-scoped  ▲
`POST /auth/widgets` ([weave.js:78](../apps/jkauth/src/routes/weave.js#L78)) publishes a
spec to **every** user's shelf. A widget bound to a write capability appears to guests,
who then hit `READ_ONLY`/`FORBIDDEN` when they use it. There is no widget-level role
gate. Prober: `pathway-helpers`.

### G5 — No per-source dataset for `ext_ref` items
BeigeBoard's `datasets` *does* declare an `ext_ref_prefix` filter
([server.js:791](../apps/beigeboard/backend/server.js#L791)) — good — but a new app
must *know* to pass it; there is no dataset that scopes to "items I created" by default.
A sixth app that writes items with `ext_ref: 'lifegrid:…'` can read them back, but only
by convention, not by a declared read surface. (Observed by reading; partial seam
exists.)

### G6 — Prod deploy leaves new proxy blocks inert  ▲
A prod deploy runs `MANAGE_NGINX=0` ([lib-deploy.sh:32](../infra/scripts/lib-deploy.sh#L32),
[lib-deploy.sh:151](../infra/scripts/lib-deploy.sh#L151)), so a newly added peer's
regenerated `weave-proxy.conf` blocks do not take effect until nginx is *manually*
restarted. The sixth app's entire Weave surface is invisible to peers in prod until
someone restarts nginx by hand. Prober: `pathway-helpers` (jkdeploy.prod-deploy).

### G7 — Staging gate depends on prod jkAuth  ▲
Every gated `staging.jkos.net` route `auth_request`s **prod** jkAuth
([ARCHITECTURE.md:154-158](ARCHITECTURE.md#L154-L158)). A prod jkAuth outage makes
staging — *including `/deploy`, the recovery tool* — unreachable. The tool you'd use to
fix prod is gated behind the thing that's down. Prober: `pathway-helpers`
(jkauth.require-admin).

### G8 — Preferences are last-write-wins  ▲
`PATCH /auth/profile` is a read-merge-write of the whole prefs blob with a **shallow**
`{ ...current, ...preferences }` merge and no optimistic lock
([profile.js:67](../apps/jkauth/src/routes/profile.js#L67)). Two tabs that each PATCH
the full blob (theme + HUD layout) clobber each other; nested settings replace wholesale
rather than deep-merge. Most likely to bite the sixth app on first-run setup when it
writes layout and theme together. Prober: `pathway-helpers` (jkauth.profile-patch).

---

## Optimizations (cheaper/safer, not duplication)

- **O1 — First-call `FORBIDDEN` round-trip on rollout.** `aud`/`scope` are computed at
  mint time ([ARCHITECTURE.md:92-98](ARCHITECTURE.md#L92-L98)). When the sixth app is
  added to the registry, every *existing* session lacks it in `aud`; the first call
  returns `FORBIDDEN` → silent refresh → retry succeeds. Correct, but a wasted
  round-trip per live session per rollout. A "registry changed" refresh nudge would
  remove it.
- **O2 — numeric `sub` (already tracked).** Not re-litigated here; see
  `Documentation/JKAUTH_REFACTOR.md` and the `numeric-sub` note. The contract gate
  catches it; the root fix (emit `String(sub)`) is deferred suite-wide. Worth folding
  into the C1 pass since both are "identity spelled once, correctly."
- **O3 — Health/probe identity.** `probeApps` and the systems panel key off slug-derived
  health paths; once C1 derives `healthPath` from id, the probe list derives too.

---

## What the prober cannot see yet (limits + how to extend)

Honest boundaries of this pass:

1. **No live suite.** It reads files, not a running deployment. The next extension is a
   `liveTopology(baseUrl)` adapter that does real HTTP discovery (`/auth/apps` →
   per-app `/capabilities` + `/datasets`); the *same* probes then run against prod.
2. **Scraping, not parsing.** Because of C3, the loaders use tolerant regex on the
   doc tables. Export those tables as data (C3) and the loaders become imports — more
   robust, and the prober shrinks.
3. **Only BeigeBoard has a Weave surface to scrape.** As ORDECK/jkAuth grow declared
   capability/dataset docs, add a `BACKEND_DOCS` row and the doc probes cover them with
   no probe edits.

### Reproduce / extend

```
node packages/suite-prober/prove.mjs            # human report
node packages/suite-prober/prove.mjs --json      # machine report (pipe into CI)
```

| To add… | Edit |
|---|---|
| a new source-of-truth file | `packages/suite-prober/src/sources.mjs` (`SOURCES`) |
| a new app's backend docs | `BACKEND_DOCS` in the same file |
| a new pathway | a row in `packages/suite-prober/src/pathways.mjs` |
| a new invariant | drop `NN-name.mjs` in `packages/suite-prober/src/probes/` |

---

## One-paragraph executive summary

The suite is internally consistent today (zero drift) but pays for it in hand-sync. One
root cause — **an app is identified by up to four un-linked spellings (`beigeboard`
the id, `bb` the slug, `beigeboard:` the scope, `bb.items` the bus key)** — drives the
top consolidation findings (C1, C4, C5) and the duplicated app list (C2). The enabler
for fixing all of them is **C3: export the suite's source-of-truth tables as data**, so
one generic conformance test (like the prober) replaces the bespoke per-table checks
that mostly don't exist. Separately, a real sixth app hits eight architectural gaps, the
hardest being **G1 (backend→peer per-user writes are blocked by `NO_USER_CONTEXT`)** and
**G2 (AI endpoints are invisible to the capability fabric)**. None of this is urgent —
it is cheap-now / expensive-later. The prober is left in the repo as the reproducible,
expandable way to watch these as the suite grows.
