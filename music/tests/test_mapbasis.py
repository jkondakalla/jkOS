"""mapbasis.py under test — the vibe space's basis, and every way it could be quietly wrong.

What fails silently here, and is therefore asserted:

  · the energy probe finds a PLANTED energy direction, pointing "up" = louder
  · the basis is orthonormal, so every map distance is a true projection distance
  · the sign rules orient each spatial axis by its strongest readable feature
  · the w percentile table round-trips, so a swipe position means a population share
  · a basis from before a calibration refit is STALE, never current
  · the golden coordinates are what projecting the stored vectors produces
  · the fallback spans exactly PCA-4's subspace, so its distances are PCA-4's
  · a failed gate or a missing prerequisite HOLDS the arm, recorded and reported
  · nothing stored contains a bare NaN (KourOS's `JSON.parse` would throw on it)

Synthetic, on-disk, no model: every vector is built from four planted latent factors
plus noise, so the geometry under test is exactly the geometry the assertions describe.
"""
import io
import json
import os
import shutil
import tempfile
import unittest

import numpy as np

import descriptors
import index
import mapbasis
import query

DIM = 32
NAMES = descriptors.feature_names()
COL = {k: NAMES.index(v) for k, v in mapbasis.READABLE.items()}


def _strict_json(text):
    def refuse(token):
        raise ValueError(f'bare {token} in stored JSON')
    return json.loads(text, parse_constant=refuse)


class Shelf:
    """A synthetic library: artists → albums → tracks, with planted directions.

    Every vector is `energy·d_e + a·d_a + b·d_b + c·d_c + noise` in DIM dimensions,
    where the four d's are orthonormal. Albums share an energy level and a position
    (albums are tight clusters, as the real library's are), and a track's
    `logrms_mean` IS its planted energy, so the probe has a true answer to find.
    `brightness` is planted NEGATIVELY along d_a, so the sign rule has work to do.
    """

    def __init__(self, n_artists=8, albums=5, tracks=8, seed=3, energy_sign=1.0,
                 energy_in_vectors=True):
        rng = np.random.RandomState(seed)
        q, _ = np.linalg.qr(rng.randn(DIM, DIM))
        self.d_e, self.d_a, self.d_b, self.d_c = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
        self.d_e = self.d_e * energy_sign
        self.rows = []
        for a in range(n_artists):
            artist_pos = rng.randn(3) * 1.2
            for b in range(albums):
                album_energy = rng.randn() * 1.0
                album_pos = artist_pos + rng.randn(3) * 0.6
                for t in range(tracks):
                    energy = album_energy + rng.randn() * 0.25
                    pos = album_pos + rng.randn(3) * 0.3
                    vec = (pos[0] * 2.2 * self.d_a + pos[1] * 1.6 * self.d_b + pos[2] * 1.2 * self.d_c
                           + rng.randn(DIM) * 0.12)
                    if energy_in_vectors:
                        vec = vec + energy * 1.4 * self.d_e
                    vec = vec + 0.4 * np.ones(DIM) / np.sqrt(DIM) * 8   # the shared cone axis
                    desc = rng.rand(len(NAMES)).astype(np.float32)
                    desc[COL['energy']] = energy
                    desc[COL['brightness']] = -pos[0] + rng.randn() * 0.2
                    desc[COL['fuzz']] = pos[1] + rng.randn() * 0.2
                    path = f'/lib/Music/Artist {a}/Album {a}-{b}/{t + 1:02d} Track {t}.flac'
                    self.rows.append((path, vec.astype(np.float32), desc))

    def write(self, conn, descriptor_every=1):
        """`descriptor_every=k` describes every k-th track — spread across artists,
        because the descriptor arm's own calibration needs strangers too."""
        for i, (path, vec, desc) in enumerate(self.rows):
            tid = index.upsert_track(conn, path, 1.0, 100)
            index.put_vector(conn, tid, vec / np.linalg.norm(vec), model='test')
            if i % descriptor_every == 0:
                index.put_descriptor(conn, tid, desc)
        conn.commit()


class MapTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-map-')
        self.conn = index.connect(os.path.join(self.tmp, 'index.db'))
        self.out = io.StringIO()

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def shelf(self, **kw):
        every = kw.pop('descriptor_every', 1)
        shelf = Shelf(**kw)
        shelf.write(self.conn, every)
        query.fit_calibration(self.conn, stream=io.StringIO())
        return shelf

    def fitted(self, **kw):
        shelf = self.shelf(**kw)
        result = mapbasis.fit(self.conn, stream=self.out)
        return shelf, result


