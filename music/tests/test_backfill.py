"""§8.6 under test — the run that must survive being killed.

The backfill's job is not arithmetic, it is *bookkeeping under interruption*, so
that is what these check: that the ledger is a LEFT JOIN and not a counter, that
one bad file marks itself and the batch carries on, that a second run does not
redo finished work, and that everything computes under the encoder's profile
rather than whatever happened to be in force.

⚠️ **NONE OF THIS NEEDS THE WEIGHTS**, and that is a property of the design
rather than of the test. §8.6 splits the pipeline so the parallel half
(`decode → windows → mel`) is pure numpy and the serial half is one function,
`encoder.embed_features`. Stubbing that single seam leaves every line of the
backfill under test — the readers really decode real FLACs and really compute
real mels. The forward pass is checked in `test_encoder.py`, where it belongs.
"""
import os
import shutil
import tempfile
import unittest

import numpy as np

import audio
import backfill
import config
import encoder
import index
import scan

from . import helpers


def stub_embeddings(tensor, batch_size=8):
    """Stand-in for the ONNX forward pass: one deterministic vector per window.

    Derived from the tensor's own contents, so two different tracks cannot
    accidentally produce the same vector and make a wrong-row bug invisible.
    """
    seeds = np.asarray(tensor, dtype=np.float64).reshape(len(tensor), -1).sum(axis=1)
    out = np.empty((len(tensor), encoder.DIM), dtype=np.float32)
    for i, seed in enumerate(seeds):
        rng = np.random.default_rng(abs(int(seed * 1000)) % (2 ** 32))
        out[i] = rng.standard_normal(encoder.DIM).astype(np.float32)
    return out


@unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg is required to build fixtures')
class BackfillTestCase(unittest.TestCase):
    """Real FLACs, real decode, real mel, stubbed forward pass."""

    N_TRACKS = 4
    SECONDS = 3.0

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-backfill-')
        self.db = os.path.join(self.tmp, 'index.db')
        self.conn = index.connect(self.db)
        self.paths = [
            helpers.make_sine_flac(self.tmp, seconds=self.SECONDS, freq=220.0 * (i + 1),
                                   name=f'{helpers.HOSTILE_NAME} {i}')
            for i in range(self.N_TRACKS)
        ]
        for path in self.paths:
            index.upsert_track(self.conn, path, os.path.getmtime(path),
                               os.path.getsize(path))
        self.conn.commit()
        self.real_embed_features = encoder.embed_features
        encoder.embed_features = stub_embeddings

    def tearDown(self):
        encoder.embed_features = self.real_embed_features
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pending(self, **kwargs):
        return index.pending(self.conn, 'local_vectors', **kwargs)

    def run_backfill(self, rows=None, **kwargs):
        kwargs.setdefault('workers', 2)
        kwargs.setdefault('prefetch', 2)
        return backfill.run(self.conn, self.pending() if rows is None else rows, **kwargs)


class HappyPathTest(BackfillTestCase):
    def test_every_track_gets_one_unit_vector_and_is_marked_ok(self):
        progress = self.run_backfill()
        self.assertEqual((progress.done, progress.failed), (self.N_TRACKS, 0))
        matrix, paths, _ = index.load_matrix(self.conn, 'local_vectors')
        self.assertEqual(matrix.shape, (self.N_TRACKS, encoder.DIM))
        self.assertEqual(matrix.dtype, np.dtype('float32'))
        np.testing.assert_allclose(np.linalg.norm(matrix, axis=1), 1.0, atol=1e-5)
        self.assertEqual(sorted(paths), sorted(self.paths))
        for row in self.conn.execute('SELECT status, duration FROM tracks'):
            self.assertEqual(row['status'], index.OK)
            self.assertAlmostEqual(row['duration'], self.SECONDS, places=1)

    def test_each_track_gets_its_own_vector(self):
        """A wrong-row bug — the vector of track A stored against track B — is
        invisible in every count. Distinct fixtures make it visible."""
        self.run_backfill()
        matrix, _, _ = index.load_matrix(self.conn, 'local_vectors')
        similarity = matrix @ matrix.T
        np.fill_diagonal(similarity, 0.0)
        self.assertLess(float(np.abs(similarity).max()), 0.99)

    def test_no_rows_is_a_no_op(self):
        progress = backfill.run(self.conn, [])
        self.assertEqual((progress.done, progress.failed, progress.total), (0, 0, 0))

    def test_progress_reports_at_least_once_and_finishes_on_the_total(self):
        seen = []
        self.run_backfill(report=seen.append)
        self.assertTrue(seen)
        self.assertEqual(seen[-1].done + seen[-1].failed, seen[-1].total)
        self.assertIn('track/s', seen[-1].line())


