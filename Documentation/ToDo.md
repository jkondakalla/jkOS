# jkOS — ToDo

> **⏸ §1–§7 PARKED as of 2026-08-18.** Those sections are on hold until further notice — don't
> pick up anything from them on your own initiative; confirm with Jag first. They're kept up to
> date for when he comes back to them, not as active work.
>
> **▶ §8 is the active section.** The music vector space, chunked 2026-08-18 — that's the work in
> front of us. **§8.0–§8.7 are ALL DONE as of 2026-08-19 — M4's gate PASSED**, read over the
> 1,506 tracks encoded before Jag stopped the backfill (this is not the final library). M5–M7
> are named at the tail below, unscheduled. Design record: [ALGORITHMS.md](ALGORITHMS.md). LazurOS bring-up
> ([LAZUROS_STARTUP.md](LAZUROS_STARTUP.md)) comes *after* §8's gate and is still not tracked
> here.

The working backlog, condensed to what's actually open. **Completed work is summarized, not
enumerated** — the task-level record lives in the relevant `Documentation/*.md`. Jag's own
operational checklists (things only he can confirm — a live login, a host config value, a
Workshop publish click) have been moved out of here into each app's own doc, since a git
checkout can't verify them; each is flagged **"not yet confirmed as of 2026-08-18"** at its new
home, and this pass is logged in memory as unverified rather than done.

**As of 2026-08-18:** the suite (five core systems + PapyrOS/KourOS + the `@jkos/player`
primitive + Full Press design reface) is committed to `staging` through `5ce3a70` and **has now
been deployed to staging** — so the whole Routine/Workshop/field-primitive batch, the request-storm
fix, the login-throttle fix, and **migration 13's variance instrumentation** are live. What that
does *not* mean is in-browser confirmed: nothing in §7's visual QA has had an eyeball on it.
Next up: **§8, the music vector space**, with [ALGORITHMS.md](ALGORITHMS.md) as its design record.
LazurOS bring-up ([LAZUROS_STARTUP.md](LAZUROS_STARTUP.md)) is still not tracked in this file.

Section numbering is stable and cross-referenced by other docs — **§1 = LazurOS, §2 = PapyrOS,
§3 = the media primitive program, §4 = parked decisions, §5 = smaller items, §7 = Full Press,
§8 = the music vector space.** (§6, the after-deploy checklist, moved into
[OPERATIONS.md](OPERATIONS.md) — the number is retired, not reused, so §7's citations elsewhere
stay valid.) Don't renumber even as items close. **New topics start at §9** and count up from
there — never reuse §6, and never renumber an existing section to make room.

---

## ⚠️ Hard constraints a cold agent MUST know

- **Do NOT edit `apps/sylibos/`** — even in suite-wide sweeps.
- **Suite scope** = BeigeBoard · jkAuth · jkDeploy · ORDECK · Weave · LazurOS · PapyrOS · KourOS.
- **The gate must stay green after every chunk:** `pnpm test:contracts`. Command/gotcha catalog:
  [PRIMITIVES.md](PRIMITIVES.md).
- `Documentation/` is the source of truth; when a doc disagrees with code, the code wins —
  update the doc.

---

## Done so far (summary — full detail in the linked docs)

- **The BeigeBoard Routine primitive + Workshop rebuild** (2026-08-12 → 2026-08-18, `c05ab1a`
  … `5ce3a70`, pushed to `staging`, **not deployed**): the full routine/occurrence/library
  primitive (rules render forward at mint, occurrences snapshot what actually happened), the
  field primitive (every native input, whole suite), the routine library shelf + bundle import +
  generated AI-authoring prompt, a request-storm fix (unmemoised `api` effect dep + undebounced
  set-log writes), the login-throttle "wait not wall" fix, and the scroll-hairline + one-bench
  Workshop rework. Entry point for anything routine-shaped: [ROUTINES.md](ROUTINES.md).
- **7-wave testing/upgrade program**, **LazurOS Phases 0–6+8**, **PapyrOS Waves 1–7.3**, the
  **`@jkos/player` primitive** (Waves 15–17+20), and **KourOS** (Wave 18) — built, gated,
  committed. [ARCHITECTURE.md](ARCHITECTURE.md) · [PLAYER_PARITY.md](PLAYER_PARITY.md).
- **The design factory + `/design` reference page.** [DESIGN.md](DESIGN.md).
- **Full Press** functionality batch + BeigeBoard's deep editorial pass + the BB rebuild —
  committed. Remaining per-app rollout: §7 below.
- **2026-07-30 tech-debt sweep** — dead code deleted, the three auth state machines folded onto
  `@jkos/auth-client`, a binary-via-NUL-byte source file fixed, `check:text` + `check:auth`
  gates added. Three things found and deliberately left: §5 below.

---

## 1. LazurOS go-live

Code-complete (Phases 0–6+8), committed — nothing here is mid-edit. Everything left is Jag's
own hardware/content bring-up, not code. Full phase-by-phase checklist:
[LAZUROS_STARTUP.md](LAZUROS_STARTUP.md). **Not yet confirmed done as of 2026-08-18** (needs
hands on Luna/Emily, unverifiable from a checkout): `prompts.json`/`models.json` content,
Emily's MAC/IP + WoL, Luna's Ollama on Vulkan (not ROCm — RX 560 is Polaris), Whisper/Piper
servers, the DDGS sidecar, jkAuth service-client + delegation-client enrollment.

- **1d — Phase 7, BeigeBoard AI rebuilt on LazurOS `[opus]`.** Not started, still needs a design
  pass: the old synchronous `/api/chat` surface is gone, so this is new work needing job-polling
  UX (pending/progress/failure), not a migration. Do this *after* the bring-up above proves the
  round-trip through the `/LazurOS` staging console.
- **1e — Phase 8, ORDECK widgets.** Code shipped (`apps/lazuros/widgets/`), awaiting Jag to
  click Publish twice in the Workshop as admin — steps in `apps/lazuros/widgets/README.md`.

---

## 2. PapyrOS remaining

Live on staging. Real feature backlog (waves run in order, gate green after each; new-app crib
in [PRIMITIVES.md](PRIMITIVES.md)). **These are PapyrOS *wave* numbers, `W`-prefixed** — §8 is
now a real section with its own 8.x chunks, and the bare numbers would collide:

- [ ] **W6.5e Multi-source metadata `[FEAT-P]`.** Approved: Open Library + Audible/Audnexus +
      iTunes, all keyless — provider registry, merged/deduped candidates with per-source badges,
      field precedence, cross-source agreement boosts confidence. Spec complete, **not built**.
- [ ] **W7.2 Offline write queue `[FEAT-P]` `[opus]`.** Queue progress/bookmark writes offline,
      reconcile via the collections' `?since=` cursor on reconnect, last-write-wins. Check
      whether `@jkos/player/services` (§3 Wave 16.5) already covers this before scoping new work.
