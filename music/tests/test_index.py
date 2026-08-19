"""The index carries the resume ledger and the Trap 16 alarm, so that is what
these test — not that sqlite can store a blob.

Three properties are load-bearing and each has a failure mode with no symptom:
float32 round-tripping bit-exactly, `pending()` genuinely reflecting a LEFT JOIN
(so a killed run resumes where it died), and config drift raising rather than
mixing two incomparable vector sets in one table.
"""
import os
import shutil
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
        self.assertEqual(index.assert_config(self.conn, 'local_vectors'), config.signature())

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
            index.assert_config(self.conn, 'local_vectors')
            self.assertEqual(index.get_meta(self.conn, 'config_sig:local_vectors'),
                             config.signature())
        finally:
            config.SR = original

    def test_the_two_arms_carry_independent_signatures(self):
        """⚠️ §8.5's central structural change. The encoder analyses under CLAP's
        profile and the §8.4 baseline under its own, ON PURPOSE — adopting CLAP's
        48 kHz / 1024-sample STFT globally would move the baseline's chroma floor
        from 181 Hz to 788 Hz and weaken the very opponent M4 needs. One shared
        key would make that legitimate arrangement raise.
        """
        tid = self.add('/a.flac')
        index.put_descriptor(self.conn, tid, self.vec())
        with config.using(config.ENCODER):
            index.put_vector(self.conn, tid, self.vec(), model='clap')
            encoder_sig = config.signature()
        self.assertNotEqual(encoder_sig, config.signature())
        self.assertEqual(index.get_meta(self.conn, 'config_sig:descriptors'),
                         config.signature())
        self.assertEqual(index.get_meta(self.conn, 'config_sig:local_vectors'), encoder_sig)

    def test_drift_within_one_arm_still_raises_under_profiles(self):
        """The invariant Trap 16 actually names — every vector in ONE space
        computed under ONE configuration — must survive the split."""
        tid = self.add('/a.flac')
        with config.using(config.ENCODER):
            index.put_vector(self.conn, tid, self.vec(), model='clap')
        with self.assertRaises(index.ConfigDriftError):
            index.put_vector(self.conn, tid, self.vec(), model='other')

    def test_a_pre_profile_index_keeps_its_alarm(self):
        """An index built before §8.5 stamped one shared `config_sig`. Adopting it
        per table matters: re-arming against whatever runs next would silently
        bless exactly the drift the key was written to catch."""
        tid = self.add('/a.flac')
        index.put_descriptor(self.conn, tid, self.vec())
        self.conn.execute("DELETE FROM meta WHERE key LIKE 'config_sig:%'")
        index.set_meta(self.conn, 'config_sig', 'deadbeef0000')
        with self.assertRaises(index.ConfigDriftError):
            index.put_descriptor(self.conn, tid, self.vec())
        self.assertEqual(index.get_meta(self.conn, 'config_sig:descriptors'), 'deadbeef0000')

    def test_an_empty_table_is_not_captured_by_the_legacy_key(self):
        """The legacy key is adopted only for a table that actually has rows —
        an empty one is free to adopt the profile in force, which is what keeps
        §8.5's 'clear and re-run' path open."""
        index.set_meta(self.conn, 'config_sig', 'deadbeef0000')
        self.assertEqual(index.assert_config(self.conn, 'local_vectors'), config.signature())

    def test_unknown_table_is_refused(self):
        with self.assertRaises(ValueError):
            index.assert_config(self.conn, 'tracks')

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


class RecipeDriftTest(IndexTestCase):
    """§8.6's alarm, one level up from the config signature.

    `config.signature()` fingerprints how a mel is BUILT. It says nothing about
    which mels a track's vector is the mean of — the window length, the overlap,
    the cap §8.6 pulled to 12, the pooling rule. Two vectors of one track pooled
    from 12 windows and from 41 sit at cosine ~0.997, so mixing the two recipes
    corrupts nothing outright and leaves no symptom at all; it just makes "what
    is this space" unanswerable later.
    """

    def test_an_empty_table_adopts_whatever_recipe_runs(self):
        self.assertEqual(index.assert_recipe(self.conn, 'local_vectors', 'r1'), 'r1')
        self.assertEqual(index.assert_recipe(self.conn, 'local_vectors', 'r2'), 'r2')

    def test_a_different_recipe_raises_once_vectors_exist(self):
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m', recipe='max12')
        with self.assertRaises(index.RecipeDriftError):
            index.put_vector(self.conn, self.add('/b.flac'), self.vec(),
                             model='m', recipe='max8')

    def test_the_same_recipe_is_a_no_op(self):
        for path in ('/a.flac', '/b.flac'):
            index.put_vector(self.conn, self.add(path), self.vec(),
                             model='m', recipe='max12')
        self.assertEqual(index.count_vectors(self.conn), 2)

    def test_clearing_the_table_makes_a_new_recipe_legal(self):
        """The escape hatch, and the only one: change the recipe, clear the
        table, re-run. Changing the recipe and ADDING is what raises."""
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m', recipe='max12')
        self.conn.execute('DELETE FROM local_vectors')
        index.put_vector(self.conn, tid, self.vec(), model='m', recipe='max8')
        self.assertEqual(index.get_meta(self.conn, 'recipe:local_vectors'), 'max8')

    def test_a_write_without_a_recipe_does_not_disturb_the_stamp(self):
        """§8.4's descriptor path passes no recipe. It must not clear the neural
        arm's stamp by omission — the check is opt-in, not opt-out."""
        tid = self.add('/a.flac')
        index.put_vector(self.conn, tid, self.vec(), model='m', recipe='max12')
        index.put_vector(self.conn, self.add('/b.flac'), self.vec(), model='m')
        self.assertEqual(index.get_meta(self.conn, 'recipe:local_vectors'), 'max12')

    def test_it_is_a_config_drift_error(self):
        """A subclass, so a caller guarding against "these vectors are not
        comparable" catches both kinds with one except."""
        self.assertTrue(issubclass(index.RecipeDriftError, index.ConfigDriftError))

    def test_unknown_table_is_refused(self):
        with self.assertRaises(ValueError):
            index.assert_recipe(self.conn, 'items; DROP TABLE tracks', 'r')


