#!/usr/bin/env python3
"""Hand the finished vector space to KourOS (ToDo §8.9, last mile).

    music/index.db  ──VACUUM INTO──▶  a single verified file  ──cp──▶  <kouros-data>/music-index.db

KourOS reads the embedder's index READ-ONLY and never writes to it, so shipping
is a file copy. The reason this is a module and not a `cp` in a runbook is that
the copy has four ways to succeed and still be wrong, and every one of them is
silent on the reading side — KourOS is built to DEGRADE when the index is thin
(that is the right behaviour), so a broken index looks exactly like a backfill
that has not finished.

⚠️ **1. THE `-wal` SIDECAR.** The index runs in WAL mode with a commit per track,
so at any moment an arbitrary share of the vectors lives in `index.db-wal` and
not in `index.db`. `cp index.db somewhere` is a PRE-CHECKPOINT SNAPSHOT: it opens
cleanly, it reports a plausible row count, and the missing tracks read as "the
backfill has not reached them". §8.0 hit the same trap reading the live
BeigeBoard database, where a 4 MB WAL held writes the `.db` alone did not show.

    The defence is `VACUUM INTO`, not "remember to copy two files". It is sqlite's
    own atomic snapshot: it takes a read lock, writes ONE fully-checkpointed file
    with no sidecar of its own, and cannot produce a torn copy even while the
    backfill is mid-run. There is then no second file anyone can forget.

⚠️ **2. AN INDEX WITH NO CALIBRATION.** §8.8's headline: KourOS ranks on the
CENTRED space, and the centre lives in `meta` as `calib_*:<arm>`. Ship an index
whose geometry was never fitted and every served cosine is raw — strangers sit
around +0.48 instead of −0.03, the two arms land on incompatible scales, and
`makeRun()` degenerates into an energy ramp through unrelated music. Nothing
errors. `--fit` is a separate step precisely because it must happen after the
last vector lands, so it is exactly the step a hurried ship skips.

⚠️ **3. A LIBRARY ROOT KourOS CANNOT JOIN AGAINST.** The join is root-relative
(§8.8): the embedder stores `/mnt/Luna/Plex/Music/…`, the container sees
`/music/…`, and the two agree only BELOW the root segment. If the shipped paths
do not carry the root name KourOS is configured with, tier 2 misses every row,
tier 1 cannot hit in a container by construction, and coverage is 0% — reported
honestly by KourOS as "metadata basis", which reads as bad embeddings rather than
as an index that was never consulted.

⚠️ **4. MIXED DIMENSIONS OR A DRIFTED CONFIG.** `load_matrix` refuses to stack
mixed dims, so this one does at least fail — but it fails inside KourOS at
request time, on the host, rather than here where it can still be fixed.

Nothing below writes to the source index. Safe to run mid-backfill; the snapshot
is simply as complete as the run was when it was taken.

    python ship.py --check                       verify the live index, ship nothing
    python ship.py --out out/music-index.db      snapshot + verify the copy
    python ship.py --out … --root-name Music     the root name KourOS will be given
"""
import argparse
import os
import sqlite3
import sys

import config
import index

#: Where the copy is going on the far side, and the name KourOS derives its
#: `LIBRARY_ROOT_NAME` from by default (`path.basename(MUSIC_DIR)`, server.js).
#: Both compose files mount the library at `/music`, so the container's answer is
#: `music` — matched case-insensitively against the embedder's `…/Plex/Music`,
#: which is the whole reason `lastRootIndex` folds case in vectors.js.
DEFAULT_ROOT_NAME = 'music'
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'music-index.db')


class ShipError(Exception):
    """A condition that would ship an index KourOS reads without complaint."""


def _open_ro(path):
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def survey(conn):
    """Everything the checks below need, read in one place so `--check` and the
    post-copy verification cannot come to disagree about what they measured."""
    out = {'tracks': conn.execute('SELECT COUNT(*) AS n FROM tracks').fetchone()['n'],
            'arms': {}}
    for table in index.VECTOR_TABLES:
        rows = conn.execute(
            f'SELECT COUNT(*) AS n, COUNT(DISTINCT dim) AS dims, MIN(dim) AS dim, '
            f'COUNT(DISTINCT config_sig) AS sigs FROM {table}'
        ).fetchone()
        out['arms'][table] = {
            'n': rows['n'], 'dims': rows['dims'], 'dim': rows['dim'], 'sigs': rows['sigs'],
            'calibrated': index.get_meta(conn, f'calib_mean:{table}') is not None,
            'spread': index.get_meta(conn, f'calib_stranger_spread:{table}'),
            'config_sig': index.get_meta(conn, f'config_sig:{table}'),
        }
    return out


def root_coverage(conn, root_name):
    """How many `tracks.path` rows carry `root_name` as a path SEGMENT.

    Segment, not substring: a library at `/mnt/Music-Archive/…` contains the text
    `Music` and joins against nothing. This mirrors `lastRootIndex` in
    `apps/kouros/backend/src/discover/vectors.js` — deliberately the same rule,
    because a shipper that checks something subtly different from what the reader
    does is a check that passes on an index the reader cannot use.
    """
    want = root_name.lower()
    hit = 0
    total = 0
    sample = None
    for (path,) in conn.execute('SELECT path FROM tracks'):
        total += 1
        parts = [p for p in str(path).split(os.sep) if p]
        if any(p.lower() == want for p in parts):
            hit += 1
        elif sample is None:
            sample = path
    return hit, total, sample


