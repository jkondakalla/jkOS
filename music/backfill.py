#!/usr/bin/env python3
"""M3b — the backfill run (ToDo §8.6).

    tracks LEFT JOIN local_vectors  →  decode → 12 windows → mel → CLAP → mean-pool
                                    →  L2-normalise → local_vectors, one commit per track

The whole library through the encoder, in one pass that can be killed at any
moment and resumed with no loss beyond the track in flight.

⚠️ **RESUMABLE FROM THE FIRST COMMIT, NOT AFTER THE FIRST LONG RUN DIES**
(Trap 17). Progress is not a counter anyone has to remember to write — it is the
absence of a join partner. `index.pending('local_vectors')` asks *which tracks
have no vector yet*, and the answer is correct whether the last run finished, was
Ctrl-C'd at track 9,000, or died when the mount dropped. There is no state file
to go out of sync with the index, because there is no state file.

⚠️ **FAILURES ARE DATA.** A corrupt FLAC, a zero-length file, a share that
disappears mid-read: the row is marked `failed` with its error text and the batch
continues. One bad file out of 15,326 must not kill a three-hour run, and the
post-run triage should read the index rather than scrollback from a run that
ended in the middle of the night.

⚠️ **`tracks.status` IS SHARED BY BOTH ARMS**, so a failure here also drops the
row out of §8.4's descriptor queue. That is right for the failure that actually
happens — an unreadable file fails both arms — and wrong for an encoder-specific
one, which is what `--retry-failed` is for. Worth knowing before reading a
`failed` row as "this file is bad": read the error text, which says which stage
died.

# THE SHAPE, AND WHY IT IS THIS SHAPE

§8.6 specifies parallel decode readers feeding a serial ONNX session, because
Trap 19 says the CIFS mount is the bottleneck. §8.5 then measured that at this
stage it is not — the model is. Both readings are right, and the arrangement that
satisfies both is the one below, with every number measured on this machine
rather than assumed:

    3 reader threads                     1 main thread
    decode (0.38 s median, wire-bound)   ONNX session, 8 intra-op threads
    + 12 × mel (30 ms each)              0.058 s/window × 12 = 0.70 s/track
    = 0.74 s/track each                        ↑
          └────────── bounded queue (4) ───────┘

  * **Decode parallelism plateaus at 3.** Measured over 24 uncached tracks per
    setting: 1 worker 81 MB/s, 2 → 107, 3 → 110, 4 → 109, 8 → 112. The share gives
    ~35% over a single stream and then nothing, so a fourth reader buys latency
    smoothing at best. Three readers supply ~4 tracks/s against a model that
    consumes ~1.4 — the wire is hidden completely behind the session.
  * **The mel belongs to the readers, and that is a 33% win.** It costs 30 ms per
    window against the model's 58 ms, so computing it on the main thread would
    add a third to the run's wall clock while three reader threads sit blocked on
    the network. `encoder.window_features` is exactly this split.
  * **The queue is bounded, and that is not tidiness.** The library's longest
    file is a two-hour, 545 MB FLAC that decodes to **1.4 GB** of float32. A
    queue of decoded SIGNALS with several of those in flight is an OOM waiting to
    happen — which is why what crosses the queue is the FEATURE TENSOR (12 × 1001
    × 64 float32 = **3.1 MB**), built in the reader and bounded by the cap. Peak
    memory is then a reader's transient decode buffer, not the queue.
  * **One writer.** The sqlite connection is touched only by the main thread. WAL
    is on and `synchronous=NORMAL`, so a commit per track is cheap and Ctrl-C
    safe at any point.
  * **`config.using(config.ENCODER)` wraps the WHOLE run**, once. The profile
    swaps module globals, so it is process-wide rather than thread-local — the
    readers must therefore be inside it, not each opening their own. That is why
    `config.using` allows re-entering the same profile and refuses a different
    one (§8.5).

Not taken, so it is not re-derived: decoding only the seconds the 12 windows
need, via ffmpeg `-ss`/`-t`, to cut both the wire and the memory. It would be 12
subprocess spawns and 12 network seeks per track against ONE whole-file read that
already costs 0.38 s and is fully hidden behind the model. It would also be a
second decode path, and the sample alignment of the two would have to be argued
rather than observed. Rejected on the measurement, not on taste.
"""
import queue
import sys
import threading
import time

import audio
import config
import encoder
import index

# 3 readers, measured: the CIFS mount plateaus there, and a fourth thread buys
# nothing but a fourth transient decode buffer.
DECODE_WORKERS = 3

