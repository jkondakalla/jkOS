#!/usr/bin/env python3
"""Everything KourOS reads about the library, as one resumable command — and the
watcher that runs it again whenever new music lands on the shelf.

    scan ─▶ vectors ─▶ baseline ─────────────────────▶ fit ─▶ gate ─▶ ship ─▶ deliver
            CLAP 512-d   descriptors + pulsarmap meshes   calibration  proxies  snapshots  rsync
            (48 kHz)     ONE decode, ONE FFT (22.05 kHz)

    python analyze.py                  the full sequence, once
    python analyze.py --watch          …then again every time the library changes
    python analyze.py --status         where every stage stands, writing nothing

What each stage feeds in KourOS: `vectors` are similarity, radio, Runs and the vibe
map's positions; `descriptors` name the vibe map's axes and are the fallback arm;
`meshes` are the pulsarmap; `fit` is the corpus geometry every served cosine is
read through. Nothing here is new analysis — each stage calls the module that
already owns it (`backfill.run`, `descriptors`, `mesh`, `query`, `ship`). This file
owns the ORDER, the guards between stages, and the hand-off.

⚠️ **READ-ONLY USE OF THE FOUR FILES** (`config.py` · `mel.py` · `encoder.py` ·
`audio.py`, RESET.md §0a). They are imported, never edited, and nothing below
re-derives a parameter they define.

⚠️ **EVERY STAGE IS RESUMABLE BY CONSTRUCTION, SO THE SEQUENCE IS TOO.** Each work
queue is the absence of a join partner — `index.pending()` for vectors, "no
descriptor row or no mesh row" for the baseline — and every track commits on its
own. Kill this at any point and re-running it continues. There is no sequence
state file, for the reason `backfill.py` has none.

⚠️ **THE BASELINE STAGE IS WHY THIS EXISTS AS ONE FILE.** Descriptors and meshes are
both built from the baseline log-mel. Run as `descriptors.py --build` and
`mesh.py --pending` they read every file over the mount twice — measured at
1.48 s/track for meshes alone, ~19.5 h over the library — and the wire is the
bottleneck (Trap 19). Here one decode and one FFT pass produce both
(`descriptors.describe_with_logmel`), and `test_descriptors.py` holds the shared
log-mel bit-identical to `mel.logmelspectrogram`, so a mesh built here is the
same picture `mesh.py` would have built.

⚠️ **THE GATE STANDS BETWEEN A NEW CALIBRATION AND KOUROS.** `query.gate`'s proxies
run whenever the fitted geometry has changed since the last passed gate, and a
failure refuses the ship — §8.7's stop condition, made mechanical for a pipeline
nobody is watching. The verdict is stored against a hash of the calibration, so a
watcher cycle cannot ship a geometry a full run already failed.
"""
import argparse
import hashlib
import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import audio
import backfill
import config
import descriptors
import encoder
import index
import mapbasis
import mesh
import query
import runlock
import scan
import ship

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, 'out')

#: The names KourOS looks for — `VECTOR_DB_PATH` / `MESH_DB_PATH` in both compose
#: files end in exactly these.
INDEX_SNAPSHOT = 'music-index.db'
MESH_SNAPSHOT = 'music-meshes.db'
MANIFEST = 'analysis-manifest.json'

STAGES = ('scan', 'vectors', 'baseline', 'fit', 'gate', 'ship', 'deliver')

# ── The numbers ─────────────────────────────────────────────────────────────────
# A file is only analysed once it has stopped changing. ⚠️ NOT a nicety: the Qobuz
# downloader renames `.part` → `.flac` and THEN rewrites the file to tag it, and an
# SMB copy writes straight to the final name — so a file that exists is not a file
# that is finished. Analysed half-written, it is marked `failed`, and failed rows
# leave every queue. (It does heal: the finished file's new size resets the row.)
SETTLE_SECONDS = 120

# How many ALREADY-ANALYSED tracks one scan may send back to `pending` before it
# stops and asks. `upsert_track` drops a track's vectors when its mtime or size
# moves — right for one re-downloaded album, and four hours of encoder time
# discarded by a tagging sweep over the whole library, with no error. New files
# are never held back by this; only changes to finished work are.
MAX_INVALIDATE = 500

# Refit the corpus geometry once an arm has grown this much since its last fit.
# Below it, a new track centres against the stored mean — which is the design
# (`descriptors.py`: "a track added months later normalises identically").
REFIT_GROWTH = 0.05

WATCH_INTERVAL = 300

# A watcher cycle lists only directories whose mtime moved (`scan.CachedShelf`);
# this often it walks everything, to catch the one change that does not move a
# directory — a file rewritten in place. The first cycle is always full.
FULL_WALK_EVERY = 24 * 3600
BASELINE_WORKERS = descriptors.DEFAULT_WORKERS
ABORT_AFTER = backfill.ABORT_AFTER

DEFAULT_KEY = os.path.expanduser('~/.ssh/jkos_music_analysis_ed25519')


class AnalysisError(RuntimeError):
    """An ordinary refusal. The message says what to do; exit 1."""


class ScanRefused(AnalysisError):
    """The scan would discard more finished analysis than `MAX_INVALIDATE`."""


class StageAborted(AnalysisError):
    """A systemic stop — the mount went away, or failures ran consecutive. Exit 2."""


class GateFailed(AnalysisError):
    """The proxies say the neural arm no longer beats the baseline. Nothing ships."""


class DeliveryError(AnalysisError):
    """The snapshots are built and verified; getting them to the NAS failed."""


# ── Output ──────────────────────────────────────────────────────────────────────
def say(message, stream=None):
    out = stream or sys.stderr
    print(f'[{time.strftime("%H:%M:%S")}] {message}', file=out, flush=True)


