# jkOS — Testing & Commands

Every command you can run in this suite, what every test and gate asserts, and how to add
one. When this doc disagrees with the code, the code wins — update this. `pnpm check:docs`
holds this file to the gate: every suite the gate runs and every `check:*` script must be
named here, or the gate goes red.

## Commands

Everything runs from the repo root `/media/jag/The Forge/jkOS` (quote it — the path has a space).

| Command | What it does |
|---------|-------------|
| `pnpm install` | One workspace install. **Also required after editing any `packages/*` source** — pnpm copies workspace packages into `.pnpm`, so consumers won't see your edit until you re-run it. |
| `pnpm typecheck` | `turbo run typecheck` — cheapest whole-suite signal. **Not** part of the gate; run it after touching any TS. |
| `pnpm build` / `pnpm dev` | `turbo run build` / `dev`. `pnpm --filter @jkos/<app> build` for one. ORDECK's `vite dev` is broken (CJS `codes.js`); verify it with `build` + `preview`. |
| `pnpm test:contracts` | **The gate.** Every backend smoke, the round-trip, every `check:*`, the prober. Exit 0 = green. |
| `pnpm prove` | The suite prober — read-only cross-system conformance report (below). |
| `pnpm roundtrip` | The write round-trip — boots the real BeigeBoard backend and drives create→read→update→complete→delete through discovered docs. |
| `pnpm test:cards` | Pure-logic unit tests for `@jkos/design` colour + `@jkos/cards` datetime math. |
| `pnpm check:<name>` | One conformance gate on its own (table below); each is also inside `test:contracts`. |
| `pnpm new-app <id>` | Scaffold a conformant app — see [WEAVE.md §4](WEAVE.md). `--remove` undoes it. |

Per-app runners, to localize a gate failure:

```bash
pnpm --filter @jkos/jkauth test                # auth smoke + lifecycle + multiuser + security + account
pnpm --filter @jkos/jkauth test:contracts      # codes/issuer/python bridge only
pnpm --filter @jkos/beigeboard-backend test    # all BeigeBoard smokes
pnpm --filter @jkos/lazuros-backend test       # queue/providers/writeback/worker-e2e
pnpm --filter @jkos/files test                 # Range-stream + path containment
pnpm --filter @jkos/kouros-backend test        # music + audiobook + importer smokes (needs ffprobe + ffmpeg)
pnpm --filter @jkos/player test                # timeline/queue/backend/engine
pnpm --filter @jkos/scene test                 # the 3-D primitive's pure layer
pnpm --filter @jkos/weave test                 # weave + lego + idempotency + scanner/media/cursor
python3 apps/lazuros/worker/test/worker.smoke.py   # worker unit half (mocked State node)
bash jkos-deploy/scripts/selftest.sh           # deploy-pipeline dry-run (read-only)
cd music && ./.venv/bin/python -m unittest discover   # music/ — NOT on the node gate
pnpm android:build -- :home:testDebugUnitTest      # jkOS Home's OriginPolicy vs origin-cases.json — needs the JDK, NOT on the node gate
```

Prober, beyond the gate:

```bash
node packages/suite-prober/prove.mjs --json                             # machine report
node packages/suite-prober/prove.mjs --live https://staging.jkos.net --token <jwt>   # deployed stack
node packages/suite-prober/roundtrip.mjs --live <base> --token <jwt>    # live WRITE check, staging-safe
```

Two Claude Code skills encode the suite's knowledge: **`/suite-health`** (runs these layers
in order and maps failure signatures to known causes) and **`/new-tester`** (the house-pattern
playbook for adding a test and wiring it into the gate).

## The layers (run in this order, stop at the first red)

1. **`pnpm typecheck`** — cheapest signal; a type error means the source doesn't cohere.
   ⚠️ **NOT part of `test:contracts`** — run it separately after touching any TS.
2. **`pnpm test:contracts`** — THE gate. Every hard contract in one chain; exit 0 is the
   definition of "green". Run after every meaningful change.
3. **Per-app tests** — to localize a gate failure (`pnpm --filter @jkos/<pkg> test`).
4. **`pnpm prove --live <base>`** — post-deploy smoke against a running stack.

The `/suite-health` skill automates this walk and maps failure signatures to known fixes.

## ⚠️ The harness contract (read before writing a smoke)

Four properties every boot-real-server smoke depends on. Each exists because its absence
cost a real debugging session, and none of them was written down until now.

- **`/health` names the SERVICE, and the smoke asserts WHICH.** A bare 200 proves only
  that *something* is on the port. A stray server from another app once passed eight
  assertions on a shared port (OPS-1), so every harness checks `body.service` and says so
  when a stranger answers.
- **Fail fast on early child exit.** The wait loop watches for the child's `exit` before
  polling again — otherwise a server that dies at boot is indistinguishable from one that
  is slow, and you wait out the whole timeout for a crash you could have printed.
- **The server log prints on ANY failure.** A red assertion without the server's own
  output is a guess.
- **A non-zero exit when the server never booted.** This used to exit 0 — a whole smoke
  reporting success by never running.
- **⚠️ Ports come from `TEST_PORTS` in `@jkos/suite-manifest`, not from a literal.** The
  `port-registry` prober probe holds every file's literal to its claim, so two smokes
  cannot silently share a port. Claim a new one there first.
- **⚠️ A temp directory you make, you remove** — `process.on('exit', () => rmSync(tmp, {
  recursive: true, force: true }))` right after the `mkdtempSync`, which also runs when the
  test fails. Seventeen gate tests once left a directory in /tmp on every run (one holding
  a signed token); the `temp-dirs` prober probe now fails the gate on a test that makes one
  and never removes it.
- **⚠️ Boot budget is 12 seconds, not 5.** Nine servers boot in one gate run while other
  suites work the same machine; a cold Node boot plus migrations plus bcrypt seeding
  exceeds 5s under that load. The symptom is `"E3 never became healthy"` in the gate while
  every standalone run passes. If you see it, re-run before believing it.

## Test inventory

