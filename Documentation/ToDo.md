# jkOS — ToDo

> **⏸ §1–§7 PARKED as of 2026-08-18.** Those sections are on hold until further notice — don't
> pick up anything from them on your own initiative; confirm with Jag first. They're kept up to
> date for when he comes back to them, not as active work.
>
> **▶ §8 is the active section.** The music vector space, chunked 2026-08-18 — that's the work in
> front of us. §8.0–§8.3 are done; **§8.4, the descriptor baseline, is next.** Design record: [ALGORITHMS.md](ALGORITHMS.md). LazurOS bring-up
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
M4 is a stop-the-world gate and chunking past it is planning on faith.

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

- [ ] **8.4 The classical descriptor baseline `[FEAT-M]`.** Built **before** the encoder on
      purpose: M4's gate needs a comparison arm, and an arm built after the thing it judges never
      gets built. From the same STFT/mel, numpy only — MFCC mean+std (DCT-II of log-mel, 20
      kept), spectral centroid / rolloff / bandwidth / flatness, ZCR, RMS, chroma (12), tempo
      (autocorrelation of the onset-strength envelope). ~90–160 dims into `descriptors`.
  - ⚠️ **Z-score across the corpus, not per track** — store the corpus mean/std in the index so a
    new track normalises identically. Per-track normalisation makes the space meaningless.
  - Sanity gate that needs no encoder: two tracks from one album should sit closer than two
    random tracks.

- [ ] **8.5 M3a — the encoder, chosen and vendored `[opus]`.** Decision step first: **prefer a
      model with an already-published ONNX artifact** (HF repos often ship an `onnx/` folder) —
      that removes the export entirely. Candidates: **CLAP** (512-d, trained on audio paired with
      text, so a "find tracks matching *rainy 3am guitar*" query comes free), **PANNs/CNN14**
      (2048-d), **MERT** (768-d, music-specific).
  - **The commitment:** `requirements.txt` gets `onnxruntime` and **never `torch`**. If an export
    is unavoidable it runs **once** in a throwaway venv documented in `music/models/README.md`.
    **If a model won't export cleanly, change models.**
  - ⚠️ **This is where Trap 16 bites.** The model's expected input (sample rate, window, hop,
    `n_mels`, log base, normalisation) must match `config.py` — *or* `config.py` changes to match
    the model. Either way, **one module.** A model expecting 48 kHz/64 mels fed 22.05 kHz/128
    mels returns confident garbage.
  - Record `dim`, model id, and revision in the index. Verify a fixed input gives a stable output
    across runs, and that the vector is neither all-zero nor NaN.

- [ ] **8.6 M3b — the backfill run `[FEAT-M]`.** Windowed embeddings at the model's native window
      (~10 s, 50% overlap) → mean-pool → L2-normalise → `local_vectors`. Expect **~1.5–3 h wall
      clock**; progress and throughput to stderr.
  - ⚠️ **Resumable from the first commit** (Trap 17), not after the first multi-hour run dies.
    The ledger *is* the index — `tracks` LEFT JOIN `local_vectors`, commit per track, Ctrl-C
    safe. A run that dies at 9,000 restarts at 9,000.
  - ⚠️ **CIFS is the bottleneck**, not the FFT and not the model. Parallel decode workers
    (`subprocess` releases the GIL, so threads are correct here) feeding a **serial** ONNX
    session with `intra_op_num_threads` set. Do **not** give both the readers and the model 16
    threads.
  - `--limit N` and `--artist NAME` flags so a full run is never needed to test something. Design
    requirement, not convenience.
  - ⚠️ **Failures are data.** A corrupt or zero-length FLAC marks its row failed and the batch
    continues. One bad file must not kill a 2-hour run.

- [ ] **8.7 M4 — THE GATE `[opus]`.** `query.py`: load the whole matrix into one numpy array,
      L2-normalised, `M @ q`, top-k. ⚠️ Trap 18: **no ANN index.** 15,326 × 2048 float32 is
      125 MB and one matmul.
  - **Both arms side by side** — the same query as two columns, neural and descriptor, with
    artist/album read off the path.
  - **The hand check: pick 5–10 tracks you know cold and read the lists.** Do not automate this
    judgement; it *is* the gate.
  - Objective proxies *alongside* the hand check, never instead of it: same-album and same-artist
    neighbour rates. Embeddings should beat descriptors on both.
  - ⚠️ **STOP CONDITION.** If the descriptors win, something upstream is broken — extraction, a
    windowing config mismatch, pooling, or normalisation. Fix it. **Nothing past this step on
    faith**; everything downstream is decoration on a broken foundation.

**After the gate — unscheduled, named not planned.** M5 walking shuffle (also needs the KourOS
`MUSIC_DIR` mount, §3 — Jag's call) · M6 library map (**PCA via `np.linalg.svd`, not UMAP** —
`umap-learn` + `numba` breaks the budget) · M7 spectrogram surface (**decoration**, and
[ALGORITHMS.md §9](ALGORITHMS.md) says so out loud). Detail lives there, not here.