def check(conn, root_name=DEFAULT_ROOT_NAME, require_calibration=True, stream=None):
    """Every way the copy can be wrong on arrival. Returns the survey; raises on a
    condition KourOS would read without complaint."""
    out = stream or sys.stdout
    data = survey(conn)
    problems = []

    if not data['tracks']:
        problems.append('the index holds no tracks at all')

    armed = {t: a for t, a in data['arms'].items() if a['n']}
    if not armed:
        problems.append('neither arm holds a single vector — KourOS would serve '
                        'metadata affinity for every surface')

    for table, arm in armed.items():
        if arm['dims'] > 1:
            problems.append(f'{table} holds {arm["dims"]} different dimensions — '
                            f'`load_matrix` refuses to stack it (it would fail inside '
                            f'KourOS at request time, on the host)')
        if arm['sigs'] > 1:
            problems.append(f'{table} holds vectors from {arm["sigs"]} different analysis '
                            f'configurations (ALGORITHMS.md Trap 16)')
        if require_calibration and not arm['calibrated']:
            problems.append(f'{table} has {arm["n"]} vectors but NO fitted geometry '
                            f'(`calib_mean:{table}` is unset) — KourOS would rank on the '
                            f'un-centred space and `makeRun` would degenerate (§8.8). '
                            f'Run `python query.py --fit` first.')

    hit, total, sample = root_coverage(conn, root_name)
    if total and hit != total:
        problems.append(
            f'{total - hit} of {total} paths do not carry {root_name!r} as a path segment, '
            f"so KourOS's root-relative join misses them and tier 1 cannot hit in a "
            f'container. First: {sample!r}')

    print(f'tracks            : {data["tracks"]}', file=out)
    for table, arm in data['arms'].items():
        state = 'calibrated' if arm['calibrated'] else 'NOT CALIBRATED'
        spread = f', stranger spread {float(arm["spread"]):.4f}' if arm['spread'] else ''
        print(f'{table:18}: {arm["n"]} vectors, dim {arm["dim"]}, {state}{spread}', file=out)
        if arm['n']:
            print(f'{"":18}  coverage {100 * arm["n"] / max(1, data["tracks"]):.1f}% of tracks',
                  file=out)
    print(f'root segment {root_name!r}: {hit}/{total} paths', file=out)

    if problems:
        raise ShipError('this index would be read without complaint and answer wrongly:\n  - '
                        + '\n  - '.join(problems))
    return data


def snapshot(src, dest):
    """A single fully-checkpointed file, atomically, from a live database.

    `VACUUM INTO` rather than `cp` — see the module header, trap 1. It refuses to
    overwrite, so the destination is cleared first and written under a temporary
    name, which also means a failure part-way through cannot leave a plausible
    half-index sitting at the destination path.
    """
    os.makedirs(os.path.dirname(os.path.abspath(dest)) or '.', exist_ok=True)
    tmp = f'{dest}.partial'
    for stale in (tmp, f'{tmp}-wal', f'{tmp}-shm'):
        if os.path.exists(stale):
            os.remove(stale)
    conn = _open_ro(src)
    try:
        conn.execute('VACUUM INTO ?', (tmp,))
    finally:
        conn.close()
    os.replace(tmp, dest)
    # A `VACUUM INTO` target has no sidecar of its own; an OLD one sitting beside
    # the destination from a previous plain `cp` would be read IN PREFERENCE to
    # the file just written, which is trap 1 wearing a disguise.
    for stale in (f'{dest}-wal', f'{dest}-shm'):
        if os.path.exists(stale):
            os.remove(stale)
    return dest


def _main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--out', default=None,
                        help=f'write the shippable snapshot here (default {DEFAULT_OUT})')
    parser.add_argument('--check', action='store_true',
                        help='verify the live index and exit, writing nothing')
    parser.add_argument('--root-name', default=DEFAULT_ROOT_NAME,
                        help="the library root segment KourOS is configured with "
                             f"(default {DEFAULT_ROOT_NAME!r}, from its /music mount)")
    parser.add_argument('--allow-uncalibrated', action='store_true',
                        help='ship anyway with no fitted geometry — §8.8 says do not')
    parser.add_argument('--db', default=None, help='source index (default music/index.db)')
    args = parser.parse_args(argv)

    src = args.db or index.DB_PATH
    if not os.path.exists(src):
        print(f'no index at {src}', file=sys.stderr)
        return 1

    print(f'source  {src}')
    try:
        check(_open_ro(src), args.root_name, not args.allow_uncalibrated)
    except ShipError as exc:
        print(f'\nREFUSED — {exc}', file=sys.stderr)
        return 1

    if args.check:
        print('\nready to ship')
        return 0

    dest = args.out or DEFAULT_OUT
    print(f'\nsnapshot -> {dest}')
    snapshot(src, dest)

    # Verified from the COPY, not from the source: the point of the exercise is
    # that what lands on the far side is what was measured, and a snapshot that
    # silently dropped rows would otherwise be reported using the source's counts.
    print()
    after = check(_open_ro(dest), args.root_name, not args.allow_uncalibrated)
    size = os.path.getsize(dest)
    print(f'\n{size / 1e6:.1f} MB, no sidecar — this one file is the whole index.')
    print('place it where KourOS\'s VECTOR_DB_PATH points (both compose files say '
          '/data/music-index.db):')
    print(f'  scp {dest!r} truenas_admin@192.168.1.108:'
          '/mnt/Luna/Backends/Staging/kouros-data/music-index.db')
    return 0 if after else 1


if __name__ == '__main__':
    raise SystemExit(_main())