class _LineStream:
    """A write()-able that prefixes each line — so the modules' own printed
    reports (`query.gate`, `ship.check`) land in the watcher's journal readably."""

    def __init__(self, prefix='  '):
        self.prefix, self.buf = prefix, ''

    def write(self, text):
        self.buf += text
        while '\n' in self.buf:
            line, self.buf = self.buf.split('\n', 1)
            print(f'{self.prefix}{line}', file=sys.stderr, flush=True)

    def flush(self):
        if self.buf:
            print(f'{self.prefix}{self.buf}', file=sys.stderr, flush=True)
            self.buf = ''


def _hms(seconds):
    return backfill._hms(seconds)


class _Reporter:
    """A carriage-return progress line on a terminal, a plain line a minute under
    systemd — a `\\r` line in the journal is one unreadable megabyte."""

    def __init__(self, interval=None):
        self.tty = sys.stderr.isatty()
        self.interval = interval if interval is not None else (0.25 if self.tty else 60.0)
        self.last = 0.0

    def __call__(self, line, final=False):
        now = time.time()
        if not final and now - self.last < self.interval:
            return
        self.last = now
        if self.tty:
            print('\r' + line + ('\n' if final else ''), end='', file=sys.stderr, flush=True)
        else:
            say(line.strip())


# ── Interruption ────────────────────────────────────────────────────────────────
# `backfill.run` catches KeyboardInterrupt, drains, and RETURNS — correct for the
# backfill on its own, and a trap for a sequence: the next stage would start as if
# nothing had happened. So the signal is also recorded here, and every stage
# boundary asks.
_interrupted = threading.Event()


def _on_signal(signum, _frame):
    _interrupted.set()
    raise KeyboardInterrupt


def _check_interrupted():
    if _interrupted.is_set():
        raise KeyboardInterrupt


# ── Stage 1: scan ───────────────────────────────────────────────────────────────
class ScanPlan:
    """What a walk found, before anything is written."""

    __slots__ = ('new', 'changed', 'unsettled', 'walked', 'invalidates', 'observed')

    def __init__(self):
        self.new, self.changed, self.unsettled = [], [], []
        self.walked = self.invalidates = 0
        self.observed = {}

    def summary(self):
        return (f'{self.walked} files · {len(self.new)} new · {len(self.changed)} changed '
                f'({self.invalidates} already analysed) · {len(self.unsettled)} still settling')


def plan_scan(conn, root=None, settle_seconds=SETTLE_SECONDS, now=None, previous=None,
              tracks=None):
    """Walk the shelf and diff it against `tracks`. WRITES NOTHING.

    A new or changed file counts only once it has SETTLED: untouched for
    `settle_seconds`, and — when `previous` (the last walk's observations) is
    given — seen with the same mtime and size on two consecutive walks. The second
    rule catches a copy tool that stamps the SOURCE's old mtime on a file it is
    still writing, which the age rule alone would pass.

    "Changed" is exactly `index.upsert_track`'s test, so the plan cannot disagree
    with the write that follows it. `tracks` is the walk to plan over — a
    `scan.CachedShelf` walk in the watcher, a full `scan.iter_tracks` otherwise.
    """
    if not scan.library_reachable(root):
        # A dropped CIFS mount is not "the library is empty" — `iter_tracks` would
        # raise, and a watcher would restart-loop on it. Stop the cycle; retry later.
        raise StageAborted(f'the library root {root or config.LIBRARY_ROOT} is not reachable')
    now = time.time() if now is None else now
    known = {r['path']: (r['mtime'], r['size'])
             for r in conn.execute('SELECT path, mtime, size FROM tracks')}
    analysed = {r['path'] for r in conn.execute(
        'SELECT path FROM tracks t WHERE '
        'EXISTS (SELECT 1 FROM local_vectors v WHERE v.track_id = t.id) OR '
        'EXISTS (SELECT 1 FROM descriptors d WHERE d.track_id = t.id)')}
    plan = ScanPlan()
    for track in (scan.iter_tracks(root) if tracks is None else tracks):
        plan.walked += 1
        seen = (track.mtime, track.size)
        plan.observed[track.path] = seen
        stored = known.get(track.path)
        if stored is not None and stored == seen:
            continue
        settled = now - track.mtime >= settle_seconds and (
            previous is None or previous.get(track.path) == seen)
        if not settled:
            plan.unsettled.append(track)
        elif stored is None:
            plan.new.append(track)
        else:
            plan.changed.append(track)
            if track.path in analysed:
                plan.invalidates += 1
    return plan


def apply_scan(conn, plan, allow_invalidate=False, max_invalidate=MAX_INVALIDATE):
    """Write a plan. New files always; changed files only under the ceiling.

    Returns `(written, refusal)` — `refusal` is None, or the sentence explaining
    why the changed files were held back. New files are written EITHER WAY: they
    cannot discard anything, and holding them hostage to a retagging sweep would
    stop every upload from being analysed until someone noticed.
    """
    written = 0
    for track in plan.new:
        index.upsert_track(conn, track.path, track.mtime, track.size)
        written += 1
    refusal = None
    if plan.invalidates > max_invalidate and not allow_invalidate:
        refusal = (f'{len(plan.changed)} file(s) changed on disk, and applying that would '
                   f'send {plan.invalidates} already-analysed tracks back to pending and '
                   f'discard their vectors — over the {max_invalidate} ceiling. A retagging '
                   f'sweep looks exactly like this. If the audio really changed, re-run with '
                   f'--allow-invalidate. First: {plan.changed[0].path}')
    else:
        for track in plan.changed:
            index.upsert_track(conn, track.path, track.mtime, track.size)
            written += 1
    conn.commit()
    return written, refusal


