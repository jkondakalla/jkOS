"""Tests for mesh.py — M7, the pulsarmap mesh and its sidecar store.

**Every failure mode here is silent.** That is the whole reason this file is as
long as it is: a mesh built at the wrong decimation, quantised against a
per-track scale, or reduced by `mean` when it was meant to be `p75`, renders
perfectly and is simply a picture of something else. Nothing downstream raises,
nothing looks broken, and the only symptom is that two tracks stop being
comparable — which is exactly the mistake M2 warns about for its panels and M3
warns about for the descriptor z-score.

Four groups:

  · **the derivation gates** — that `row_seconds` and `frames_per_row` come from
    `config` and are not literals that happen to agree with it today.
  · **the quantisation gates** — a byte round-trips within half a step, clipping
    happens at the ends rather than rescaling, and the scale is SHARED.
  · **the reduction gates** — that the reduction in force is the one that was
    measured, and that the four candidates are actually different from each other.
  · **the store gates** — the join key KourOS will look up, the drift alarm, and
    the WAL trap reproduced rather than described.
"""
import os
import shutil
import sqlite3
import tempfile
import unittest

import numpy as np

import config
import index
import mel
import mesh
import ridge

from . import helpers


def synthetic_logmel(n_frames, level=0.0, n_mels=None):
    """A log-mel matrix that is not a real track but has the right shape and
    dtype. `level` is in the log units in force, so two calls at different levels
    are two tracks at different loudnesses on the SHARED scale."""
    n_mels = n_mels or config.N_MELS
    rng = np.random.default_rng(7)
    tilt = np.linspace(2.0, -2.0, n_mels)[:, None]      # bass-heavy, like music
    return (level + tilt + rng.normal(0.0, 0.4, (n_mels, n_frames))).astype(np.float32)


# ── The derivation gates ────────────────────────────────────────────────────────
class DerivationTest(unittest.TestCase):
    """`row_seconds` must come from `config`, not from a literal that agrees with
    it today. The renderer computes `row = floor(currentTime / rowSeconds)`, so a
    row duration that is right by coincidence drifts a whole row out by minute ten
    the moment `HOP` or `SR` changes — and the picture stays plausible."""

    def test_frames_per_row_lands_on_the_documented_86(self):
        """The arithmetic ALGORITHMS.md §9's size table is built on."""
        self.assertEqual(mesh.frames_per_row(), 86)
        self.assertAlmostEqual(mesh.row_seconds(), 1.9969, places=3)

    def test_row_seconds_is_derived_and_not_the_target(self):
        """⚠️ `ROW_SECONDS` is a TARGET; what ships is `frames_per_row()` frames'
        worth. They differ by 3 ms at the baseline, which is one whole row of
        reveal drift by minute ten."""
        self.assertNotEqual(mesh.row_seconds(), mesh.ROW_SECONDS)
        self.assertAlmostEqual(mesh.row_seconds(),
                               mesh.frames_per_row() * config.frame_seconds())

    def test_a_config_change_moves_the_decimation(self):
        """The actual gate: halve the hop and twice as many frames must fit a row.
        A module-level `FRAMES_PER_ROW = ...` evaluated at import passes every
        other test in this file and fails this one."""
        with config.using(config.ENCODER):
            self.assertEqual(mesh.frames_per_row(),
                             max(1, round(mesh.ROW_SECONDS / config.frame_seconds())))
            self.assertNotEqual(mesh.frames_per_row(), 86)
        self.assertEqual(mesh.frames_per_row(), 86)

    def test_frames_per_row_is_never_zero(self):
        """A configuration whose frame is longer than a row gets one frame per
        row, not a zero-width slice and a divide by zero."""
        saved = mesh.ROW_SECONDS
        try:
            mesh.ROW_SECONDS = 0.0001
            self.assertEqual(mesh.frames_per_row(), 1)
        finally:
            mesh.ROW_SECONDS = saved

    def test_the_mesh_carries_the_derived_row_seconds(self):
        m = mesh.build(synthetic_logmel(400))
        self.assertAlmostEqual(m.row_seconds, mesh.row_seconds())


