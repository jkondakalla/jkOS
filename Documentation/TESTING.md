# jkOS — Testing Reference

What the suite's test system is, what every test asserts, how to run each layer, and how
to add a new one. This describes the **shipped** suite (post the 2026-07-06/07 upgrade
program — history capsule at the bottom). When this doc disagrees with the code, the code
wins — update this. The quick command catalog is [PRIMITIVES.md](PRIMITIVES.md) §2.

## The layers (run in this order, stop at the first red)

1. **`pnpm typecheck`** — cheapest signal; a type error means the source doesn't cohere.
2. **`pnpm test:contracts`** — THE gate. Every hard contract in one chain; exit 0 is the
   definition of "green". Run after every meaningful change.
3. **Per-app tests** — to localize a gate failure (`pnpm --filter @jkos/<pkg> test`).
4. **`pnpm prove --live <base>`** — post-deploy smoke against a running stack.

The `/suite-health` skill automates this walk and maps failure signatures to known fixes.

## Test inventory

### jkAuth (`apps/jkauth/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `contracts.mjs` | 30 | Codes vocab node↔python key-for-key parity; issuer/cookie single-source; token shape; the python bridge (numeric-`sub` REJECTED, break-glass gates). Run via `test:contracts` filter. |
| `smoke.mjs` | 68 | The in-process auth flows: register/login/logout, cookie flags, 2FA, rate limits, registry directory. *(One 429-timing lockout assertion can blip in a long chain — passes in isolation; re-run before treating as real.)* |
| `lifecycle.mjs` | 24 | The session lifecycle through the REAL verify→write-gate chain: silent refresh + rotation reuse detection, expiry, guest `READ_ONLY`, service `NO_USER_CONTEXT`, on-behalf-of delegation lands as the acting user, python-jose cross-verify of real tokens. |
| `multiuser.mjs` | 27 | Multi-user contracts: preference isolation, deep-merge preserving sibling slices, the 409-conflict-then-retry race, role-scoped widget visibility, per-user audit scoping, delegated-mint attribution. |

