# jkOS — Backlog

**What is genuinely open, re-derived from code on 2026-08-27.** Not carried across on the
strength of a checkbox: every item below was confirmed still-open by reading the source, and
anything that turned out to be already done was dropped rather than listed as pending.

`RESET.md` is the mandate and carries the *reasoning* — the stage order, why each item matters,
and the decisions already settled. This file is the shorter question: what is left. Where the two
disagree, RESET.md wins on intent and **the code wins on fact**.

Names, not numbers. The `BB-*` / `XC-*` / `WV-*` / `JK-A*` tags are the audit's finding ids and
are kept only because RESET.md's appendices index them.

---

## Done, so you don't re-open it

Landed 2026-08-26/27 on `staging`, gate green at each commit, **none of it deployed**:

- **The working surface** — the dirty tree resolved, `Documentation/` rebuilt from code, six docs
  deleted, `TRAPS.md` written, memory rebuilt from 59 files to 10, the second design-system copy
  deleted, per-repo history moved to the NAS protected set.
- **The gate tells the truth** — the smoke harness asserts *which* service answered `/health`,
  fails fast on early child exit, prints the server log on any failure, and exits non-zero when
  the server never booted (it used to exit 0). Ports come from `TEST_PORTS` in
  `@jkos/suite-manifest`, with a `port-registry` probe holding every file's literal to its claim.
- **jkAuth — Stage C, COMPLETE (C1–C7).** Google OAuth removed; the six
  high-severity findings fixed as one session-lifecycle rework (migration 017);
  password change, password reset, email verification and a devices view built
  (the four absences, migration 018); the medium sweep (JK-A7/A8/A9/A13/A16/A17/
  A19/A21/A22/A23); the XSS pass over `views.js`; one authorization policy module
  with a gate proving every route uses it; `aud` verified with `JKOS_APP_ID` in
  all six compose files; and the write grant split into a create/update/delete
  ladder so a caller can finally ask for less than full write. 216 assertions
  across five suites.
- **BeigeBoard D1 + D2** — `started_at` write-once via trigger, the routine purge cascades,
  `items(parent_id)` indexed, migrations atomic with the FK pragma moved out to the runner.
- **D3 — the declarations are COMPLETE.** All four backends report full surface coverage:
  **69 mounted routes, every one declared or explicitly marked `app-private` at its own
  source line.** KourOS's seven `discover/` routes (XC-7, the ML surface) and its three
  browse reads; BeigeBoard's six routine reads plus `routines/bundle`, calendar sync and
  disconnect (BB-7); PapyrOS's single-book detail. BB-9 closed too — the library's filter
  SQL now derives from its declaration via a new `search` op.
- **D4 (XC-1) — one wire-timestamp format suite-wide.** `packages/weave/src/server/wireTime.js`
  is the single definition; `defineCollection` and all three apps use it; a `wire-time` probe
  holds it at drift level. The cursor is portable now, which the incremental-embedding cursor
  for the music vector space depends on.
- **E1 — the surface-coverage probe**, which is what made all of the above measurable
  rather than a matter of opinion. It also found two bugs in itself, both cases of a green
  result that had stopped asking the question.
- **D5 (XC-4) — one definition of "today", and the suite finally knows WHERE.**
  `callerDay(req)` / `callerZone(req)` / `zonedParts(date, zone)` in
  `packages/weave/src/server/callerDay.js` are the one reader; `authFetch` stamps
  the caller's IANA zone as **`X-JKOS-TZ`** on every suite request, so no app opts
  in; `preferences.timezone` is settable in the jkAuth portal and overrides the
  browser. Closes **BB-2** (BeigeBoard's two hand-copied `callerToday()` helpers and
  its app-specific `X-BB-Today` are gone), **BB-10** (`seedDefaults` takes the
  caller's day — the first-run "today" task used to land on tomorrow west of
  Greenwich), and **BB-15** (`isoDateStr`/`fmt24` take an explicit zone; the three
  calendar providers each got the rule their upstream actually needs). A `check:today`
  gate holds all of it, and it earned its keep on the first run by finding a fourth
  instance nobody had listed — KourOS's `/discover/home` falling back to
  `new Date().getHours()`. **JK-A11 was already closed** by Stage C's millisecond
  `rotated_at`; it is struck from D5's list rather than re-fixed.
- **D6 (XC-2) — the activity contract, and Stage E item 4 with it.** ⭐ One declared
  shape (`packages/weave/src/shared/activity.js`), FOUR independent implementations —
  PapyrOS's and KourOS's `history` tables, BeigeBoard's `started_at`/`completed_at`
  columns, LazurOS's `jobs` queue. `defineActivity` supplies the envelope and the
  validation; each app supplies its own SQL and keeps its own ledger.
  `fetchActivity` fans the question out and merges. `activityPath` derives from
  `@jkos/suite-manifest` like the other two contract paths (registry migration 019,
  and the registry↔manifest parity probe extended to cover it — it was silently
  comparing `undefined` to `undefined` until the topology projection carried the new
  field). The `activity-conformance` probe closes **Stage E item 4**: an
  append-only per-user collection with no declaration is a gap, and an app reaching
  into another app's source is drift. `extRef` moved to `shared/extref.js` so the
  CJS backends and the TS frontend share one definition instead of two.
