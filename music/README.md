# music — a vector space over 15,326 FLACs

Turn a personal music library into a searchable vector space: **mel spectrograms →
pretrained embeddings → similarity search**, and then a shuffle that *walks* the space
instead of permuting it.

Design record and the reasoning behind every decision here:
[`Documentation/ALGORITHMS.md §4`](../Documentation/ALGORITHMS.md). The task breakdown is
[`Documentation/ToDo.md §8`](../Documentation/ToDo.md). This README covers how to run it and
what the pieces are; it deliberately does not restate either.

This directory is **outside the pnpm workspace** and has **zero jkOS imports**, following the
[`jkos-deploy/`](../jkos-deploy/) precedent. That isolation is a deliverable, not an accident
of sequencing — when the similarity results are wrong, there is exactly one place the fault
can be.

---

## The dependency budget

`requirements.txt` is **exactly two lines and never gains a third**:

```
numpy>=1.26,<2.0
onnxruntime>=1.17,<2.0
```

Plus the `ffmpeg` binary. That covers *everything*: decode, STFT, mel filterbank, MFCC,
descriptors, the SQLite index, cosine search, and PCA. Only the encoder forward pass needs
the second line.

This is a portfolio project, so the dependency list is part of what is being shown. Four
things are therefore **deliberately not taken**, each replaced rather than merely avoided:

| Not taken | What replaces it |
|---|---|
| `librosa` / `soundfile` / `torchaudio` | ffmpeg → `np.frombuffer`. Measured below: the decode is network-bound, not CPU-bound, so the library would buy nothing. |
| **`torch`** | ⚠️ **No fallback, by decision.** If a model will not export cleanly to ONNX, *change models*. Export tooling may run once in a throwaway venv — that is a build tool, never a dependency. |
| `sqlite-vec` | stdlib `sqlite3`, with a table *shaped* for it. It is a port target, not a speed need. |
| `pytest` · `matplotlib` · `sklearn` · `umap-learn` | `unittest` · SVG emitted as text · `np.linalg.svd` |

---

## Running it

```bash
cd music
python -m unittest discover          # the whole suite; needs only ffmpeg + numpy

python config.py                     # print the analysis parameters and their signature
python scan.py                       # count what is on the shelf
python scan.py "/mnt/Luna/Plex/Music/again&again"
python audio.py <file.flac>          # decode one file and compare against ffprobe
python mel.py <file.flac>            # transform one file and summarise the matrix
python index.py                      # index health

python ridge.py                      # the check sheet: four unalike tracks, full length
python ridge.py --seconds 16         # …the same four, 16s from the middle — the beat-grid view
python ridge.py --seconds 20 <file.flac> --out out/one.svg

python descriptors.py --names        # the 119-dimension layout
python descriptors.py <file.flac>    # describe one file, readable numbers
python descriptors.py --scan         # walk the library into `tracks` (~23s for 15,326)
python descriptors.py --scan --root /some/other/shelf
python descriptors.py --build --albums 60 --per-artist 3
python descriptors.py --gate         # the §8.4 sanity gate
```

The encoder needs `onnxruntime`, which this host's PEP 668 Python will not install
system-wide — hence a contained venv (see [`models/README.md`](models/README.md)):

```bash
./.venv/bin/python encoder.py --fetch     # 281 MB, pinned commit, checksum verified
./.venv/bin/python encoder.py --fetch --force   # re-download over what is there
./.venv/bin/python encoder.py --verify    # the §8.5 checks
./.venv/bin/python -m unittest discover   # the same suite, with the encoder tests live

./.venv/bin/python backfill.py --scan               # walk the shelf into `tracks` first
./.venv/bin/python backfill.py --limit 20           # a taste, ~20s
./.venv/bin/python backfill.py --artist "again&again"
./.venv/bin/python backfill.py                      # the whole library, ~3.6 h, resumable
./.venv/bin/python backfill.py --failures           # what died, and why
./.venv/bin/python backfill.py --status
```