### BeigeBoard backend (`apps/beigeboard/backend/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `import.smoke.mjs` | 39 | The import pipeline: nested/flat forms, validate-then-write, `?dryRun=1`. **The house-pattern exemplar** — boot the real server on a throwaway port + temp SQLite DB + dev-stub auth, assert over real HTTP. |
| `items.smoke.mjs` | 48 | Direct CRUD hardening: user scoping (A can't touch B), parent-cycle rejection, cascade delete, the reserved-source guard (`source:'google'` → 400), cap/date validation parity, service identities don't trigger the demo seed, OAuth-callback public-path behaviour, AI output sanitisation (mock LazurOS booted in-harness). |
| `delta.smoke.mjs` | 14 | The `?since` cursor contract under millisecond `updated_at` stamps (no same-second row loss). |
| `contract.smoke.mjs` | 14 | Declared == enforced, generically: a real row's keys ⊆ the declared `items` shape; every declared `max`/`date`/`time` constraint actually 400s on POST and PATCH; reserved sources rejected. |
| `calendar.sandbox.mjs` | 29 | Fixture-driven calendar providers (no HTTP, no accounts): same-event-same-times across google/outlook/icloud, all-day exclusive-end agreement, the empty-upstream wipe guard (skip vs `?force=1`), the iCloud TZID/RRULE limitations PINNED as documented, `CALENDAR_ENC_KEY` encrypt→not-plaintext→decrypt + legacy-plaintext passthrough. |

### Weave (`packages/weave/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `weave.mjs` | 39 | docShape envelope, capability/dataset schema, `AppId` d.ts ⇄ runtime parity, manifest derivations. |
| `lego.mjs` | 100 | The Layer-D bricks: `defineCollection` (ddl/docs/mount coherence), `defineConnector`, trigger engine + typed-stud validation, delegation plumbing. Includes regression coverage for two fixed bugs (2026-07-08, found by PapyrOS's `playback.smoke.mjs`): a `ref` field's numeric value must round-trip as canonical TEXT (`coerceRef()` in `collection.js`), and every affinity-sensitive filter op (`eq`/`gt`, boolean/number/ref-typed fields) must coerce the bound query value to match its column (`coerceFilterValue()` in `filters.js`). |

### LazurOS (`apps/lazuros/backend/test/` + `apps/lazuros/worker/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `queue.smoke.mjs` | 18 | Job queue lifecycle `PENDING → … → DONE\|FAILED`, owner scoping, atomic claim. |
| `providers.smoke.mjs` | 30 | Provider factories (STT/TTS/embedding/webSearch) against a mocked `fetch`; config-driven `baseUrl` contract. |
| `writeback.smoke.mjs` | 11 | State-node delegated write-back (injected client): import-as-acting-user, review-first `parse-document`, best-effort failure recording. |
| `worker-e2e.smoke.mjs` | 12 | The full seam: real State node + real `worker.py process_once` (via `python3`) against the live bearer-gated `/internal` API, only Ollama faked; `PENDING_WAKEUP` path; write-back invocation. **Gotcha pinned in its header:** drive the worker via async `spawn`, never `spawnSync` — a sync child freezes the event loop that must answer it. |
| `worker/test/worker.smoke.py` | 15 | Worker unit half against a mocked State node (claim race, unconfigured cap, infer error). Run: `python3 apps/lazuros/worker/test/worker.smoke.py`. |

### PapyrOS backend (`apps/papyros/backend/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `probe.smoke.mjs` | 33 | The PURE half of the library service (`src/library/probe.js`): `parseProbe`/`mapTagsToColumns`/`normalizeTags`/`extractYear`/`parseGenres` against hand-authored ffprobe JSON fixtures (`test/fixtures/probe/`) — casing-inconsistent tags, missing tags, multi-genre delimiters, chapter mapping. No `ffprobe` exec, no DB. |
| `library.smoke.mjs` | 45 | End-to-end: boots the real server against a committed 2-book fixture library (`test/fixtures/library/`, regenerate via its `gen-fixtures.sh`), polls `/api/books` for the non-blocking boot scan to land, then asserts `/health`, `/api/capabilities` + `/api/datasets` doc shape, a single-file book's duration/tags/2 embedded chapters (chapters/files read straight off the sqlite file — `BOOK_SHAPE` deliberately excludes them from the list row), a two-file book's summed duration + sequential (track-tag) file ordering + no synthesized chapters, and the `?title=` prefix filter. **Requires `ffprobe` on PATH** (install `ffmpeg`) — SKIPS cleanly (exit 0, loud warning) if it's absent, same as `jkos-deploy/scripts/selftest.sh`'s docker/openssl skip pattern. |
| `playback.smoke.mjs` | 42 | The playback backend (task 3.5): boots the real server with a REAL RS256 keypair (forged per-user tokens, not the single-identity dev stub) against the fixture library. Owner-scoped `progress` round-trip as two mock users (A/B never see each other's rows; cross-user PATCH/DELETE 404; a real position-bump PATCH; the `finished` boolean filter, both `true|false` and `1|0` wire forms); range-aware `GET /api/stream/:bookId/:fileIndex` (`Range: bytes=0-1023` → 206 with the true `Content-Range`/`Content-Length`/body-length trio, computed off the actual file size, never hardcoded); `GET /api/cover/:bookId` → 200 against a real folder-level `cover.jpg` added to Fixture Book B (`gen-fixtures.sh`); an unauthenticated media request → 401 (pins 3.4's mount-ordering fix). **Two BUGs this smoke found in `packages/weave/src/server/collection.js`/`filters.js` are now FIXED** (2026-07-08) — this smoke's assertions were flipped to the corrected behavior and now double as their regression coverage (the primitive itself is unit-tested in `packages/weave/test/lego.mjs`): (a) a `type: 'ref'` field (e.g. `book_ref`) now stores/returns its canonical string (`"<id>"`, not `"<id>.0"`) — `collection.js`'s `coerce()` stringifies a numeric ref before binding (`coerceRef()`); (b) `?finished=true|false` (the wire contract `discovery.js`'s own comment documents) now matches correctly — `filters.js`'s `buildItemFilters` type-coerces a bound filter value to its column's affinity (`coerceFilterValue()`), applied consistently across the `eq`/`gt` ops. Same `ffprobe` PATH requirement/skip behavior as `library.smoke.mjs`. |

### Cross-system (root `test/` + `packages/suite-prober/` + scripts)

| Runner | Owns |
|--------|------|
| `pnpm roundtrip` (`suite-prober/roundtrip.mjs`, 23) | The WRITE round-trip: boots the real BB backend, discovers create/update/complete/delete + the items dataset from the served docs (no hardcoded shapes), then create→read-back→`?since` cursor→update→complete→delete→verify-clean. Rows tagged `ext_ref:'prober:<runid>'` + prefix-swept — staging-safe in `--live` mode. |
| `pnpm test:cards` (`test/cards-logic.mjs`, 49) | The REAL pure functions (`design/utils/color.ts`, `cards/src/datetime.ts`) transpiled in-memory: withAlpha hex/var/clamp, time↔fraction, week/month math, lane packing. |
| `pnpm check:tokens` | Token mirrors byte-identical + `test/tokens-parity.mjs`: paper/dark accent-derivation SET parity (16 vars, membership by naming convention) + CRT knob ownership pin. |
| `pnpm check:nginx` | Generated `weave-proxy*.conf` match the manifest derivation. |
| `pnpm check:responsive` (`test/responsive.mjs`) | Breakpoint single-source: `@media` bounds == `BREAKPOINT_MAX`, `MEDIA` derives, tap floor on the right primitives, retired magic numbers stay dead. |
| `pnpm check:drag` (`test/drag.mjs`) | One `usePointerDrag` gesture primitive; no second drag system. |
| `pnpm check:cards` (`test/cards-purity.mjs`) | Kit purity text-scan (comment-stripped): no app ids, no host CSS classes, no raw alpha-concat in `@jkos/cards`/`@jkos/ui`. |
| `pnpm check:hud` (`apps/ordeck/scripts/check-hud-doc.mjs`) | HUD doc validity (every placed id has a def, footprints within grid + ≥ `minSize`, shelf resolves) + the REAL `mergePublished` healer is idempotent (merge∘merge byte-identical; `userSized` cells untouched). Also a fleet tool: `<file.json>` or `--live`. |
| `pnpm prove` (`suite-prober/prove.mjs`) | The prober (below). |
| `bash jkos-deploy/scripts/selftest.sh` | Deploy-pipeline dry-run: scripts parse + carry the load-bearing steps, every compose file passes `docker compose config`, current nginx conf loads in a throwaway container, break-glass gates hold. Read-only; SKIPs cleanly (exit 0) without docker/openssl. Not in the gate (needs a docker daemon); the auth half is gate-wired via `contracts.mjs`. |

## The suite prober (the conformance instrument)

`packages/suite-prober` is a **synthetic sixth app**: it discovers the suite the way Weave
does (manifest → registry seed → nginx peers → each app's capability/dataset docs) — but
from the source-of-truth *files*, so it runs in a plain checkout. It asserts the
cross-system invariants a real new app would rely on: single-source app identity, doc
shapes, filter enforcement declared==enforced, edge reachability, env/config conformance
(every secret-shaped `process.env` read is provisioned somewhere).

- **Classifications:** `drift` (two sources that must agree, disagreeing — **fails the
  gate**) · `consolidate` (same truth typed twice) · `gap` (missing enforcement) · `info` · `ok`.
- **File mode** (`pnpm prove`) runs inside `test:contracts`. **Live mode**
  (`--live <base>`, optional `--token <jwt>`/`PROBE_TOKEN`) adds deployed-edge checks:
  every advertised health path answers `{status:'ok'}`, served docs pass the same
  `checkDocShape`, the deployed registry matches the manifest, and the admin gate 401s an
  unauthenticated request (the "deployed but open" catcher). Exits non-zero on drift →
  usable as a post-deploy gate.
- **Write mode:** `roundtrip.mjs` is the write sibling (above); `--live` drives a deployed
  stack and is staging-safe (`prober:*` rows only).
- **Extend as data, not harness code:** a new source-of-truth file → `SOURCES`
  (`src/sources.mjs`); a new app's docs → `BACKEND_DOCS`; a new invariant → drop
  `NN-name.mjs` in `src/probes/` (auto-loaded). Operating manual:
  [packages/suite-prober/README.md](../packages/suite-prober/README.md).

Read-only by charter (roundtrip's own rows excepted): it never mutates the five systems.

## House patterns (how tests are built here)

The `/new-tester` skill is the full playbook; the shapes:

| Shape | Exemplar | When |
|-------|----------|------|
| Boot-real-server smoke | `import.smoke.mjs` | Anything behavioural. Real server, throwaway port, temp DB, dev-stub auth (`sub:1 role:admin` when no key env set), real HTTP, cleanup. |
| Transpile-pure-logic unit | `test/cards-logic.mjs` | Pure TS modules — transpile in-memory with the repo's own `typescript`, drive the REAL functions. |
| Text-scan gate | `test/cards-purity.mjs` | Banning a pattern structurally. Comment-strip first; prove the scan catches drift on a scratchpad copy, never via `git checkout`. |
| Prober probe | `src/probes/95-env-conformance.mjs` | Cross-system invariants over the discovered topology. |
| node↔python bridge | `contracts.mjs` §3 | Anything both runtimes must agree on. |

Non-negotiables: exercise the REAL code (never a re-implementation); wire the new test into
its package `test` / a `check:*` / `pnpm prove`, then confirm the new ✓ lines appear in a
full `pnpm test:contracts` run.

## What "healthy" means

`pnpm typecheck` clean · `pnpm test:contracts` exit 0 (prober 0-drift) · and for a
deployment, `pnpm prove --live <base>` exit 0.

---

## History capsule — the 2026-07-06/07 upgrade program

A full-suite audit (2026-07-06) catalogued 15 verified defects, 8 architecture
recommendations, and a 16-tester suite design; the whole program shipped in 7 waves over
2026-07-06/07 (this is the batch that built most of the inventory above). Highlights:

- **Data-loss class closed:** reserved-source guard on direct writes, calendar
  empty-upstream wipe guard, `CALENDAR_ENC_KEY` provisioning + lifecycle docs.
- **Declared==enforced:** BB item schema single-sourced (`src/item-fields.js` derives
  discovery shape, whitelist, caps, enums), validation shared by import + direct CRUD.
- **BB backend restructured** into `src/` modules mirroring jkAuth (behaviour-identical,
  27 routes verified equal); calendar sync behind one `CalendarProvider` contract with
  pure fixture-testable normalizers.
- **Kit purity:** `@jkos/cards` app-agnostic (no app ids / host classes / raw alpha-concat;
  `withAlpha` added to `@jkos/design`); silent-failure fixes (write rollback, out-of-window
  clamp) — all gated.
- **Multi-user readiness:** role-scoped published widgets (migration 016), preferences
  deep-merge + `prefs_version` optimistic lock with client retry, numeric-sub root fix
  (every mint path emits `String(sub)`; `verify_sub:False` removed), ORDECK portal gating
  verified.
- **Resilience:** jkDeploy break-glass bearer (inert while SSO works), deploy-pipeline
  self-test, LazurOS fake-worker e2e, HUD doc validator, design-parity gate.
- **Deliberately deferred with rationale:** BB items onto `defineCollection` (its lazy
  seed/cascade/cycle-guard/3 calendar sources don't fit the hooks); generating hub.css's
  dark block from `buildTheme` (TEST-11 closes the drift surface without the
  visual-regression risk); a prod edge `auth_request` for the portal (would diverge from
  the other prod origins' self-gating pattern) — Jag's call, tracked in [ToDo.md](ToDo.md).

The audit's full evidence catalogue and the chunked execution plan lived in
`TESTING.md` (old form) + `UPGRADE_PLAN.md`, both retired when the plan was exhausted.
They were never committed (the whole program is one uncommitted batch), so this capsule
and the tests themselves are the surviving record — which is fine: every defect they
described is now an assertion.