class FailuresAreDataTest(BackfillTestCase):
    """One bad file out of 15,326 must not kill a three-hour run."""

    def test_an_undecodable_file_marks_its_row_and_the_batch_continues(self):
        broken = os.path.join(self.tmp, 'broken.flac')
        with open(broken, 'wb') as handle:
            handle.write(b'ID3 this is not audio')
        index.upsert_track(self.conn, broken, 1.0, 21)
        self.conn.commit()

        progress = self.run_backfill()
        self.assertEqual((progress.done, progress.failed), (self.N_TRACKS, 1))
        row = index.track_by_path(self.conn, broken)
        self.assertEqual(row['status'], index.FAILED)
        self.assertTrue(row['error'])
        self.assertIsNone(index.get_vector(self.conn, row['id']))

    def test_a_missing_file_is_a_failure_not_a_crash(self):
        index.upsert_track(self.conn, os.path.join(self.tmp, 'gone.flac'), 1.0, 1)
        self.conn.commit()
        progress = self.run_backfill()
        self.assertEqual(progress.failed, 1)
        self.assertEqual(progress.done, self.N_TRACKS)

    def test_a_model_side_failure_is_data_too(self):
        """The readers are not the only place a track can die. A forward pass
        that throws must mark its row exactly like a corrupt file, or a single
        bad tensor takes the whole run down at hour two."""
        calls = []

        def sometimes_broken(tensor, batch_size=8):
            calls.append(1)
            if len(calls) == 2:
                raise encoder.EncoderError('synthetic model failure')
            return stub_embeddings(tensor, batch_size)

        encoder.embed_features = sometimes_broken
        progress = self.run_backfill()
        self.assertEqual((progress.done, progress.failed), (self.N_TRACKS - 1, 1))
        failed = [r for r in self.conn.execute(
            'SELECT error FROM tracks WHERE status=?', (index.FAILED,))]
        self.assertEqual(len(failed), 1)
        self.assertIn('synthetic model failure', failed[0]['error'])

    def test_failed_rows_are_left_out_of_the_next_run(self):
        index.upsert_track(self.conn, os.path.join(self.tmp, 'gone.flac'), 1.0, 1)
        self.conn.commit()
        self.run_backfill()
        self.assertEqual(self.pending(), [])
        self.assertEqual(len(self.pending(retry_failed=True)), 1)


class ResumeTest(BackfillTestCase):
    """Trap 17: resumable from the FIRST commit, not after the first long run
    dies. Progress is the absence of a join partner."""

    def test_a_second_run_only_does_what_is_left(self):
        first = self.run_backfill(rows=self.pending(limit=2))
        self.assertEqual(first.done, 2)
        left = self.pending()
        self.assertEqual(len(left), self.N_TRACKS - 2)

        second = self.run_backfill(rows=left)
        self.assertEqual(second.done, self.N_TRACKS - 2)
        self.assertEqual(self.pending(), [])

    def test_finished_work_is_not_recomputed(self):
        self.run_backfill(rows=self.pending(limit=2))
        before = {r['track_id']: bytes(r['vector']) for r in
                  self.conn.execute('SELECT track_id, vector FROM local_vectors')}
        self.run_backfill()
        after = {r['track_id']: bytes(r['vector']) for r in
                 self.conn.execute('SELECT track_id, vector FROM local_vectors')}
        self.assertEqual(len(after), self.N_TRACKS)
        for track_id, blob in before.items():
            self.assertEqual(after[track_id], blob)

    def test_a_commit_lands_per_track_not_per_run(self):
        """The property that makes a kill at track 9,000 cost one track, and the
        only way to observe it is from OUTSIDE the writing connection — a second
        connection sees committed rows and nothing else."""
        seen = []
        witness = index.connect(self.db)
        interval = backfill.PROGRESS_EVERY
        backfill.PROGRESS_EVERY = 0.0          # a report per track, not per 250 ms
        try:
            def peek(progress):
                seen.append(witness.execute(
                    'SELECT COUNT(*) AS n FROM local_vectors').fetchone()['n'])

            self.run_backfill(report=peek)
        finally:
            backfill.PROGRESS_EVERY = interval
            witness.close()
        self.assertEqual(seen[:self.N_TRACKS], list(range(1, self.N_TRACKS + 1)))


