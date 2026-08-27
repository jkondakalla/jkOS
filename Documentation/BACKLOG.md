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
- **jkAuth C1 + C2** — Google OAuth removed entirely; the six high-severity findings fixed as one
  session-lifecycle rework (migration 017). Guest login verifies its credential, revocations
  tombstone instead of deleting the evidence, sessions have idle *and* absolute lifetimes, TOTP
  secrets are sealed at rest, the session cap breaks ties on `id`, and claim-then-issue is one
  transaction.
- **BeigeBoard D1 + D2** — `started_at` write-once via trigger, the routine purge cascades,
  `items(parent_id)` indexed, migrations atomic with the FK pragma moved out to the runner.

---

## Open — jkAuth (Stage C)

The largest shortfall. C4+C5 are, in RESET's words, *the architectural centre of an
access-control portfolio piece.*

- **C3 · The four absences.** None of these exist at all today, and each is an audit finding in
  its own right (JK-A12):
  - **No password change.** `PATCH /auth/profile` accepts `name`, `avatar_url`, `preferences` —
    not `password`. A credential that cannot be rotated is the finding.
  - **No password reset.** No forgot-password flow, no reset token. Must answer identically
    whether the account exists (no enumeration).
  - **No email verification.** Email is the 2FA delivery channel, so email-OTP currently
    delivers second factors to an unverified address. Gate *enabling email 2FA* on a verified
    address rather than blocking login.
  - **No devices view.** C2 already built `last_used_at` and the revocation tombstones for this;
    the `GET /auth/sessions` + per-family revoke surface on top is what is missing.
- **C3 · The medium sweep.** JK-A7 (2FA failures never touch the per-account backoff — only the
  per-IP limiter bounds them), JK-A8 (recovery codes are 40 bits under a bare SHA-256, and they
  bypass 2FA entirely, so they are password-equivalent), JK-A13 (profile writes, preference
  writes and **admin widget publish/delete** are unlogged — the audit log covers authentication
  only), JK-A16 (`meta` truncated with `slice(0,500)` cuts mid-string and yields invalid JSON —
  an audit record that cannot be parsed), JK-A17 (`OTP_RESEND_MS` is declared and never used; the
  30-second policy is hardcoded in SQL), JK-A19 (no TOTP replay protection — a code is reusable
  inside its ±1-step window), JK-A9 (`logEvent`'s IP fallback is dead code; make it
  `req?.ip ?? null` and **assert `trust proxy` matches the one-hop topology**, which is the
  invariant-in-prose class this whole pass exists to close).
  *Already landed from this group: JK-A21 (CSRF posture recorded as a decision) and JK-A23
  (`JKOS_SERVICE_CLIENTS` refuses to boot on a mangled entry).*
- **C4 · Least privilege.** `roleClaims()` emits `<app>:read` + `<app>:write` + `<app>:admin` for
  every app a role can reach, so anything holding `beigeboard:write` can delete the whole board,
  and LazurOS needs delete rights to import one parsed task. Let a capability declare its own
  scope and derive the grantable set from registered capability docs. ⚠️ Runs straight into
  **JK-A18** (`_cachedRoleClaims` / `_cachedAppOrigins` / `_cachedOriginToId` have no
  invalidation) — do them together.
- **C5 · The policy layer.** Keep three roles; extract the enforcement. Authorization is inline
  string comparisons (`if (user.role !== 'admin')`) scattered across routes, with no single place
  to read the policy or test it. One policy module, one call shape, every route deriving its
  check — and a test that proves every route applies it.
- **C6 · XSS pass over `views.js`.** 292 lines of server-rendered HTML that interpolates
  user-controlled values (name, email). The nonce CSP is real defence-in-depth but is not a
  substitute for escaping. Audit every interpolation against `escHtml`.
- **C7 · Turn on `aud`.** jkAuth computes and mints a per-role audience and **nothing verifies
  it** — including jkAuth's own `resolveUser`. Verification is opt-in behind `JKOS_APP_ID`, set
  in no compose file. With one cookie for every `*.jkos.net` host, this claim is the containment.
  Set it per service in both compose files plus a boot assertion. (WV-3, JK-3.)

## Open — the backend and the fabric (Stage D)

Eleven of thirteen items. Re-verify each before fixing; the audit predates this work and BB-3 is
marked *Partial*.

- **D3 · Complete the declarations.** ⭐ RESET's highest-value backend work, because it is the
  only class that actively misinforms the next agent. BeigeBoard serves 30 routes and declares 11
  surfaces (**BB-7**); KourOS's `discover/` is 1,697 lines behind seven routes and declares none
  (**XC-7**), which is what blocks *"play something that matches this routine's energy"* — a
  declaration, not a model; plus the seven `json` escape-hatch gaps the prober already names, and
  `library`'s two filters that carry no `column`/`op` (**BB-9**).
- **D4 · Wire-format consistency (XC-1).** `defineCollection` stamps whole-second
  `datetime('now')` in nine collections across three apps, while BeigeBoard's `items` moved to
  millisecond ISO in migration 8 *because* second resolution loses same-second writes. The two
  formats also mis-sort against each other as strings, so a cursor is not portable across the
  suite even in principle. **This is also the incremental-embedding cursor.**
- **D5 · Define "today", once (XC-4).** Four notions coexist and there is no notion of *where*.
  Add `timezone` to the jkAuth preferences contract, one `callerDay(req)` in
  `@jkos/weave/server`, and make `isoDateStr`/`fmt24` take an explicit zone. Closes **BB-2**,
  **BB-10**, **BB-15**, **JK-A11**.