- **D7 — routine identity and reachability, as one unit.** **BB-3:** the ref is the
  authority in SQL now, not just in prose — `OCCURRENCE_OF` + `occurrenceRefPattern`
  is the one clause all six occurrence readers take (five keyed on `parent_id`, so
  a session dragged under a goal fell out of the reconcile entirely and was
  re-INSERTed forever into an `INSERT OR IGNORE` that swallowed it). **BB-5:** every
  `ext_ref` scheme is DECLARED by the app that writes it and projected into that
  app's dataset doc; enumerating the namespace found **five** schemes, not the three
  the audit named — `routinedoc:` and the suite-prober's own `prober:`, the latter
  now a suite-reserved scheme since no app owns it. **BB-1:** the reconcile no longer
  fires only on an unfiltered non-guest human read. `ensureHorizon` bounds it to once
  per user per caller-day and lets ANY caller trigger it, including a delegated
  service token (which keeps `typ:'service'` while acting for a human, so the old
  guard skipped LazurOS's write-backs entirely). `check:refs` holds all of it.
  ⚠️ The smoke's own `occurrencesOf` helper keyed on `parent_id` too, so it could not
  have seen BB-3 even if it had looked; and section I asserted *"filtered reads never
  mint"* — the defect, written down as a feature. Both inverted, and every new
  assertion verified to FAIL against the pre-fix code.
- **D8 — invalidations, then ORDECK's read.** **BB-4:** BeigeBoard's frontend now
  depends on `@jkos/weave` and publishes `invalidate('beigeboard.items')`; its five
  hand-placed `loadItems()` calls became one subscription, so "which writes need a
  refetch?" is answered once instead of re-decided per call site.
  ⚠️ **RESET's stated reason for BB-4 is wrong about the mechanism, and the code
  wins:** the bus is an in-memory `Map` inside ONE page, and ORDECK (`jkos.net`) and
  BeigeBoard (`beigeboard.jkos.net`) are two origins and two documents. A write in one
  can never reach a listener in the other. What publishing buys is local and real —
  the app that OWNS the resource was the one app never firing the key it declares.
  **XC-3:** ORDECK's poll uses the declared `since` cursor, merging deltas over a
  cache. ⚠️ **A delta cannot see a DELETE and no cursor scheme can** — BeigeBoard
  keeps no tombstones — so completeness comes from a periodic full resync
  (`RESYNC_EVERY = 3` polls) plus a forced full fetch on any `invalidate` and on tab
  focus. The honest cost: a row deleted in BeigeBoard's own tab can linger on the
  dashboard for up to ~3 minutes where it was ~1 before. One constant dials it; `1`
  restores the old behaviour exactly. The merge is extracted to a pure `bbDelta.ts`
  and driven by `check:hud` — every way it goes wrong is silent.
- **D9 (BB-8) — `routine-spec` is a package.** `@jkos/routine-spec`: CommonJS for the
  no-bundler backend, an ESM twin for Vite, one `.d.ts` for both. The 1,045-line
  hand-ported TypeScript mirror is **deleted** — net −871 lines including the client
  half that moved into the package (`prescriptionOf`/`performedOf`/`stepStatus`/
  `logStep` and the three label maps).
  ⚠️ **The two copies had already drifted, in a way the conformance gate could not
  see:** the backend's `normalizeSpec` returned `{spec, warnings}` and the mirror's
  returned a bare `Spec`. The most-called function in the engine had two calling
  conventions, and the gate's own harness wrote `be.normalizeSpec(doc).spec` next to
  `fe.normalizeSpec(doc)` — normalising the difference away in the very line meant to
  prove there wasn't one. Output conformance cannot see an API divergence.
  `check:routine` keeps its whole structure; `be`/`fe` now point at the package's two
  FACES, so its "agrees" assertions prove the ESM twin hasn't drifted from its
  source — the one duplication that genuinely remains. `logStep` takes `now` as an
  argument so the package keeps its no-clock purity.
- **D10 (BB-6) — the calendar's HTTP half, unified; and a data bug the audit missed.**
  `provider.js` had unified the FETCH half and said so; status/disconnect/sync still
  existed three times each. They are three handler factories now, with all nine
  routes still registered at their LITERAL paths — a `for (const p of PROVIDERS)`
  loop would collapse nine visible surfaces into one unparseable
  `/api/auth/${id}/status` and hide them from `98-surface-coverage`, trading a
  duplication problem for an invisibility problem.
  ⚠️ **`defineConnector` was the wrong instrument and the code won.** It turns an
  upstream + a mapping into a server-side PROXY; calendar sync proxies nothing — it
  fetches a window, normalises three dialects, and writes into the local items table
  through a guarded replace.
  ⚠️ **The orphan bug is worse than recorded.** The audit named the *disconnect*
  route's raw `DELETE`; `replaceCalendarSource` did the same thing and runs on EVERY
  SYNC. `items.parent_id` carries no foreign key, so a note nested under a synced
  event was orphaned every time the calendar refreshed. Both paths cascade now.
  **No scheduler, still — a decision, not an omission:** this suite has no cron by
  design.
- **D12 — the data-model gap.** Migration 15: **`item_deps`** (the one place a column
  would not do — decomposition is a tree, blocking is a DAG, and a row can be blocked
  by several things in different branches at once), **`estimate_minutes`**,
  **`defer_until`**, and **`mint_kind`** (BB-16 — a standing weekly meeting can be
  authored natively now; NULL means `task`, so nothing that existed changes). The
  dependency surface is declared, cycle-guarded, ownership-checked on BOTH ends, and
  swept by `cascadeDelete` — a left-behind edge is not inert, it makes a live item
  permanently blocked by a row that no longer exists.
  ⚠️ Along the way: the direct-write validator enforced **no declared vocabulary at
  all**, despite its own comment promising direct writes obey the same rules as the
  import cleaner. Closed generically from the one field list — but keyed on
  `shapeEnum` (closed on the wire) not `importEnum`, because `scope` deliberately
  declares `shape:'string'` and enforcing its import list broke a legitimate
  `scope:'quarter'` write the declaration permits.
- **D13 — one binding model, and the async result contract (WV-5 + WV-2).**
  **WV-5:** `resolves` joins `returns` on `CapabilityDef`. Every LazurOS capability
  declared `returns: JOB_HANDLE` — right for HTTP, and type information that is
  actively WRONG for composition: a binder reading it sees a `string` where the result
  lives and type-checks a job UUID into a task title, producing a task called
  `a3f1c8e2-…` with no error. `validateTriggerTypes` binds from `resolves` when
  present and refuses a handle binding; `86-async-contract` fails a bare-handle
  capability that declares no result — **and fails one that re-declares the handle AS
  the result**, which would satisfy a naive check while reinstating the exact defect.
  The presence of `resolves` IS the async declaration — no separate `async:true` to
  disagree with it. This is Stage E item 6's first rule.
  **WV-2:** the read half (`WidgetSpec`) and the write half (`TriggerDef`) had two
  vocabularies for one idea, plus the Workshop editor's third reading. Converged in
  `packages/weave/src/shared/binding.js` — ⚠️ **not a compromise: one form was
  strictly the other's degenerate case.** `{from:'x'}` is `{src:'event',path:'x'}`
  with the source left implicit, while ORDECK's form already carried `{lit}` and
  `fallback`, which the trigger form could not express. The richer won, the narrower
  became sugar, and no existing TriggerDef changed. `check:binding` holds it — and
  asserts `resolve()` DELEGATES rather than pattern-matching the old body, after a
  first pass sailed past a re-hand-rolled copy that differed only by a cast.
- **D3's remainder — the `json` escape hatches, decided.** The question was whether the
  hatch is a defect or an honest description. ⚠️ **It is both, and treating the ten
  flagged fields as one thing was the wrong reading.** A `blocked_by` is item rows and
  a `candidate` is a metadataSearch row — shapes that were known and simply never
  declared, a real defect. A routine `spec` is forty steps with phases and progression
  rules, and an import `items` is an arbitrarily nested tree — those cannot be
  flattened into a `BodyField[]` at all, and pretending otherwise would produce a
  declaration that lies. The real defect there was that nothing said WHERE the shape
  lives. So `BodyField.schema` names either the dataset whose rows the document
  carries or the doc file describing it, all 24 json fields across four apps are
  annotated, and `capability-completeness` RESOLVES the pointer — a dataset that does
  not exist is drift, because an unverifiable pointer is the escape hatch again
  wearing a label.
  ⚠️ Its `normalizeFields` projection dropped every key but name+type, so the check
  could not have SEEN a schema no matter how many were declared — it would have gone
  on reporting the same ten gaps against a fully annotated suite.
- **XC-5 — ORDECK's preference keys, namespaced.** `hud`/`hudPins`/`hudFocus` live under
  `preferences.ordeck.*` now, with the top-level keys kept as a READ FALLBACK and nulled
  on the next write. ⚠️ **A lazy per-user migration, not a rename** — they are live user
  data (someone's dashboard layout) and a rename is silent data loss for anyone who does
  not happen to save afterwards; no server-side migration could run instead, because
  jkAuth stores the blob opaquely and does not know what a `hud` is. The pure part is
  extracted to `hudPrefs.ts` and driven by `test:cards` AND by `check:hud` (which
  transpiles the real thing rather than stubbing it) — every failure mode here is silent.
  ⚠️ The subtle one, pinned: a namespaced `hudFocus: null` means CLEARED and must NOT
  fall through to the legacy key, or clearing focus would resurrect the old one forever.
- **The music library is already mounted** — `${MUSIC_PATH:-/mnt/Luna/Luna/Plex/Music}:/music:ro`
  in both KourOS compose files, with the decoy-path trap spelled out at the bind. ⚠️ One
  comment in each file cited the WORKSTATION spelling while saying "on the host" — the
  exact confusion those files exist to prevent. Corrected; the value was never wrong.
- **XC-6 — `<AsyncView>` reaches BeigeBoard.** Its main region hand-rolled the loading
  half of the triad *while already wearing `.jk-async-note`*, AsyncView's own class —
  about as close as a codebase gets to writing the finding down itself. `check:async-view`
  holds it now.
  ⚠️ **Two places that look like candidates and are NOT**, decided and recorded rather
  than left for the next reader: LibraryBrowser's `{error && …}` is an inline banner
  beside a form that stays on screen, and AsyncView REPLACES its children — using it
  there would blank the form the user is trying to fix. And ORDECK expresses
  loading/empty/offline through the WidgetSpec `when` vocabulary; that IS its triad, in
  the language its widgets are written in, and a React component cannot be imported into
  a data document. "Adopt it everywhere" was the wrong instinct.

---

## The post-completion audit — 2026-08-31

**The backlog was reported complete; this is what a deep pass found in the completed work.**
Gate green at every step. The theme is not that the work was wrong — it is that **three of the
gates protecting it were reporting on code they never read**, and the defects hid in the gap.

- **⚠️ A LIVE SECURITY DEFECT: email one-time codes never expired.** `verifyEmailOtp` compared
  `auth_otp.expires_at` — written from JS as millisecond ISO — against SQLite's `datetime('now')`,
  which renders the space-separated whole-second form. `' ' (0x20) < 'T' (0x54)`, so for two
  instants **inside the same UTC day** the ISO value always compared GREATER and every code read
  as unexpired. A 10-minute passcode stayed verifiable until UTC midnight — up to ~24 hours, a
  ~144× window — across **login 2FA, password reset and email verification**, all three going
  through that one function. Proved before fixing: against the pre-fix code, a reset code
  backdated to 00:00:00.001Z of the current day still returned **200**. `twofactor.js` binds an
  ISO parameter now, and `account.mjs` grew the assertion that was missing — the suite tested a
  wrong code and a replayed code, never an expired one.
  ⚠️ **The backdating is to the same UTC day on purpose.** A code expired *yesterday* is refused
  even by the broken comparison, so the obvious "expire it by an hour" test would have passed
  against the bug for most of any given day.
- **⚠️ `wireNow` was missing from the weave barrel, and that absence caused the bug above.** Five
  of `wireTime`'s six helpers reached backends through `@jkos/weave/server`; `now()` — the one you
  bind when comparing against a canonical column — did not. So callers either hand-rolled it
  (tokens.js grew its own `nowIso`) or reached for `datetime('now')` and got the legacy format.
  **A shared module you cannot reach the whole of is a shared module people route around.**
- **jkAuth held both wire formats, and migration 017's own comment denied it.** 017 states its
  timestamps are "never string-compared in SQL"; `sessionFamilies` MIN/MAXes and ORDER BYs them
  against the legacy-defaulted `created_at`, so the devices list showed a session last used at
  23:50 *below* one last used at 08:05. Migration **020** converts the stored values (COALESCE,
  never a bare assignment — `strftime` returns NULL for anything it cannot parse and most of these
  columns are NOT NULL), every write is canonical, and the query normalises what it reads.
- **KourOS's and PapyrOS's catalog triggers un-did their own migration, every boot.** Migrations 5
  and 10 canonicalised `tracks.updated_at` / `books.updated_at` and recorded that "the triggers
  converge new rows on their own (they are recreated each boot)". Exactly backwards: they ARE
  recreated each boot, **from DDL that went on writing `datetime('now')`** — so every rescan since
  wrote the legacy form straight back into the column that IS the `?since=` cursor. Triggers fixed,
  rows re-converted (migrations 7 and 12).
- **`history.started_at` is a wire timestamp under a third name.** KourOS and PapyrOS window and
  order on it raw (`started_at > ?`) while emitting a *canonicalised* copy as the cross-app merge
  key — filter key and merge key were different values, and a space-separated stamp sorts before
  an ISO cursor of an **earlier** instant, so the row left the merged feed for good. Declared
  `string`, so any text could be stored. `defineCollection` gained **`wire: true`**: refused at the
  door (400, as BeigeBoard already does for its own `started_at`), stored canonical, still indexed.
- **The delegated write path carried no zone — BB-10, on the path D11 opened.** `authFetch` stamps
  `X-JKOS-TZ` on every browser request; `weaveServerClient` stamped nothing, so a write-back whose
  token's `act` names a real human arrived with no zone and `callerDay` fell back to the UTC day.
  BB-1 had deliberately opened BeigeBoard's routine reconcile to service callers, so east of
  Greenwich a write-back between local and UTC midnight rolled that user's horizon against
  *yesterday*. The zone is captured onto the LazurOS job at enqueue — the one moment a browser is
  on the other end — and handed back at write-back via `actingZone`.

### The gates that were reporting on code they never read

- **`check:today` named `apps/lazuros/backend/src`, which has never existed.** `sources()` swallowed
  the ENOENT and returned `[]`, so a whole backend was scanned as zero files while five other roots
  filled the count in. It also scanned `backend/src` and so missed the seven `server.js` /
  `discovery.js` / `docs.js` files beside it. A missing root is a FAILURE now; 107 files scanned,
  up from a number that was never the truth.
- **`99-wire-time` never scanned jkAuth** — the app that actually held both formats — and skipped
  the same seven files. 100 files now, up from 77. Its line filter also could not tell code from
  prose (a prefix test misses every continuation line of a block comment), so documenting the
  defect tripped the gate; violations are matched against blanked-comment source while the
  `wire-time-legacy` exemption is matched against the raw line, since that marker lives in a
  comment by design.
- **⚠️ `check:policy`'s regex matched nothing in the entire service.** It required a leading `.`
  (`user.role === 'admin'`), and jkAuth's real comparisons are bare — `roleClaims(role)`'s
  `role !== 'guest'` and weave.js's `role === 'admin'`. So the gate proving "no route re-types a
  role comparison" passed because it **could not see one**, and its single recorded exception had
  never fired. That is what a permanently-zero detector looks like from outside. Regex fixed, scope
  widened from `src/routes/` to the whole service, exceptions pinned to EXACT counts.
- **`95-env-conformance` had already been fixed for precisely this** (`apps/lazuros/backend`, plus
  each app's top-level files). The fix landed on one of three siblings. ⚠️ **When a scanner is
  corrected, correct every scanner built from the same list.**

### Still open, and deliberately not done here

- **`idempotency_key` is write-only, and the docs claimed otherwise.** `IDEMPOTENCY_FIELD` has no
  importer, no app declares the field, no route reads it, nothing stores seen keys — BeigeBoard's
  writer drops it as an unknown key. `trigger.js` claimed "a retried DO cannot double-write"; it
  cannot deliver that, because **idempotency is a property of the receiver**. The claims are
  corrected in place rather than papered over. The sending half is right and worth keeping (a
  derived key makes a retry *recognisable*); **dedup at the write door is owed**, and is the thing
  to build before the trigger engine is ever mounted. Note the engine has no call sites at all
  today, which is the stated steady state — but it means this gap surfaces on the day it is wired,
  not before.
- **jkAuth has two authorization policies.** `policy.js` holds the route actions; `roleClaims()` in
  `db.js` decides the `aud` and `scope` claims **every token in the suite carries** — a wider
  decision than any route guard. Folding it in means `policy.js` depending on `db.js` and owning a
  registry-derived cache: a change to the token-minting path, not one to make at the tail of an
  audit. Pinned as an exact three-comparison exception so it cannot grow a fourth unnoticed.
- **BeigeBoard's `/api/items` is the one unpaginated dataset in a suite with a pagination ruling.**
  ⚠️ **And that absence is currently load-bearing** — it is why `bbDelta`'s merge is safe. Adding a
  limit while keeping `ORDER BY id ASC` would advance the cursor past unseen rows on the first
  page-sized delta: silent row loss, the exact failure that module exists to prevent. Page it by
  the cursor column or not at all.
- **The Qobuz credential still needs rotating at Qobuz.** Working tree is clean, the value is still
  reachable in history at `e3c829a`. Unchanged, and Jag's.

---

## Open — jkAuth

**Stage C is done.** What is left is smaller and was deliberately deferred:

- ✅ **JK-A20 — DECIDED, and the half that was actually load-bearing is FIXED.**
  ⚠️ **The rotation on a GET stays, and the obvious remedy is a security regression
  wearing a purity fix's clothes.** The finding is true as stated — an RFC-7231 safe
  method should not change state — but rotation is what makes refresh-token theft
  DETECTABLE: the thief's rotation invalidates the victim's token, and the victim's next
  navigation presents a long-rotated token, which `tryRotate` reads as reuse and burns the
  family over. Mint an access token without rotating and a stolen cookie replayed on page
  navigations alone would never trip detection, for the refresh token's full 30 days. The
  finding costs a header-semantics violation an attacker cannot reach; the remedy costs
  theft detection for every user who only navigates.
  ⚠️ **What WAS load-bearing is the concurrency consequence, and it was a live bug.**
  Rotating on a GET means two simultaneous navigations race. `tryRotate` already
  distinguishes a benign loser (`status:'race'`, cookies deliberately NOT cleared) from a
  dead session — and `resolveOrRefresh` threw that distinction away with a `!== 'ok'` test,
  so every status but one became "no user". Two tabs restored onto the portal, a
  double-clicked link or a prefetch produced **dashboard → login → dashboard** for a user
  who never stopped being signed in. The loser now renders from the session row and mints
  NOTHING; only the winner may issue a refresh cookie.
  ⚠️ Verified against the pre-fix code, which answered the new assertion with
  `302 → /auth/login`. The suite could not have seen this: it tested rotation over the JSON
  refresh endpoint and never over a server-rendered navigation, which is the only path
  `resolveOrRefresh` is on. `security.mjs` is 55 assertions now, and its `api` helper
  returns raw `Set-Cookie` so "who may mint a cookie" is answerable at all.
  ⚠️ `REFRESH_GRACE_MS` in that suite went 50 ms → 400 ms: the new assertion needs a real
  request to complete inside the window, and at 50 ms a scheduling hiccup would read as
  theft and fail the run. A gate with false positives is worse than no gate.
- **Capability-declared scopes.** C4 made the grant EXPRESSIBLE at a finer grain
  (`<app>:create|update|delete` alongside the legacy blanket `write`), which is what
  service clients and capability declarations needed. The remaining half is having jkAuth
  derive the *grantable set* from each app's registered capability doc rather than from the
  registry row. ⚠️ **There is a real obstacle worth knowing before starting:** jkAuth stores
  `capabilities_path` but never fetches it, and its container does not carry the other apps'
  source — so neither an HTTP fetch at boot (the peers may not be up) nor `require()`ing
  their `discovery.js` (not in the image) works as-is. Deciding *where the doc comes from*
  is the actual design question, and it is unanswered.

## Open — the backend and the fabric (Stage D)

✅ **Stage D is COMPLETE (D1–D13, and D3's remainder).**

## Open — the ratchet (Stage E)

✅ **Stage E is COMPLETE (all six).**

   ✅ **The refinement is DONE (`f7049a4`).** `98-surface-coverage` used to let a declared
   path cover everything BENEATH it without limit, so `/items` silently covered the three
   `/items/:id/deps` routes for as long as they went undeclared — the BB-7 class, one level
   down. `MAX_COVER_DEPTH = 1` now: a surface that merely ADDRESSES a declared row is free,
   a surface that adds a noun of its own has to say so.
   ⚠️ **One rather than zero on purpose** — at zero, `/items/:id` needs its own entry in
   every app and the probe stops measuring coverage and starts measuring transcription.
   ⚠️ **Verified against a planted violation, not assumed.** A mounted
   `/items/:id/notes/:noteId` that nothing declares reports as a gap under the bound, and
   read as *"all 44 mounted routes are declared"* with the bound removed. The bound is what
   catches it; the rest of the probe never could.

1. ✅ **Surface coverage — DONE.** `98-surface-coverage` censuses every mounted Express route
   against the app's declared capability and dataset paths; a gap unless explicitly marked
   `app-private` at its own source line. RESET called this the single highest-value item in the
   plan, because `capability-completeness` audits the *typing* of what is declared and never asks
   whether the declaration covers the code — exactly how BB-7 walked past a green prober.
2. ✅ **Provisioning — DONE.** `95-env-conformance` now (a) discovers ENV HELPERS rather than
   scanning only for literal `process.env.X`, (b) covers all five backends, and (c) checks the
   CAPABILITY level: a capability declaring a scope jkAuth cannot mint is provisioned in code and
   unprovisioned in reality.
   ⚠️ The helper fix removed three false positives (`SESSION_*_MS`, read through
   `numEnv('NAME', default)`) **and revealed seven genuinely undocumented tunables it had been
   masking** — `BCRYPT_COST`, the three `LOCKOUT_*` knobs and the three `RL_*` rate limits, every
   one security-relevant and documented nowhere. Now in `.env.example`.
   ⚠️ **PapyrOS and KourOS were not in the probe's backend list at all** — two whole backends, so
   it returned a clean report about the apps it happened to know, which reads exactly like a clean
   report about the suite. The BUG-5 class it exists to catch could have been sitting in either
   one since they were written.
3. ✅ **Declared column invariants — DONE.** `writeOnce` / `indexed` flags in
   `item-fields.js` (`serverManaged` is DERIVED from `client:false`, not a second flag to
   disagree with it), held by `check:columns`.
   ⚠️ It BOOTS THE REAL DATABASE rather than grepping the migrations — a schema is what the
   engine ended up with, not what a migration meant to do — and it checks `writeOnce`
   BEHAVIOURALLY, writing twice through the raw DB past every route. Verified: a trigger that
   still exists but whose `WHEN` clause no longer matches passes a shape check and fails this
   one, which is exactly the failure a declaration is supposed to make impossible.
   ⚠️ My first shape assertion demanded `BEFORE UPDATE`; the live guard is `AFTER UPDATE` +
   a restoring write. Both correct — asserting the shape I assumed would have failed against a
   schema that was working.
4. ✅ **Shared-shape conformance — DONE (with D6).** `85-activity-conformance` asks whether an
   app with activity-shaped data declares the activity contract, and holds the rule from both
   sides: an append-only per-user collection with no declaration is a **gap**; a declaration that
   is never mounted, or an app reaching into another app's source, is **drift**. Conformance to a
   declared shape, never code sharing — and the third check is what enforces the "never".
   ⚠️ Both of its detection rules had to be fixed after they passed a planted violation: the
   mount scan read only the nominated `docsFile` (BeigeBoard mounts in `src/app.js`), and the
   cross-app-import check pattern-matched a literal `apps/` instead of RESOLVING the specifier,
   so a `require('../../papyros/...')` sailed through. Both now bite, verified.
5. ✅ **Supply chain and secrets — DONE, with one decision owed.** `check:audit` and
   `check:secrets` are in the gate. The secret scan is proved to catch a planted key and
   covers TRACKED files only, which is the right scope (what would be published) and is
   paired with an assertion that `.gitignore` still excludes `.env`/`*.pem`/`*.key`.
   ⚠️ **The audit floor is `critical` (currently 0), not `high` — deliberately and
   temporarily.** 6 packages carry HIGH advisories today (vite, postcss, nanoid,
   brace-expansion, react-router, pdfjs-dist), every one reached through a build/dev
   dependency rather than a deployed container. Setting the floor at `high` now would paint
   the gate red on day one, and a red gate nobody can turn green is one people learn to skip.
   The count prints loudly on every run. **Raising the floor once those upgrade cleanly is
   the open decision.**
   ⚠️ **ANSWERED, and it is a yes.** `music/Downloader/Qobuz.py` carried a real Qobuz
   account password (`QOBUZ_PASSWORD = "…"`) in tracked source, first committed in `e3c829a`
   ("whoopsies"). Removed from the working tree and moved to the environment on 2026-08-27,
   and `check:secrets` extended to catch that shape — it had only ever matched VENDOR-SHAPED
   tokens (PEM, `AKIA…`, `ghp_…`, `sk-…`), and a plaintext assignment to a `*_PASSWORD`
   variable matched none of them, so every green run of that scanner was green past it.
   ⚠️ **Removing it does not remove it from history.** The value is reachable in every clone
   and on the remote. **It must be rotated at Qobuz — that is the only remedy, and it is
   Jag's.** History rewriting stays refused per the standing ruling: destructive, coordinates
   with GitHub, Jag's call.
6. ✅ **The four contract rules — DONE.** A ruling nothing enforces is prose; each is a check
   now (`check:rulings`, plus `86-async-contract` for the first).
   · **`resolves`** — landed with D13.
   · **Pagination** — one `PAGE_DEFAULT`/`PAGE_MAX`, replacing FIVE hand-rolled clamps that
     disagreed (KourOS had two in one file, plus jkAuth's, BeigeBoard's library at a 2000
     ceiling, and LazurOS's queue claim). An app may narrow the max, never widen it.
   · **Versioning** — a doc whose `version` is newer than the consumer understands is refused
     with `DOC_VERSION_UNSUPPORTED`. An OLDER version still passes: failing closed means
     refusing the future, not the past.
   · **Peer-down + idempotency** — the fan-out returns an explicit per-app status list and a
     `partial` flag, and every trigger DO carries a DERIVED idempotency key (same event ⇒ same
     key, even reserialised with its keys in another order; a random key would satisfy "has a
     key" and defeat the whole mechanism).
   ⚠️ **I broke ruling 4 myself in D6** — `fetchActivity` returned a bare array and mapped a
   dead peer, a 403 and an unreadable doc all to "contributed nothing", indistinguishable from
   "did nothing". Failing soft is right; failing soft INVISIBLY is not.

⚠️ **One deliberate, bounded exception to ruling 2:** KourOS's `/api/albums` browse still pages
by `offset`. The ruling's reason is instability under concurrent writes; that browse is over a
music catalog that changes only on rescan, with a stable `ORDER BY`, so the window is "during a
library scan" — and the alternative is designing a cursor for grouped-by-album results. ⚠️ **The
moment that catalog gains incremental writes** (a user-editable tag, a rating that reorders), it
becomes exactly the bug the ruling describes. Noted at the call site too.

⚠️ **Do not build an "is anything consuming this contract?" probe.** An unconsumed contract is
the correct steady state; the only way to satisfy such a probe would be to invent consumers.

## Open — the pulsarmap (M7)

**Jag's, 2026-09-03, and a named feature rather than decoration.** Turn a track's mel
spectrogram into a **lightweight mesh** the browser can pull and draw without lag, and reveal it
as the song plays: one ridgeline per ~2 s slice, stacking toward the viewer, the *Unknown
Pleasures* form unrolling in time. `ALGORITHMS.md` §9 M7 carries the reasoning and the arithmetic
— **including that its own previous ruling ("this is decoration, nothing may depend on it") is
overruled.** This is the build order.

**Decided with Jag up front, so the blocks below don't re-ask:** a line is a **moment in time**
(not a frequency band — the classic pulsar form, and it makes the canvas append-only); meshes are
built **on demand and cached**, not batched across all 47,441 tracks; and the feature is a
**KourOS view behind a declared read**, not a shared package — other apps can still reach it
because it is declared, which is the whole point of declaring it.

### The blocks, in dependency order

1. **`music/mesh.py` — the builder.** `(128, T) float32` → `(rows, 128) uint8`. Decimate the time
   axis by a fixed `FRAMES_PER_ROW` derived from `config.frame_seconds()`, quantise against
   `ridge.py`'s `VALUE_RANGE_LN`, emit rows + `row_seconds` + the config signature. Imports
   `mel.py` / `config.py` / `audio.py` and **edits none of them** — read-only use is safe for the
   paused backfill, an edit is not (RESET.md §0a).
   ⚠️ **Stamp `config.signature()` into every mesh.** A mesh built under a different `N_MELS` or
   `HOP` is not comparable to one built before it, and the failure is a picture that is subtly
   wrong rather than an error. The index already has this exact defence (`assert_config`); the
   mesh store gets it for the same reason.
2. **The reduction, measured rather than assumed.** M2 chose `max` over `mean` for the time axis
   over ~22-frame buckets. This is 86. Render one track four ways — max / mean / p90 / p75 — read
   them side by side in a browser, and write the answer into §9's table. ⚠️ **`max` may saturate**:
   nearly every 2 s window of a rock track contains a kick, so the reduction chosen to preserve
   the beat could be the one that erases it. This is M2's method applied to M2's own conclusion.
3. **`music/meshes.db` — the sidecar store.** A **separate file**, never a table inside
   `index.db`. Same `VACUUM INTO` snapshot discipline as `ship.py` and the same four traps, plus
   the join-key trap: paths are stored absolute and KourOS sees `/music/…`, so the store must
   carry the **root-relative** form `ship.py --root-name` already reasons about.
4. **The fill trigger — the one genuinely open design question.** "On demand" is what Jag asked
   for and the obstacle is real: KourOS is a Node container that has ffmpeg but no numpy, and the
   mel transform must keep one home. Three paths, and the recommendation is to build (i) first
   and only then decide whether (ii) is worth a deployed surface:
   - **(i) A `--pending` fill, run like the backfill** — build meshes for tracks that have
     actually been played and lack one. Zero new deployed surface, zero new dependency, and it is
     buildable today. First play has no mesh and **degrades**, which is what every other read on
     KourOS's discover surface already does; it is there next time.
   - **(ii) A LAN-only `music/meshd.py`** behind an internal bearer, called by KourOS at request
     time — the LazurOS `/internal` precedent exactly, stdlib `http.server`, no third
     dependency. This is what makes "on demand" literally true, and it costs a service.
   - **(iii) Python + numpy in KourOS's image.** ⚠️ **Rejected.** It moves the transform's runtime
     into an app container and invites a second copy of the one artifact this project is built on.
   ⚠️ **What drives (i)'s pending list is undecided** — KourOS's own `history` table, a wanted-list
   the frontend writes, or simply the top-N most played. Pick when (i) is built; do not design it
   now.
5. **The KourOS read, DECLARED.** `/discover/mesh/:id` in `discovery.js`, alongside the seven
   discover reads XC-7 added. ⚠️ **It cannot ride on an existing declaration**: as of `f7049a4`
   `98-surface-coverage` bounds a declared path to one segment of cover, so a three-segment
   discover route has to declare itself. That bound exists precisely so a new surface of a new
   shape cannot arrive invisibly.
   ⚠️ **Do not open a binary endpoint for this.** 15 KB of uint8 is ~20 KB base64 inside an
   ordinary JSON body, and staying JSON keeps the read inside every contract the suite already
   enforces — pagination, wire time, `defineCollection`, the completeness probe. Revisit only if
   a decision upstream pushes a single mesh past a few hundred KB.
6. **Mesh coverage joins `/discover/stats`.** The whole discover surface degrades rather than
   failing when the index is thin, and `discoveryStats` is how a consumer tells "no results" from
   "no index". A mesh that is merely not built yet must be distinguishable from one that failed,
   for the same reason and through the same door.
7. **`<Pulsarmap/>` — the renderer, in KourOS beside `NowPlaying`.** Canvas 2D, no WebGL and no
   new dependency. Draw each row as an opaque filled path then stroke it, **painter's algorithm
   back to front**, onto an offscreen canvas that grows; blit a panned window of it so the newest
   row sits at a fixed place.
   ⚠️ **Two constraints that look like polish and are structural.** New rows must arrive IN FRONT,
   or the canvas stops being append-only and every row costs a full repaint. And the render pitch
   has a floor: M2 measured that **below ~9 px of row pitch the stack collapses into a uniform
   hatch** — a picture that reads as "the transform is broken" when it is fine and merely too
   small. That is why the renderer pans rather than squashing to fit.
8. **`revealIndex()` — pure, extracted, and gated.** `row = floor(currentTime / rowSeconds)`,
   plus what to do on seek-backwards (repaint from row 0 offscreen), track change (reset) and
   pause (nothing). Extract it the way `bbDelta.ts`, `hudPrefs.ts` and `scrub.ts` are extracted
   and put it under a `check:` gate — **every failure mode here is silent**: a drifting reveal
   looks like a stylistic choice, not a bug.
   ⚠️ **Drive it from `currentTime` per animation frame, never a `setInterval`.** A timer
   desynchronises on buffering, on seek, and on a playback-rate change — and `packages/player`
   has a rate module, so that last one is not hypothetical.
9. **Python tests, stdlib `unittest`, in `music/tests/`.** Quantisation round-trips within
   tolerance; the reduction is the chosen one and not silently `mean`; the value scale is the
   SHARED one and not per-track (assert two synthetic tracks at different levels produce
   different mesh means — a per-track normaliser makes them equal, and nothing else does);
   `row_seconds` derives from `config` rather than being a literal.

### What would make this wrong

- **A second mel implementation.** The mesh, the ridgeline and the vectors must be the same
  transform, or `VALUE_RANGE_LN` stops being a range anyone measured.
- **Per-track normalisation**, at any of the three points it could sneak in — the builder, the
  quantiser, or the renderer's own contrast.
- **A streaming protocol.** The mesh is ~20 KB; fetch it whole when the track starts and reveal
  it by index. Streaming a mesh in sync with playback couples network jitter to a visual and buys
  nothing.

## Open — the design factory (Stage F)

Not started. **The visual language is parked for the duration** — restructure, not retune.

The goal is not better CSS: it is **a factory that emits a machine-readable manifest**, the way
`discovery.js` does for backends, so the next run's widget factory can enumerate what primitives
exist and what nests in what. Build the byte-identity harness **first, as step zero** — dump every
token's computed value on both faces from headless Chromium, rebuild, assert identity — because
every gate in this suite is a text scan and there is no visual regression test. Then: name the
three tiers and make the prefix carry the tier (only tier 1 gets a dark block), collapse the four
accent schemes and retire the pigment names, reorder by system rather than by the program that
added each section, migrate the 26 un-namespaced global classes into `.jk-*`, and decide whether
jkAuth's 2,731-line generated mirror stays a build artifact or becomes a build step.

**Glass is the imported-asset material** — provenance, not chrome: *glass is for pixels the suite
didn't author; paper and press are for pixels it drew.* Delete KourOS's ambient decoration,
promote the glass tokens into the factory, apply them on the cover primitive. ⚠️ **Two
`CoverArt` implementations exist** — the one in `packages/player` is frozen under a Wave-15
"zero-behaviour-change" contract that has long since finished. Lift the freeze and converge them.

## Open — documentation

- ✅ **`TESTING.md` rewritten.** The harness contract now has its own section (the `service`
  assertion, fail-fast on early child exit, the log-on-failure rule, the port registry, and
  the 12-second boot budget with the flake it exists for), the six new gates and two new
  probes are in the inventory, stale assertion counts are corrected, and a new subsection
  records the four things this session's work proved about writing these — including that a
  test which reimplements the defect cannot see it, and that a gate with false positives is
  worse than no gate.
- **`DESIGN.md` is rewritten against the new factory**, so it waits on Stage F by design.
- ✅ **`music/Downloader/Qobuz.py` documented** — kept (it is how the library it analyses gets
  there) but flagged in `music/README.md` as a SIBLING TOOL, not a module of the pipeline.
  ⚠️ **And it carried a live Qobuz account password hardcoded in tracked source.** Moved to
  the environment; `check:secrets` grew the rule that would have caught it. **Rotation is
  Jag's** — see "Open — Jag's, not mine".

## Open — Jag's, not mine

- **Generate the service-client secrets.** `JKOS_SERVICE_CLIENTS` and
  `JKOS_DELEGATION_CLIENTS` are present-and-empty in `apps/jkauth/.env.example`, and
  `JKOS_SERVICE_CLIENT_ID`/`_SECRET` in LazurOS's. The code half of D11 is done — LazurOS now
  refuses to start in production without them — but the values are yours. Use
  `openssl rand -hex 32`, grant `beigeboard:create` rather than `beigeboard:write`, and mind
  that an id or secret containing `:` or `,` makes jkAuth refuse to boot (deliberately).

- **The two off-box backup commands** (`infra/backup/README.md`) — one writes the NAS
  `authorized_keys`, one sets a passphrase only he should know. **Before deploying anything that
  migrates a live database.** For an audit portfolio, recoverability is part of the deliverable.
- **Nothing alerts on backup failure yet.** `last-run.txt` is trivial `key=value` precisely so a
  HUD widget can read it.
- **Deploy / promote** — always a button Jag presses.
- **Two zero-byte FLACs** need re-downloading; they are not a code defect.
- **The music backfill** is paused at 35,460/47,441 and resumes with `backfill.py`, no arguments.
  See `RESET.md` §0a before touching `music/` — four named files silently invalidate all of it.