# Feature tensors in flight, not decoded signals — 3.1 MB each at the default cap.
# Deep enough that a slow read never starves the session, shallow enough that the
# readers block instead of racing ahead through the library.
PREFETCH = 4

# How often the progress line is rewritten. The session is busy for ~0.7 s per
# track, so a line per track is already unhurried; this only keeps a fast
# `--limit` run from flickering.
PROGRESS_EVERY = 0.25



class _Reader(threading.Thread):
    """Decode + featurise, until the jobs run out or the run is stopped.

    Everything expensive and GIL-releasing happens here: `subprocess` for the
    decode, numpy for the mel. Everything that must be serial — the session and
    the database — happens on the main thread.
    """

    def __init__(self, jobs, results, stop, max_windows):
        super().__init__(daemon=True)
        self.jobs, self.results, self.stop = jobs, results, stop
        self.max_windows = max_windows

    def run(self):
        while not self.stop.is_set():
            try:
                row = self.jobs.get_nowait()
            except queue.Empty:
                return
            try:
                signal = audio.decode(row['path'], sr=config.SR)
                tensor = encoder.window_features(signal, max_windows=self.max_windows)
                seconds = audio.duration_of(signal, sr=config.SR)
                del signal                       # before the queue put, not after
                payload = (row, tensor, seconds, None)
            except Exception as exc:             # DecodeError, EncoderError, OSError
                payload = (row, None, None, exc)
            # A bounded put is the backpressure: when the session is the slow
            # half — which is always — the readers park here rather than pulling
            # the whole library into memory.
            while not self.stop.is_set():
                try:
                    self.results.put(payload, timeout=0.2)
                    break
                except queue.Full:
                    continue


class Progress:
    """Counts and rates for one run, and the one-line rendering of them."""

    def __init__(self, total):
        self.total = total
        self.done = self.failed = 0
        self.bytes = 0
        self.seconds = 0.0
        self.started = time.time()

    @property
    def elapsed(self):
        return max(time.time() - self.started, 1e-9)

    @property
    def rate(self):
        return (self.done + self.failed) / self.elapsed

    def eta(self):
        left = self.total - self.done - self.failed
        return left / self.rate if self.rate > 0 else 0.0

    def line(self):
        return (f'  {self.done + self.failed}/{self.total}  '
                f'{self.rate:5.2f} track/s  '
                f'{self.bytes / self.elapsed / 1e6:6.1f} MB/s  '
                f'{self.seconds / 3600:6.1f} audio-h  '
                f'{self.failed} failed  '
                f'elapsed {_hms(self.elapsed)}  eta {_hms(self.eta())}')


def _hms(seconds):
    seconds = int(seconds)
    return f'{seconds // 3600}:{seconds // 60 % 60:02d}:{seconds % 60:02d}'


def run(conn, rows, workers=DECODE_WORKERS, max_windows=None, prefetch=PREFETCH,
        report=None, batch_size=encoder.BATCH_WINDOWS):
    """Embed every track in `rows` into `local_vectors`. Returns a `Progress`.

    One commit per track (Trap 17). Ctrl-C sets the stop flag, drains the readers
    and returns what was finished — the caller sees a summary rather than a
    traceback, and the index is consistent either way.
    """
    progress = Progress(len(rows))
    if not rows:
        return progress

    stamp = encoder.recipe(max_windows)
    jobs = queue.Queue()
    for row in rows:
        jobs.put(row)
    results = queue.Queue(maxsize=max(1, prefetch))
    stop = threading.Event()

    # ⚠️ ONE context for the entire run, entered before any reader starts. The
    # profile is process-wide (it swaps module globals), so a reader that entered
    # its own would be a second switch in another thread — the exact race
    # config.using refuses. Entered here, every thread reads consistent values.
    with config.using(config.ENCODER):
        index.assert_config(conn, 'local_vectors')
        index.assert_recipe(conn, 'local_vectors', stamp)
        conn.commit()

        readers = [_Reader(jobs, results, stop, max_windows) for _ in range(max(1, workers))]
        for reader in readers:
            reader.start()

        last_report = 0.0
        try:
            while progress.done + progress.failed < progress.total:
                try:
                    row, tensor, seconds, error = results.get(timeout=0.5)
                except queue.Empty:
                    if not any(r.is_alive() for r in readers) and results.empty():
                        break                     # readers gone: nothing more is coming
                    continue
                if error is None:
                    try:
                        vector = encoder.pool(encoder.embed_features(tensor, batch_size))
                    except Exception as exc:      # a model-side failure is data too
                        error = exc
                if error is None:
                    index.put_vector(conn, row['id'], vector,
                                     model=encoder.MODEL_ID, revision=encoder.REVISION,
                                     recipe=stamp)
                    index.mark_ok(conn, row['id'], duration=seconds)
                    progress.done += 1
                    progress.bytes += row['size'] or 0
                    progress.seconds += seconds or 0.0
                else:
                    index.mark_failed(conn, row['id'], error)
                    progress.failed += 1
                conn.commit()                     # per track — Trap 17
                if report and time.time() - last_report >= PROGRESS_EVERY:
                    last_report = time.time()
                    report(progress)
        except KeyboardInterrupt:
            stop.set()
            print('\n  interrupted — the index is consistent; re-run to resume',
                  file=sys.stderr)
        finally:
            stop.set()
            # Unblock any reader parked on a full queue, then let them finish.
            while not results.empty():
                try:
                    results.get_nowait()
                except queue.Empty:
                    break
            # A short join, not `audio.TIMEOUT_S`: a reader parked on the full
            # queue notices the stop within 0.2 s, and one mid-decode holds no
            # database handle — it is a daemon thread and the process may leave it.
            for reader in readers:
                reader.join(timeout=5.0)
        if report:
            report(progress)
    return progress