- **D6 · The activity contract (XC-2).** ⭐ Four per-user append-only ledgers in four schemas,
  none aggregatable — and PapyrOS's and KourOS's `history` tables are field-for-field identical,
  invented independently. **Declare one shape; do not share an implementation.** This is both the
  ML corpus for the variance feature and the suite's action-audit trail.
- **D7 · Routine identity and reachability, as one unit.** Key every occurrence reader on
  `ext_ref` (**BB-3** — the file says *"THE REF IS THE AUTHORITY"* and four of five call sites use
  `parent_id`), resolve the `ext_ref` namespace while identity is open (**BB-5** —
  `beigeboard:41`, `itunes:1234567` and `routine:24:2026-08-18` share one column), **then** take
  the reconcile off the read path (**BB-1** — it fires only on an unfiltered non-guest human
  read, so all seven declared filters disable it). ⚠️ BB-1 alone leaves orphans; BB-3 alone
  leaves peers on a stale horizon.
- **D8 · Invalidations, then ORDECK's read.** BeigeBoard has no `@jkos/weave` dependency
  (**BB-4**) so its writes never `invalidate('beigeboard.items')`; it needn't *consume* the
  fabric but must publish. Then narrow ORDECK's poll (**XC-3** — the whole items table every
  60 s, none of the seven filters, never the cursor). ⚠️ **Strictly after D7:** ORDECK's
  unfiltered poll is currently the only thing firing the reconcile.
- **D9 · Extract `routine-spec` to a package (BB-8).** 1,666 backend lines plus a 1,045-line
  frontend mirror of the same engine. The backend file is already pure and zero-dependency, and
  `check:routine` drives both through one matrix — the harness proving the extraction was
  faithful exists before you start. **−1,045 lines.**
- **D10 · Calendar sync onto `defineConnector` (BB-6).** 247 lines of near-identical
  Google/Outlook/iCloud blocks, none declared, no scheduler, and a disconnect that raw-`DELETE`s
  items bypassing `cascadeDelete`. **After D5**, so providers are rewritten once.
- **D11 · Provisioning (WV-1).** `weaveServerClient()` mints a service token via
  `POST /auth/token`, which 503s unless `JKOS_SERVICE_CLIENTS` is set — and it is in no compose
  file, so LazurOS's write-back throws on first call in any deployed environment. Set it,
  `JKOS_DELEGATION_CLIENTS` and `JKOS_APP_ID` (C7), plus a boot assertion. Generate secrets from
  a `:`/`,`-free alphabet (the parser now refuses malformed entries loudly).
- **D12 · The data-model gap.** No new primitive types — `goal/milestone/task/event/routine` is
  the right cut. Missing is one table and three columns: **`item_deps`** (the one place a column
  won't do — nothing expresses "can't start B until A ships", which is the question a planner
  exists to answer), **`estimate_minutes`** (nothing expresses cost, so nothing can say the week
  is overcommitted), **`defer_until`**, and a parameterised mint kind (**BB-16** —
  `routines.js` hardcodes `'task'`, so a standing weekly meeting can't be authored natively).
  All four land in `item-fields.js`. **After D4–D7**, on a settled schema.
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
  **XC-5** (three apps keep user settings in `localStorage`; the prefs blob has no namespacing
  convention, which matters once `timezone` joins it); **XC-6** (`<AppShell>`/`<AsyncView>`
  reached PapyrOS and KourOS and stopped); **WV-7** (`useCalendarSource` + 8 more `@jkos/cards`
  exports have never been called — **delete them**; an unused export is worse than a missing one
  for a fresh agent, because it looks supported).

## Open — the ratchet (Stage E)

Zero of six. Each closes a class rather than an instance, so each should land as its
corresponding fix completes.

1. **Surface coverage** — census every mounted Express route against the app's declared
   capability and dataset paths; gap unless explicitly marked `app-private`. RESET calls this the
   single highest-value item in the plan: `capability-completeness` audits the *typing* of what is
   declared and never asks whether the declaration covers the code, which is exactly how BB-7
   walks past a green prober. *Would flag today: BB 30 routes / 8 declared, KourOS 11 undeclared
   reads, PapyrOS ~6.*
2. **Provisioning** — extend env-conformance to the compose files and to the capability level.
   ⚠️ **Also teach it about `numEnv('NAME', default)`**: it scans for literal `process.env.X`, so
   the three `SESSION_*_MS` vars read through that helper are reported as documented-but-unread
   today. A false positive that trains people to ignore the probe.
3. **Declared column invariants** — machine-readable `writeOnce` / `serverManaged` / `indexed`
   flags in `item-fields.js`, asserted against the actual schema and write path.
4. **Shared-shape conformance** — does an app with activity-shaped data declare the activity
   contract? Conformance to a declared shape, **never** code sharing.
5. **Supply chain and secrets** — `pnpm audit` at an agreed severity floor plus a secret scan,
   both in the gate; their absence is itself a finding in a security portfolio. Separately, as an
   investigation: whether anything sensitive was ever committed. ⚠️ **Report, do not rewrite
   history** — that is destructive, coordinates with GitHub, and is Jag's call.
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

- **The two off-box backup commands** (`infra/backup/README.md`) — one writes the NAS
  `authorized_keys`, one sets a passphrase only he should know. **Before deploying anything that
  migrates a live database.** For an audit portfolio, recoverability is part of the deliverable.
- **Nothing alerts on backup failure yet.** `last-run.txt` is trivial `key=value` precisely so a
  HUD widget can read it.
- **Deploy / promote** — always a button Jag presses.
- **Two zero-byte FLACs** need re-downloading; they are not a code defect.
- **The music backfill** is paused at 35,460/47,441 and resumes with `backfill.py`, no arguments.
  See `RESET.md` §0a before touching `music/` — four named files silently invalidate all of it.
