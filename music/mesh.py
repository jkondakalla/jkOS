#!/usr/bin/env python3
"""M7 — the pulsarmap mesh: the analysis matrix reduced to something a browser
can hold, plus the sidecar store it lives in.

    (N_MELS, T) float32   ──decimate time──▶   (rows, N_MELS) float32
                          ──quantise────────▶   (rows, N_MELS) uint8

A four-minute track is ~10,300 frames × 128 bands — 1.3 M vertices, 5.3 MB of
float32. That number is what made this decoration for a year (ALGORITHMS.md §9).
It survives exactly one decimation and one quantisation: 4 frames become one row
(~93 ms at 22.05 kHz / hop 512 — ~10.8 rows a second, fast enough to show the
beat), and 18 ln units of level become one byte. 2,580 × 128 uint8 is **330 KB**,
~440 KB base64 inside an ordinary JSON body — still one fetch per track, and still
inside every contract the suite already enforces.

⚠️ **READ-ONLY USE OF THE PIPELINE.** This module imports `config`, `mel`,
`audio` and `ridge` and edits none of them. The backfill is paused mid-run
(CLAUDE.md) and an edit to any of those four silently invalidates the 35,460
vectors already banked. Nothing here writes to `index.db` either — the store
below is its own file for the same reason `ship.py` refuses to be a `cp`.

⚠️ **THE VALUE SCALE IS SHARED, NEVER PER TRACK.** The quantisation range is
`ridge.VALUE_RANGE_LN` — the same measured range M2's ridgelines are drawn
against — and it is asserted store-wide on every write. Per-track normalisation
is the one edit that makes this picture meaningless: a solo piano track and a
brickwalled metalcore track would both fill their byte range and read as equally
loud. It is the same mistake M2 names for its panels and M3 names for the
descriptor z-score, a third time and now in one byte.

⚠️ **EVERY MESH CARRIES `config.signature()`.** A mesh built under a different
`N_MELS` or `HOP` is not an error, it is a subtly wrong picture — different band
count, different seconds per row, no exception anywhere. `assert_config()` below
is the same mechanical defence `index.py` runs for vectors, one artifact along.

WHY THE BUILDER AND THE STORE SHARE A MODULE. `mel.py`/`index.py` split the
transform from the store because two vector arms, a resume ledger and a shipper
all touch that store. Here there is one artifact, one table and one consumer, and
splitting them would put `rel_key()` — which is the whole join, and the trap —
one import away from the only code that computes it.

    python mesh.py --track <file>          build one mesh, print its shape
    python mesh.py --compare <file>        render one track four ways (M7 block 2)
    python mesh.py --pending [N]           fill meshes for tracks that lack one
    python mesh.py --stats                 coverage, against index.db's tracks
    python mesh.py --ship --out <path>     VACUUM INTO a shippable snapshot
"""
import argparse
import os
import sqlite3
import sys
import time

import numpy as np

import config
import mel
import ridge

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'meshes.db')

SCHEMA_VERSION = 1

# ── The time decimation ─────────────────────────────────────────────────────────
# Seconds of audio per row. FIXED SECONDS, not a fixed row count: a fixed count
# would make the reveal rate a function of track length, so a two-minute
# interlude would fill in ten times faster than a twenty-minute post-rock track
# and "how far along the stack are we" would stop meaning "how far into the song
# are we". The cost is that row count varies with duration (a 20-minute track is
# ~12,900 rows, 1.6 MB), and that cost lands on the renderer — which draws a
# window of recent rows at a fixed pitch rather than squashing to fit.
#
# ⚠️ **0.1 s, NOT 2 s — JAG, 2026-09-23.** Two-second rows arrived one every two
# seconds, "way too sparse to be anything useful": the picture was a bar-scale
# envelope, below the beat. At ~10.8 rows a second the ridges flow onto the screen
# at a steady rate and a kick drum is its own row — a visualizer of the music, from
# the music's own analysis (no second spectrum in the browser). The store's recipe
# carries `row_secs`, so 2 s and 0.1 s meshes can never mix in one store.
ROW_SECONDS = 0.1