The gate, §8.7 — no model needed, the vectors are already in the index:

```bash
python query.py --status                  # what each arm holds, and the overlap
python query.py --gate                    # the objective proxies, both arms, one population
python query.py --hand                    # THE GATE: a spread of tracks, both arms, side by side
python query.py --hand -k 20 "Stacy's Mom" "Pink Eye"
python query.py "hate me" --arm neural -k 20
```

⚠️ **`--gate` is not the gate.** §8.7's gate is a person reading `--hand` for tracks they know
cold, and `hand_sheet` deliberately prints no verdict. A test asserts that it never grows one.

Handing the finished space to KourOS, §8.9:

```bash
python ship.py --check                       # verify the live index, write nothing
python ship.py --out out/music-index.db      # atomic snapshot, then verify THE COPY
```

⚠️ **Never `cp index.db`.** The index is WAL with a commit per track, so an arbitrary share of
it lives in `index.db-wal` — a plain copy is a pre-checkpoint snapshot that opens cleanly and
reports a *plausible, smaller* count, which reads downstream as "the backfill hasn't got there
yet". `ship.py` uses `VACUUM INTO`: one fully-checkpointed file, no sidecar for anyone to
forget, safe to take while the backfill is still running. It also refuses the three other ways
the hand-off succeeds and is wrong — an index with **no fitted geometry** (§8.8: KourOS would
rank on the un-centred space), paths that **miss the library root segment** KourOS joins on,
and mixed dimensions.

The backfill can be stopped at any moment — Ctrl-C, a dropped mount, a power cut — and
re-running it picks up exactly where it left off. There is no state file to go stale,
because progress is *the absence of a join partner* (see below).

**A button for the above, since the run gets stopped and restarted a lot:**

```bash
./.venv/bin/python control.py      # → http://127.0.0.1:8765
```

Resume, Stop, a progress bar and the live throughput line, in stdlib `http.server` and
one file. It starts the run **detached**, so closing the panel does not take a three-hour
run with it, and Stop sends SIGINT so the run drains and summarises rather than dying
mid-track. ⚠️ It binds **127.0.0.1 only** — it starts processes and has no auth, which is
safe exactly because nothing else can reach it. It is temporary scaffolding for §8.6/§8.7
and nothing imports it: deleting `control.py` costs one `rm`.

Renders land in `out/` (gitignored — every one is regenerable from the audio). Open the SVG in a
browser: it carries **both faces**, so it reads on kraft paper or on the tube depending on the
system theme.

The test suite runs with **no library mount**: the audio fixtures are synthesised with the
same ffmpeg the project already requires. The library-backed checks skip cleanly when
`/mnt/Luna` is absent, so this is runnable on any machine.

---

## The modules

| File | What it is |
|---|---|
| `config.py` | **The single source** for every analysis parameter, and the `signature()` that fingerprints them. Read the warning at the top before editing it. |
| `audio.py` | `decode(path)` → mono float32 at the analysis rate, via an ffmpeg subprocess. `probe_duration()` is the independent witness the gate checks against. |
| `scan.py` | Walks the library, yields `(path, mtime, size)`. Absolute paths, deterministic order. |
| `index.py` | `index.db` — `tracks` (scan **and** resume ledger), `local_vectors` (neural), `descriptors` (classical baseline), `meta`. float32 BLOBs. |
| `mel.py` | **The transform.** frame → Hann → `rfft` → power → triangular mel filterbank → log. 128 × T float32, numpy only. |
| `ridge.py` | **The picture.** 128 stacked polylines per track, emitted as SVG text. One shared level scale across every panel. |
| `descriptors.py` | **The baseline arm.** 119 classical dimensions — MFCC + deltas, chroma, spectral shape, ZCR, RMS, tempo — plus the corpus z-score and the §8.4 gate. |
| `encoder.py` | **The neural arm.** CLAP audio tower via `onnxruntime`, 12 windows of 10 s → mean-pool → 512-d. |
| `backfill.py` | **The run.** Parallel decode+mel readers feeding one serial session, one commit per track, resumable from the first commit. |
| `query.py` | **The gate, and the search.** `M @ q` over the whole matrix; both arms aligned to one population; the duplicate-aware proxies; the side-by-side sheet a person reads. |
| `ship.py` | **The hand-off to KourOS.** `VACUUM INTO` an atomic single-file snapshot, then verify *the copy* against the four ways the hand-off succeeds and is still wrong. |