class StatisticsTest(unittest.TestCase):
    def test_ranks_average_ties_and_span_zero_to_one(self):
        np.testing.assert_allclose(mapbasis.ranks([10, 20, 20, 30]), [0, 0.5, 0.5, 1])

    def test_spearman_is_rank_invariant(self):
        x = np.linspace(0, 1, 50)
        self.assertAlmostEqual(mapbasis.spearman(x, np.exp(8 * x)), 1.0)
        self.assertAlmostEqual(mapbasis.spearman(x, -x ** 3), -1.0)

    def test_jsonable_turns_every_nan_into_null(self):
        text = json.dumps(mapbasis._jsonable({'a': float('nan'), 'b': [np.float32('inf'), 1.5],
                                              'c': np.bool_(True), 'd': np.int64(3)}))
        self.assertEqual(_strict_json(text), {'a': None, 'b': [None, 1.5], 'c': True, 'd': 3})


class FitTest(MapTestCase):
    def test_the_probe_recovers_the_planted_energy_direction(self):
        shelf, result = self.fitted()
        self.assertEqual(result['mode'], 'primary', self.out.getvalue())
        basis = mapbasis.Basis.load(self.conn, 'local_vectors')
        u = basis.basis[3].astype(np.float64)
        # the calibration centres and re-normalises, which bends a linear direction
        # slightly — the planted one must still dominate the probe
        self.assertGreater(float(u @ shelf.d_e), 0.9)
        self.assertGreater(basis.stats['spearman_heldout'], 0.8)

    def test_up_means_louder_even_when_the_planted_direction_is_negated(self):
        _shelf, result = self.fitted(energy_sign=-1.0)
        self.assertNotEqual(result['mode'], 'held', self.out.getvalue())
        basis = mapbasis.Basis.load(self.conn, 'local_vectors')
        fs = mapbasis.load_fit_set(self.conn)
        w = basis.project(fs.X)[:, 3]
        self.assertGreater(mapbasis.spearman(w, fs.features['energy']), 0.8)

    def test_the_basis_is_orthonormal(self):
        self.fitted()
        B = mapbasis.Basis.load(self.conn, 'local_vectors').basis.astype(np.float64)
        np.testing.assert_allclose(B @ B.T, np.eye(4), atol=2e-6)

    def test_spatial_axes_carry_no_energy(self):
        shelf, _ = self.fitted()
        B = mapbasis.Basis.load(self.conn, 'local_vectors').basis.astype(np.float64)
        for k in range(3):
            self.assertLess(abs(float(B[k] @ B[3])), 1e-6)

    def test_sign_rule_orients_an_axis_by_its_strongest_readable_feature(self):
        # brightness is planted NEGATIVELY along the strongest spatial direction
        self.fitted()
        basis = mapbasis.Basis.load(self.conn, 'local_vectors')
        names = basis.stats['axes']
        self.assertEqual(names[0]['feature'], 'brightness', names)
        self.assertEqual((names[0]['low'], names[0]['high']), ('dark', 'bright'))
        self.assertGreater(names[0]['r'], 0)
        fs = mapbasis.load_fit_set(self.conn)
        x = basis.project(fs.X)[:, 0]
        self.assertGreater(mapbasis.spearman(x, fs.features['brightness']), 0.5)

    def test_a_feature_names_at_most_one_axis(self):
        self.fitted()
        names = [n['feature'] for n in mapbasis.Basis.load(self.conn, 'local_vectors').stats['axes'] if n]
        self.assertEqual(len(names), len(set(names)))
        self.assertNotIn('energy', names)

    def test_an_unexplained_axis_is_oriented_by_its_cubed_loadings(self):
        rng = np.random.RandomState(0)
        axes = rng.randn(1, DIM)
        coords = rng.randn(40, 1)
        fs = mapbasis.FitSet('local_vectors', np.zeros((40, DIM)), list(range(40)), ['x'] * 40,
                             {k: np.full(40, np.nan) for k in mapbasis.READABLE})
        oriented, _c, names = mapbasis.sign_axes(axes, coords, fs)
        self.assertIsNone(names[0])
        self.assertGreater(float(np.sum(oriented[0] ** 3)), 0)
        # and the orientation survives a small perturbation that swaps which loading
        # is largest — the failure the argmax rule had
        v = np.zeros(DIM)
        v[0], v[1], v[2] = 0.60, -0.61, 0.52
        w = v + np.r_[0.02, 0.0, 0.0, np.zeros(DIM - 3)]
        a, _c, _n = mapbasis.sign_axes(v[None, :], coords, fs)
        b, _c, _n = mapbasis.sign_axes(w[None, :], coords, fs)
        self.assertGreater(float(a[0] @ b[0]), 0)

    def test_the_w_quantile_table_round_trips(self):
        self.fitted()
        basis = mapbasis.Basis.load(self.conn, 'local_vectors')
        fs = mapbasis.load_fit_set(self.conn)
        w = basis.project(fs.X)[:, 3]
        p = basis.w_percentile(w)
        np.testing.assert_allclose(basis.w_raw(p), w, atol=float(np.ptp(w)) / 200)
        # equal-population: the percentiles of the fit set are ~uniform
        self.assertLess(abs(float(np.median(p)) - 0.5), 0.02)
        self.assertLess(abs(float(np.mean(p < 0.25)) - 0.25), 0.02)

    def test_display_units_clamp_to_the_unit_cube_and_keep_the_shape_isotropic(self):
        self.fitted()
        basis = mapbasis.Basis.load(self.conn, 'local_vectors')
        coords = np.array([[basis.radius * 5, 0, -basis.radius * 5, 0.0],
                           [basis.radius / 2, basis.radius / 4, 0, 0.0]])
        xyz, _w = basis.display(coords)
        np.testing.assert_allclose(xyz[0], [1, 0, -1])
        np.testing.assert_allclose(xyz[1], [0.5, 0.25, 0])

    def test_the_gate_passes_on_a_well_formed_shelf(self):
        _shelf, result = self.fitted()
        gate = result['gate'][0]
        self.assertTrue(mapbasis.passed(gate), self.out.getvalue())
        self.assertGreaterEqual(gate['G1']['ratio'], mapbasis.G1_RECALL_RATIO)
        self.assertGreater(gate['G3']['albums'], 0)
        for c, floor in zip(gate['G4']['cos'], mapbasis.G4_MIN_COS):
            self.assertGreaterEqual(c, floor)