def frames_per_row():
    """Analysis frames reduced into one mesh row, under the configuration IN
    FORCE AT CALL TIME.

    ⚠️ A function, not a module constant, and deliberately so. `FRAMES_PER_ROW =
    round(ROW_SECONDS / config.frame_seconds())` at import freezes the baseline's
    86 before anything can enter `config.using(...)`, and this project has caught
    that exact default-evaluated-once defect three times already (`audio.decode`'s
    sample rate, `scan.iter_tracks`'s root, `index.connect`'s path). A mesh built
    at the wrong decimation is not an error, it is a picture whose time axis is
    silently wrong.

    At least 1: a configuration whose frame is longer than `ROW_SECONDS` gets one
    frame per row rather than a zero-width slice and a divide by zero.
    """
    return max(1, int(round(ROW_SECONDS / config.frame_seconds())))


def row_seconds():
    """Seconds each row actually covers — `frames_per_row()` frames' worth, not
    `ROW_SECONDS`.

    The two differ by the rounding above (1.997 s against 2.0 at the baseline),
    and the renderer's `row = floor(currentTime / rowSeconds)` accumulates that
    difference: 3 ms per row is a whole row of drift by minute ten. What ships in
    the mesh is therefore the derived value, never the target.
    """
    return frames_per_row() * config.frame_seconds()


# ── The reduction ───────────────────────────────────────────────────────────────
# How a row's frames become one. Every candidate is implemented rather than one
# being chosen in prose, because M2 established the method: render it and look.
#
# ⚠️ **RE-MEASURED AT 4 FRAMES A ROW, 2026-09-23: `p75` STILL.** At 0.1 s the four
# candidates converge — `max` pins 12–17% of the sub-200 Hz cells instead of 45–55%
# — and `p75` carries the most row-to-row change (the beat) of all four on SiM,
# Kendrick Lamar, Matt Maltese and Bo Burnham, with pinning within 2 points of
# `p90`. ALGORITHMS.md §9 has the table. The 2026-09-10 reasoning below was at 86.
#
# ⚠️ **MEASURED 2026-09-10, AND THE PRESUMED ANSWER WAS WRONG.** M2 chose `max`
# because `mean` deletes the beat over ~22-frame buckets, where a kick drum is one
# loud frame among quiet ones. That does not transfer to 86 frames, and it fails
# in exactly the way ALGORITHMS.md §9 warned it might: across the four M2
# reference tracks, `max` pins **44–70% of the sub-200 Hz cells at 255** — the
# register the kick lives in, flat. It is not reporting "the bass is loud", it is
# reporting "something was loud at some instant in these two seconds", which the
# stand-up cut proves by saturating 44% of a band it has no content in.
#
# `p75` carries the same picture with 3–12× less of that pinning AND more
# band-to-band contrast than `max` on three of the four tracks — contrast being
# what makes a ridgeline read as a ridgeline rather than a smooth hump. `mean`
# has the least pinning of all and the least contrast, visibly flattening whole
# rows. `python mesh.py --compare <file>` reproduces the table.
REDUCTIONS = {
    'max':  lambda block: block.max(axis=1),
    'mean': lambda block: block.mean(axis=1),
    'p90':  lambda block: np.percentile(block, 90.0, axis=1),
    'p75':  lambda block: np.percentile(block, 75.0, axis=1),
}

#: The reduction meshes are BUILT with. Stamped into every row, so changing it
#: cannot quietly mix two kinds of picture in one store.
REDUCTION = 'p75'

# One byte per value: 0…255 inclusive, so the span is 255 steps, not 256.
QUANT_MAX = 255


class MeshError(RuntimeError):
    """A mesh could not be built. The per-track catch, alongside
    `audio.DecodeError`, `descriptors.DescriptorError` and `encoder.EncoderError`."""


class MeshDriftError(RuntimeError):
    """The store already holds meshes built under different rules.

    Not a warning, and the same shape as `index.ConfigDriftError`: two meshes
    quantised against different value ranges, or reduced differently, or built at
    a different `N_MELS`, are pictures of different things. Mixed, they render
    without complaint and compare falsely — which is the whole reason the scale
    is shared in the first place.
    """


def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


