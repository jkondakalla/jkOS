"""The hand-off to KourOS (ToDo §8.9), which has four ways to succeed and be wrong.

Every check here corresponds to a condition KourOS reads WITHOUT COMPLAINT. That
is the whole difficulty: KourOS is built to degrade when the index is thin, and
degrading is the right behaviour — so a truncated, uncalibrated or unjoinable
index is indistinguishable, from the reading side, from a backfill that has not
finished yet. The refusal has to happen here or it does not happen at all.

The WAL test is the one worth reading. It writes vectors, does NOT checkpoint,
and asserts that a plain file copy loses them while the snapshot does not — so
the trap is reproduced rather than described.
"""
import io
import os
import shutil
import sqlite3
import tempfile
import unittest

import numpy as np

import index
import ship


class ShipTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-ship-')
        self.db = os.path.join(self.tmp, 'index.db')
        self.conn = index.connect(self.db)

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def seed(self, n=6, root='/mnt/Luna/Plex/Music', calibrate=True, dim=8):
        ids = []
        for i in range(n):
            track = index.upsert_track(
                self.conn, f'{root}/Artist {i}/Album (2019)/0{i}. Title.flac', 1.0, 100)
            index.put_vector(self.conn, track,
                             np.full(dim, i + 1, dtype=np.float32), 'test-model')
            ids.append(track)
        if calibrate:
            index.set_meta(self.conn, 'calib_mean:local_vectors', 'AAAA')
            index.set_meta(self.conn, 'calib_stranger_spread:local_vectors', '0.3')
        self.conn.commit()
        return ids

    def out(self, name='music-index.db'):
        return os.path.join(self.tmp, 'out', name)

    # ── the shape of a good ship ──────────────────────────────────────────────

    def test_a_calibrated_joinable_index_ships(self):
        self.seed()
        data = ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())
        self.assertEqual(data['tracks'], 6)
        self.assertEqual(data['arms']['local_vectors']['n'], 6)
        dest = ship.snapshot(self.db, self.out())
        self.assertTrue(os.path.exists(dest))

    def test_the_snapshot_carries_writes_a_plain_copy_would_lose(self):
        """⚠️ THE `-wal` TRAP, REPRODUCED — and it is worse than "a few tracks
        short". The index commits once per track under WAL, so at any moment an
        arbitrary share of the database lives in `index.db-wal`. Copying the `.db`
        alone here does not lose SOME vectors; it loses the schema too, because
        nothing has been checkpointed back yet. On a long-running index the same
        copy succeeds and reports a plausible, SMALLER count — which reads
        downstream as "the backfill has not got there yet" and never as a broken
        copy. Both shapes are the same mistake, and `VACUUM INTO` cannot produce
        either."""
        self.seed(6)
        self.assertTrue(os.path.exists(f'{self.db}-wal'), 'fixture must leave a live WAL')

        naive = os.path.join(self.tmp, 'naive.db')
        shutil.copyfile(self.db, naive)                     # the mistake, exactly
        try:
            naive_n = sqlite3.connect(naive).execute(
                'SELECT COUNT(*) FROM local_vectors').fetchone()[0]
        except sqlite3.OperationalError:
            naive_n = None                                  # not even a schema yet

        shipped = ship.snapshot(self.db, self.out())
        shipped_n = sqlite3.connect(shipped).execute(
            'SELECT COUNT(*) FROM local_vectors').fetchone()[0]

        self.assertEqual(shipped_n, 6)
        self.assertTrue(naive_n is None or naive_n < shipped_n,
                        f'the plain copy was expected to lose the un-checkpointed '
                        f'writes, but read back {naive_n} of {shipped_n}')

    def test_the_snapshot_has_no_sidecar_of_its_own(self):
        """There is then no second file anyone can forget to carry."""
        self.seed()
        dest = ship.snapshot(self.db, self.out())
        self.assertFalse(os.path.exists(f'{dest}-wal'))
        self.assertFalse(os.path.exists(f'{dest}-shm'))

    def test_a_stale_sidecar_at_the_destination_is_removed(self):
        """⚠️ Trap 1 in disguise: a `-wal` left beside the destination by an
        earlier plain `cp` is read IN PREFERENCE to the file just written."""
        self.seed()
        dest = self.out()
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(f'{dest}-wal', 'wb') as fh:
            fh.write(b'stale')
        ship.snapshot(self.db, dest)
        self.assertFalse(os.path.exists(f'{dest}-wal'))

    def test_a_failed_snapshot_leaves_no_half_index_at_the_destination(self):
        self.seed()
        dest = self.out()
        with self.assertRaises(Exception):
            ship.snapshot(os.path.join(self.tmp, 'nope.db'), dest)
        self.assertFalse(os.path.exists(dest))
        self.assertFalse(os.path.exists(f'{dest}.partial'))

    # ── the four silent failures ──────────────────────────────────────────────

    def test_an_uncalibrated_index_is_refused(self):
        """§8.8: the centre lives in `meta`, and without it KourOS ranks on the
        raw cosine — strangers at +0.48 instead of −0.03, the two arms on
        incompatible scales, `makeRun` an energy ramp through unrelated music."""
        self.seed(calibrate=False)
        with self.assertRaises(ship.ShipError) as caught:
            ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())
        self.assertIn('calib_mean:local_vectors', str(caught.exception))

    def test_an_uncalibrated_index_ships_only_when_explicitly_allowed(self):
        self.seed(calibrate=False)
        data = ship.check(ship._open_ro(self.db), 'music',
                          require_calibration=False, stream=io.StringIO())
        self.assertEqual(data['arms']['local_vectors']['n'], 6)

    def test_paths_that_miss_the_library_root_are_refused(self):
        """⚠️ The failure that actually happened, twice. The join is root-relative;
        paths that do not carry the root segment KourOS is configured with join
        against nothing, tier 1 cannot hit in a container by construction, and
        coverage is 0% — reported honestly as "metadata basis", which reads as bad
        embeddings rather than as an index that was never consulted."""
        self.seed(root='/srv/SomewhereElse')
        with self.assertRaises(ship.ShipError) as caught:
            ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())
        self.assertIn('do not carry', str(caught.exception))

    def test_the_root_segment_is_matched_whole_not_as_a_substring(self):
        """`/mnt/Music-Archive/…` contains the text `Music` and joins against
        nothing — the same segment rule `lastRootIndex` uses in vectors.js."""
        self.seed(root='/mnt/Music-Archive/rips')
        hit, total, _ = ship.root_coverage(ship._open_ro(self.db), 'music')
        self.assertEqual((hit, total), (0, 6))

    def test_the_root_segment_is_matched_case_insensitively(self):
        """The host says `…/Plex/Music`, the container says `/music`."""
        self.seed(root='/mnt/Luna/Plex/Music')
        hit, total, _ = ship.root_coverage(ship._open_ro(self.db), 'music')
        self.assertEqual((hit, total), (6, 6))

    def test_mixed_dimensions_are_refused_here_rather_than_inside_kouros(self):
        self.seed(n=3, dim=8)
        track = index.upsert_track(self.conn, '/mnt/Luna/Plex/Music/A/B (2019)/09. C.flac', 1.0, 1)
        index.put_vector(self.conn, track, np.ones(16, dtype=np.float32), 'test-model')
        self.conn.commit()
        with self.assertRaises(ship.ShipError) as caught:
            ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())
        self.assertIn('different dimensions', str(caught.exception))

    def test_an_index_with_no_vectors_at_all_is_refused(self):
        index.upsert_track(self.conn, '/mnt/Luna/Plex/Music/A/B (2019)/01. C.flac', 1.0, 1)
        self.conn.commit()
        with self.assertRaises(ship.ShipError) as caught:
            ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())
        self.assertIn('neither arm', str(caught.exception))

    def test_an_empty_index_is_refused(self):
        with self.assertRaises(ship.ShipError):
            ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())

    # ── the copy is verified from the COPY ────────────────────────────────────

    def test_the_shipped_file_passes_the_same_checks_as_the_source(self):
        self.seed(8)
        dest = ship.snapshot(self.db, self.out())
        source = ship.check(ship._open_ro(self.db), 'music', stream=io.StringIO())
        copied = ship.check(ship._open_ro(dest), 'music', stream=io.StringIO())
        self.assertEqual(source['tracks'], copied['tracks'])
        self.assertEqual(source['arms']['local_vectors']['n'],
                         copied['arms']['local_vectors']['n'])

    def test_the_snapshot_is_readable_while_the_source_is_being_written(self):
        """The backfill runs for hours and commits per track; shipping must not
        require stopping it, and must not tear."""
        self.seed(4)
        dest = ship.snapshot(self.db, self.out())
        track = index.upsert_track(self.conn, '/mnt/Luna/Plex/Music/Z/Z (2020)/01. Z.flac', 1.0, 1)
        index.put_vector(self.conn, track, np.ones(8, dtype=np.float32), 'test-model')
        self.conn.commit()
        n = sqlite3.connect(dest).execute('SELECT COUNT(*) FROM local_vectors').fetchone()[0]
        self.assertEqual(n, 4, 'the snapshot must be the moment it was taken, not later')

    def test_vectors_survive_the_snapshot_bit_exactly(self):
        """A float32 BLOB that round-trips at half its dimension is the §8.1 trap;
        the shipped copy is where it would surface as "bad embeddings"."""
        self.seed(3, dim=8)
        dest = ship.snapshot(self.db, self.out())
        src_rows = self.conn.execute(
            'SELECT track_id, vector FROM local_vectors ORDER BY track_id').fetchall()
        dst = sqlite3.connect(dest)
        dst_rows = dst.execute(
            'SELECT track_id, vector FROM local_vectors ORDER BY track_id').fetchall()
        self.assertEqual(len(src_rows), len(dst_rows))
        for a, b in zip(src_rows, dst_rows):
            np.testing.assert_array_equal(index.from_blob(a['vector']),
                                          index.from_blob(b[1]))


if __name__ == '__main__':
    unittest.main()