- [ ] **W8.1 Book club `[FEAT-P]`.** Membership-gated views over new `clubs`/`club_members` +
      `progress`; ship the four default fields (name/description/current-pick/members).
- [ ] **W8.2 ORDECK "continue listening" widget `[FEAT-P]`.** A published WidgetSpec reading
      `weaveClient('papyros')`, same pattern as LazurOS's widgets (§1e) — no ORDECK code changes.
- [ ] **W8.3 Parked polish** (record only): SSE "now listening", LazurOS auto-match, speed
      presets, bookmark export.

**W6.2 Live verify** (real two-user login: Range/206, independent resume, bookmark, download, PWA
install) — **not yet confirmed as of 2026-08-18**; checklist now lives in
[ARCHITECTURE.md § PapyrOS](ARCHITECTURE.md#papyros-the-audiobook-app) since it's a hands-on
pass a checkout can't verify.

---

## 3. Media primitive program — `@jkos/player`

Waves 15–18+20 done and committed (design: [PLAYER_PARITY.md](PLAYER_PARITY.md)). One known
micro-race in the gapless swap handshake is noted-not-fixed (self-heals).

**Wave 19 (video) `[PARKED]`** — seams only (`htmlMedia`/`videoPlayer()`); the real cost is the
backend (HLS+ABR, seek-during-transcode, subtitle extraction, hardware accel) which is easily
bigger than Waves 15–18 combined. Don't start without a scoping pass.

**Open unblockers, Jag's call:** `MUSIC_DIR` real mount, both compose files — KourOS is
otherwise built and staging-ready ([ARCHITECTURE.md § KourOS](ARCHITECTURE.md#kouros-the-music-app)
already flags this), and it's **also M5's prerequisite** (§8's tail: the walking shuffle's
natural consumer is KourOS); DNS for `papyros.jkos.net`/`kouros.jkos.net` (staging works without);
Audnexus as a metadata provider (feeds §2 6.5e); book-club fields beyond the default four.

---

## 4. Decisions parked for Jag

Each stopped consciously, not forgotten — pick any up by choice, none is blocking.

- **BB items onto `defineCollection`.** Items carry lazy seed, recursive cascade delete, parent-
  cycle checks, and three calendar sources the collection factory can't host as hooks cleanly.
- **Generate hub.css's dark block from `buildTheme`.** `tokens-parity` already closes the drift
  risk structurally; generation would add visual-regression risk for low marginal benefit.
- **Prod edge gate for the portal.** ORDECK self-gates like every prod origin already; a
  staging-style `auth_request` at the prod edge would diverge from that pattern.
- **iCloud `ical.js` swap.** The hand-rolled parser ignores TZID/RRULE (documented + pinned by a
  test); a real `ical.js` provider drops in behind the same `CalendarProvider` contract.
- **Design-primitive proposals P1–P9** from the 2026-07-01 visual-unification audit.
- **VaultOS** — parked entirely; ZFS covers the need. [VAULTOS.md](VAULTOS.md).

---

## 5. Smaller open items

- **BeigeBoard mobile drill-down + bench.** `MobileTasksView` lacks drill-in/breadcrumb + a
  compact bench rail. Needs re-scoping first — it was written against the desktop drill-down/
  bench sidebar the Full Press rebuild retired, so it now asks for affordances the desktop no
  longer has. Design call, not a port. ([PLANNING_METHOD.md](PLANNING_METHOD.md) § Follow-up)
- **Toolchain alignment.** `apps/sylibos` is React 19 + Tailwind v4 vs. the suite's React 18 +
  plain CSS. Deferred until sylibos re-enters scope (off-limits until then).
- **Three duplications from the 2026-07-30 tech-debt sweep**, each parked for a stated reason,
  not oversight: ORDECK's ~37 dead HUD CSS classes (no gate catches a CSS-deletion regression,
  wants a browser open); `AuthGuard.tsx`/`.auth-veil` byte-identical between PapyrOS/KourOS
  (sharing needs a new `@jkos/ui`→`@jkos/auth-client` dependency edge); `library.js`'s
  `rescanLibrary` route 96% duplicated between the same two (would need `express` on
  `@jkos/weave`, which deliberately has none, to save ~20 lines).
- **ORDECK `bb-week` HUD widget live verification** — code-complete + gated; needs a running
  stack to confirm real BB items render and grid-drag doesn't clash. **Not yet confirmed as of
  2026-08-18**; moved to
  [ARCHITECTURE.md § ORDECK](ARCHITECTURE.md#ordeck-the-portal-and-hud-engine).

---

## 7. Full Press — the design-system reface

Functionality batch (press.css in hub.css, `@jkos/ui` re-cut, motion vocabulary) + BeigeBoard's
full editorial pass (the test bed, done first) + the BB rebuild (Waves A–D) + the parity
fidelity pass through P0.1–P0.3 are all committed. Fence: [DESIGN.md](DESIGN.md) §13; ship
discipline §14; parity detail: [BEIGEBOARD_PARITY.md](BEIGEBOARD_PARITY.md).

Open:

- **P0.4** — the kit still spells nav buttons `.jk-cards-btn`, not `.jk-tbtn`.
- **P1–P3** — the per-view visual literals; needs the prototype side-by-side in a browser, not
  yet audited.
- **Per-app deep-pass roster** — Jag's ordering: jkAuth → PapyrOS → KourOS → ORDECK. All four
  currently have only the surgical Wave-25 pass, none of BB's deeper editorial treatment
  (masthead/folio, rules ladder, printed nav voice). Order and whether-at-all is Jag's call;
  nothing scheduled.
- **26.1 Both-face visual QA, 26.2 A11y spot-check, 26.3 Font perf** — all need a browser/
  eyeball pass; ride Jag's next staging session. 26.1 additionally needs the jkAuth image
  rebuilt once these staging commits actually go live.

---

## 8. The music vector space — M1→M4 ▶ ACTIVE

**15,326 FLACs across 89 artist folders at `/mnt/Luna/Plex/Music` → mel spectrograms →
pretrained embeddings → similarity search.** Design record, and the *why* behind every decision
below: [ALGORITHMS.md §4](ALGORITHMS.md). This section carries the chunks; that file carries the
reasoning, and a second copy of the reasoning is a second thing to keep true.

**Chunks stop dead at §8.7, the M4 similarity gate.** M5–M7 are named at the tail, not planned —
M4 is a stop-the-world gate and chunking past it is planning on faith. **§8.7 passed 2026-08-19,
so that gate is now open** — M5–M7 may be chunked when Jag wants them, and the first question
either way is which library the space is finally built over.

### The dependency budget — a hard constraint, not a preference

This is a **portfolio project**, so the dependency list is part of the deliverable.
`music/requirements.txt` is exactly two lines and **never gains a third**:

```
numpy>=1.26,<2.0
onnxruntime>=1.17,<2.0
```

Plus the `ffmpeg` binary, already on the box. That budget covers *everything* — decode, STFT,
mel filterbank, MFCC, descriptors, the SQLite index, cosine search, PCA. Only the encoder
forward pass needs the second line.

Four things are therefore **deliberately not taken**, each with its reason, so none gets
re-proposed:

| Not taken | Why, and what replaces it |
|---|---|
| `librosa` / `soundfile` / `torchaudio` | ffmpeg decodes FLAC→f32 in 0.13 s per track. `subprocess` → `np.frombuffer`. |
| **`torch`** | ⚠️ **No fallback, by decision.** If a model won't export cleanly to ONNX, **change models** — do not reach for PyTorch as a runtime. Export tooling may live in a throwaway venv (§8.5); it is a build tool and never a dependency. |
| `sqlite-vec` | stdlib `sqlite3` with a `local_vectors` table *shaped* for it. [ALGORITHMS.md §4](ALGORITHMS.md) already records it's the port target, not a speed need. |
| `pytest` · `matplotlib` · `sklearn` · `umap-learn` | `python -m unittest discover` · SVG emitted as text · `np.linalg.svd` for PCA. |

### Measured on the machine, 2026-08-18 — these shape the chunks

- **`/mnt/Luna` is a CIFS mount** (`//192.168.1.108/Luna`), **85–96 MB/s**. ~380 GB of FLAC is
  **~75 min of pure single-stream read** — the network filesystem is the bottleneck, not the FFT
  and not the model. §8.6 is built around this.
- **Emily** (this workstation): Ryzen 7 5800XT 8c/**16t**, 31 GB RAM, RTX 3080. The backfill is a
  CPU job that finishes overnight; designing for CPU keeps it reproducible on any machine, which
  is the property that matters here.
- Python 3.12.3 with **numpy 1.26.4 and nothing else installed**. Clean slate.
- ⚠️ **Paths are hostile** — `again&again`, `Today's Lesson.flac`, `[16B-44.1kHz]`.
  **Never `shell=True`.** argv lists everywhere. This bit during probing.

---

- [x] **8.0 Deploy the clock — DEPLOYED 2026-08-18, schema verified against the live DB.**
      *Not music — it was here because it lost value every day.* Migration 13 is applied on
      staging and **the clock is running**. Verified by reading a copy of the live database
      (`.db` **plus its `-wal`/`-shm`**, since a 4 MB WAL held writes the `.db` alone would not
      show): ledger tail reads `13|variance_instrumentation`, `items` carries `started_at` and
      `completed_at`, and both triggers — `items_stamp_completed`, `items_clear_completed` —
      exist. Step V (the completion-volume read, [ALGORITHMS.md §5](ALGORITHMS.md)) stays
      deliberately **not** chunked; it is unreadable until this has been running a while.
  - ✅ **CONFIRMED LIVE 2026-08-18 22:26Z.** A real completion stamped
    `completed_at = 2026-08-18T22:26:13.955Z` (millisecond ISO, as migration 8's format
    requires). One of the two stamped rows is a genuine routine occurrence
    (`ext_ref = routine:24:2026-08-18`) — the record type §8 actually reads. Two invariants
    checked on the live DB, not just asserted in the smoke: **0 rows with `completed=1` and a
    NULL stamp** (no write path bypasses the trigger — the whole reason it is a trigger and not
    a handler stamp), and **0 rows stamped but not completed** (the clear-edge holds).
  - ⚠️ **But `started_at` is NULL and no `performed` document carries `at`/`seq`.** Not a
    defect: those three fields are written only by `SessionCard` interactions, and a completion
    made by ticking the checkbox never touches one. **Consequence for §8: skip-clustering-by-date
    is accumulating now, but ordering violations and start-time drift accumulate only when a
    session is actually worked through the card step by step.** Two of the five statistics
    depend on usage pattern, not just on the columns existing. Worth knowing before §8's
    minimum-observations gate is tuned — it may be reading a much thinner series than
    `completed_at` suggests.
- [x] **8.1 `music/` skeleton — config, decode, index `[FEAT-M]` — BUILT 2026-08-18,
      59 tests green, `pnpm test:contracts` still exit 0.** New top-level `music/`, outside the
      pnpm workspace (confirmed: `pnpm-workspace.yaml` globs only `apps/*`, `apps/*/backend`,
      `packages/*`), own `README.md`, own two-line `requirements.txt`. Runnable:
      `cd music && python -m unittest discover`. What was built, and the three judgement calls
      that were not in the spec:
  - `config.py` — **the single source** for `SR` / `N_FFT` / `HOP` / `N_MELS` / `FMIN` / `FMAX` /
    window. ⚠️ Trap 16: extraction and embedding disagreeing here corrupts the space *silently
    and totally*. Nothing anywhere re-derives these.
  - `audio.py` — `decode(path) -> np.float32 mono @ SR`, ffmpeg subprocess
    (`-v error -i PATH -f f32le -ac 1 -ar 22050 -`) → `np.frombuffer`. argv list, never a shell
    string.
  - `scan.py` — walk the library, store the **absolute path** (matches KourOS `tracks.path`,
    which is `UNIQUE`, so M5's join costs nothing later) + `mtime` + size.
  - `index.py` — stdlib `sqlite3`, `music/index.db`. `tracks` (scan **and** resume ledger —
    `pending()` is a LEFT JOIN, so progress is the absence of a join partner rather than a
    counter anyone has to remember to write), **`local_vectors`** (neural — name matched to
    `deployment.jag.json`'s embedding slot so LazurOS L3.6 is a lift, not a rewrite),
    `descriptors` (the baseline arm, kept separate so the port target stays pristine), plus
    `meta` (addition 2 below). float32 BLOBs, with `to_blob()` **refusing float64** — numpy's
    default dtype would silently write double-width vectors that read back as garbage.
  - `.gitignore`: `music/.cache/`, `music/models/*.onnx`, `music/out/` (`*.db` is already global).
  - **Gate: PASSED.** Decoded sample count vs. `ffprobe`'s container duration agreed to
    **0.0 ms** on a real 234.9 s library FLAC, against a one-frame (23.2 ms) tolerance.

  **Three deliberate additions beyond the spec above** — each closes a named trap
  mechanically rather than by remembering it, and each is flagged here rather than slipped in:

  1. **`config.signature()` + `config_sig` stamped on every vector row, and `ConfigDriftError`
     on the write path.** This is Trap 16's mechanical defence. Editing `config.py` at §8.5 and
     re-running the backfill would otherwise mix vectors computed under two different analysis
     configurations into one table — no exception, no NaN, just wrong neighbours at M4. Now the
     second write raises. An *empty* vector store adopts the new config freely, so §8.5's
     legitimate path (change config to match the encoder, clear, re-run) stays open.
  2. **A fourth table, `meta`** (§8.1 says three). §8.4 requires the corpus mean/std to live in
     the index — "z-score across the corpus, not per track" needs one home a new track can
     normalise against months later — and the config signature needs one too. Both are scalars,
     not entities. §8.4 would have had to add this anyway.
  3. **`config.py` carries the convention forks explicitly** — `MEL_SCALE` (htk vs slaney:
     the hz↔mel formula itself differs), `MEL_NORM`, `POWER`, `CENTER`, `PAD_MODE`, `LOG_MODE`,
     `LOG_FLOOR`. Each is a place where two reasonable implementations differ, produce different
     matrices, and neither errors. Defaults are torchaudio's (htk / no norm) because §8.5's
     likely candidates are torchaudio-preprocessed exports. All are covered by the signature —
     a test mutates every one in turn and asserts the signature moves, so a parameter added to
     `config.py` but left out of the significant set fails the suite.

  **Measured during the build, and it changes §8.6's shape:** a 51.8 MB / 234.9 s FLAC decoded
  in **0.59 s wall = 88 MB/s**, i.e. exactly the CIFS ceiling. Trap 19 confirmed empirically —
  the decode is network-bound, not CPU-bound, so parallel *readers* are the lever and the model
  stays serial.

- [x] **8.2 M1 — mel extraction, hand-rolled `[opus]` — BUILT 2026-08-18, 88 tests green.**
      `mel.py`: frame → Hann → `np.fft.rfft` → power → mel filterbank → log. 128 × T float32,
      **numpy only**. Both mel conventions (`htk` + `slaney`) implemented, since §8.5 may have to
      match an encoder; the filterbank is built once but **cached on `config.signature()`**, so a
      config edit rebuilds rather than silently serving a bank built for the old parameters.
  - **Numbers inspected on two real tracks** (the §8.2 requirement, not a formality). They read
    as music: **spectral tilt in the right direction** (low 6.11 > mid 5.04 > high 3.32),
    **loudest band 3–5 ≈ 64–98 Hz** (the kick/bass region), quietest band 127 ≈ 10.8 kHz (air),
    **zero non-finite cells**, nothing pinned at the floor, temporal std 2–3 in every register
    (not a static drone), and low-band autocorrelation finding a real beat — **129 BPM (r=0.60)**
    on an indie track, 185 BPM (r=0.49) on a punk one. ⚠️ That 185 is probably a **metrical
    harmonic** of ~92; autocorrelation routinely locks onto a subdivision. Not M1's problem —
    flagged for §8.4, which does tempo for real.
  - **Cost: 0.92 s of mel for 235 s of audio** (decode 0.50 s). Extraction is ~4% of a
    decode-bound budget — the wire stays the constraint (Trap 19).
  - Tests (stdlib `unittest`, 29 new): frame-count formula agreeing with `config.n_frames` at
    every length · filterbank rows **non-negative, single-peaked, peak at the middle edge, no
    empty bands** · **50% overlap proved structurally** (adjacent bands share support, bands two
    apart share none) · **adjacent ramps sum to exactly 1** (a partition of unity — energy is
    redistributed, never created) · a 440 Hz sine peaks in a band whose support actually contains
    440 Hz **and ≥90% of its energy sits within ±2 bands** · silence → the log floor · the time
    axis is not reversed · **blocked and unblocked computation are bitwise identical** · bitwise
    determinism across runs.
  - ⚠️ **Two things found while building, both corrected in the code and worth not re-learning:**
    **(a)** `np.fft.rfft` **does not preserve single precision** — it upcasts float32 to
    complex128, so a 20-minute track computed in one shot exceeds a gigabyte of transient. With
    §8.6 running parallel decode workers that is an OOM waiting to happen, so the transform is
    computed in **blocks of frames**: peak memory tracks `BLOCK_FRAMES`, not duration.
    **(b)** **Mel is NOT a log-frequency (constant-Q) axis** — it is roughly linear below ~1 kHz
    and logarithmic above, so an octave *up high* spans MORE mel than one down low (701 vs 242).
    The real property is per-hertz: 100 Hz buys ~95 mel at 440 Hz but ~13 mel at 8 kHz. A test
    pins both facts, because assuming constant-Q would misread every band index downstream.

- [x] **8.3 M2 — ridgeline render `[FEAT-M]` — BUILT 2026-08-18, 131 tests green, GATE PASSED
      in a browser in both faces.** `ridge.py`: 128 stacked polylines per track, one per mel band,
      emitted as **SVG text** — no matplotlib, no plotting library, nothing beyond the numpy
      already required. Palette parameters come from the suite's own design factory (`hub.css`),
      copied as literal hex since `music/` has zero jkOS imports; the frequency axis is an
      *ordered* dimension so its colour job is **sequential — one hue, light→dark, never a
      rainbow**, and both faces' ramps were run through the `dataviz` validator (`--ordinal`)
      against their own surfaces before anything was drawn.
  - **THE GATE PASSED.** Four deliberately unalike tracks (SiM metalcore · Kendrick Lamar
    hip-hop · Matt Maltese solo piano · Bo Burnham spoken-word stand-up), rendered side by side
    against one shared scale, read as four plainly different pictures — **and the four §8.3
    criteria were each checked, not just the headline one**: the metalcore panel is dense in
    every register end to end; the hip-hop panel shows an unmistakable **kick grid** in the bass
    rows with real silence between hits; the piano ballad is near-flat below 200 Hz with slow
    swells at 200–800 Hz; the stand-up cut has **no bass content at all** and sits in a
    horizontal speech-formant band with syllable-rate modulation. Beat grid visible, harmonic
    structure visible, quiet material actually quiet. Confirmed in a browser on **both faces** —
    the dark ramp is its own selected set of steps, not a flip.
  - ⚠️ **The one decision that makes or breaks the check: ONE shared absolute level scale across
    every panel.** Per-track normalisation rescales each picture to fill its own frame, so a
    quiet ballad and a brickwalled metalcore track come out looking equally loud — destroying the
    only comparison the picture exists to make. Same mistake §8.4 warns about for the descriptor
    z-score, one step earlier and in pixels. **Enforced by API shape:** a range belongs to a
    *sheet*, `Panel` carries none, and there is no per-panel variant of the auto-range function.
    Default `(-8, +10)` ln, chosen from measured percentiles across all four tracks (p5 ran −0.9
    to −7.5, p99 ran 6.9 to 10.8), and it is **config-aware** — a switch to `LOG_MODE='db'` at
    §8.5 scales it by 10/ln 10, or the whole picture would flat-top with no error.
  - ⚠️ **THE TRAP THAT NEARLY READ AS "8.2 IS BROKEN": 128 rows is far more than a ridgeline
    normally carries** (the form is usually 10–40). At 620 px of plot height the row pitch is
    4.8 px, every row's excursion crosses two neighbours, and the panel collapses into a uniform
    **hatch** — a picture that looks like the transform is wrong when the transform is fine and
    the picture is merely too small. Measured floor: **≥ 9 px of pitch** (hence a tall default
    plot with panels **side by side**, not in a grid), and **overshoot 2.4 row-pitches** for a
    full-scale band — at 1.4 a hip-hop track reads as ruled paper, past ~3 loud material smears
    over three rows. A test asserts the shipped defaults clear the shipped floor; the first
    version of them did not, by 0.1 px, and the test caught it.
  - ⚠️ **The time axis reduces by `max`, not `mean`.** A four-minute track is ~10,000 frames
    against ~450 px; a kick drum is one loud frame in a bucket of quiet ones and averaging
    deletes exactly what the picture exists to show. **And a full-length render aliases the beat
    away regardless** (~1.5 px between hits) — so the check needs *two* renders: full length for
    the arrangement, a ~16 s window for the grid. Both are one flag apart.
  - ⚠️ **Trap 20 has a rendering cousin.** `again&again` written raw into an SVG `<text>` is not
    an escaping nicety — it is malformed XML and the file will not open at all. A test renders a
    panel titled with the hostile fixture name and parses the result back.
  - Tests (43 new): the **`dataviz` ordinal gates re-run every suite run** — one hue, monotone
    lightness across all 128 steps, the ramp end nearest each surface still clearing 2:1, and the
    two faces declaring exactly the same token set (a token defined on one face and forgotten on
    the other is a line that renders as `initial`) · max-vs-mean transient survival · no
    upsampling of short input · every frame in exactly one bucket · geometry independent of what
    else is in the sheet · clamping without escaping the box · back-to-front draw order ·
    determinism.

- [x] **8.4 The classical descriptor baseline `[FEAT-M]` — BUILT 2026-08-18, GATE PASSED over
      887 real tracks, 243 tests green.** `descriptors.py`: **119 dims** — MFCC mean+std (DCT-II
      of log-mel, 20 kept) *plus their first differences* (80 together), chroma mean+std (24),
      spectral centroid / bandwidth / rolloff / flatness / ZCR / log-RMS mean+std (12), tempo (3).
      numpy only, over the same STFT — a new `mel.iter_blocks` yields frames, linear power and the
      mel projection from **one** traversal, so the time-domain, linear-spectrum and mel features
      cannot disagree about where a frame starts and the FFT is paid for once.
  - **THE GATE PASSED, and all three categories are measured** (887 tracks · 82 albums · 39
    artists, built at **86.2 MB/s — the CIFS ceiling again**, 0 failures). Mean cosine:
    **same album +0.4288 · same artist, other album +0.1802 · different artist +0.0005.** A clean
    monotone ladder ending at essentially zero for unrelated music. Nearest neighbour shares an
    album **49.2%** against **1.3% by chance** (38×), shares an artist 59.6% against 3.2% (19×).
  - ⚠️ **The middle row had to be bought.** The album selector spread one album per artist, so
    "same artist, other album" had **zero pairs** — and its mean was NaN, and `nan > x` is False,
    so **the gate first reported FAILED on a set whose descriptors were separating album-mates
    from strangers by +0.47.** Two fixes, both pinned by tests: an unmeasured category no longer
    fails the verdict, and `--per-artist N` makes the row real. It is the row that matters most —
    album-mates share a mastering, so clustering them is nearly free, while clustering an artist
    *across* albums means the descriptors found the band rather than the session.
  - ⚠️ **Chroma has an arithmetic floor, and it is derived rather than guessed.** FFT bins are
    evenly spaced in Hz, semitones in *ratio*, so chroma can only resolve a note above the
    frequency where a semitone is wider than a bin — **181 Hz** at this profile, i.e. *the bass
    line is invisible and that is arithmetic, not an oversight*. A test pins the derivation so
    changing `N_FFT` cannot quietly turn it into a lie. **This number decided §8.5's shape.**
  - ⚠️ **Z-score across the corpus, not per track — enforced by API shape, not discipline.** There
    is no function that normalises one vector; `CorpusStats.fit` refuses fewer than 8 rows with a
    message naming the trap, and a test asserts no per-track normaliser exists in the module.
    **Vectors are stored RAW** and the fit is applied on the way out, so re-fitting after the
    library grows is free and total rather than freezing one corpus's statistics into every row.
    A constant dimension gets std 1 rather than inf, and is *recorded* as degenerate — several at
    once means a feature is broken, not merely uninformative.
  - **Numbers pinned in closed form, not by eyeballing:** a sine's centroid IS its frequency
    (443.2 for 440), its ZCR IS 2f/SR (0.0399 for 440, exact), white noise's centroid IS SR/4
    (5511 vs 5512.5), its bandwidth IS Nyquist/√12 (3182 vs 3182.6), its rolloff IS 0.85·Nyquist.
    A 440 Hz sine lands in pitch class **9 = A**, and 880 and 1760 land there too.
  - ⚠️ **The DCT's loudness invariance has a limit, and a test now marks it.** Scaling a signal
    adds a constant to every log-mel band, which coefficient 0 absorbs exactly — verified to
    7 decimals (47.052387 against √N·ln 64 = 47.052391). **But only while every band stays above
    `LOG_FLOOR`:** a pure sine has near-zero energy in most of its 128 bands, so quietening it
    clamps 55% of them and coefficients 1–19 start moving too. Broadband material — all real
    music — never gets near it. Worth knowing before anyone concludes MFCCs are unconditionally
    loudness-invariant and stops z-scoring.
  - Tempo carries **log2(BPM)** (an octave error is then a constant ±1) with a log-normal prior
    at 120 BPM to break the metrical-harmonic tie §8.2 hit — *and* `onset_rate` beside it, which
    counts events and is therefore immune to the octave question. A whole tempo dimension being
    wrong then costs one dimension of 119 rather than the track's rhythmic character.

- [x] **8.5 M3a — the encoder, chosen and vendored `[opus]` — DONE 2026-08-18, verification
      8/8.** **`Xenova/larger_clap_music_and_speech`**, revision pinned to commit `e9fd5ac1`,
      **512-d**, sha256 verified. `encoder.py` + `models/README.md`.
  - **NO EXPORT WAS RUN — that is why this checkpoint won.** It ships `onnx/audio_model.onnx`
    already exported, which removes the throwaway PyTorch venv, the opset arguments, the
    dynamic-axis surprises, and the whole class of "the export ran but the graph is subtly not
    the model". PANNs/CNN14 and MERT would each have required that path. **`torch` is not
    installed, not imported, not required; `requirements.txt` is still two lines.** 512-d also
    means §8.7's matrix is 15,326 × 512 float32 = **31 MB** — Trap 18 settled, one matmul.
  - ⚠️ **TRAP 16 BIT, AND THE FLAT SWAP WAS THE WRONG ANSWER.** CLAP wants 48 kHz / 1024 / hop
    480 / **64 slaney mels** / 50–14000 Hz / dB. Adopting those globally moves §8.4's chroma
    floor from **181 Hz to 788 Hz — above most of the melodic range** — killing 24 of the
    baseline's 119 dims. **M4 judges the encoder against that baseline and stops the world if the
    descriptors win; handicapping the opponent to suit the contender makes the gate easier to
    pass, which is exactly backwards.** So `config.py` gained **complete, named profiles**, one
    per vector space, and `index.assert_config` now enforces drift **per table**. Still one
    module, still one answer per space — what's gone is only the assumption of one encoder.
  - ⚠️ **Three holes found while building that guard, each now closed and tested:** `using()`
    swaps *module globals*, so it is **process-wide, not thread-local** — §8.6's workers could
    otherwise compute under A and store under B, so entering a *different* profile while one is
    active raises · **`baseline()` was derived from the live globals**, so inside the encoder
    context it returned "baseline" carrying the *encoder's* values and signature, and the nesting
    guard waved the switch through as harmless re-entry (now frozen at import) · `embed_windows`
    **refuses to run outside the encoder profile at all**, because "remember to enter the
    context" is a hope, not a defence.
  - ⚠️ **The slaney fork is the easy way to get this wrong.** CLAP builds *two* filterbanks and
    picks by truncation mode — htk/no-norm for `"fusion"`, slaney/slaney for `"rand_trunc"`. This
    checkpoint declares `rand_trunc`, so it is the **slaney** pair: not torchaudio's default, not
    what a library default gives. Every profile value is transcribed from the checkpoint's own
    `preprocessor_config.json` and re-asserted against **literals** in the tests.
  - **VERIFIED 8/8, and stability was the weakest of the checks.** §8.5 asks for a stable output
    and a non-degenerate vector; both hold — and both are nowhere near sufficient, since a
    mis-fed model returns stable, finite, unit-norm garbage all day. With no reference
    implementation available (that would mean `torch`), three more checks each aim at how the
    mismatch would actually show: **spread** (a mis-scaled input collapses every track onto one
    point — max off-diagonal cosine **+0.435**, genuinely spread), **structure** (two halves of
    one track must beat any two different tracks — weakest self **+0.940** vs strongest cross
    **+0.435**), and **sensitivity** (the same audio through the *wrong* mel convention gives
    cosine **+0.491** — so matching it was measured, not lucky).
  - ⚠️ **THROUGHPUT MEASUREMENT THAT CHANGES §8.6.** One 10 s window costs **0.084 s** with the
    session on 8 threads, and threads past 8 buy nothing — **the model saturates the CPU, so this
    is the one stage where Trap 19 does not apply and parallel workers cannot rescue it.** A
    4-minute track at 50% overlap is 48 windows ≈ 4.0 s → **~17 hours** over 15,326 tracks, not
    §8.6's 1.5–3 h. The lever is `encoder.MAX_WINDOWS`, evenly spaced so the span still covers
    the whole track: **12 windows ≈ 4.3 h, 8 ≈ 2.9 h.** Left at `None` deliberately — §8.6 should
    pull it with the numbers in hand, not inherit a default nobody chose.
  - **Not taken, named so it is not re-derived:** the **text tower** (`onnx/text_model.onnx`,
    same repo, same revision) is what makes *"find tracks matching rainy 3am guitar"* possible.
    It needs a byte-level BPE tokenizer built against the `vocab.json`/`merges.txt` beside it —
    ~70 lines, no new dependency — and it belongs to §8.7's query surface, not here.

- [x] **8.6 M3b — the backfill run `[FEAT-M]` — BUILT 2026-08-18, `music/backfill.py`, 278 tests
      green. RUN STOPPED DELIBERATELY AT 1,506 / 15,326 TRACKS, 2026-08-19** — Jag's call: this
      is not the library the space will finally be built over, so there was no reason to spend
      3.6 h encoding it. 0 failures over those 1,506. §8.7 was then read over what exists, which
      is what changed its shape (see below). Re-running is one command and resumes by
      construction — progress is the absence of a join partner, not a counter.
  - **The window cap was the decision, and cosine was the wrong way to make it.** §8.5 left
    `MAX_WINDOWS` at `None` for this chunk to pull with numbers in hand. Cosine against the
    all-windows pool answers *how far the vector moved*; M4 reads a **ranking**. Measured over
    71 tracks from 8 complete albums — the closest pairs in the library, so the ranking most
    easily disturbed:

    | cap | NN agrees | top-5 overlap | **NN shares an album** | cos to full | wall clock |
    |---|---|---|---|---|---|
    | 8 | 0.746 | 0.839 | **0.901** | 0.991 | ~2.2 h |
    | **12** | **0.873** | **0.899** | **0.887** | **0.997** | **~3.5 h** |
    | 16 | 0.873 | 0.952 | **0.887** | 0.999 | ~4.7 h |
    | all (median 41) | 1.000 | 1.000 | **0.887** | 1.000 | ~15 h |

    **The quality column is flat.** The disagreements are tie-breaks: album-mates sit at mean
    cosine **+0.868** against +0.443 for everything else, so *which* album-mate ranks first
    flips between two defensible estimates of the same track. **12 chosen** — the smallest cap
    where agreement plateaus, at 4× the speed. The uncapped pool is not ground truth; it is
    just the uncapped recipe.
  - ⚠️ **THE MEL BELONGS TO THE READERS, AND THAT IS A 33% WIN.** It costs 30 ms/window against
    the model's 58 ms, so computing it on the main thread adds a third to the wall clock while
    three reader threads sit blocked on the wire. `encoder.py` is now split into
    `window_features` (parallel) and `embed_features` (serial) — which also means **the only
    part of the backfill needing the weights is one function**, so stubbing that single seam
    puts every line of the run under test with no model at all (21 new tests, no onnxruntime).
  - ⚠️ **WHAT CROSSES THE QUEUE IS A FEATURE TENSOR, NOT A SIGNAL.** The library's longest file
    is a **two-hour, 545 MB FLAC that decodes to 1.4 GB** of float32; a bounded queue of decoded
    *signals* with several in flight is the OOM. A tensor is **3.1 MB**, bounded by the cap.
  - **Every other number measured, not assumed:** decode parallelism plateaus at 3 readers
    (81 → 107 → **110** → 109 → 112 MB/s at 1/2/3/4/8) · the ONNX thread sweep is
    0.291/0.162/0.094/**0.058**/0.087 s per window at 1/2/4/8/16, so 8 = the physical core count
    and the hyperthread pairs past it contend · batch 4 not 8 (0.058 vs 0.066 s/window,
    **1.12 track/s against 1.05** end to end).
  - **A second alarm, one level up from Trap 16.** `config.signature()` fingerprints how a mel
    is *built* and says nothing about **which mels a vector is the mean of**. `index.assert_recipe`
    stamps `encoder.recipe()` per table and refuses to *add* under a different one. In `meta`,
    not as a column: `local_vectors` is the shape LazurOS declares, and the port target stays
    pristine.
  - ⚠️ **AN EARLY READ AT ~1,000 TRACKS FOUND SOMETHING §8.7 MUST HANDLE: 20% of tracks are in an
    exact-duplicate group** (a single and its album — AFI alone has four copies of one track),
    and **22.9% have an exact duplicate as their nearest neighbour**. The naive "NN shares an
    album" proxy counts every one of those as a MISS while it is the most correct answer
    possible: 0.349 raw, **0.579** counting a duplicate as a hit, 0.453 over the tracks whose NN
    is not a duplicate. **§8.7 must not compare the two arms on that raw number, and must not
    compare them on different track sets** — §8.4's 49.2% was measured over 887 tracks selected
    as complete spread albums, not over the first N by path. (It also proves the pipeline is
    exactly deterministic: two *differently encoded* FLACs of one song, 30.6 MB and 31.0 MB,
    produced bit-identical vectors.)
  - **`music/control.py` — a Resume/Stop button and a progress bar, and it is scaffolding.**
    stdlib `http.server`, one file, bound to **127.0.0.1 only** (it starts processes and has
    no auth). It starts the run detached, so closing the panel does not kill it, and Stop
    sends SIGINT so the run drains and summarises. **Not in KourOS**, which was the ask: that
    container mounts `/data` and nothing else — no `MUSIC_DIR`, no python, no ffmpeg, no
    281 MB graph — and the run lives on the desktop, so a button there would be decoration.
    The JSON (`/api/status`, `/api/start`, `/api/stop`) is what a KourOS panel would call if
    the pipeline ever moves onto the host. Nothing imports it; deleting it costs one `rm`.
  - Also: `--scan`/`--limit`/`--artist`/`--retry-failed`/`--failures`/`--status`; the scan itself
    moved into `index.ingest_scan` so §8.4 and §8.6 cannot fill `tracks` two subtly different
    ways; `tracks.status` is shared by both arms, so a failure here also drops the row from the
    descriptor queue (right for an unreadable file, which is the failure that happens).

- [x] **8.7 M4 — THE GATE `[opus]` — BUILT + PASSED 2026-08-19, `music/query.py`, 321 tests
      green.** `Arm` (load → L2 → `M @ q` → `argpartition`), `align`, the duplicate-aware
      proxies, the side-by-side sheet. No ANN index, Trap 18 intact.
  - **Both arms were brought onto ONE population before anything was measured.** The neural
    backfill ran in path order and stopped inside artist six; §8.4's descriptors were 887 tracks
    chosen as complete albums across 39 artists. **The two tables overlapped by 95 rows** — a
    comparison over those would have been a comparison of two libraries. `index.pending(...,
    having='local_vectors')` + `descriptors.py --build --encoded` filled the gap: 1,411 tracks,
    ~9 min at 2.6 track/s, 0 failures. Both arms now hold all 1,506.
  - **THE GATE PASSED, and the ranking margin is not close:**

    | over 1,506 tracks · 338 albums · 6 artists | NN album | credited | clean | NN artist | gap/σ |
    |---|---|---|---|---|---|
    | **neural (CLAP 512-d)** | **40.0%** | **72.2%** | **58.4%** | **94.2%** | **1.23** |
    | descriptor (119-d) | 29.0% | 62.2% | 42.6% | 85.3% | 1.21 |
    | *chance* | *0.9%* | — | — | *22.1%* | — |

    The hand check (`--hand`, and it is the gate) agrees: an AFI live track returns six
    neighbours off the same live album where the baseline breaks the run at rank 2 with a
    Bowling For Soup song; an Atwood live-session take returns the rest of that session while
    the baseline returns the studio cut of the same song — both defensible, and the neural list
    is the coherent one.
  - ⚠️ **THE FIRST RUN REPORTED THE BASELINE WINNING, AND THE CRITERION WAS THE BUG.** On
    "album-mates minus strangers" descriptors score +0.4125 against neural's +0.3161. Both
    numbers are right and the comparison is meaningless: the descriptor space is z-scored and
    **centred** (strangers at −0.026), CLAP's is a narrow **anisotropic cone** (strangers at
    +0.475, nothing in the library below +0.03). A raw difference of means measures how *wide*
    each space is, so the wider space wins by construction. **`gap/σ` divides out offset and
    scale**, and it agrees with all three ranking measures. Both are printed; only the
    standardised one is compared.
  - ⚠️ **1,131 FILES (7.4%) SIT ONE LEVEL DEEPER — `<artist>/<album>/Disc N/<file>` — AND IT WAS
    SILENTLY COSTING BOTH ARMS.** Read naively, `Disc 1` is the album and **the album title is
    the artist**, so a deluxe edition is a different band from the record it doubles. No error,
    no NaN: just a same-artist rate a few points low for *both* arms, which is what a comparison
    hides by depressing it evenly. Found by a check written to audit something else — 184
    NN pairs at cosine **1.00000** the path called different songs. Fixed at the single source
    (`descriptors.album_of`, which `query` imports rather than re-deriving). **Duplicate-audit
    agreement 47.0% → 98.8%; NN artist 78.0% → 94.2%; "12 artists" → the 6 that exist.**
  - ⚠️ **The duplicate correction is read off the PATH, never off a cosine.** "Count cosine ≥
    0.999 as a hit" hands the coarser space free hits from the very measurement meant to judge
    it. `song_key()` uses the same evidence for both arms, and `duplicate_audit()` checks that
    heuristic *against* the cosines rather than trusting it — which is what caught the disc bug.
  - **§8.4's gate re-run under the corrected shelf reader and still PASSES** (2,298 descriptors:
    album +0.3740, artist +0.1567, stranger −0.0053; NN album 32.9% vs 0.6% chance, NN artist
    69.9% vs 10.0%). ⚠️ **Not comparable to the published 49.2%** — that was 887 tracks over 39
    artists, this is 2,298 over 38 with a far denser duplicate population competing for the NN
    slot. Different population, not a regression.