class PersistenceTest(MapTestCase):
    def test_save_and_load_round_trip_bit_for_bit(self):
        self.fitted()
        a = mapbasis.Basis.load(self.conn, 'local_vectors')
        self.conn.commit()
        b = mapbasis.Basis.load(self.conn, 'local_vectors')
        np.testing.assert_array_equal(a.basis, b.basis)
        np.testing.assert_array_equal(a.wq, b.wq)
        self.assertEqual(a.radius, b.radius)

    def test_nothing_stored_contains_a_bare_nan(self):
        self.fitted()
        for (key, value) in self.conn.execute(
                "SELECT key, value FROM meta WHERE key IN ('map_stats:local_vectors', "
                "'map_golden:local_vectors')"):
            _strict_json(value)

    def test_golden_coordinates_are_the_projection_of_the_stored_vectors(self):
        self.fitted()
        basis = mapbasis.Basis.load(self.conn, 'local_vectors')
        calibration = query.Calibration.load(self.conn, 'local_vectors')
        self.assertEqual(len(basis.golden), mapbasis.GOLDEN)
        for g in basis.golden:
            tid = index.track_by_path(self.conn, g['path'])['id']
            raw = index.get_vector(self.conn, tid)
            coords = basis.project(calibration.centre(raw[None, :]))[0]
            np.testing.assert_allclose(coords, g['coords'], atol=mapbasis.GOLDEN_TOLERANCE / 10)

    def test_a_calibration_refit_makes_the_basis_stale(self):
        self.fitted()
        self.assertFalse(mapbasis.stale(self.conn, 'local_vectors'))
        self.assertIsNone(mapbasis.needs_fit(self.conn, 'local_vectors'))
        # grow the library and refit the calibration: the mean moves
        extra = Shelf(n_artists=2, seed=99)
        for path, vec, desc in extra.rows:
            tid = index.upsert_track(self.conn, path.replace('/Music/', '/Music/new '), 1.0, 1)
            index.put_vector(self.conn, tid, vec / np.linalg.norm(vec), model='test')
            index.put_descriptor(self.conn, tid, desc)
        self.conn.commit()
        query.fit_calibration(self.conn, stream=io.StringIO())
        self.assertTrue(mapbasis.stale(self.conn, 'local_vectors'))
        self.assertIn('different calibration', mapbasis.needs_fit(self.conn, 'local_vectors'))

    def test_no_calibration_means_nothing_to_fit_yet(self):
        Shelf(n_artists=2).write(self.conn)
        self.assertIsNone(mapbasis.needs_fit(self.conn, 'local_vectors'))
        result = mapbasis.fit(self.conn, stream=self.out)
        self.assertEqual(result['mode'], 'held')
        self.assertIn('query.py --fit', result['reason'])


