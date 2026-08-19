#!/usr/bin/env python3
"""The vector store: stdlib `sqlite3`, float32 BLOBs, `music/index.db`.

No `sqlite-vec`. ALGORITHMS.md §4 already records why: it is a port target, not
a speed need. 15,326 vectors is tens of megabytes and one matmul (Trap 18), so
the extension would buy nothing and cost a line of the dependency budget. What
matters instead is the SHAPE — `local_vectors` is the table name
`apps/lazuros/deployment.jag.json`'s embedding slot already declares, so
LazurOS L3.6 (sub-task library dedup) becomes a lift rather than a rewrite.

Three tables carry the pipeline, plus one that carries its bookkeeping:

  tracks         the scan, AND the resume ledger. §8.6 must be resumable from
                 its first commit, not after the first multi-hour run dies
                 (Trap 17) — so the ledger is not a sidecar file that can go out
                 of sync with the index, it IS the index. `pending()` is a LEFT
                 JOIN; a run that dies at 9,000 restarts at 9,000 because the
                 9,000 rows are already there.
  local_vectors  the neural arm. The port target — kept pristine.
  descriptors    the classical arm (§8.4). Separate table on purpose: M4 judges
                 the encoder AGAINST this baseline, and mixing the two into one
                 table would make the thing being judged and the judge share a
                 schema.
  meta           key/value bookkeeping — see the note below.

⚠️ TWO DELIBERATE ADDITIONS beyond the four columns ToDo §8.1 names, both here
to make a named trap non-silent rather than to be clever:

  1. The `meta` table (a fourth table where §8.1 says three). §8.4 requires the
     corpus mean/std to live in the index — "z-score across the corpus, not per
     track" needs one home a new track can normalise against months later — and
     the config signature below needs one too. Both are single scalars, not
     entities; giving each its own table would be worse. §8.4 would have had to
     add this anyway.
  2. `config_sig` on every vector row, and `assert_config()` on the write path.
     This is the mechanical defence for Trap 16. Without it, editing config.py
     at §8.5 and re-running the backfill mixes vectors computed under two
     different analysis configurations into one table, and the result is a space
     that is subtly wrong with no symptom at all — the failure mode ALGORITHMS.md
     describes as "silent and total". With it, the second write raises.
"""
import os
import sqlite3
import time

import numpy as np

import config

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.db')

SCHEMA_VERSION = 1

# Row states for `tracks.status`. `pending` is the scan's output; the backfill
# moves a row to `ok` or `failed`. A `failed` row keeps its error text so a
# post-run triage reads the index instead of scrollback from a run that ended
# hours ago.
PENDING, OK, FAILED = 'pending', 'ok', 'failed'

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id         INTEGER PRIMARY KEY,
  path       TEXT    NOT NULL UNIQUE,   -- absolute; matches KourOS tracks.path
  mtime      REAL,
  size       INTEGER,
  duration   REAL,                      -- filled in when the file is first decoded
  status     TEXT    NOT NULL DEFAULT 'pending',
  error      TEXT,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS tracks_status ON tracks(status);