# ── Stage 2: vectors ────────────────────────────────────────────────────────────
def stage_vectors(conn, limit=None, artist=None, reporter=None):
    """The CLAP arm — `backfill.run` over `index.pending('local_vectors')`."""
    rows = index.pending(conn, 'local_vectors', limit=limit, artist=artist)
    if not rows:
        say('vectors   nothing pending')
        return 0
    if not encoder.available():
        raise AnalysisError('the encoder is unavailable — weights missing, or onnxruntime is '
                            'not importable in this interpreter (music/models/README.md)')
    try:
        provider = encoder.active_provider().replace('ExecutionProvider', '')
    except Exception:                                  # noqa: BLE001 — reported, not fatal
        provider = 'provider unknown'
    say(f'vectors   {len(rows)} to embed · {provider} · {encoder.recipe(None)}')
    report = reporter or _Reporter()
    progress = backfill.run(conn, rows, report=lambda p: report(p.line()))
    report(progress.line(), final=True)
    _check_interrupted()
    say(f'vectors   {progress.done} embedded, {progress.failed} failed, '
        f'{_hms(progress.elapsed)}')
    if progress.aborted:
        raise StageAborted(progress.aborted)
    return progress.done


# ── Stage 3: baseline (descriptors + meshes) ────────────────────────────────────
class Job:
    __slots__ = ('id', 'path', 'size', 'need_descriptor', 'mesh_key')

    def __init__(self, track_id, path, size, need_descriptor, mesh_key):
        self.id, self.path, self.size = track_id, path, size
        self.need_descriptor, self.mesh_key = bool(need_descriptor), mesh_key


def baseline_queue(conn, store, root_name=mesh.DEFAULT_ROOT_NAME, limit=None, artist=None):
    """Tracks missing a descriptor OR a mesh — the baseline stage's resume query.

    Same shape as `index.pending`: failed rows and `EXCLUDE_DIRS` stay out, order
    is by id. A mesh the fill already tried and could not build (`failures`) is
    not re-queued; a track whose path carries no library root has no mesh key and
    is queued for its descriptor alone.
    """
    have_mesh = {r[0] for r in store.execute('SELECT rel_key FROM meshes')}
    have_mesh |= {r[0] for r in store.execute('SELECT rel_key FROM failures')}
    sql = ['SELECT t.id, t.path, t.size, d.track_id IS NULL AS need_descriptor '
           'FROM tracks t LEFT JOIN descriptors d ON d.track_id = t.id '
           'WHERE t.status != ?']
    args = [index.FAILED]
    if artist:
        sql.append('AND t.path LIKE ?')
        args.append(f'%{artist}%')
    for pattern in index.EXCLUDE_DIRS_SQL():
        sql.append('AND t.path NOT LIKE ?')
        args.append(pattern)
    sql.append('ORDER BY t.id')
    jobs = []
    for row in conn.execute(' '.join(sql), args):
        key = mesh.rel_key(row['path'], root_name)
        mesh_key = key if key is not None and key not in have_mesh else None
        if row['need_descriptor'] or mesh_key:
            jobs.append(Job(row['id'], row['path'], row['size'], row['need_descriptor'], mesh_key))
            if limit and len(jobs) >= limit:
                break
    return jobs


def analyse_baseline(path):
    """One file → `(descriptor, logmel, duration)`. The only decode in the stage.

    The mesh is built on the MAIN thread from the returned log-mel, not here:
    `mesh.build` stamps `config.signature()`, and asking that question in the
    thread that will write the row keeps the stamp and the store's recipe check
    reading the same process-wide profile at the same moment.
    """
    signal_ = audio.decode(path)
    duration = audio.duration_of(signal_)
    vector, logmel = descriptors.describe_with_logmel(signal_)
    return vector, logmel, duration


class BaselineProgress:
    def __init__(self, total):
        self.total, self.done, self.failed, self.bytes = total, 0, 0, 0
        self.descriptors = self.meshes = 0
        self.started = time.time()
        self.aborted = None

    @property
    def elapsed(self):
        return max(time.time() - self.started, 1e-9)

    def line(self):
        n = self.done + self.failed
        rate = n / self.elapsed
        eta = (self.total - n) / rate if rate > 0 else 0.0
        return (f'  {n}/{self.total}  {rate:5.2f} track/s  '
                f'{self.bytes / self.elapsed / 1e6:6.1f} MB/s  '
                f'{self.descriptors} descriptors · {self.meshes} meshes  '
                f'{self.failed} failed  elapsed {_hms(self.elapsed)}  eta {_hms(eta)}')