class PipelineShapeTest(BackfillTestCase):
    """The arrangement §8.6 specifies, tested where it can actually be observed."""

    def test_what_crosses_the_queue_is_a_feature_tensor_not_the_signal(self):
        """⚠️ The OOM this design avoids. The library's longest file decodes to
        1.4 GB of float32; a bounded queue of decoded SIGNALS would hold several
        of those at once. Feature tensors are ~3 MB and bounded by the cap."""
        shapes = []

        def record(tensor, batch_size=8):
            shapes.append(tensor.shape)
            return stub_embeddings(tensor, batch_size)

        encoder.embed_features = record
        long_path = helpers.make_sine_flac(self.tmp, seconds=45.0, name='long one')
        index.upsert_track(self.conn, long_path, os.path.getmtime(long_path),
                           os.path.getsize(long_path))
        self.conn.commit()
        self.run_backfill(rows=[index.track_by_path(self.conn, long_path)],
                          max_windows=2)

        with config.using(config.ENCODER):
            frames, mels = encoder.expected_frames(), config.N_MELS
            decoded_bytes = int(45.0 * config.SR) * 4
        self.assertEqual(len(shapes), 1)
        self.assertEqual(shapes[0], (2, 1, frames, mels))
        tensor_bytes = int(np.prod(shapes[0])) * 4
        self.assertLess(tensor_bytes, decoded_bytes)

    def test_the_cap_reaches_the_readers(self):
        counts = []

        def record(tensor, batch_size=8):
            counts.append(len(tensor))
            return stub_embeddings(tensor, batch_size)

        encoder.embed_features = record
        long_path = helpers.make_sine_flac(self.tmp, seconds=45.0, name='long one')
        index.upsert_track(self.conn, long_path, os.path.getmtime(long_path),
                           os.path.getsize(long_path))
        self.conn.commit()
        row = index.track_by_path(self.conn, long_path)
        self.run_backfill(rows=[row], max_windows=2)
        self.assertEqual(counts, [2])

    def test_the_whole_run_computes_under_the_encoder_profile(self):
        """⚠️ Trap 16, and the reason `config.using` wraps the run rather than
        each track: the profile swaps module globals, so it is process-wide. A
        reader computing a mel under the baseline while the vector is stored
        under the encoder's signature is the corruption with no symptom."""
        signatures = []

        def record(tensor, batch_size=8):
            signatures.append(config.signature())
            return stub_embeddings(tensor, batch_size)

        encoder.embed_features = record
        self.run_backfill()
        self.assertTrue(signatures)
        self.assertEqual(set(signatures), {config.ENCODER.signature()})
        for row in self.conn.execute('SELECT config_sig FROM local_vectors'):
            self.assertEqual(row['config_sig'], config.ENCODER.signature())

    def test_the_profile_is_restored_when_the_run_ends(self):
        before = config.signature()
        self.run_backfill()
        self.assertEqual(config.signature(), before)


class RecipeStampTest(BackfillTestCase):
    """The window cap changes the vectors, so it is recorded where they live."""

    def test_the_run_stamps_its_recipe(self):
        self.run_backfill(max_windows=3)
        self.assertEqual(index.get_meta(self.conn, 'recipe:local_vectors'),
                         encoder.recipe(3))

    def test_a_second_run_under_a_different_cap_is_refused(self):
        self.run_backfill(rows=self.pending(limit=1), max_windows=3)
        with self.assertRaises(index.RecipeDriftError):
            self.run_backfill(rows=self.pending(limit=1), max_windows=6)

    def test_the_recipe_names_the_model_the_window_and_the_cap(self):
        stamp = encoder.recipe(12)
        self.assertIn(encoder.MODEL_ID, stamp)
        self.assertIn(encoder.REVISION[:8], stamp)
        self.assertIn('max12', stamp)
        self.assertIn('meanpool-l2', stamp)
        self.assertNotEqual(stamp, encoder.recipe(8))
        self.assertIn('maxnone', encoder.recipe(0))


