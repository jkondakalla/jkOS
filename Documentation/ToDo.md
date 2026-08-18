# jkOS — ToDo

> **⏸ §1–§7 PARKED as of 2026-08-18.** Those sections are on hold until further notice — don't
> pick up anything from them on your own initiative; confirm with Jag first. They're kept up to
> date for when he comes back to them, not as active work.
>
> **▶ §8 is the active section.** The music vector space, chunked 2026-08-18 — that's the work in
> front of us. Design record: [ALGORITHMS.md](ALGORITHMS.md). LazurOS bring-up
> ([LAZUROS_STARTUP.md](LAZUROS_STARTUP.md)) comes *after* §8's gate and is still not tracked
> here.

The working backlog, condensed to what's actually open. **Completed work is summarized, not
enumerated** — the task-level record lives in the relevant `Documentation/*.md`. Jag's own
operational checklists (things only he can confirm — a live login, a host config value, a
Workshop publish click) have been moved out of here into each app's own doc, since a git
checkout can't verify them; each is flagged **"not yet confirmed as of 2026-08-18"** at its new
home, and this pass is logged in memory as unverified rather than done.

**As of 2026-08-18:** the suite (five core systems + PapyrOS/KourOS + the `@jkos/player`
primitive + Full Press design reface) is committed to `staging` through `5ce3a70`, **nothing
in this backlog is deployed yet**. Next up: **§8, the music vector space** — chunked here as of
2026-08-18, with [ALGORITHMS.md](ALGORITHMS.md) as its design record. LazurOS bring-up
([LAZUROS_STARTUP.md](LAZUROS_STARTUP.md)) is still not tracked in this file.

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

- [ ] **8.0 Deploy the clock.** *Not music — it's here because it loses value every day.*
      Migration 13 (variance instrumentation) is built, gate-green, committed through `5ce3a70`,
      and **never deployed**. Undeployed instrumentation logs nothing. Rebuild the BeigeBoard
      staging image, then confirm one real completion writes a real `completed_at`. One deploy,
      not a task. Step V (the completion-volume read, [ALGORITHMS.md §5](ALGORITHMS.md)) is
      deliberately **not** chunked — it's unreadable until this has been running a while.

- [ ] **8.1 `music/` skeleton — config, decode, index `[FEAT-M]`.** New top-level `music/`,
      **outside the pnpm workspace**, following the `jkos-deploy/` precedent: own `README.md`,
      own `requirements.txt`. (`pnpm-workspace.yaml` says in a comment that Python dirs with no
      `package.json` are skipped — no wiring needed.)
  - `config.py` — **the single source** for `SR` / `N_FFT` / `HOP` / `N_MELS` / `FMIN` / `FMAX` /
    window. ⚠️ Trap 16: extraction and embedding disagreeing here corrupts the space *silently
    and totally*. Nothing anywhere re-derives these.
  - `audio.py` — `decode(path) -> np.float32 mono @ SR`, ffmpeg subprocess
    (`-v error -i PATH -f f32le -ac 1 -ar 22050 -`) → `np.frombuffer`. argv list, never a shell
    string.
  - `scan.py` — walk the library, store the **absolute path** (matches KourOS `tracks.path`,
    which is `UNIQUE`, so M5's join costs nothing later) + `mtime` + size.
  - `index.py` — stdlib `sqlite3`, `music/index.db`. Three tables: `tracks` (scan + resume
    ledger), **`local_vectors`** (neural — name matched to `deployment.jag.json`'s embedding slot
    so LazurOS L3.6 is a lift, not a rewrite), `descriptors` (the baseline arm, kept separate so
    the port target stays pristine). float32 BLOBs.
  - `.gitignore`: `music/.cache/`, `music/models/*.onnx`, `music/out/` (`*.db` is already global).
  - **Gate:** decode one FLAC, assert `len(x)/SR` matches `ffprobe`'s duration within one frame.

- [ ] **8.2 M1 — mel extraction, hand-rolled `[opus]`.** `mel.py`: frame → Hann → `np.fft.rfft` →
      power → mel filterbank → log. 128 × T float32, **numpy only**. The filterbank (hz↔mel,
      triangular, built once at module level) is written here rather than imported — for this
      project that's the point, not a compromise.
  - **Inspect the numbers before anything is built on them.** [ALGORITHMS.md §4](ALGORITHMS.md)
    is explicit about this.
  - Tests (stdlib `unittest`): frame-count formula · filterbank rows triangular, non-negative,
    50% overlap · a 440 Hz sine lands in the mel bin containing 440 Hz **and nowhere else** ·
    silence → the log floor · bitwise determinism across two runs.

- [ ] **8.3 M2 — ridgeline render `[FEAT-M]`.** 128 stacked polylines, one per mel band,
      vertically offset. **Emitted as SVG text — zero dependencies**, no matplotlib. Load the
      `dataviz` skill before the first plotting call, not after.
      A correctness check disguised as a picture: render 3–4 deliberately unalike tracks (dense,
      sparse acoustic, a spoken-word cut) and confirm they *look* unalike — beat grid visible in
      percussive material, harmonic stacks in the low bands, quiet intros actually quiet.
      **If it doesn't look like music, stop and fix 8.2.**

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