def stage_baseline(conn, store, jobs, workers=BASELINE_WORKERS, reporter=None):
    """Describe and mesh every job: parallel decode + FFT, one writer per store.

    Failure handling is `backfill`'s, deliberately, because this stage reads the
    same shelf over the same mount: the shelf gone → stop and mark NOTHING (the
    rows stay queued); `ABORT_AFTER` failures in a row → stop, those rows marked;
    one bad file → marked, the batch continues. A descriptor failure marks
    `tracks.status` exactly as `descriptors.build` does; a mesh-only failure is
    recorded in the mesh store and leaves the track's status alone.
    """
    progress = BaselineProgress(len(jobs))
    if not jobs:
        say('baseline  nothing pending')
        return progress
    if config.active().signature() != config.baseline().signature():
        raise AnalysisError(f'the baseline stage must run under the baseline profile, but '
                            f'{config.active().name!r} is in force (Trap 16)')
    index.assert_config(conn, 'descriptors')
    conn.commit()
    say(f'baseline  {len(jobs)} track(s) · {sum(j.need_descriptor for j in jobs)} need a '
        f'descriptor · {sum(1 for j in jobs if j.mesh_key)} need a mesh · {workers} workers')

    report = reporter or _Reporter()
    queue_ = iter(jobs)
    inflight = {}
    consecutive = 0
    pool = ThreadPoolExecutor(max_workers=max(1, int(workers)))

    def top_up():
        # Bounded submission: 47,000 futures up front would hold the whole queue in
        # memory and make a Ctrl-C wait for a cancel sweep over all of them.
        while len(inflight) < max(2, workers * 2):
            job = next(queue_, None)
            if job is None:
                return
            inflight[pool.submit(analyse_baseline, job.path)] = job

    try:
        top_up()
        while inflight and progress.aborted is None:
            done, _ = wait(list(inflight), timeout=0.5, return_when=FIRST_COMPLETED)
            for future in done:
                job = inflight.pop(future)
                error = future.exception()
                if error is None:
                    vector, logmel, duration = future.result()
                    try:
                        built = mesh.build(logmel, duration=duration) if job.mesh_key else None
                    except Exception as exc:          # noqa: BLE001 — a mesh failure is data
                        built, mesh_error = None, exc
                    else:
                        mesh_error = None
                    if job.need_descriptor:
                        index.put_descriptor(conn, job.id, vector,
                                             version=descriptors.DESCRIPTOR_VERSION)
                        index.mark_ok(conn, job.id, duration=duration)
                        progress.descriptors += 1
                    if built is not None:
                        mesh.put(store, job.mesh_key, built, commit=False)
                        progress.meshes += 1
                    elif mesh_error is not None:
                        mesh.record_failure(store, job.mesh_key,
                                            f'{type(mesh_error).__name__}: {mesh_error}',
                                            commit=False)
                    conn.commit()
                    store.commit()                    # per track, both stores — Trap 17
                    progress.done += 1
                    progress.bytes += job.size or 0
                    consecutive = 0
                    continue
                if not scan.library_reachable():
                    progress.aborted = (
                        f'the library root {config.LIBRARY_ROOT} is not reachable — stopped '
                        f'before marking tracks failed for a fault that is not theirs. '
                        f'Remount and re-run; nothing was lost.')
                    break
                text = f'{type(error).__name__}: {error}'
                if job.need_descriptor:
                    index.mark_failed(conn, job.id, text)
                if job.mesh_key:
                    mesh.record_failure(store, job.mesh_key, text, commit=False)
                conn.commit()
                store.commit()
                progress.failed += 1
                consecutive += 1
                if consecutive >= ABORT_AFTER:
                    progress.aborted = (
                        f'{consecutive} failures in a row with no success between them — '
                        f'systemic, not {consecutive} bad files. Read them with '
                        f'`backfill.py --failures`.')
                    break
            else:
                top_up()
                report(progress.line())
    finally:
        # Queued futures are cancelled; the few mid-decode finish (their results
        # are discarded — every committed track is already safe, the rest re-queue).
        pool.shutdown(wait=True, cancel_futures=True)
    report(progress.line(), final=True)
    say(f'baseline  {progress.descriptors} descriptors, {progress.meshes} meshes, '
        f'{progress.failed} failed, {_hms(progress.elapsed)}')
    if progress.aborted:
        raise StageAborted(progress.aborted)
    return progress


# ── Stage 4: fit ────────────────────────────────────────────────────────────────
def _count(conn, table):
    return conn.execute(f'SELECT COUNT(*) AS n FROM {table}').fetchone()['n']


def needs_fit(conn, growth=REFIT_GROWTH):
    """Why the corpus geometry should be refitted, or None if it is current.

    Unfitted, stale (the arm's config moved since the fit), or grown past
    `growth` since the fit — per arm, for every arm that holds vectors.
    """
    for table in index.VECTOR_TABLES:
        n = _count(conn, table)
        if not n:
            continue
        if query.Calibration.load(conn, table) is None:
            return f'{table} holds {n} vectors and has never been fitted'
        if query.Calibration.stale(conn, table):
            return f'{table} was rebuilt under a different config since its fit'
        fitted = int(index.get_meta(conn, f'calib_n_fit:{table}', 0) or 0)
        if n > fitted * (1.0 + growth):
            return f'{table} has grown from {fitted} to {n} since its fit'
    return None


def stage_fit(conn, force=False, growth=REFIT_GROWTH):
    """Refit the descriptor z-score, then both arms' calibration. Returns whether
    it fitted. ⚠️ Order matters: `query.load_arm('descriptors')` z-scores through
    the STORED corpus stats, so fitting calibration first would centre the
    descriptor arm through the previous fit's statistics."""
    reason = 'forced by a full run' if force else needs_fit(conn, growth)
    if reason is None:
        if stage_map(conn):
            return True
        say('fit       current')
        return False
    say(f'fit       {reason}')
    if _count(conn, 'descriptors') >= descriptors.MIN_FIT_ROWS:
        stats = descriptors.fit_corpus(conn)
        say(f'fit       descriptor z-score over {stats.n_fit} tracks')
    try:
        query.fit_calibration(conn, stream=_LineStream('          '))
    except (query.QueryError, descriptors.DescriptorError) as exc:
        raise AnalysisError(f'fit refused: {exc}') from exc
    stage_map(conn, force=True)
    return True


def stage_map(conn, force=False):
    """The vibe space's basis, in the calibration just fitted (mapbasis.py).

    ⚠️ **A FAILED MAP GATE DOES NOT STOP THE SHIP.** The basis is HELD — recorded in
    `meta` with the reason, reported by `--status` and by `ship.check`, and read by
    KourOS as "the map is held" — and the vectors, descriptors and meshes still
    ship. Jag, 2026-09-16: never an unnamed rail, and never a whole index withheld
    over one view of it."""
    stale = [a for a in mapbasis.ARMS if _count(conn, a) and
             (force or mapbasis.needs_fit(conn, a) is not None)]
    if not stale:
        return False
    for arm in stale:
        say(f'fit       map basis for {arm}')
        try:
            result = mapbasis.fit(conn, arm, stream=_LineStream('          '))
        except (mapbasis.MapError, query.QueryError, descriptors.DescriptorError) as exc:
            raise AnalysisError(f'map fit could not run: {exc}') from exc
        if result['mode'] == 'held':
            say(f'⚠️ fit     {arm} map basis HELD — {result["reason"]}')
    return True