class CircuitBreakerTest(BackfillTestCase):
    """⚠️ "Failures are data" is right for one corrupt FLAC and catastrophic for
    one dropped mount.

    Over CIFS a vanished share does not hang — ffmpeg returns ENOENT in
    milliseconds — so a blip in hour two marks *every remaining track* failed in
    about a minute, and `index.pending` excludes failed rows, so the obvious
    recovery (run it again) then skips all thirteen thousand of them and reports
    a finished library. That is a silent, total loss wearing the face of success.
    These pin both halves of the guard.
    """

    def queue_missing(self, n):
        """`n` rows pointing at files that are not there, oldest first."""
        rows = []
        for i in range(n):
            path = os.path.join(self.tmp, f'absent-{i:03d}.flac')
            index.upsert_track(self.conn, path, 1.0, 1)
            rows.append(path)
        self.conn.commit()
        return rows

    def test_an_unreachable_library_root_stops_the_run_and_marks_nothing(self):
        """The mount is not this track's fault, so it must not get this track's
        mark. The rows stay `pending` and the next run needs no flag."""
        self.queue_missing(40)
        rows = self.pending()
        saved, config.LIBRARY_ROOT = config.LIBRARY_ROOT, os.path.join(self.tmp, 'not-mounted')
        try:
            progress = backfill.run(self.conn, rows, workers=2, prefetch=2)
        finally:
            config.LIBRARY_ROOT = saved
        self.assertIsNotNone(progress.aborted)
        self.assertIn('not reachable', progress.aborted)
        self.assertEqual(progress.failed, 0)
        self.assertEqual(
            self.conn.execute('SELECT COUNT(*) AS n FROM tracks WHERE status=?',
                              (index.FAILED,)).fetchone()['n'], 0)
        # …and everything it did not reach is still in the queue.
        self.assertGreater(len(self.pending()), 30)

    def test_a_run_of_failures_with_the_shelf_present_stops_after_the_threshold(self):
        """A live shelf and dead files is systemic in some other way — a full
        disk, deleted weights. Those rows DID fail, so they are marked; the run
        still stops rather than burning the queue."""
        self.queue_missing(backfill.ABORT_AFTER * 3)
        saved, config.LIBRARY_ROOT = config.LIBRARY_ROOT, self.tmp   # the shelf IS there
        try:
            progress = backfill.run(self.conn, self.pending(), workers=2, prefetch=2)
        finally:
            config.LIBRARY_ROOT = saved
        self.assertIsNotNone(progress.aborted)
        self.assertIn('in a row', progress.aborted)
        self.assertEqual(progress.failed, backfill.ABORT_AFTER)

    def test_a_success_resets_the_counter(self):
        """The threshold counts CONSECUTIVE failures. A library that is merely
        patchy — a bad file here and there — must run to the end."""
        self.queue_missing(backfill.ABORT_AFTER - 1)
        saved, config.LIBRARY_ROOT = config.LIBRARY_ROOT, self.tmp
        try:
            progress = backfill.run(self.conn, self.pending(), workers=1, prefetch=1)
        finally:
            config.LIBRARY_ROOT = saved
        self.assertIsNone(progress.aborted)
        self.assertEqual(progress.done, self.N_TRACKS)

    def test_library_reachable_answers_for_the_root_not_the_track(self):
        self.assertTrue(scan.library_reachable(self.tmp))
        self.assertFalse(scan.library_reachable(os.path.join(self.tmp, 'nope')))


class LateBindingTest(unittest.TestCase):
    """⚠️ A default argument is evaluated ONCE, at import.

    `audio.decode(path, sr=SR)` over a `from config import SR` therefore froze
    the sample rate of whichever profile happened to be in force the first time
    `audio` was imported — and three call sites import it lazily, inside
    functions, one of which sits inside `with config.using(ENCODER)`. The result
    is a baseline descriptor computed from a 48 kHz decode: no exception, no NaN,
    a confidently wrong vector. Trap 16 arriving through Python's scoping rules
    rather than through arithmetic.
    """

    def test_decode_reads_the_rate_in_force_at_call_time(self):
        with config.using(config.ENCODER):
            self.assertEqual(config.SR, 48000)
        # The signature must not have captured anything.
        import inspect
        self.assertIsNone(inspect.signature(audio.decode).parameters['sr'].default)
        self.assertIsNone(inspect.signature(audio.duration_of).parameters['sr'].default)

    def test_duration_of_follows_the_profile(self):
        samples = np.zeros(48000, dtype=np.float32)
        self.assertAlmostEqual(audio.duration_of(samples), 48000 / 22050.0, places=6)
        with config.using(config.ENCODER):
            self.assertAlmostEqual(audio.duration_of(samples), 1.0, places=6)

    def test_the_scan_root_is_read_at_call_time_too(self):
        """Same defect, same file family: `iter_tracks(root=LIBRARY_ROOT)` made
        `config.LIBRARY_ROOT` — the documented way to run without the mount —
        do nothing at all."""
        import inspect
        self.assertIsNone(inspect.signature(scan.iter_tracks).parameters['root'].default)
        tmp = tempfile.mkdtemp(prefix='music-root-')
        try:
            saved, config.LIBRARY_ROOT = config.LIBRARY_ROOT, tmp
            try:
                self.assertEqual(scan.scan(), [])          # empty, not the real shelf
            finally:
                config.LIBRARY_ROOT = saved
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class ProgressTest(unittest.TestCase):
    """Arithmetic only — no audio, no index."""

    def test_eta_is_the_remainder_at_the_observed_rate(self):
        progress = backfill.Progress(100)
        progress.started -= 10.0
        progress.done = 20
        self.assertAlmostEqual(progress.rate, 2.0, places=1)
        self.assertAlmostEqual(progress.eta(), 40.0, delta=1.0)

    def test_eta_is_zero_before_anything_finishes(self):
        self.assertEqual(backfill.Progress(10).eta(), 0.0)

    def test_hms_reads_as_a_clock(self):
        self.assertEqual(backfill._hms(3661), '1:01:01')
        self.assertEqual(backfill._hms(59), '0:00:59')


if __name__ == '__main__':
    unittest.main()