# ── Build ───────────────────────────────────────────────────────────────────────
class Mesh:
    """One track's pulsarmap: `rows` × `n_mels` bytes, and everything needed to
    read them back.

    SELF-DESCRIBING ON PURPOSE, AND NOT AN INVITATION TO A PER-TRACK SCALE. The
    renderer dequantises, so it needs the range; carrying it per mesh means the
    wire format answers for itself rather than depending on a constant the
    browser has to be told separately. The store is what guarantees the value is
    the same for every row in it — `assert_config()` refuses a write whose range,
    reduction, band count or config signature differs from the ones already
    stored. Self-describing data, one enforced scale.
    """

    __slots__ = ('rows', 'row_seconds', 'value_range', 'reduction', 'config_sig', 'duration')

    def __init__(self, rows, row_seconds, value_range, reduction, config_sig, duration=None):
        self.rows = rows                      # (n_rows, n_mels) uint8
        self.row_seconds = float(row_seconds)
        self.value_range = (float(value_range[0]), float(value_range[1]))
        self.reduction = str(reduction)
        self.config_sig = str(config_sig)
        self.duration = None if duration is None else float(duration)

    @property
    def n_rows(self):
        return int(self.rows.shape[0])

    @property
    def n_mels(self):
        return int(self.rows.shape[1])

    def __repr__(self):
        return (f'Mesh({self.n_rows}×{self.n_mels} uint8, {self.row_seconds:.3f} s/row, '
                f'{self.reduction}, {self.config_sig})')

    def values(self):
        """The rows back in log-mel units — the inverse of the quantisation,
        within half a step. For tests and for `--compare`; nothing on the serving
        path needs it, because the browser does this itself."""
        return dequantise(self.rows, self.value_range)


def quantise(values, value_range=None):
    """log-mel units → uint8, against the SHARED range.

    18 ln units over 255 steps is 0.07 ln ≈ 0.31 dB per step — an order of
    magnitude below anything an eye resolves off a ridgeline, which is what makes
    one byte enough. Values outside the range CLIP rather than rescaling: that is
    the whole point of a shared scale, and it is why `VALUE_RANGE_LN`'s floor sits
    well above `mel.log_floor_value()` (digital silence would otherwise spend a
    third of the range).
    """
    lo, hi = value_range or ridge.default_value_range()
    if not hi > lo:
        raise ValueError(f'value range must be increasing, got ({lo}, {hi})')
    scaled = (np.asarray(values, dtype=np.float32) - lo) * (QUANT_MAX / (hi - lo))
    return np.clip(np.rint(scaled), 0, QUANT_MAX).astype(np.uint8)


def dequantise(codes, value_range=None):
    """uint8 → log-mel units. The exact inverse of `quantise` up to half a step."""
    lo, hi = value_range or ridge.default_value_range()
    return (lo + np.asarray(codes, dtype=np.float32) * ((hi - lo) / QUANT_MAX)).astype(np.float32)


def quant_step(value_range=None):
    """One byte's worth of level, in the units in force. The round-trip tolerance
    is half this."""
    lo, hi = value_range or ridge.default_value_range()
    return (hi - lo) / QUANT_MAX