### jkAuth (`apps/jkauth/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `contracts.mjs` | 30 | Codes vocab node↔python key-for-key parity; issuer/cookie single-source; token shape; the python bridge (numeric-`sub` REJECTED, break-glass gates). Run via `test:contracts` filter. |
| `smoke.mjs` | 76 | The in-process auth flows: register/login/logout, cookie flags, 2FA, rate limits, registry directory. *(One 429-timing lockout assertion can blip in a long chain — passes in isolation; re-run before treating as real.)* |
| `lifecycle.mjs` | 24 | The session lifecycle through the REAL verify→write-gate chain: silent refresh + rotation reuse detection, expiry, guest `READ_ONLY`, service `NO_USER_CONTEXT`, on-behalf-of delegation lands as the acting user, python-jose cross-verify of real tokens. |
| `multiuser.mjs` | 27 | Multi-user contracts: preference isolation, deep-merge preserving sibling slices, the 409-conflict-then-retry race, role-scoped widget visibility, per-user audit scoping, delegated-mint attribution. |
| `security.mjs` | 55 | **The 2026-08-26 audit's six high-severity fixes, pinned against a REAL server on a throwaway DB with tight TTLs** — the guest credential actually compared (JK-A1), reuse detection over the token's whole life with the burned family kept as a TOMBSTONE not a DELETE (JK-A2/A10), idle and absolute session TTLs, sealed TOTP secrets, the session-cap tie-break. ⚠️ **Also holds JK-A20:** a benign rotation race on a server-rendered GET must still render the portal — `resolveOrRefresh` used to read the loser as signed-out and bounce it to /auth/login. Its `REFRESH_GRACE_MS` is 400 ms, not 50: the race assertion needs a real request to finish inside the window, and a false positive here would read as theft. |
| `account.mjs` | 39 | **The four absences Stage C built** (migration 018): password change, password reset, email verification, the devices view. ⚠️ **Including the one assertion the suite had never had — an EXPIRED one-time code.** It tested a wrong code and a replayed code, and the 2026-08-31 audit found `verifyEmailOtp` comparing ISO against `datetime('now')` so nothing expired inside a UTC day. The backdating is to the SAME UTC day on purpose: a code expired yesterday is refused even by the broken comparison. |

### BeigeBoard backend (`apps/beigeboard/backend/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `import.smoke.mjs` | 46 | The import pipeline: nested/flat forms, validate-then-write, `?dryRun=1`, and **§J** — dedup at the door LazurOS writes back through (a repeated key imports once, counted in rows; a dry run or a rejected plan does not consume the key). **The house-pattern exemplar** — boot the real server on a throwaway port + temp SQLite DB + dev-stub auth, assert over real HTTP. |
| `items.smoke.mjs` | 80 | Direct CRUD hardening (plus **§O**, the activity contract, **§P/§Q**, the dependency graph and the planner's missing facts — D6/D12, and **§R**, dedup at `createItem`: one row per key, the same key from another user writing that user's own row): user scoping (A can't touch B), parent-cycle rejection, cascade delete, the reserved-source guard (`source:'google'` → 400), cap/date validation parity, service identities don't trigger the demo seed, OAuth-callback public-path behaviour, AI output sanitisation (mock LazurOS booted in-harness). |
| `delta.smoke.mjs` | 14 | The `?since` cursor contract under millisecond `updated_at` stamps (no same-second row loss). |
| `contract.smoke.mjs` | 14 | Declared == enforced, generically: a real row's keys ⊆ the declared `items` shape; every declared `max`/`date`/`time` constraint actually 400s on POST and PATCH; reserved sources rejected. |
| `calendar.sandbox.mjs` | 44 | Fixture-driven calendar providers (no HTTP, no accounts): same-event-same-times across google/outlook/icloud, all-day exclusive-end agreement, the empty-upstream wipe guard (skip vs `?force=1`), the iCloud TZID/RRULE limitations PINNED as documented, `CALENDAR_ENC_KEY` encrypt→not-plaintext→decrypt + legacy-plaintext passthrough. **§H (D5/BB-15):** the CALLER'S zone decides the wall clock, not the host's — ⚠️ this file used to run under `TZ=UTC` "for determinism", and that pin WAS the bug; it now runs under `TZ=Pacific/Marquesas`, chosen because it is WEST of UTC (an exclusive-end off-by-one cancels itself out east of Greenwich, so a `+12:45` host passes buggy code) and off the hour. **§I (D10/BB-12):** a re-sync CASCADES — a note nested under a synced event goes with its parent instead of being orphaned, which the old raw `DELETE` did on EVERY sync. |
| `routines.smoke.mjs` | 78 | The cadence engine end-to-end. **§L (D7/BB-3):** the ref is the authority — an occurrence dragged out of its routine's subtree is still withdrawn, re-rendered and counted (five of six readers used to key on `parent_id`). **§I1–I3 (D7/BB-1):** a FILTERED read rolls the horizon, and so does a DELEGATED service token — the old guard disabled the engine for both. **§M (D12/BB-16):** a routine declares what it mints, so a standing weekly meeting is an `event`. ⚠️ Pinning "today" needs `JKOS_TIME_TRAVEL=1` on the child (see the harness contract). |
| `routine-spec.smoke.mjs` | 113 | The routine document over real HTTP — validation, the lint tier, the round trip, the vocabulary. |

### Weave (`packages/weave/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `weave.mjs` | 62 | docShape envelope, capability/dataset schema, `AppId` d.ts ⇄ runtime parity, manifest derivations. |
| `lego.mjs` | 108 | The Layer-D bricks: `defineCollection` (ddl/docs/mount coherence), `defineConnector`, trigger engine + typed-stud validation, delegation plumbing. Includes regression coverage for two fixed bugs (2026-07-08, found by the audiobook `playback.smoke.mjs`): a `ref` field's numeric value must round-trip as canonical TEXT (`coerceRef()` in `collection.js`), and every affinity-sensitive filter op (`eq`/`gt`, boolean/number/ref-typed fields) must coerce the bound query value to match its column (`coerceFilterValue()` in `filters.js`). Section "D1b" (2026-07-15, git history (item 17.4)) covers `defineCollection`'s `only: [...]` capability/route-selection option — an append-only collection emits ONLY `createX` (no `updateX`/`deleteX`), and live-mounts GET+POST while PATCH/DELETE are proven NOT wired at all (not merely auth-denied), plus a real-SQLite append-not-upsert round trip. |
| `idempotency.mjs` | 42 | **Dedup at the write door**. The trigger engine always sent a derived `idempotency_key`, and the docs claimed that meant a retried DO could not double-write — it did not, because idempotency is a property of the RECEIVER and nothing read the key. ⚠️ **The reason that survived is the shape of the test that covered it:** `check:rulings` exercises the SENDING half against an injected dispatcher and proves the key is derived and stable, never that anything acts on it. So every assertion here writes through the REAL generated route into REAL SQLite and then **counts rows** — a test that only inspected responses would pass against a door that wrote twice and answered identically both times. Covers: the key reader (blank / non-string / over-long all mean NO DEDUP rather than an error, because every hand-made GUI write arrives without one); the field being DECLARED on `create*` and deliberately not on `update*`; a retry creating one row and replaying the first response with `Idempotent-Replay: true`; **the same key from a different user writing that user's own row** (a per-user delegated DO fans one trigger out to N users carrying the same key, and a global store would answer B with A's row — a 200 and no error anywhere); atomicity (a write that throws rolls back its row AND its key, so a genuine retry can still write); the same key at a different door; unscoped collections deduping across users; a present-but-unusable key (over-long, non-string) refused with 400 rather than writing undeduplicated; and retention — ⚠️ asserted through the WRITE path, with nobody calling `prune`, because `prune` had no call sites and the 30-day ceiling was never enforced. |
| `libraryScanner.mjs` | 53 | The shared media-library scanner behind KourOS's music and audiobook catalogs: walk, tag-extract, aggregate, and the incremental re-scan path. |
| `mediaRoutes.mjs` | 36 | The media route factory — range requests, path containment, the cover/stream surface every media backend mounts. |
| `resumeCursor.mjs` | — | The `?since=` delta cursor's own arithmetic, which XC-1 made portable. Prints pass/fail rather than a count. |

