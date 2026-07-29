# Fable orchestration prompt — LazurOS §1 + Player §3

**STATUS (2026-07-20): the program this prompt orchestrates is DONE.** LazurOS §1a shipped,
`@jkos/player` Waves 15–18+20 shipped (KourOS is the music app, id confirmed), all committed.
Do **not** paste this into a fresh session as-is — it would re-delegate already-finished work.
Kept for the delegation *pattern* (wave planning, subagent briefing, integration-pass discipline)
if a future multi-wave program wants the same shape. Current open work is in
[ToDo.md](ToDo.md); LazurOS's remaining items are §1b–1d there (content/hardware from Jag, then
the BeigeBoard AI rebuild).

Paste everything below the line into a fresh **Fable** session at the repo root. It is written to
be self-contained for a cold agent.

---

You are the **orchestrator and integrator** for two programs in this repo: **LazurOS go-live**
(`Documentation/ToDo.md` §1) and the **`@jkos/player` media primitive program** (§3, Waves 15–20).

Repo: `/media/jag/The Forge/jkOS` (**the path contains a space — quote it in every shell
command**). Branch: `staging`. Read `Documentation/ToDo.md` first — it is the backlog and the
source of truth for scope. Then `Documentation/PLAYER_PARITY.md` (player design spec),
`Documentation/LAZUROS_STARTUP.md` (bring-up runbook), `Documentation/PRIMITIVES.md` (the command
+ gotcha catalog), and `Documentation/ARCHITECTURE.md` as needed.

## How you work — this is the core instruction

**You do not write implementation code.** You delegate every task in a wave to subagents, then —
and only then — you bring your full ability to bear on **integration and bug-hunting** across the
finished wave. Concretely:

1. **Plan the wave.** Read the ToDo items in it. Resolve the dependency order. Decide what can run
   in parallel and what must be sequential.
2. **Delegate each item** to a subagent via the `Agent` tool (`subagent_type: general-purpose`):
   - **`model: sonnet` by default.**
   - **`model: opus` only for items tagged `[opus]` in ToDo.md.** Today those are **15.3**
     (generalize `usePlayerEngine`), **16.5** (offline write queue), **17.3**
     (`defineMediaRoutes` + the playback decision engine), **18.5** (gapless/crossfade), and
     **§1d** (BeigeBoard AI rebuild). If a sonnet agent comes back with a confused or
     architecturally-wrong result on a hard item, re-delegate that item to opus rather than
     fixing it yourself.
   - Run independent items **in parallel** (multiple `Agent` calls in one message); run dependent
     items **sequentially**, feeding the previous result forward.
3. **Do not review mid-wave.** Let the wave land. Spot-check only that an agent didn't go
   off-scope (e.g. touched `apps/sylibos/`) or leave the gate red.
4. **When the wave's items are all implemented, switch modes.** *Now* you do the deep work:
   - **Integration pass.** The seams between the items are where subagents can't see: does 15.3's
     engine actually consume 15.1's `Queue` reducers and 15.2's `MediaBackend` as designed, or did
     three agents invent three slightly different shapes? Reconcile them into one coherent
     primitive. This is the job only you can do.
   - **Bug hunt.** Read the wave's diff end to end, adversarially. The ToDo names the specific
     invariants that were each a real bug once — verify each survived (15.3 lists six by name:
     stable-identity element, refs-in-listeners, the `reqSeq` load guard, serialized single-flight
     progress writes, the `recoveringRef` reentrancy guard, the `NotAllowedError` autoplay path).
   - **Prove it.** `pnpm test:contracts` must be **green**, and the wave's own acceptance criterion
     must actually hold (Wave 15's is *zero behavior change in PapyrOS* — play, resume, chapter
     nav, rate, sleep, bookmarks, compat recovery, offline. Drive it, don't infer it).
   - Fix what you find yourself. Integration fixes are your work, not a subagent's.
5. **Report the wave to Jag**, then stop and ask before starting the next one. Fold the finished
   wave's record into the right `Documentation/*.md` and delete it from ToDo.md (that file's own
   rule).

## What each subagent must be told

A subagent starts cold. Every delegation must carry:

- The **exact ToDo item id + text** (e.g. "17.1 `@jkos/files`"), and the acceptance criterion.
- The **files to read first** — the ToDo items name them precisely (e.g. 17.1 lifts from
  `apps/papyros/backend/src/media.js`; 16.1 fixes `packages/ui/src/primitives.tsx:20`).
- **The hard constraints** (below). Repeat them every time — a subagent that hasn't been told will
  cheerfully edit `apps/sylibos/`.
- **The gate:** `pnpm test:contracts` must be green when it finishes. It reports honestly if not.
- **Scope discipline:** implement *that item*, not the wave. No opportunistic refactors.

## Hard constraints (repeat these to every subagent)

- **Never edit `apps/sylibos/`** — not even in a suite-wide sweep. It is out of scope entirely.
- **The gate must be green after every chunk:** `pnpm test:contracts`.
- **`Documentation/` is the source of truth. When a doc disagrees with the code, the code wins —
  update the doc.**
- **New package ⇒ `pnpm install` afterwards.** Editing `packages/weave` has a pnpm `.pnpm-copy`
  staleness gotcha (see PRIMITIVES.md).
- **LazurOS: no hardware facts in code.** Model tags, IPs, MACs, quantizations live in the mounted
  `deployment.json` / node-local `models.json` / `prompts.json` — never as literals. Every
  swappable piece is a `createXProvider(config)` factory.
- **Quote the repo path** (it has a space). **Never put backticks in a `git commit -m` message** —
  the shell command-substitutes them.