class IngestScanTest(IndexTestCase):
    """The walk lives here because `tracks` is the scan table AND the ledger, and
    two callers each filling it their own way is how two subtly different scans
    end up in one index."""

    def setUp(self):
        super().setUp()
        self.library = os.path.join(self.tmp, 'library')
        os.makedirs(os.path.join(self.library, 'artist', 'album'))
        self.files = []
        for name in ('01. a.flac', "02. Today's [16B].flac", '03. b.mp3'):
            full = os.path.join(self.library, 'artist', 'album', name)
            with open(full, 'wb') as handle:
                handle.write(b'not really audio')
            self.files.append(full)

    def test_walks_the_extensions_it_is_given(self):
        found = index.ingest_scan(self.conn, root=self.library)
        self.assertEqual(found, 2)                     # the .mp3 is not an AUDIO_EXT
        paths = [r['path'] for r in self.conn.execute('SELECT path FROM tracks')]
        self.assertTrue(any("Today's" in p for p in paths))

    def test_rescanning_preserves_the_ledger(self):
        """A second scan of an unchanged library must not reset progress — that
        would silently re-do a finished multi-hour run."""
        index.ingest_scan(self.conn, root=self.library)
        row = index.track_by_path(self.conn, self.files[0])
        index.put_vector(self.conn, row['id'], self.vec(), model='m')
        index.mark_ok(self.conn, row['id'], duration=1.0)
        self.conn.commit()

        index.ingest_scan(self.conn, root=self.library)
        self.assertEqual(len(index.pending(self.conn, 'local_vectors')), 1)
        self.assertEqual(index.track_by_path(self.conn, self.files[0])['status'],
                         index.OK)


class UpsertWithoutAStatTest(unittest.TestCase):
    """⚠️ `None` means "not observed", never "zero".

    Both stat arguments default to `None` so the call reads as an upsert-by-path
    — which is exactly how someone asks for a row id. The first version compared
    those defaults straight against the stored numbers, decided `12345.0 != None`
    meant the file had changed, reset the row to `pending` and **deleted its
    vectors**. Hours of encoder time, discarded by a call that looks like a read.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-upsert-')
        self.conn = index.connect(os.path.join(self.tmp, 'index.db'))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def stocked(self):
        tid = index.upsert_track(self.conn, '/lib/A/B/01. t.flac', 12345.0, 999)
        index.put_vector(self.conn, tid, np.zeros(8, dtype=np.float32), model='m')
        index.mark_ok(self.conn, tid, duration=1.0)
        self.conn.commit()
        return tid

    def test_a_bare_upsert_is_a_lookup_and_keeps_the_work(self):
        tid = self.stocked()
        self.assertEqual(index.upsert_track(self.conn, '/lib/A/B/01. t.flac'), tid)
        self.assertIsNotNone(index.get_vector(self.conn, tid))
        self.assertEqual(index.track_by_path(self.conn, '/lib/A/B/01. t.flac')['status'],
                         index.OK)

    def test_one_observed_field_is_still_compared(self):
        """Half a stat is not a reason to ignore the half you have."""
        tid = self.stocked()
        index.upsert_track(self.conn, '/lib/A/B/01. t.flac', size=1)
        self.assertIsNone(index.get_vector(self.conn, tid))

    def test_a_changed_file_still_drops_what_was_computed_from_it(self):
        tid = self.stocked()
        index.upsert_track(self.conn, '/lib/A/B/01. t.flac', 99999.0, 999)
        self.assertIsNone(index.get_vector(self.conn, tid))
        self.assertEqual(index.track_by_path(self.conn, '/lib/A/B/01. t.flac')['status'],
                         index.PENDING)


    def test_the_db_path_is_read_at_call_time(self):
        """⚠️ Third instance of the frozen-default defect. `connect(path=DB_PATH)`
        captured the constant at import, so redirecting `index.DB_PATH` at a
        scratch copy — the obvious way to exercise the pipeline without touching
        a real index — did nothing and the run wrote to the real one. It cost a
        live index five rows before it was noticed."""
        import inspect
        self.assertIsNone(inspect.signature(index.connect).parameters['path'].default)
        elsewhere = os.path.join(self.tmp, 'elsewhere.db')
        saved, index.DB_PATH = index.DB_PATH, elsewhere
        try:
            conn = index.connect()
            try:
                index.upsert_track(conn, '/lib/A/B/01. t.flac', 1.0, 1)
                conn.commit()
            finally:
                conn.close()
        finally:
            index.DB_PATH = saved
        self.assertTrue(os.path.exists(elsewhere))

    def test_opening_the_index_twice_does_not_rewrite_it(self):
        """`connect` used to INSERT and commit the schema version every time,
        so `control.py` polling every two seconds took a write lock every two
        seconds against the run it was watching."""
        self.stocked()
        before = index.get_meta(self.conn, 'schema_version')
        second = index.connect(os.path.join(self.tmp, 'index.db'))
        try:
            self.assertEqual(index.get_meta(second, 'schema_version'), before)
        finally:
            second.close()


if __name__ == '__main__':
    unittest.main()