### The two arms, and why they analyse differently

`config.py` holds **profiles** — complete, named analysis configurations, one per vector
space, each stamped onto its own rows by its own signature:

| | baseline (§8.4) | `ENCODER` (§8.5) |
|---|---|---|
| | 22050 Hz · 2048 · hop 512 · 128 mels · htk · ln | 48000 Hz · 1024 · hop 480 · 64 mels · slaney · dB |
| set by | what the descriptors need | what CLAP's `preprocessor_config.json` declares |

This looks like the two-configurations corruption Trap 16 names, and it is the opposite of
it. The corruption is *one* vector space built from two configurations, silently. Here each
space has exactly one, declared in one module, stamped per row, and enforced per table by
`index.assert_config`.

The reason not to simply adopt CLAP's numbers everywhere is arithmetic. A 1024-sample
window at 48 kHz is a 46.9 Hz frequency bin against the baseline's 10.8 Hz, and chroma can
only resolve a semitone above the frequency where a semitone is wider than a bin — so
adopting CLAP's STFT globally moves that floor from **181 Hz to 788 Hz**, above most of
the melodic range, and 24 of the baseline's 119 dimensions stop measuring harmony.
**M4 judges the encoder against the baseline, and its stop condition is "if the descriptors
win, something upstream is broken."** Handicapping the opponent to suit the contender makes
that gate easier to pass, which is exactly the wrong direction.

### What the descriptor baseline is for

It is M4's comparison arm, and it was built **before** the encoder on purpose: an arm built
after the thing it judges never gets built, and the gate quietly becomes a vibe check. 119
dimensions of pre-deep-learning music similarity — MFCC mean/std and their first
differences (80), chroma mean/std (24), spectral centroid/bandwidth/rolloff/flatness/ZCR/
log-RMS mean and std (12), and tempo (3).

⚠️ **The z-score is across the corpus, not per track.** Normalising each track against
itself makes a bright track and a dark track both read "average brightness for themselves"
and every distance collapses toward noise, with no error to notice. It is the same mistake
`ridge.py` guards against one step earlier and in pixels. Guarded the same way: by API
shape. There is no function that normalises one vector; `CorpusStats.fit` refuses fewer
than 8 rows, and the fit is stored in the index so a track added months later lands in the
same space.

**Measured 2026-08-18 over 887 tracks (82 albums, 39 artists):**

| mean cosine | |
|---|---|
| same album | **+0.4288** |
| same artist, other album | **+0.1802** |
| different artist | **+0.0005** |

and 49.2% of nearest neighbours share an album against **1.3% by chance**, 59.6% share an
artist against 3.2%. The gate passes.

Re-run 2026-08-19 over 2,298 tracks, under the corrected shelf reader (see the disc-directory
warning below): album **+0.3740**, artist **+0.1567**, stranger **−0.0053**, NN album 32.9%
against 0.6% chance and NN artist 69.9% against 10.0%. Still passes. ⚠️ **Those two rows are
not comparable to each other** — the corpus grew from 887 tracks over 39 artists to 2,298 over
38, with a far denser duplicate population competing for the nearest-neighbour slot. Different
population, not a regression, and this is the same mistake §8.7 exists to avoid one level up.

### What `mel.py` actually computes

A four-minute track is ~5.2 million samples. That is far too many numbers to compare against
15,326 other tracks, and the wrong numbers anyway — amplitude over time tracks loudness, not
music. The transform reduces it to a **128 × T matrix of band energy over time**:

1. **Frame.** Cut the signal into overlapping 2048-sample windows, one every 512 samples
   (~93 ms wide, ~23 ms apart). Overlap matters: a note starting mid-window would otherwise be
   split across two frames and smeared in both.
2. **Window.** Multiply each frame by a periodic Hann curve, tapering it to zero at both ends.
   Without this the FFT sees an abrupt cut as a broadband click and every frame's spectrum is
   contaminated (spectral leakage).
3. **`rfft` → power.** Fourier transform each frame into 1025 frequency bins, then square the
   magnitudes. Phase is discarded here — where the waveform sat in its cycle is inaudible, and
   keeping it would double the data for nothing.
4. **Mel projection.** One matmul against a (128 × 1025) triangular filterbank, collapsing 1025
   linear-frequency bins into 128 perceptually-spaced bands. The bands are equally spaced *in
   mel*, so they come out narrow at the bottom and wide at the top — matching where pitch
   discrimination actually lives.
5. **Log.** Compress the result. Musical energy spans many orders of magnitude and loudness is
   perceived logarithmically, so without the log a single loud moment dominates every distance
   computation that follows.

⚠️ **Mel is not a log-frequency axis.** It is roughly linear below ~1 kHz and logarithmic above,
so an octave up high spans *more* mel than an octave down low. Equal treatment per octave is a
constant-Q transform — a different thing. A test pins this.

### What the ridgeline is for

`ridge.py` is a correctness check disguised as a picture. Everything after it — descriptors,
encoder, backfill, similarity — assumes `logmelspectrogram()` returns a description of *music*.
§8.2 checked that numerically. This checks it with an eye: render tracks that are obviously
unalike and the pictures must be obviously unalike too. **If it does not look like music, stop
and fix `mel.py`.**

⚠️ **Every panel is drawn against one shared absolute level scale.** Per-track normalisation
would rescale each picture to fill its own frame, and a quiet piano ballad would come out looking
exactly as loud as a brickwalled metalcore track — destroying the only comparison the check
exists to make. It is the same mistake §8.4 warns about for the descriptor z-score, one step
earlier and in pixels. The API enforces it: a level range belongs to a *sheet*, and `Panel` has
no scale of its own.

Two numbers were tuned against real audio and are pinned by tests, because they look arbitrary
and are not:

- **row pitch ≥ 9 px.** 128 rows is far more than a ridgeline normally carries (10–40 is the
  usual form). At 620 px of plot height the pitch is 4.8 px, every row's excursion crosses two
  neighbours, and the panel collapses into a uniform hatch — which reads as *"the transform is
  broken"* when it is only *"the picture is too small"*. Hence a tall default plot with panels
  side by side rather than in a grid.
- **overshoot 2.4 row-pitches** for a full-scale band. At 1.4 the bands barely lift off their
  rules and a hip-hop track reads as ruled paper; past ~3 loud material smears over three rows at
  once.

And the time axis is reduced by **max, not mean**: a four-minute track is ~10,000 frames against
~450 pixels, and a kick drum is one loud frame in a bucket of quiet ones. Averaging deletes
exactly what the picture exists to show.

### The backfill, and why it has that shape

    3 reader threads                     1 main thread
    decode (0.38 s median, wire-bound)   ONNX session, 8 intra-op threads
    + 12 x mel (30 ms each)              0.058 s/window x 12 = 0.70 s/track
    = 0.74 s/track each                        ^
          \------------ bounded queue (4) -----/

§8.6 specifies parallel decode readers feeding a serial ONNX session, because Trap 19
says the CIFS mount is the bottleneck. §8.5 then measured that at this stage it is not —
the model is. Both readings are right, and the arrangement above satisfies both. Every
number in it was measured on this machine rather than assumed:

- **Decode parallelism plateaus at 3.** Over 24 uncached tracks per setting: 1 worker
  81 MB/s, 2 → 107, 3 → 110, 4 → 109, 8 → 112. The share gives ~35% over a single stream
  and then nothing. Three readers supply ~4 tracks/s against a model consuming ~1.4.