def reduce_rows(matrix, reduction=None):
    """(n_mels, T) float32 → (n_rows, n_mels) float32, decimating the TIME axis.

    ⚠️ **A ROW IS A MOMENT IN TIME, NOT A FREQUENCY BAND.** The output is
    transposed relative to everything else in `music/`, and that is the decision
    the whole renderer rests on: rows arrive one per ~2 s as the track plays, in
    front of the ones already drawn, so the canvas is append-only and a reveal
    costs one polyline rather than a full repaint. One line per frequency band
    instead would mean every band's line spans the whole track and nothing can be
    revealed progressively at all.

    The final row is short whenever the track does not divide evenly, and is
    reduced over the frames it actually has — not zero-padded, which would put a
    fake silent tail on the end of every other track.
    """
    matrix = np.asarray(matrix, dtype=np.float32)
    if matrix.ndim != 2:
        raise ValueError(f'expected a (n_mels, T) matrix, got shape {matrix.shape}')
    n_mels, n_frames = matrix.shape
    if n_frames == 0:
        raise MeshError('the analysis matrix has no frames — there is no picture to build')

    name = reduction or REDUCTION
    try:
        fn = REDUCTIONS[name]
    except KeyError:
        raise ValueError(
            f'unknown reduction {name!r} — one of {sorted(REDUCTIONS)}') from None

    per_row = frames_per_row()
    n_rows = -(-n_frames // per_row)          # ceil, without importing math
    out = np.empty((n_rows, n_mels), dtype=np.float32)
    for r in range(n_rows):
        block = matrix[:, r * per_row:(r + 1) * per_row]
        out[r] = fn(block).astype(np.float32)
    return out


def build(logmel, reduction=None, duration=None):
    """The builder: a log-mel matrix → a `Mesh`.

    Takes the MATRIX rather than a path so the caller owns the decode. `mel.py`
    computes in blocks for a reason (`np.fft.rfft` upcasts float32 to complex128),
    and a builder that decoded internally would make it impossible to reuse a
    matrix that has already been computed for something else.
    """
    value_range = ridge.default_value_range()
    rows = reduce_rows(logmel, reduction)
    return Mesh(
        rows=quantise(rows, value_range),
        row_seconds=row_seconds(),
        value_range=value_range,
        reduction=reduction or REDUCTION,
        config_sig=config.signature(),
        duration=duration,
    )


def from_file(path, reduction=None):
    """Decode, transform, build. The convenience path for one track.

    `audio` is imported here rather than at module scope for the reason its own
    docstring gives: importing it for the first time inside a `config.using(...)`
    block would bind that profile's sample rate into a default argument. Lazy
    import keeps this module safe to import from anywhere.
    """
    import audio
    signal = audio.decode(path)
    duration = signal.size / float(config.SR)
    return build(mel.logmelspectrogram(signal), reduction, duration=duration)


# ── The join key ────────────────────────────────────────────────────────────────
# THE ONE TRAP IN THE STORE. The embedder walks `/mnt/Luna/Plex/Music/…` and
# KourOS's container sees `/music/…`; the two strings agree only BELOW the root
# segment. Store an absolute path here and every lookup KourOS makes misses, with
# no error — coverage simply reads 0% and looks like a fill that never ran.
#
# Deliberately the same rule as `relKeyFromEmbedderPath` in
# `apps/kouros/backend/src/discover/vectors.js` and as `ship.py`'s
# `root_coverage`: segment match, from the FILE END, case folded. A shipper that
# keys on something subtly different from what the reader looks up is a store
# that verifies clean and answers nothing.
DEFAULT_ROOT_NAME = 'music'


def rel_key(abs_path, root_name=DEFAULT_ROOT_NAME):
    """Everything below the LAST `root_name` segment, `/`-joined and lowercased.

        /mnt/Luna/Plex/Music/AFI - Black Sails/01. x.flac → afi - black sails/01. x.flac
        /music/AFI - Black Sails/01. x.flac               → the same string

    Returns None when the root does not appear as a segment at all — the honest
    answer, since without the root there is nothing to take a suffix from. A
    substring test would match `/mnt/Music-Archive/…` and key on garbage.
    """
    parts = [p for p in str(abs_path).replace('\\', '/').split('/') if p]
    want = str(root_name or '').lower()
    if not want:
        return None
    for i in range(len(parts) - 1, -1, -1):
        if parts[i].lower() == want:
            return '/'.join(parts[i + 1:]).lower() or None
    return None


# ── The store ───────────────────────────────────────────────────────────────────
# A SEPARATE FILE, never a table inside `index.db`. Not tidiness: `index.db` holds
# 35,460 banked vectors and `ship.py`'s snapshot invariant, and every operation on
# it is one more chance to be the operation that costs four hours (CLAUDE.md).
SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meshes (
  rel_key    TEXT    PRIMARY KEY,      -- root-relative, lowercased; see rel_key()
  n_rows     INTEGER NOT NULL,
  n_mels     INTEGER NOT NULL,
  row_secs   REAL    NOT NULL,
  value_lo   REAL    NOT NULL,
  value_hi   REAL    NOT NULL,
  reduction  TEXT    NOT NULL,
  config_sig TEXT    NOT NULL,
  duration   REAL,
  rows       BLOB    NOT NULL,         -- uint8, n_rows * n_mels bytes, row-major
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS failures (
  rel_key    TEXT    PRIMARY KEY,
  error      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
"""

BUSY_TIMEOUT_MS = 30000


def connect(path=None, timeout=BUSY_TIMEOUT_MS / 1000.0):
    """Open (creating if needed) the mesh store, with the schema applied.

    ⚠️ `path=None` means `DB_PATH` AS IT IS AT CALL TIME, for the reason
    `index.connect` spells out at length: `path=DB_PATH` in the signature captures
    the module constant at first import, so pointing `mesh.DB_PATH` at a scratch
    copy — the obvious way for a test to exercise this without touching the real
    store — silently writes to the real one instead.
    """
    conn = sqlite3.connect(DB_PATH if path is None else path, timeout=timeout)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute(f'PRAGMA busy_timeout={int(timeout * 1000)}')
    conn.executescript(SCHEMA)
    if get_meta(conn, 'schema_version') != str(SCHEMA_VERSION):
        set_meta(conn, 'schema_version', str(SCHEMA_VERSION))
        conn.commit()
    return conn


def set_meta(conn, key, value):
    conn.execute(
        'INSERT INTO meta(key, value) VALUES(?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        (key, str(value)),
    )


def get_meta(conn, key, default=None):
    row = conn.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row['value'] if row else default


def recipe_of(mesh):
    """The store-wide invariant, as one string: everything about a mesh that must
    be identical across the whole store for two of them to be pictures of the
    same thing.

    Row COUNT is absent, obviously — that is the track's length. `row_secs` is
    present because it is derived from `HOP`/`SR`, so two stores' rows would
    otherwise cover different amounts of time under the same signature.
    """
    return (f'config={mesh.config_sig};mels={mesh.n_mels};reduction={mesh.reduction};'
            f'row_secs={mesh.row_seconds:.6f};'
            f'range={mesh.value_range[0]:.4f}..{mesh.value_range[1]:.4f}')


def assert_config(conn, mesh):
    """Refuse to write a mesh built under different rules than the ones already
    stored. The same mechanical defence `index.assert_config` runs for vectors.

    An EMPTY store adopts whatever is in force — which keeps the legitimate path
    legal (change the reduction, clear the store, re-fill) and the silent one
    illegal (change the reduction and ADD to an existing set). Nothing about a
    mesh raises when it is mixed: a store holding both `max` and `p90` rows
    renders every one of them without complaint, and the picture simply stops
    being comparable to the picture beside it.
    """
    key = 'mesh_recipe'
    current = recipe_of(mesh)
    stored = get_meta(conn, key)
    if stored is None or stored == current:
        set_meta(conn, key, current)
        return current
    n = conn.execute('SELECT COUNT(*) AS n FROM meshes').fetchone()['n']
    if n:
        raise MeshDriftError(
            f'{n} mesh(es) in this store were built as {stored!r}, but this one is '
            f'{current!r}. Those are pictures of different things and nothing '
            f'downstream would say so (ALGORITHMS.md §9). Either restore the rules '
            f'they were built under, or clear the store and re-fill under the new ones.'
        )
    set_meta(conn, key, current)
    return current


def put(conn, key, mesh, commit=True):
    """Store one mesh under its root-relative key. Idempotent on the key."""
    if not key:
        raise ValueError('a mesh needs a root-relative key — see rel_key()')
    assert_config(conn, mesh)
    conn.execute(
        'INSERT INTO meshes(rel_key, n_rows, n_mels, row_secs, value_lo, value_hi, '
        '                   reduction, config_sig, duration, rows, created_at) '
        'VALUES(?,?,?,?,?,?,?,?,?,?,?) '
        'ON CONFLICT(rel_key) DO UPDATE SET '
        '  n_rows=excluded.n_rows, n_mels=excluded.n_mels, row_secs=excluded.row_secs, '
        '  value_lo=excluded.value_lo, value_hi=excluded.value_hi, '
        '  reduction=excluded.reduction, config_sig=excluded.config_sig, '
        '  duration=excluded.duration, rows=excluded.rows, created_at=excluded.created_at',
        (key, mesh.n_rows, mesh.n_mels, mesh.row_seconds,
         mesh.value_range[0], mesh.value_range[1], mesh.reduction, mesh.config_sig,
         mesh.duration, mesh.rows.tobytes(), _now()),
    )
    conn.execute('DELETE FROM failures WHERE rel_key=?', (key,))
    if commit:
        conn.commit()
    return key


def get(conn, key):
    """One mesh back, or None. Reshaped from the stored byte count rather than
    from a remembered one, so a truncated BLOB raises here instead of rendering
    as a picture with a wrapped time axis."""
    row = conn.execute('SELECT * FROM meshes WHERE rel_key=?', (key,)).fetchone()
    if row is None:
        return None
    want = row['n_rows'] * row['n_mels']
    blob = row['rows']
    if len(blob) != want:
        raise MeshError(
            f'{key!r} stores {len(blob)} bytes but declares {row["n_rows"]}×'
            f'{row["n_mels"]} = {want}')
    return Mesh(
        rows=np.frombuffer(blob, dtype=np.uint8).reshape(row['n_rows'], row['n_mels']),
        row_seconds=row['row_secs'],
        value_range=(row['value_lo'], row['value_hi']),
        reduction=row['reduction'],
        config_sig=row['config_sig'],
        duration=row['duration'],
    )


def record_failure(conn, key, error, commit=True):
    """A track that could not be meshed, kept so a later run can tell "not built
    yet" from "tried and could not" — the distinction `/discover/stats` exists to
    report, one artifact along."""
    conn.execute(
        'INSERT INTO failures(rel_key, error, updated_at) VALUES(?,?,?) '
        'ON CONFLICT(rel_key) DO UPDATE SET error=excluded.error, '
        'updated_at=excluded.updated_at',
        (key, str(error)[:500], _now()),
    )
    if commit:
        conn.commit()


def stats(conn):
    return {
        'meshes': conn.execute('SELECT COUNT(*) AS n FROM meshes').fetchone()['n'],
        'failures': conn.execute('SELECT COUNT(*) AS n FROM failures').fetchone()['n'],
        'bytes': conn.execute(
            'SELECT COALESCE(SUM(LENGTH(rows)), 0) AS n FROM meshes').fetchone()['n'],
        'recipe': get_meta(conn, 'mesh_recipe'),
    }


def check(conn):
    """Every way a mesh store can be wrong on arrival — the counterpart of
    `ship.check`, run against the SNAPSHOT rather than the live store. Returns
    `stats()`; raises `MeshError` on a store KourOS would read without complaint.

    KourOS's reader is built to degrade (a missing row is `pending`), so each of
    these would reach the pulsarmap as a picture that is quietly wrong rather
    than as an error: rows built under two recipes, a BLOB whose length disagrees
    with its declared shape (a wrapped time axis), or a torn file.
    """
    problems = []
    s = stats(conn)
    if not s['meshes']:
        problems.append('the store holds no meshes')
    if s['meshes'] and not s['recipe']:
        problems.append('no `mesh_recipe` in meta — nothing says what these pictures are')
    kinds = conn.execute(
        'SELECT COUNT(*) AS n FROM (SELECT DISTINCT n_mels, row_secs, value_lo, value_hi, '
        'reduction, config_sig FROM meshes)').fetchone()['n']
    if kinds > 1:
        problems.append(f'rows were built under {kinds} different recipes — pictures of '
                        f'different things in one store (ALGORITHMS.md §9)')
    torn = conn.execute(
        'SELECT COUNT(*) AS n FROM meshes WHERE LENGTH(rows) != n_rows * n_mels').fetchone()['n']
    if torn:
        problems.append(f'{torn} mesh(es) store a BLOB whose length is not rows × bands')
    verdict = conn.execute('PRAGMA quick_check').fetchone()[0]
    if verdict != 'ok':
        problems.append(f'PRAGMA quick_check: {verdict}')
    if problems:
        raise MeshError('this mesh store would be read without complaint and draw wrongly:\n  - '
                        + '\n  - '.join(problems))
    return s


def snapshot(src, dest):
    """A single fully-checkpointed file, atomically, from a live store.

    `VACUUM INTO`, never `cp` — identical reasoning to `ship.py`'s trap 1, and it
    applies here for the same mechanical reason: this store runs in WAL mode with
    a commit per mesh, so at any moment an arbitrary share of the rows lives in
    `meshes.db-wal`. A plain copy opens cleanly, reports a plausible count, and
    the missing meshes read as "the fill has not reached them".
    """
    os.makedirs(os.path.dirname(os.path.abspath(dest)) or '.', exist_ok=True)
    tmp = f'{dest}.partial'
    for stale in (tmp, f'{tmp}-wal', f'{tmp}-shm'):
        if os.path.exists(stale):
            os.remove(stale)
    conn = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
    try:
        conn.execute('VACUUM INTO ?', (tmp,))
    finally:
        conn.close()
    os.replace(tmp, dest)
    # A `VACUUM INTO` target has no sidecar; an OLD one left beside the
    # destination by a previous plain `cp` would be read IN PREFERENCE to the file
    # just written.
    for stale in (f'{dest}-wal', f'{dest}-shm'):
        if os.path.exists(stale):
            os.remove(stale)
    return dest


# ── Filling ─────────────────────────────────────────────────────────────────────
def pending(index_conn, store_conn, root_name=DEFAULT_ROOT_NAME, limit=None,
            retry_failed=False):
    """Tracks in the index that have no mesh yet, as `(abs_path, rel_key)` pairs.

    ⚠️ **WHAT THE PENDING LIST SHOULD BE DRIVEN BY IS AN OPEN QUESTION** — KourOS's
    `history` table, a frontend wanted-list, or top-N most played (the full run in
    `analyze.py` now meshes the whole library instead). This is the answer that needs no decision and no new surface: every
    indexed track, oldest first. It is the fill run, not the policy; a policy goes
    in front of it when there is one, and none of the code below changes.

    Rows whose path carries no root segment are skipped rather than keyed on
    garbage — the same refusal `ship.py --check` raises for the whole index.
    """
    have = {r[0] for r in store_conn.execute('SELECT rel_key FROM meshes')}
    if not retry_failed:
        have |= {r[0] for r in store_conn.execute('SELECT rel_key FROM failures')}
    out = []
    for (path,) in index_conn.execute('SELECT path FROM tracks ORDER BY id'):
        key = rel_key(path, root_name)
        if key is None or key in have:
            continue
        out.append((path, key))
        have.add(key)
        if limit is not None and len(out) >= limit:
            break
    return out


def fill(index_conn, store_conn, root_name=DEFAULT_ROOT_NAME, limit=None,
         reduction=None, stream=None):
    """Build and store meshes for pending tracks. Returns `(built, failed)`.

    One commit per mesh, and a per-track catch, for the same reasons §8.6's
    backfill has both: a fill that dies at 400 restarts at 400, and one unreadable
    FLAC out of 15,326 does not end the run. Failures are data.
    """
    out = stream or sys.stdout
    built = failed = 0
    for path, key in pending(index_conn, store_conn, root_name, limit):
        try:
            put(store_conn, key, from_file(path, reduction))
            built += 1
        except Exception as exc:                # noqa: BLE001 — failures are data
            record_failure(store_conn, key, f'{type(exc).__name__}: {exc}')
            failed += 1
            print(f'  failed {key}: {type(exc).__name__}: {exc}', file=out)
    return built, failed


# ── CLI ─────────────────────────────────────────────────────────────────────────
def _describe(mesh, out):
    raw = mesh.n_rows * mesh.n_mels
    print(f'{mesh.n_rows} rows × {mesh.n_mels} bands, {mesh.row_seconds:.3f} s/row '
          f'({mesh.reduction})', file=out)
    print(f'{raw / 1024:.1f} KB uint8, ~{raw * 4 / 3 / 1024:.1f} KB base64 on the wire',
          file=out)
    print(f'range {mesh.value_range[0]:.1f}…{mesh.value_range[1]:.1f} {config.LOG_MODE}, '
          f'step {quant_step(mesh.value_range):.3f}, config {mesh.config_sig}', file=out)
    codes = mesh.rows
    print(f'codes {int(codes.min())}…{int(codes.max())}, mean {codes.mean():.1f}, '
          f'{100.0 * float((codes >= QUANT_MAX).mean()):.2f}% at the ceiling, '
          f'{100.0 * float((codes <= 0).mean()):.2f}% at the floor', file=out)


def _compare(path, out):
    """M7 block 2: one track, four reductions, measured side by side.

    Ceiling occupancy is the number that decides it. `max` was the presumed
    answer *because* `mean` deletes the beat — but the warning against it is that
    over a ~2 s window (the 2026-09-10 row) nearly every bucket contains a kick, so the reduction
    chosen to preserve the beat may be the one that erases it by pinning the bass
    rows to 255. That is measurable and does not need an eye; contrast between
    adjacent rows is what an eye adds, and it is printed too.
    """
    import audio
    signal = audio.decode(path)
    matrix = mel.logmelspectrogram(signal)
    print(f'{os.path.basename(path)} — {signal.size / config.SR:.1f} s, '
          f'{matrix.shape[1]} frames, {frames_per_row()} frames/row', file=out)
    print(f'\n{"reduction":10} {"ceiling%":>9} {"floor%":>8} {"mean":>7} {"p99":>7} '
          f'{"row Δ":>7} {"band Δ":>7}', file=out)
    for name in ('max', 'p90', 'p75', 'mean'):
        rows = quantise(reduce_rows(matrix, name)).astype(np.float32)
        ceiling = 100.0 * float((rows >= QUANT_MAX).mean())
        floor = 100.0 * float((rows <= 0).mean())
        # Row-to-row change is the beat: how much one slice differs from the
        # next. Band-to-band change is the shape within a slice — the thing that
        # makes a ridgeline read as a ridgeline rather than a smooth hump.
        row_delta = float(np.abs(np.diff(rows, axis=0)).mean()) if rows.shape[0] > 1 else 0.0
        band_delta = float(np.abs(np.diff(rows, axis=1)).mean())
        print(f'{name:10} {ceiling:8.2f}% {floor:7.2f}% {rows.mean():7.1f} '
              f'{np.percentile(rows, 99):7.1f} {row_delta:7.2f} {band_delta:7.2f}', file=out)


def _main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--track', help='build one mesh from an audio file and describe it')
    parser.add_argument('--compare', help='render one track four ways (M7 block 2)')
    parser.add_argument('--pending', nargs='?', type=int, const=0, default=None,
                        metavar='N', help='fill up to N pending meshes (0 = all)')
    parser.add_argument('--stats', action='store_true', help='store coverage')
    parser.add_argument('--ship', action='store_true', help='VACUUM INTO a snapshot')
    parser.add_argument('--out', default=None, help='where --ship writes')
    parser.add_argument('--reduction', default=None, choices=sorted(REDUCTIONS),
                        help=f'override the built-in reduction (default {REDUCTION!r})')
    parser.add_argument('--root-name', default=DEFAULT_ROOT_NAME,
                        help=f'library root segment (default {DEFAULT_ROOT_NAME!r})')
    parser.add_argument('--db', default=None, help=f'mesh store (default {DB_PATH})')
    args = parser.parse_args(argv)

    if args.compare:
        _compare(args.compare, sys.stdout)
        return 0

    if args.track:
        _describe(from_file(args.track, args.reduction), sys.stdout)
        return 0

    store_path = args.db or DB_PATH

    if args.ship:
        if not os.path.exists(store_path):
            print(f'no mesh store at {store_path}', file=sys.stderr)
            return 1
        dest = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        'out', 'meshes.db')
        snapshot(store_path, dest)
        print(f'{store_path} -> {dest}  ({os.path.getsize(dest) / 1e6:.1f} MB, no sidecar)')
        return 0

    if args.stats or args.pending is not None:
        import index
        store = connect(store_path)
        idx = index.connect()
        if args.pending is not None:
            limit = args.pending or None
            todo = pending(idx, store, args.root_name, limit)
            print(f'{len(todo)} pending')
            import runlock
            try:
                with runlock.hold('mesh.py --pending'):
                    built, failed = fill(idx, store, args.root_name, limit, args.reduction)
            except runlock.Busy as exc:
                print(f'Busy: {exc}', file=sys.stderr)
                return 1
            print(f'built {built}, failed {failed}')
        s = stats(store)
        total = idx.execute('SELECT COUNT(*) AS n FROM tracks').fetchone()['n']
        print(f'meshes   : {s["meshes"]} / {total} tracks '
              f'({100.0 * s["meshes"] / max(1, total):.1f}%)')
        print(f'failures : {s["failures"]}')
        print(f'size     : {s["bytes"] / 1e6:.1f} MB of rows')
        print(f'recipe   : {s["recipe"]}')
        return 0

    parser.print_help()
    return 0


if __name__ == '__main__':
    raise SystemExit(_main())