# ── The quantisation gates ──────────────────────────────────────────────────────
class QuantisationTest(unittest.TestCase):
    def test_round_trip_is_within_half_a_step(self):
        lo, hi = ridge.default_value_range()
        values = np.linspace(lo, hi, 4096).astype(np.float32)
        back = mesh.dequantise(mesh.quantise(values))
        self.assertLessEqual(float(np.abs(back - values).max()),
                             mesh.quant_step() / 2 + 1e-4)

    def test_a_step_is_far_below_what_an_eye_resolves(self):
        """18 ln units over 255 steps is 0.07 ln ≈ 0.31 dB — the reason one byte
        is enough, asserted rather than asserted in prose."""
        self.assertLess(mesh.quant_step(), 0.08)

    def test_the_ends_clip_rather_than_rescaling(self):
        """⚠️ THE WHOLE POINT OF A SHARED SCALE. Anything that rescaled to fit
        would make a quiet track and a loud one look equally loud."""
        lo, hi = ridge.default_value_range()
        codes = mesh.quantise(np.array([lo - 50.0, lo, hi, hi + 50.0], dtype=np.float32))
        self.assertEqual(list(codes), [0, 0, 255, 255])

    def test_silence_sits_on_the_floor_rather_than_spending_the_range(self):
        """`mel.log_floor_value()` is -23.03 and `VALUE_RANGE_LN`'s floor is -8.0,
        deliberately well above it: digital silence would otherwise spend a third
        of the byte."""
        self.assertLess(mel.log_floor_value(), ridge.default_value_range()[0])
        self.assertEqual(int(mesh.quantise(np.float32(mel.log_floor_value()))), 0)

    def test_the_range_is_ridge_s_and_not_a_second_copy(self):
        """One measured range in the project, not two that agree today."""
        self.assertEqual(mesh.build(synthetic_logmel(200)).value_range,
                         ridge.default_value_range())

    def test_the_scale_follows_the_log_mode(self):
        """A config edit to `LOG_MODE` must move the range, not silently clip
        every value to the top — 'db' values are ~4.3× larger."""
        with config.using(config.ENCODER):                    # LOG_MODE='db'
            lo, hi = ridge.default_value_range()
            self.assertGreater(hi, ridge.VALUE_RANGE_LN[1] * 2)
            mid = mesh.quantise(np.float32((lo + hi) / 2))
            self.assertGreater(int(mid), 100)
            self.assertLess(int(mid), 155)


class SharedScaleTest(unittest.TestCase):
    """⚠️ THE ONE TEST THAT CATCHES A PER-TRACK NORMALISER.

    Two synthetic tracks at different absolute levels must produce meshes with
    different means. A per-track normaliser — introduced at the builder, at the
    quantiser or as renderer contrast — makes them EQUAL, and nothing else does.
    Every other assertion in this file passes with one in place.
    """

    def test_two_levels_produce_two_different_meshes(self):
        quiet = mesh.build(synthetic_logmel(600, level=-4.0))
        loud = mesh.build(synthetic_logmel(600, level=+5.0))
        self.assertGreater(loud.rows.mean(), quiet.rows.mean() + 40,
                           'a 9 ln level difference collapsed — something normalised '
                           'per track, and the pulsarmap now says nothing about loudness')

    def test_the_quiet_track_does_not_fill_its_own_range(self):
        """The other half of the same claim: a quiet track must sit LOW, not be
        stretched to fill the byte."""
        quiet = mesh.build(synthetic_logmel(600, level=-6.0))
        self.assertLess(quiet.rows.max(), 255)

    def test_a_sheet_of_tracks_shares_one_range(self):
        ranges = {mesh.build(synthetic_logmel(300, level=lv)).value_range
                  for lv in (-6.0, 0.0, 6.0)}
        self.assertEqual(len(ranges), 1)