**After the gate — M5 and M6 are BUILT, in KourOS.** `b3eac39` shipped the consuming half as
`apps/kouros/backend/src/discover/` — `similar` / radio / **runs (M5)** / **vibe map (M6, PCA-2 by
power iteration + k-means)** — reading `music/index.db` read-only and reporting the BASIS of every
answer (`embedding` | `metadata` | `none`) so a sparse backfill reads as coverage, not as a broken
map. M7 spectrogram surface remains **decoration**, and [ALGORITHMS.md §9](ALGORITHMS.md) says so
out loud.

- [x] **8.8 The seam, made honest** — 2026-08-24 `ad5f756`. Two defects, both of the class this
  section exists to refuse: something that cannot error, reporting a plausible number.
  - ⚠️ **The space was never CENTRED on the reading side.** KourOS ranked on raw cosine over
    un-centred CLAP — §8.7's own trap, the one that reversed the M4 verdict. Strangers sat at
    **+0.480 ± 0.219** while the z-scored descriptor arm sat at −0.017, so the two arms were on
    incompatible scales and `makeRun()` was **broken**: it scored `cohesion × dot` minus
    `|energy − target|`, and a cosine that barely varies loses to a percentile-ranked energy term
    spanning [0,1]. A "run" was an energy ramp through unrelated music.
  - **The fix is §8.4's pattern, applied to the neural arm.** `query.py --fit` fits the corpus
    geometry and stores it in `meta` as `calib_*:<arm>` — the `<name>:<table>` convention
    `config_sig:local_vectors` already set, so it generalises to both arms. After centring:
    neural **−0.0280 ± 0.3054**, descriptor −0.0165 ± 0.2935. Measured over the real 2,376-vector
    index, in the units the app serves: **same album +2.404, stranger +0.046**, and `makeRun`'s
    consecutive similarity goes **1.385 → 2.758** when the term is switched on.
  - ⚠️ **Tier 1 of the join CANNOT HIT IN A CONTAINER, and that is not a bug in tier 1.** The
    embedder walks the host (`/mnt/Luna/Plex/Music/…`); KourOS reads a bind mount (`/music/…`).
    Both absolute, both correct, no shared prefix — so the obvious join is dead in deployment
    while working perfectly on a workstation. **Green in dev, silently 0% in prod.** A
    root-relative tier is now the primary join; measured on the real index in the container
    shape: **path 0 · rel 2,376 · content 0 → 100% coverage.**
  - ⚠️ **1,511 of 2,376 vectors keyed to an artist that does not exist.** The content-key salvage
    read the first segment BELOW the library root as the artist directory; once the retired rip
    moved into `Old (Needs to be trimmed)/`, that segment *was* the excluded folder. Now read
    from the FILE end (album = parent, skipping `Disc N`; artist = its `<Artist> - ` prefix or
    the directory above), which is root-independent. Measured: 1,511 bogus before, **0 after**.
  - `discover.smoke.mjs` (26 assertions) roots its fixture index elsewhere on purpose, so the
    container mismatch is reproduced rather than described; its **negative control** points the
    seam at another library's index and requires coverage to collapse *and* the server to say so.