### Player (`packages/player/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `core.test.mjs` | 84 | Layer 0, transpiled pure: timeline math parity with the retired `position.ts` (cumulative starts, `locate` boundary rule — an exact file edge belongs to the LATER source at offset 0, clamp-at-total, defensive `.index` sort, zero/negative-duration hygiene, `fmtClock`) + every `Queue` reducer, incl. the shuffle-stability property (same seed ⇒ same permutation; skips never re-roll; only a structural change or a new seed resyncs) and the cursor-follows-item `reorder` cases. |
| `backend.test.mjs` | 40 | `createHtmlMediaBackend` against a scripted fake element (no DOM): DOM-event → `BackendEvent` forwarding, `MediaError.code` 1-4 → kind classification, play()-rejection classification (`NotAllowedError`→`autoplay-blocked`, `NotSupportedError`→`src-unsupported`, `AbortError`→`aborted`), paired add/remove listener wiring, idempotent `dispose()`. |
| `engine.test.mjs` | 34 | The engine's pure helpers, transpiled: rate persistence guards (non-preset/throwing store → 1), the 7-step `nextRate` cycle, `compatKey`, recoverable-kind gating, ladder escalation arithmetic (`canEscalate`/`nextCompatLevel`/`effectiveStartLevel` — session bump beats initial rung via `Math.max`). |

The engine hook itself has no DOM to run in under the house Node-only test style — its
six load-bearing invariants are pinned by inline `[INVARIANT x]` tags in
`packages/player/src/engine/usePlayerEngine.ts` and verified against the pre-migration
audiobook engine by review (Wave 15, 2026-07-14); in-browser behavior (autoplay veto,
Firefox compat recovery, offline SW) is confirmed manually on staging.

### LazurOS (`apps/lazuros/backend/test/` + `apps/lazuros/worker/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `queue.smoke.mjs` | 28 | Job queue lifecycle `PENDING → … → DONE\|FAILED`, owner scoping, atomic claim. |
| `providers.smoke.mjs` | 32 | Provider factories (STT/TTS/embedding/webSearch) against a mocked `fetch`; config-driven `baseUrl` contract. |
| `writeback.smoke.mjs` | 20 | State-node delegated write-back (injected client): import-as-acting-user, review-first `parse-document`, best-effort failure recording, and the idempotency key — the same for both write-backs of one job (a reaped job can finish twice), different across jobs, never chosen by the model's output. |
| `worker-e2e.smoke.mjs` | 35 | The full seam: real State node + real `worker.py process_once` (via `python3`) against the live bearer-gated `/internal` API, only Ollama faked; `PENDING_WAKEUP` path; write-back invocation; a repeated key at a job door enqueuing ONE job, counted, with the key kept out of the stored payload. **Gotcha pinned in its header:** drive the worker via async `spawn`, never `spawnSync` — a sync child freezes the event loop that must answer it. |
| `worker/test/worker.smoke.py` | 19 | Worker unit half against a mocked State node (claim race, unconfigured cap, infer error). Run: `python3 apps/lazuros/worker/test/worker.smoke.py`. |
| `worker-py.smoke.mjs` | (wraps 19) | The node shim that runs `worker.smoke.py` inside the node gate, so the Python half cannot be green-by-absence when `python3` is missing. |

### KourOS backend (`apps/kouros/backend/test/`)

Both consumers of the §3 Wave-17 backend bricks, in one app: the music suite (`unit:'file'` scanning, `artist`/`album`/`albumartist`/
`track_no`/`disc_no`/`year`/`genres`, no compat ladder) and — under `books.*` — the
audiobook suite (`unit:'dir'`, chapters, the compat ladder), plus the one-shot importer.

