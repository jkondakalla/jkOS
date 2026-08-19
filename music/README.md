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
python descriptors.py --build --albums 60 --per-artist 3
python descriptors.py --gate         # the §8.4 sanity gate
```

The encoder needs `onnxruntime`, which this host's PEP 668 Python will not install
system-wide — hence a contained venv (see [`models/README.md`](models/README.md)):

```bash
./.venv/bin/python encoder.py --fetch     # 281 MB, pinned commit, checksum verified
./.venv/bin/python encoder.py --verify    # the §8.5 checks
./.venv/bin/python -m unittest discover   # the same suite, with the encoder tests live
```

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
| `encoder.py` | **The neural arm.** CLAP audio tower via `onnxruntime`, 10 s windows → mean-pool → 512-d. |

Not yet written: the backfill (§8.6) and `query.py` (§8.7).

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

The consequence for §8.6: parallel decode *readers* (subprocess releases the GIL, so threads
are correct) feeding a **serial** ONNX session. Do not give both the readers and the model 16
threads.

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

## Status

**§8.1, §8.2 and §8.3 complete** — config, decode, scan, index, the mel transform, and the
ridgeline. **131 tests green.** The §8.1 gate passed at 0.0 ms against ffprobe on a real FLAC;
§8.2's numbers were inspected on real tracks before anything was built on them (spectral tilt in
the right direction, energy peaking in the 64–98 Hz kick/bass region, no non-finite cells, a real
beat in low-band autocorrelation at 129 BPM, r=0.60).

**§8.3's gate passed, looked at in a browser in both faces.** Four deliberately unalike tracks —
metalcore, hip-hop, solo piano, spoken-word stand-up — render as four plainly different pictures:
the metalcore panel is dense in every register end to end; the hip-hop panel shows an unmistakable
kick grid in the bass rows with silence between the hits; the piano ballad is near-flat below
200 Hz with slow swells at 200–800 Hz; the stand-up cut has no bass content at all and sits in a
horizontal speech-formant band with syllable-rate modulation. Beat grid visible, harmonic
structure visible, quiet material actually quiet.

Next is **§8.4, the classical descriptor baseline** — built *before* the encoder on purpose, so
that M4's gate has a comparison arm. Nothing downstream of §8.7's similarity gate is planned yet:
M4 is a stop-the-world check, and chunking past it would be planning on faith.