- **The mel belongs to the readers, and that is a 33% win.** It costs 30 ms per window
  against the model's 58 ms, so computing it on the main thread would add a third to the
  wall clock while three reader threads sit blocked on the network. `encoder.py` splits
  into `window_features` (parallel) and `embed_features` (serial) for exactly this.
- ⚠️ **What crosses the queue is a feature tensor, not a signal.** The library's longest
  file is a two-hour, 545 MB FLAC that decodes to **1.4 GB** of float32; a bounded queue
  of decoded *signals* with several in flight is an OOM waiting to happen. A tensor is
  **3.1 MB** and bounded by the cap.
- **8 model threads, batch 4.** The sweep is 0.291 / 0.162 / 0.094 / **0.058** / 0.087 s
  per window at 1 / 2 / 4 / 8 / 16 threads — 8 is the physical core count, and the
  hyperthread pairs past it contend. Batch size is nearly noise: 0.058 at 1 and 4,
  0.066 at 8.

### How many windows a track gets, and how that was decided

The model takes ten seconds; a track is minutes. Uncapped, the median track is 41 windows
and the whole library is **~15 hours**. `encoder.MAX_WINDOWS` caps it at **12, evenly
spaced** — never the first 12, which would be an index of intros.

The obvious way to choose that number is cosine against the all-windows pool, and it is
the wrong measure: §8.7 reads a **ranking**, not a vector. So it was measured over 71
tracks from 8 complete albums — the closest pairs in the library, and therefore the
ranking most easily disturbed:

| cap | NN agrees with uncapped | top-5 overlap | **NN shares an album** | cos to full pool |
|---|---|---|---|---|
| 6 | 0.662 | 0.789 | **0.915** | 0.983 |
| 8 | 0.746 | 0.839 | **0.901** | 0.991 |
| **12** | **0.873** | **0.899** | **0.887** | **0.997** |
| 16 | 0.873 | 0.952 | **0.887** | 0.999 |
| all | 1.000 | 1.000 | **0.887** | 1.000 |

**The bolded column is the flat one.** How often the nearest neighbour shares an album —
the only column that says whether the answer is any *good* — does not degrade at any cap.
The disagreements are tie-breaks: album-mates sit at mean cosine **+0.868** against
**+0.443** for everything else, so *which* album-mate ranks first flips between two
vectors that are both defensible estimates of the same track. The uncapped pool is not
ground truth; it is simply the uncapped recipe.

⚠️ **The cap changes the vectors, so it is recorded where they live.** `config.signature()`
fingerprints how a mel is built and says nothing about which mels a vector is the mean of.
`index.assert_recipe` stamps `encoder.recipe()` per table and refuses to *add* under a
different one — same alarm as Trap 16, one level up, and the same escape hatch: clear the
table and re-run.

### Why `tracks` is also the ledger

§8.6 is a multi-hour batch over a network share, and it must be resumable **from its first
commit** rather than after the first long run dies. So progress is not a counter anyone has to
remember to write — it is the *absence of a join partner*:

```sql
SELECT t.* FROM tracks t LEFT JOIN local_vectors v ON v.track_id = t.id
WHERE v.track_id IS NULL
```

Kill the run at track 9,000 and the next invocation asks the same question and gets the
remaining 6,326. A separate progress file could go out of sync with the index; this cannot.

### Why `local_vectors` has that name

`apps/lazuros/deployment.jag.json`'s embedding slot already declares
`"table": "local_vectors"`. Matching the name and shape costs nothing now and makes LazurOS's
sub-task library deduplication a lift rather than a rewrite later.

---

## Measured on this machine, 2026-08-18

