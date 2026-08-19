"""M4's gate is a person reading lists, so what is testable here is everything
that could make those lists — or the proxies beside them — quietly wrong.

Four properties are load-bearing and each fails silently:

  * `M @ q` really is a cosine and the top-k really is the top-k, self excluded.
  * `align()` genuinely intersects, so the two arms are never read over two
    different libraries — §8.7's second proxy lie, and the one that looks like
    nothing on the page.
  * `song_key()` collapses the same recording filed twice and does NOT collapse
    two different recordings — §8.7's first proxy lie.
  * the duplicate-aware rates are three different numbers and the gate compares
    the arms on the corrected ones, not on the raw rate.

No model, no library mount, no onnxruntime: every vector here is synthesised, so
the geometry under test is exactly the geometry the assertions describe.
"""
import os
import shutil
import tempfile
import unittest

import numpy as np

import index
import query


def unit(vec):
    vec = np.asarray(vec, dtype=np.float32)
    return (vec / np.linalg.norm(vec)).astype(np.float32)


class QueryTestCase(unittest.TestCase):
    """A synthetic two-arm index on disk — `connect()` sets pragmas that only
    mean anything on a real file, and `align` is read through the same joins the
    backfill writes through."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-query-')
        self.conn = index.connect(os.path.join(self.tmp, 'index.db'))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add(self, path, neural=None, descriptor=None):
        tid = index.upsert_track(self.conn, path, 1.0, 100)
        if neural is not None:
            index.put_vector(self.conn, tid, unit(neural), model='test')
        if descriptor is not None:
            index.put_descriptor(self.conn, tid, np.asarray(descriptor, dtype=np.float32))
        self.conn.commit()
        return tid

    def arm(self, vectors, paths, name='local_vectors'):
        return query.Arm(name, np.stack([unit(v) for v in vectors]), paths,
                         list(range(1, len(paths) + 1)))


# ── Reading the shelf off the path ──────────────────────────────────────────────
class PathReadingTest(unittest.TestCase):
    def test_title_drops_the_track_number_in_all_three_shapes(self):
        for name in ('04. Totalimmortal', '04 - Totalimmortal', '04 Totalimmortal'):
            self.assertEqual(query.title_of(f'/m/AFI/Album/{name}.flac'), 'Totalimmortal')

    def test_a_title_that_is_only_digits_survives(self):
        # `1979` is a real song. Stripping every leading digit unconditionally
        # would key it as the empty string and merge it with every other
        # all-numeric title on the shelf.
        self.assertEqual(query.title_of('/m/SP/A/1979.flac'), '1979')
        self.assertEqual(query.title_of('/m/SP/A/03 1979.flac'), '1979')

    def test_song_key_collapses_the_same_recording_filed_twice(self):
        album = "/m/AFI/AFI - Sing The Sorrow/04. Girl's Not Grey.flac"
        single = '/m/AFI/AFI - The Single/01 - Girls Not Grey.flac'
        self.assertEqual(query.song_key(album), query.song_key(single))

    def test_song_key_keeps_a_qualifier_apart(self):
        # A live take is a different recording, and crediting a search for
        # confusing the two would be crediting it for being wrong.
        self.assertNotEqual(query.song_key('/m/AFI/A/04. Totalimmortal.flac'),
                            query.song_key('/m/AFI/B/04. Totalimmortal (Live).flac'))

    def test_song_key_separates_two_artists_covering_one_title(self):
        self.assertNotEqual(query.song_key('/m/AFI/A/01. Hurt.flac'),
                            query.song_key('/m/Johnny Cash/B/01. Hurt.flac'))

    def test_short_keeps_the_artist_and_the_title_and_drops_the_album(self):
        # ⚠️ The album directory on this shelf is sixty characters of edition and
        # bit-depth. Printing it costs the two fields that identify the track.
        path = ('/m/Bowling For Soup/Bowling For Soup - A Hangover You Don'
                "'t Deserve (2004) [16B-44.1kHz]/03. 1985.flac")
        text = query.short(path, width=30)
        self.assertEqual(len(text), 30)
        self.assertIn('1985', text)
        self.assertTrue(text.startswith('Bowling For Sou'))
        self.assertNotIn('Hangover', text)

    def test_short_caps_the_artist_so_a_long_band_name_cannot_eat_the_title(self):
        path = '/m/A Band With A Very Long Name Indeed/Album/01. Short.flac'
        text = query.short(path, width=40)
        self.assertEqual(len(text), 40)
        self.assertTrue(text.startswith('A Band With A V…'))
        self.assertIn('Short', text)

    def test_short_pads_a_short_name_to_the_column_width(self):
        self.assertEqual(len(query.short('/m/A/B/C.flac', width=40)), 40)

    def test_hostile_names_survive_the_whole_path_layer(self):
        # Trap 20 lives in this project's filenames, not only in its subprocesses.
        path = "/m/again&again/again&again - [16B-44.1kHz]/02 - Today's Lesson.flac"
        self.assertEqual(query.title_of(path), "Today's Lesson")
        self.assertEqual(query.song_key(path), ('again&again', 'todayslesson'))
        self.assertIn('again&again', query.short(path, width=80))


# ── The search itself ───────────────────────────────────────────────────────────
class SearchTest(QueryTestCase):
    def test_scores_are_cosines(self):
        arm = self.arm([[1, 0, 0], [1, 1, 0], [0, 1, 0]],
                       ['/m/a/b/x.flac', '/m/a/b/y.flac', '/m/a/b/z.flac'])
        results = arm.search(0, k=2)
        self.assertAlmostEqual(results[0][3], float(np.sqrt(0.5)), places=5)
        self.assertAlmostEqual(results[1][3], 0.0, places=5)

    def test_self_is_excluded(self):
        arm = self.arm([[1, 0], [0, 1], [1, 1]], ['/m/a/b/x.flac', '/m/a/b/y.flac',
                                                  '/m/a/b/z.flac'])
        self.assertNotIn(0, [r[0] for r in arm.search(0, k=2)])

    def test_results_are_sorted_descending(self):
        rng = np.random.default_rng(0)
        vectors = rng.standard_normal((40, 8))
        arm = self.arm(vectors, [f'/m/a/b/{i}.flac' for i in range(40)])
        scores = [r[3] for r in arm.search(3, k=10)]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_argpartition_agrees_with_a_full_sort(self):
        # The only optimisation in the module. If it disagrees with the naive
        # version the whole gate is reading a subtly wrong list.
        rng = np.random.default_rng(7)
        vectors = rng.standard_normal((200, 16))
        arm = self.arm(vectors, [f'/m/a/b/{i}.flac' for i in range(200)])
        scores = arm.matrix @ arm.matrix[5]
        scores[5] = -np.inf
        expected = list(np.argsort(-scores)[:10])
        self.assertEqual([r[0] for r in arm.search(5, k=10)], expected)

    def test_k_larger_than_the_corpus_is_clamped(self):
        arm = self.arm([[1, 0], [0, 1], [1, 1]],
                       ['/m/a/b/x.flac', '/m/a/b/y.flac', '/m/a/b/z.flac'])
        self.assertEqual(len(arm.search(0, k=50)), 2)

    def test_a_raw_vector_can_be_the_query(self):
        arm = self.arm([[1, 0], [0, 1]], ['/m/a/b/x.flac', '/m/a/b/y.flac'])
        results = arm.search(np.array([2.0, 0.0], dtype=np.float32), k=2)
        self.assertEqual(results[0][2], '/m/a/b/x.flac')
        self.assertAlmostEqual(results[0][3], 1.0, places=5)

    def test_an_unnormalised_arm_is_normalised_on_load(self):
        # ⚠️ The producers already L2-normalise. This is the guard that a future
        # arm which forgets returns a biased ranking rather than a wrong-looking
        # one — a long vector would otherwise win every query for being long.
        arm = query.Arm('local_vectors', np.array([[10.0, 0.0], [0.0, 1.0]], dtype=np.float32),
                        ['/m/a/b/x.flac', '/m/a/b/y.flac'], [1, 2])
        self.assertTrue(np.allclose(np.linalg.norm(arm.matrix, axis=1), 1.0))
        self.assertAlmostEqual(arm.search(1, k=1)[0][3], 0.0, places=5)

    def test_an_empty_arm_raises_rather_than_returning_nothing(self):
        with self.assertRaises(query.QueryError):
            query.Arm('local_vectors', np.empty((0, 0), dtype=np.float32), [], [])

    def test_nearest_matches_a_brute_force_scan(self):
        rng = np.random.default_rng(3)
        # More rows than the 512 chunk, so the chunked diagonal masking is exercised.
        vectors = rng.standard_normal((700, 6))
        arm = self.arm(vectors, [f'/m/a/b/{i}.flac' for i in range(700)])
        scores = arm.matrix @ arm.matrix.T
        np.fill_diagonal(scores, -np.inf)
        self.assertTrue(np.array_equal(arm.nearest(), scores.argmax(axis=1)))


# ── Alignment: §8.7's second proxy lie ──────────────────────────────────────────
class AlignTest(QueryTestCase):
    def make_arms(self):
        # The path is keyed to the id in BOTH arms, because that is the invariant
        # the real index enforces with a foreign key — a fixture where one id
        # names two files would be testing a database that cannot exist.
        a = query.Arm('local_vectors', np.eye(4, dtype=np.float32),
                      [f'/m/a/b/{i}.flac' for i in (1, 2, 3, 4)], [1, 2, 3, 4])
        b = query.Arm('descriptors', np.eye(4, dtype=np.float32)[::-1].copy(),
                      [f'/m/a/b/{i}.flac' for i in (3, 4, 5, 6)], [3, 4, 5, 6])
        return a, b

    def test_align_keeps_only_the_shared_ids(self):
        a, b = query.align(*self.make_arms())
        self.assertEqual(a.ids, [3, 4])
        self.assertEqual(b.ids, [3, 4])

    def test_align_puts_both_arms_in_the_same_order(self):
        a, b = query.align(*self.make_arms())
        self.assertEqual(a.paths, b.paths)

    def test_align_carries_the_right_rows(self):
        # The trap is an alignment that lines up the ids and shuffles the vectors,
        # which produces a plausible ranking over the wrong audio.
        original_a, original_b = self.make_arms()
        a, b = query.align(original_a, original_b)
        self.assertTrue(np.allclose(a.matrix[0], original_a.matrix[2]))
        self.assertTrue(np.allclose(b.matrix[0], original_b.matrix[0]))

    def test_align_leaves_the_originals_alone(self):
        original_a, original_b = self.make_arms()
        query.align(original_a, original_b)
        self.assertEqual(len(original_a), 4)
        self.assertEqual(len(original_b), 4)

    def test_disjoint_arms_raise_with_the_fix_in_the_message(self):
        a = query.Arm('local_vectors', np.eye(2, dtype=np.float32),
                      ['/m/a/b/1.flac', '/m/a/b/2.flac'], [1, 2])
        b = query.Arm('descriptors', np.eye(2, dtype=np.float32),
                      ['/m/a/b/8.flac', '/m/a/b/9.flac'], [8, 9])
        with self.assertRaises(query.QueryError) as caught:
            query.align(a, b)
        self.assertIn('--build --encoded', str(caught.exception))

    def test_load_arm_reads_both_tables_from_the_index(self):
        self.add('/m/a/b/1.flac', neural=[1, 0, 0], descriptor=np.arange(4, dtype=np.float32))
        self.add('/m/a/b/2.flac', neural=[0, 1, 0], descriptor=np.arange(4, 8, dtype=np.float32))
        self.add('/m/a/b/3.flac', neural=[0, 0, 1])
        neural = query.load_arm(self.conn, 'local_vectors')
        self.assertEqual(len(neural), 3)
        self.assertEqual(neural.dim, 3)

    def test_the_index_join_and_align_agree(self):
        self.add('/m/a/b/1.flac', neural=[1, 0], descriptor=np.arange(4, dtype=np.float32))
        self.add('/m/a/b/2.flac', neural=[0, 1], descriptor=np.arange(4, 8, dtype=np.float32))
        for i in range(3, 11):
            self.add(f'/m/a/b/{i}.flac', neural=[1, i])
        shared = self.conn.execute(
            'SELECT COUNT(*) AS n FROM local_vectors v '
            'JOIN descriptors d ON d.track_id = v.track_id').fetchone()['n']
        # `descriptors` needs 8 rows before `CorpusStats.fit` will describe them,
        # so the descriptor arm is padded to the fit floor and then intersected.
        for i in range(11, 20):
            self.add(f'/m/c/d/{i}.flac', descriptor=np.arange(i, i + 4, dtype=np.float32))
        arms = query.align(*(query.load_arm(self.conn, t) for t in query.ARMS))
        self.assertEqual(len(arms[0]), shared)


# ── The duplicate-aware proxies: §8.7's first proxy lie ─────────────────────────
class ReportTest(QueryTestCase):
    def shelf(self):
        """Two albums by one artist plus a stranger, with one track duplicated
        across a single — the shape §8.6 found 20% of the library in."""
        paths, vectors = [], []
        for album, base in (('AFI/Sing The Sorrow', [1, 0, 0, 0]),
                            ('AFI/Decemberunderground', [0, 1, 0, 0]),
                            ('Blue October/Foiled', [0, 0, 1, 0])):
            for t in range(6):
                paths.append(f'/m/{album}/0{t + 1}. Track {t + 1}.flac')
                vectors.append(np.array(base, dtype=np.float32) + 0.01 * t)
        # The duplicate: the same recording filed again under a single, with the
        # identical vector — which is what §8.6 measured actually happens.
        paths.append('/m/AFI/AFI - The Single/01 - Track 1.flac')
        vectors.append(vectors[0].copy())
        return self.arm(vectors, paths)

    def test_the_three_album_rates_are_three_different_numbers(self):
        r = query.report(self.shelf(), pairs=5000)
        self.assertNotEqual(r['nn_album_raw'], r['nn_album_credited'])
        self.assertGreater(r['nn_album_credited'], r['nn_album_raw'])

    def test_a_duplicate_neighbour_is_a_miss_raw_and_a_hit_credited(self):
        arm = self.shelf()
        r = query.report(arm, pairs=5000)
        # The single and the album track are each other's nearest neighbour at
        # cosine 1.0, and they are on different albums.
        self.assertGreater(r['nn_dup'], 0.0)
        self.assertAlmostEqual(r['nn_album_credited'],
                               r['nn_album_raw'] + r['nn_dup'], places=6)

    def test_the_clean_rate_is_measured_over_a_smaller_population(self):
        arm = self.shelf()
        r = query.report(arm, pairs=5000)
        self.assertEqual(r['nn_clean_n'], len(arm) - int(round(r['nn_dup'] * len(arm))))
        self.assertLess(r['nn_clean_n'], len(arm))

    def test_chance_is_recomputed_for_this_population(self):
        r = query.report(self.shelf(), pairs=5000)
        # 19 tracks, 3 artist folders — nothing like the 39-artist library §8.4
        # measured, which is exactly why the baseline travels with the rate.
        self.assertGreater(r['chance_artist'], r['chance_album'])
        self.assertLess(r['chance_album'], 1.0)

    def test_duplicate_share_counts_tracks_not_groups(self):
        songs = np.array(['a', 'a', 'b', 'c'])
        self.assertAlmostEqual(query._duplicate_share(songs), 0.5)

    def test_a_tiny_corpus_raises_rather_than_reporting_noise(self):
        arm = self.arm([[1, 0], [0, 1]], ['/m/a/b/1.flac', '/m/a/b/2.flac'])
        with self.assertRaises(query.QueryError):
            query.report(arm)

    def test_unmeasured_categories_come_back_as_nan_not_zero(self):
        # One album, one artist: "different artist" has no pairs at all. §8.4's
        # gate once read FAILED on exactly this, because `nan > x` is False and
        # an unmeasured category had been printed as a measured nothing.
        paths = [f'/m/A/Alb/0{i}. T{i}.flac' for i in range(1, 7)]
        r = query.report(self.arm(np.eye(6), paths), pairs=2000)
        self.assertEqual(r['different'][2], 0)
        self.assertTrue(np.isnan(r['different'][0]))


class DuplicateAuditTest(QueryTestCase):
    def test_the_audit_agrees_when_the_names_match_the_cosines(self):
        paths = ['/m/A/Alb/01. Song One.flac', '/m/A/Single/01 - Song One.flac',
                 '/m/A/Alb/02. Song Two.flac', '/m/A/Alb/03. Song Three.flac']
        vectors = [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
        audit = query.duplicate_audit(self.arm(vectors, paths))
        self.assertEqual(audit['by_cosine'], 2)
        self.assertEqual(audit['by_name'], 2)
        self.assertEqual(audit['agreement'], 1.0)

    def test_the_audit_reports_a_disagreement_rather_than_hiding_it(self):
        # Two genuinely different songs that happen to sit on top of each other.
        # The point of the audit is that this shows up as a number, not that it
        # cannot happen.
        paths = ['/m/A/Alb/01. Song One.flac', '/m/A/Alb/02. Song Two.flac',
                 '/m/A/Alb/03. Song Three.flac', '/m/A/Alb/04. Song Four.flac']
        vectors = [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
        audit = query.duplicate_audit(self.arm(vectors, paths))
        self.assertEqual(audit['by_name'], 0)
        self.assertEqual(audit['cosine_not_name'], 2)
        self.assertEqual(audit['agreement'], 0.0)


# ── The sheets ──────────────────────────────────────────────────────────────────
class SheetTest(QueryTestCase):
    def build(self):
        for i in range(1, 13):
            artist = 'AFI' if i <= 6 else 'Blue October'
            base = [1.0, 0.0] if i <= 6 else [0.0, 1.0]
            vec = np.array(base, dtype=np.float32) + 0.01 * i
            self.add(f'/m/{artist}/Album/0{i}. Track {i}.flac', neural=vec,
                     descriptor=np.array([i, i * 2.0, i * 3.0, 1.0], dtype=np.float32))

    def test_side_by_side_prints_both_arms_and_k_rows(self):
        import io
        self.build()
        arms = query.align(*(query.load_arm(self.conn, t) for t in query.ARMS))
        out = io.StringIO()
        query.side_by_side(arms, 0, k=3, stream=out)
        text = out.getvalue()
        for arm in arms:
            self.assertIn(arm.label, text)
        self.assertEqual(len([l for l in text.splitlines() if l.startswith('   1 ')]), 1)

    def test_the_hand_sheet_says_out_loud_that_it_is_not_scored(self):
        # ⚠️ §8.7 forbids automating this judgement. If a verdict ever appears
        # on the hand sheet, this fails.
        import io
        self.build()
        out = io.StringIO()
        query.hand_sheet(self.conn, k=3, stream=out)
        text = out.getvalue()
        self.assertIn('READ, not scored', text)
        self.assertNotIn('PASSED', text)
        self.assertNotIn('FAILED', text)

    def test_the_hand_sheet_takes_one_track_per_artist_by_default(self):
        import io
        self.build()
        out = io.StringIO()
        rows = query.hand_sheet(self.conn, k=2, stream=out)
        self.assertEqual(len(rows), 2)

    def test_a_query_fragment_that_matches_nothing_raises(self):
        self.build()
        arm = query.load_arm(self.conn, 'local_vectors')
        with self.assertRaises(query.QueryError):
            query._resolve(arm, ['no such band'])

    def test_a_query_fragment_is_case_insensitive(self):
        self.build()
        arm = query.load_arm(self.conn, 'local_vectors')
        self.assertEqual(len(query._resolve(arm, ['blue october'])), 1)

    def test_marks_read_the_three_relationships(self):
        album = '/m/AFI/Alb/01. One.flac'
        self.assertEqual(query._marks(album, '/m/AFI/Alb/02. Two.flac', 0.5), ' Aa')
        self.assertEqual(query._marks(album, '/m/AFI/Other/02. Two.flac', 0.5), '  a')
        self.assertEqual(query._marks(album, '/m/BO/Other/02. Two.flac', 0.5), '   ')
        # A single is filed under the same artist, so `=` and `a` both light —
        # which is the whole shape §8.7 needs to see: a cross-ALBUM hit that is
        # nonetheless the most correct answer available.
        self.assertEqual(query._marks(album, '/m/AFI/Single/01 - One.flac', 0.5), '= a')
        # …and a near-1 cosine alone is enough, even when the names disagree.
        self.assertEqual(query._marks(album, '/m/BO/Other/09. Nine.flac', 0.9995), '=  ')


class GateTest(QueryTestCase):
    def seed(self, neural_good=True):
        """Twelve tracks over two artists. The neural arm clusters by album; the
        descriptor arm is noise unless asked to be otherwise."""
        rng = np.random.default_rng(1)
        for i in range(1, 13):
            artist = 'AFI' if i <= 6 else 'Blue October'
            good = np.array([1.0, 0.0] if i <= 6 else [0.0, 1.0], dtype=np.float32)
            noise = rng.standard_normal(2).astype(np.float32)
            self.add(f'/m/{artist}/Album/0{i}. Track {i}.flac',
                     neural=good + 0.01 * i if neural_good else noise,
                     descriptor=np.concatenate([noise, [float(i), 1.0]]))

    def test_the_gate_prints_the_stop_condition_when_the_baseline_wins(self):
        # ⚠️ §8.7's stop condition belongs in the terminal, not only in a
        # document — the person reading a red gate is reading the terminal.
        import io
        self.seed(neural_good=False)
        out = io.StringIO()
        passed = query.gate(self.conn, stream=out)
        if not passed:
            self.assertIn('STOP CONDITION', out.getvalue())

    def test_the_gate_reports_over_one_population(self):
        import io
        self.seed()
        out = io.StringIO()
        query.gate(self.conn, stream=out)
        self.assertIn('tracks in BOTH arms', out.getvalue())

    def test_the_gate_never_claims_to_be_the_gate(self):
        import io
        self.seed()
        out = io.StringIO()
        query.gate(self.conn, stream=out)
        self.assertIn('not the gate', out.getvalue())


class SearchGuardTest(QueryTestCase):
    """`k` and `row` come off a command line, and `argpartition` accepts nonsense.

    ⚠️ `np.argpartition(-scores, k - 1)` with k ≤ 0 passes a NEGATIVE kth, which
    numpy reads from the end of the array and answers without complaint — so
    `-k 0` returned an empty list and `-k -3` returned four arbitrary rows
    presented as the four nearest. A search that is confidently wrong about its
    own ordering is the one thing this module exists not to be.
    """

    def four(self):
        paths = [f'/lib/A/Al/{i}. t{i}.flac' for i in range(4)]
        return self.arm([[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0], [0, 0, 1]], paths)

    def test_k_below_one_is_refused(self):
        arm = self.four()
        for bad in (0, -1, -3):
            with self.assertRaises(query.QueryError):
                arm.search(0, bad)

    def test_k_beyond_the_corpus_is_clamped_not_padded(self):
        self.assertEqual(len(self.four().search(0, 999)), 3)

    def test_a_row_outside_the_arm_is_refused(self):
        arm = self.four()
        with self.assertRaises(query.QueryError):
            arm.search(9, 2)

    def test_a_query_vector_of_the_wrong_width_is_refused(self):
        with self.assertRaises(query.QueryError):
            self.four().search(np.ones(7, dtype=np.float32), 2)

    def test_a_single_track_arm_has_no_neighbours_rather_than_itself(self):
        arm = self.arm([[1, 0, 0]], ['/lib/A/Al/0. only.flac'])
        self.assertEqual(arm.search(0, 5), [])
        with self.assertRaises(query.QueryError):
            arm.nearest()

    def test_an_arm_whose_labels_do_not_match_its_vectors_is_refused(self):
        """Paths, ids and rows are read POSITIONALLY by every rate in this
        module, so a length mismatch does not raise anywhere downstream — it
        labels each neighbour with a different track."""
        with self.assertRaises(query.QueryError):
            query.Arm('local_vectors', np.eye(3, dtype=np.float32),
                      ['/a/b/1.flac', '/a/b/2.flac'], [1, 2, 3])

    def test_nearest_is_computed_once_per_arm(self):
        """`gate()` asks three times — two reports and the duplicate audit — and
        at 15,326 x 512 one pass is ~120 GFLOP."""
        arm = self.four()
        first = arm.nearest()
        self.assertIs(arm.nearest(), first)
        self.assertFalse(first.flags.writeable)          # shared, so read-only


class EmptyAndPartialIndexTest(QueryTestCase):
    """The states anyone hits in their first ten minutes: nothing built, one arm
    built, a fragment that matches nothing. Each used to be a traceback."""

    def test_an_unfilled_arm_says_so(self):
        with self.assertRaises(query.QueryError) as caught:
            query.load_arm(self.conn, 'local_vectors')
        self.assertIn('backfill', str(caught.exception))

    def test_a_fragment_that_matches_nothing_names_the_fragment(self):
        for i in range(4):
            self.add(f'/lib/A/Al/{i}. t{i}.flac', neural=np.eye(4)[i],
                     descriptor=np.arange(4) + i)
        arm = query.load_arm(self.conn, 'local_vectors')
        with self.assertRaises(query.QueryError) as caught:
            query._resolve(arm, ['nothing-like-this'])
        self.assertIn('nothing-like-this', str(caught.exception))

    def test_the_cli_prints_one_line_and_exits_one(self):
        """A typo in a search fragment is a user event, not a crash."""
        import contextlib
        import io as _io
        saved, index.DB_PATH = index.DB_PATH, os.path.join(self.tmp, 'index.db')
        err = _io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                code = query._main(['does-not-exist'])
        finally:
            index.DB_PATH = saved
        self.assertEqual(code, 1)
        self.assertIn('QueryError', err.getvalue())
        self.assertNotIn('Traceback', err.getvalue())


if __name__ == '__main__':
    unittest.main()