| File | Assertions | Owns |
|------|-----------|------|
| `library.smoke.mjs` | 50 | End-to-end: boots the real server against a committed 3-track, 2-album fixture library (`test/fixtures/library/`, regenerate via its `gen-fixtures.sh`), polls `/api/tracks` for the non-blocking boot scan to land, then asserts `/health`, `/api/capabilities` (`rescanLibrary` is `kouros:admin`-scoped) + `/api/datasets` doc shape (all four datasets declared), `unit:'file'` scanning producing 3 INDEPENDENT track rows (not 1-per-folder — each track's OWN duration, never summed), the `album_artist`-tag→`albumartist`-column mapping AND its fallback to the plain `artist` tag when a track carries no dedicated album-artist tag, and the `title`/`artist`(prefix)/`album`(exact)/`genre`(tags-op) filters — the artist→album→track hierarchy browse contract, proven live. **Requires `ffprobe` on PATH** — SKIPS cleanly (exit 0, loud warning) if absent. |
| `playback.smoke.mjs` | 43 | The playback + per-user-collection backend: boots the real server with a REAL RS256 keypair (forged per-user tokens) against the fixture library. Range-aware `GET /api/stream/:trackId/0` (`Range: bytes=0-1023` → 206 with the true `Content-Range`/`Content-Length`/body-length trio off the actual file size; a plain GET → 200 whole-file; an out-of-bounds Range → 416 with `Content-Range: bytes */<total>` — the music half has no compat ladder, so there's no `?compat=` surface here); `GET /api/cover/:trackId` → 200 against a real folder-level `cover.jpg`, 404 for a cover-less track; an unauthenticated media request → 401. `playlists` owner-scoped CRUD round-trip (A/B never see each other's rows; `track_refs` round-trips as a real ordered JS array through the `list:true` JSON-array-TEXT convention; a PATCH reorders it; cross-user PATCH/DELETE → 404; DELETE actually removes the row). `ratings` UNIQUE(user_id, track_ref) + upsert-on-conflict trigger (18.2's day-one hardening, the 17.5 lesson applied up front): a second POST for the same (user, track) is 201 — not a raw-constraint 500 — replaces the value with a NEW autoincrement id (delete-then-insert, not an UPDATE), exactly one row survives per user/track, and a different user's rating on the SAME track is untouched (the trigger's WHERE is scoped to `user_id`, not `track_ref` alone). Same `ffprobe` skip gate as `library.smoke.mjs`. |
| `history.smoke.mjs` | 47 | Play-history — mirrors the audiobook app's former `history.smoke.mjs` almost verbatim, **including its §7 activity block. ⚠️ Deliberately duplicated rather than factored into a shared helper: two apps proving one contract is what the contract is FOR, and the shared helper would quietly become the shared implementation the design refuses.** (`item_ref` points at `kouros.tracks` instead of `books`): boots the real server with `MUSIC_DIR` pointed at an EMPTY temp dir, no `ffprobe` dependency, never skips. Same assertions: 401 gate, append-only create (a second create for the same track APPENDS, no collapse — the deliberate opposite of `ratings`' upsert behavior), `PATCH`/`DELETE /api/history/:id` → 404 (routes never mounted), owner-scoped list, the served discovery docs reflecting the append-only contract, and `context` (where a listen was played FROM) refused at the door unless it is a KourOS route. |
| `discover.smoke.mjs` | 48 | **The music vector seam, and the only test that crosses it** — the embedder's `index.db` vectors resolving onto the real catalog by absolute path, `/discover/similar|radio|run|map|stats`, and the DEGRADE contract: with no `VECTOR_DB_PATH` or a backfill that has not reached a row, every one of these answers from metadata affinity and says so in its `basis` rather than failing. ⚠️ That degradation is why `discoverStats` is declared at all — it is how a consumer tells "no results" from "no index", and without this suite a silently-empty vector space would look exactly like a quiet library. **§7 (2026-09-16): a delivery to a running server** — both analysis files replaced by rename under a live KourOS, and the upload's track, vectors and mesh must all arrive with no restart (a mesh handle held open forever reads the unlinked inode; nothing else walks `MUSIC_DIR` after boot), while an idle TTL over an unchanged file must not rebuild. Each of the six was proven able to fail against the code before it. |
| `home.smoke.mjs` | 15 | **The Home rails that read a listener's own ledgers** — over real HTTP, two forged listeners, both fixture libraries. "Recently played" is one tile per CONTEXT (album/playlist/artist/station/book — `backend/src/playContext.js`), newest first, each resolved (a playlist by its NAME, a station by its seed); a context-less listen makes no tile; a playlist context never resolves for anyone but its owner. "Continue listening" is unfinished books only. And `deep_in` is non-empty — ⚠️ **it had been empty for every listener since it shipped** (`history.item_ref` is TEXT, the lookup Map INTEGER-keyed — `home.js`'s `trackIndexOf`); proven to fail with that coercion removed. |
| `session.smoke.mjs` | 110 | **The listening session ("Connect")** — two listeners, three devices each, over raw HTTP and raw SSE read with `fetch` (as the client reads it — `EventSource` cannot see a status). The stream's 401/404/headers (`X-Accel-Buffering: no`, `no-transform`), `hello`, live presence, and `reauth`-then-close AT the token's `exp`. Only the OUTPUT may report (409 `NOT_ACTIVE`); a command reaches the output and nowhere else, a `volume` the device it names; no output → 409 `NO_ACTIVE_DEVICE`; a transfer releases the old output and hands the new one the EXTRAPOLATED position. Listener B never sees an event of A's and cannot address A's device ids. `idempotency_key` relays once and replays — and a 409 is **not** remembered, so the same key succeeds once an output exists. The vanished output: recorded paused after the grace (`KOUROS_SESSION_OFFLINE_GRACE_MS`, shortened here) at the second its stream CLOSED, not undone by a remote leaving, cancelled by a reconnect within it; `reported_at` re-anchors on a repeated report. **An output that goes silent without closing anything** (a phone out of signal — the socket stays "open") is presumed gone after the report watchdog (`KOUROS_SESSION_STALE_MS`), paused at the last position it REPORTED, and its zombie streams dropped. The output's sleep timer rides the report and is cleared by a transfer. A device that is not the output announces its own volume through registration, so the picker's fader for it is true. Plus the pure validator (a working player's stale shuffle order — TRAPS.md), limits (20 streams, a write bucket, per listener). **Proven to fail against six mutations**, one per fix it pins. No `ffprobe` needed. |
| `books.probe.smoke.mjs` | 35 | **The audiobook half.** The PURE tag mapping of `src/books/probe.js` against hand-authored ffprobe JSON (`test/fixtures/books/probe/`): casing-inconsistent tags, missing tags, multi-genre delimiters, `album`→series (and album == title → no series), `composer`→narrator. No `ffprobe`, no DB. |
| `books.library.smoke.mjs` | 50 | The book scanner beside the music one: boots the real server with `MUSIC_DIR` absent and `AUDIOBOOKS_DIR` at the committed 2-book fixture (`test/fixtures/books/library/`), and asserts the `unit:'dir'` scan (one row per folder, a two-file book's summed duration and track-tag file order, embedded chapters), the `/api/books` `title`/`genre` filters, and the discovery docs. Skips cleanly without `ffprobe`. |
| `books.playback.smoke.mjs` | 58 | Book media under `/api/books/stream|cover` — **prefixed so book 12 and track 12 never answer on one URL** — with the compat ladder (prepare → poll → `?compat=1` 206 off the variant's own size, 404-before-prepare, bogus level → 4xx, source-mtime regeneration) writing under `<data>/books/compat/`; owner-scoped `progress` with its day-one UNIQUE + upsert trigger and the `finished` filter in both wire forms. Needs `ffprobe` + `ffmpeg`. |
| `books.meta.smoke.mjs` | 40 | The iTunes `META` connector and `matchBook` with `fetch` mocked before `server.js` loads (`fixtures/books/meta/fetch-mock-preload.cjs`): all 7 mapped fields, the exact upstream URL, the metadata write leaving the scanner's title alone, the 600×600 cover landing under `<data>/books/covers/`, and `matchAllMissing`'s admin gate. |
| `books.history.smoke.mjs` | 40 | `book_history`, the audiobook ledger (a separate table because a `ref` names one target): 401 gate, append-only (PATCH/DELETE not mounted), owner scoping both ways, `createBookHistory` and nothing else declared — and **the activity read over BOTH ledgers**: a book listen is kind `book`, ref `kouros:book:<id>` (a bare `kouros:7` is TRACK 7), id `book_history:<n>`. |
| `import-papyros.smoke.mjs` | 33 | `scripts/import-papyros.js` — the one-shot carry of PapyrOS's per-user state into KourOS — against the two databases a deploy really has: a source built from the FROZEN PapyrOS schema (`fixtures/books/papyros-schema.sql`, dumped from a database PapyrOS's own migrations built) and a target KourOS's own `server.js` migrated, then seeded the way a boot scan leaves it — **the same books under different ids**. Asserts books map by PATH (so progress/bookmarks/history follow each book to its new id), an unscanned book is inserted without stealing a taken id, a person's iTunes match and cover come across while embedded-only rows are left alone, a newer KourOS progress row is never rolled back, clubs are reported not imported, a live `-wal` source is refused with the `VACUUM INTO` recipe, a dry run writes nothing, and a second `--apply` is a no-op. Proven to fail (5 assertions) with ids copied straight across. |

Chained into `apps/kouros/backend/package.json`'s `test` script and
`pnpm --filter @jkos/kouros-backend test` in root `test:contracts`, right after
`@jkos/files`.

### @jkos/files (`packages/files/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `files.smoke.mjs` | 29 | The Range-stream + path-containment contract against a real `http.createServer` — 200/206/416, `Accept-Ranges`/`Content-Range`, and the containment guard that stops a crafted path escaping the served root. **This is the base surface every media backend is built on**, which is why it is tested once here rather than five times downstream. |

### @jkos/scene (`packages/scene/test/`)

| File | Assertions | Owns |
|------|-----------|------|
| `scene.test.mjs` | 79 | The 3-D primitive's pure layer (`src/math/`), transpiled by `transpile.mjs` — the helper KourOS's `check:pulsarmap` / `check:vibespace` also load it through. The spring is SOLVED (never overshoots from rest, settled by 1 s, 30 fps and 144 fps land in the same place) and `settle` SNAPS onto its goal (a resting picture must not depend on how it got there); the orbit rig glides and lands on its goals, turns the short way across ±π, coasts a flicked free yaw to rest, leaves a HELD yaw/pitch exactly where the hand put them, and cuts under reduced motion; `orbitDrag` never leaves its bounds; `fitDistance` frames a sphere in a portrait frame at every yaw; the matrices agree (lookAt + perspective centre the target, `invert` round-trips and refuses a singular matrix, `toScreen` never mirrors a point behind the camera); picking, ray/box, label thinning, the axis lock, velocity and double-tap; the matrix-as-texture layout (every cell of a wrapped 2,500-row matrix round-trips, and `MATRIX_TEXEL_GLSL` is the same arithmetic); OKLCH both ways. Plus the layering scans: nothing in `math/` has a clock, a DOM reference or an import outside its own layer (a Web Worker loads it), and `gl/` imports no React. The one-engine rule across the suite is `check:scene`. |

### Cross-system and the conformance gates (root `test/` + `packages/suite-prober/` + scripts)

There are **33 individual conformance gates** — the `pnpm check:*` rows below. Each re-derives one
suite-wide invariant from source rather than trusting a doc, and each is also inside `test:contracts`.

| Runner | Owns |
|--------|------|
| `pnpm roundtrip` (`suite-prober/roundtrip.mjs`, 23) | The WRITE round-trip: boots the real BB backend, discovers create/update/complete/delete + the items dataset from the served docs (no hardcoded shapes), then create→read-back→`?since` cursor→update→complete→delete→verify-clean. Rows tagged `ext_ref:'prober:<runid>'` + prefix-swept — staging-safe in `--live` mode. |
| `pnpm test:cards` (`test/cards-logic.mjs`, 154) | The REAL pure functions (`design/utils/color.ts`, `cards/src/datetime.ts`) transpiled in-memory: withAlpha hex/var/clamp, time↔fraction, week/month math, lane packing. |
| `pnpm check:tokens` | Token mirrors byte-identical + `test/tokens-parity.mjs`: paper/dark accent-derivation SET parity (16 vars, membership by naming convention) + CRT knob ownership pin. |
| `pnpm check:nginx` | All four generated nginx files (`weave-proxy.conf`, `weave-proxy-staging.conf`, `apps-generated.conf`, `apps-generated-staging.conf`) match the `@jkos/suite-manifest` derivation. Also: **every origin an Android TWA trusts serves `/.well-known/assetlinks.json`** — derived from `native/shells.js`, checked against generated AND hand-written server blocks; an origin without it opens under a URL bar with no error anywhere. Verified red against the pre-change `standalone.conf` (named `jkos.net` and `beigeboard.jkos.net`). |
| `pnpm check:responsive` (`test/responsive.mjs`) | Breakpoint single-source: `@media` bounds == `BREAKPOINT_MAX`, `MEDIA` derives, tap floor on the right primitives, retired magic numbers stay dead. |
| `pnpm check:drag` (`test/drag.mjs`) | One `usePointerDrag` gesture primitive; no second drag system. |
| `pnpm check:cards` (`test/cards-purity.mjs`) | Kit purity text-scan (comment-stripped): no app ids, no host CSS classes, no raw alpha-concat in `@jkos/cards`/`@jkos/ui`. |
| `pnpm check:hud` (`apps/ordeck/scripts/check-hud-doc.mjs`) | HUD doc validity (every placed id has a def, footprints within grid + ≥ `minSize`, shelf resolves) + the REAL `mergePublished` healer is idempotent (merge∘merge byte-identical; `userSized` cells untouched). Also a fleet tool: `<file.json>` or `--live`. |
| `pnpm check:docker` (`test/dockerfile-inject.mjs`) | Every app Dockerfile that builds a frontend after `COPY . .` re-runs `pnpm install` first — so an injected `packages/*` workspace dep (e.g. `@jkos/weave`) doesn't build against a stale, manifest-only install. Root-caused a real wave-6 deploy break (2026-07-09, TS2307) before this gate existed. |
| `pnpm check:async-view` (`test/async-view.mjs`) | The loading/error/empty triad stays on ONE `AsyncView` component (three audiobook views once hand-rolled it three ways, and BeigeBoard's main region a fourth — XC-6); barrel is the only sanctioned import path. ⚠️ It also pins two places that must NOT adopt it: an inline error banner beside a form that stays on screen (AsyncView REPLACES its children), and ORDECK, whose widgets express this in the declarative `when` vocabulary a React component cannot enter. |
| `pnpm check:overlay` (`test/overlay-panel.mjs`) | BeigeBoard's detail panel stays an **overlay** on the app-shell grid, never a member of it — a regression gate for a bug that shipped twice (transform-as-containing-block, then the definite-placement row collapse). |
| `pnpm check:design` (`test/design-page.mjs`) | `/design` is an honest built snapshot: not STALE (rebuild in memory + diff the committed file) and not INCOMPLETE (every top-level hub.css class is demoed in `design-template.html`). |
| `pnpm check:text` (`test/text-purity.mjs`) | Every tracked source file is really **text** — no NUL/C0 control bytes. The rest of this table is text scanners, and `git`/`grep` silently skip a file they think is binary, so one raw byte can make a file invisible to the gate policing it. Caught a real NUL in a `format.ts` (2026-07-30). |
| `pnpm check:auth` (`test/auth-single-source.mjs`) | One session state machine for the suite: `@jkos/auth-client`'s `useAuthProvider` owns it, the bootstrap order (`getMe` → `refreshToken` → retry → logged-out) survives, and ORDECK/KourOS stay thin re-exports instead of the three copies they once were. |
| `pnpm check:today` (`test/today.mjs`, 13) | **One definition of "today", and one of WHERE** (D5/XC-4). The header literal `X-JKOS-TZ` is identical in its reader (`weave/server/callerDay.js`), its sender (`authFetch`) and the CORS allow-list — three files that cannot import each other, since `@jkos/weave` depends on `@jkos/auth-client`. Also: `authFetch` stamps it for everyone (no per-app opt-in), no backend computes a day straight from the clock, no backend reads a wall-clock field in the host's zone, and the dev-only time-travel override keeps BOTH locks. |
| `pnpm check:refs` (`test/refs.mjs`, 8) | **The `ext_ref` namespace, allocated** (D7/BB-5). Five schemes shared one column and the audit found three; every one is declared now by the app that writes it, globally disjoint, never colliding with an app id or a suite-reserved scheme, projected into the served dataset doc, and never stale. Also carries BB-3's regrowth check: no occurrence reader may hand-write `parent_id = ?` beside an `ext_ref LIKE`. |
| `pnpm check:binding` (`test/binding.mjs`, 21) | **One binding model, two directions** (D13/WV-2). A WidgetSpec binds a dataset into a primitive tree (read); a TriggerDef binds a capability's output into another's body (write). Asserts the trigger engine and the widget renderer take the SAME resolver, that ORDECK's `Binding` type IS weave's, and that no fourth vocabulary regrows. ⚠️ It asserts `resolve()` DELEGATES (its body is one statement) rather than pattern-matching the old implementation — a first version matched the retired scope-walk literally and a re-hand-rolled copy differing only by a cast walked straight past. |
| `pnpm check:columns` (`test/columns.mjs`, 12) | **Declared column invariants, against the REAL database** (Stage E3). Boots it, runs every migration, interrogates `sqlite_master` — a schema is what the engine ended up with, not what a migration meant to do. `indexed` ⇒ a real index; `serverManaged` (derived from `client:false`) ⇒ refused at the write door; `writeOnce` ⇒ checked BEHAVIOURALLY by writing twice through the raw DB past every route. ⚠️ That last one matters: a trigger whose `WHEN` clause no longer matches still EXISTS in `sqlite_master` and passes a shape check. |
| `pnpm check:session` (`test/session-client.mjs`, 41) | **The listening-session client's pure logic** (`apps/kouros/src/session/`), transpiled and driven: the SSE framing (an event split across ANY chunk boundary arrives whole — and ⚠️ a CRLF split MID-event is held back rather than read as a blank line that cuts one event in two; proven to fail without the hold), the 3 s→30 s ±20 % reconnect backoff, the server-clock sample (min round trip wins), a remote's extrapolated position (moves at the rate while playing, holds while paused, never runs backwards on a clock behind the report, capped at the item's end) and sleep countdown, **the one "what is this tab?" decision** (`modeOf`: this device the output but ANOTHER of its tabs plays → remote, never a second copy; proven to fail), and the default device name (Edge and Samsung Internet though their UAs say Chrome; an iPad that says "Macintosh" told apart by touch). |
| `pnpm check:rulings` (`test/rulings.mjs`, 27) | **The four contract rulings** (Stage E6) — a ruling nothing enforces is prose. `resolves` beats `returns` for an async binder; ONE paging default/max (five hand-rolled clamps disagreed); an unknown declaration version fails CLOSED with a named code (an OLDER one still passes — failing closed means refusing the future, not the past); the activity fan-out returns an explicit per-app status list; every trigger DO carries a DERIVED idempotency key. ⚠️ Sameness is the assertion, not presence — a random key satisfies "has a key" while making every retry look like a new write — and so is WIDTH: the key must carry ≥128 bits, because a collision at a receiving door is a write that silently never happens (it was 32). And the RECEIVING half's declaration: every `create*` door, every async door and every LazurOS write-back target declares `idempotency_key` (the targets derived from `writeback.js`'s routing table). It cannot see a route honour the key — each door's smoke counts rows for that. |
| `pnpm check:scopes` (`packages/suite-manifest/scripts/gen-scopes.mjs --check`) | **jkAuth's grant is derived from the capability docs, and its copy is fresh** (D1). jkAuth has no peer source in its image, so the declared scopes reach it as a generated file; this regenerates it in memory and diffs. It also refuses a write capability with no declared scope — three BeigeBoard doors (`importRoutineBundle`, `syncCalendar`, `disconnectCalendar`) were exactly that until it landed, verified by running it against the old doc. The TOKEN side is asserted in `apps/jkauth/test/security.mjs` §N: claims carry only declared scopes, and a service client configured with an undeclared one refuses to boot. |
| `pnpm check:policy` (`test/policy.mjs`, 27) | One authorization policy module; no route re-types a role comparison. ⚠️ **Its regex once matched nothing in the whole service** — it required a leading `.` (`user.role === 'admin'`) and jkAuth's real comparisons are bare, so the gate passed because it could not see a single case. That is what a permanently-zero detector looks like from outside. Exceptions are pinned to EXACT counts now, so they cannot grow a fourth unnoticed. |
| `pnpm check:native` (`native/gen-native.mjs --check` + `test/native.mjs`) | **The native shells stay as locked-down as they were built** — the one place in the suite where a single config token IS the control (`allowBackup`, `nodeIntegration`, a fuse, `--no-sandbox`). Generated per-variant origins in sync with `native/shells.js` (and no stale variant dirs); the desktop `policy.js` agrees with all of `native/origin-cases.json` (the vectors the Android `OriginPolicy.kt` passes under Gradle); webPreferences, the ONE granted permission (pinned exactly), external schemes; `main.js` applies the policy (one window, every navigation/redirect/`window.open` guarded, `openExternal` only via the policy); Electron fuses; `.deb` only; both Android manifests least-privilege (backup + device transfer off, HOME only in jkOS Home, `<queries>` exactly MAIN/LAUNCHER, INTERNET its only permission, https + system CAs); no `addJavascriptInterface`/`proceed()`/file access/mixed content; release signing from the environment only; wrapper, every Gradle dependency, the toolchain and the build image pinned by checksum; every staging URL a debug build opens is routed. **Each of ten mutation classes was seen to turn it red.** See [NATIVE.md](NATIVE.md). |
| `pnpm check:secrets` (`test/secrets.mjs`, 4) | No secret material in **tracked** files — the right scope, since that is what would be published — paired with an assertion that `.gitignore` still excludes `.env`/`*.pem`/`*.key`. ⚠️ It only ever matched VENDOR-SHAPED tokens (PEM, `AKIA…`, `ghp_…`, `sk-…`) until a real account password sat in tracked source as a plain `*_PASSWORD =` assignment, matching none of them. Every green run before that was green *past* it. |
| `pnpm check:audit` (`test/supply-chain.mjs`, 2) | Dependency advisories. **Floor: `high`** (raised 2026-09-16, D4) — any CRITICAL or HIGH fails; moderates and lows print loudly and do not. It sat at `critical` for three weeks on purpose: a floor nobody can turn green on day one is one people learn to skip, so it went up the day the upgrades landed green. Verified red against the pre-upgrade lockfile (7 HIGH). ⚠️ The old claim that every HIGH was build-only was wrong for one — `brace-expansion` reached BeigeBoard's deployed backend — so re-derive reach with `pnpm why -r` per advisory. ⚠️ **Every tracked `pnpm-lock.yaml`**, not just the root one (derived from `git ls-files`): `native/desktop` keeps its own lockfile outside the workspace, and a root-only audit never saw it. Verified red by planting `minimist@1.2.5` (CRITICAL) in the desktop lockfile only. |
| `pnpm check:docs` (`test/docs.mjs`, 85) | **The docs inventory covers the gate** — every suite the chain RUNS is named in this file, every `check:*` has a row in this table, README.md's index links every doc, every repo path the docs cite resolves, and ROUTINE_PROMPT.md still matches its generator. ⚠️ **Assertion counts are deliberately not pinned**: the line is whether a number moves as a side effect of ordinary work (don't pin) or is itself a documentation act (pin) — so the gate count and the trap count ARE held, and per-suite assertion totals are not. |
| `pnpm check:build` (`vite build` ×3) | **Every SPA actually builds.** ORDECK, BeigeBoard, KourOS — `tsc` + `vite build` each, ~5 s total. ⚠️ **Added 2026-09-10 because the gate had no idea whether the suite could be shipped.** BeigeBoard's production build was dead — `@jkos/routine-spec` missing from `commonjsOptions.include`, so rollup could not synthesize the CJS default export — and `pnpm test:contracts` stayed **green through all of it**, because it ran every test, every static check and the prober and never once ran `build`. A gate that cannot tell you the app is unbuildable is green about the wrong thing. Verified to go red when the include is removed. |
| `pnpm check:routine` | `test/routine-spec.mjs` — BeigeBoard's routine spec exists twice (the CommonJS engine that writes every occurrence's prescription, and a TS mirror that renders the forge's live preview); drives both through the same matrix of documents × cycles and compares what they actually produce, since a mirror that's quietly drifted is worse than none and text isn't the contract. |
| `pnpm check:fields` | `test/fields.mjs` — every input in the suite routes through the one `.jk-field` primitive, not an app-local input dialect; `appearance` is reset everywhere a control is drawn by hand. |
| `pnpm check:scroll` | `test/scrollbar.mjs` — the drawn scrollbar hairline renders in BOTH real engines. `@supports selector(::-webkit-scrollbar)` is true in Gecko (Selectors-4 parses unknown `-webkit-` pseudos as valid rather than dropping the rule), so a webkit-only guard silently loses Firefox; this asserts against real headless Chromium + Firefox, not a CSS text-scan. |
| `pnpm check:pulsarmap` | `test/pulsarmap.mjs` — the pure math under the pulsarmap renderer (ALGORITHMS.md §9): the reveal index at the mesh's derived 0.09288 s rows (a renderer assuming the 0.1 s target is 183 rows behind four minutes in), `scrollRow` — the continuous position both renderers are placed by, whose `floor` IS the reveal index at every instant and which never runs backwards — and the 2-D strip's window and baselines (bounded however long the track; drops only rows wholly above the top). For the 3-D renderer (`components/ridges3d`): the shader's `(row, band)` arithmetic scanned against the TypeScript that mirrors it (its texel read proven to be `@jkos/scene`'s `matrixTexel`, pasted in), a camera that rides the playhead exactly and flows a steady step per frame with no jump on a row boundary, every row leaving the window already fogged out (the far edge never blinks), and the orbit clamps. Scans the shader for any per-track `max`/`min`/gain. ⚠️ **Every failure mode here is silent.** Also scans the module for `setInterval`/`Date.now`/`requestAnimationFrame` — the flow is driven by the media element's `currentTime`, read by its caller every frame, never by a clock of its own. |
| `pnpm check:vibespace` | `test/vibespace.mjs` — the pure math under the vibe space (`components/vibespace/geometry.ts`, ALGORITHMS.md §9 M6): the packed payload decoder, the density field, and the energy rail's stops and spring (the axis lock, velocity, picking and taps are `@jkos/scene`'s). ⚠️ **Almost every failure here still draws a beautiful cloud.** Asserts inferred album centroids never feed the density, the tone map is SHARED across slices (a sparse calm cluster stays faint beside a dense intense one), and G7 — the opacity mixed from two slices stays within 0.02 of the exact continuous field at every slice interval (measured, on the production 48 × 48³ settings). Also the brightness ramp is one hue ordered by lightness in both faces, the camera keeps the cube in a portrait frame at every yaw, and the module holds no clock or DOM. |
| `pnpm check:scene` | `test/scene.mjs` — keeps the suite on **one 3-D engine**, `@jkos/scene`. Every known 3-D view (the 3-D pulsarmap, the vibe space) renders through `useScene`; no `getContext('webgl…')`, `WEBGL_lose_context` or `webglcontextlost` listener exists anywhere in `apps/` or `packages/` outside `packages/scene/src`; no app re-declares `springStep`/`perspective`/`lookAt`/`orbitEye`/`invert`; and a `.tsx` holding a `WebGL2RenderingContext` that the gate does not list fails until it is. ⚠️ **Each lesson it protects was learned in production shape and is invisible to a text-scan of the view that forgot it:** a lost context not rebuilt, a context never released (browsers cap them — the oldest, which can be the one on screen, dies), a release on unmount that breaks StrictMode's remount of the same canvas in development only. The sweep also asserts it can see the package's own `getContext`, so an empty walk cannot report clean. |
| `pnpm check:runes` | `test/runes.mjs` — the pure stroke recognizer under KourOS's rune layer (`apps/kouros/src/gestures/rune.ts`): flick vs dial vs corner, the dial's sign and its zero, and the noise floor. ⚠️ **A misread rune is silent and destructive** — it fires the wrong transport command and the only evidence is that the music changed. Pins the property the grammar rests on: classification is a fold over the WHOLE stroke, so a throw that curls stops being a flick and never was one (lift-to-commit). Also asserts the live preview and the committed command come from the same function, and scans the module for clocks and DOM. |
| `pnpm check:token-identity` | `test/token-identity.mjs` — **Stage F's step zero**: what all 152 `:root` tokens ACTUALLY compute to on both faces, measured by a real headless Chromium and pinned in `packages/design/tokens/computed-baseline.json`. ⚠️ **Every other gate here is a text scan and none of them can tell you a colour changed** — rewrite `--hub-amber` from `#ffb000` to `#ffb100` and the whole repo stays green. Records the substituted text AND the used value after `color-mix()` is evaluated, so a mix percentage cannot move invisibly. A rename that PRESERVES the value passes and is reported as a rename (that is the edit Stage F is made of); a surviving name whose value moved, an orphaned name, or a genuinely new token fails. Accept an intended change with `--update` and review the JSON diff. Skips without a browser. |
| `pnpm prove` (`suite-prober/prove.mjs`) | The prober (below). |
| `bash jkos-deploy/scripts/selftest.sh` | Deploy-pipeline dry-run: scripts parse + carry the load-bearing steps, every compose file passes `docker compose config`, current nginx conf loads in a throwaway container, break-glass gates hold. Read-only; SKIPs cleanly (exit 0) without docker/openssl. Not in the gate (needs a docker daemon); the auth half is gate-wired via `contracts.mjs`. |

## The suite prober (the conformance instrument)

`packages/suite-prober` is a **synthetic sixth app**: it discovers the suite the way Weave
does (manifest → registry seed → nginx peers → each app's capability/dataset docs) — but
from the source-of-truth *files*, so it runs in a plain checkout. It asserts the
cross-system invariants a real new app would rely on: single-source app identity, doc
shapes, filter enforcement declared==enforced, **surface coverage** (every mounted Express
route is declared or explicitly marked `app-private` at its own source line), edge
reachability, env/config conformance, and typecheck coverage (every TS package is
reachable from `pnpm typecheck` — `turbo run` skips a package with no such script and
still reports success, so half the workspace once went unchecked while the command looked
green). ~124 `ok` findings, zero drift.

Two probes were added with Stage D/E and are worth naming:

- **`85-activity-conformance`** — does an app with activity-shaped data DECLARE the
  activity contract (XC-2)? Held from both sides: an append-only per-user collection with
  no declaration is a `gap` (the shape two apps once each invented privately); a
  declaration that is never mounted, or an app reaching into another app's source, is
  `drift`. ⚠️ That third check is the negative half of "declare one shape, do not share an
  implementation" — the part no shape validator can express.
- **`86-async-contract`** — an async capability declares what it RESOLVES to, not only the
  handle it returns (WV-5). ⚠️ It also fails a capability that re-declares the HANDLE as
  the result, which satisfies a naive "has `resolves`" check while reinstating exactly the
  defect: a binder reading `returns` type-checks a job UUID into a task title, creating a
  task called `a3f1c8e2-…` with no error anywhere.

⚠️ **Two probes were found reporting confidently about things they could not see**, and
the lesson generalises: when you extend a probe, verify it can FAIL before believing it
passes.
- `registry-manifest-fields` compared `activityPath` as `undefined` vs `undefined`,
  because the topology projection did not carry the new field.
- `capability-completeness`'s `normalizeFields` dropped every key but `name`+`type`, so its
  `json` check could not have seen a `schema` pointer no matter how many were declared —
  it would have gone on reporting the same ten gaps against a fully annotated suite.
- `env-conformance` scanned for the literal `process.env.X` and so reported three
  `numEnv('NAME', default)` reads as dead docs — and those false positives were MASKING
  seven genuinely undocumented security-relevant tunables. It also omitted two
  backends from its list entirely: a clean report about the three apps it knew,
  which reads exactly like a clean report about the suite.

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
  [packages/suite-prober/README.md](../../packages/suite-prober/README.md).

Read-only by charter (roundtrip's own rows excepted): it never mutates the five systems.

## House patterns (how tests are built here)

The `/new-tester` skill is the full playbook; the shapes:

| Shape | Exemplar | When |
|-------|----------|------|
| Boot-real-server smoke | `import.smoke.mjs` | Anything behavioural. Real server, throwaway port, temp DB, dev-stub auth (`sub:1 role:admin` when no key env set), real HTTP, cleanup. |
| Transpile-pure-logic unit | `test/cards-logic.mjs` | Pure TS modules — transpile in-memory with the repo's own `typescript`, drive the REAL functions. |
| Text-scan gate | `test/cards-purity.mjs` | Banning a pattern structurally. Comment-strip first; prove the scan catches drift on a scratchpad copy, never via `git checkout`. |
| Pure-module extraction | `apps/ordeck/src/pages/hud/bbDelta.ts`, `packages/auth-client/src/hudPrefs.ts` | When the risky logic lives inside a React hook. Lift the pure part into a dependency-free module and drive it directly — used where **every failure mode is silent**: a delta cursor advanced one millisecond too far, a preference migration that reads the wrong key and loses a dashboard. |
| Prober probe | `src/probes/95-env-conformance.mjs` | Cross-system invariants over the discovered topology. |
| node↔python bridge | `contracts.mjs` §3 | Anything both runtimes must agree on. |

### ⚠️ Four lessons about writing these

1. **A test that reimplements the defect cannot see it.** `routines.smoke`'s own
   `occurrencesOf` helper filtered on `parent_id` — the exact bug it was later asked to
   catch — so BB-3's regression test would have passed against the broken engine.
2. **Verify a new assertion FAILS before you believe it passes.** Every regression check
   added was run against the pre-fix code first. Three of them did not fail
   on the first try, for reasons that had nothing to do with the code under test (a probe
   projection dropping the field, a check matching a local variable instead of an
   interface field, a mutation that renamed a trigger without disabling it).
3. **Assert the PROPERTY, not the shape the old bug happened to have.** `check:columns`
   first demanded `BEFORE UPDATE` when the live guard is `AFTER UPDATE` + a restoring
   write — both correct, and the assertion would have failed a working schema.
   `check:binding` first matched the retired scope-walk literally, which a re-hand-rolled
   copy differing by a cast walked past. Measure that `resolve()` is a one-statement
   delegation instead.
4. **A gate with false positives is worse than no gate.** It does not merely fail to catch
   things — it teaches whoever reads the report that the section is noise, and the next
   finding, the real one, gets the same shrug. `check:refs` flagged six test-assertion
   message prefixes on its first run; `check:rulings` flagged a concurrency lane count as
   a page limit. Both were narrowed before landing.

Non-negotiables: exercise the REAL code (never a re-implementation); wire the new test into
its package `test` / a `check:*` / `pnpm prove`, then confirm the new ✓ lines appear in a
full `pnpm test:contracts` run.

## What "healthy" means

`pnpm typecheck` clean · `pnpm test:contracts` exit 0 (prober 0-drift) · and for a
deployment, `pnpm prove --live <base>` exit 0.