CREATE TABLE IF NOT EXISTS local_vectors (
  track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  model      TEXT    NOT NULL,
  revision   TEXT,
  dim        INTEGER NOT NULL,
  vector     BLOB    NOT NULL,          -- float32, little-endian, dim * 4 bytes
  config_sig TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS descriptors (
  track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB    NOT NULL,
  config_sig TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
"""

VECTOR_TABLES = ('local_vectors', 'descriptors')


class ConfigDriftError(RuntimeError):
    """config.py changed while vectors computed under the old values still exist.

    Not a warning. Vectors from two different analysis configurations are not
    comparable, and a similarity search across both returns a plausible,
    confidently wrong answer — which is the entire failure mode Trap 16 names.
    """


def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


# ── Connection ──────────────────────────────────────────────────────────────────
def connect(path=DB_PATH):
    """Open (creating if needed) the index, with the schema applied.

    WAL is on because §8.6 commits per track across a multi-hour run and must be
    Ctrl-C safe at any point; `synchronous=NORMAL` under WAL keeps that cheap
    without risking corruption on process death (only on host power loss, which
    would cost one track). `foreign_keys` is ON so deleting a track takes its
    vectors with it — off is sqlite's default and silently leaves orphans.
    """
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.executescript(SCHEMA)
    set_meta(conn, 'schema_version', str(SCHEMA_VERSION))
    conn.commit()
    return conn


# ── meta ────────────────────────────────────────────────────────────────────────
def set_meta(conn, key, value):
    conn.execute(
        'INSERT INTO meta(key, value) VALUES(?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        (key, str(value)),
    )


def get_meta(conn, key, default=None):
    row = conn.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row['value'] if row else default


# ── The Trap 16 alarm ───────────────────────────────────────────────────────────
def count_vectors(conn):
    return sum(
        conn.execute(f'SELECT COUNT(*) AS n FROM {t}').fetchone()['n']
        for t in VECTOR_TABLES
    )


def assert_config(conn, table):
    """Refuse to write vectors into `table` under a configuration that does not
    match the ones already stored THERE.

    The first vector written to a table stamps that table's signature. Every
    later write to it checks it. An empty table adopts whatever is in force —
    which is what makes §8.5's legitimate path legal: change the profile, clear
    the table, re-run. What is not legal is changing the profile and ADDING to an
    existing set, and that is exactly the edit that has no symptom without this.

    ⚠️ **PER TABLE, not per database** (changed at §8.5). The two arms are two
    independent vector spaces judged against each other at M4, and they now
    analyse under different profiles on purpose — CLAP's 48 kHz / 64-mel STFT
    would move the baseline's chroma floor from 181 Hz to 788 Hz and weaken the
    very opponent M4 needs (see config.py's profile note). One shared key would
    make that legitimate arrangement raise, and the obvious way to silence it
    would be to delete the check. The invariant Trap 16 actually names — every
    vector in ONE space computed under ONE configuration — is unchanged and now
    stated where it is true.
    """
    if table not in VECTOR_TABLES:
        raise ValueError(f'unknown vector table: {table!r}')
    key = f'config_sig:{table}'
    current = config.signature()
    stored = get_meta(conn, key)

    if stored is None:
        # Adopt the pre-§8.5 single key for a table that already has rows, so an
        # index built before profiles existed keeps its alarm rather than
        # silently re-arming against whatever runs next.
        legacy = get_meta(conn, 'config_sig')
        n_here = conn.execute(f'SELECT COUNT(*) AS n FROM {table}').fetchone()['n']
        stored = legacy if (legacy and n_here) else None
        if stored is not None:
            set_meta(conn, key, stored)

    if stored is None:
        set_meta(conn, key, current)
        return current
    if stored != current:
        n = conn.execute(f'SELECT COUNT(*) AS n FROM {table}').fetchone()['n']
        if n:
            raise ConfigDriftError(
                f'the analysis configuration in force is {current} but {n} vector(s) '
                f'in {table} were computed under {stored}. Those vectors are not '
                f'comparable to anything computed now (ALGORITHMS.md Trap 16). Either '
                f'restore the profile they were built under, or clear {table} and '
                f're-run under the new one.'
            )
        set_meta(conn, key, current)
    return current


# ── tracks ──────────────────────────────────────────────────────────────────────
def upsert_track(conn, path, mtime=None, size=None):
    """Record a scanned file, returning its row id. Idempotent on `path`.

    A re-scan of an unchanged library is a no-op that preserves every row's
    status, so the resume ledger survives it. A file whose `mtime` or `size`
    moved is reset to `pending` and its vectors dropped: the bytes changed, so
    whatever was computed from them describes a file that no longer exists.
    """
    row = conn.execute(
        'SELECT id, mtime, size FROM tracks WHERE path=?', (path,)
    ).fetchone()
    if row is None:
        cur = conn.execute(
            'INSERT INTO tracks(path, mtime, size, status, updated_at) VALUES(?,?,?,?,?)',
            (path, mtime, size, PENDING, _now()),
        )
        return cur.lastrowid

    changed = (row['mtime'] != mtime) or (row['size'] != size)
    if changed:
        conn.execute(
            'UPDATE tracks SET mtime=?, size=?, duration=NULL, status=?, error=NULL, '
            'updated_at=? WHERE id=?',
            (mtime, size, PENDING, _now(), row['id']),
        )
        for table in VECTOR_TABLES:
            conn.execute(f'DELETE FROM {table} WHERE track_id=?', (row['id'],))
    return row['id']


def mark_ok(conn, track_id, duration=None):
    conn.execute(
        'UPDATE tracks SET status=?, error=NULL, duration=COALESCE(?, duration), '
        'updated_at=? WHERE id=?',
        (OK, duration, _now(), track_id),
    )


def mark_failed(conn, track_id, error):
    """One bad file marks its own row and the batch continues (§8.6)."""
    conn.execute(
        'UPDATE tracks SET status=?, error=?, updated_at=? WHERE id=?',
        (FAILED, str(error)[:1000], _now(), track_id),
    )


def track_by_path(conn, path):
    return conn.execute('SELECT * FROM tracks WHERE path=?', (path,)).fetchone()


def pending(conn, table='local_vectors', limit=None, artist=None, retry_failed=False):
    """Tracks with no row in `table` yet — the resume query.

    This is what makes §8.6 resumable by construction rather than by bookkeeping:
    progress is not a counter anyone has to remember to write, it is the absence
    of a join partner. Kill the run at track 9,000 and the next invocation asks
    the same question and gets the remaining 6,326.

    `artist` filters on a path fragment, backing §8.6's `--artist NAME` flag —
    a design requirement, not a convenience, because a full 15,000-track run is
    not an acceptable way to test a change.

    Failed rows are excluded by default so one unreadable file is not retried on
    every subsequent run; `retry_failed=True` is the deliberate second attempt.
    """
    if table not in VECTOR_TABLES:
        raise ValueError(f'unknown vector table: {table!r}')
    sql = [
        f'SELECT t.* FROM tracks t LEFT JOIN {table} v ON v.track_id = t.id',
        'WHERE v.track_id IS NULL',
    ]
    args = []
    if not retry_failed:
        sql.append('AND t.status != ?')
        args.append(FAILED)
    if artist:
        sql.append('AND t.path LIKE ?')
        args.append(f'%{artist}%')
    sql.append('ORDER BY t.id')
    if limit:
        sql.append('LIMIT ?')
        args.append(int(limit))
    return conn.execute(' '.join(sql), args).fetchall()


# ── vectors ─────────────────────────────────────────────────────────────────────
def to_blob(vec):
    """A 1-D float32 vector as bytes.

    The float32 check is not defensive style, it is the one guard that matters:
    numpy defaults to float64, so `np.mean(windows, axis=0)` over anything
    upstream returns float64, and storing that writes twice the bytes. It reads
    back through `from_blob` as a vector of double the length made of garbage —
    no error, no NaN, just a wrong answer at M4. Refuse it at the door instead.
    """
    arr = np.asarray(vec)
    if arr.ndim != 1:
        raise ValueError(f'vector must be 1-D, got shape {arr.shape}')
    if arr.dtype != np.dtype('float32'):
        raise ValueError(
            f'vector must be float32 (config.DTYPE), got {arr.dtype}. '
            f'Cast explicitly with .astype(np.float32) so the conversion is a '
            f'decision rather than an accident.'
        )
    if not arr.size:
        raise ValueError('refusing to store an empty vector')
    return np.ascontiguousarray(arr, dtype='<f4').tobytes()


def from_blob(blob):
    """Bytes back to a 1-D float32 array."""
    return np.frombuffer(blob, dtype='<f4')


def put_vector(conn, track_id, vec, model, revision=None):
    """Store one track's NEURAL vector in `local_vectors`. Idempotent per track.

    `model` and `revision` are recorded per row rather than in `meta` because
    §8.5 may well try more than one encoder before M4 settles the question, and
    "which model produced this vector" is then a property of the vector.
    """
    sig = assert_config(conn, 'local_vectors')
    blob = to_blob(vec)
    conn.execute(
        'INSERT INTO local_vectors(track_id, model, revision, dim, vector, config_sig, created_at) '
        'VALUES(?,?,?,?,?,?,?) '
        'ON CONFLICT(track_id) DO UPDATE SET '
        '  model=excluded.model, revision=excluded.revision, dim=excluded.dim, '
        '  vector=excluded.vector, config_sig=excluded.config_sig, created_at=excluded.created_at',
        (track_id, model, revision, len(blob) // 4, blob, sig, _now()),
    )


def put_descriptor(conn, track_id, vec, version=1):
    """Store one track's CLASSICAL descriptor vector (§8.4). Idempotent per track.

    Separate function, separate table, deliberately: this is the arm M4 judges
    the encoder against, and the two must not be able to overwrite each other
    through one careless `table=` argument.
    """
    sig = assert_config(conn, 'descriptors')
    blob = to_blob(vec)
    conn.execute(
        'INSERT INTO descriptors(track_id, version, dim, vector, config_sig, created_at) '
        'VALUES(?,?,?,?,?,?) '
        'ON CONFLICT(track_id) DO UPDATE SET '
        '  version=excluded.version, dim=excluded.dim, vector=excluded.vector, '
        '  config_sig=excluded.config_sig, created_at=excluded.created_at',
        (track_id, int(version), len(blob) // 4, blob, sig, _now()),
    )


def get_vector(conn, track_id, table='local_vectors'):
    if table not in VECTOR_TABLES:
        raise ValueError(f'unknown vector table: {table!r}')
    row = conn.execute(f'SELECT vector FROM {table} WHERE track_id=?', (track_id,)).fetchone()
    return None if row is None else from_blob(row['vector'])


def load_matrix(conn, table='local_vectors'):
    """Every vector as one (N, dim) float32 array, with the parallel path list.

    §8.7 loads the whole thing and does `M @ q`. At 15,326 × 2048 that is 125 MB
    and one matmul — brute force wins comfortably, and reaching for an ANN index
    here is optimising a problem that does not exist (Trap 18).
    """
    if table not in VECTOR_TABLES:
        raise ValueError(f'unknown vector table: {table!r}')
    rows = conn.execute(
        f'SELECT t.id, t.path, v.vector, v.dim FROM {table} v '
        f'JOIN tracks t ON t.id = v.track_id ORDER BY t.id'
    ).fetchall()
    if not rows:
        return np.empty((0, 0), dtype=np.float32), [], []
    dims = {r['dim'] for r in rows}
    if len(dims) != 1:
        raise ValueError(f'{table} holds mixed dimensions {sorted(dims)} — refusing to stack')
    matrix = np.stack([from_blob(r['vector']) for r in rows]).astype(np.float32, copy=False)
    return matrix, [r['path'] for r in rows], [r['id'] for r in rows]


def stats(conn):
    """A one-line health read of the index."""
    counts = {
        s: conn.execute('SELECT COUNT(*) AS n FROM tracks WHERE status=?', (s,)).fetchone()['n']
        for s in (PENDING, OK, FAILED)
    }
    counts['local_vectors'] = conn.execute('SELECT COUNT(*) AS n FROM local_vectors').fetchone()['n']
    counts['descriptors'] = conn.execute('SELECT COUNT(*) AS n FROM descriptors').fetchone()['n']
    for table in VECTOR_TABLES:
        counts[f'sig:{table}'] = get_meta(conn, f'config_sig:{table}')
    return counts


if __name__ == '__main__':
    with connect() as c:
        print(f'{DB_PATH}\n{stats(c)}')
