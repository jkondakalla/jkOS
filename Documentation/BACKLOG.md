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

---

## Open — jkAuth

**Stage C is done.** What is left is smaller and was deliberately deferred:

- **JK-A20** — `resolveOrRefresh` rotates the refresh token on a GET navigation.
  Not exploitable (an attacker can read neither the response nor the cookie), but it is a
  state change on a safe method. Left alone because the fix touches the silent-refresh path
  that makes remembered sessions work, and that is not a change to make casually.
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

One of thirteen items (D1–D12 are done — only D13 remains). Re-verify before fixing; the audit
predates this work.

- **The seven `json` escape-hatch fields** are what remains of D3, and they are the weakest item
  on this list. A routine `spec` genuinely IS an opaque document, so "type it properly" may be
  the wrong answer — decide whether the hatch is a defect here or an honest description before
  spending effort on it.
- **D13 · The binding vocabulary.** ⚠️ **Do not delete the trigger engine** — it is the *write*
  half of the widget factory. `WidgetSpec` binds a dataset into a primitive tree (read);
  `TriggerDef` binds a capability's typed output into another's body (write); ORDECK's Workshop
  does binding by hand in a third vocabulary. Converge them on one binding model. **WV-5 gates
  this:** every LazurOS capability declares `returns: JOB_HANDLE`, so `validateTriggerTypes` will
  cheerfully type-check a job handle into a task title — async needs `resolves`.
- **Unsequenced:** mount the music library (`MUSIC_DIR=/mnt/Luna/Luna/Plex/Music` in both compose
  files — ⚠️ **not** `/mnt/Luna/Plex/Music`, which also exists on the host and is empty);
  **WV-6** (two hardcoded per-app branches in code documented as app-agnostic); **WV-8**
  (jkDeploy isn't in `@jkos/suite-manifest`, so "deploy staging" can't be a HUD button);
  **XC-5** (three apps keep user settings in `localStorage`; the namespacing convention is
  now written down and `timezone` follows it, but ORDECK's `hud`/`hudPins`/`hudFocus` still sit
  at the top level where they don't belong — they are LIVE user data, so the move needs a
  read-fallback and a lazy re-write on next save, not a rename); **XC-6** (`<AppShell>`/`<AsyncView>`
  reached PapyrOS and KourOS and stopped). *(WV-7 is done — the `@jkos/cards` barrel no longer
  advertises what nothing imports.)*

## Open — the ratchet (Stage E)

Three of six are done (1, 4 and 5). Each closes a class rather than an instance, so each lands as
its corresponding fix completes.

   ⚠️ **A refinement worth making:** `98-surface-coverage` lets a declared path cover
   everything BENEATH it, so `/items` silently covered the three new `/items/:id/deps`
   routes before they were declared. That is a deliberate rule, but it means a nested
   surface with a completely different shape can be added without declaring it — the
   BB-7 class, one level down. Consider requiring an explicit declaration for a path
   that is more than one segment deeper than its cover.

1. ✅ **Surface coverage — DONE.** `98-surface-coverage` censuses every mounted Express route
   against the app's declared capability and dataset paths; a gap unless explicitly marked
   `app-private` at its own source line. RESET called this the single highest-value item in the
   plan, because `capability-completeness` audits the *typing* of what is declared and never asks
   whether the declaration covers the code — exactly how BB-7 walked past a green prober.
2. **Provisioning** — extend env-conformance to the compose files and to the capability level.
   ⚠️ **Also teach it about `numEnv('NAME', default)`**: it scans for literal `process.env.X`, so
   the three `SESSION_*_MS` vars read through that helper are reported as documented-but-unread
   today. A false positive that trains people to ignore the probe.
3. **Declared column invariants** — machine-readable `writeOnce` / `serverManaged` / `indexed`
   flags in `item-fields.js`, asserted against the actual schema and write path.
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
   ⚠️ Still owed, and Jag's: whether anything sensitive was ever committed. That is a
   HISTORY question this scanner deliberately does not ask, because the remedy is a rewrite
   — destructive, coordinates with GitHub. **Investigate and report; do not rewrite.**
6. **The four contract rules** — one probe each for `resolves`, the cursor/limit convention, the
   fail-closed version rule, and the per-app status list. A ruling nothing enforces is prose.

⚠️ **Do not build an "is anything consuming this contract?" probe.** An unconsumed contract is
the correct steady state; the only way to satisfy such a probe would be to invent consumers.

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

- **`TESTING.md` needs its rewrite.** Stage B changed the harness contract — the `service`
  assertion, the fail-fast on early exit, the port registry — and none of it is described there.
  Stage E will add probes that also belong in it.
- **`DESIGN.md` is rewritten against the new factory**, so it waits on Stage F by design.
- **`music/Downloader/Qobuz.py`** is a 459-line library-acquisition script, tracked in git and
  documented nowhere. It has nothing to do with the embedder; either give it a one-line README
  note or move it out of `music/`, which is otherwise the vector-space project.

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
