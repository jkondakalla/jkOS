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
| `lego.mjs` | 108 | The Layer-D bricks: `defineCollection` (ddl/docs/mount coherence), `defineConnector`, trigger engine + typed-stud validation, delegation plumbing. Includes regression coverage for two fixed bugs (2026-07-08, found by PapyrOS's `playback.smoke.mjs`): a `ref` field's numeric value must round-trip as canonical TEXT (`coerceRef()` in `collection.js`), and every affinity-sensitive filter op (`eq`/`gt`, boolean/number/ref-typed fields) must coerce the bound query value to match its column (`coerceFilterValue()` in `filters.js`). Section "D1b" (2026-07-15, ToDo §3 17.4) covers `defineCollection`'s `only: [...]` capability/route-selection option — an append-only collection emits ONLY `createX` (no `updateX`/`deleteX`), and live-mounts GET+POST while PATCH/DELETE are proven NOT wired at all (not merely auth-denied), plus a real-SQLite append-not-upsert round trip. |

### Player (`packages/player/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `core.test.mjs` | 84 | Layer 0, transpiled pure: timeline math parity with papyros's retired `position.ts` (cumulative starts, `locate` boundary rule — an exact file edge belongs to the LATER source at offset 0, clamp-at-total, defensive `.index` sort, zero/negative-duration hygiene, `fmtClock`) + every `Queue` reducer, incl. the shuffle-stability property (same seed ⇒ same permutation; skips never re-roll; only a structural change or a new seed resyncs) and the cursor-follows-item `reorder` cases. |
| `backend.test.mjs` | 40 | `createHtmlMediaBackend` against a scripted fake element (no DOM): DOM-event → `BackendEvent` forwarding, `MediaError.code` 1-4 → kind classification, play()-rejection classification (`NotAllowedError`→`autoplay-blocked`, `NotSupportedError`→`src-unsupported`, `AbortError`→`aborted`), paired add/remove listener wiring, idempotent `dispose()`. |
| `engine.test.mjs` | 34 | The engine's pure helpers, transpiled: rate persistence guards (non-preset/throwing store → 1), the 7-step `nextRate` cycle, `compatKey`, recoverable-kind gating, ladder escalation arithmetic (`canEscalate`/`nextCompatLevel`/`effectiveStartLevel` — session bump beats initial rung via `Math.max`). |

The engine hook itself has no DOM to run in under the house Node-only test style — its
six load-bearing invariants are pinned by inline `[INVARIANT x]` tags in
`packages/player/src/engine/usePlayerEngine.ts` and verified against the pre-migration
papyros engine by review (Wave 15, 2026-07-14); in-browser behavior (autoplay veto,
Firefox compat recovery, offline SW) is confirmed manually on staging.

### LazurOS (`apps/lazuros/backend/test/` + `apps/lazuros/worker/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `queue.smoke.mjs` | 18 | Job queue lifecycle `PENDING → … → DONE\|FAILED`, owner scoping, atomic claim. |
| `providers.smoke.mjs` | 30 | Provider factories (STT/TTS/embedding/webSearch) against a mocked `fetch`; config-driven `baseUrl` contract. |
| `writeback.smoke.mjs` | 11 | State-node delegated write-back (injected client): import-as-acting-user, review-first `parse-document`, best-effort failure recording. |
| `worker-e2e.smoke.mjs` | 12 | The full seam: real State node + real `worker.py process_once` (via `python3`) against the live bearer-gated `/internal` API, only Ollama faked; `PENDING_WAKEUP` path; write-back invocation. **Gotcha pinned in its header:** drive the worker via async `spawn`, never `spawnSync` — a sync child freezes the event loop that must answer it. |
| `worker/test/worker.smoke.py` | 19 | Worker unit half against a mocked State node (claim race, unconfigured cap, infer error). Run: `python3 apps/lazuros/worker/test/worker.smoke.py`. |

### PapyrOS backend (`apps/papyros/backend/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `probe.smoke.mjs` | 35 | The PURE half of the library service (`src/library/probe.js`): `parseProbe`/`mapTagsToColumns`/`normalizeTags`/`extractYear`/`parseGenres` against hand-authored ffprobe JSON fixtures (`test/fixtures/probe/`) — casing-inconsistent tags, missing tags, multi-genre delimiters, chapter mapping. No `ffprobe` exec, no DB. |
| `library.smoke.mjs` | 50 | End-to-end: boots the real server against a committed 2-book fixture library (`test/fixtures/library/`, regenerate via its `gen-fixtures.sh`), polls `/api/books` for the non-blocking boot scan to land, then asserts `/health`, `/api/capabilities` + `/api/datasets` doc shape, a single-file book's duration/tags/2 embedded chapters (chapters/files read straight off the sqlite file — `BOOK_SHAPE` deliberately excludes them from the list row), a two-file book's summed duration + sequential (track-tag) file ordering + no synthesized chapters, and the `?title=` prefix filter. **Requires `ffprobe` on PATH** (install `ffmpeg`) — SKIPS cleanly (exit 0, loud warning) if it's absent, same as `jkos-deploy/scripts/selftest.sh`'s docker/openssl skip pattern. |
| `playback.smoke.mjs` | 58 | The playback backend (task 3.5): boots the real server with a REAL RS256 keypair (forged per-user tokens, not the single-identity dev stub) against the fixture library. Owner-scoped `progress` round-trip as two mock users (A/B never see each other's rows; cross-user PATCH/DELETE 404; a real position-bump PATCH; the `finished` boolean filter, both `true|false` and `1|0` wire forms); range-aware `GET /api/stream/:bookId/:fileIndex` (`Range: bytes=0-1023` → 206 with the true `Content-Range`/`Content-Length`/body-length trio, computed off the actual file size, never hardcoded); `GET /api/cover/:bookId` → 200 against a real folder-level `cover.jpg` added to Fixture Book B (`gen-fixtures.sh`); an unauthenticated media request → 401 (pins 3.4's mount-ordering fix). **Two BUGs this smoke found in `packages/weave/src/server/collection.js`/`filters.js` are now FIXED** (2026-07-08) — this smoke's assertions were flipped to the corrected behavior and now double as their regression coverage (the primitive itself is unit-tested in `packages/weave/test/lego.mjs`): (a) a `type: 'ref'` field (e.g. `book_ref`) now stores/returns its canonical string (`"<id>"`, not `"<id>.0"`) — `collection.js`'s `coerce()` stringifies a numeric ref before binding (`coerceRef()`); (b) `?finished=true|false` (the wire contract `discovery.js`'s own comment documents) now matches correctly — `filters.js`'s `buildItemFilters` type-coerces a bound filter value to its column's affinity (`coerceFilterValue()`), applied consistently across the `eq`/`gt` ops. Also covers the compat pipeline (21 asserts): prepare→poll→ready, `?compat=1` 206s off the variant's own stat, bogus level → 4xx, 404-before-prepare, source-mtime regeneration. Skip gate requires `ffprobe` AND `ffmpeg` on PATH. |
| `meta.smoke.mjs` | 40 | The metadata-enrichment backend (task 4.4): boots the real server against the fixture library with `globalThis.fetch` replaced *before* `server.js` loads (`fixtures/meta/fetch-mock-preload.cjs` via `NODE_OPTIONS=--require`) so the iTunes connector and match routes hit a canned payload instead of the network — any unrecognized URL throws loudly rather than leaking to the internet. Asserts: the `META` connector maps all 7 declared fields off the canned iTunes item and calls the exact upstream search URL; `matchBook` end-to-end on a scanner-produced fixture book (candidate row taken straight off the real `metadataSearch` response) updates author/description/year/merged-genres/`metadata_source`/`ext_ref` while leaving the scanner's title untouched, writes the real cover file bytes to disk, and requests the 600×600 upsize of the candidate artwork URL; a non-admin `POST /api/match/all` → 403 (admin-gate pin only — the deep batch semantics are covered by dev-time verification). Uses a real RS256 keypair (forged per-user tokens) for the admin-gate check, same recipe as `playback.smoke.mjs`. Same `ffprobe` PATH requirement/skip behavior. |
| `history.smoke.mjs` | 25 | Play-history (ToDo §3 17.4): boots the real server with `AUDIOBOOKS_DIR` pointed at an EMPTY temp dir — no `ffprobe`/`ffmpeg` dependency, never skips (`history.item_ref` is a soft `ref`/TEXT column, no SQL FK, so a fake book id round-trips with no real scanned book needed). Asserts: unauthenticated POST/GET → 401; `POST /api/history` creates a row (201, canonical-string `item_ref`, `ms_played`/`completed` round-trip); a SECOND create for the same book APPENDS a distinct row (no upsert/collapse — the opposite of `progress`'s dedupe); `PATCH`/`DELETE /api/history/:id` → 404 because the routes are never mounted (`defineCollection(..., {only:['create']})`), not merely auth-denied; `GET /api/history` is owner-scoped (a second user's rows never leak, both directions); served `/api/capabilities` carries `createHistory` but neither `updateHistory` nor `deleteHistory`; the `history` dataset's row shape is exactly `id/item_ref/started_at/ms_played/completed/updated_at`. |

### KourOS backend (`apps/kouros/backend/test/`)

The second consumer of the §3 Wave-17 backend bricks (ToDo §3 18.2) — same house pattern
as PapyrOS's suite, retargeted at a per-track music catalog (`unit:'file'` scanning,
`artist`/`album`/`albumartist`/`track_no`/`disc_no`/`year`/`genres`, no compat ladder).

| File | Assertions | Owns |
|------|-----------|------|
| `library.smoke.mjs` | 50 | End-to-end: boots the real server against a committed 3-track, 2-album fixture library (`test/fixtures/library/`, regenerate via its `gen-fixtures.sh`), polls `/api/tracks` for the non-blocking boot scan to land, then asserts `/health`, `/api/capabilities` (`rescanLibrary` is `kouros:admin`-scoped) + `/api/datasets` doc shape (all four datasets declared), `unit:'file'` scanning producing 3 INDEPENDENT track rows (not 1-per-folder — each track's OWN duration, never summed), the `album_artist`-tag→`albumartist`-column mapping AND its fallback to the plain `artist` tag when a track carries no dedicated album-artist tag, and the `title`/`artist`(prefix)/`album`(exact)/`genre`(tags-op) filters — the artist→album→track hierarchy browse contract, proven live. **Requires `ffprobe` on PATH** — SKIPS cleanly (exit 0, loud warning) if absent. |
| `playback.smoke.mjs` | 43 | The playback + per-user-collection backend: boots the real server with a REAL RS256 keypair (forged per-user tokens) against the fixture library. Range-aware `GET /api/stream/:trackId/0` (`Range: bytes=0-1023` → 206 with the true `Content-Range`/`Content-Length`/body-length trio off the actual file size; a plain GET → 200 whole-file; an out-of-bounds Range → 416 with `Content-Range: bytes */<total>` — kouros has no compat ladder, so unlike papyros there's no `?compat=` surface here); `GET /api/cover/:trackId` → 200 against a real folder-level `cover.jpg`, 404 for a cover-less track; an unauthenticated media request → 401. `playlists` owner-scoped CRUD round-trip (A/B never see each other's rows; `track_refs` round-trips as a real ordered JS array through the `list:true` JSON-array-TEXT convention; a PATCH reorders it; cross-user PATCH/DELETE → 404; DELETE actually removes the row). `ratings` UNIQUE(user_id, track_ref) + upsert-on-conflict trigger (18.2's day-one hardening, the papyros 17.5 lesson applied up front): a second POST for the same (user, track) is 201 — not a raw-constraint 500 — replaces the value with a NEW autoincrement id (delete-then-insert, not an UPDATE), exactly one row survives per user/track, and a different user's rating on the SAME track is untouched (the trigger's WHERE is scoped to `user_id`, not `track_ref` alone). Same `ffprobe` skip gate as `library.smoke.mjs`. |
| `history.smoke.mjs` | 25 | Play-history — mirrors papyros's `history.smoke.mjs` almost verbatim (`item_ref` points at `kouros.tracks` instead of `papyros.books`): boots the real server with `MUSIC_DIR` pointed at an EMPTY temp dir, no `ffprobe` dependency, never skips. Same assertions: 401 gate, append-only create (a second create for the same track APPENDS, no collapse — the deliberate opposite of `ratings`' upsert behavior), `PATCH`/`DELETE /api/history/:id` → 404 (routes never mounted), owner-scoped list, and the served discovery docs reflecting the append-only contract. |

Chained into `apps/kouros/backend/package.json`'s `test` script and
`pnpm --filter @jkos/kouros-backend test` in root `test:contracts`, right after
`papyros-backend`.

### Cross-system (root `test/` + `packages/suite-prober/` + scripts)

| Runner | Owns |
|--------|------|
| `pnpm roundtrip` (`suite-prober/roundtrip.mjs`, 23) | The WRITE round-trip: boots the real BB backend, discovers create/update/complete/delete + the items dataset from the served docs (no hardcoded shapes), then create→read-back→`?since` cursor→update→complete→delete→verify-clean. Rows tagged `ext_ref:'prober:<runid>'` + prefix-swept — staging-safe in `--live` mode. |
| `pnpm test:cards` (`test/cards-logic.mjs`, 49) | The REAL pure functions (`design/utils/color.ts`, `cards/src/datetime.ts`) transpiled in-memory: withAlpha hex/var/clamp, time↔fraction, week/month math, lane packing. |
| `pnpm check:tokens` | Token mirrors byte-identical + `test/tokens-parity.mjs`: paper/dark accent-derivation SET parity (16 vars, membership by naming convention) + CRT knob ownership pin. |
| `pnpm check:nginx` | All four generated nginx files (`weave-proxy.conf`, `weave-proxy-staging.conf`, `apps-generated.conf`, `apps-generated-staging.conf`) match the `@jkos/suite-manifest` derivation. |
| `pnpm check:responsive` (`test/responsive.mjs`) | Breakpoint single-source: `@media` bounds == `BREAKPOINT_MAX`, `MEDIA` derives, tap floor on the right primitives, retired magic numbers stay dead. |
| `pnpm check:drag` (`test/drag.mjs`) | One `usePointerDrag` gesture primitive; no second drag system. |
| `pnpm check:cards` (`test/cards-purity.mjs`) | Kit purity text-scan (comment-stripped): no app ids, no host CSS classes, no raw alpha-concat in `@jkos/cards`/`@jkos/ui`. |
| `pnpm check:hud` (`apps/ordeck/scripts/check-hud-doc.mjs`) | HUD doc validity (every placed id has a def, footprints within grid + ≥ `minSize`, shelf resolves) + the REAL `mergePublished` healer is idempotent (merge∘merge byte-identical; `userSized` cells untouched). Also a fleet tool: `<file.json>` or `--live`. |
| `pnpm check:docker` (`test/dockerfile-inject.mjs`) | Every app Dockerfile that builds a frontend after `COPY . .` re-runs `pnpm install` first — so an injected `packages/*` workspace dep (e.g. `@jkos/weave`) doesn't build against a stale, manifest-only install. Root-caused a real papyros wave-6 deploy break (2026-07-09, TS2307) before this gate existed. |
| `pnpm check:async-view` (`test/async-view.mjs`) | The loading/error/empty triad stays on ONE `AsyncView` component (three PapyrOS views once hand-rolled it three ways); barrel is the only sanctioned import path. |
| `pnpm check:overlay` (`test/overlay-panel.mjs`) | BeigeBoard's detail panel stays an **overlay** on the app-shell grid, never a member of it — a regression gate for a bug that shipped twice (transform-as-containing-block, then the definite-placement row collapse). |
| `pnpm check:design` (`test/design-page.mjs`) | `/design` is an honest built snapshot: not STALE (rebuild in memory + diff the committed file) and not INCOMPLETE (every top-level hub.css class is demoed in `design-template.html`). |
| `pnpm check:text` (`test/text-purity.mjs`) | Every tracked source file is really **text** — no NUL/C0 control bytes. The rest of this table is text scanners, and `git`/`grep` silently skip a file they think is binary, so one raw byte can make a file invisible to the gate policing it. Caught a real NUL in papyros's `format.ts` (2026-07-30). Skips `apps/sylibos/`. |
| `pnpm check:auth` (`test/auth-single-source.mjs`) | One session state machine for the suite: `@jkos/auth-client`'s `useAuthProvider` owns it, the bootstrap order (`getMe` → `refreshToken` → retry → logged-out) survives, and ORDECK/PapyrOS/KourOS stay thin re-exports instead of the three copies they were. |
| `pnpm prove` (`suite-prober/prove.mjs`) | The prober (below). |
| `bash jkos-deploy/scripts/selftest.sh` | Deploy-pipeline dry-run: scripts parse + carry the load-bearing steps, every compose file passes `docker compose config`, current nginx conf loads in a throwaway container, break-glass gates hold. Read-only; SKIPs cleanly (exit 0) without docker/openssl. Not in the gate (needs a docker daemon); the auth half is gate-wired via `contracts.mjs`. |

## The suite prober (the conformance instrument)

`packages/suite-prober` is a **synthetic sixth app**: it discovers the suite the way Weave
does (manifest → registry seed → nginx peers → each app's capability/dataset docs) — but
from the source-of-truth *files*, so it runs in a plain checkout. It asserts the
cross-system invariants a real new app would rely on: single-source app identity, doc
shapes, filter enforcement declared==enforced, edge reachability, env/config conformance
(every secret-shaped `process.env` read is provisioned somewhere), and typecheck coverage
(every TS package is reachable from `pnpm typecheck` — `turbo run` skips a package with no
such script and still reports success, so half the workspace once went unchecked while the
command looked green).

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