- **The library**: 15,326 FLACs across 89 artist folders, ~380 GB. Zero mp3/m4a/wav/ogg.
- **`/mnt/Luna` is a CIFS mount at 85–96 MB/s.** A real end-to-end decode of a 51.8 MB /
  234.9 s track took **0.59 s wall = 88 MB/s** — i.e. it ran at exactly the network ceiling.
  **The filesystem is the bottleneck, not the FFT and not the model.** Reading the whole
  library once is ~75 minutes, and that is the floor on any full-corpus pass.
- **Decode accuracy**: sample count vs. the container's own duration agreed to **0.0 ms** on a
  real 235-second file, against a one-frame (23.2 ms) tolerance.

- **Parallel decode plateaus at 3 readers**: 81 MB/s at 1, 107 at 2, **110 at 3**, and nothing
  after — the share gives ~35% over a single stream and stops.
- ⚠️ **At §8.6 the model overtakes the wire.** 0.058 s per 10 s window against a 0.38 s
  whole-track read, so the readers become the cheap half and get the mel as well as the decode.
  That is the one place Trap 19 does not apply, and it is measured, not assumed.

---

## Traps

Full list in [`ALGORITHMS.md §10`](../Documentation/ALGORITHMS.md). The three that shape the
code in this directory:

**⚠️ 16 — the windowing config lives in one module.** Extraction and the encoder disagreeing
on sample rate, hop, `n_mels`, log base, or the mel-scale convention corrupts the space
*silently and totally*: no exception, no NaN, just confidently wrong neighbours. `config.py`
is the only place any of it is written down, and `config.signature()` is stamped on every
stored vector so a drift becomes a raised `ConfigDriftError` instead of a quiet corruption.

**⚠️ 20 — the paths are hostile.** `again&again`, `Today's Lesson.flac`, `[16B-44.1kHz]`.
**Never `shell=True`, anywhere.** Every subprocess call passes an argv list. The test fixtures
are generated at a deliberately hostile filename so this stays enforced rather than remembered.

**⚠️ 20 again, in the renderer.** `again&again` written raw into an SVG `<text>` element is not
an escaping nicety — it is malformed XML, and the whole picture fails to open. A test renders a
panel titled with the hostile fixture name and parses the result back.

**⚠️ 18 — no ANN index.** 15,326 × 2048 float32 is 125 MB and one matmul. Reaching for FAISS
here is optimising a problem that does not exist.

---

## When a run goes wrong

"Failures are data" is right for one corrupt FLAC and catastrophic for one dropped mount, and
the difference is not visible from inside the loop. `/mnt/Luna` is CIFS over a home network;
when it goes, ffmpeg does not hang — it returns ENOENT in milliseconds — so a thirty-second
blip in hour two would mark *every remaining track* `failed` in about a minute. And
`index.pending` excludes failed rows, so the obvious recovery, running it again, would then
skip all thirteen thousand of them and report a finished library. Silent, total, and wearing
the face of success.

Both arms therefore stop themselves, and the two causes get different answers:

| what happened | what the run does |
|---|---|
| **the shelf is gone** (`scan.library_reachable` says the root is not a directory) | stops immediately and marks **nothing** — the mount is not this track's fault, so the rows stay `pending` and the next run picks them up with no flag to remember |
| **25 failures in a row** with the shelf present — a full disk, deleted weights, a dead session | stops, and those rows **are** marked `failed` with their error text, because each one genuinely failed. `--failures` reads them; `--retry-failed` is the deliberate second attempt |
| **one bad file** among good ones | marked `failed`, batch continues. The counter is consecutive, so a merely patchy library still runs to the end |

The backfill reports this as `progress.aborted` and exits **2**; the descriptor build raises
`DescriptorError`. Neither loses the work already committed — one commit per track, always.

Everything else that can go wrong on an ordinary day — a typo in a search fragment, an arm
nobody has filled yet, a corpus too small to z-score, a config edit after a backfill — prints
one line and exits 1. Each of those exceptions already carries a sentence saying what to do,
and a traceback puts that sentence at the bottom of twelve frames of noise.

---

## Status