def failures(conn, limit=20):
    """The failed rows, for the triage that follows a long run."""
    return conn.execute(
        'SELECT path, error FROM tracks WHERE status=? ORDER BY id LIMIT ?',
        (index.FAILED, int(limit)),
    ).fetchall()


def _main(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--scan', action='store_true',
                        help='walk the library into `tracks` first')
    parser.add_argument('--limit', type=int, default=None,
                        help='stop after N tracks — a full run is never needed to '
                             'test a change')
    parser.add_argument('--artist', default=None,
                        help='path fragment filter, e.g. --artist "again&again"')
    parser.add_argument('--workers', type=int, default=DECODE_WORKERS)
    parser.add_argument('--max-windows', type=int, default=None,
                        help=f'windows per track (default {encoder.MAX_WINDOWS}); '
                             f'pass 0 for every window, at ~5x the cost')
    parser.add_argument('--prefetch', type=int, default=PREFETCH)
    parser.add_argument('--retry-failed', action='store_true',
                        help='include rows an earlier run marked failed')
    parser.add_argument('--failures', action='store_true',
                        help='print what failed and why, then exit')
    parser.add_argument('--status', action='store_true', help='index health, then exit')
    args = parser.parse_args(argv)

    conn = index.connect()
    try:
        if args.status:
            print(index.stats(conn))
            return 0
        if args.failures:
            rows = failures(conn, limit=args.limit or 20)
            for row in rows:
                print(f'{row["path"]}\n    {row["error"]}')
            print(f'{len(rows)} shown', file=sys.stderr)
            return 0

        if args.scan:
            started = time.time()
            found = index.ingest_scan(conn)
            print(f'scanned {found} files in {time.time() - started:.1f}s', file=sys.stderr)

        if not encoder.available():
            print('the encoder is unavailable — weights missing, or onnxruntime is '
                  'not importable in this interpreter. See music/models/README.md.',
                  file=sys.stderr)
            return 1

        # `--max-windows 0` means UNCAPPED, which is not the same as "unset":
        # unset (None) takes `encoder.MAX_WINDOWS`, and 0 is falsy all the way down
        # to `windows()`, which reads it as no cap at all.
        max_windows = args.max_windows
        rows = index.pending(conn, 'local_vectors', limit=args.limit,
                             artist=args.artist, retry_failed=args.retry_failed)
        print(f'{len(rows)} track(s) to embed · {args.workers} readers · '
              f'{encoder.INTRA_OP_THREADS} model threads · '
              f'{encoder.recipe(max_windows)}', file=sys.stderr)

        def report(progress):
            print('\r' + progress.line(), end='', file=sys.stderr, flush=True)

        progress = run(conn, rows, workers=args.workers, max_windows=max_windows,
                       prefetch=args.prefetch, report=report)
        print(f'\n{progress.done} embedded, {progress.failed} failed, '
              f'{_hms(progress.elapsed)} elapsed', file=sys.stderr)
        print(index.stats(conn), file=sys.stderr)
        return 0
    finally:
        conn.close()


if __name__ == '__main__':
    raise SystemExit(_main())