# ── Stage 5: gate ───────────────────────────────────────────────────────────────
GATE_KEY = 'analysis_gate'


def calibration_hash(conn):
    """A fingerprint of the fitted geometry — every `calib_*` value, both arms."""
    rows = conn.execute("SELECT key, value FROM meta WHERE key LIKE 'calib\\_%' ESCAPE '\\' "
                        'ORDER BY key').fetchall()
    return hashlib.sha256(json.dumps([[r['key'], r['value']] for r in rows])
                          .encode('utf-8')).hexdigest()[:16]


def gate_verdict(conn):
    """The last recorded gate verdict for THIS calibration, or None."""
    raw = index.get_meta(conn, GATE_KEY)
    if not raw:
        return None
    try:
        verdict = json.loads(raw)
    except ValueError:
        return None
    return verdict if verdict.get('calibration') == calibration_hash(conn) else None


def stage_gate(conn, force=False):
    """§8.7's objective proxies over the aligned population. Runs when this
    calibration has no verdict yet (or `force`); a failure raises `GateFailed`.

    ⚠️ Proxies, not THE gate — that is `query.py --hand`, read by a person, and
    M4 passed it. What this guards is an unattended refit: a geometry nobody looked
    at must at least keep the neural arm ahead of the baseline before it ships.
    """
    verdict = None if force else gate_verdict(conn)
    if verdict is not None:
        if not verdict['passed']:
            raise GateFailed(f'this calibration already FAILED the gate at {verdict["at"]} — '
                             f'fix upstream before shipping (query.py --gate)')
        say(f'gate      passed for this calibration at {verdict["at"]}')
        return True
    say('gate      proxies over the aligned population')
    try:
        passed = bool(query.gate(conn, stream=_LineStream('          ')))
    except (query.QueryError, descriptors.DescriptorError, ValueError) as exc:
        raise AnalysisError(f'the gate could not run: {exc}') from exc
    index.set_meta(conn, GATE_KEY, json.dumps({
        'calibration': calibration_hash(conn), 'passed': passed,
        'at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'tracks': _count(conn, 'local_vectors')}))
    conn.commit()
    if not passed:
        raise GateFailed('the neural arm does not beat the descriptor baseline on the '
                         'proxies — §8.7 stop condition. Nothing ships.')
    return True


# ── Stage 6: ship ───────────────────────────────────────────────────────────────
def fingerprint(conn, store):
    """What would ship, as a hash — so a watcher cycle with nothing new neither
    rewrites a gigabyte of snapshots nor re-sends it."""
    parts = []
    for table, stamp in (('tracks', 'updated_at'), ('local_vectors', 'created_at'),
                         ('descriptors', 'created_at')):
        row = conn.execute(f'SELECT COUNT(*) AS n, MAX({stamp}) AS m FROM {table}').fetchone()
        parts.append([table, row['n'], row['m']])
    parts.append(['meta', [[r['key'], r['value']] for r in
                           conn.execute('SELECT key, value FROM meta ORDER BY key')]])
    for table, stamp in (('meshes', 'created_at'), ('failures', 'updated_at')):
        row = store.execute(f'SELECT COUNT(*) AS n, MAX({stamp}) AS m FROM {table}').fetchone()
        parts.append([table, row['n'], row['m']])
    return hashlib.sha256(json.dumps(parts, default=str).encode('utf-8')).hexdigest()[:16]


def read_manifest(out_dir=OUT_DIR):
    try:
        with open(os.path.join(out_dir, MANIFEST)) as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def write_manifest(data, out_dir=OUT_DIR):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, MANIFEST)
    tmp = f'{path}.partial'
    with open(tmp, 'w') as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
    os.replace(tmp, path)


def _ro(path):
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def stage_ship(index_path, store_path, out_dir=OUT_DIR, root_name=ship.DEFAULT_ROOT_NAME,
               stamp=None):
    """Snapshot both stores with `VACUUM INTO`, then verify THE COPIES.

    `ship.check` refuses an index KourOS would read wrongly (no fitted geometry,
    a root it cannot join on, mixed dimensions); `mesh.check` does the same for
    the pulsarmap store. Verified from the snapshot, never from the source — the
    point is that what leaves this machine is what was measured.
    """
    index_dest = os.path.join(out_dir, INDEX_SNAPSHOT)
    mesh_dest = os.path.join(out_dir, MESH_SNAPSHOT)
    log = _LineStream('          ')
    try:
        for path, dest, verify in ((index_path, index_dest, 'index'),
                                   (store_path, mesh_dest, 'meshes')):
            if verify == 'index':
                source = _ro(path)
                try:
                    ship.check(source, root_name, True, stream=log)
                finally:
                    source.close()
                ship.snapshot(path, dest)
                copy = _ro(dest)
                try:
                    ship.check(copy, root_name, True, stream=log)
                finally:
                    copy.close()
            else:
                mesh.snapshot(path, dest)
                copy = _ro(dest)
                try:
                    counts = mesh.check(copy)
                finally:
                    copy.close()
                say(f'ship      meshes: {counts["meshes"]} verified, {counts["failures"]} '
                    f'recorded failures, {counts["bytes"] / 1e6:.1f} MB of rows')
    except (ship.ShipError, mesh.MeshError) as exc:
        raise AnalysisError(f'ship refused: {exc}') from exc
    manifest = read_manifest(out_dir)
    manifest.update({
        'shipped': stamp, 'shipped_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'files': {name: os.path.getsize(os.path.join(out_dir, name))
                  for name in (INDEX_SNAPSHOT, MESH_SNAPSHOT)},
    })
    write_manifest(manifest, out_dir)
    say(f'ship      {index_dest} ({manifest["files"][INDEX_SNAPSHOT] / 1e6:.1f} MB) · '
        f'{mesh_dest} ({manifest["files"][MESH_SNAPSHOT] / 1e6:.1f} MB)')
    return index_dest, mesh_dest


# ── Stage 7: deliver ────────────────────────────────────────────────────────────
# ⚠️ **THE KEY THIS USES CAN WRITE TWO FILES INTO ONE DIRECTORY, AND NOTHING ELSE.**
# Its `authorized_keys` entry on the NAS forces `rrsync -wo -no-del <dir>` under
# `restrict`: no shell, no pty, no forwarding, no reads, no deletes, and no path
# outside the analysis directory — which KourOS mounts READ-ONLY, in a dataset
# that holds no application database. A stolen copy can replace the analysis
# with garbage (KourOS's checks and `stats` would show it) and cannot reach a
# user's data. Setup and the exact line: infra/music-analysis/README.md.
TARGET_RE = re.compile(r'^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]*$')


class Delivery:
    def __init__(self, target, key=DEFAULT_KEY, timeout=1800):
        if not TARGET_RE.match(target or '') or '..' in target:
            raise DeliveryError(f'delivery target {target!r} is not `user@host:` or '
                                f'`user@host:relative/path` (no `..`)')
        if any(ch.isspace() for ch in key):
            # rsync splits `-e` on whitespace, so a key path with a space would be
            # read as two arguments — refused rather than quoted into a shell string.
            raise DeliveryError(f'the key path {key!r} contains whitespace, which rsync\'s '
                                f'-e cannot carry; move the key')
        self.target, self.key, self.timeout = target, key, timeout

    @classmethod
    def from_env(cls, target=None, key=None):
        """The configured delivery, or None when there is none — never a default
        host. An unconfigured delivery is a normal state, not an error."""
        target = target or os.environ.get('MUSIC_ANALYSIS_TARGET', '').strip()
        if not target:
            return None
        return cls(target, key or os.environ.get('MUSIC_ANALYSIS_KEY', '').strip() or DEFAULT_KEY)

    def argv(self, files):
        ssh_cmd = (f'ssh -i {self.key} -o IdentitiesOnly=yes -o BatchMode=yes '
                   f'-o StrictHostKeyChecking=yes -o ConnectTimeout=15')
        # --times so KourOS sees the new mtime; rsync writes each file to a
        # temporary name and renames it, so KourOS never opens a torn snapshot.
        return ['rsync', '--times', '--chmod=F644', '--timeout=300', '-e', ssh_cmd,
                *files, self.target]

    def send(self, files):
        if not os.path.exists(self.key):
            raise DeliveryError(f'no key at {self.key} — see infra/music-analysis/README.md')
        try:
            proc = subprocess.run(self.argv(files), stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, timeout=self.timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise DeliveryError(f'rsync did not complete: {exc}') from exc
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or '').strip()[-400:]
            raise DeliveryError(f'rsync exited {proc.returncode}: {tail}')


def stage_deliver(delivery, out_dir=OUT_DIR, stamp=None):
    files = [os.path.join(out_dir, name) for name in (INDEX_SNAPSHOT, MESH_SNAPSHOT)]
    missing = [f for f in files if not os.path.exists(f)]
    if missing:
        raise DeliveryError(f'nothing to deliver — {missing[0]} has not been shipped')
    if delivery is None:
        say('deliver   not configured (MUSIC_ANALYSIS_TARGET unset) — the snapshots are in '
            f'{out_dir}')
        return False
    say(f'deliver   {delivery.target}')
    started = time.time()
    delivery.send(files)
    manifest = read_manifest(out_dir)
    manifest.update({'delivered': stamp or manifest.get('shipped'),
                     'delivered_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
                     'delivered_to': delivery.target})
    write_manifest(manifest, out_dir)
    say(f'deliver   done in {_hms(time.time() - started)}')
    return True


# ── The sequence ────────────────────────────────────────────────────────────────
class Options:
    def __init__(self, **kw):
        self.stages = kw.get('stages', STAGES)
        self.full = kw.get('full', True)
        self.limit = kw.get('limit')
        self.artist = kw.get('artist')
        self.workers = kw.get('workers', BASELINE_WORKERS)
        self.allow_invalidate = kw.get('allow_invalidate', False)
        self.settle = kw.get('settle', SETTLE_SECONDS)
        self.out_dir = kw.get('out_dir', OUT_DIR)
        self.delivery = kw.get('delivery')
        self.index_path = kw.get('index_path') or index.DB_PATH
        self.store_path = kw.get('store_path') or mesh.DB_PATH
        self.root = kw.get('root')


class WatchState:
    """What one watcher cycle hands the next: the cached shelf, the last walk's
    observations (the settle rule's second look), the files still settling (which
    must be re-`stat`ed — their directories will not say they changed), and when
    the shelf was last walked in full."""

    def __init__(self, root=None):
        self.shelf = scan.CachedShelf(root)
        self.observed = None
        self.settling = set()
        self.full_walk_at = 0.0


def run_once(opts, state=None):
    """One pass of the sequence. `state` is a `WatchState` in the watcher and None
    for a person's run, which always walks the whole shelf.

    `opts.full` is the difference between a person's run and a watcher cycle: a
    full run refits and re-gates unconditionally and treats a held-back scan as a
    stop; a cycle refits only on growth, gates only a new calibration, ships only
    what changed, and carries on past a held-back scan with the new files.
    """
    stages = set(opts.stages)
    conn = index.connect(opts.index_path)
    store = mesh.connect(opts.store_path)
    try:
        if 'scan' in stages:
            started = time.time()
            walk, how = None, 'full walk'
            if state is not None:
                if not scan.library_reachable(opts.root):
                    raise StageAborted(f'the library root {opts.root or config.LIBRARY_ROOT} '
                                       f'is not reachable')
                full = started - state.full_walk_at >= FULL_WALK_EVERY
                walk = state.shelf.walk(full=full, recheck=state.settling)
            plan = plan_scan(conn, root=opts.root, settle_seconds=opts.settle,
                             previous=None if state is None else state.observed, tracks=walk)
            if state is not None:
                # Recorded before anything below can raise, so a cycle that fails
                # later still leaves the next one a correct second look.
                how = 'full walk' if full else f'{state.shelf.listed} dirs re-listed'
                state.full_walk_at = started if full else state.full_walk_at
                state.observed = plan.observed
                state.settling = {t.path for t in plan.unsettled}
            written, refusal = apply_scan(conn, plan, opts.allow_invalidate)
            say(f'scan      {plan.summary()} · {written} written · {how} · '
                f'{time.time() - started:.1f}s')
            if refusal:
                if opts.full:
                    raise ScanRefused(refusal)
                say(f'⚠️ scan    {refusal}')
            _check_interrupted()

        if 'vectors' in stages:
            stage_vectors(conn, limit=opts.limit, artist=opts.artist)
            _check_interrupted()

        if 'baseline' in stages:
            jobs = baseline_queue(conn, store, limit=opts.limit, artist=opts.artist)
            stage_baseline(conn, store, jobs, workers=opts.workers)
            _check_interrupted()

        if 'fit' in stages:
            stage_fit(conn, force=opts.full)
            _check_interrupted()

        stamp = fingerprint(conn, store)
        manifest = read_manifest(opts.out_dir)

        if 'ship' in stages and (opts.full or manifest.get('shipped') != stamp):
            # ⚠️ Not skippable by leaving `gate` out of --stages: without it the
            # stored verdict is consulted instead of re-run, and a calibration with
            # no passing verdict still runs the proxies before anything ships.
            stage_gate(conn, force=opts.full and 'gate' in stages)
            _check_interrupted()
            conn.commit()
            stamp = fingerprint(conn, store)          # the gate wrote its verdict
            stage_ship(opts.index_path, opts.store_path, opts.out_dir, stamp=stamp)
            manifest = read_manifest(opts.out_dir)
        elif 'gate' in stages and opts.full:
            stage_gate(conn, force=True)
        elif 'ship' in stages:
            say('ship      nothing changed since the last ship')

        if 'deliver' in stages and (opts.delivery is not None or opts.full):
            if opts.full or manifest.get('delivered') != manifest.get('shipped'):
                stage_deliver(opts.delivery, opts.out_dir, stamp=manifest.get('shipped'))
            else:
                say('deliver   the last ship is already delivered')
    finally:
        conn.close()
        store.close()
    return state


def watch(opts, interval=WATCH_INTERVAL, cycles=None, sleep=time.sleep):
    """Run the sequence, then again every `interval` seconds, forever.

    ⚠️ **A WATCHER CYCLE THAT FAILS DOES NOT END THE WATCHER.** The mount dropping,
    the NAS rebooting mid-rsync, a gate failure — each is logged and the next cycle
    tries again, because every stage is resumable and a watcher that exits on the
    first blip is one someone has to notice is gone. What does end it is a bug
    (anything outside `AnalysisError` and the stores' own operational errors):
    the unit restarts it, and the traceback is in the journal rather than
    swallowed into a loop that logs the same exception every five minutes.
    """
    # A watcher is incremental from its first cycle: refit on growth, gate a new
    # calibration, ship what changed. A restart must not cost a forced refit and a
    # full gate every time systemd brings it back.
    opts.full = False
    state = WatchState(opts.root)
    n = 0
    say(f'watch     every {interval}s · settle {opts.settle}s · '
        f'deliver → {opts.delivery.target if opts.delivery else "not configured"}')
    while cycles is None or n < cycles:
        n += 1
        started = time.time()
        try:
            run_once(opts, state)
        except KeyboardInterrupt:
            raise
        except (AnalysisError, index.ConfigDriftError, mesh.MeshDriftError,
                sqlite3.OperationalError) as exc:
            say(f'⚠️ cycle   {type(exc).__name__}: {exc}')
        remaining = interval - (time.time() - started)
        if remaining > 0 and (cycles is None or n < cycles):
            sleep(remaining)


# ── Status ──────────────────────────────────────────────────────────────────────
def status(opts, out=None):
    """Every stage's standing, from read-only handles. Writes nothing."""
    out = out or sys.stdout
    if not os.path.exists(opts.index_path):
        print(f'no index at {opts.index_path}', file=out)
        return
    conn = _ro(opts.index_path)
    try:
        counts = index.stats(conn)
        in_scope = counts['ok'] + counts['pending'] + counts['failed']
        print(f'index      {opts.index_path}', file=out)
        print(f'tracks     {in_scope} in scope · {counts["failed"]} failed'
              + (f' · {counts["excluded"]} excluded' if 'excluded' in counts else ''), file=out)
        vec_pending = len(index.pending(conn, 'local_vectors'))
        print(f'vectors    {counts["local_vectors"]} · {vec_pending} pending', file=out)
        print(f'descriptors {counts["descriptors"]}', file=out)
        store = _ro(opts.store_path) if os.path.exists(opts.store_path) else None
        if store is not None:
            try:
                s = mesh.stats(store)
                queue_ = baseline_queue(conn, store)
                print(f'meshes     {s["meshes"]} · {s["failures"]} failed · baseline queue '
                      f'{len(queue_)} ({sum(j.need_descriptor for j in queue_)} descriptors, '
                      f'{sum(1 for j in queue_ if j.mesh_key)} meshes)', file=out)
                stamp = fingerprint(conn, store)
            finally:
                store.close()
        else:
            print(f'meshes     no store at {opts.store_path}', file=out)
            stamp = None
        reason = needs_fit(conn)
        print(f'fit        {"current" if reason is None else reason}', file=out)
        for arm in mapbasis.ARMS:
            if not _count(conn, arm):
                continue
            basis = mapbasis.Basis.load(conn, arm)
            hold = mapbasis.held(conn, arm)
            owed = mapbasis.needs_fit(conn, arm)
            if hold is not None:
                line = f'HELD ({hold["kind"]}) — {hold["reason"]}'
            elif owed is not None:
                line = owed
            elif basis is not None:
                line = (f'{basis.stats.get("mode")} basis, current · held-out Spearman '
                        f'{basis.stats.get("spearman_heldout") or 0:+.3f}')
            else:
                line = 'owed after the calibration'
            print(f'map        {line}', file=out)
        verdict = gate_verdict(conn)
        print('gate       ' + ('no verdict for this calibration' if verdict is None else
                               f'{"PASSED" if verdict["passed"] else "FAILED"} at {verdict["at"]}'),
              file=out)
    finally:
        conn.close()
    manifest = read_manifest(opts.out_dir)
    shipped = manifest.get('shipped')
    print(f'ship       ' + (f'{manifest.get("shipped_at")}'
                            + ('' if shipped == stamp else ' — the stores have changed since')
                            if shipped else 'never'), file=out)
    print(f'deliver    ' + (f'{manifest.get("delivered_at")} → {manifest.get("delivered_to")}'
                            + ('' if manifest.get('delivered') == shipped else
                               ' — the last ship is NOT delivered')
                            if manifest.get('delivered') else
                            ('configured, never delivered' if opts.delivery else
                             'not configured')), file=out)
    holder = runlock.holder()
    print(f'running    {holder or "nothing"}', file=out)


# ── CLI ─────────────────────────────────────────────────────────────────────────
def _stage_list(text):
    names = [s.strip() for s in text.split(',') if s.strip()]
    unknown = [s for s in names if s not in STAGES]
    if unknown:
        raise argparse.ArgumentTypeError(f'unknown stage(s) {unknown}; one of {list(STAGES)}')
    return tuple(s for s in STAGES if s in names)


def _main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--watch', action='store_true',
                        help='run the sequence, then again whenever the library changes')
    parser.add_argument('--interval', type=int, default=WATCH_INTERVAL,
                        help=f'with --watch: seconds between cycles (default {WATCH_INTERVAL})')
    parser.add_argument('--status', action='store_true', help='where every stage stands')
    parser.add_argument('--stages', type=_stage_list, default=STAGES,
                        help=f'comma-separated subset of {",".join(STAGES)}')
    parser.add_argument('--skip', type=_stage_list, default=(),
                        help='comma-separated stages to leave out')
    parser.add_argument('--limit', type=int, default=None,
                        help='at most N tracks per stage — a full run is never needed to test')
    parser.add_argument('--artist', default=None, help='path fragment filter')
    parser.add_argument('--workers', type=int, default=BASELINE_WORKERS,
                        help=f'baseline decode+FFT threads (default {BASELINE_WORKERS})')
    parser.add_argument('--settle', type=int, default=SETTLE_SECONDS,
                        help=f'seconds a new file must sit unchanged (default {SETTLE_SECONDS})')
    parser.add_argument('--allow-invalidate', action='store_true',
                        help=f'let a scan discard more than {MAX_INVALIDATE} finished tracks')
    parser.add_argument('--target', default=None,
                        help='rsync target, e.g. truenas_admin@192.168.1.108: '
                             '(default $MUSIC_ANALYSIS_TARGET; unset = no delivery)')
    parser.add_argument('--key', default=None,
                        help=f'ssh key for delivery (default $MUSIC_ANALYSIS_KEY or {DEFAULT_KEY})')
    parser.add_argument('--out-dir', default=OUT_DIR)
    args = parser.parse_args(argv)

    try:
        delivery = Delivery.from_env(args.target, args.key)
    except DeliveryError as exc:
        print(f'DeliveryError: {exc}', file=sys.stderr)
        return 1
    stages = tuple(s for s in args.stages if s not in args.skip)
    opts = Options(stages=stages, full=True, limit=args.limit, artist=args.artist,
                   workers=args.workers, allow_invalidate=args.allow_invalidate,
                   settle=args.settle, out_dir=args.out_dir, delivery=delivery)

    if args.status:
        status(opts)
        return 0

    # ⚠️ Installed unconditionally, and for SIGTERM too. A shell can hand this
    # process SIGINT as SIG_IGN (nohup does; so does every non-interactive
    # harness — control.py documents the same trap), and systemd stops a unit
    # with SIGTERM. Either way the run must drain and commit, not die mid-track.
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    what = 'analyze.py --watch' if args.watch else f'analyze.py {",".join(stages)}'
    try:
        with runlock.hold(what):
            if args.watch:
                watch(opts, interval=args.interval)
            else:
                started = time.time()
                run_once(opts)
                say(f'done      {_hms(time.time() - started)}')
        return 0
    except KeyboardInterrupt:
        say('interrupted — every committed track is safe; re-run to continue')
        return 130
    except StageAborted as exc:
        say(f'⚠️ ABORTED — {exc}')
        return 2
    except (AnalysisError, runlock.Busy, index.ConfigDriftError, mesh.MeshDriftError,
            encoder.EncoderError, audio.DecodeError) as exc:
        # Each carries a sentence saying what to do; a traceback would bury it.
        say(f'{type(exc).__name__}: {exc}')
        return 1


if __name__ == '__main__':
    raise SystemExit(_main())