**§8.1–§8.7 complete, and M4's gate has passed** — config, decode, scan, the index, the mel
transform, the ridgeline, the descriptor baseline, the vendored encoder, the backfill, and the
query surface. **361 tests green**, and the whole suite still runs with no library mount and no
weights.

An integration pass over the whole pipeline followed the gate, and the five findings worth
naming here are the ones that were **silent**:

- **A default argument is evaluated once, and three of them had captured a module constant.**
  `audio.decode(path, sr=SR)` over a `from config import SR` pinned the sample rate of
  whichever profile was in force the first time `audio` was imported — and three call sites
  import it lazily, one of them inside `with config.using(ENCODER)`. That is Trap 16 arriving
  through Python's scoping rules rather than through arithmetic: a baseline descriptor computed
  from a 48 kHz decode, no exception, no NaN. `scan.iter_tracks(root=LIBRARY_ROOT)` had it too,
  which made moving `config.LIBRARY_ROOT` — the documented way to run without the mount — do
  nothing at all; and `index.connect(path=DB_PATH)` had it, so redirecting `index.DB_PATH` at a
  scratch copy silently wrote to the real index. The third one was found the honest way: by a
  verification run that thought it was using a copy and was not.
- **The filterbank cache never served a hit.** Keyed on `(name, signature)` and cleared on any
  miss, its four entries evicted each other in rotation: 4 rebuilds per `describe()`, 24 per
  encoded track, forever — and a `clear()` between another thread's `in` check and its
  subscript is a `KeyError` in a run eight threads wide.
- **`upsert_track(conn, path)` deleted the vectors it was asked about.** Both stat arguments
  default to `None`, and `None` was compared against the stored numbers, so the obvious way to
  ask for a row id read as "the file changed" and dropped hours of encoder time.
- **A dropped mount would have burned the queue** — see *When a run goes wrong* above.
- **An interrupted `--fetch` left a truncated 281 MB file** where `available()` checks for one,
  so the next backfill would report the encoder present and fail inside onnxruntime.

The gate was re-run after all of it and reads identically: NN album 40.0 vs 29.0, clean 58.4 vs
42.6, artist 94.2 vs 85.3, `gap/σ` 1.23 vs 1.21.

The vector space currently covers **1,511 tracks**, not 15,326: the backfill was stopped
deliberately because this is not the library the space will finally be built over. Nothing about
that is load-bearing — resuming is `backfill.py` with no arguments, and progress is the absence
of a join partner rather than a counter.

| | |
|---|---|
| **§8.1** | Decode agreed with the container's own duration to **0.0 ms** on a real 235-second FLAC, against a one-frame (23.2 ms) tolerance. |
| **§8.2** | The numbers were inspected on real tracks before anything was built on them: spectral tilt in the right direction, energy peaking in the 64–98 Hz kick/bass region, no non-finite cells, a real beat in low-band autocorrelation at 129 BPM (r=0.60). |
| **§8.3** | **Gate passed, looked at in a browser in both faces.** Four deliberately unalike tracks render as four plainly different pictures — the metalcore panel dense in every register end to end; the hip-hop panel an unmistakable kick grid with silence between the hits; the piano ballad near-flat below 200 Hz with slow swells at 200–800 Hz; the stand-up cut with no bass content at all, sitting in a speech-formant band with syllable-rate modulation. |
| **§8.4** | **Gate passed over 887 real tracks** (82 albums, 39 artists): same album **+0.4288**, same artist other album **+0.1802**, different artist **+0.0005**, and 49.2% of nearest neighbours share an album against 1.3% by chance. |
| **§8.5** | **Verified 8/8** with no reference implementation to diff against — spread (max off-diagonal cosine +0.435), structure (weakest self +0.940 vs strongest cross +0.435), and sensitivity (the same audio through the wrong mel convention lands at +0.491). |
| **§8.6** | **Stopped deliberately at 1,506 / 15,326 tracks**, 0 failures — this is not the library the space will finally be built over, so the remaining 3.6 h was not spent. Resuming is one command and picks up by construction. |
| **§8.7** | **GATE PASSED.** The neural arm beats the classical baseline on every criterion over 1,506 tracks held by both arms — see below. |

