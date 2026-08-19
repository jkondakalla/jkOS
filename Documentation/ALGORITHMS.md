# jkOS — Algorithms: LazurOS and the music vector space

> The work breakdown for the suite's two algorithmic projects. **If you are a fresh
> agent picking up either one, read this file first**, then the runbook it points at.
> When this disagrees with the code, the code wins — update this.

Related: **[ToDo §8](ToDo.md) is the music backlog** — the M1→M4 chunks, and the active section
as of 2026-08-18 · [ToDo §1](ToDo.md) is the LazurOS backlog ·
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
| **0** | BeigeBoard variance instrumentation (§3) | ✅ **BUILT + DEPLOYED 2026-08-18** — migration 13 verified applied on the live staging DB (ledger id 13, both columns, both triggers). Outstanding: one real completion to fire the trigger — the DB has **zero** completed items, so the 0→1 edge has not yet occurred. [ToDo §8.0](ToDo.md) |
| **M1–M4** | Music through the similarity gate (§4) — **chunked as [ToDo §8.1–8.7](ToDo.md)**. §8.1–§8.5 built 2026-08-18 (`music/`, 243 tests green; M2's picture gate, §8.4's sanity gate and §8.5's 8/8 verification all passed) | the ten nearest tracks to something you know well are *right* |
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
> in production. Completing one real routine step closes it; see [ToDo §8.0](ToDo.md) for the
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

- [`routine-spec.js`](../apps/beigeboard/backend/src/routine-spec.js) — `normalizePerformed`
  carries `at` (ISO string, cap it like the other strings) and `seq` (int) per step. Nothing
  else in the engine reads them; `stepWasMet` is unchanged.
- [`src/lib/routine-spec.ts`](../apps/beigeboard/src/lib/routine-spec.ts) — `logStep` stamps
  them. ⚠️ **`logStep` is called for every patch**, including note edits, so `at` must be
  guarded to the `done` false→true edge or it becomes "when did you last touch this", which is
  a different and useless fact.
- [`SessionCard.tsx`](../apps/beigeboard/src/components/SessionCard.tsx) — every edit already
  routes through `logStep`, so the per-step stamps are free there. `started_at` is the one new
  write: first interaction with the card, once, never overwritten.
- ⚠️ [`routines.js`](../apps/beigeboard/backend/src/routines.js) — `occurrencesOf`'s `SELECT`
  is an **explicit column list**. A new column not added there reads `undefined` and the
  feature silently does nothing ([ROUTINES.md §10.5](ROUTINES.md); this already bit once, with
  `deload_override`).
- The mirror does **not** export `normalizePerformed` — only `stepStatus` and `logStep` — so
  the engine↔mirror conformance surface stays narrow. Run `pnpm check:routine` anyway.

### What was actually built (2026-08-18)

Written, gate green, **not deployed**. Six files, all additive:

| File | Change |
|---|---|
| [`backend/src/db.js`](../apps/beigeboard/backend/src/db.js) | **Migration 13 `variance_instrumentation`** — the two columns + `items_stamp_completed` / `items_clear_completed`. Deliberately **not backfilled**: stamping existing completions from `updated_at` would manufacture a history that looks real and is wrong. INSERT is deliberately uncovered too — a row arriving already completed is a bulk import of someone's past, not a completion happening now. |
| [`backend/src/item-fields.js`](../apps/beigeboard/backend/src/item-fields.js) | `started_at` (`client: true`, cap 40) and `completed_at` (`client: false`) at the tail, before `created_at`/`updated_at`. |
| [`backend/src/schema.js`](../apps/beigeboard/backend/src/schema.js) | `looksLikeStamp` — `started_at` is the **only client-writable timestamp in the schema**, so it is the only one that can arrive malformed, and it gets a hard 400 at the door like `cadence_days`. |
| [`backend/src/routine-spec.js`](../apps/beigeboard/backend/src/routine-spec.js) | `normalizePerformed` carries `at` (capped string) and `seq` (int, bounded **1–999, not `LIMITS.steps`** — un-logging and re-logging re-issues a higher number, and clamping at 40 would collapse the tail of a fiddly session into ties). |
| [`src/lib/routine-spec.ts`](../apps/beigeboard/src/lib/routine-spec.ts) | `logStep` stamps on the `done` false→true edge and **clears on the way back down**, for the same reason the trigger clears. |
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

The chunk-level breakdown lives in [ToDo §8](ToDo.md); it is not restated here.

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

### M4 — the gate

**Query the ten nearest tracks to something you know well, by hand, and read the list.**

If similarity is wrong, the cause is upstream — extraction, pooling, or normalisation — and
everything downstream is decoration built on a broken foundation. **Do not proceed past this
step on faith.** Compare against the classical baseline: if the descriptors do better than the
embeddings, something in the embedding path is wrong, because they should not.

Steps M1–M4 are the standalone deliverable and the point at which LazurOS work can begin in
parallel.

> ⚠️ **Measured at §8.5, and it contradicts M3b's wall-clock estimate.** One 10-second window
> costs **0.084 s** on this machine with the ONNX session given 8 threads — and threads past 8
> buy nothing, so the model already saturates the CPU and parallel workers cannot rescue it.
> **This is the one stage where Trap 19 does not apply: the model is the bottleneck, not the
> wire.** A four-minute track at 50% overlap is 48 windows ≈ 4.0 s, which over 15,326 tracks is
> **~17 hours**, not the 1.5–3 h M3b assumes. The lever is a cap on windows per track, evenly
> spaced so the span still covers the whole track: 12 windows ≈ 4.3 h, 8 windows ≈ 2.9 h, and
> mean-pooling converges quickly enough that the cost is small. `encoder.MAX_WINDOWS` exists and
> is left at `None`, so this is a decision M3b makes with the numbers in hand rather than a
> default nobody chose.

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
[ToDo §1b](ToDo.md) as real work, they are simply not on this path.

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

Joins to KourOS's `tracks` by absolute path (§4). The natural consumer is KourOS itself, whose
`MUSIC_DIR` mount is still an open unblocker in [ToDo §3](ToDo.md) — worth landing before M5,
since it is a compose-file edit and a decision, not code.

**M6 — library map.** UMAP or PCA projection to 2D: where a track sits relative to the rest of
the library, and the path the current shuffle is taking through it.

**M7 — spectrogram surface.** The matrix as a 3D heightmap, time against frequency with energy
as elevation. Rendering resolution is a **heavy downsample** of the analysis matrix — a
four-minute track at a 512-sample hop is roughly 1.3 million vertices and a browser will not
render that. **This is decoration and is documented as such.** It is not analytically
load-bearing, and nothing may come to depend on it.

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
19. **The library is on a CIFS mount** (`//192.168.1.108/Luna`), measured **85–96 MB/s** —
    ~380 GB of FLAC is ~75 min of pure single-stream read. **The network filesystem is the
    bottleneck, not the FFT and not the model.** Parallel decode workers feeding a *serial*
    encoder session; do not give both 16 threads. **Confirmed end-to-end 2026-08-18:** a real
    51.8 MB decode ran at **88 MB/s**, i.e. at the wire speed — the CPU side of decode is free.
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
