# jkOS — The Reset Pass

**One instruction set for Fable. This document supersedes `ToDo.md` and outranks every other
file in `Documentation/`.** Where this and another doc disagree, this wins; where this and the
*code* disagree, the code wins and you fix this file.

Written 2026-08-26 on branch `staging` @ `1e278fb`. Its purpose is to hand you a working surface
you can trust and a backlog you can work, without inheriting eight months of bookkeeping. Nothing
here asks you to honour a decision because it was made — only because it is still load-bearing,
and each one that is says why.

Two evidence bases sit behind it. The backend defect list (Appendix B) comes from a two-pass audit:
<https://claude.ai/code/artifact/1c5f6f47-9fee-4d57-ad41-94235fed65f9>. The jkAuth findings
(Appendix A) come from a fresh audit run on 2026-08-26 over the modules that audit never read.

---

## Start here — your first hour

1. `git status` — the tree is dirty. **A1 is your first commit** and nothing else starts until it's clean.
2. `pnpm test:contracts` — confirm exit 0. If it isn't, §2's baseline is stale; say so before building on it.
3. Read §0 (what you may and may not do), §1 (**what this project is for** — it reorders every priority below), and §3 (what you're licensed to ignore).
4. **Read §0a before you touch anything under `music/`.** A 4-hour backfill is paused at 35,460 of
   47,441 vectors, and four named files silently invalidate all of it. This is the only piece of
   live, expensive, unrecoverable-by-rerun state in the repo.
5. Work Stage A→G in order. A and B are prerequisites; C→F are the substance.
6. Anything marked ⚠️ is a trap someone already paid for. Anything marked ✅ is decided — don't relitigate it.

You have broad authority here (§0) and one hard rule: **the gate is green at every commit.**

## How to read this

Stages A→G are ordered by dependency. **A is not optional and not skippable** — the rest is
unreviewable on top of dirty state and untrustworthy docs, and the reason this document exists is
that the last several months of docs and memory drifted far enough from the code to actively
mislead. Stage A is the pass that makes them stop.

§0, §1, §3, §5 are standing instructions. Read them once; they apply to every stage.

---

## 0 · The mandate

### You may — without asking, and without justifying it against precedent

- **Delete any file in `Documentation/`.** All 20 are on the table. Nothing there is consumed by
  code (`ROUTINE_PROMPT.md` looks like an exception and is actually *generated* output —
  `apps/beigeboard/backend/scripts/print-prompt.mjs` emits it).
- **Rewrite the entire memory directory** at
  `/home/jag/.claude/projects/-media-jag-The-Forge-jkOS/memory/`. 59 files / 476 KB, with a 26.4 KB
  index against a 24.4 KB limit — it is **already truncating at session start**, so memory is
  unreliable by construction today.
- **Overrule any decision recorded in a doc, a memory file, or `ToDo.md`** — including ones marked
  "Jag's call", "approved", or "parked for a stated reason". Those record a past conversation, not
  a standing veto. Say so in your report; don't stop and ask.
- **Move, rename, split or merge any source file**, and retire any abstraction with no consumers.
- **Renumber, restructure or discard the backlog wholesale.** See §3.

### You may not, without asking Jag first

1. **`apps/sylibos/`.** Off-limits, including in suite-wide sweeps. Separate track, different
   toolchain (React 19 + Tailwind v4 vs. the suite's React 18 + plain CSS), deliberately outside
   the suite contract. Leave it byte-identical.
2. **Add a third line to `music/requirements.txt`.** It is `numpy` + `onnxruntime`, nothing else.
   `torch` is excluded **with no fallback** — if a model won't export cleanly to ONNX, change
   models. Export tooling may live in a throwaway venv; it's a build tool, never a dependency.
3. **Delete data.** `music/index.db` (+ `-wal`/`-shm`) holds **35,460 encoded tracks — 4 hours of
   CIFS-bound backfill that cannot be shortened**, because the wire is the bottleneck (§0 table).
   The live staging DBs hold history migration 13's own argument says cannot be backfilled.
   Anything under `/mnt/Luna` is Jag's library. Read before you overwrite; never `rm` a `.db` to
   "reset" something. **See §0a — that run is paused, not finished, and it is resumable only for
   as long as you leave four specific files alone.**
4. **Deploy, promote, or push to a branch that auto-deploys.** Commit freely on `staging`; the
   deploy is a button Jag presses. `jkos-deploy` promotes `origin/staging` to production; `main` is
   GitHub-only. A push to `staging` is the last reversible step.
5. **Change a *deployed* service's behaviour irreversibly** — a migration that drops a column, a
   token-format change that signs out every device. Reversible migration first, then ask.

### The constraints that survive the reset

Each is a measurement or a physical fact, not a preference. That is the only test they had to pass.

| Constraint | Why it's real |
|---|---|
| **The gate must be green at every commit.** `pnpm test:contracts`. | The only thing between you and a suite nobody can run. Green on 2026-08-26 — see §2. |
| **Prod and staging are served from one checkout by a standalone nginx.** `standalone.conf` is a *file* bind-mount whose inode pins on `git reset` — **restart nginx, don't reload.** | Reloading serves the old inode. `jkos-deploy` restarts; a hand-rolled deploy won't. |
| **`/mnt/Luna` is a CIFS mount at 85–96 MB/s.** | Measured. The wire is the bottleneck, not the FFT and not the model — parallel *readers* are the lever. |
| **Library paths are hostile** — `!!!`, `again&again`, `[24B-96kHz]`, `Today's Lesson.flac`. **Never `shell=True`; argv lists everywhere.** | Bit during probing, and again in the SVG renderer where an unescaped `&` produced XML that would not open at all. |
| **`music/` sits outside the pnpm workspace on purpose.** `pnpm-workspace.yaml` globs only `apps/*`, `apps/*/backend`, `packages/*`. | Keeps the two-line dependency budget honest and Python out of the node gate. |

---

## 0a · The embedding run is PAUSED, not finished — how to not destroy it

**Stopped deliberately at 15:11 on 2026-08-26 so this refactor could have the machine.** It is
resumable to the exact track, and it stays that way only if you leave four files alone. Read this
before you touch `music/`.

| | |
|---|---|
| **Banked** | **35,460 / 47,441 vectors (74.7%)** in `music/index.db` |
| **Remaining** | 11,979 tracks, ~1.4 h at the measured 2.45 tracks/s |
| **Failed** | 2 — both **zero-byte files in Jag's library**, not defects. See below. |
| **Cost so far** | 4:01:35 wall clock, 2,410 audio-hours decoded, 104 MB/s sustained |
| **Stop was clean** | `PRAGMA integrity_check` = `ok`, `-wal` drained to 0 bytes on exit |

### Resuming is one command, with no arguments

```bash
cd music && ./.venv/bin/python backfill.py        # NOT --scan, NOT any flag
```

**There is no state file, no counter, and nothing to restore.** Progress is *the absence of a join
partner*: `index.pending('local_vectors')` is a LEFT JOIN asking which tracks have no vector yet,
and its answer is correct whether the last run finished, was Ctrl-C'd, or died with the mount
underneath it. This is why the run could be stopped for you at all. Don't add a resume mechanism;
one exists and it is the schema.

Do **not** re-run `--scan` unless the library on disk actually changed. It is 94.5 s of CIFS stats
and it is already done for the current 47,441 files.

### ⚠️ The four files that silently invalidate 35,460 vectors

**`config.py` · `mel.py` · `encoder.py` · `audio.py`.** These define what a vector *means*. The
35,460 already banked were computed by the code as it stood at 15:11; mixing them with vectors
computed by different code is Trap 16, and the failure produces no exception and no NaN — just
wrong neighbours (ALGORITHMS.md §10).

Two cases, and only one of them protects you:

- **You change a config PARAMETER** — `SR`, `N_MELS`, a convention fork, the encoder profile.
  `config.signature()` moves, `index.assert_config` raises `ConfigDriftError` on the next write,
  and the resume refuses. **Loud. This is fine.** Same for the pooling recipe via
  `assert_recipe`.
- **You change the COMPUTATION without moving a parameter** — refactor `mel.py`'s framing, swap an
  argument order in `encoder.window_features`, "tidy" the resample in `audio.decode`. The signature
  does **not** move, the resume proceeds, and the index quietly ends up holding two incomparable
  vector sets. **Silent. This is the one that costs you the space.**

**If you touch any of those four, do not resume — clear and re-run from zero:**

```bash
cd music && ./.venv/bin/python -c "import index; c=index.connect(); c.execute('DELETE FROM local_vectors'); c.commit()"
./.venv/bin/python backfill.py                    # ~5.5 h over the full library
```

That is the legitimate path and the schema allows it: an *empty* vector table adopts whatever
configuration is in force. What is never legal is adding to a non-empty one under new code.
Everything else in `music/` — `query.py`, `descriptors.py`, `ridge.py`, `ship.py`, `scan.py`,
`index.py`'s plumbing — you may refactor freely; none of it decides what a vector is.

### Two more things that would cost you hours

- **`music/.venv` is 2.4 GB and holds `onnxruntime-gpu` 1.29.0, not the `onnxruntime` in
  `requirements.txt`.** That substitution is what makes the encoder 21× faster (`02cc790`) and
  turns a ~13 h run into ~5.5 h. It is gitignored, so a filesystem-cleanup pass will not warn you.
  **Deleting it costs a 2.4 GB reinstall, and re-creating it from `requirements.txt` alone gives
  you the CPU build and a much slower run.** The two-line budget (§0.2) is about what the
  *project depends on*, and it is unaffected: the GPU build is the same package.
- **The 2 failures are not yours to fix in code.** Both are **zero-byte FLACs** —
  `Dodheimsgard - Black Medium Current (2023)/08. Abyss Perihelion Transit.flac` and
  `Geese - Getting Killed (2025)/11. Long Island City Here I Come.flac` — that ffprobe reports as
  `channels=0`. The run marked them `failed` with their error text and continued, which is the
  designed behaviour. A sweep of the scan confirmed they are the **only** two files at or below
  1 KB in all 47,441. They need re-downloading; they do not need a code change.

### What is still owed after the resume

`descriptors.py --build --encoded` → `query.py --fit` → `query.py --gate` → `ship.py`.
**`--fit` is not optional**: it fits the corpus geometry into `meta`, and KourOS ranks on the
*centred* space (§8.8). Ship an index that was never fitted and every served cosine is raw —
strangers at +0.48 instead of −0.03, the two arms on incompatible scales, and `makeRun`
degenerating into an energy ramp through unrelated music. Nothing errors. `ship.py --check`
refuses that index rather than letting it reach the host.

---

## 1 · What this project is for

**jkOS is a portfolio piece for Jag's IT-auditing career.** This is the most load-bearing fact in
this document and it reorders everything below it.

It means access control, session integrity, least privilege, and auditability are **the product**,
not hygiene. A finding like "a capability cannot ask for less than full write access" is not a
tidy-up — it is the subject matter. Three consequences you should apply without being asked again:

1. **A control that exists in configuration and not in code is the worst defect class here.** It is
   what an auditor is hired to find, and this codebase has at least one (Appendix A, JK-A1: an env
   var named `GUEST_PASSWORD` that is hashed, stored in the database, and never compared to
   anything).
2. **Prefer the enforceable version of every fix.** A SQLite trigger over a route check; a probe
   over a doc sentence; a derived value over a re-typed one. "We wrote it down" is the finding, not
   the remedy.
3. **Write for a reader who will ask "how do you know?"** When you fix something, leave behind the
   thing that proves it stays fixed.

The second fact: **each app is coded by a fresh agent.** That is why Weave exists — see §3 and
Stage D. An app may decide its own internals freely as long as its declared inputs and outputs stay
consistent suite-wide.

---

## 1a · What this is being built toward

**You are not doing this work. You are building the foundations it lands on** — and several of your
decisions are load-bearing for it in ways that aren't obvious from the defect list. Design record
for both projects: **[ALGORITHMS.md](ALGORITHMS.md)** (§1–11; the combined order is §2, the trap
catalogue is §10). That file stays — do not fold it into anything.

### The two projects

**The music vector space** — `music/`, **6,075 lines of Python across 12 modules**, numpy +
onnxruntime and nothing else. Hand-rolled mel extraction (`mel.py`), a classical descriptor baseline
(`descriptors.py`, 1,074 lines), CLAP embeddings via ONNX (`encoder.py`), an SQLite vector store
(`index.py`), cosine search and PCA (`query.py`), and an SVG ridgeline renderer (`ridge.py`) written
because matplotlib was out of budget. M1–M4 are done and **M4's similarity gate passed** over the
1,506 tracks encoded at the time. The space is now being rebuilt over the *final* library and sits
at **35,460 / 47,441 — paused mid-run, see §0a before touching `music/`.** M5–M7 are named,
unchunked. Its consumer is
KourOS's `src/discover/` — **1,697 lines** of similarity search, radio, runs, the vibe map and home
rails, each response labelled with the basis of its answer.

**LazurOS + the variance feature** — an async job-queue AI gateway (`backend/` + a Python `worker/`
+ `providers/`) routing inference to a tier of compute nodes. Code-complete, never run live. The
ladder is L1 (minimal bring-up) → L2 (**prompt versioning, an audit schema, and an eval harness —
first, not last**) → L3, the actual feature: read a user's prescribed-vs-performed history and
propose routine adjustments, with deterministic statistics computed in SQL and an LLM only for the
proposal text.

### Seven of your decisions that this work depends on

1. **The activity contract (Stage D item 6) is the ML corpus.** L3 reads what was prescribed against
   what was performed. Four unaggregatable ledgers means that corpus is one app wide; one declared
   shape makes it suite-wide. That is why D6 moved up the list — it is not only "what did I do
   today," it is the statistical substrate, and the same records are the audit trail (§1).
2. **Migration 13's clock is running now and cannot be backfilled.** ⚠️ But `started_at` and the
   per-step `at`/`seq` fields are written **only** by `SessionCard` interaction — ticking a checkbox
   writes none. So two of the five planned statistics depend on usage pattern, not on the columns
   existing, and the series is thinner than `completed_at` suggests. **If you touch the routine
   session UI, those writes are load-bearing.** BB-11 (write-once `started_at`) is first in Stage D
   for this reason: an unguarded overwrite turns *when the session started* into *when it was last
   touched*, and nothing downstream can detect or repair it.
3. **A2c.1 (`resolves`) is LazurOS's contract, not a spec nicety.** Every LazurOS capability is
   async. Until a capability can declare what it *eventually* produces, no AI capability can ever be
   a composable brick — so that ruling is the unblock for the entire AI integration.
4. **XC-1's cursor is the incremental-embedding cursor.** A backfill over 47,491 tracks is resumable
   off `?since=`. Second resolution loses same-second writes and the two incompatible formats make a
   cross-app cursor impossible even in principle. This matters more here than it does for any UI.
5. **XC-7 is the ML surface.** KourOS declares none of its 1,697 discover lines, so *"play something
   that matches this routine's energy"* is blocked by a declaration, not by a model. Declaring it is
   what makes the finished ML work reachable by the suite at all.
6. **The dependency budget is a hard rule you could break casually** (§0.2). If A1 or anything else
   takes you into `music/`: numpy + onnxruntime, no third line, **no `torch` with no fallback**. Also
   note `music/` runs its own tests (`./.venv/bin/python -m unittest discover`, **418 green on
   2026-08-26**) and is deliberately **not** on the node gate — so `pnpm test:contracts` passing
   says nothing about it. ⚠️ **And a paused 35,460-vector backfill is sitting in `music/index.db`
   right now — §0a lists the four files that silently invalidate it.**
7. **No AI surface is synchronous.** The old `/api/chat` is gone; everything is job-submit then poll.
   Don't design anything downstream that assumes a blocking call — and note Phase 7 (BeigeBoard's AI
   rebuilt on LazurOS) is unstarted *design* work needing pending/progress/failure UX, not a
   migration.

### Why this connects to §1

The values in this work are the portfolio's values one layer down: **provenance and reproducibility
of a computed result.** CPU-only by choice, so the space reproduces on any machine.
`config.signature()` stamped on every vector row, so vectors computed under two different analysis
configurations can never be silently mixed — the failure it prevents produces no exception and no
NaN, just wrong neighbours. Corpus mean/std stored in the index, so a track added months later
normalises against the same statistics. Every discover response labelled with the basis of its
answer.

And the method matches: **M4 was a stop-the-world gate with criteria declared before the run**, and
chunking past it was refused as "planning on faith." L2 puts prompt versioning and an eval harness
*before* the first real workload. If you ever do touch this work, that is the house style — a
pre-declared gate, and a design record kept separately from the backlog.

---

## 2 · Ground truth, measured 2026-08-26

Verified in this repo today, not inherited:

- **`pnpm test:contracts` exits 0.** Every backend smoke, 16 static checks, the round-trip, the
  prober. The prior audit's blocking finding was two stray KourOS processes on ports 3991/3992;
  **they are gone.** One KourOS server still runs on 3011 against the placeholder library —
  harmless, not on any smoke's port.
- **`pnpm prove`: 0 drift · 15 gaps · 1 consolidate · 9 info · 97 ok.** Hard contracts hold. Seven
  of the 15 gaps are literally *"an opaque blob a GUI/AI can't snap a stud onto"* — the prober is
  already measuring the right axis (§3).
- **⚠️ OPS-1's mechanism is untouched.** The gate went green because the ports cleared, not because
  the harness improved. All six harness files still never watch for early child exit, print
  `serverLog` only *if health fails*, and check only that `/health` returned 200 — never *which
  service answered*, though the payload contains the name. **A green run has never proved the
  server under test was the right one.** Fix before trusting any measurement downstream.
- **The tree is dirty:** 8 modified (`Documentation/ToDo.md`,
  `apps/kouros/backend/src/discover/vectors.js`, 5 under `music/`,
  `scripts/placeholder-music/cli.mjs`) + 2 untracked (`music/ship.py`, `music/tests/test_ship.py`).
- **Shape:** 7 apps (beigeboard, jkauth, kouros, lazuros, ordeck, papyros, sylibos), 10
  `packages/@jkos/*`, plus `music/`, `jkos-deploy/`, `infra/`, `scripts/`, `test/`.
- **The music library's recorded numbers are wrong.** Docs say 15,326 FLACs / 89 artist folders.
  Measured on the host: **47,491 FLACs**, 1,976 top-level entries, 4,219 second-level dirs, 6,003
  JPGs. Layout is **mixed** — artist-nested (`100 gecs/`) alongside flat album dirs
  (`200 Stab Wounds - Manual Manic Procedures (2024) [FLAC] [24B-96kHz]/`), so any scanner
  assuming one shape is wrong for part of it.
- **⚠️ The music path is a trap.** Jag's local `/mnt/Luna/Plex/Music` is the SMB share `Luna` =
  dataset `Luna/Luna`, whose **host** path is `/mnt/Luna/Luna/Plex/Music`. The host *also* has a
  separate top-level `/mnt/Luna/Plex/Music`, and it is **empty**. A container handed the obvious
  reading of that path gets zero tracks and looks exactly like the old "`MUSIC_DIR` was never set"
  bug. Music work is **not in this run** — this is recorded so the next agent doesn't lose a day.

---

## 2a · ⚠️ Data protection — half fixed, half owed

**As found 2026-08-26: there was no backup of anything.** Audited via `midclt` on the host.

| Control | State |
|---|---|
| Periodic snapshot tasks | `pool.snapshottask.query` → **`[]`** |
| Replication tasks | `replication.query` → **`[]`** |
| Cloud sync tasks | `cloudsync.query` → **`[]`** |
| Rsync tasks | `rsynctask.query` → **`[]`** |
| Snapshots that exist | 50, none on a schedule — so point-in-time recovery is frozen at whenever they were taken |
| Pool health | `Luna` ONLINE, 8.29T/14.5T, no known data errors; last scrub 2026-07-26 repaired 0B with 0 errors |

ZFS redundancy covers *disk* failure. It does not cover pool loss, machine loss, theft, fire,
ransomware, or `rm -rf`. **There is no off-box copy of any jkOS data.**

The part that makes this urgent rather than theoretical is the size:

```
Luna/Backends/Production                  8.61M     ← the ENTIRE production suite
Luna/Backends/Production/jkos-auth-data    388K
Luna/Backends/Production/beigeboard-data   172K
Luna/Backends/Staging                     31.0G
Luna/Backends/ssl                          112K     ← the certs
Luna/Luna                                 8.17T     ← media (largely re-downloadable)
```

The irreplaceable data is **8.6 MB**. There is no cost argument for leaving it unprotected, and
migration 13's variance instrumentation — whose own justification is that *"every day these columns
are not deployed is a day of history the analysis will never have"* — is accumulating inside that
172K dataset right now, with no snapshot and no off-box copy.

### ✅ On-box recovery: fixed 2026-08-26

A periodic snapshot task now exists — **`pool.snapshottask` id 1**: `Luna/Backends`, **recursive,
hourly, 30-day retention**, naming `auto-%Y%m%d.%H%M-30d`, enabled. Verified via
`midclt call pool.snapshottask.query`. It fires on the hour; to undo,
`midclt call pool.snapshottask.delete 1`.

Deliberately **not** applied to `Luna/Luna` (8.17 TiB of largely re-acquirable media — a separate
cost conversation) or `Luna/Webhost/jkOS-staging` (32 MB, reproducible from GitHub).

### ◐ Off-box copy: built 2026-08-26, two commands from live

✅ *Decided: no third party touches this. The off-box copy lands on Jag's own workstation.*
Built and committed at **[`infra/backup/`](../infra/backup/README.md)** — script, systemd user
timer, installer, runbook.

**Pull, never push.** The workstation initiates and holds the only credential; the NAS has no key,
path, or permission pointing back at it, so a compromised or ransomwared NAS cannot reach, corrupt
or delete its own backups. **Reads a ZFS snapshot, never the live dataset** — the payload is SQLite,
and a live `.db` copied without its `-wal` is torn in a way that only shows up on restore day.
**The key is read-only and shell-less** (`rrsync -ro` under `restrict`: no pty, no forwarding, no
writes, nothing readable outside the snapshot tree). **Encrypted at rest, failing closed** — the
archive holds password hashes, **plaintext TOTP secrets** (JK-A4) and the suite's **TLS private
key**, on an unencrypted ext4 drive, so the script refuses to run without its GPG key rather than
writing that in the clear. Verified: it exits 1 and writes nothing.

⚠️ **Two commands are still owed, and both are Jag's by design** — one writes to the NAS's
`authorized_keys`, one sets a passphrase only he should know. Both are in the runbook.
**They should land before Stage C**, which applies migrations to live databases. For an audit
portfolio recoverability is part of the deliverable, not housekeeping: a suite with exemplary access
control and no restore path fails the review.

⚠️ **Nothing alerts on failure yet.** `last-run.txt` is written as trivial `key=value` precisely so
a HUD widget can read it — the natural home once the fabric work lands. An unwatched backup is a
backup that stopped working three months ago.

---

## 3 · What was ceremony, and is now retired

Each line is a licence: you need not preserve the left column.

| Retired | Why it existed | What replaces it |
|---|---|---|
| **`ToDo.md`'s stable §-numbering** — "never reuse §6 · new topics start at §9" | Other docs cited numbers | Nothing cites them. Stage A deletes the file. Names, not numbers. |
| **Five parallel numbering vocabularies** — Waves 15–26, Phases 0–8, `W6.5e`, `P0.1–P0.3`, `M1–M7`, `§8.x` | Each invented for one program, never retired | One backlog, named items. |
| **`[FEAT-P]` · `[FEAT-M]` · `[opus]` · `[PARKED]`** | Routing hints for a previous agent split | Drop it. |
| **"§1–§7 PARKED — don't pick anything up on your own initiative"** | A freeze while the music work ran | A backlog nobody may touch is not a backlog. Stage A re-derives what's open from code; what doesn't survive was never real work. |
| **"`Documentation/` is the source of truth"** — stated two lines above "when a doc disagrees with code, the code wins" | Aspiration | **The code is the source of truth. A doc is a map, and a map that hasn't been re-walked is a rumour.** |
| **"Suite scope = five systems"** | True in June | **Eight**: BeigeBoard · jkAuth · jkDeploy · ORDECK · Weave · LazurOS · PapyrOS · KourOS. |
| **Wave-log docs as reference** — `BEIGEBOARD_PARITY.md` (47 KB), `BEIGEBOARD_FULL_PRESS.md` (16 KB), `PLAYER_PARITY.md` (17 KB) | Working notes from finished programs | History. Git has it. |
| **Judging Weave by how much traffic it carries** | The prior audit's framing | ⭐ **Weave is a dev-time contract boundary, not a runtime message bus.** See below. |
| **Docs asserting invariants the code violates** — ARCHITECTURE.md's "there is no per-app preferences store" (three apps use `localStorage`); WEAVE.md's "each app verifies its own id" (`JKOS_APP_ID` set nowhere) | Written when true, never re-walked | **An invariant in prose is not an invariant.** Delete the unenforced claims; make the enforceable ones probes (Stage E). |

### ⭐ What Weave is actually for

Each app is built by a fresh agent. Weave exists so that agent can **decide its own internals
freely as long as its declared inputs and outputs stay consistent suite-wide.** The declaration is
the thing the *next* agent reads instead of reading your source.

The code already knows this. `scripts/templates/new-app/backend.discovery.js`: *"Pure data + zero
side effects: safe for the suite-prober, a workshop GUI, or **an AI composer** to `require()` with
no env/DB/network."* The `capability-completeness` probe: *"a non-technical user composes via a GUI
/ **by describing intent to an AI**."*

So **"zero cross-app calls in production" is the expected steady state, not a defect** — and the
prior audit's central complaint is mostly answered by re-reading the goal. What *is* a defect is
anything that hands a fresh agent wrong or incomplete information. That inverts the severity of
several findings; Stage D is re-ranked accordingly.

**One consequence, stated because it is easy to get backwards:** the fix for two apps having
identical `history` tables is **not** a shared implementation. Each app owns and knows its own
data — that is the point. The fix is a **common declared shape** that Weave can fan a query out
over and merge. Independent implementation, consistent outputs. See Stage D, item 6.

---

## 4 · The work

### Stage A — Make the working surface trustworthy

*Do this first, completely, and commit it separately. It touches no runtime behaviour, so it should
be a boring, reviewable diff.*

**A1 · Land or discard the uncommitted work.** Read each of the 10 diffs and decide. Everything
after this assumes a clean tree.

⚠️ **Four of those diffs are a correctness fix the paused backfill depends on — land them, don't
discard them.** They are documented (`music/README.md`, ToDo §8.9); an earlier draft of this
document said `ship.py` was "referenced by no doc", which was written before they were.

- **`music/descriptors.py` — `artist_of` rewritten, and this one is load-bearing.** Jag's library
  is now a *mix* of flat (`<Artist> - <Album>/…`, 9,689 tracks) and artist-nested
  (`<Artist>/<Album>/…`, 31,297) layouts. The old reader was `dirname(album_of(path))`, correct
  only for nested: for a flat album the parent **is the library root**, so **10,771 tracks (22.7%)
  collapsed into one fake artist named `/mnt/Luna/Plex/Music`**. Nothing errors. It reaches
  production through `query.fit_calibration`, whose stranger pool excludes same-artist pairs — so
  `calib_stranger_spread`, *the number KourOS divides every served cosine by*, would be fitted on a
  biased population. The fix reads **directory-first, not prefix-first** (prefix-first miscredits
  494 nested tracks whose album *title* contains a hyphen). Result: 1,515 real artists, 0
  unresolved.
- **`apps/kouros/backend/src/discover/vectors.js`** — the same precedence flip in the tier-3
  content key, so the two seams cannot disagree about what an artist is.
- **`music/ridge.py`** — `CHECK_SET` repointed to the four check tracks' new paths. Note this cost
  *one loud test failure* rather than the silent PASS-shaped skip the same reorganisation caused in
  August, because `check_set_missing()` exists now.
- **`music/ship.py` + `music/tests/test_ship.py`** (new, 16 tests) — the KourOS hand-off, which had
  no tool. `VACUUM INTO` an atomic fully-checkpointed single file, then verify **the copy**.
  ⚠️ Never `cp index.db`: it is WAL with a commit per track, so a plain copy is a pre-checkpoint
  snapshot that opens cleanly and reports a *plausible, smaller* count — indistinguishable
  downstream from "the backfill hasn't got there yet". `ship.py` also refuses an index with no
  fitted geometry, paths that miss the library root segment, or mixed dimensions.

Verified green at the time of pausing: **`music` 418 tests, KourOS smokes 144, `pnpm
test:contracts` 0 drift.**

**A2 · Rebuild `Documentation/`.** 20 files, 618 KB, several of them working notes from finished
programs and several making claims the code contradicts. Target: a small set of docs with **every
claim re-read in source before it survives.**

| File | Size | Decision |
|---|---|---|
| `README.md` | 8 KB | **Keep, trim.** Fix the app roster. |
| `ARCHITECTURE.md` | 68 KB | **Rewrite from code, much shorter.** The README calls it "start here for any engineering work" and it states at least two invariants the code violates. |
| `OPERATIONS.md` | 20 KB | **Keep, verify.** Highest ratio of still-true content in the directory. |
| `TESTING.md` | 26 KB | **Rewrite.** Stage B changes the harness contract and Stage E adds probes; this must describe both. |
| `DESIGN.md` | 68 KB | **Rewrite against the new factory (Stage F).** The token contract and per-app constraints are live and gated; the narrative around them is three design programs' worth of argument. |
| `WEAVE.md` | 18 KB | **Rewrite as the spec a fresh agent implements.** Audited 2026-08-26 — see **A2b** for what it's missing. |
| `PRIMITIVES.md` | 30 KB | **Keep the command/gate catalog; drop the component census** (already wrong — a third of `@jkos/cards`' exports have no consumers). |
| `ALGORITHMS.md` | 64 KB | **Keep.** Active design record, written this month. |
| `ROUTINES.md` | 23 KB | **Keep, trim.** Re-verify §4 and §10.5 — both describe traps Stage D fixes. |
| `LAZUROS_STARTUP.md` | 26 KB | **Keep.** Jag's hardware bring-up checklist; nothing in a checkout replaces it. |
| `KOUROS_ANDROID.md` | 7 KB | **Keep.** Live TWA/asset-link config. |
| `PLANNING_METHOD.md` | 18 KB | **Keep as informational only.** Useful background on the breakdown method; **this document is authoritative where they touch.** |
| `BEIGEBOARD_PARITY.md` · `BEIGEBOARD_FULL_PRESS.md` · `PLAYER_PARITY.md` | 80 KB | **Delete.** Wave logs. |
| `QUICKSTART.md` | 7 KB | **Delete.** Duplicates the README with a second set of facts to keep true. |
| `VAULTOS.md` | 6 KB | **Delete.** Parked entirely; ZFS covers the need. |
| `ROUTINE_PROMPT.md` | 16 KB | **Regenerate, never hand-edit.** Build output. |
| `ToDo.md` | 54 KB | **Delete.** Re-derive anything still open from code — don't carry it across on the strength of a checkbox. |

Then write **`Documentation/BACKLOG.md`** (what's genuinely open after that pass) and
**`Documentation/TRAPS.md`** (see A3).

**A2b · What `WEAVE.md` is missing — audited 2026-08-26.** The audit question was *"could a fresh
agent build app #9 from `WEAVE.md` plus the `new-app` template alone?"* Answer: **it would weave in
correctly and then fail roughly six gates**, because the doc covers *integration* and the gates
enforce *conformance*, and the two lists are different lengths.

`WEAVE.md`'s "Adding a new app (full onboarding)" is five steps. Reality needs at least these too,
each demonstrably required by something already in the tree:

- **Add the app id to the `APP_IDS` union** in `manifest.ts`. Typecheck-blocking, and mentioned only
  in the doc's changelog footer.
- **Write a jkAuth migration.** The doc says "seed an `app_registry` row" — but `seedAppRegistry()`
  only inserts rows on a *fresh* DB, so an existing deployment needs a migration. That is precisely
  why migration 015 exists (LazurOS was added late). The stated step does not work on any deployed
  environment.
- **Both compose files**, and a Dockerfile whose deploy-bundle copies are *closed under workspace
  deps* — an actual gate (`pnpm check:docker`) with three logged traps behind it.
- **A smoke test, chained into `pnpm test:contracts`.** The onboarding says nothing about tests; a
  fresh agent following it ships an app with no coverage and never joins the gate.
- **A `typecheck` script** — the `typecheck-coverage` probe asserts every TS package defines one.
- **Frontend conformance:** `useAuth` as a thin re-export of `@jkos/auth-client` (`check:auth`),
  every input through `.jk-field` (`check:fields`, which scans the whole suite), the loading/error/
  empty triad through `<AsyncView>` (`check:async-view`), `injectJkOSTheme` for the design factory.
- **A port** — and there is no single-source port table to claim one from, which is OPS-1's third
  hole (Stage B).

**Make the obligation table the complete list, derived from the gates.** Today §"The contract" names
eight obligations and the gate enforces more, so there are two authorities and they disagree —
the same declared-vs-enforced defect this whole pass is about, one level up.

**Four holes in the contract itself**, all of which Stage D depends on:

1. **No async result contract (WV-5).** Already indexed. Blocks the binding vocabulary (Stage D
   item 13) and therefore the widget factory.
2. **No pagination or limit contract.** Every app hand-rolls its own clamp — `(limit, 120, 600)`,
   `(limit, 300, 2000)`, jkAuth's `Math.min(limit || 50, 200)`. Three conventions. **This blocks the
   activity contract (Stage D item 6)**: you cannot merge a fan-out across apps whose pages have
   inconsistent bounds.
3. **Declaration versioning is declared and not actionable.** `docShape.js` checks
   `typeof doc.version === 'number'` and the doc says "bump on a breaking field change" — but
   nothing anywhere says what a *consumer* does with a version it doesn't recognise.
4. **No peer-down or idempotency semantics.** Both become load-bearing in Stage D: the activity
   fan-out needs to define what a caller gets when two of eight apps are unreachable, and the
   trigger engine needs idempotency or a retried DO double-writes.

**A2c · The four holes, decided.** ✅ *2026-08-26 — standardization over flexibility, in every case.*
These are rulings, not options. Write them into `WEAVE.md` and enforce each with a probe; the rewrite
is then a transcription job rather than a design job.

1. **Async results.** A capability declares `resolves` alongside `returns`. `returns` describes the
   HTTP response (a job handle); `resolves` describes what the work eventually produces.
   `validateTriggerTypes` binds against `resolves`, never `returns`. Job completion is itself a
   trigger event. Any capability declaring `returns: JOB_HANDLE` **must** declare `resolves`.
2. **Pagination.** One primitive: the **`since` cursor**, which already exists. **No `offset`** — it
   is unstable under concurrent writes and this suite has a cursor precisely because that mattered
   once. `limit` gets a suite-wide default and maximum in one shared constant, replacing the three
   hand-rolled clamps. Every dataset read accepts both; the prober asserts it.
3. **Declaration versioning.** A consumer reading a `version` **higher than it knows fails closed**
   with a named code — never silently degrades, never guesses at a field. A declaration is a
   contract, and a consumer that half-understands one is worse than a consumer that refuses.
4. **Peer-down and idempotency.** A fan-out **always** returns an explicit per-app status list
   alongside the merged data — a partial result must be visibly partial, never silently short. And
   every write capability accepts an optional idempotency key, which the trigger engine **always**
   sends, so a retried DO cannot double-write.

**A3 · Rebuild memory — distil, don't delete.** This is the one place in the reset where burning it
all costs something. Those 59 files carry knowledge that is in neither the code nor the git log:
`@supports selector(::-webkit-scrollbar)` is **true in Gecko** so it can't detect webkit;
`np.fft.rfft` upcasts float32→complex128 so a long track blows a gigabyte of transient; a Python
default argument is evaluated once, which is how three `music/` functions captured a module
constant; `scrollbar-color` kills every webkit scrollbar pseudo; `color-scheme` is the only lever
over engine popups. Each cost a debugging session.

1. Read all 59. Extract every claim that is a **durable trap** — true about an engine, a library, a
   filesystem, or this repo's shape, and expensive to re-learn.
2. **Re-verify each against current source before it survives.** Several name files, functions or
   flags that have moved or been deleted. A stale trap is worse than none.
3. Write survivors to `Documentation/TRAPS.md`, grouped by domain (CSS/engines · Node/pnpm ·
   SQLite · Python/numpy · Docker · this repo's shape). Versioned, in the repo, where a truncating
   index can't hide them.
4. **Then** write a memory set small enough to load: **ceiling of 12 files**, one index line each,
   `MEMORY.md` under 6 KB. Memory holds who Jag is, how he wants you to work, and pointers.
   Delete the other 47.

Three memory facts carry forward verbatim, because they're standing instructions and not project
state: **don't wait for approval between waves of unblocked work**; **throwaway verification
scripts stay in the scratchpad — ask before promoting one to a committed test**; and
**`apps/sylibos/` is off-limits**.

**A4 · The filesystem.**

- **Delete `.design-sync/` (72 tracked files), `.ds-sync/` (46 MB), `ds-bundle/` (7 MB).**
  ✅ *Decided 2026-08-26:* the `claude.ai/design` round-trip was for a BeigeBoard build and is
  done. This removes a second copy of the design system immediately before Stage F rebuilds the
  first one.
- `.git-backups/` (2.7 MB, gitignored monorepo-consolidation tarballs) — confirm, then delete or
  move off-repo.
- **`music/` is 2.8 GB and the breakdown matters — do not treat it as one blob.** `.venv` **2.4 G**
  · `models/` 269 M · `index.db` **157 M** · `out/` 6.4 M · `Downloader` 24 K. All gitignored, so
  a cleanup pass gets no warning from git. **`index.db` is 35,460 encoded tracks (§0a) and `.venv`
  is the `onnxruntime-gpu` build that makes the run 21× faster — leave both.** `models/` holds the
  281 MB CLAP export; deleting it means re-exporting through a throwaway venv. `out/` is
  regenerable SVG/snapshot output and is safe to clear. Check `music/Downloader`; it is undocumented.
- Re-read `.gitignore` / `.dockerignore` / `.claudeignore` against what's actually there.

### Stage B — Make the gate tell the truth

**B1 · Harden the smoke harness (OPS-1).** Three holes had to line up for eight BeigeBoard/PapyrOS
assertions to run green against a *KourOS* server, and all three are present in all six harness
files:

- Assert `body.service === '<this app>'` in `waitForHealth()`. The uniform health contract already
  returns the app id — the check that would have caught this is one field away and nobody reads it.
- Fail fast on `child.on('exit')` before health resolves; print `serverLog` on **any** failure.
- **Build a real port registry**, not just a shared constant. Today 3991 is claimed by BB's
  `routines.smoke` *and* PapyrOS's `playback.smoke`; 3992 by `routine-spec.smoke` *and* PapyrOS's
  `meta.smoke` — and a new app has nowhere to claim one from, which is a documented gap in the
  onboarding path (A2b). One table in `@jkos/suite-manifest` covering both service ports and test
  ports, a duplicate being a startup error, and a probe asserting no two claimants collide.

### Stage C — jkAuth: rebuild it into the portfolio centrepiece

✅ *Decided 2026-08-26.* jkAuth becomes **its own polished SSO**. The external-identity surface
comes out; the security surface an auditor would look for goes in. Full findings: **Appendix A**.

**C1 · Remove Google OAuth and the external account syncs.** Can be re-added later; it is not what
this project is demonstrating. Removal scope: `src/routes/google.js` (120 lines), the `GOOGLE_*`
config block, `OAUTH_NONCE_COOKIE`, the `RL_GOOGLE` limiter, the Google button in `views.js`, and
`users.google_id` (a `UNIQUE` column from migration 001 — leave the column and stop writing it, or
add a migration; don't drop it silently). `avatar_url` is populated from the Google CDN, so decide
what it means afterwards.

**C2 · Fix the six high-severity findings.** JK-A1 (guest login verifies no credential), JK-A2
(reuse detection silently expires after 1 hour), JK-A3 (no absolute or idle session timeout), JK-A4
(TOTP secrets stored in plaintext), JK-A5 + JK-A6 (session-cap ordering; claim-then-issue not
atomic). Details and mechanisms in Appendix A.

**C3 · Build what a polished SSO is missing.** Not defects — absences:
- **No password change and no password reset exist at all.** `PATCH /auth/profile` accepts `name`,
  `avatar_url`, `preferences` and not `password`. There is no forgot-password flow, no reset token.
  A credential that cannot be rotated is an audit finding on its own.
- **No email verification at registration** — and email is the 2FA delivery channel, so email-OTP
  2FA currently delivers to an unverified address.
- **Session management for the user:** a "your devices" view. Needs `sessions.last_used_at` and a
  revocation tombstone (today logout hard-`DELETE`s the rows, destroying the evidence).
- **Action logging beyond auth.** `auth_events` is good and reviewable via `GET /auth/events`
  (admins see all, users see their own) — but it covers *authentication only*. Profile writes,
  preference writes, and **admin widget publish/delete** (a suite-wide change to every user's HUD)
  are unlogged.

**C4 · Least privilege.** `roleClaims()` emits exactly `<app>:read` + `<app>:write` (non-guest) +
`<app>:admin` for **every** app the role can reach. So anything holding `beigeboard:write` can
delete the whole board, and LazurOS's write-back needs delete rights to import one parsed task. Let
a capability declare its own scope name and derive the grantable set from registered capability
docs. ⚠️ This runs straight into JK-A18's uncached registry claims — do them together.

**C5 · An authorization policy layer.** ✅ *Decided: keep three roles, extract the enforcement.*
`guest`/`user`/`admin` is the right granularity — the problem is that authorization is expressed as
inline string comparisons (`if (user.role !== 'admin')`) scattered across routes, with no single
place to read the policy or test it. One policy module, one call shape, every route deriving its
check rather than re-typing it. Combined with C4 this is the architectural centre of an
access-control portfolio piece, and it is the difference between "we check roles" and "here is the
policy, and here is the test that proves every route applies it."

**C6 · An XSS pass over `views.js`.** 292 lines of server-rendered HTML, read in the 2026-08-26 audit
only for the Google button and the CSP nonce. Audit every interpolation against `escHtml` usage. The
nonce-based CSP is real defence-in-depth, but it is not a substitute for escaping, and this file
renders user-controlled values (name, email) into markup.

**C7 · Turn on `aud`.** jkAuth computes and mints a per-role audience and **nothing verifies it** —
including jkAuth, whose own `resolveUser` passes no `audience` to `jwt.verify`. Verification is
opt-in behind `JKOS_APP_ID`, set in no compose file. With one cookie for every `*.jkos.net` host,
this claim is the containment. Set it per service in both compose files, and add a boot assertion.

### Stage D — The backend and the fabric

Full index: **Appendix B**. **Re-verify before you fix** — that audit is a week old and five
findings are marked *Partial*. Re-ranked per §3: defects that mislead a fresh agent are promoted;
defects that were only "this machinery is unused" are demoted.

1. **The three self-contained ones.** A write-once trigger on `started_at` (**BB-11** — the data is
   unrecoverable, so every day costs history; match `completed_at`'s pattern in a *trigger*, not a
   route, or the import path stays open). Route the routine purge through `cascadeDelete`
   (**BB-12**). `CREATE INDEX` on `items.parent_id` (**BB-14**).

2. **Atomicity, as one class.** Wrap migrations (**BB-13**), moving the `foreign_keys` pragma out
   of migration 3 first — the pragma is a no-op inside a transaction. jkAuth's two instances are
   C2. *(jkAuth's migration runner is actually better than BeigeBoard's: idempotent bodies +
   `addColumn` self-heal. Copy that pattern.)*

3. **⭐ Complete the declarations.** Under §3 this is the highest-value backend work, because it is
   the only class that actively misinforms the next agent.
   - **BB-7:** BeigeBoard serves 30 routes and declares 11 surfaces. `/routines/:id/metric`,
     `/series`, `/preview`, `/revisions`, `/vocabulary`, `/prompt`, `/bundle` and all three
     calendar routes are invisible to the fabric.
   - **XC-7:** KourOS's `discover/` is 1,697 lines of CLAP-vector similarity search behind seven
     routes and `discovery.js` declares none. *"Play something that matches this routine's energy"*
     is blocked by the declaration, not by the music work.
   - **The seven `json` escape-hatch gaps** the prober already names.
   - **BB-9:** `library`'s two filters carry no `column`/`op`, the last hand-written filter SQL in
     the suite.

4. **Wire-format consistency (XC-1).** `defineCollection` stamps `datetime('now')` — whole seconds
   — in nine collections across three apps, while BeigeBoard's `items` moved to millisecond ISO in
   migration 8 *because* second resolution loses same-second writes. Worse, the two formats sort
   against each other incorrectly as strings, so a cursor is not portable across the suite even in
   principle. One line in `collection.js`, a backfill per app, the format pinned in a shared
   constant, a prober assertion. PapyrOS's offline write queue reconciles on this cursor.

5. **Define "today", once (XC-4).** Four notions coexist and there is **no** notion of *where*:
   `X-BB-Today` (one sender), `routines.js`'s UTC `iso()`, `items-store.js`'s `toISOString()`,
   `@jkos/cards`'s local-tz `isoDate()`. Add `timezone` to the jkAuth preferences contract; one
   `callerDay(req)` in `@jkos/weave/server` reading one standard header; make `isoDateStr`/`fmt24`
   take an explicit zone. Closes **BB-2, BB-10, BB-15, JK-A11**. An unspecified suite-wide input is
   exactly what agent #9 will reinvent.

6. **⭐ The activity contract (XC-2).** Four per-user append-only records of what the user did — BB's
   `started_at`/`completed_at`, PapyrOS's `history`, KourOS's `history` (field-for-field identical
   to PapyrOS's, invented independently), LazurOS's `jobs` — in four schemas, none aggregatable.
   **Declare one shape; do not share an implementation.** Each app stays authoritative about
   itself and answers about itself; Weave fans the question out and merges. Two payoffs: it makes
   "what did I do today" answerable across the suite, and **the same mechanism is the suite's
   action-audit trail** (§1), which is why it moves up the list rather than staying a nice-to-have.

7. **Routine identity and reachability — together.** Key every occurrence reader on `ext_ref`
   (**BB-3**: the file says *"THE REF IS THE AUTHORITY, not parent_id"* and four of five call sites
   use `parent_id`; a dragged occurrence keeps its ref, leaves the subtree, drops out of the tally,
   and the mint's re-insert is swallowed by `INSERT OR IGNORE` with no error). Resolve the `ext_ref`
   namespace while identity is open (**BB-5**: `beigeboard:41`, `itunes:1234567`,
   `routine:24:2026-08-18` share one column — *"an AI author reading the dataset docs cannot tell
   these apart"*). **Then** take the reconcile off the read path (**BB-1**: it fires only on an
   unfiltered non-guest human read, so all seven declared filters disable it and no service token
   ever triggers it). ⚠️ **BB-1 alone leaves orphans; BB-3 alone leaves peers on a stale horizon.**

8. **BeigeBoard's write notifications, then ORDECK's read.** BB has no `@jkos/weave` dependency
   (**BB-4**) so its writes never `invalidate('beigeboard.items')`. Under §3 it needn't *consume*
   the fabric — but it must publish invalidations, because ORDECK really does read it. Then narrow
   ORDECK's fetch (**XC-3**: the whole items table every 60 s, none of the seven filters, never the
   `since` cursor). ⚠️ **XC-3 before BB-1 stops routines minting** — ORDECK's unfiltered poll is
   currently the only thing firing the reconcile.

9. **Extract `routine-spec` to a package (BB-8).** 1,666 backend lines + a 1,045-line frontend
   mirror of the same engine. The backend file is already zero-dependency, pure, no I/O, no `Date`
   — the profile of a shared package — and `check:routine` already drives both through one matrix,
   so the harness proving the extraction was faithful exists before you start. **−1,045 lines.**

10. **Calendar sync onto `defineConnector` (BB-6).** 247 lines of near-identical
    Google/Outlook/iCloud blocks, none declared, no scheduler, and a disconnect that raw-`DELETE`s
    items bypassing `cascadeDelete`. `provider.js` unified the fetch half; the HTTP half never
    followed. **After item 5**, so providers are rewritten once.

11. **Provisioning (WV-1).** `weaveServerClient()` mints a service token via `POST /auth/token`,
    which 503s unless `JKOS_SERVICE_CLIENTS` is set — and it appears in no compose file. So
    LazurOS's write-back, the whole G1 seam, throws on first call in any deployed environment. Set
    it, `JKOS_DELEGATION_CLIENTS`, and `JKOS_APP_ID` (C7), plus a boot assertion so an app that
    *declares* it needs a service client fails loudly at startup, not at the first delegated write.

12. **The data-model gap.** The audit's answer to *"does the planner need more primitive types?"* is
    **no, and adding one would be a mistake** — `goal/milestone/task/event/routine` is the right cut
    and "task is the only schedulable leaf" is why Today, Week, Calendar, ORDECK and the weave
    dataset need zero routine awareness. Missing is one table and three columns: **`item_deps`** (an
    edge table — the one place a column won't do; you have decomposition and ordering and nothing
    expressing "can't start B until A ships", which is the question a planner exists to answer),
    **`estimate_minutes`** (the bench expresses commitment, nothing expresses cost, so nothing can
    say the week is overcommitted), **`defer_until`**, and a **parameterised mint kind** (**BB-16**:
    `routines.js:481` hardcodes `'task'`, so a standing weekly meeting can't be authored natively).
    All four land in `item-fields.js`, which already derives `ITEM_SHAPE`, `ITEM_COLUMNS`, the
    import cleaner tables and the enums from one list. **After items 4–7**, on a settled schema.

13. **The binding vocabulary — do not delete the trigger engine.** `createTriggerEngine`,
    `resolveBindings`, `validateTriggerTypes`, `triggerWebhook`, `serverDispatch` have no consumers
    (**WV-2**), and the instinct to bin them is wrong. `trigger.ts`'s header — *"the design-time
    shapes a Workshop GUI / an AI emits"* — is the same sentence `WidgetSpec`'s docs use. They are
    two halves of one system that never met: `WidgetSpec` binds a dataset into a primitive tree
    (**read**); `TriggerDef` binds a capability's typed `returns` into another's body (**write**).
    ORDECK's Workshop already does binding by hand in a third vocabulary. **Converge them on one
    binding model** — that is the spec the next run's widget factory is built from.
    ⚠️ **WV-5 blocks this:** every LazurOS capability declares `returns: JOB_HANDLE`, correct for
    the HTTP response and useless for composition, so `validateTriggerTypes` will cheerfully
    type-check a job handle into a task title. Async needs `resolves` alongside `returns`, plus job
    completion as a trigger event. **Spec revision, and it gates the widget factory — decide early.**

**Small and concrete: mount the music library.** KourOS is built and staging-ready and has never
had a library. Set `MUSIC_DIR` in both compose files to the **host** path
**`/mnt/Luna/Luna/Plex/Music`** — 47,491 FLACs. ⚠️ **Not `/mnt/Luna/Plex/Music`**, which also exists
on that host and is empty; see §2. Mind that the layout is mixed (artist-nested *and* flat album
dirs) and the paths are hostile (`!!!`, `[24B-96kHz]`) — the scanner must handle both shapes.

**Also in scope, unsequenced:** **WV-6** (two hardcoded per-app branches in code documented as
app-agnostic — LazurOS's write-back keys a literal `{'parse-task': {app:'beigeboard',
path:'/import'}}` instead of resolving `importItems` from the peer's capability doc; ORDECK's
systems panel does `if (a.id === 'lazuros')` inside a loop whose comment says apps appear without
a portal change). **WV-8** (jkDeploy isn't in `@jkos/suite-manifest`, so "deploy staging" can't be
a HUD button). **XC-5** (three apps keep user-level settings in `localStorage` against a doc saying
the store doesn't exist; the prefs blob has no namespacing convention, which matters if `timezone`
is joining it). **XC-6** (`<AppShell>`/`<AsyncView>` reached PapyrOS and KourOS and stopped — two
apps on a primitive and two off it is where a primitive stops being one).

**Demoted, per §3:** **WV-7** — `useCalendarSource` plus eight other `@jkos/cards` exports have
never been called. **Delete them.** An unused export is *worse* than a missing one for a fresh
agent: API surface that looks supported.

### Stage E — The ratchet

`pnpm prove` reports zero drift and is telling the truth: its question is *"does what an app
declares match what it enforces."* Every defect above is orthogonal to that. Three probes close the
class:

1. **Surface coverage.** Census every mounted Express route against the app's declared capability
   and dataset paths; gap unless it carries an explicit `app-private` marker. **This is the single
   highest-value item in the plan** — `capability-completeness` audits the *typing* of what's
   declared and never asks whether the declaration covers the code, which is exactly how BB-7 walks
   past a green prober. *Would flag today: BB 30 routes / 8 declared paths · KourOS 11 undeclared
   reads · PapyrOS ~6.*
2. **Provisioning.** Extend env-conformance to the compose files and to the capability level: an app
   declaring a delegated write needs `JKOS_SERVICE_CLIENT_*` present, not merely documented. *Would
   flag today: the three variables in Stage D item 11.*
3. **Declared column invariants.** Let `item-fields.js` carry machine-readable flags —
   `writeOnce`, `serverManaged`, `indexed` — and assert each against the actual schema and write
   path. `completed_at` has enforcement; `started_at` has only prose. *Would flag today: BB-11,
   BB-14.*
4. **Shared-shape conformance.** Does an app with activity-shaped data declare the activity
   contract (Stage D item 6)? Conformance to a declared shape — **never** code sharing.
5. **Supply chain and secrets.** ✅ *Decided: both belong in the gate.* A dependency-vulnerability
   step (`pnpm audit` at an agreed severity floor) and a secret scan over the working tree. Both are
   standard audit-checklist items, both are cheap, and their absence is itself a finding in a
   security-focused portfolio. **Separately, and as an investigation rather than a gate:** check
   whether anything sensitive was ever committed. ⚠️ **Report, do not rewrite history** — that
   coordinates with GitHub and is destructive; it is Jag's call once he knows.
6. **Contract rules from A2c.** One probe each for `resolves`, the cursor/limit convention, the
   fail-closed version rule, and the per-app status list. A ruling nothing enforces is prose (§1.2).

⚠️ **Do not build a "is anything consuming this contract?" probe.** Under §3 an unconsumed contract
is the correct steady state; such a probe would flag the whole suite and the only way to satisfy it
would be to invent consumers.

### Stage F — The design factory

✅ *Decided 2026-08-26.* **The visual language is parked for the duration of this stage** — this is
a restructure, not a retune. That decision is what makes the whole stage provably safe, so hold it:
if a visual change is wanted, it is a separate pass *after* this lands.

**The goal is not better CSS. It is a factory the next run's widget factory can read.**
`WidgetSpec` composes `body: WidgetNode` from primitives, and *something must be able to enumerate
what primitives exist, what each takes, and what nests in what.* Today nothing can: `hub.css` is a
2,728-line stylesheet, and the only thing that enumerates it is `check:design` scraping top-level
class names. **The factory must emit a machine-readable manifest** — the same kind of artifact
`discovery.js` emits for backends: pure data, requireable with no browser. That manifest is this
stage's primary deliverable.

**What the accretion actually is.** The apps are well-behaved — ORDECK's `hud.css` has 248 `var()`
references and 4 hardcoded hex; KourOS's `views.css` 161 and 2. The problem is structural:

- **A three-tier system exists and was never declared.** 152 tokens: 62 on both faces, **90
  light-only, 0 dark-only**. That asymmetry is mostly correct — tier 1 is raw per-face
  (`--hub-bg-0`, `--hub-cream-bright`, `--hub-amber`), tier 2 is semantic aliases whose referent
  moves (`--color-paper: var(--hub-bg-0)`), tier 3 is face-invariant geometry (`--jk-canvas`,
  `--hub-clip-widget`). Good architecture, discovered by accident.
- **The prefixes cut across the tiers instead of naming them.** `--hub-*` spans tiers 1 and 3,
  which is why 111 of its 167 tokens are per-face and 56 aren't. *Does this token need a dark
  value?* is currently answerable only by reading the whole file. **Name the tiers; make the prefix
  carry the tier; only tier 1 gets a dark block.**
- **Nine prefixes from nine programs:** `--hub-*` 167, `--color-*` 31, `--jk-*` 15, `--accent-*` 11,
  `--crt-*` 7, `--grain-*` 4, `--canvas-*` 2, bare `--accent` 2, `--bar-*` 1. Four accent schemes
  coexist (`--accent-raw`, `--hub-amber`, `--color-accent`, `--accent`) — **retire the pigment
  names**, nothing in the token layer should name a colour it might not be.
- **Sections named after the program that added them:** *"Full Press entrance physics (Wave 24)"*,
  *"the Full Press chip system"*, *"Chips — the Full Press solid-ink tab (SUITE DEFAULT)"* (annotated
  as the default because there was a previous one). **Reorder by system:** ground → type → colour
  chain → geometry → materials → controls → motion. Delete every archaeological label.
- **26 un-namespaced global classes** in the shared stylesheet — `.glow`, `.led`, `.seg`, `.stamp`,
  `.perf`, `.rest`, `.miss`, `.now-dot`, `.bar-fill`, `.canvas-cell`… `.glow` and `.jk-glow` both
  exist. Migrate into `.jk-*`, delete the duplicates.
- **A 2,731-line generated mirror.** `apps/jkauth/public/jkos-tokens.css` is a full copy, because
  jkAuth is statically served. Gated by `check:tokens`, so it's safe — but every structural change
  is a change to two files. Decide: keep it as a build artifact, or give jkAuth a build step.

**BeigeBoard is the specification, not the test case.** It already embodies the settled language,
so the rebuilt factory is **correct iff it can express BB with identical computed values.** Build
that check **first, as step zero**: dump every token's computed value on both faces from headless
Chromium, rebuild, assert byte-identity. There is a harness pattern for this already (esbuild +
headless Chromium, used for the scroll and field work). It converts the scariest item in the plan
into a provable no-op — necessary because **every gate in this suite is a text-scan gate and there
is no visual regression test.** `check:design` catches *stale* and *undemoed*, never *changed*.

And the failure mode is informative: if the factory can't express something in BB without a bespoke
escape hatch, **the factory is missing a primitive** — almost certainly one ORDECK needs too. BB's
edges are the primitive backlog.

**Glass — the provenance material.** ✅ *Decided 2026-08-26.* Glass is **not** suite chrome and not
KourOS's signature. It is the treatment for **imported assets**: an album cover should look printed
onto or from glass. Most assets are for use, not for the pretty factor — so the material is
restrained and scoped.

The rule that falls out, and it is worth writing into `DESIGN.md` because it settles every future
instance without asking: **glass is for pixels the suite didn't author; paper and press are for
pixels it drew. The material marks provenance.**

Concretely: `apps/kouros/src/glass.css` is 275 lines with **27 raw `rgba`/`hsl` literals**, and
everything in it is chrome — `.kr-ambient`, `.kr-orb-lg/md`, `.kr-par` (parallax), `.kr-ghost`.
**Delete the ambient decoration; promote the glass material tokens into the factory; apply them on
the cover primitive** — `.jk-media-cover` in `hub.css` and `CoverArt.tsx` in `@jkos/ui`, already
described in its own header as "the suite's canonical cover-art primitive." PapyrOS's book jackets
then get it too, and ORDECK gets it free.
⚠️ **Two `CoverArt` implementations exist.** `packages/player/src/ui/NowPlaying.tsx` has its own,
frozen under a "zero-behaviour-change contract for the Wave-15 migration," and its own comment says
it should re-point at the `@jkos/ui` one later. That migration finished, and the player bar's
artwork thumb is an imported asset. **Lift the freeze and converge them.**

### Stage G — Report

When the stages are done or explicitly stopped, write **one** report: what changed, what you
re-verified and found already true, what you found and did **not** fix, and what you'd do next. Not
a wave log — those are what Stage A exists to delete.

**What this run hands off.** ORDECK's redesign is **not** in scope, and neither is its widget
factory. This run's output is: a suite whose declarations are complete, a settled binding
vocabulary, and a factory with a machine-readable manifest — so that the next run can rebuild the
widget factory on both, and the ORDECK redesign after it is elementary.

---

## 5 · Rules of engagement

- **Verify, then trust.** Every doc claim and memory line predates you and several are wrong. Read
  the code. **This document included** — if §2's numbers don't reproduce, say so before building on
  them.
- **The gate is green at every commit.** If a stage makes it red, the stage isn't done.
- **Small, separately-committed diffs, one concern each.** Stage A holds no behaviour change; Stage
  D holds no doc rewrite.
- **Don't wait for approval between items you're already licensed to do.** Work through everything
  unblocked; surface the blocked ones together.
- **Prefer the enforceable fix** (§1.2). A trigger over a route check; a probe over a sentence.
- **Throwaway verification scripts stay in the scratchpad.** Ask before promoting one to a
  committed test — the suite's test style is uniform on purpose (`new-tester` has the patterns).
- **Say what you didn't do.** A stage half-done and reported as done is worse than one named as
  skipped.
- **Two skills already encode suite knowledge:** `suite-health` (run the gates and probers in
  order, map a failure to its known cause) and `new-tester` (author a test in the house pattern and
  wire it into the gate).

---

## 6 · Decisions on record

Settled 2026-08-26 — recorded so they're not relitigated. **Bias throughout: standardization over
flexibility, and the future-oriented option over the locally cheaper one.**

| Question | Decision |
|---|---|
| Is cross-app runtime integration the goal? | **No.** Weave is a dev-time contract boundary (§3). Zero cross-app calls is the correct steady state. |
| Shared shapes — preset library or declared contract? | **Declared contract.** Independent implementation, consistent outputs. Each app is authoritative about itself. |
| Async capability results | **`resolves` alongside `returns`.** Triggers bind against `resolves`. Mandatory for any `JOB_HANDLE` (A2c.1). |
| Pagination | **The `since` cursor only — no `offset`.** One shared default/max for `limit` (A2c.2). |
| Unknown declaration version | **Fail closed** with a named code. Never degrade silently (A2c.3). |
| Fan-out with a dead peer | **Always an explicit per-app status list.** A partial result must be visibly partial (A2c.4). |
| Write retries | **Optional idempotency key on every write capability; the trigger engine always sends one** (A2c.4). |
| Trigger engine — delete? | **No.** It's the write half of the widget factory (Stage D item 13). |
| jkAuth — audit or rebuild? | **Rebuild.** Google OAuth and external syncs out; polished SSO in (Stage C). |
| Role model | **Keep three roles; extract enforcement to a policy layer** (C5). No inline role comparisons. |
| SCA + secret scanning | **Both into the gate** (Stage E.5). Their absence is itself a finding here. |
| Secrets in git history | **Investigate and report. Do not rewrite history** — destructive, coordinates with GitHub, Jag's call. |
| Order of work | **Backend before the factory.** Reset → gate → jkAuth → backend/Weave → factory. |
| Visual language during Stage F | **Parked.** Restructure, not retune. |
| Glass | **The imported-asset material.** Provenance, not chrome. |
| `.design-sync/` | **Delete.** It was for a BeigeBoard build. |
| `.git-backups/` | **Do not delete — move off-repo into the protected set.** Pre-consolidation per-repo history may exist nowhere else; deletion is irreversible with unknown value. |
| `PLANNING_METHOD.md` | **Keep as informational.** This document is authoritative. |
| On-box backup | ✅ **Done** — snapshot task id 1, hourly/30-day on `Luna/Backends` (§2a). |
| Off-box backup | ◐ **Built** — `infra/backup/`, pull-based onto Jag's workstation, GPG-encrypted, fails closed. **Nothing leaves his hardware.** Two setup commands owed (§2a). |
| `MUSIC_DIR` | **`/mnt/Luna/Luna/Plex/Music`** — mind the empty decoy path (Stage D). |
| Music vector space | **Not this run** — but it is **74.7% built and PAUSED, not abandoned** (§0a). Resume is `backfill.py` with no arguments; the four files that silently invalidate it are named in §0a. A space built over 3% wasn't the deliverable, which is why it is being rebuilt over the full library. |
| ORDECK redesign + widget factory | **Not this run.** Handed off per Stage G. |

**The only open item:** credentials for the off-box backup target (§2a). Everything else above is
decided; if you disagree with one, say so and proceed under the decision — don't stall on it.

## Appendix A — the jkAuth audit, 2026-08-26

Fresh pass over the modules the prior audit never read: `routes/auth.js`, `twofactor.js`,
`routes/profile.js`, `routes/weave.js`, `routes/google.js`, `app.js`, `db.js` (all 16 migrations),
`config.js`, `util.js`, `email.js`, `tokens.js`. 2,250 lines total.

**Overall: this is careful, well-reasoned code.** Timing-safe login via `DUMMY_HASH`; SHA-256
pre-hash before bcrypt so the 72-byte truncation can't bite; a nonce-based CSP with no
`unsafe-inline`; per-account exponential backoff *and* per-IP limits, with a limiter that answers a
form post with a form and a JSON caller with JSON; refresh-token families with reuse detection;
`sub` stringified for strict verifiers; a real reviewable audit log. Several findings below are
gaps *in* good controls rather than missing controls.

### High

| ID | Finding |
|---|---|
| **JK-A1** | **`POST /auth/guest` never verifies `GUEST_PASSWORD`.** `seedGuest()` hashes it and stores it on the guest row; the route checks only `if (!GUEST_PASSWORD)` and then calls `issueTokens` immediately. The credential is stored and never compared — the variable is a feature flag wearing a credential's name. Anyone who can reach the endpoint gets a guest session. **A control that exists in config and in the database and is absent from the code path** — §1's marquee defect class. |
| **JK-A2** | **Reuse detection silently expires after 1 hour.** `issueTokens` prunes `rotated_at < datetime('now','-1 hour')`. Theft detection needs the rotated row to exist, so a stolen refresh token replayed after an hour hits `{status:'expired'}` — cookies cleared, **no `refresh_reuse` event, family not burned.** The documented anti-theft control covers 1 hour of a 30-day token lifetime, and the prune's own comment claims it keeps "tokens we still need to flag." |
| **JK-A3** | **No absolute session lifetime and no idle timeout.** Every rotation sets `expires_at = now + 30 days` while preserving `family_id`, so a continuously-refreshed session **never expires**. Nothing records family creation time, so an absolute cap isn't even expressible. Also `REFRESH_TTL_MS === REMEMBER_TTL_MS` — "Remember me" changes cookie persistence only; every session is a 30-day session server-side. |
| **JK-A4** | **TOTP secrets stored in plaintext.** `users.totp_secret` is read straight into `makeTotp`. One DB read is a permanent 2FA bypass for every user. Wants envelope encryption with a key from env. |
| **JK-A5** | **The session cap can delete the session it just created.** `ORDER BY created_at DESC LIMIT 10` over `created_at TEXT DEFAULT (datetime('now'))` — whole seconds. Ten un-rotated sessions in one second tie, and SQLite's tiebreak is unspecified. Symptom: a successful sign-in that is signed out on the next request. Fix: `, id DESC`. |
| **JK-A6** | **Claim-then-issue is not atomic.** `tryRotate` atomically claims the presented token, then calls `issueTokens` — four more writes — *outside any transaction*. Between them the only live refresh token is consumed and its replacement doesn't exist; a crash there reads as **theft** and burns every device on that login. `issueTokens` is equally unprotected on the login path. |

### Medium

| ID | Finding |
|---|---|
| **JK-A7** | **The second factor has no per-account throttle.** `login_2fa_fail` is logged but never increments `failed_attempts`, so the exponential backoff — the half whose own comment says it "tracks the account under attack rather than the address in front of it" — does not apply to 2FA. Only the per-IP limiter bounds it. |
| **JK-A8** | **Recovery codes: 40 bits under a bare unsalted SHA-256.** `crypto.randomBytes(5)` → `sha256(normCode(code))`. 2^40 is offline-brute-forceable in minutes on a GPU, and recovery codes bypass 2FA entirely, so they are password-equivalent. (The 6-digit email OTP is the same pattern at 10^6 — hashing it adds essentially nothing.) |

| **JK-A10** | **Session revocation destroys the evidence.** Logout and reuse both `DELETE FROM sessions WHERE family_id=?`. No `revoked_at`, no `revoked_reason`, no tombstone — and no `last_used_at`, so there's no "your devices" view and no dormant-session detection. |
| **JK-A11** | **`REFRESH_GRACE_MS` is 10 s measured against a 1-second clock.** `rotated_at` is `datetime('now')`, truncated to whole seconds, so the window has up to a second of slop. Truncation is in the safe direction (closes early), but this is the one place in the suite where second resolution gates a **security** decision. Same root as XC-1. |
| **JK-A12** | **No password change, no password reset, no email verification.** See Stage C3 — absences, not bugs, and each is an audit finding in its own right. Email is the 2FA delivery channel, so email-OTP 2FA delivers to an unverified address. |
| **JK-A13** | **Action logging covers authentication only.** 16 event types, all auth. Profile writes, preference writes, and **admin widget publish/delete** — a suite-wide change to every user's HUD — are unlogged. |
| **JK-A14** | **`aud` is computed, minted, and verified nowhere** — including by jkAuth, whose `resolveUser` passes no `audience` to `jwt.verify`. With one cookie for every `*.jkos.net` host, this claim is the containment. Stage C7. |
| **JK-A15** | **Least privilege: `roleClaims()` grants blanket `<app>:write` per role.** No capability can ask for less. Stage C4. |
| **JK-A23** | **`JKOS_SERVICE_CLIENTS` misparses silently on `:` or `,` in a secret.** `parseServiceClients` splits the list on `,`, then takes the first two `:` as delimiters. A secret containing a **comma** splits the entry, leaving a fragment with one colon → `continue`, and **the client silently does not exist** (every `POST /auth/token` for it 401s). A secret containing a **colon** truncates at it, and the remainder is parsed as scopes → the client exists **with the wrong secret and the wrong grant**, no error either way. Nothing validates or documents the charset. Timely because Stage D item 11 is about to provision these for real: generate secrets from a `:`/`,`-free alphabet, validate at boot, and document the constraint. |
| **JK-A16** | **`meta` truncated with `JSON.stringify(...).slice(0, 500)`** — cuts mid-string and produces invalid JSON. An audit record that cannot be parsed. |

### Low / notes

| ID | Finding |
|---|---|
| **JK-A9** | **The audit log's IP fallback is dead code, not a hole.** ⬇️ *Downgraded from High after verification by Jag, 2026-08-26.* `logEvent` reads `req?.ip \|\| req?.headers?.['x-forwarded-for']`, which looks spoofable and is not: nginx **appends** via `$proxy_add_x_forwarded_for`, and `trust proxy: 1` makes Express take the **rightmost** XFF entry — the one nginx appended from `$remote_addr` — so anything a client prepends lands to the left and is discarded. Verified empirically (`X-Forwarded-For: 6.6.6.6, 127.0.0.1` → `req.ip === '127.0.0.1'`) and in `proxy-addr@2.0.7`/`forwarded@0.2.0` source. `express-rate-limit`'s default `keyGenerator` uses `request.ip` only, so the limiter never touches this class. And jkauth publishes no host port in either compose file, so there is no path for a client to pose as the trusted hop. The `\|\|` branch never fires, because `req.ip` always resolves while the socket is live. **Still fix it, for the reason it was worth checking:** replace with `req?.ip ?? null` (an audit record with a missing IP is honest; one with a silently substituted value is not) **and assert the assumption it rests on** — `app.get('trust proxy')` matching the topology's hop count is exactly the invariant-in-prose class this pass exists to close, and it would fail silently if someone removed the setting or a topology change added a hop. Do it in C3. |
| **JK-A17** | `OTP_RESEND_MS = 30 * 1000` is declared and **never used** — the 30-second policy is hardcoded in SQL as `datetime('now','-30 seconds')`. Two sources, one enforced. |
| **JK-A18** | **Two registry caches with no invalidation.** `_cachedRoleClaims`, `_cachedAppOrigins`, `_cachedOriginToId` — documented as restart-to-refresh. Consistent today; a correctness bug the moment registry CRUD lands, and **C4's fix runs straight into it.** |
| **JK-A19** | **No TOTP replay protection** — a code is reusable inside its ±1-step (90 s) window. Wants a last-used counter. |
| **JK-A20** | **`resolveOrRefresh` rotates the refresh token on a GET navigation.** Not exploitable (an attacker can't read the response or the cookie) but it's a state change on a safe method. |
| **JK-A21** | **CSRF defence is `SameSite=lax` only**, no synchronizer token. Largely effective for POST, but worth stating as a documented decision rather than leaving implicit — and `lax` is not `strict`. |
| **JK-A22** | **CSP lacks `form-action` and `connect-src`.** Otherwise strong: nonce-based, `object-src 'none'`, `frame-ancestors 'none'`, `no-store`, `Referrer-Policy: same-origin`. |
| — | **Migrations are not transactional**, but the bodies are idempotent (`CREATE IF NOT EXISTS`, `addColumn` self-heal) and `foreign_keys` is set at open, outside migration time. **Better than BeigeBoard's — copy this pattern there** (Stage D item 2). |
| — | **Guest is exempt from lockout** and cannot have 2FA. Follows from JK-A1: with no credential to fail, there's nothing for the per-account throttle to count. |

**Coverage:** every module read. `views.js` (292 lines) was read for the Google button and the CSP
nonce only — it is server-rendered HTML and warrants an XSS-focused pass of its own against
`escHtml` usage, which this audit did not do.

---

## Appendix B — the backend defect index

From the 2026-08-25 audit. **Severity is that audit's assessment; the Stage column is this
document's re-ranking** per §3 — declaration-completeness defects promoted, unused-machinery
defects demoted. *Partial* = mechanism confirmed in source, user-visible consequence not
demonstrated.

| ID | Sev | Stage D item | One line | Verdict |
|---|---|---|---|---|
| OPS-1 | blocking | **B1** | Smoke harness can't tell which service answered `/health`; six files share the hole | Confirmed |
| BB-11 | high | 1 | `started_at` documented write-once, freely overwritable, data unrepairable | Confirmed (live) |
| BB-12 | high | 1 | Deleting a routine orphans subtasks under its occurrences | Confirmed (live) |
| BB-14 | med | 1 | No index on `items.parent_id` — every tree walk and cascade step is a scan | Confirmed |
| BB-13 | med | 2 | Migrations aren't transactional — half-applied schema is a boot loop | Confirmed |
| BB-7 | med→**high** | 3 | 30 routes served, 11 surfaces declared | Confirmed |
| XC-7 | low→**high** | 3 | KourOS's discover engine — 1,697 lines, 7 routes — undeclared | Confirmed |
| BB-9 | low | 3 | `library` declares two filters it doesn't enforce | Confirmed |
| XC-1 | high | 4 | Nine collections carry the delta-cursor bug BB fixed in migration 8; two formats mis-sort | Confirmed |
| XC-4 | med | 5 | Four notions of "today", none shared — and no notion of "where" | Confirmed |
| BB-2 | high | 5 | ORDECK and BeigeBoard disagree about what day it is; both rewrite the horizon | Confirmed |
| BB-15 | high | 5 | Calendar events normalised in the server's TZ; no user timezone exists anywhere | Confirmed |
| BB-10 | low | 5 | First-run seed lands on the wrong day west of UTC | Confirmed |
| XC-2 | med→**high** | 6 | Four activity ledgers, no way to ask "what did I do today" — and it's the audit trail | Confirmed |
| BB-3 | high | 7 | Four call sites contradict `routines.js`'s own "the ref is the authority" rule | Partial |
| BB-5 | med→**high** | 7 | One `ext_ref` column, three incompatible schemes — an AI author can't tell them apart | Confirmed |
| BB-1 | high | 7 | Cadence engine fires only on an unfiltered human read; every declared filter disables it | Confirmed |
| BB-4 | high→**med** | 8 | BeigeBoard publishes no invalidations (needn't consume the fabric, must notify) | Confirmed |
| XC-3 | med | 8 | ORDECK dumps the entire items table every 60 seconds | Confirmed |
| BB-8 | med | 9 | 2,711 lines of routine logic maintained twice | Confirmed |
| BB-6 | med | 10 | Calendar sync is three hand-rolled copies with no Weave surface | Confirmed |
| WV-1 | high | 11 | Backend-to-backend calls can't work in production — env var set nowhere | Confirmed |
| WV-3 | med | **C7** | `aud` is computed, minted, and never verified | Confirmed |
| JK-3 | med | **C7** | One cookie for every subdomain, and `aud` — the containment — is off | Confirmed |
| JK-1 | high | **C2** | Session cap can delete the session it was just asked to create | Confirmed |
| JK-2 | high | **C2** | Claim-then-issue isn't atomic; a crash mid-refresh burns the family as theft | Confirmed |
| JK-4 | low | 5 | A 10-second grace window measured against a 1-second clock | Confirmed |
| JK-5 | low | **C4** | Two registry caches with no invalidation | Confirmed |
| WV-4 | med | **C4** | A capability cannot ask for less than full write access | Confirmed |
| BB-16 | low | 12 | Mint hardcodes `kind:'task'`, so a recurring *event* can't be authored | Confirmed |
| WV-2 | high→**reframed** | 13 | Trigger engine has no consumers — it's the widget factory's write half | Confirmed |
| WV-5 | med | 13 | Typed-stud composition breaks on any async capability; blocks the widget factory | Confirmed |
| WV-6 | med | — | Two hardcoded per-app branches in code documented as app-agnostic | Confirmed |
| WV-8 | low | — | jkDeploy isn't in the app directory | Confirmed |
| XC-5 | low | — | "There is no per-app preferences store" — except in three apps | Confirmed |
| XC-6 | low | — | The shared app shells reached the two newest apps and stopped | Confirmed |
| WV-7 | low→**delete** | — | `useCalendarSource` + 8 more `@jkos/cards` exports never used — remove them | Confirmed |