### §8.7, the M4 gate — what it read

Both arms first had to be brought onto **one population**. The neural backfill ran in path order
and stopped inside artist six; the descriptors were 887 tracks chosen as complete albums across
39 artists. **The two tables overlapped by 95 rows.** Comparing them as they stood would have
compared two libraries, not two arms — so `descriptors.py --build --encoded` filled the gap
(1,411 tracks, ~9 min, 0 failures) and every number below is over the 1,506 tracks both arms
hold.

| 1,506 tracks · 338 albums · 6 artists | NN album | credited | clean | NN artist | gap/σ |
|---|---|---|---|---|---|
| **neural (CLAP 512-d)** | **40.0%** | **72.2%** | **58.4%** | **94.2%** | **1.23** |
| descriptor (119-d) | 29.0% | 62.2% | 42.6% | 85.3% | 1.21 |
| *chance* | *0.9%* | — | — | *22.1%* | — |

`credited` counts a duplicate copy as a hit; `clean` is the raw rate over only those tracks whose
neighbour is *not* a duplicate. Three numbers rather than one, because they disagree by 18 points
and any single one of them would be a lie.

**And the hand check, which is the actual gate:** an AFI live track returns six neighbours off
the same live album, where the baseline breaks the run at rank 2 with a Bowling For Soup song.
An Atwood live-session take returns the rest of that session; the baseline returns the studio
cut of the same song — defensible, but the neural list is the coherent one. A Blue October
track finds its three duplicate copies and then its album-mates.

⚠️ **THE FIRST RUN REPORTED THE BASELINE WINNING, AND THE CRITERION WAS THE BUG.** On
"album-mates minus strangers" the descriptors score **+0.4125** against the neural arm's
**+0.3161**. Both numbers are correct and the comparison is meaningless. The descriptor space is
z-scored across the corpus and therefore **centred** — strangers sit at −0.026 and it uses its
whole range. CLAP's space is a narrow **anisotropic cone**: no two tracks in the library score
below +0.03 and strangers average +0.475. Subtracting one mean from another measures how *wide*
each space is, not how well either separates music, and the wider space wins by construction.
Dividing by the stranger spread removes offset and scale together — and the standardised gap
agrees with all three ranking measures, which are what a search actually reads. Both are
printed; only `gap/σ` is compared.

⚠️ **THE SHELF IS NOT UNIFORMLY THREE LEVELS DEEP.** 1,131 of the 15,326 files — 7.4%, every one
a multi-disc release — sit at `<artist>/<album>/Disc N/<file>.flac`. Read as three levels,
`Disc 1` becomes the album and **the album title becomes the artist**, so a deluxe edition is a
different band from the record it is a deluxe edition of. The symptom is not an error: it is a
same-artist rate a few points low for *both* arms at once, which is exactly what a comparison
hides by depressing it evenly. It surfaced from a check written to audit something else — 184
nearest-neighbour pairs sitting at cosine **1.00000** that the path claimed were different
songs, every one of them `Crash Love` against `Crash Love (Deluxe)/Disc 1`. Folding disc
directories into their parent moved the duplicate audit from **47.0% to 98.8% agreement**, the
artist rate from 78.0% to 94.2%, and the encoded population from "12 artists" to the 6 that
actually exist.

⚠️ **The duplicate correction is read off the PATH, never off a cosine.** "Count a neighbour at
cosine ≥ 0.999 as a hit" silently rigs the comparison: a 119-dimension z-scored space puts near-1
pairs within reach of two different masterings far more easily than a 512-d one does, so the
coarser arm collects free hits from the measurement meant to judge it. `song_key()` reads the
artist directory and the folded filename — the same evidence for both arms — and
`duplicate_audit()` then checks that heuristic *against* the cosines instead of trusting it,
which is what caught the disc bug above.