class FallbackTest(MapTestCase):
    def test_the_fallback_spans_exactly_pca4(self):
        rng = np.random.RandomState(1)
        X = rng.randn(300, DIM) * np.linspace(3, 0.2, DIM)
        mu = X.mean(axis=0)
        cov = mapbasis.covariance(X, mu)
        u = rng.randn(DIM)
        u /= np.linalg.norm(u)
        B, _vals = mapbasis.construct_fallback(cov, u)
        P4, _v, _t = mapbasis.top_eigvecs(cov, 4)
        np.testing.assert_allclose(B.T @ B, P4.T @ P4, atol=1e-9)
        # so every pairwise distance is PCA-4's
        a, b = (X - mu) @ B.T, (X - mu) @ P4.T
        da = np.linalg.norm(a[:50, None] - a[None, :50], axis=2)
        db = np.linalg.norm(b[:50, None] - b[None, :50], axis=2)
        np.testing.assert_allclose(da, db, atol=1e-9)
        self.assertGreater(float(B[3] @ u), 0)          # u′ keeps u's orientation


class HoldTest(MapTestCase):
    def test_energy_the_vectors_do_not_carry_fails_g2_and_holds(self):
        _shelf, result = self.fitted(energy_in_vectors=False)
        self.assertEqual(result['mode'], 'held', self.out.getvalue())
        self.assertEqual(result['kind'], 'gate')
        self.assertIsNone(mapbasis.Basis.load(self.conn, 'local_vectors'))
        hold = mapbasis.held(self.conn, 'local_vectors')
        self.assertIsNotNone(hold)
        self.assertIn('G2', hold['reason'])
        _strict_json(mapbasis.index.get_meta(self.conn, 'map_held:local_vectors'))
        # a hold for THIS calibration means nothing is owed
        self.assertIsNone(mapbasis.needs_fit(self.conn, 'local_vectors'))

    def test_too_few_descriptors_holds_as_a_prerequisite_and_names_the_command(self):
        _shelf, result = self.fitted(descriptor_every=16)
        self.assertEqual((result['mode'], result['kind']), ('held', 'prerequisite'))
        self.assertIn('analyze.py --stages baseline', result['reason'])

    def test_a_prerequisite_hold_lapses_when_descriptors_arrive(self):
        shelf, _ = self.fitted(descriptor_every=16)
        self.assertIsNotNone(mapbasis.held(self.conn, 'local_vectors'))
        path, _vec, desc = shelf.rows[1]
        index.put_descriptor(self.conn, index.track_by_path(self.conn, path)['id'], desc)
        self.conn.commit()
        self.assertIsNone(mapbasis.held(self.conn, 'local_vectors'))
        self.assertIn('no map basis', mapbasis.needs_fit(self.conn, 'local_vectors'))

    def test_a_successful_fit_clears_an_old_hold(self):
        shelf, _ = self.fitted(descriptor_every=16)
        for path, _vec, desc in (r for i, r in enumerate(shelf.rows) if i % 16):
            index.put_descriptor(self.conn, index.track_by_path(self.conn, path)['id'], desc)
        self.conn.commit()
        result = mapbasis.fit(self.conn, stream=self.out)
        self.assertEqual(result['mode'], 'primary', self.out.getvalue())
        self.assertIsNone(index.get_meta(self.conn, 'map_held:local_vectors'))

    def test_a_hold_from_an_older_calibration_is_not_a_hold(self):
        self.fitted(energy_in_vectors=False)
        index.set_meta(self.conn, 'calib_mean:local_vectors', query._b64(np.ones(DIM)))
        self.conn.commit()
        self.assertIsNone(mapbasis.held(self.conn, 'local_vectors'))


class ReportTest(MapTestCase):
    def test_report_prints_the_gate_and_the_axis_names(self):
        self.fitted()
        out = io.StringIO()
        mapbasis.report(self.conn, out)
        text = out.getvalue()
        self.assertIn('primary basis, current', text)
        self.assertIn('G2 held-out Spearman', text)
        self.assertIn('dark → bright', text)


if __name__ == '__main__':
    unittest.main()