- [ ] **8.9 The space over the FINAL library** — **UNBLOCKED 2026-08-26, backfill RUNNING.**
  The library is complete: **47,491 FLACs / 1.9 TB** at `/mnt/Luna/Plex/Music`, three times the
  15,326 every earlier estimate was sized against. Sequence: `backfill.py --scan` → `backfill.py`
  → `descriptors.py --build --encoded` → **`query.py --fit`** (the geometry must be refitted over
  the final corpus — the mean of a half-filled library is the mean of whatever path order
  reached) → `query.py --gate` → `ship.py`.
  - **The index was reset to zero first, and that was not a shortcut.** Audited before touching
    anything: **0 of 27,474 indexed paths still existed on disk.** Not the retired rip alone —
    *every* row, including the 865 "flat layout" ones §8.6 had banked. Nothing was salvageable,
    so `tracks` was dropped (cascading 2,376 vectors + 2,303 descriptors) along with
    `descriptor_mean`/`_std` and every `calib_*`, which were fitted over a corpus that no longer
    exists. Backup taken first. Re-keying old vectors onto new paths by content was rejected:
    a mis-keyed vector is silent corruption of exactly the kind this section refuses.
  - ⚠️ **THE LIBRARY IS NO LONGER FLAT — IT IS MIXED, AND THAT BROKE `artist_of`.** The final
    shelf is **9,689 flat** (`<Artist> - <Album>/…`), **31,297 artist-nested**
    (`<Artist>/<Album>/…`) and **6,505 with disc subfolders**. `descriptors.artist_of` was
    `os.path.dirname(album_of(path))`, which is right only for a nested library: for a flat album
    the parent of the album folder **is the library root**, so **10,771 tracks (22.7%) collapsed
    into a single fake artist named `/mnt/Luna/Plex/Music`.** Nothing errors. The gate's
    same-artist rate would have been computed over a 22%-of-the-library bucket, and — the part
    that reaches production — `fit_calibration`'s **stranger pool silently excludes every pair
    inside it**, so `calib_stranger_spread`, the number KourOS divides every served cosine by,
    would have been fitted on a biased population.
  - **The fix is directory-first, NOT prefix-first**, and the difference is measured. Reading the
    `<Artist> - ` prefix first is the obvious port of §8.8's KourOS content key, and it is wrong
    here: **494 nested tracks** live in album folders whose *title* carries a hyphen
    (`Taking Back Sunday/Live From Orensanz (… , New York, NY - 2009)`) and get credited to half
    an album title. A parent directory below the root is unambiguous; the prefix is the fallback
    when there is none. Result: **1,515 real artists, 0 unresolved**, and the **125 artists filed
    under both layouts now unify** because the reader returns a NAME, not a path.
    `vectors.js`'s tier-3 salvage was flipped to the same precedence so the two seams agree.
  - **`ridge.CHECK_SET` was repointed a second time** — the same four tracks, now one directory
    deeper. Worth noting that this cost **one loud test failure** rather than the silent
    PASS-shaped skip it caused in 2026-08-21, because `check_set_missing()` exists now.
  - **New: `music/ship.py`, the hand-off KourOS had no tool for** (16 tests). `VACUUM INTO` an
    atomic, fully-checkpointed **single file** — which retires the `-wal` sidecar trap by
    construction instead of by remembering, and can be taken while the backfill is still running.
    It then verifies **the copy**, refusing an index with **no fitted geometry** (§8.8), paths
    that miss the library root segment, mixed dimensions, or no vectors at all. Measured on the
    live index: the root-relative join covers **47,441/47,441 paths**, so KourOS's tier 2 is
    100% in the container shape.
  - ⚠️ **`descriptors.py --build --encoded` is a SECOND full pass over the library** — the two
    arms decode at different sample rates on purpose (§8.5's profile axis), so it cannot share
    the neural run's reads. At the measured mount ceiling that is another ~5 h for an arm M4
    already judged the loser. **Decide before running it** whether the gate needs the baseline
    over all 47k or over a `select_albums` spread; `align()` intersects the arms anyway, so a
    representative subset gates identically.