# ── The reduction gates ─────────────────────────────────────────────────────────
class ReductionTest(unittest.TestCase):
    def test_the_reduction_in_force_is_the_measured_one(self):
        """⚠️ Pinned deliberately. `p75` is not a preference — it is what
        ALGORITHMS.md §9's table records after rendering M2's four reference
        tracks four ways, and `max` (the presumed answer) saturates 44–70% of the
        sub-200 Hz cells. Changing this constant means re-running that
        measurement, so it fails here rather than shipping a different picture."""
        self.assertEqual(mesh.REDUCTION, 'p75')
        self.assertIn(mesh.REDUCTION, mesh.REDUCTIONS)

    def test_the_default_is_not_silently_mean(self):
        """A row of one loud frame among quiet ones: `mean` and `p75` disagree by
        a lot, so this fails loudly if the default ever falls through to `mean`."""
        matrix = np.full((config.N_MELS, mesh.frames_per_row()), -6.0, dtype=np.float32)
        matrix[:, 0] = 9.0
        default = mesh.build(matrix).rows
        as_mean = mesh.build(matrix, 'mean').rows
        self.assertFalse(np.array_equal(default, as_mean))
        np.testing.assert_array_equal(default, mesh.build(matrix, 'p75').rows)

    def test_the_four_candidates_are_four_different_pictures(self):
        matrix = synthetic_logmel(mesh.frames_per_row() * 8)
        means = {name: float(mesh.build(matrix, name).rows.mean())
                 for name in mesh.REDUCTIONS}
        self.assertEqual(len(set(round(v, 3) for v in means.values())), 4)
        self.assertGreater(means['max'], means['p90'])
        self.assertGreater(means['p90'], means['p75'])
        self.assertGreater(means['p75'], means['mean'])

    def test_an_unknown_reduction_raises(self):
        with self.assertRaises(ValueError):
            mesh.build(synthetic_logmel(200), 'median-ish')

    def test_the_mesh_records_which_reduction_built_it(self):
        self.assertEqual(mesh.build(synthetic_logmel(200), 'max').reduction, 'max')


# ── The shape gates ─────────────────────────────────────────────────────────────
class ShapeTest(unittest.TestCase):
    def test_a_row_is_a_moment_in_time_not_a_band(self):
        """⚠️ The transpose the whole renderer rests on. `(n_rows, n_mels)`, so a
        row is one ~2 s slice and can arrive in front of the ones already drawn —
        which is what makes the canvas append-only."""
        m = mesh.build(synthetic_logmel(mesh.frames_per_row() * 5))
        self.assertEqual(m.rows.shape, (5, config.N_MELS))
        self.assertEqual(m.n_rows, 5)
        self.assertEqual(m.n_mels, config.N_MELS)

    def test_the_dtype_is_one_byte(self):
        self.assertEqual(mesh.build(synthetic_logmel(400)).rows.dtype, np.uint8)

    def test_a_short_last_row_is_reduced_over_what_it_has(self):
        """Not zero-padded — that would put a fake silent tail on the end of every
        track whose length does not divide evenly."""
        per = mesh.frames_per_row()
        matrix = np.full((config.N_MELS, per + 3), 4.0, dtype=np.float32)
        m = mesh.build(matrix)
        self.assertEqual(m.n_rows, 2)
        np.testing.assert_array_equal(m.rows[0], m.rows[1])

    def test_an_empty_matrix_is_a_failure_not_an_empty_picture(self):
        with self.assertRaises(mesh.MeshError):
            mesh.build(np.empty((config.N_MELS, 0), dtype=np.float32))

    def test_the_size_claim_in_the_docs_holds(self):
        """ALGORITHMS.md §9: a four-minute track is ~120 rows × 128 = 15 KB."""
        four_minutes = int(240.0 / config.frame_seconds())
        m = mesh.build(synthetic_logmel(four_minutes))
        self.assertEqual(m.n_rows, 121)
        self.assertLess(m.rows.nbytes, 16 * 1024)

    def test_a_config_change_changes_the_band_count(self):
        """A mesh built under the encoder profile is 64 bands wide, and the store
        alarm below is what stops the two mixing."""
        with config.using(config.ENCODER):
            m = mesh.build(synthetic_logmel(400, n_mels=config.N_MELS))
            self.assertEqual(m.n_mels, 64)
            self.assertNotEqual(m.config_sig, config.baseline().signature())


