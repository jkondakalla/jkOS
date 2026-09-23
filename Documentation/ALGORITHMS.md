# jkOS — Algorithms: LazurOS and the music vector space

> The work breakdown for the suite's two algorithmic projects. **If you are a fresh
> agent picking up either one, read this file first**, then the runbook it points at.
> When this disagrees with the code, the code wins — update this.

Related: **ToDo §8 (retired) is the music backlog** — the M1→M4 chunks, and the active section
as of 2026-08-18 · ToDo §1 (retired) is the LazurOS backlog ·
[LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) is the bring-up runbook, verified against source ·
[ROUTINES.md](ROUTINES.md) is the routine primitive the variance feature reads ·
[ARCHITECTURE.md § LazurOS](ARCHITECTURE.md#lazuros-the-ai-gateway) is the design record.

This file carries **what to do**. It deliberately does not restate the runbook, the routine
document format, or the provider contract — each has a home already, and a second copy is a
second thing to keep true.

---

## 1. The two projects, and why music is first

**LazurOS** is an AI orchestration control plane: it decides where a request runs, what it
cost, whether the output was good, and whether a human signs off before anything is written
to a system of record. Its one application surface is **BeigeBoard routine-variance
analysis** — the suite's only reconciliation surface that earns its place, because a routine
holds *declared intent* as progression rules and its occurrences hold *actual behaviour*, and
those two independently generated records diverge invisibly from either side alone.

**The music project** turns the FLAC library into a vector space: mel spectrograms →
pretrained embeddings → similarity search, a shuffle that walks the space instead of
permuting it, and visualisation.

**The dependency runs one way.** Music can be built standalone and ported onto LazurOS later.
LazurOS cannot be built standalone and ported onto music. So music is independent; LazurOS
optionally consumes it.

Two overlaps make music-first genuinely useful rather than merely easier:

- **It proves the vector path in isolation.** Embedding extraction, storage, and
  nearest-neighbour query with no auth, tiers, queue, or audit code wrapped around them. When
  similarity misbehaves the cause is unambiguous. That is the entire point of the **M4 gate**.
- **Sub-task library deduplication needs the same machinery.** Embed, cluster, propose
  merges. Proven on music first, **L3.6 becomes a port rather than a build.**

The reverse benefit is real but weaker — LazurOS would give the music backfill a batch tier
and an audit trail, and neither is required.

### Prerequisite state, as of 2026-08-18

| Project | Unmet prerequisites |
|---|---|
| **Music** | Effectively none. Python, an audio library, a pretrained encoder, and the FLAC library that already exists. Runs as a script on the workstation today. No auth, no deployment, no queue, no other service up. |
| **LazurOS** | A long list, none of it started. `prompts.json` / `models.json` unauthored · Ollama unconfirmed on the Polaris GPU under Vulkan · Emily MAC + IP unrecorded · WoL unconfigured · jkAuth service-client unenrolled · runtime `deployment.json` not created. Then the new work on top. **Code-complete is not running, and nothing is running.** |

---

## 2. The combined order

One change from the original sequencing, and it is the important one: **instrumentation moved
to step 0.** See §3 for why.

| # | Step | Gate to the next |
|---|---|---|
| **0** | BeigeBoard variance instrumentation (§3) | ✅ **BUILT + DEPLOYED 2026-08-18** — migration 13 verified applied on the live staging DB (ledger id 13, both columns, both triggers). Outstanding: one real completion to fire the trigger — the DB has **zero** completed items, so the 0→1 edge has not yet occurred. ToDo §8.0 (retired) |
| **M1–M4** | Music through the similarity gate (§4) — **chunked as ToDo §8.1–8.7 (retired)**. §8.1–§8.5 built 2026-08-18 (`music/`, 243 tests green; M2's picture gate, §8.4's sanity gate and §8.5's 8/8 verification all passed) | the ten nearest tracks to something you know well are *right* |
| **V** | Completion-volume check (§5) | a number, read off the live DB |
| **L1** | LazurOS minimal bring-up (§6) | a capability round-trips through the staging console |
| **L2** | Prompt versioning · audit schema · eval harness (§7) | one capability has a reproducible score |
| **L3** | The variance feature (§8) | a proposal accepted from a visible diff |
| **M5–M7** | Walking shuffle · library map · surface (§9) | — |

**Steps 0 and M1–M4 are independent of everything else and of each other.** Step 0 is a day
of work whose value is measured in calendar time, so it goes first and then gets out of the
way; M1–M4 is the long pole.

> **Step 0 is deployed as of 2026-08-18 — the clock is running.** Verified against the live
> staging database, not just the gate: the migration ledger reads `13|variance_instrumentation`,
> `items` carries `started_at` and `completed_at`, and both triggers exist. One thing is still
> owed and it is a checkbox tick rather than work — the staging DB holds **zero completed items
> of any kind**, so the `completed` 0→1 edge has never occurred and the trigger has never fired
> in production. Completing one real routine step closes it; see ToDo §8.0 (retired) for the
> read-back command. ⚠️ **Copy the `-wal` alongside the `.db`** when reading that database — a
> multi-megabyte WAL holds recent writes, and querying the bare `.db` shows a stale snapshot.

The useful property of this order: **a finished, demonstrable project exists at the end of
M4**, with none of the deployment surface involved. One complete project beats two
half-deployed ones.

### What is out of scope, named deliberately

Scope discipline is the point, so these are recorded rather than left to be re-proposed:

- **Pooling idle consumer devices for batch inference.** Two executors demonstrate routing
  and fallback completely. Six demonstrate nothing further.
- **Phone and USB-tethered executors.** A separate engineering problem, no bearing on
  accountability.
- **A generalised exception-handling engine across suite domains.** Six candidate surfaces
  were tested against the bar (independently maintained records · meaningful volume ·
  asymmetric cost of error); one met it. Building an abstraction over one instance is
  speculation.
- **Reconciliation as a suite-wide pattern.** Generation and extraction capabilities have no
  second record to disagree with. They get routing, cost accounting, and audit rows.
- **STT, TTS, and the web-search sidecar** — see §6, they gate nothing on this path.

---

## 3. Step 0 — BeigeBoard variance instrumentation

> **Do this first.** It unblocks nothing, and it loses value every day it is not deployed.

### Why it is step 0 and not step 2

The variance analysis needs accumulated completion history, and no amount of code produces
that — it is a calendar dependency. But it is a calendar dependency **running backwards**:
three of the five statistics the feature is specified to compute are not derivable from what
BeigeBoard logs today, and the history to derive them from is only created going forward.
Every day without the columns is history the feature will never have.

| Statistic | Computable today? | From |
|---|---|---|
| Completion rate per step | ✅ | `performed.steps[k].done` / `.met` |
| Completion rate per position | ✅ | position is the `prescription.steps[]` order |
| Skip clustering *by date* | ❌ | no `completed_at` — `updated_at` is trigger-managed and clobbered by every later edit |
| Ordering violations | ❌ | `performed.steps` is an **object**; performed order is unrecorded |
| Drift in start time | ❌ | `scheduled_time` is the *plan*. There is no actual, and `performed.at` is never written by any UI path |

### The change

**Migration 13** in [`apps/beigeboard/backend/src/db.js`](../apps/beigeboard/backend/src/db.js).
`MIGRATIONS` currently ends at id 12 — **append, never edit an existing one**
([ROUTINES.md §10.7](ROUTINES.md)). Additive and NULL-safe throughout, exactly as 10–12 were:
a routine that predates it keeps working unchanged.

| What | Where it is declared | Written by |
|---|---|---|
| `completed_at TEXT` | `ITEM_FIELDS` tail, `client: false` | a SQLite trigger on the `completed` 0→1 edge; **cleared** on 1→0 |
| `started_at TEXT` | `ITEM_FIELDS` tail, `client: true` | the UI, on first interaction with a session card |
| `performed.steps[k].at` | `normalizePerformed` | `logStep`, on the `done` false→true edge |
| `performed.steps[k].seq` | `normalizePerformed` | `logStep`, `1 + max(existing seq)` |

**Both columns go at the tail of `ITEM_FIELDS`, after `cadence_skips` and before
`created_at`/`updated_at`.** [`item-fields.js`](../apps/beigeboard/backend/src/item-fields.js)
says it out loud: **ORDER IS CONTRACT** — `ITEM_SHAPE` is emitted in declaration order and
served to peers, so new columns extend the tail and never shift a column a peer already
indexes.

### A trigger, not a handler stamp

`completed` is written from at least four paths — `PATCH /api/items/:id`, `/import`, the
routine engine's reconcile, and calendar sync — so a stamp in one route handler would miss
three. Reuse the idiom migration 8 already established, verbatim in shape:

```sql
DROP TRIGGER IF EXISTS items_stamp_completed;
CREATE TRIGGER items_stamp_completed AFTER UPDATE ON items
  FOR EACH ROW WHEN NEW.completed = 1 AND OLD.completed = 0
  BEGIN UPDATE items SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

DROP TRIGGER IF EXISTS items_clear_completed;
CREATE TRIGGER items_clear_completed AFTER UPDATE ON items
  FOR EACH ROW WHEN NEW.completed = 0 AND OLD.completed = 1
  BEGIN UPDATE items SET completed_at = NULL WHERE id = NEW.id; END;
```

The millisecond ISO format is not cosmetic — migration 8 moved the whole column family to it
because second-resolution stamps make two writes in the same second indistinguishable, which
silently breaks the weave delta cursor. Use the same format so the two columns sort together.

`recursive_triggers` is OFF by default, so the inner `UPDATE` will not re-fire these or
`items_touch_updated`. `items_touch_updated` has already fired on the *outer* update that set
`completed = 1`, so the delta cursor still moves — no extra bump is needed.

### Touch points

- [`@jkos/routine-spec`](../packages/routine-spec/src/index.js) — `normalizePerformed` carries
  `at` (ISO string, cap it like the other strings) and `seq` (int) per step. Nothing else in the
  engine reads them; `stepWasMet` is unchanged. **`logStep` lives here too** — since D9 the
  engine and the client half are one package, so this is one file, not two.
  ⚠️ **`logStep` is called for every patch**, including note edits, so `at` must be guarded to
  the `done` false→true edge or it becomes "when did you last touch this", which is a different
  and useless fact. It takes `now` as an argument, keeping the package's no-clock purity.
- [`SessionCard.tsx`](../apps/beigeboard/src/components/SessionCard.tsx) — every edit already
  routes through `logStep`, so the per-step stamps are free there. `started_at` is the one new
  write: first interaction with the card, once, never overwritten.
- ⚠️ [`routines.js`](../apps/beigeboard/backend/src/routines.js) — `occurrencesOf`'s `SELECT`
  is an **explicit column list**. A new column not added there reads `undefined` and the
  feature silently does nothing ([ROUTINES.md §10.5](ROUTINES.md); this already bit once, with
  `deload_override`).
- ⚠️ **This section was written when a hand-kept TypeScript mirror existed; D9 deleted it**
  (−871 lines) and `@jkos/routine-spec` is now the single source with a CommonJS face and an
  ESM twin. The old note here — "the mirror does not export `normalizePerformed`, so the
  conformance surface stays narrow" — described a duplication that is gone. Run
  `pnpm check:routine`, which now proves the two FACES agree rather than two implementations.

### What was actually built (2026-08-18)

Written, gate green, **not deployed**. Six files, all additive:

| File | Change |
|---|---|
| [`backend/src/db.js`](../apps/beigeboard/backend/src/db.js) | **Migration 13 `variance_instrumentation`** — the two columns + `items_stamp_completed` / `items_clear_completed`. Deliberately **not backfilled**: stamping existing completions from `updated_at` would manufacture a history that looks real and is wrong. INSERT is deliberately uncovered too — a row arriving already completed is a bulk import of someone's past, not a completion happening now. |
| [`backend/src/item-fields.js`](../apps/beigeboard/backend/src/item-fields.js) | `started_at` (`client: true`, cap 40) and `completed_at` (`client: false`) at the tail, before `created_at`/`updated_at`. |
| [`backend/src/schema.js`](../apps/beigeboard/backend/src/schema.js) | `looksLikeStamp` — `started_at` is the **only client-writable timestamp in the schema**, so it is the only one that can arrive malformed, and it gets a hard 400 at the door like `cadence_days`. |
| [`@jkos/routine-spec`](../packages/routine-spec/src/index.js) | `normalizePerformed` carries `at` (capped string) and `seq` (int, bounded **1–999, not `LIMITS.steps`** — un-logging and re-logging re-issues a higher number, and clamping at 40 would collapse the tail of a fiddly session into ties). |
| [`@jkos/routine-spec`](../packages/routine-spec/src/index.js) | `logStep` stamps on the `done` false→true edge and **clears on the way back down**, for the same reason the trigger clears. ⚠️ Listed as a separate file at the time — it was `src/lib/routine-spec.ts`, the mirror D9 deleted. |
| [`src/components/SessionCard.tsx`](../apps/beigeboard/src/components/SessionCard.tsx) | `started_at` written once, folded into the patch the interaction was already sending. |

Two things the plan above did not anticipate, both found in the code:

- ⚠️ **"All as prescribed" was a second author of the log.** It rebuilt `performed.steps`
  wholesale instead of going through `logStep`, which discarded any sets and notes already
  typed — and would have made it the one path producing completed steps with no `at` and no
  `seq`. It now folds through `logStep` per step. **Any future field added to a step entry has
  exactly one place to be added; check that button if you add one.**
- **The `occurrencesOf` trap does not bite here, and the doc had it half right.** There are
  *two* functions by that name. The narrow explicit-column one in
  [`routines.js`](../apps/beigeboard/backend/src/routines.js) is read by the **reconcile
  passes only**, and they do not touch these columns. The **analytics** one — in
  [`routes/routines.js`](../apps/beigeboard/backend/src/routes/routines.js), which is what
  `metricOf` and `seriesFor` are handed and therefore what §8 will build on — is `SELECT *`
  and picks the new columns up for free. Neither was changed. The trap is still real for any
  column the *engine* must read; it is not real for the analysis.

Coverage: 14 assertions in
[`routines.smoke.mjs`](../apps/beigeboard/backend/test/routines.smoke.mjs) §K (the trigger
fires through HTTP; a later edit does **not** move the stamp — the whole reason it is not
`updated_at`; retraction clears; a client cannot write it) and 9 in
[`test/routine-spec.mjs`](../test/routine-spec.mjs) §4f (the edge guard, and that the stamps
survive the engine normaliser — a mirror-writes/engine-reads contract, which is the exact
class of bug that gate exists for).

### Explicitly not in step 0

**Any analysis.** No queries, no rates, no UI. Step 0 starts the clock and stops. Building the
analysis against three weeks of data would produce a feature that correctly reports nothing
(§5), and the temptation to lower the observation floor to make it say something is exactly
the failure mode §8.2 exists to prevent.

---

## 4. Steps M1–M4 — the music project through the similarity gate

### Where it lives

A new top-level **`music/`**, following the [`jkos-deploy/`](../jkos-deploy/) precedent: its
own `requirements.txt`, its own `README.md`, **outside the pnpm workspace**
([`pnpm-workspace.yaml`](../pnpm-workspace.yaml) already records that the repo's Python pieces
have no `package.json` and are skipped automatically).

**Zero jkOS imports through M4.** The isolation is the deliverable, not an accident of
sequencing — it is what makes a wrong similarity result unambiguous.

> **Built as of 2026-08-18 (ToDo §8.1–§8.5):** `config.py`, `audio.py`, `scan.py`, `index.py`,
> `mel.py`, `ridge.py`, `descriptors.py`, `encoder.py`, `README.md`, `models/README.md`, the
> two-line `requirements.txt`, and **243** stdlib-`unittest` tests that run with no library mount
> and no model (audio fixtures are synthesised by the ffmpeg already required; the encoder checks
> skip cleanly). The §8.1 gate passed on a real library FLAC — decoded sample count vs. the
> container's own duration agreed to **0.0 ms** against a one-frame tolerance — **M2's gate passed
> in a browser** on four deliberately unalike tracks, **§8.4's sanity gate passed over 887 real
> tracks**, and **§8.5's verification passed 8/8**. Next is the backfill (ToDo §8.6).

### The dependency budget (decided 2026-08-18)

This is a portfolio project, so the dependency list is part of the deliverable.
`music/requirements.txt` is **exactly two lines and never gains a third** — `numpy` and
`onnxruntime` — plus the `ffmpeg` binary, already present. That covers decode, STFT, mel
filterbank, MFCC, descriptors, the SQLite index, cosine search, and PCA; only the encoder
forward pass needs the second line.

⚠️ **`torch` is excluded with no fallback.** If a model will not export cleanly to ONNX,
**change models** — do not take PyTorch as a runtime. Export tooling may run once in a throwaway
venv; that is a build tool, not a dependency. Also not taken, each replaced rather than merely
avoided: `librosa`/`soundfile` (ffmpeg decodes a FLAC in 0.13 s) · `sqlite-vec` (stdlib `sqlite3`
with a table *shaped* for it — see M3) · `pytest` (stdlib `unittest`) · `matplotlib` (SVG emitted
as text) · `sklearn`/`umap-learn` (`np.linalg.svd`).

The chunk-level breakdown lives in ToDo §8 (retired); it is not restated here.

### The representation decision

Raw waveform amplitude is close to useless for similarity: two masterings of one track have
different amplitude envelopes, and two unrelated songs at the same loudness look nearly
identical. A recommender built on time-domain amplitude tracks loudness and nothing else.

The pipeline starts from a **mel spectrogram** — a 128 × T matrix of frequency-band energy
over time. One artifact serves every purpose: it is the tensor for analysis, it is the
standard input to pretrained audio embedding models, and rendered as stacked rows it produces
a ridgeline where each row means something distinct.

> **Lossless source audio contributes nothing here.** Mel extraction downsamples to 22–24 kHz,
> discarding roughly what lossy compression discards. The library is lossless incidentally,
> not by requirement. Recorded so nobody re-derives it as a constraint.

### The library, measured

**15,326 FLAC files across 89 artist folders at `/mnt/Luna/Plex/Music`** (counted
2026-08-18; zero mp3/m4a/wav/ogg). That is materially larger than the "few thousand tracks"
the original scoping assumed, and it changes two things:

- **M3 is a multi-hour batch**, so it needs resume behaviour designed in, not bolted on.
- **Full-resolution mels are not storable.** ~5 MB per track × 15 k ≈ **75 GB**. See M3.

KourOS already catalogs the same tree into a `tracks` table keyed on absolute `path`
(UNIQUE) — see [`apps/kouros/backend/server.js`](../apps/kouros/backend/server.js), migration
`create_tracks`. **That is the join key for M5**, not a dependency for M1–M4: this project
walks the directory itself so it stays standalone, and keys its own index on the same absolute
path so the join is free later.

### M1 — mel extraction over one album

**ffmpeg subprocess → numpy, hand-rolled.** `decode()` shells out to ffmpeg
(`-f f32le -ac 1 -ar 22050`) and reads the raw stream with `np.frombuffer`; measured
end-to-end 2026-08-18, a 51.8 MB / 234.9 s FLAC decodes in **0.59 s wall — 88 MB/s, exactly
the CIFS ceiling**, which settles the question of whether decode is worth optimising: it is
already running at the speed of the wire (Trap 19); the transform itself
is frame → Hann → `np.fft.rfft` → power → a triangular mel filterbank built in numpy → log. A
128 × T float32 matrix per track, with **no audio library involved**. Save the matrices, load
them back, and **inspect the numbers** before building anything on them.

Writing the filterbank rather than importing it is deliberate: at this scale it is ~30 lines,
and it is the difference between demonstrating the transform and demonstrating a library call.

One config module holds sample rate, hop length, `n_mels`, and `n_fft`. Every later step reads
from it; nothing re-derives them. A windowing scheme that differs between extraction and
embedding is a silent, total corruption of the vector space.

### M2 — ridgeline render

Stacked rows, one image, so the data is confirmed visually before it is trusted. This is a
correctness check disguised as a picture — if the ridgeline does not look like music, stop.

> Charts in this repo go through the `dataviz` skill — load it before the first plotting call,
> not after.

**Built 2026-08-18 as `music/ridge.py`; the gate passed.** SVG emitted as text, so the renderer
is string formatting over the matrix `mel.py` already produces and the two-line dependency budget
is untouched. Four decisions are load-bearing, and each was a measurement rather than a
preference:

| Decision | Why |
|---|---|
| **One shared absolute level scale across every panel** | The single thing that decides whether the comparison means anything. Per-track normalisation rescales each picture to fill its own frame, so a solo piano track and a brickwalled metalcore track come out looking equally loud — which is exactly the comparison the picture exists to make. It is the **same mistake M3's descriptor z-score warns about**, one step earlier and in pixels. Enforced by API shape, not by discipline: the range belongs to a *sheet*, `Panel` carries none, and the auto-range function takes the whole list. |
| **A tall plot, panels side by side** | 128 rows is far more than a ridgeline normally carries (10–40 is the form). Below ~9 px of row pitch every row's excursion crosses two neighbours and the panel collapses into a uniform hatch — **a picture that reads as "the transform is broken" when the transform is fine and the picture is merely too small.** The most expensive available misreading of this step, avoided by geometry. |
| **Reduce the time axis by `max`, not `mean`** | ~10,000 frames against ~450 px. A kick drum is one loud frame in a bucket of quiet ones; the mean deletes it, and with it the beat grid. A full-length render aliases the beat away regardless (~1.5 px between hits), so the check needs **two** renders — full length for the arrangement, a ~16 s window for the grid. |
| **Sequential colour, one hue, on the frequency axis** | Band index is an *ordered* dimension, so its colour job is sequential — never a rainbow (the named anti-pattern: a multi-hue ramp invents an ordering the eye cannot rank). Ramps for both faces come from the suite's design factory and were validated with the `dataviz` ordinal checks; the checks that are computable from the hexes alone **re-run in the test suite**, so the palette cannot rot. |

The gate itself: SiM (metalcore), Kendrick Lamar (hip-hop), Matt Maltese (solo piano), Bo Burnham
(spoken-word stand-up), rendered together and read in a browser in both faces. Dense material
dense in every register; an unmistakable kick grid in the hip-hop bass rows with real silence
between hits; the ballad near-flat below 200 Hz with slow swells above it; the stand-up cut with
no bass content at all, sitting in a horizontal speech-formant band. All four §8.3 criteria met.

### M3 — pretrained embeddings into the vector store

One vector per track, pooled from windowed embeddings. **No training.** At this library size a
pretrained encoder beats anything trainable on this data by a wide margin, and cosine
nearest-neighbour needs no model at all. A classical descriptor baseline runs alongside for
comparison in M4.

**The baseline arm, built 2026-08-18 as `music/descriptors.py` (ToDo §8.4) — built BEFORE the
encoder on purpose.** M4 is a gate, and a gate needs something to weigh against; an arm built
after the thing it judges never gets built, and the gate quietly becomes a vibe check. 119
dimensions over the same STFT `mel.py` already computes, numpy only: MFCC mean/std and their
first differences (80), chroma mean/std (24), spectral centroid / bandwidth / rolloff /
flatness / ZCR / log-RMS mean and std (12), tempo (3). Measured over **887 real tracks across
82 albums and 39 artists**, the three categories form a clean ladder — same album **+0.4288**,
same artist other album **+0.1802**, different artist **+0.0005** — and 49.2% of nearest
neighbours share an album against **1.3% by chance**. The gate passes.

Two things are worth carrying forward from building it:

| | |
|---|---|
| **The z-score is across the corpus, not per track** | Per-track normalisation makes a bright track and a dark track both read "average brightness for themselves" and every distance collapses toward noise — no error, no NaN. Same mistake M2 guards against in pixels. Enforced by API shape again: there is no function that normalises one vector, `CorpusStats.fit` refuses fewer than 8 rows, and the fit lives in the index so a track added months later lands in the same space. **Vectors are stored RAW**; the fit is applied on the way out, so re-fitting after the library grows is free and total. |
| **Chroma has an arithmetic floor** | FFT bins are evenly spaced in Hz, semitones in *ratio*, so chroma can only resolve a note above the frequency where a semitone is wider than a bin — 181 Hz at the baseline profile. It is derived, not hardcoded, and it decides the next section. |

**The encoder, chosen and vendored 2026-08-18 as `music/encoder.py` (ToDo §8.5):**
[`Xenova/larger_clap_music_and_speech`](https://huggingface.co/Xenova/larger_clap_music_and_speech),
revision pinned to a commit, **512-d**. Chosen over PANNs/CNN14 and MERT for one reason that
outweighed the rest: it **ships `onnx/audio_model.onnx` already exported**, so no export was
run — no throwaway PyTorch venv, no opset arguments, and none of the class of failure where
the export ran but the graph is subtly not the model. `torch` is not installed, not imported,
not required; `requirements.txt` is still two lines. Provenance, checksum and the
preprocessing contract live in [`music/models/README.md`](../music/models/README.md).

#### ⚠️ Trap 16 bit here, and the answer was a profile axis rather than a flat swap

CLAP does not want M1's analysis parameters. It wants 48 kHz, 1024-sample windows, 480-sample
hops, **64 slaney mels** over 50–14000 Hz, and dB compression. M1's rule offered two ways out
— the model matches these values, or these values change to match the model — and the second
has a cost that only became visible with the numbers in hand:

> **CLAP's STFT makes the M3 baseline worse.** 1024 samples at 48 kHz is a 46.9 Hz frequency
> bin against 10.8 Hz at the baseline, which moves the chroma floor above from **181 Hz to
> 788 Hz — above most of the melodic range** — and 24 of the baseline's 119 dimensions stop
> measuring harmony. **M4 judges the encoder AGAINST the baseline, and its stop condition is
> "if the descriptors win, something upstream is broken."** Handicapping the opponent to suit
> the contender makes that gate easier to pass, which is precisely the wrong direction for the
> one check the whole project turns on.

So `config.py` holds **complete, named profiles**, one per vector space, each stamped onto its
own rows by its own signature, with `index.assert_config` enforcing drift **per table** rather
than per database. This is not the two-configurations corruption Trap 16 names — that is *one*
space built from two configurations, silently. Each space here has exactly one, declared in one
module. What is gone is only the assumption that there is exactly one encoder.

Three defences make the arrangement safe rather than merely intended, and each closes a hole
that was found while building it:

- **`using()` refuses to enter a different profile while one is active.** It swaps module
  globals, so it is process-wide, not thread-local — and M3b runs parallel decode workers. Two
  profiles in force at once would let one thread compute under A and another store it under B.
- **The baseline is frozen at import.** It used to be derived from the live globals, so *inside*
  the encoder context it returned a profile named "baseline" carrying the encoder's values and
  the encoder's signature — and the guard above compared two identical signatures and waved the
  switch through as harmless re-entry.
- **`embed_windows` refuses to run outside the encoder profile at all.** "Remember to enter the
  context" is a hope, not a defence, and the failure it prevents has no symptom.

#### Verifying an encoder you cannot diff against a reference

§8.5 asks that a fixed input give a stable output and that the vector be neither all-zero nor
NaN. Both hold — and both are necessary nowhere near sufficient, because a completely mis-fed
model returns stable, finite, unit-norm garbage all day. With no reference implementation
available (that would mean `torch`), three further checks each aim at how the mismatch would
actually show, and all three passed on the four M2 check-set tracks:

| Check | Why it catches a mis-fed model | Measured |
|---|---|---|
| **Spread** | A mis-scaled input drives a network toward a constant output, so unrelated tracks collapse onto one point | max off-diagonal cosine **+0.435** — genuinely spread |
| **Structure** | Two halves of one track must be closer to each other than any two different tracks | weakest self **+0.940** vs strongest cross **+0.435** |
| **Sensitivity** | The same audio through the *wrong* mel convention must differ materially, or matching it was untested luck | cosine **+0.491** to the correct vector |

That last row is the one that turns "we matched the convention" from a claim into a
measurement. **The easy way to get it wrong:** CLAP builds *two* filterbanks and picks between
them by truncation mode — htk/no-norm for `"fusion"`, slaney/slaney for `"rand_trunc"`. This
checkpoint declares `rand_trunc`, so it is the slaney pair, which is **not** torchaudio's
default and not what reaching for a library default gives.

**Persist embeddings only.** The vectors and a metadata index are tens of MB; mels become a
bounded LRU cache under `music/.cache/` for the tracks actually being inspected or rendered.
Recompute is per-track and cheap; 75 GB of matrices is not worth the pool space, and nothing
downstream reads a mel it cannot regenerate.

Four decisions worth fixing now because they are expensive to change later:

| Decision | Why |
|---|---|
| **Stdlib `sqlite3`**, table named **`local_vectors`** | `deployment.jag.json`'s `embedding` slot already declares `"table": "local_vectors"`. Matching the *name and shape* makes **L3.6 a lift, not a rewrite** — and costs nothing, because `sqlite-vec` itself is a dependency the budget does not take and (per the row below) buys no speed here. Float32 BLOBs, shaped for it. The descriptor baseline lives in a separate `descriptors` table so the port target stays pristine. |
| Index rows keyed on **absolute path** | Matches `tracks.path` (UNIQUE) in KourOS, so M5's join costs nothing. |
| Query with brute-force cosine in numpy | ⚠️ The "384-d ≈ 23 MB, fits in L3" figure was derived from `bge-small-en-v1.5` — the **text** model in LazurOS's embedding slot, not an audio encoder. **Settled 2026-08-18: the chosen encoder is 512-d, so the matrix is 15,326 × 512 float32 = 31 MB.** Brute force wins comfortably; reaching for an ANN index is optimising a problem you do not have. The L3 claim does not survive, but it never needed to. |
| Resumable by construction | State lives in the index, not in memory. A run that dies at track 9,000 restarts at 9,000. |

#### M3b — the backfill run (ToDo §8.6, `music/backfill.py`, 2026-08-18)

    tracks LEFT JOIN local_vectors → decode → 12 windows → mel → CLAP → mean-pool → L2
                                   → local_vectors, ONE COMMIT PER TRACK

**The window cap was the decision, and cosine was the wrong way to make it.** §8.5 left
`MAX_WINDOWS` at `None` for this step to pull with numbers in hand. The obvious measure —
cosine of the capped pool against the all-windows pool — answers *how far the vector moved*,
and M4 reads a **ranking**, not a vector. So the cap was measured over 71 tracks from 8
complete albums (the closest pairs in the library, and therefore the ranking most easily
disturbed) by whether the capped space returns the same neighbours:

| cap | NN agrees with uncapped | top-5 overlap | **NN shares an album** | cos to full pool | wall clock |
|---|---|---|---|---|---|
| 6 | 0.662 | 0.789 | **0.915** | 0.983 | ~1.6 h |
| 8 | 0.746 | 0.839 | **0.901** | 0.991 | ~2.2 h |
| **12** | **0.873** | **0.899** | **0.887** | **0.997** | **~3.6 h** |
| 16 | 0.873 | 0.952 | **0.887** | 0.999 | ~4.7 h |
| all (median 41) | 1.000 | 1.000 | **0.887** | 1.000 | ~15 h |

**The bolded column is the flat one.** How often the nearest neighbour shares an album — the
only column that says whether the answer is any *good* — does not degrade at any cap. What the
disagreements are is **tie-breaking**: album-mates sit at mean cosine **+0.868** against
**+0.443** for everything else, so "which album-mate ranks first" flips between two vectors
that are both defensible estimates of the same track. The uncapped pool is not ground truth;
it is simply the uncapped recipe. **12 chosen** — the smallest cap where agreement reaches its
plateau, at 4× the speed.

**The arrangement, with every number measured on this machine:**

| | |
|---|---|
| **The mel belongs to the readers, and that is a 33% win** | It costs **30 ms** per window against the model's **58 ms**. Computing it on the main thread adds a third to the wall clock while three reader threads sit blocked on the network. So `encoder.py` splits into `window_features` (decode-adjacent, numpy, parallel) and `embed_features` (one session, serial) — which also means the ONLY part of the backfill needing the weights is one function, and stubbing that one seam puts every line of the run under test with no model at all. |
| **Decode parallelism plateaus at 3** | Measured over 24 uncached tracks per setting: 1 worker **81 MB/s**, 2 → 107, 3 → 110, 4 → 109, 8 → 112. The share gives ~35% over a single stream and then nothing. Three readers supply ~4 tracks/s against a model that consumes ~1.4. |
| ⚠️ **What crosses the queue is a feature tensor, not a signal** | The library's longest file is a **two-hour, 545 MB FLAC that decodes to 1.4 GB** of float32. A bounded queue of decoded *signals* with several of those in flight is an OOM waiting to happen. The tensor is **3.1 MB** and bounded by the cap, so peak memory is a reader's transient decode buffer and nothing else. |
| **8 model threads, batch 4** | The thread sweep is 0.291 / 0.162 / 0.094 / **0.058** / 0.087 s per window at 1 / 2 / 4 / 8 / 16 — 8 is the physical core count and the hyperthread pairs past it contend. Batch size is nearly noise but not quite: 0.058 at 1 and 4, **0.066 at 8**, so a 12-window track fed as 8+4 is ~7% slower than as 4+4+4. Measured again end to end: **1.05 track/s at batch 8, 1.12 at batch 4.** |
| **One writer, one commit per track** | The sqlite connection is touched only by the main thread; WAL and `synchronous=NORMAL` make a commit per track cheap. Ctrl-C sets a stop flag, drains the readers and prints a summary — the index is consistent at every instant, and re-running resumes. |
| **`config.using(config.ENCODER)` wraps the WHOLE run, once** | The profile swaps *module globals*, so it is process-wide rather than thread-local. The readers must be inside one context, not each opening their own — which is exactly why `config.using` allows re-entering the same profile and refuses a different one. |

**A second alarm, one level up from Trap 16.** The config signature fingerprints how a mel is
*built*; it says nothing about **which mels a track's vector is the mean of** — the window
length, the overlap, the cap, the pooling rule, the model. Two vectors of one track pooled from
12 windows and from 41 sit at cosine ~0.997: not the "silent and total" corruption Trap 16
names, but still two recipes in one space and exactly the kind of difference nobody remembers a
year later. So `index.assert_recipe` stamps `encoder.recipe()` per table and refuses to *add*
under a different one, with the same escape hatch as the config alarm — clear the table, re-run.
It lives in `meta` rather than as a column because `local_vectors` is the shape LazurOS already
declares, and the port target stays pristine.

**Not taken, so it is not re-derived:** decoding only the seconds the 12 windows need, via
ffmpeg `-ss`/`-t`. It would be 12 subprocess spawns and 12 network seeks per track against ONE
whole-file read that already costs 0.38 s and is fully hidden behind the model — and a second
decode path whose sample alignment would have to be argued rather than observed.

### M4 — the gate

**Query the ten nearest tracks to something you know well, by hand, and read the list.**

> ⚠️ **Two ways the objective proxy lies, both found while §8.6 ran.** (a) **Exact duplicates**:
> ~20% of this library is a single that also appears on its album — AFI alone has four copies of
> one track — and at an early read **22.9% of tracks had an exact duplicate as their nearest
> neighbour**, which "shares an album" scores as a *miss* while it is the most correct answer
> possible (0.349 raw, **0.579** counting a duplicate as a hit). (b) **The two arms must be read
> over the SAME tracks**: §8.4's 49.2% came from 887 tracks chosen as complete albums spread over
> 39 artists, and a slice of the library by path order is ten artists and a different population.
> A useful side effect: two *differently encoded* FLACs of one song (30.6 MB and 31.0 MB)
> produced **bit-identical** vectors, which is the end-to-end determinism check nobody wrote.

If similarity is wrong, the cause is upstream — extraction, pooling, or normalisation — and
everything downstream is decoration built on a broken foundation. **Do not proceed past this
step on faith.** Compare against the classical baseline: if the descriptors do better than the
embeddings, something in the embedding path is wrong, because they should not.

Steps M1–M4 are the standalone deliverable and the point at which LazurOS work can begin in
parallel.

#### What the gate actually read (2026-08-19, `music/query.py`)

**The backfill was stopped deliberately at 1,506 tracks** — Jag's call, on the grounds that this
is not the final library — so M4 was read over what had been encoded rather than over 15,326.
Both arms were first brought onto that same population (`descriptors.py --build --encoded`,
1,411 tracks in ~9 min at 2.6 track/s), because §8.7's second proxy lie is precisely the one
that looks like nothing.

| over 1,506 tracks in **both** arms · 338 albums · 6 artists | NN album | credited | clean | NN artist | gap/σ |
|---|---|---|---|---|---|
| **neural (CLAP 512-d)** | **40.0%** | **72.2%** | **58.4%** | **94.2%** | **1.23** |
| descriptor (119-d) | 29.0% | 62.2% | 42.6% | 85.3% | 1.21 |
| *chance* | *0.9%* | — | — | *22.1%* | — |

The neural arm wins every criterion, decisively on ranking and by a whisker on separation. The
hand check agrees: an AFI live track returns six neighbours off the same live album where the
baseline breaks the run at rank 2 with a Bowling For Soup song; an Atwood live-session take
returns the rest of that session. **Gate passed. M5–M7 are unblocked.**

> ⚠️ **THE RAW COSINE GAP IS NOT A COMPARABLE STATISTIC, AND IT REVERSES THE VERDICT.** The first
> run of this gate reported the *baseline winning* on "album-mates minus strangers": descriptors
> +0.4125, neural +0.3161. Both numbers are correct and the comparison is meaningless. The
> descriptor space is z-scored across the corpus and therefore **centred** — strangers sit at
> −0.026 and it uses its whole range — while CLAP's space is a narrow **anisotropic cone** in
> which no two tracks in the library score below +0.03 and strangers average +0.475. Subtracting
> one mean from another measures how *wide* each space is, not how well either separates music,
> and the wider space wins by construction. Dividing by the stranger spread removes offset and
> scale together, and the standardised gap agrees with all three ranking measures. **A gate
> criterion that is not invariant to the shape of the space is not measuring the arms.**

> ⚠️ **THE SHELF IS NOT UNIFORMLY THREE LEVELS DEEP, AND THE COST WAS INVISIBLE.** 1,131 of the
> 15,326 files — 7.4%, every one a multi-disc release — sit at `<artist>/<album>/Disc N/<file>`.
> Read as `<artist>/<album>/<file>`, `Disc 1` becomes the album and **the album title becomes the
> artist**, so a deluxe edition is a different band from the record it is a deluxe edition of.
> The symptom is not an error: it is a same-artist rate a few points low for *both* arms at once,
> which is exactly what a comparison hides by depressing it evenly. It surfaced from a check
> written to audit something else — 184 nearest-neighbour pairs at cosine **1.00000** that the
> path claimed were different songs, every one of them `Crash Love` against
> `Crash Love (Deluxe)/Disc 1`. Folding disc directories into their parent moved the
> duplicate audit's agreement from **47.0% to 98.8%**, the artist rate from 78.0% to 94.2%, and
> the encoded population from "12 artists" to the 6 that actually exist.

> ⚠️ **The duplicate correction is read off the PATH, never off a cosine.** "Count a neighbour at
> cosine ≥ 0.999 as a hit" silently rigs the comparison: a 119-dimension z-scored space puts
> near-1 pairs within reach of two different masterings far more easily than a 512-d one does, so
> the coarser arm collects free hits from the measurement meant to judge it. `song_key()` reads
> the artist directory and the folded filename — the same evidence for both arms — and
> `duplicate_audit()` then checks that heuristic *against* the cosines instead of trusting it,
> which is what caught the disc bug above.

> ⚠️ **The wall-clock estimate M3b inherited was wrong, and M3b settled it.** Uncapped, one
> 10-second window costs 0.058 s of model time and the median track is 41 windows — **~15 hours**
> over 15,326 tracks, not the 1.5–3 h this step assumed. **This is the one stage where Trap 19
> does not apply: the model is the bottleneck, not the wire**, so parallel workers cannot rescue
> it and the only lever is how many windows a track gets. Capped at **12 evenly spaced windows**
> the run is **~3.6 h** and the neighbour lists do not measurably change — the table under M3b
> above is the measurement that decided it.

### What it demonstrates

A batch embedding pipeline, vector storage and similarity search, and a downstream
application, on **non-text data** — plus working knowledge of spectrograms, normalisation,
dimensionality reduction, and cosine similarity in a space that can be inspected directly,
which is the part most people consuming embeddings never look at. It does not demonstrate
model training, and that is the correct choice at this library size.

---

## 5. Step V — the completion-volume check

The variance feature is gated on accumulated history, not on code. **Go look at the number
before scheduling §8.**

The local dev DB (`apps/beigeboard/backend/beigeBoard.db`) is empty — 0 routines,
0 occurrences — so it answers nothing. The real number is on the host, under
`/mnt/Luna/Backends/{Production,Staging}/beigeboard-data/` (`ssh truenas_admin@192.168.1.108`,
docker group, no sudo). Read-only, against a copy:

```sql
-- occurrences completed, per routine
SELECT r.id, r.title,
       COUNT(*)                        AS completed_runs,
       MIN(o.completed_at)             AS first_run,
       MAX(o.completed_at)             AS last_run,
       julianday(MAX(o.completed_at)) - julianday(MIN(o.completed_at)) AS span_days
FROM   items o
JOIN   items r ON r.id = CAST(substr(o.ext_ref, 9, instr(substr(o.ext_ref,9), ':') - 1) AS INTEGER)
WHERE  o.ext_ref LIKE 'routine:%' AND o.completed = 1
GROUP  BY r.id
ORDER  BY completed_runs DESC;

-- and the per-step detail rate, which is what actually limits the analysis
SELECT COUNT(*)                                        AS completed,
       SUM(CASE WHEN performed IS NOT NULL THEN 1 END) AS with_a_log
FROM   items WHERE ext_ref LIKE 'routine:%' AND completed = 1;
```

`completed_at` is NULL for everything predating step 0 — that is expected and is the point:
the span you can analyse starts when migration 13 deployed, not when the routine was created.

### Read 2026-08-18, immediately after step 0 deployed

**Zero.** The staging database holds **0 rows with `completed = 1`** — not zero routine
occurrences, zero completed items of any kind — against 3 routine occurrences minted. So the
answer today is not "thin", it is "none", and `completed_at` is NULL everywhere because the
trigger has had no edge to fire on rather than because the migration is missing.

This is exactly the expected reading on day zero and it is the reason step 0 went first: the
span that can be analysed starts now. Re-read this number before scheduling §8, not before
scheduling L1 or L2, which are unaffected.

**The decision rule.** With only a few weeks of completions across a handful of routines, the
minimum-observations gate (§8.2) will correctly suppress nearly every finding and the feature
will report nothing. If the volume is thin, §8 is **deferred, not descoped** — step 0's
logging keeps running and the analysis gets built when there is something to analyse. L1 and
L2 are unaffected and proceed regardless.

---

## 6. Step L1 — LazurOS minimal bring-up

**Do not re-derive this.** [LAZUROS_STARTUP.md](LAZUROS_STARTUP.md) is verified against source
— every field name, port, env var, path, and command was read from the actual files — and it
is the runbook. This section is a **trim and an ordering**, not a replacement.

### Cut from the critical path

Whisper (`:8000`), Piper (`:5000`), and the DDGS sidecar (`:8001`) are **assistant features**.
The variance feature, the eval harness, the audit work, and tool calling need none of them.
LazurOS bring-up is Ollama plus the State node plus jkAuth enrolment — not seven services.

Recorded here so they are not re-added to the blocker list: they remain in
ToDo §1b (retired) as real work, they are simply not on this path.

> ⚠️ Tier 1 in the committed config *is* the web-search tier, so cutting the sidecar means
> tier 1 has no fulfiller. That is fine for this path — every capability the eval and variance
> work exercises targets `highest` or `lowest`, and `query` escalating into an unconfigured
> tier 1 is a bring-up-time observation, not a runtime surprise. Note it when it happens.

### Keep — in this order

1. **`prompts.json` + `models.json` authored** (per worker node). The top unblocker: no worker
   starts without them. ⚠️ **Placeholders are not free** — they must match the capability's
   declared body fields in [`backend/docs.js`](../apps/lazuros/backend/docs.js) exactly:
   `parse-task`→`{text}` · `breakdown-goal`→`{goal_text}` · `parse-document`→`{content}` ·
   `widget-generate`→`{description}` · `query`→`{text}`. `worker.py` renders
   `template.format(**payload)`, so a wrong name is a `KeyError` at render time and the job
   goes `FAILED`.
2. **Ollama on the Polaris GPU via Vulkan, not ROCm** (`/dev/dri` passed through). `ollama ps`
   must show the GPU. **If it shows CPU, tier 0 is fake.**
3. **`ollama pull bge-small-en-v1.5`** — the embedding slot's `baseUrl` is Ollama's own port
   and `createLocalEmbeddingProvider` POSTs to `/api/embeddings`. There is no separate
   embedding server to run.
4. **Emily MAC + static IP** into the three `TODO_EMILY_*` placeholders in
   `deployment.jag.json`, then `cp` to `deployment.json`. `computeBackend.js:34` hard-throws on
   a malformed MAC and a test asserts exactly that.
5. **jkAuth enrolment** — `JKOS_SERVICE_CLIENTS=lazuros:<secret>:beigeboard:write` **and**
   `JKOS_DELEGATION_CLIENTS=lazuros`. Both are required: delegation supplies only the *who*,
   and the client must separately hold the scope. Unset ⇒ **write-back silently cannot run.**

### The trap that costs an hour

**LazurOS is not a service in the staging stack.** It runs `network_mode: host` to broadcast
raw WoL packets, so there is exactly one State node per host and it owns port 8080; both edges
proxy to it. Consequently:

- `docker compose -f docker-compose.staging.yml up -d --build` **does not start it.**
- The `/deploy` console's **Deploy Staging** button does not either.
- Drive its own compose project directly during bring-up.
- ⚠️ **`deployment.json` must exist as a FILE before `up`** — otherwise Docker creates a
  *directory* with that name and the node dies reading it.

### Gate

Submit a capability from `https://staging.jkos.net/LazurOS` (admin-gated; the form is derived
from `/api/lazuros/capabilities`, so it always matches what the node actually serves) and watch
the job walk `PENDING → PENDING_WAKEUP → IN_PROGRESS → DONE`. It speaks the same public HTTP
contract any peer would, so a green run there is evidence about the real path.

---

## 7. Step L2 — prompt versioning, audit schema, eval harness

### 7.1 Prompt versioning — first, not last

`prompts.json` gains a version per capability, and the worker returns it with the result.

**This lands before the harness, not after.** Without versioning the eval numbers are not
reproducible across prompt changes, which makes them worthless — you cannot say whether a
score moved because the model changed, the prompt changed, or the fixtures did.

### 7.2 The audit schema

The `jobs` table today is `id, user_id, capability, tier_id, status, payload, step_data,
result, error, created_at, updated_at` ([`db.js`](../apps/lazuros/backend/db.js)). **Every
audit field is absent** — this is a build, not a read path over existing rows.

New migration adding: `prompt_version`, `model`, `node`, `tokens_in`, `tokens_out`,
`cost_usd`, `latency_ms`.

- **The write point is `setJobResult`** in [`lib/queue.js`](../apps/lazuros/backend/lib/queue.js)
  — one function. Every mutation there already bumps `updated_at`, and **that bump *is* the
  weave invalidation signal** (there is no imperative `invalidate()`), so the new columns ride
  the existing polled-resource contract for free.
- **Declare the new columns as filters on the `jobs` dataset** in
  [`docs.js`](../apps/lazuros/backend/docs.js). The read path is then a peer-visible contract
  that the prober checks, not a bespoke query that drifts.
- ⚠️ `db.js` currently creates the schema with a bare `CREATE TABLE IF NOT EXISTS` on require
  — there is no migration ledger like BeigeBoard's. Adding one is part of this step; do not
  extend the `CREATE TABLE` in place, because a deployed node already has the old table and
  `IF NOT EXISTS` will silently skip the new columns.

### 7.3 The audit read path

Given any committed record, reconstruct the full chain **in one query**: requesting user,
capability, prompt version, model, executing node, tokens, cost, latency, outcome, the
evidence retrieved, the confidence returned, the threshold in force *at the time*, and the
approver.

Most systems write audit rows and never query them, which is why theirs do not answer
anything. This one is built to answer an evidence request, and the read path is the
deliverable — not the columns.

### 7.4 The eval harness

A labelled fixture set per capability, scored on **extraction accuracy, schema validity,
latency, and cost**. Prompt version is recorded on every job (7.1), so results are comparable
across changes.

Follow the house pattern rather than inventing one — the `new-tester` skill covers the
boot-real-server smoke and the transpile-pure-logic unit test, and the checklist for chaining
into `pnpm test:contracts`. A harness that lives beside the gate instead of in it stops being
run.

### 7.5 The first real workload

Run the **music embedding backfill** through the audit path. It is a genuine batch with real
token, cost, and latency numbers across thousands of units — which is what 7.3 needs to be
exercised against, and what a synthetic fixture set cannot provide.

---

## 8. Step L3 — the variance feature

BeigeBoard's routine engine holds declared intent as per-step progression rules. Completion
records hold actual behaviour. Those are two independently generated records of the same
thing, and their divergence is invisible from either side alone. That is what makes this the
one reconciliation surface in the suite that earns its place.

**Gated on §5.** If the volume is thin, this is deferred.

### 8.1 Deterministic statistics, in SQL

Completion rate per step and per position, skip clustering, ordering violations, drift in
start time — all computed in SQL over the step-0 columns.

> ⚠️ **An LLM never touches this layer.** Given raw completion logs it will produce rates that
> are plausible and wrong, and a wrong rate is worse than no rate because it is actionable.

### 8.2 The minimum-observations gate

Findings below a statistical floor are **suppressed**, not shown with a caveat. Four skips out
of five runs is noise. Confidence is part of the materiality function alongside blast radius —
a low-confidence finding about a high-blast-radius change is not more publishable than a
low-confidence finding about a trivial one.

### 8.3 Proposals

The LLM's job is exactly one thing: **propose a revised bundle.** Reorder a step that only
fails in position four. Split a step that is consistently half-completed. Demote a chronically
skipped step to optional. Merge steps always done together.

Output is **`jkos.beigeboard.bundle` v1** — the format that already exists. Applied by the
existing importer at `POST /api/routines/bundle`
([`routes/routines.js`](../apps/beigeboard/backend/src/routes/routines.js)), which is already
idempotent by slug, validates the whole bundle before writing anything, and never half-applies.
**Nothing new is built on the BeigeBoard side.** `?dryRun=1` produces the diff.

⚠️ Two shape constraints the author must respect, both load-bearing:
`children: []` reads as a **leaf task**, not an empty goal · a routine may `ref` a library
entry the same bundle teaches, because entries land first.

### 8.4 Review gate

**Every proposal shows a visible diff. Nothing auto-applies.** Reuse the paste pane's idea of
rendering the first four sessions **as numbers** — a legal, plausible progression that has you
squatting 400 lb by November is only visible as rendered sessions, never as rules.

### 8.5 The design constraint

Stated deliberately, and not to be softened in implementation:

> **A system that reports how often you failed to follow your own plans becomes a guilt
> engine, and a guilt engine gets closed permanently.**

So: findings are framed as **defects in the routine's design**, not the user's character.
Every finding **leads with the proposed revision**, not the failure count. The tool proposes
routines that fit observed behaviour, and **never proposes tightening a routine the user is
already struggling to meet.**

This is a product requirement with a testable surface — a finding whose text names a count
before it names a revision is a bug.

### 8.6 Sub-task library deduplication

Semantic dedup of the reusable sub-task library via embeddings — **ported from M3**, not built
fresh. Target is the `library` table
([`library.js`](../apps/beigeboard/backend/src/library.js)), keyed `(user, collection, slug)`.

> ⚠️ **The slug is fixed once an entry exists.** Every `ref` in every routine points at it. A
> merge proposal must rewrite the referring routines and retire the loser; it must **never**
> rename an entry, which silently orphans every reference.

### 8.7 Correlation hypotheses

Retrieve calendar density and task load around skip dates and propose whether a skip tracks
something structural. The model **cites specific dates and asks for confirmation.** It never
asserts a cause it cannot know.

### 8.8 Cloud tier

Behind the spend ceiling, escalating **only on low confidence**. Last, and optional.

### Reported metrics

Proposal acceptance rate against a hand-labelled set of variance findings · false-finding rate
below the observation floor · cost and latency per capability per tier · accuracy-per-dollar
across the three tiers.

---

## 9. Steps M5–M7 — the rest of the music project

On no particular schedule. M1–M4 is the deliverable; these are what it was for.

**M5 — walking shuffle.** Rather than a random permutation, pick a start and repeatedly step
to a nearby unplayed track, so consecutive tracks are similar and the set drifts gradually. A
**temperature parameter** controls step distance — a dial from album coherence to real
variety. This is the feature that justifies the pipeline.

Joins to KourOS's `tracks` by absolute path (§4). The natural consumer is KourOS itself, and
its `MUSIC_DIR` mount is **no longer an unblocker** — the library is bind-mounted read-only at
`/music` in both compose files (`apps/kouros/docker-compose.yml`,
`apps/kouros/docker-compose.staging.yml`). What M5 still waits on is the shipped index, and
that is TODO.md §3, not a compose-file edit.

**M6 — the vibe space. BUILT 2026-09-16** (Jag's decisions that day, replacing the 2-D PCA
map). The library as a 3-D volumetric cloud you swipe through a 4th dimension, ENERGY, calm →
intense. The code is `music/mapbasis.py` (the fit), `apps/kouros/backend/src/discover/map.js`
(the projection and the wire) and `apps/kouros/src/components/vibespace/` (the cloud).

**The projection: an energy probe plus residual PCA, fitted once, stored in `meta`.** Over the
calibrated neural vectors (centred on `calib_mean`, re-normalised — exactly what KourOS loads):
`u` is a ridge regression onto the energy percentile rank (descriptor `logrms_mean`); `e1…e3`
are the top eigenvectors of the covariance with `u` projected out. `B = [e1, e2, e3, u]` is
orthonormal, so every map distance is a true projection distance. The cloud therefore shows
everything about the sound EXCEPT energy, and the swipe shows energy. Rejected, and why:
- **Plain PCA-4** — PC4 is the weakest axis, unnamed, and its order and sign flip as the
  library grows; a swipe through it would mean something different next month.
- **Energy as a raw descriptor column** — energy is not orthogonal to the rest of the sound,
  so it leaks into x/y/z and the slices drift ACROSS the cloud instead of cutting through it.
- **UMAP / t-SNE** — the dependency budget, no stable coordinate (a pin must mean the same place
  tomorrow), and no ordered 4th axis to swipe.
- **Runtime JavaScript PCA** (what the 2-D map did) — seconds per rebuild, run twice, drifting
  as tracks were added, with no provenance.

**Stored, keyed, verified.** `map_*:<arm>` beside `calib_*`, keyed by `map_calib` = sha256 of
`calib_mean` — a basis from before a calibration refit is STALE and refused, on both sides.
KourOS projects five golden tracks through the stored bytes and refuses the basis if any
coordinate differs from Python's by more than 1e-4 (measured cross-language on a 512-d synthetic
fit: 2.3e-8). Display units: xyz ÷ the p98 radius, clamped to the unit cube; w as a percentile
through a 1,001-point quantile table, so every stretch of the swipe passes through the same
number of tracks. "Near" is 4-D Euclidean on the raw coordinates.

**Two rules from the plan, measured wrong on the synthetic shelf and replaced before the first
real fit:**
- λ chosen as the argmax of held-out Spearman hopped grid points on a 90% refit and swung `u`
  by cos 0.91 → the LARGEST λ within 0.01 of the best (the one-standard-error rule's shape).
- An unnamed axis oriented by "largest loading positive" turned inside out (cos −0.998) when two
  loadings traded places → oriented by the sign of Σ loading³, which is continuous in the axis.

**The gate, pre-declared (thresholds confirmed by Jag before the first real fit).** It is part
of the fit, because the watcher refits unattended:

| # | Criterion | Threshold |
|---|---|---|
| G1 | recall@10 of the 512-d cosine neighbours inside the 4-D space, vs the same for PCA-4 (1,000 seeded queries) | ≥ 0.85× |
| G2 | held-out Spearman(w, energy) | ≥ 0.6 |
| G3 | median within-album IQR of the w percentile (albums ≥ 6 tracks) | ≤ 0.25 |
| G4 | refit on a seeded 90%: signed cos to the full fit | e1, u ≥ 0.95 · e2, e3 ≥ 0.90 |
| G5 | KourOS reproduces the golden coordinates | ≤ 1e-4 (enforced at load; smoke-tested) |
| G6 | `/discover/map` at 47,693 tracks, gzipped | ≤ 400 KB |
| G7 | continuity — see below | ≤ 0.02 |

Failure policy, fixed in advance: G1 fails but the anchored-rotation fallback (exactly PCA-4's
subspace, 4th axis = the probe's projection into it) passes → ship the fallback. Otherwise the
arm is HELD: `map_held:<arm>` records why, the rest of the index still ships, KourOS says
"held", and the rail decision goes back to Jag. Never an unnamed rail.

⚠️ **G6 failed as first built and was fixed before shipping:** Int16 xyz, Uint16 w and absolute
ids measured 529 KB gzipped at library size. The columns are incompressible by construction (w is
a uniform percentile), so the fix was quantisation to what a phone shows: id deltas, xyz as
11/11/10 bits in one Uint32 (~0.75 px even flown in), w in 12 bits, tone and flags sharing a
byte. `discover.smoke` drives the real encoder at 47,693 tracks and asserts the bound.

⚠️ **G7 was restated, and why — for Jag to confirm.** As first declared it read "max voxel change
between the interpolated fields at w and w + 1/256 ≤ 2% of ρ_ref". Measured, that is a property
of the DATA: the EXACT continuous field (each track's kernel centred at w itself) changes 7.05%
of ρ_ref per 1/256 on the gate's fixture, because cluster cores sit at ~3× ρ_ref. No faithful
renderer can pass it. What G7 exists to prove is that SLICING adds nothing — that the cloud
drawn at any w is the true field at w, so a swipe morphs rather than stepping or pulsing. It is
held as that: the opacity mixed from the two slices either side stays within 0.02 of the exact
field's opacity, at every slice-interval midpoint and the quarter points of every fourth.
Measuring it that way showed the plan's own claim was optimistic: at 32 slices (σ_w/2 apart) the
linear mix bowed 0.0193 off the true field (9.9% of ρ_ref in raw density) between slice centres
— a pulse on a fast swipe. At 48 slices it is 0.0073. `check:vibespace` measures it on the
production settings every run.

**The cloud.** Density is one Gaussian per MEASURED track, in space (trilinear splat + separable
blur, σ 1.25 voxels on a 48³ grid) and in w (σ_w 0.06), at 48 slices, built in a Web Worker.
⚠️ **ONE tone map for every slice**, α = 1 − exp(−ρ/ρ_ref) with ρ_ref the p99 over all slices —
the house's third instance of "never normalise per unit" after M2's value range and M7's shared
mesh scale: a sparse calm corner must look sparse, not blaze like the dense middle. ⚠️ Inferred
album centroids never feed the density — an album of uncovered tracks stacked on one point would
be a hot spot the size of an album. Colour is the density-weighted mean BRIGHTNESS through a
sequential ramp: one hue (the sleeve accent's, in OKLCH), ordered by lightness, anchor flipped
per face — never a rainbow over an ordered quantity. Rendering is hand-rolled WebGL2: a
raymarched volume at a reduced render scale mixing the two slices, particles whose size and
alpha are their glint exp(−(Δw/0.04)²), region labels as DOM. No library: three.js is ~600 KB
against a frontend with no 3-D dependency, and the math used is a perspective, a lookAt and a
multiply.

**Still owed:** the G1–G4 numbers from the first real fit (recorded here when
`music/analyze.py` reaches it), a look on a real phone (frame rate during a scrub, whether the
render scale settles), and "the path the current shuffle is taking through it" — M5's walk,
drawn as a ribbon through the cloud, which needs M5.

**M7 — the pulsarmap.** The mel matrix as a stack of ridgelines that ACCUMULATES as the track
plays: one line per ~93 ms slice (~10.8 a second), frequency across the line, energy as
elevation, new lines arriving in front of the ones already drawn. The Joy Division *Unknown Pleasures* form, revealed
in time rather than printed at once.

⚠️ **This section used to end "this is decoration and is documented as such; nothing may come to
depend on it." Overruled by Jag on 2026-09-03 — it is a named feature now.** The downgrade was
not wrong when written: it was aimed at a 3D heightmap of the *full* matrix, and that thing
genuinely is unrenderable. What changes is the artifact, not the verdict on the old one. See
BACKLOG.md → "Open — the pulsarmap (M7)" for the build order; what follows is what is DECIDED
and why the obvious alternative is wrong in each case.

**The size problem, which is the whole problem.** A four-minute track at `HOP = 512` is
~10,300 frames × 128 bands ≈ 1.3 M vertices, and ~5 MB of float32. That is the number that made
this decoration. It survives exactly one decimation and one quantisation:

| | |
|---|---|
| **Analysis matrix** | 10,300 × 128 float32 — **5.3 MB** |
| **Decimate time**, 4 frames → 1 row (`frames_per_row()`, ≈ 0.093 s at 22.05 kHz / hop 512) | 2,584 × 128 float32 — 1.3 MB |
| **Quantise to uint8** over the shared range | 2,584 × 128 — **330 KB**, ~280 KB gzipped |
| **On the wire**, base64 inside the ordinary JSON body | ~440 KB, **~310 KB gzipped** |

⚠️ **The row was 2 s until 2026-09-23 (86 frames, 15 KB a track). Jag: "a frame every second or
two … way too sparse to be anything useful. The pulsar frames should flow onto the screen at a
pretty consistent rate so that it can actually be a visualizer for the music."** Two-second rows
were a bar-scale envelope — below the beat by construction (see the `p75` bullet). At 0.093 s a
kick drum is its own row and the ridges arrive at a steady ~10.8 a second. Jag chose it over
~5 rows/s and over halving the bands, knowing the store grows from ~0.7 GiB to ~15 GiB for the
library. Still the music's own analysis, fetched whole per track: **no spectrum is computed in
the browser** (a Web Audio analyser would be a second mel implementation, would reroute the media
element through an AudioContext that a locked phone suspends, and would disagree with the stored
picture). The 2 s store was set aside as `music/meshes-2s.db`; the recipe (`row_secs` in
`mesh_recipe`) keeps the two from ever mixing.

**Three decisions, each against a plausible alternative:**

- **Fixed seconds-per-row, not a fixed row count.** A fixed row count makes the reveal rate a
  function of track length: a two-minute interlude would fill in ten times faster than a
  twenty-minute post-rock track, and the reveal would stop meaning "how far in are we". The cost
  is that row count varies with duration (a 20-minute track is ~12,900 rows, 1.6 MB), and that
  cost lands on the **renderer**, not the format — see the pitch note below.
- **Reduce each row by `p75`. Measured 2026-09-10, and the presumed answer was wrong.** M2
  chose `max` because reducing the time axis by `mean` deletes the beat grid — a kick drum is one
  loud frame in a bucket of quiet ones. That was measured over ~22-frame buckets and, as the
  warning here anticipated, **it does not transfer to 86.** Rendered four ways across M2's own
  four reference tracks (`python mesh.py --compare <file>`):

  | reduction | cells at the 255 ceiling | **sub-200 Hz cells at the ceiling** | band-to-band contrast (Δ/σ) |
  |---|---|---|---|
  | `max` | 4.8 – 10.7 % | **44 – 70 %** | 0.178 – 0.247 |
  | `p90` | 1.5 – 4.0 % | 2.6 – 40.5 % | 0.188 – 0.243 |
  | **`p75`** | **0.8 – 2.4 %** | **0.9 – 27.7 %** | **0.190 – 0.254** |
  | `mean` | 0.0 – 0.7 % | 0.1 – 8.2 % | 0.131 – 0.208 |

  ⚠️ **`max` saturates the bass, which is the register it was chosen to protect.** Between 44 %
  and 70 % of the sub-200 Hz cells pin at 255 — flat, carrying nothing. It is not reporting *the
  bass is loud*, it is reporting *something was loud at some instant in these two seconds*, and
  the stand-up cut proves it by saturating 44 % of a band the M2 sheet records as having no bass
  content at all. **Over a 2 s row the beat is below the sampling rate of the picture entirely**
  (a kick at 120 bpm is four hits per row), so the row axis is a bar-scale envelope and the
  reduction's job is no longer to catch a transient — it is to describe a window.

  `p75` does that with 3–12× less pinning than `max` **and** more band-to-band contrast on three
  of the four tracks, contrast being what makes a ridgeline read as a ridgeline rather than a
  smooth hump. `mean` pins least of all and contrasts least of all, visibly flattening whole rows.
  Recorded as `mesh.REDUCTION` and stamped into every stored mesh, so a later change cannot mix
  two kinds of picture in one store.

  **Re-measured at 4 frames a row, 2026-09-23 — `p75` still.** The argument above is about 86
  frames, so it was run again at 0.093 s on one track each from the same four artists (SiM,
  Kendrick Lamar, Matt Maltese, Bo Burnham), lowest 16 bands as the sub-200 Hz register:

  | reduction | cells at the ceiling | sub-200 Hz at the ceiling | row-to-row Δ (the beat) | band-to-band Δ |
  |---|---|---|---|---|
  | `max` | 0.6 – 2.5 % | 0.2 – 16.5 % | 13.2 – 18.8 | 9.8 – 12.6 |
  | `p90` | 0.4 – 2.2 % | 0.1 – 15.1 % | 13.2 – 18.9 | 9.6 – 12.5 |
  | **`p75`** | **0.3 – 1.9 %** | **0.1 – 13.4 %** | **13.6 – 19.4** | 9.7 – 12.7 |
  | `mean` | 0.1 – 1.4 % | 0.0 – 10.4 % | 12.2 – 17.3 | 9.4 – 12.5 |

  Over four frames the candidates converge (`max` pinned 45–55 % of the bass at 2 s; 12–17 % here),
  and `p75` carries the most row-to-row change of the four on every track — the beat, which is now
  inside the picture's sampling rate — with pinning within two points of `p90`.
- **One shared absolute value scale, never per-track.** `ridge.py`'s `VALUE_RANGE_LN = (-8.0, 10.0)`,
  measured across four deliberately unalike library tracks, is the quantisation range too. ⚠️
  **Per-track normalisation is the single thing that would make this picture meaningless** — a
  solo piano track and a brickwalled metalcore track would both fill their frame and read as
  equally loud. It is the same mistake M2 warns about and M3's descriptor z-score warns about,
  now a third time and in one byte. 18 ln units over 255 steps is 0.07 ln ≈ 0.31 dB per step,
  far below anything an eye resolves off a ridgeline.

**Where it is built: `music/`, because the transform has one home.** KourOS's image carries
ffmpeg (the scanner needs ffprobe), so decoding in the container is possible — but the mel
transform is not, and re-implementing it in JavaScript would create a second definition of the
one artifact the whole project is built on. That is Trap 16's shape even though it is not Trap 16
itself: a wrong JS mel does not corrupt the vector space, it just makes the picture disagree with
the analysis, and `VALUE_RANGE_LN` stops being a range anyone measured. ⚠️ **Read-only use of
`mel.py` / `config.py` / `audio.py` is safe for the paused backfill; editing any of them is not**
(RESET.md §0a). `mesh.py` imports them and changes nothing.

**Where it is stored: a sidecar, never `index.db`.** `index.db` holds 35,460 banked vectors and
`ship.py`'s `VACUUM INTO` invariant. A mesh table has no business in that file, and the reason is
not tidiness — it is that every operation on it is one more chance to be the operation that costs
four hours.

**Where the reveal comes from: `currentTime`, not a timer.** `row = floor(currentTime / rowSeconds)`,
read per animation frame from the audio element that is actually playing. ⚠️ A `setInterval`
counting seconds desynchronises on buffering, on seek, and on any playback-rate change — and
`packages/player` has a rate module, so rate changes are real here.

**Why the reveal direction is load-bearing.** Hidden-line removal is what makes the stack read as
depth: each line is drawn as an opaque filled path that occludes the lines behind it, painter's
algorithm, back to front. Combined with "new rows arrive in FRONT", that makes the canvas
**append-only** — a new row is one path drawn over a canvas that never has to be repainted, so
the steady-state cost of the reveal is one polyline every two seconds rather than a full redraw
at 60 Hz. ⚠️ **Reverse the direction and the optimisation is gone**: a row arriving *behind* the
stack has to be drawn first, which means repainting everything in front of it every time.

**In 3-D, too (2026-09-16, Jag: "a 3-D visual of the pulsar map").** The same mesh, stood up as
real geometry — `apps/kouros/src/components/ridges3d/` — replacing the 2-D strip, which survives
whole as the no-WebGL2 fallback. Decided that day: **ridgelines, not a lit terrain** (the line IS
the form); **replace, not toggle** (two renderers maintained forever); **the camera follows the
playhead, a drag orbits, a release springs home** (a whole-track orbit loses "how far in are we").
What carries over unchanged is everything above: the reveal is `rowsRevealed(currentTime)`, the
value scale is shared, the ramp is position-in-track, new rows arrive in FRONT. What 3-D changes:
- **The painter's algorithm becomes a depth buffer.** Each segment draws a curtain from its ridge
  to the floor in the surface colour, pushed back with polygon offset, then its line — exactly the
  fill-then-stroke occlusion the 2-D renderer fakes, now true from any angle.
- **The append-only optimisation is gone, and nothing is lost by it.** The mesh is one R8 texture
  (wrapped into columns past WebGL2's guaranteed 2,048 rows) and every vertex is derived in the
  shader from `gl_InstanceID`; a frame is two instanced draws over at most 44 rows, and a seek
  changes a uniform. A paused, settled view draws nothing at all.
- **Lines are screen-space quads**, because `gl.lineWidth` is one device pixel almost everywhere.
- ⚠️ **A fourth place per-track normalisation could enter** — the shader. `check:pulsarmap` scans
  `heightAt` for max/min/clamp/gain. (That scan was vacuous for its first commit: a raw backspace
  byte stood where `\b` belonged. `check:text` caught the byte.)

The old verdict against a 3-D heightmap stands for what it was aimed at: the FULL matrix is
1.3 M vertices. The decimated mesh is ~5,600 visible segments.

**The one number the renderer owns.** M2 measured that below **~9 px of row pitch** every line's
excursion crosses two neighbours and the stack collapses into a uniform hatch — "a picture that
reads as *the transform is broken* when the transform is fine and the picture is merely too
small." At 9 px, a 20-minute track's 600 rows are 5,400 px tall and do not fit anything. So the
mesh carries rows and a row duration and nothing about pixels; the renderer draws at a fixed
pitch onto an offscreen canvas that grows, and **pans** it so the newest row sits at a fixed
place. Constant reveal rate, constant legibility, the whole map still there to scroll back
through — and the append-only draw survives, which a "squash it all to fit" policy would not.

---

## 10. Traps

Consolidated so a cold agent hits none of them.

**BeigeBoard**
1. **ORDER IS CONTRACT** in `item-fields.js` — new columns extend the tail, never shift one.
2. **Migrations are append-only.** Migration 13 is a new entry, not an edit to 12.
3. **There are TWO `occurrencesOf`s.** The one in `routines.js` is an explicit column list
   read by the reconcile passes — a column omitted there reads `undefined` and the engine
   silently does nothing with it. The one in `routes/routines.js` is `SELECT *` and is what
   the analytics (`metricOf`, `seriesFor`, and §8) are handed. Know which you are in.
4. **`logStep` fires on every patch**, including note edits — the `at` stamp needs an edge
   guard or it records "last touched", not "completed". *(Handled; §3.)* And **the log has
   one author**: every step field goes through `logStep`, which `SessionCard`'s "all as
   prescribed" button used to bypass. Check it whenever a step entry gains a field.
5. **The library slug is immutable.** Renaming orphans every `ref`.
6. **`children: []` in a bundle reads as a leaf task**, not an empty goal.
7. **The UTC/local skew in RULE 1** and **sparse `earned`** — see [ROUTINES.md §4, §5](ROUTINES.md)
   before touching the engine.

**LazurOS**
8. **Not in the staging stack.** Neither the staging compose file nor the Deploy Staging button
   starts it.
9. **`deployment.json` must exist as a file** before `up`, or Docker creates a directory.
10. **The `/api/lazuros` prefix is PRESERVED at the edge** — alone among every peer block.
    "Fixing" it to match the others 404s everything, and the prober will fail you.
11. **RX 560 = Vulkan, not ROCm.** Polaris was dropped by ROCm. `ollama ps` showing CPU means
    tier 0 is fake.
12. **`prompts.json` placeholders are fixed by `docs.js`**, not free — a wrong name is a
    render-time `KeyError` and a `FAILED` job.
13. **`db.js` has no migration ledger** — a bare `CREATE TABLE IF NOT EXISTS` will silently
    skip new columns on a deployed node.
14. **There is no `LAZUROS_TOKEN`.** The only token is `LAZUROS_INTERNAL_TOKEN`, State node ↔
    worker, and `/internal` is LAN-only with nothing but that bearer in front of it.

**Music**
15. **Lossless buys nothing** below 22–24 kHz — do not build a requirement on it.
16. **Windowing config lives in one module.** Extraction and embedding disagreeing on it
    corrupts the space silently and totally. This bites hardest at M3a: the encoder's expected
    input must match `config.py`, or `config.py` changes to match the encoder — either way, one
    module. A model fed the wrong sample rate returns confident garbage.
17. **M3 must be resumable** from the first commit, not after the first 3-hour run dies.
18. **Do not reach for an ANN index.** Tens of MB of vectors is a brute-force problem.
19. **The library is on a CIFS mount** (`//192.168.1.108/Luna`), measured **85–96 MB/s**
    single-stream and **~110 MB/s with 3 readers** — it plateaus there, so a fourth reader buys
    nothing. ~380 GB of FLAC is ~75 min of pure read. Parallel decode workers feeding a *serial*
    encoder session; do not give both 16 threads. **Confirmed end-to-end 2026-08-18:** a real
    51.8 MB decode ran at **88 MB/s**, i.e. at the wire speed — the CPU side of decode is free.
    ⚠️ **But at M3b the model overtakes it** (0.058 s/window against a 0.38 s whole-track read),
    so from §8.6 on, the readers are the cheap half: give them the **mel** as well as the decode,
    and hand the serial session a feature tensor rather than a decoded signal — the library's
    longest file decodes to **1.4 GB**, and a queue of those is the OOM.
20. **Paths are hostile** — `again&again`, `Today's Lesson.flac`, `[16B-44.1kHz]`. **Never
    `shell=True`;** argv lists everywhere. This bit during the first probe of the library.

---

## 11. Verifying

Nothing in this document changes code, so the gate is unaffected by the document itself. Each
step carries its own check:

```bash
# Step 0  — all three green 2026-08-18 (routines.smoke 58 passed, full chain exit 0)
pnpm check:routine                                   # engine ↔ mirror conformance + the rules
pnpm --filter @jkos/beigeboard-backend test          # incl. routines + routine-spec smokes
pnpm test:contracts                                  # the full 24-link chain

# Steps M1–M7  (standalone — not on the jkOS gate by design)
# stdlib unittest, not pytest: pytest is a dependency the budget does not take
cd music && python -m unittest discover     # 59 tests green 2026-08-18 (§8.1)
# Runs with NO library mount: the audio fixtures are synthesised with ffmpeg, and the
# library-backed checks skip cleanly when /mnt/Luna is absent.

# Steps L1–L3
pnpm --filter @jkos/lazuros-backend test
pnpm prove --live https://staging.jkos.net --token <jwt>
node packages/suite-prober/roundtrip.mjs --live https://staging.jkos.net --token <jwt>
```

⚠️ **Green is not running.** Step 0's value is measured in calendar days of accumulated
history, and none accumulate until the staging image is rebuilt and a real completion writes a
real `completed_at`. Deploy it, then read §5's number — the gate is not the finish line here.

⚠️ **Never pin a literal date in a routine test** ([ROUTINES.md §10.4](ROUTINES.md)) — a
pinned `TODAY` becomes a time bomb the moment the clock passes it, and RULE 1's creation floor
then refuses every expected occurrence.
