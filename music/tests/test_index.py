"""The index carries the resume ledger and the Trap 16 alarm, so that is what
these test — not that sqlite can store a blob.

Three properties are load-bearing and each has a failure mode with no symptom:
float32 round-tripping bit-exactly, `pending()` genuinely reflecting a LEFT JOIN
(so a killed run resumes where it died), and config drift raising rather than
mixing two incomparable vector sets in one table.
"""
import os
import tempfile
import unittest

import numpy as np

import config
import index


class IndexTestCase(unittest.TestCase):
    """Each test gets its own database file. `:memory:` would do for most of them,
    but the backfill runs against a real file with WAL on, and the connect() path
    under test sets pragmas that only mean anything on disk."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-index-')
        self.db = os.path.join(self.tmp, 'index.db')
        self.conn = index.connect(self.db)

    def tearDown(self):
        self.conn.close()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add(self, path, mtime=1.0, size=100):
        return index.upsert_track(self.conn, path, mtime, size)

    def vec(self, n=8, seed=0):
        rng = np.random.default_rng(seed)
        return rng.standard_normal(n).astype(np.float32)


class SchemaTest(IndexTestCase):
    def test_creates_the_four_tables(self):
        names = {r['name'] for r in self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({'tracks', 'local_vectors', 'descriptors', 'meta'} <= names)

    def test_connect_is_idempotent(self):
        # Re-opening an existing index must not wipe it — the backfill reconnects.
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m')
        self.conn.commit()
        self.conn.close()
        self.conn = index.connect(self.db)
        self.assertEqual(index.count_vectors(self.conn), 1)

    def test_foreign_keys_cascade(self):
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m')
        self.conn.execute('DELETE FROM tracks WHERE id=?', (tid,))
        self.assertEqual(index.count_vectors(self.conn), 0)


class BlobTest(IndexTestCase):
    def test_float32_roundtrips_bit_exactly(self):
        v = self.vec(64, seed=7)
        back = index.from_blob(index.to_blob(v))
        np.testing.assert_array_equal(v, back)
        self.assertEqual(back.dtype, np.dtype('float32'))

    def test_rejects_float64(self):
        # The one that matters: numpy defaults to float64, so a mean-pool over
        # windows returns float64. Storing it writes double the bytes and reads
        # back as a vector of double the length made of garbage — no error at all
        # without this guard.
        with self.assertRaises(ValueError):
            index.to_blob(np.zeros(8, dtype=np.float64))

    def test_rejects_2d(self):
        with self.assertRaises(ValueError):
            index.to_blob(np.zeros((2, 4), dtype=np.float32))

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            index.to_blob(np.zeros(0, dtype=np.float32))

    def test_dim_recorded_matches_the_vector(self):
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(37), model='m')
        row = self.conn.execute('SELECT dim FROM local_vectors WHERE track_id=?',
                                (tid,)).fetchone()
        self.assertEqual(row['dim'], 37)


class UpsertTest(IndexTestCase):
    def test_same_path_is_one_row(self):
        a = self.add('/a.flac')
        b = self.add('/a.flac')
        self.assertEqual(a, b)
        self.assertEqual(self.conn.execute(
            'SELECT COUNT(*) AS n FROM tracks').fetchone()['n'], 1)

    def test_unchanged_rescan_preserves_status(self):
        # A re-scan must not reset the ledger, or every run starts from zero.
        tid = self.add('/a.flac', mtime=5.0, size=10)
        index.mark_ok(self.conn, tid, duration=1.5)
        self.add('/a.flac', mtime=5.0, size=10)
        row = index.track_by_path(self.conn, '/a.flac')
        self.assertEqual(row['status'], index.OK)
        self.assertEqual(row['duration'], 1.5)

    def test_changed_file_resets_and_drops_vectors(self):
        # The bytes changed, so anything computed from them describes a file that
        # no longer exists.
        tid = self.add('/a.flac', mtime=5.0, size=10)
        index.put_vector(self.conn, tid, self.vec(), model='m')
        index.mark_ok(self.conn, tid)
        self.add('/a.flac', mtime=9.0, size=99)
        row = index.track_by_path(self.conn, '/a.flac')
        self.assertEqual(row['status'], index.PENDING)
        self.assertIsNone(index.get_vector(self.conn, tid))

    def test_hostile_paths_store_verbatim(self):
        p = "/mnt/Luna/Plex/Music/again&again/Today's Lesson [16B-44.1kHz].flac"
        tid = self.add(p)
        self.assertEqual(index.track_by_path(self.conn, p)['id'], tid)


class LedgerTest(IndexTestCase):
    def test_pending_is_the_left_join(self):
        a, b = self.add('/a.flac'), self.add('/b.flac')
        self.assertEqual({r['id'] for r in index.pending(self.conn)}, {a, b})
        index.put_vector(self.conn, a, self.vec(), model='m')
        self.assertEqual([r['id'] for r in index.pending(self.conn)], [b])

    def test_resumes_where_it_died(self):
        """The Trap 17 property, stated as a test: kill the run partway and the
        next invocation asks for exactly the remainder."""
        ids = [self.add(f'/t{i}.flac') for i in range(10)]
        for tid in ids[:6]:                       # 6 done, then Ctrl-C
            index.put_vector(self.conn, tid, self.vec(), model='m')
        self.conn.commit()
        self.assertEqual([r['id'] for r in index.pending(self.conn)], ids[6:])

    def test_failed_rows_are_excluded_then_retryable(self):
        a, b = self.add('/a.flac'), self.add('/b.flac')
        index.mark_failed(self.conn, a, 'corrupt')
        self.assertEqual([r['id'] for r in index.pending(self.conn)], [b])
        self.assertEqual({r['id'] for r in index.pending(self.conn, retry_failed=True)},
                         {a, b})

    def test_failure_text_is_kept(self):
        tid = self.add('/a.flac')
        index.mark_failed(self.conn, tid, 'ffmpeg failed (1): bad header')
        self.assertIn('bad header', index.track_by_path(self.conn, '/a.flac')['error'])

    def test_limit_and_artist_filters(self):
        self.add('/music/AFI/one.flac')
        self.add('/music/AFI/two.flac')
        self.add('/music/Atwood/three.flac')
        self.assertEqual(len(index.pending(self.conn, limit=2)), 2)
        self.assertEqual(len(index.pending(self.conn, artist='AFI')), 2)

    def test_descriptors_have_their_own_ledger(self):
        # The two arms progress independently: embedding a track must not make it
        # look descriptor-complete, or §8.4's baseline would silently skip rows.
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m')
        self.assertEqual([r['id'] for r in index.pending(self.conn, 'descriptors')], [tid])


class ConfigDriftTest(IndexTestCase):
    def test_empty_store_adopts_the_current_config(self):
        self.assertEqual(index.assert_config(self.conn), config.signature())

    def test_drift_raises_once_vectors_exist(self):
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m')
        original = config.SR
        config.SR = 48000                       # what §8.5 might do to match an encoder
        try:
            with self.assertRaises(index.ConfigDriftError):
                index.put_vector(self.conn, tid, self.vec(), model='m')
        finally:
            config.SR = original

    def test_drift_is_allowed_when_the_store_is_empty(self):
        # §8.5 legality: change config.py to match the chosen encoder, clear the
        # vectors, re-run. That path must not be blocked.
        original = config.SR
        config.SR = 48000
        try:
            index.assert_config(self.conn)
            self.assertEqual(index.get_meta(self.conn, 'config_sig'), config.signature())
        finally:
            config.SR = original

    def test_signature_stored_on_every_vector(self):
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m')
        row = self.conn.execute('SELECT config_sig FROM local_vectors').fetchone()
        self.assertEqual(row['config_sig'], config.signature())


class MatrixTest(IndexTestCase):
    def test_load_matrix_shape_and_order(self):
        ids = [self.add(f'/t{i}.flac') for i in range(5)]
        for i, tid in enumerate(ids):
            index.put_vector(self.conn, tid, self.vec(16, seed=i), model='m')
        m, paths, got = index.load_matrix(self.conn)
        self.assertEqual(m.shape, (5, 16))
        self.assertEqual(m.dtype, np.dtype('float32'))
        self.assertEqual(got, ids)              # parallel arrays stay aligned
        self.assertEqual(paths[0], '/t0.flac')

    def test_empty_store(self):
        m, paths, ids = index.load_matrix(self.conn)
        self.assertEqual(len(paths), 0)
        self.assertEqual(len(ids), 0)
        self.assertEqual(m.shape[0], 0)

    def test_mixed_dimensions_refuse_to_stack(self):
        # Two encoders in one table. Stacking would raise deep inside numpy or,
        # worse, broadcast; refusing here names the actual problem.
        a, b = self.add('/a.flac'), self.add('/b.flac')
        index.put_vector(self.conn, a, self.vec(8), model='m1')
        index.put_vector(self.conn, b, self.vec(16), model='m2')
        with self.assertRaises(ValueError):
            index.load_matrix(self.conn)

    def test_rejects_unknown_table(self):
        # The table name is interpolated into SQL, so the allowlist is the thing
        # keeping that safe. Worth a test rather than a comment.
        for fn in (index.pending, index.load_matrix):
            with self.assertRaises(ValueError):
                fn(self.conn, 'items; DROP TABLE tracks')


if __name__ == '__main__':
    unittest.main()