# ── The join key ────────────────────────────────────────────────────────────────
class RelKeyTest(unittest.TestCase):
    """⚠️ THE ONE TRAP IN THE STORE. The embedder walks `/mnt/Luna/Plex/Music/…`
    and KourOS's container sees `/music/…`. Key on the absolute path and every
    lookup misses with no error — coverage reads 0% and looks like a fill that
    never ran."""

    def test_both_spellings_of_one_file_agree(self):
        a = mesh.rel_key('/mnt/Luna/Plex/Music/AFI - Black Sails/01. x.flac')
        b = mesh.rel_key('/music/AFI - Black Sails/01. x.flac')
        self.assertEqual(a, 'afi - black sails/01. x.flac')
        self.assertEqual(a, b)

    def test_it_matches_a_segment_and_never_a_substring(self):
        """`/mnt/Music-Archive/…` contains the text 'music' and joins against
        nothing — the same rule `ship.py`'s `root_coverage` states."""
        self.assertIsNone(mesh.rel_key('/mnt/Music-Archive/Artist/01. x.flac'))

    def test_the_last_root_segment_wins(self):
        """A library at `/music/…/Music/…` takes the suffix from the LAST one, as
        `lastRootIndex` in vectors.js does."""
        self.assertEqual(mesh.rel_key('/music/x/music/Artist/01. y.flac'),
                         'artist/01. y.flac')

    def test_a_hostile_filename_survives(self):
        key = mesh.rel_key(f'/music/{helpers.HOSTILE_NAME}/01. a&b.flac')
        self.assertEqual(key, f"{helpers.HOSTILE_NAME.lower()}/01. a&b.flac")

    def test_a_file_sitting_directly_in_the_root_has_no_suffix(self):
        self.assertIsNone(mesh.rel_key('/music'))
        self.assertIsNone(mesh.rel_key('/music/'))

    def test_no_root_at_all_is_none_rather_than_a_guess(self):
        self.assertIsNone(mesh.rel_key('/srv/audio/Artist/01. x.flac'))