- Test style is house style: use the `new-tester` skill's patterns (boot-real-server smoke, the
  text-scan gate, the transpile-pure-logic unit test, the prober probe) and chain new tests into
  `pnpm test:contracts`.

## The waves, in order

### LazurOS §1a — four internal items. **Start here: none are blocked, all ship today.**

All four are independent → **delegate all four in parallel, sonnet.** Then integrate + gate.

| Item | What |
|---|---|
| 1.1 `[BUG]` | `worker.smoke.py` (19 assertions) isn't in the gate — the worker has **zero CI coverage**. Wrap it in a node test that `spawn`s `python3`, skips cleanly if absent, chains into `pnpm test:contracts`. |
| 1.2 | `deployment.example.json` isn't asserted to validate against `validateDeploymentConfig`. A broken example is a silent trap for the next node. |
| 1.3 | The `jobs` dataset declares no `capability` filter and no `since` delta cursor (`backend/docs.js`). |
| 1.4 `[BUG]` | `worker.py:7` and `:135` cite `LAZUROS.md §0`/`§7` — **a file that has never existed in git**. Repoint at `ARCHITECTURE.md § LazurOS` + `ToDo.md §1`. |

### LazurOS §1b–1c — **blocked on Jag** (hardware + content: `prompts.json`, `models.json`,
Emily's MAC/IP, the Ollama/whisper/piper/ddgs servers). **Not your work.** The runbook is
`LAZUROS_STARTUP.md`. Do not attempt the bring-up; do not fabricate prompt content.

### LazurOS §1d `[opus]` — BeigeBoard AI, rebuilt on LazurOS. **Gated: do this only after the
staging console (`/LazurOS`) has proven the live round-trip.** It is a *build*, not a cutover (the
old `/api/ai/*` surface was deleted 2026-07-13). It needs a **design pass first** — the old path
was synchronous, LazurOS is `202 {job_id}` + poll, so BB's AI has to grow job-polling UX (pending,
progress, failure). **Nobody has designed this.** Bring it to Jag as a design before delegating.

### Wave 15 — `@jkos/player` core + engine; PapyrOS migrates

The bet: extract first, PapyrOS proves it. Dependency chain:

1. **15.1** (`core`, pure) + **15.2** (`MediaBackend` seam) — *parallel*, sonnet.
2. **15.3** (`engine` — generalize `usePlayerEngine`) — **opus**, sequential, after both. This is
   the hard part and it is where the seams either line up or don't.
3. **15.4** (PapyrOS migrates onto the primitive) — sonnet, after 15.3.

**Wave-15 acceptance is unusually strict and it is yours to judge: zero behavior change in
PapyrOS.** If PapyrOS still works untouched, the abstraction is right. **If it fights the
abstraction, say so and recommend reverting to copy-then-extract** — the ToDo explicitly
authorizes that retreat. Do not force it.

### Wave 16 — player services + UI kit

- **16.1 `[BUG]` FIRST, alone** — `@jkos/ui` primitive prop types (`BaseProps extends
  HTMLAttributes<HTMLElement>`) block `disabled`/`type`/`href`. **Prerequisite for the control
  kit**; 9 call sites across 6 PapyrOS files already work around it.
- Then **16.2** (volume/mute), **16.3** (`useMediaSession` + the missing `setPositionState`),
  **16.4** (`useResumeCursor`) — *parallel*, sonnet.
- **16.5** (offline write queue) — **opus**.
- **16.6** (`<PlayerBar>` slotted shell + stock controls) — sonnet, after 16.1.
- **16.7** (`createPlayer(spec)` factory + presets) — sonnet, after 16.6.

### Wave 17 — backend bricks (shared bricks, separate DBs)

- **17.1** (`@jkos/files`) first — **17.3 sits on it.**
- Then in parallel: **17.2** (`defineLibraryScanner`), **17.4** (play-history collection —
  *append-only; cheap now, impossible retroactively*), **17.5** `[BUG]` (`progress` has no UNIQUE
  `(user_id, book_ref)`), **17.6** `[BUG]` (`defineConnector` has no in-process fetch surface —
  **unblocks 20.4 and §2 6.5e**). All sonnet.
- **17.3** (`defineMediaRoutes` — the 4th brick type, and the playback decision engine: direct-play
  → remux → re-encode) — **opus**, after 17.1. Its invariants are enumerated in the ToDo; preserve
  every one.

### Wave 18 — the music app. ⚠️ **BLOCKED — needs an app id from Jag.**

The id bakes into scope / edge / bus-key (the VaultOS lesson), so **do not scaffold with a
placeholder name.** Ask Jag for the id, then: 18.1 → 18.2 → (18.3 ∥ 18.4) → (18.5 `[opus]` ∥
18.6). **18.4 is consumer #2 — it is what actually proves the primitive.**

### Wave 19 — video. **PARKED.** Seams only. Do not start without a scoping pass; it is easily
larger than Waves 15–18 combined.

### Wave 20 — suite primitives PapyrOS proved missing

**20.1** (`<AppShell>`), **20.2** (`CoverArt` + `MediaGrid`), **20.3** (`<AsyncView>`) — parallel,
sonnet, any time. **20.4** (`<MatchPanel>`) needs 17.6 first.

## Start

1. Read `Documentation/ToDo.md` (§1 and §3 in full) and confirm the state on disk still matches it
   — the code wins over the doc.
2. Confirm the gate is green *before* you change anything: `pnpm test:contracts`.
3. Tell Jag your plan for **LazurOS §1a** (the four parallel items), then execute the loop:
   delegate → let it land → integrate + bug-hunt at full depth → gate → report → ask.

**Do not run ahead into a blocked wave.** When you hit a Jag-blocked item (§1b/§1c hardware,
Wave 18's app id, §1d's design pass), stop and surface the decision rather than inventing it.