# ── The store ───────────────────────────────────────────────────────────────────
class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-mesh-')
        self.db = os.path.join(self.tmp, 'meshes.db')
        self.conn = mesh.connect(self.db)

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_a_mesh_round_trips_through_sqlite(self):
        built = mesh.build(synthetic_logmel(mesh.frames_per_row() * 4), duration=8.0)
        mesh.put(self.conn, 'artist/01. x.flac', built)
        back = mesh.get(self.conn, 'artist/01. x.flac')
        np.testing.assert_array_equal(back.rows, built.rows)
        self.assertAlmostEqual(back.row_seconds, built.row_seconds)
        self.assertEqual(back.value_range, built.value_range)
        self.assertEqual(back.reduction, built.reduction)
        self.assertEqual(back.config_sig, built.config_sig)
        self.assertAlmostEqual(back.duration, 8.0)

    def test_a_missing_key_is_none_not_an_error(self):
        self.assertIsNone(mesh.get(self.conn, 'nothing/here.flac'))

    def test_writing_the_same_key_twice_replaces(self):
        key = 'artist/01. x.flac'
        mesh.put(self.conn, key, mesh.build(synthetic_logmel(200, level=-4.0)))
        mesh.put(self.conn, key, mesh.build(synthetic_logmel(200, level=+5.0)))
        self.assertEqual(mesh.stats(self.conn)['meshes'], 1)
        self.assertGreater(mesh.get(self.conn, key).rows.mean(), 150)

    def test_a_truncated_blob_raises_rather_than_rendering(self):
        """A short BLOB reshaped against a remembered row count is a picture with
        a wrapped time axis — plausible, and wrong."""
        key = 'artist/01. x.flac'
        mesh.put(self.conn, key, mesh.build(synthetic_logmel(400)))
        self.conn.execute('UPDATE meshes SET rows=? WHERE rel_key=?', (b'\x01\x02', key))
        with self.assertRaises(mesh.MeshError):
            mesh.get(self.conn, key)

    def test_an_empty_key_is_refused(self):
        with self.assertRaises(ValueError):
            mesh.put(self.conn, None, mesh.build(synthetic_logmel(200)))

    # ── the drift alarm ───────────────────────────────────────────────────────

    def test_a_different_reduction_cannot_be_added_to_an_existing_store(self):
        """⚠️ Two reductions in one store render without complaint and stop being
        comparable. Same shape as `index.assert_config`."""
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200), 'p75'))
        with self.assertRaises(mesh.MeshDriftError):
            mesh.put(self.conn, 'a/2.flac', mesh.build(synthetic_logmel(200), 'max'))

    def test_a_different_analysis_config_cannot_be_added(self):
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200)))
        with config.using(config.ENCODER):
            with self.assertRaises(mesh.MeshDriftError):
                mesh.put(self.conn, 'a/2.flac', mesh.build(synthetic_logmel(200)))

    def test_a_different_value_range_cannot_be_added(self):
        """The per-track-normaliser alarm at the store level: a mesh carrying its
        own range is refused, so 'self-describing' cannot become 'per track'."""
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200)))
        rogue = mesh.build(synthetic_logmel(200))
        rogue.value_range = (-3.0, 3.0)
        with self.assertRaises(mesh.MeshDriftError):
            mesh.put(self.conn, 'a/2.flac', rogue)

    def test_an_empty_store_adopts_whatever_is_in_force(self):
        """The legitimate path stays legal: change the rules, clear the store,
        re-fill."""
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200), 'p75'))
        self.conn.execute('DELETE FROM meshes')
        mesh.put(self.conn, 'a/2.flac', mesh.build(synthetic_logmel(200), 'max'))
        self.assertEqual(mesh.get(self.conn, 'a/2.flac').reduction, 'max')

    def test_row_count_is_not_part_of_the_recipe(self):
        """Two tracks of different lengths are the same kind of picture."""
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200)))
        mesh.put(self.conn, 'a/2.flac', mesh.build(synthetic_logmel(4000)))
        self.assertEqual(mesh.stats(self.conn)['meshes'], 2)

    # ── failures are data ─────────────────────────────────────────────────────

    def test_a_failure_is_distinguishable_from_not_built_yet(self):
        mesh.record_failure(self.conn, 'a/1.flac', 'DecodeError: zero-length file')
        self.assertEqual(mesh.stats(self.conn)['failures'], 1)
        self.assertIsNone(mesh.get(self.conn, 'a/1.flac'))

    def test_a_later_success_clears_the_failure(self):
        mesh.record_failure(self.conn, 'a/1.flac', 'DecodeError: transient')
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200)))
        self.assertEqual(mesh.stats(self.conn)['failures'], 0)

    # ── pending ───────────────────────────────────────────────────────────────

    def test_pending_skips_what_is_already_stored_and_what_failed(self):
        idx_path = os.path.join(self.tmp, 'index.db')
        idx = index.connect(idx_path)
        try:
            for i in range(4):
                index.upsert_track(idx, f'/mnt/Luna/Plex/Music/A/0{i}. t.flac', 1.0, 10)
            idx.commit()
            self.assertEqual(len(mesh.pending(idx, self.conn)), 4)

            mesh.put(self.conn, 'a/00. t.flac', mesh.build(synthetic_logmel(200)))
            mesh.record_failure(self.conn, 'a/01. t.flac', 'DecodeError: x')
            self.assertEqual([k for _, k in mesh.pending(idx, self.conn)],
                             ['a/02. t.flac', 'a/03. t.flac'])
            self.assertEqual(len(mesh.pending(idx, self.conn, retry_failed=True)), 3)
            self.assertEqual(len(mesh.pending(idx, self.conn, limit=1)), 1)
        finally:
            idx.close()

    def test_pending_skips_a_path_with_no_root_segment(self):
        """Rather than keying on garbage — the same refusal `ship.py --check`
        raises for the whole index."""
        idx_path = os.path.join(self.tmp, 'index.db')
        idx = index.connect(idx_path)
        try:
            index.upsert_track(idx, '/srv/elsewhere/A/01. t.flac', 1.0, 10)
            idx.commit()
            self.assertEqual(mesh.pending(idx, self.conn), [])
        finally:
            idx.close()

    # ── the WAL trap, reproduced ──────────────────────────────────────────────

    def test_a_plain_copy_loses_uncheckpointed_meshes_and_the_snapshot_does_not(self):
        """⚠️ `ship.py`'s trap 1, one artifact along. WAL mode with a commit per
        mesh means an arbitrary share of the rows live in `meshes.db-wal`; a `cp`
        opens cleanly, reports a plausible count, and the missing rows read as
        'the fill has not reached them'."""
        for i in range(5):
            mesh.put(self.conn, f'a/0{i}. t.flac', mesh.build(synthetic_logmel(400)))

        plain = os.path.join(self.tmp, 'plain.db')
        shutil.copyfile(self.db, plain)
        try:
            got = sqlite3.connect(plain).execute('SELECT COUNT(*) FROM meshes').fetchone()[0]
        except sqlite3.OperationalError:
            got = 0          # the SCHEMA is in the WAL too — the copy is a blank file
        self.assertLess(got, 5, 'the WAL trap did not reproduce — sqlite checkpointed '
                                'early, and this assertion is what makes the next one mean '
                                'something')

        snap = mesh.snapshot(self.db, os.path.join(self.tmp, 'out', 'meshes.db'))
        self.assertEqual(
            sqlite3.connect(snap).execute('SELECT COUNT(*) FROM meshes').fetchone()[0], 5)
        for sidecar in (f'{snap}-wal', f'{snap}-shm'):
            self.assertFalse(os.path.exists(sidecar))

    def test_the_snapshot_clears_a_stale_sidecar_left_by_an_earlier_cp(self):
        """An OLD `-wal` beside the destination is read IN PREFERENCE to the file
        just written — trap 1 wearing a disguise."""
        mesh.put(self.conn, 'a/1.flac', mesh.build(synthetic_logmel(200)))
        dest = os.path.join(self.tmp, 'out', 'meshes.db')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(f'{dest}-wal', 'wb') as fh:
            fh.write(b'stale')
        mesh.snapshot(self.db, dest)
        self.assertFalse(os.path.exists(f'{dest}-wal'))


# ── The real pipeline, when there is one to run against ─────────────────────────
class LiveTrackTest(unittest.TestCase):
    """An ADDITIONAL check that skips cleanly, never the only one — same habit as
    the rest of the suite."""

    @unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg is not on PATH')
    def test_a_generated_flac_meshes_end_to_end(self):
        tmp = tempfile.mkdtemp(prefix='music-mesh-live-')
        try:
            path = helpers.make_sine_flac(tmp, seconds=6.0)
            m = mesh.from_file(path)
            self.assertEqual(m.n_mels, config.N_MELS)
            # Derived, not a literal: 6 s is 259 frames once CENTER's half-window
            # pad is counted, which is four rows of 86 and not the three a
            # duration/row_seconds division would predict.
            expected = -(-config.n_frames(int(6.0 * config.SR)) // mesh.frames_per_row())
            self.assertEqual(m.n_rows, expected)
            self.assertEqual(m.n_rows, 4)
            self.assertAlmostEqual(m.duration, 6.0, places=1)
            # A 440 Hz sine puts its energy in one band and near the floor
            # everywhere else — a mesh that came out flat is not describing it.
            self.assertGreater(int(m.rows.max()) - int(np.median(m.rows)), 40)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
