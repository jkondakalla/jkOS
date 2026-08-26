"""M3's baseline arm under test (ToDo §8.4).

These check the MATH and the ONE STRUCTURAL RULE, because every failure mode
here produces a perfectly plausible array of 119 floats:

  * each descriptor measures what its name says — pinned against signals whose
    correct answer is known in closed form (a sine's centroid IS its frequency,
    a sine's zero-crossing rate IS 2f/SR, white noise's centroid IS SR/4). A
    feature that is subtly wrong still returns numbers, and no gate downstream
    can tell the difference;
  * the DCT is orthonormal and coefficient 0 is the only one that moves when the
    signal gets louder — the property that makes MFCCs a timbre description
    rather than a loudness description with extra steps;
  * chroma is octave-invariant and lands a known note in the right pitch class;
  * **the z-score cannot be fitted on one track.** This is the module's central
    warning, and the test exists so that the refusal is a property of the code
    rather than of whoever is reading it next;
  * blocked and unblocked computation agree — the whole descriptor now streams
    across FFT blocks, so a bug in the seams would show up as a track-length
    dependent answer, which is close to undebuggable at M4;
  * and the end-to-end claim the §8.4 gate makes, on synthesised audio: tracks
    from the same "album" sit closer than tracks from different ones.
"""
import io
import os
import shutil
import tempfile
import unittest

import numpy as np

import config
import descriptors
import index
import mel
from tests import helpers


def sine(freq, seconds=4.0, amplitude=0.5, sr=None):
    sr = sr or config.SR
    t = np.arange(int(seconds * sr), dtype=np.float64) / sr
    return (amplitude * np.sin(2.0 * np.pi * freq * t)).astype(np.float32)


def noise(seconds=4.0, amplitude=0.2, seed=0, sr=None):
    sr = sr or config.SR
    return (amplitude * np.random.RandomState(seed).randn(int(seconds * (sr or config.SR)))).astype(np.float32)


def clicks(bpm, seconds=20.0, seed=0):
    """A broadband click every beat — a signal whose tempo is known exactly."""
    sr = config.SR
    x = np.zeros(int(seconds * sr), dtype=np.float32)
    period = int(round(60.0 / bpm * sr))
    burst = int(0.02 * sr)
    envelope = np.exp(-np.linspace(0.0, 6.0, burst))
    rng = np.random.RandomState(seed)
    for start in range(0, x.size - burst, period):
        x[start:start + burst] += (rng.randn(burst) * envelope).astype(np.float32)
    return x


def value(vector, name):
    return float(vector[descriptors.feature_names().index(name)])


class LayoutTest(unittest.TestCase):
    def test_dim_matches_layout_and_names(self):
        self.assertEqual(descriptors.DIM, sum(n for _, n in descriptors.LAYOUT))
        self.assertEqual(len(descriptors.feature_names()), descriptors.DIM)

    def test_names_are_unique(self):
        names = descriptors.feature_names()
        self.assertEqual(len(set(names)), len(names))

    def test_dimension_count_is_in_the_specified_band(self):
        """ToDo §8.4 budgets ~90–160 dimensions. Below that the baseline is too
        weak to be a fair opponent at M4; far above it and the z-score is being
        fitted over more dimensions than the corpus has tracks to constrain."""
        self.assertGreaterEqual(descriptors.DIM, 90)
        self.assertLessEqual(descriptors.DIM, 160)

    def test_describe_returns_exactly_dim(self):
        vector = descriptors.describe(sine(440.0))
        self.assertEqual(vector.shape, (descriptors.DIM,))
        self.assertEqual(vector.dtype, np.dtype('float32'))

    def test_parts_and_layout_cannot_drift(self):
        """`describe` asserts the blocks it assembled match LAYOUT. Remove a block
        and it must fail loudly rather than emit a shorter vector."""
        original = descriptors.LAYOUT
        try:
            descriptors.LAYOUT = original[:-1]
            with self.assertRaises(AssertionError):
                descriptors.describe(sine(440.0, 1.0))
        finally:
            descriptors.LAYOUT = original


class DCTTest(unittest.TestCase):
    def test_orthonormal(self):
        """The DCT must be a ROTATION, not just a projection: it preserves
        distance, so distances between MFCC vectors mean what distances between
        log-mel vectors would have meant."""
        n = config.N_MELS
        original = descriptors.N_MFCC
        try:
            descriptors.N_MFCC = n
            mel._CACHE.clear()
            full = descriptors.dct_matrix().astype(np.float64)
            np.testing.assert_allclose(full @ full.T, np.eye(n), atol=1e-6)
        finally:
            descriptors.N_MFCC = original
            mel._CACHE.clear()

    def test_constant_input_lands_entirely_in_coefficient_zero(self):
        d = descriptors.dct_matrix().astype(np.float64)
        constant = np.ones((config.N_MELS, 1))
        out = d @ constant
        self.assertGreater(abs(out[0, 0]), 1.0)
        np.testing.assert_allclose(out[1:, 0], 0.0, atol=1e-6)

    def test_only_coefficient_zero_moves_with_loudness(self):
        """THE property that makes MFCCs a timbre description. Scaling a signal
        multiplies every mel band by the same factor, which ADDS a constant to
        every log-mel band, and a constant offset is exactly what coefficient 0
        absorbs — so a track played louder has the same timbre vector with one
        dimension shifted, rather than a different vector.

        The shift is predictable in closed form, since coefficient 0's row of the
        orthonormal DCT is the constant √(1/N): scaling by `a` moves it by
        √N·ln(a). Checked against that, not merely against 'it moved'.
        """
        quiet = descriptors.mfcc(mel.logmelspectrogram(noise(4.0, 0.05)))
        loud = descriptors.mfcc(mel.logmelspectrogram(noise(4.0, 0.4)))
        shift = (loud - quiet).mean(axis=1)
        self.assertAlmostEqual(float(shift[0]),
                               float(np.sqrt(config.N_MELS) * np.log(64.0)), places=3)
        np.testing.assert_allclose(shift[1:], 0.0, atol=1e-4)

    def test_the_log_floor_breaks_loudness_invariance_once_bands_clamp(self):
        """⚠️ THE LIMIT OF THE PROPERTY ABOVE, pinned so it is not assumed away.

        The invariance holds only while every mel band stays above LOG_FLOOR.
        A pure sine has near-zero energy in most of its 128 bands, so quietening
        it pushes more than half of them onto the floor — and a clamped band does
        not shift by ln(a), so the offset stops being constant and coefficients
        1..19 move too. Broadband material (i.e. all real music, which has a noise
        floor) never gets near this. Worth knowing before anyone concludes that
        MFCCs are unconditionally loudness-invariant and stops z-scoring.
        """
        floor = mel.log_floor_value()
        clamped = mel.logmelspectrogram(sine(440.0, amplitude=0.1))
        self.assertGreater(float((clamped <= floor + 1e-4).mean()), 0.25)
        shift = (descriptors.mfcc(mel.logmelspectrogram(sine(440.0, amplitude=0.8)))
                 - descriptors.mfcc(clamped)).mean(axis=1)
        self.assertGreater(float(np.abs(shift[1:]).max()), 1.0)


class ChromaTest(unittest.TestCase):
    def chroma_of(self, freq):
        vector = descriptors.describe(sine(freq))
        start = descriptors.feature_names().index('chroma_mean[0]')
        return vector[start:start + 12]

    def test_a440_lands_in_pitch_class_nine(self):
        """A4 is MIDI 69, and 69 % 12 == 9. If this is off by one the whole
        harmonic axis is transposed and nothing downstream would ever say so."""
        self.assertEqual(int(np.argmax(self.chroma_of(440.0))), 9)

    def test_middle_c_lands_in_pitch_class_zero(self):
        self.assertEqual(int(np.argmax(self.chroma_of(261.63))), 0)

    def test_octave_invariant(self):
        """The defining property of a chroma: every A is the same A."""
        for freq in (440.0, 880.0, 1760.0):
            self.assertEqual(int(np.argmax(self.chroma_of(freq))), 9, f'{freq} Hz')

    def test_a_fifth_is_not_the_same_class(self):
        """Octave-folding must not fold anything else."""
        self.assertNotEqual(int(np.argmax(self.chroma_of(440.0))),
                            int(np.argmax(self.chroma_of(659.26))))   # E5

    def test_filterbank_is_a_partition_of_unity(self):
        """Each in-band FFT bin distributes exactly its own weight across pitch
        classes — energy is redistributed, never created or lost by where a bin
        happens to fall between two semitones."""
        bank = descriptors.chroma_filterbank()
        column_sums = bank.sum(axis=0)
        live = column_sums > 0
        np.testing.assert_allclose(column_sums[live], 1.0, atol=1e-5)

    def test_out_of_band_bins_carry_no_weight(self):
        freqs = mel.fft_frequencies()
        bank = descriptors.chroma_filterbank()
        below = freqs < descriptors.chroma_min_hz()
        above = freqs > min(descriptors.CHROMA_FMAX, config.FMAX)
        self.assertEqual(float(bank[:, below].sum()), 0.0)
        self.assertEqual(float(bank[:, above].sum()), 0.0)

    def test_min_hz_is_where_a_semitone_equals_one_bin(self):
        """⚠️ The honest floor of the feature, derived rather than guessed: below
        it, FFT bins are wider than semitones and 'chroma' would be bins smeared
        across pitch classes. A test rather than a comment so that changing N_FFT
        at §8.5 cannot quietly turn the derivation into a lie."""
        floor = descriptors.chroma_min_hz()
        semitone_width = floor * (2.0 ** (1.0 / 12.0) - 1.0)
        self.assertAlmostEqual(semitone_width, config.SR / config.N_FFT, places=6)

    def test_bass_is_below_the_floor_at_this_config(self):
        """Recording the consequence: at N_FFT=2048/SR=22050 the chroma cannot
        see a bass guitar. That is arithmetic, and it should be visible here
        rather than discovered at M4."""
        self.assertGreater(descriptors.chroma_min_hz(), 130.0)   # above C3


class SpectralShapeTest(unittest.TestCase):
    def test_sine_centroid_is_its_own_frequency(self):
        for freq in (440.0, 2000.0, 4000.0):
            self.assertAlmostEqual(value(descriptors.describe(sine(freq)), 'centroid_mean'),
                                   freq, delta=freq * 0.02)

    def test_white_noise_centroid_is_a_quarter_of_the_sample_rate(self):
        """A flat spectrum's balance point is the middle of the band — Nyquist/2,
        i.e. SR/4. Closed form, so a windowing or frequency-axis error shows up
        as a number that is simply wrong rather than merely surprising."""
        self.assertAlmostEqual(value(descriptors.describe(noise()), 'centroid_mean'),
                               config.SR / 4.0, delta=config.SR * 0.01)

    def test_white_noise_bandwidth_matches_a_uniform_spread(self):
        """The standard deviation of a uniform distribution over [0, Nyquist]."""
        self.assertAlmostEqual(value(descriptors.describe(noise()), 'bandwidth_mean'),
                               (config.SR / 2.0) / np.sqrt(12.0), delta=200.0)

    def test_white_noise_rolloff_is_the_percentile_of_the_band(self):
        self.assertAlmostEqual(value(descriptors.describe(noise()), 'rolloff_mean'),
                               descriptors.ROLLOFF_PERCENT * config.SR / 2.0, delta=200.0)

    def test_flatness_separates_a_tone_from_a_hiss(self):
        tone = value(descriptors.describe(sine(440.0)), 'flatness_mean')
        hiss = value(descriptors.describe(noise()), 'flatness_mean')
        self.assertLess(tone, 0.01)
        self.assertGreater(hiss, 0.3)

    def test_bandwidth_separates_a_tone_from_a_hiss(self):
        self.assertLess(value(descriptors.describe(sine(440.0)), 'bandwidth_mean'),
                        value(descriptors.describe(noise()), 'bandwidth_mean') / 10.0)

    def test_zero_crossing_rate_is_twice_the_frequency_over_the_sample_rate(self):
        """A sine crosses zero twice per cycle. Exact, and the one feature
        computed in the time domain — so it independently confirms the framing."""
        for freq in (220.0, 440.0, 4000.0):
            self.assertAlmostEqual(value(descriptors.describe(sine(freq)), 'zcr_mean'),
                                   2.0 * freq / config.SR, delta=0.005)

    def test_white_noise_crosses_zero_half_the_time(self):
        self.assertAlmostEqual(value(descriptors.describe(noise()), 'zcr_mean'), 0.5, delta=0.02)

    def test_rms_tracks_amplitude(self):
        """A sine of amplitude A has RMS A/√2; stored in the log domain, so the
        difference between two amplitudes is the log of their ratio."""
        loud = value(descriptors.describe(sine(440.0, amplitude=0.8)), 'logrms_mean')
        quiet = value(descriptors.describe(sine(440.0, amplitude=0.1)), 'logrms_mean')
        self.assertAlmostEqual(loud - quiet, float(np.log(8.0)), delta=0.05)

    def test_silence_produces_finite_numbers(self):
        """Real tracks have silent lead-in and lead-out. Every guarded denominator
        in `spectral_shape` exists for this, and an inf here would propagate
        through the whole matmul at §8.7 rather than affecting one track."""
        vector = descriptors.describe(np.zeros(config.SR * 3, dtype=np.float32))
        self.assertTrue(np.all(np.isfinite(vector)))
        self.assertEqual(value(vector, 'centroid_mean'), 0.0)


class TempoTest(unittest.TestCase):
    def test_recovers_a_known_click_tempo(self):
        for bpm in (90.0, 120.0, 150.0):
            found = 2.0 ** value(descriptors.describe(clicks(bpm)), 'tempo_log2bpm')
            self.assertAlmostEqual(found, bpm, delta=bpm * 0.05, msg=f'{bpm} BPM')

    def test_onset_rate_is_octave_robust(self):
        """The reason `onset_rate` is stored beside the tempo estimate: it counts
        events, so a metrical-harmonic error in the autocorrelation cannot take
        the track's rhythmic character with it."""
        for bpm in (90.0, 120.0, 150.0):
            rate = value(descriptors.describe(clicks(bpm)), 'onset_rate')
            self.assertAlmostEqual(rate, bpm / 60.0, delta=0.25, msg=f'{bpm} BPM')

    def test_prior_is_centred_where_it_claims(self):
        """The mitigation for the metrical-harmonic problem §8.2 already hit. If
        the prior drifted off 120 it would bias every tempo in the corpus in one
        direction, which is worse than the ambiguity it exists to break."""
        fps = descriptors.frames_per_second()
        lags = np.arange(max(1, int(round(60.0 * fps / descriptors.TEMPO_MAX_BPM))),
                         int(round(60.0 * fps / descriptors.TEMPO_MIN_BPM)) + 1)
        bpms = 60.0 * fps / lags
        prior = np.exp(-0.5 * (np.log2(bpms / descriptors.TEMPO_PRIOR_BPM)
                               / descriptors.TEMPO_PRIOR_OCTAVES) ** 2)
        self.assertAlmostEqual(float(bpms[int(np.argmax(prior))]),
                               descriptors.TEMPO_PRIOR_BPM, delta=6.0)

    def test_silence_falls_back_to_the_prior_centre(self):
        """An unmeasured tempo, not a measured zero — a 0 BPM would be a real
        outlier in the corpus fit and would drag the z-score for every track."""
        log2bpm, strength, rate = descriptors.tempo(np.zeros(2000))
        self.assertAlmostEqual(2.0 ** log2bpm, descriptors.TEMPO_PRIOR_BPM, places=3)
        self.assertEqual(strength, 0.0)
        self.assertEqual(rate, 0.0)

    def test_too_short_to_see_the_slowest_tempo_falls_back(self):
        log2bpm, strength, _rate = descriptors.tempo(np.abs(np.random.RandomState(0).randn(20)))
        self.assertAlmostEqual(2.0 ** log2bpm, descriptors.TEMPO_PRIOR_BPM, places=3)
        self.assertEqual(strength, 0.0)

    def test_onset_envelope_ignores_energy_leaving(self):
        """Positive flux only. A note ENDING is not an onset, and counting it
        would double the apparent event rate of anything staccato."""
        logmel = np.zeros((config.N_MELS, 5), dtype=np.float32)
        logmel[:, 2] = 4.0                      # one frame louder, then quiet again
        env = descriptors.onset_envelope(logmel)
        self.assertGreater(env[2], 0.0)
        self.assertEqual(float(env[3]), 0.0)


class OnePassTest(unittest.TestCase):
    def test_blocking_does_not_change_the_descriptor(self):
        """The whole vector now streams across FFT blocks. If the seams were
        wrong the answer would depend on track length, which at M4 would read as
        'long tracks are all similar to each other' and be nearly undebuggable."""
        x = sine(440.0, 3.0) + noise(3.0, 0.05)
        full = descriptors.describe(x)
        original = mel.BLOCK_FRAMES
        try:
            mel.BLOCK_FRAMES = 13               # ragged on purpose
            blocked = descriptors.describe(x)
        finally:
            mel.BLOCK_FRAMES = original
        np.testing.assert_allclose(full, blocked, rtol=1e-5, atol=1e-5)

    def test_deterministic(self):
        x = sine(440.0, 2.0)
        self.assertEqual(descriptors.describe(x).tobytes(), descriptors.describe(x).tobytes())

    def test_magnitude_is_independent_of_the_power_setting(self):
        """`magnitude_of` exists so the classical definitions keep their meaning
        if §8.5 flips config.POWER to match an encoder."""
        x = sine(440.0, 1.0)
        original = config.POWER
        magnitudes = {}
        try:
            for power_setting in (1.0, 2.0):
                config.POWER = power_setting
                mel._CACHE.clear()
                # Both `_power_of` and `magnitude_of` read config at call time, so
                # the pair has to be evaluated inside the same setting — which is
                # how a real run uses them, config being fixed for its duration.
                _start, _frames, spectrum = next(mel.iter_blocks(x))
                magnitudes[power_setting] = mel.magnitude_of(spectrum)
        finally:
            config.POWER = original
            mel._CACHE.clear()
        np.testing.assert_allclose(magnitudes[2.0], magnitudes[1.0], rtol=1e-4, atol=1e-6)

    def test_refuses_a_signal_too_short_for_statistics(self):
        with self.assertRaises(descriptors.DescriptorError):
            descriptors.describe(np.zeros(64, dtype=np.float32))


class CorpusStatsTest(unittest.TestCase):
    """⚠️ THE CENTRAL RULE OF §8.4, made mechanical.

    'Z-score across the corpus, not per track.' Per-track normalisation makes a
    bright track and a dark track both read 'average brightness for themselves',
    and every distance in the space collapses toward noise — with no error and no
    NaN to notice. The defence is that there is no per-track normaliser to reach
    for: `fit` refuses a corpus that is not one.
    """

    def corpus(self, n=32, dim=None, seed=0):
        dim = dim or descriptors.DIM
        return np.random.RandomState(seed).randn(n, dim).astype(np.float32) * 7.0 + 3.0

    def test_refuses_to_fit_on_one_track(self):
        with self.assertRaises(ValueError) as caught:
            descriptors.CorpusStats.fit(self.corpus(1))
        self.assertIn('per-track', str(caught.exception))

    def test_refuses_a_corpus_below_the_floor(self):
        with self.assertRaises(ValueError):
            descriptors.CorpusStats.fit(self.corpus(descriptors.MIN_FIT_ROWS - 1))

    def test_refuses_a_bare_vector(self):
        with self.assertRaises(ValueError):
            descriptors.CorpusStats.fit(np.zeros(descriptors.DIM, dtype=np.float32))

    def test_there_is_no_per_track_normaliser_in_the_module(self):
        """Structural, not stylistic: if a helper that normalises a lone vector
        ever appears, the rule above becomes advisory again."""
        for name in dir(descriptors):
            if any(word in name.lower() for word in ('normalise', 'normalize', 'zscore')):
                self.assertIn(name, ('load_normalised',),
                              f'{name} looks like a per-track normaliser')

    def test_fit_then_apply_is_a_z_score(self):
        matrix = self.corpus()
        z = descriptors.CorpusStats.fit(matrix).apply(matrix)
        np.testing.assert_allclose(z.mean(axis=0), 0.0, atol=1e-4)
        np.testing.assert_allclose(z.std(axis=0), 1.0, atol=1e-4)

    def test_a_single_track_normalises_against_the_stored_corpus(self):
        """The requirement that put the stats in the index: a track added months
        later must land in the same space as the ones fitted today."""
        matrix = self.corpus()
        stats = descriptors.CorpusStats.fit(matrix)
        np.testing.assert_allclose(stats.apply(matrix[3]), stats.apply(matrix)[3], rtol=1e-5)

    def test_constant_dimension_does_not_poison_the_matrix(self):
        """⚠️ std 0 → inf/NaN → every similarity at §8.7 is NaN, not just that
        dimension's contribution. Substituting 1 leaves the dimension at zero."""
        matrix = self.corpus()
        matrix[:, 7] = 2.5
        stats = descriptors.CorpusStats.fit(matrix)
        z = stats.apply(matrix)
        self.assertTrue(np.all(np.isfinite(z)))
        np.testing.assert_allclose(z[:, 7], 0.0, atol=1e-6)
        self.assertIn(7, stats.degenerate)
        self.assertIn('mfcc_mean[7]', stats.degenerate_names())

    def test_dimension_mismatch_is_refused(self):
        stats = descriptors.CorpusStats.fit(self.corpus())
        with self.assertRaises(ValueError):
            stats.apply(np.zeros((4, descriptors.DIM + 1), dtype=np.float32))


class IndexRoundTripTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='music-desc-')
        self.conn = index.connect(os.path.join(self.dir, 'index.db'))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def seed(self, n=16):
        rng = np.random.RandomState(1)
        ids = []
        for i in range(n):
            album = f'/library/artist{i // 4}/album{i // 4}'
            track_id = index.upsert_track(self.conn, f'{album}/{i:02d}.flac', 1.0, 100)
            index.put_descriptor(self.conn, track_id,
                                 (rng.randn(descriptors.DIM) * 5).astype(np.float32))
            ids.append(track_id)
        self.conn.commit()
        return ids

    def test_stats_survive_a_round_trip_through_meta_bitwise(self):
        """base64 of the float32 bytes, not decimal text: a mean round-tripped
        through `repr` is nearly the mean that was fitted, and 'nearly' means the
        track added next year lands in a slightly different space."""
        self.seed()
        fitted = descriptors.fit_corpus(self.conn)
        loaded = descriptors.CorpusStats.load(self.conn)
        self.assertEqual(fitted.mean.tobytes(), loaded.mean.tobytes())
        self.assertEqual(fitted.std.tobytes(), loaded.std.tobytes())
        self.assertEqual(fitted.n_fit, loaded.n_fit)

    def test_degenerate_dimensions_survive_the_round_trip(self):
        rng = np.random.RandomState(2)
        for i in range(16):
            vector = (rng.randn(descriptors.DIM) * 5).astype(np.float32)
            vector[11] = 1.0
            index.put_descriptor(self.conn, index.upsert_track(self.conn, f'/a/b/{i}.flac', 1.0, 1), vector)
        self.conn.commit()
        fitted = descriptors.fit_corpus(self.conn)
        self.assertEqual(fitted.degenerate, descriptors.CorpusStats.load(self.conn).degenerate)

    def test_no_stats_stored_reads_as_none(self):
        self.assertIsNone(descriptors.CorpusStats.load(self.conn))

    def test_stored_vectors_are_raw_not_normalised(self):
        """⚠️ Storing normalised vectors would freeze one corpus's statistics into
        every row, so re-fitting after the library grows would compare new rows
        against new stats and old rows against old ones."""
        self.seed()
        raw, _paths, _ids = index.load_matrix(self.conn, 'descriptors')
        self.assertGreater(float(np.abs(raw.mean(axis=0)).max()), 0.1)
        self.assertGreater(float(raw.std()), 2.0)

    def test_load_normalised_returns_unit_rows(self):
        """L2 on top of the z-score, so §8.7's `M @ q` IS the cosine similarity."""
        self.seed()
        matrix, _paths, _ids, _stats = descriptors.load_normalised(self.conn)
        np.testing.assert_allclose(np.linalg.norm(matrix, axis=1), 1.0, rtol=1e-5)

    def test_load_normalised_fits_on_first_use(self):
        self.seed()
        self.assertIsNone(descriptors.CorpusStats.load(self.conn))
        _m, _p, _i, stats = descriptors.load_normalised(self.conn)
        self.assertIsNotNone(descriptors.CorpusStats.load(self.conn))
        self.assertEqual(stats.dim, descriptors.DIM)

    def test_empty_index_returns_empty(self):
        matrix, paths, ids, stats = descriptors.load_normalised(self.conn)
        self.assertEqual(len(paths), 0)
        self.assertIsNone(stats)

    def test_descriptors_go_through_the_config_drift_alarm(self):
        """Trap 16 covers this arm too: descriptors computed under two different
        analysis configurations are no more comparable than embeddings are."""
        self.seed(16)
        original = config.N_MELS
        try:
            config.N_MELS = original + 1
            with self.assertRaises(index.ConfigDriftError):
                index.put_descriptor(self.conn, 1, np.ones(descriptors.DIM, dtype=np.float32))
        finally:
            config.N_MELS = original
            mel._CACHE.clear()

    def test_pending_is_the_resume_ledger(self):
        """§8.6's Trap 17, exercised on this arm first: progress is the absence
        of a join partner, so a killed run resumes where it stopped."""
        ids = self.seed(16)
        for extra in range(3):
            index.upsert_track(self.conn, f'/library/new/album/{extra}.flac', 1.0, 1)
        self.conn.commit()
        remaining = index.pending(self.conn, 'descriptors')
        self.assertEqual(len(remaining), 3)
        self.assertFalse({row['id'] for row in remaining} & set(ids))

    def test_album_and_artist_come_from_the_path(self):
        self.assertEqual(descriptors.album_of('/m/Artist/Album (2019)/01. A.flac'),
                         '/m/Artist/Album (2019)')
        self.assertEqual(descriptors.artist_of('/m/Artist/Album (2019)/01. A.flac',
                                               root_name='m'), 'Artist')

    def test_artist_of_reads_a_flat_album_folder(self):
        """⚠️ The regression that made this a named test: for a FLAT album the
        parent of the album folder IS the library root, and the old reader
        (`dirname(album_of(path))`) answered the root itself — 10,771 tracks,
        22.7% of the real shelf, in one fake artist bucket. No error, and a
        same-artist rate plus a stranger spread computed over nonsense."""
        flat = '/m/Bowling For Soup - Drunk Enough To Dance (2002) [FLAC]/03. Bowling For Soup - Girl All The Bad Guys Want.flac'
        self.assertEqual(descriptors.artist_of(flat, root_name='m'), 'Bowling For Soup')
        self.assertNotEqual(descriptors.artist_of(flat, root_name='m'), '/m')

    def test_artist_of_prefers_the_directory_over_a_hyphenated_album_title(self):
        """⚠️ Directory-first, not prefix-first. 494 tracks on the real shelf sit
        in NESTED album folders whose TITLE carries a hyphen; reading the
        `<Artist> - ` prefix first credits them to half an album title."""
        nested = ('/m/Taking Back Sunday/Live From Orensanz (Live From Orensanz, '
                  'New York, NY - 2009)/02. Cute Without The E.flac')
        self.assertEqual(descriptors.artist_of(nested, root_name='m'), 'Taking Back Sunday')

    def test_artist_of_unifies_the_two_spellings_of_one_artist(self):
        """A name, not a path — 125 artists on the shelf have some albums filed
        flat and some nested, and as paths those are two different artists."""
        flat = '/m/Max Richter - Sleep (2015) [FLAC]/01. Max Richter - Dream 1.flac'
        nested = '/m/Max Richter/The Blue Notebooks (2004)/01. On The Nature Of Daylight.flac'
        self.assertEqual(descriptors.artist_of(flat, root_name='m'),
                         descriptors.artist_of(nested, root_name='m'))

    def test_artist_of_folds_a_disc_folder_before_reading_the_artist(self):
        deep = '/m/Artist/Album (2019)/Disc 2/04. B.flac'
        self.assertEqual(descriptors.artist_of(deep, root_name='m'), 'Artist')
        flat_disc = '/m/Artist - Album (2019) [FLAC]/CD1/04. B.flac'
        self.assertEqual(descriptors.artist_of(flat_disc, root_name='m'), 'Artist')

    def test_select_albums_spreads_across_the_shelf(self):
        """Not the first N: the tracks table is ordered by path, so the first N
        albums are the first two or three artists in the alphabet, and a gate run
        on three artists measures far less than one run on twenty."""
        for artist in range(10):
            for track in range(descriptors.MIN_ALBUM_TRACKS):
                index.upsert_track(self.conn, f'/m/artist{artist:02d}/album/{track}.flac', 1.0, 1)
        self.conn.commit()
        rows = descriptors.select_albums(self.conn, 3)
        artists = {descriptors.artist_of(r['path']) for r in rows}
        self.assertEqual(len(artists), 3)
        self.assertGreater(len(artists & {'artist00', 'artist09'}), 0)

    def test_select_albums_skips_albums_below_the_floor(self):
        index.upsert_track(self.conn, '/m/a/single/01.flac', 1.0, 1)
        for track in range(descriptors.MIN_ALBUM_TRACKS):
            index.upsert_track(self.conn, f'/m/b/full/{track}.flac', 1.0, 1)
        self.conn.commit()
        rows = descriptors.select_albums(self.conn, 5)
        self.assertTrue(all('/m/b/full' in r['path'] for r in rows))


class BuildTest(unittest.TestCase):
    """The runner, including the property that matters most about it."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='music-build-')
        self.conn = index.connect(os.path.join(self.dir, 'index.db'))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    @unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg not on PATH')
    def test_describes_a_real_file_with_a_hostile_name(self):
        """Trap 20 again, one stage further along: `again&again` and
        `Today's Lesson.flac` are real names in the real library."""
        path = helpers.make_sine_flac(self.dir, seconds=4.0)
        self.assertIn('&', path)
        vector, duration = descriptors.describe_file(path)
        self.assertEqual(vector.shape, (descriptors.DIM,))
        self.assertAlmostEqual(duration, 4.0, delta=0.1)

    @unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg not on PATH')
    def test_a_bad_file_marks_its_row_and_the_batch_continues(self):
        """⚠️ FAILURES ARE DATA. One corrupt file out of 15,326 must not kill a
        multi-hour run, and the error has to survive in the index — triage after
        a run that ended at 3 a.m. reads rows, not scrollback."""
        good = helpers.make_sine_flac(self.dir, seconds=3.0, name='good')
        bad = os.path.join(self.dir, 'broken.flac')
        with open(bad, 'wb') as handle:
            handle.write(b'not a flac at all')
        rows = [self.conn.execute('SELECT * FROM tracks WHERE id=?', (i,)).fetchone()
                for i in (index.upsert_track(self.conn, good, 1.0, 1),
                          index.upsert_track(self.conn, bad, 1.0, 1))]
        self.conn.commit()

        done, failed = descriptors.build(self.conn, rows, workers=2)
        self.assertEqual((done, failed), (1, 1))
        broken = index.track_by_path(self.conn, bad)
        self.assertEqual(broken['status'], index.FAILED)
        self.assertTrue(broken['error'])
        self.assertIsNotNone(index.get_vector(self.conn, index.track_by_path(self.conn, good)['id'],
                                              'descriptors'))

    @unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg not on PATH')
    def test_a_second_run_has_nothing_left_to_do(self):
        path = helpers.make_sine_flac(self.dir, seconds=3.0, name='once')
        index.upsert_track(self.conn, path, 1.0, 1)
        self.conn.commit()
        descriptors.build(self.conn, index.pending(self.conn, 'descriptors'))
        self.assertEqual(len(index.pending(self.conn, 'descriptors')), 0)


class SanityGateTest(unittest.TestCase):
    """§8.4's gate, on synthesised audio so it runs with no library mount.

    Three 'albums' whose tracks share a character, with per-track variation. The
    claim is deliberately weak as a statement about music and strong as a
    statement about plumbing: if the descriptors cannot separate a bass-heavy
    slow record from a bright noisy one, they are not measuring the audio at all.
    """

    ALBUMS = 3
    PER_ALBUM = 5

    def album_track(self, album, k):
        sr, seconds = config.SR, 6.0
        t = np.arange(int(seconds * sr), dtype=np.float64) / sr
        rng = np.random.RandomState(album * 100 + k)
        jitter = 1.0 + 0.05 * rng.randn()
        if album == 0:                       # low, tonal, slow pulse
            x = 0.6 * np.sin(2 * np.pi * 110 * jitter * t) * (1 + 0.5 * np.sin(2 * np.pi * 1.5 * t))
        elif album == 1:                     # bright, noisy, dense
            x = 0.3 * rng.randn(t.size) * (1 + 0.3 * np.sin(2 * np.pi * 6 * t))
            x += 0.2 * np.sin(2 * np.pi * 5000 * jitter * t)
        else:                                # midrange, harmonic, fast
            x = sum(0.3 / h * np.sin(2 * np.pi * 440 * h * jitter * t) for h in (1, 2, 3))
            x *= (1 + 0.6 * np.sin(2 * np.pi * 4 * t))
        return (x + 0.005 * rng.randn(t.size)).astype(np.float32)

    def test_album_mates_sit_closer_than_strangers(self):
        vectors, paths = [], []
        for album in range(self.ALBUMS):
            for k in range(self.PER_ALBUM):
                vectors.append(descriptors.describe(self.album_track(album, k)))
                paths.append(f'/library/artist{album}/album{album}/{k:02d}.flac')

        matrix = np.stack(vectors)
        stats = descriptors.CorpusStats.fit(matrix)
        z = stats.apply(matrix)
        z /= np.linalg.norm(z, axis=1, keepdims=True)

        report = descriptors.similarity_report(z, paths, pairs=20000, seed=0)
        same = report['same_album'][0]
        other = report['different'][0]
        self.assertGreater(same, other,
                           f'album mates {same:+.3f} vs strangers {other:+.3f} — the '
                           f'descriptors are not seeing the audio')
        self.assertGreater(report['nn_same_album'], 0.9)

    def test_the_report_counts_what_it_says_it_counts(self):
        paths = [f'/m/artist{i // 4}/album{i // 2}/{i}.flac' for i in range(8)]
        matrix = np.eye(8, dtype=np.float32)
        report = descriptors.similarity_report(matrix, paths, pairs=5000, seed=1)
        self.assertEqual(report['n_tracks'], 8)
        self.assertEqual(report['n_albums'], 4)
        self.assertEqual(report['n_artists'], 2)

    def test_chance_rate_is_weighted_by_group_size(self):
        """The baseline has to describe the same population the measurement does:
        a track on a 20-track album has more album-mates to find than one on an EP."""
        labels = np.array(['a'] * 4 + ['b'] * 2)
        self.assertAlmostEqual(descriptors.chance_rate(labels),
                               ((4 * 3) + (2 * 1)) / 6.0 / 5.0, places=6)

    def test_an_unmeasured_category_does_not_fail_the_gate(self):
        """⚠️ REGRESSION. `select_albums` takes one album per artist by default,
        so "same artist, other album" can have ZERO pairs — and its mean is then
        NaN, and `nan > x` is False. The gate first reported FAILED on a real set
        whose descriptors were separating album-mates from strangers by +0.47.
        An unmeasured category is not a failed one.
        """
        import io
        directory = tempfile.mkdtemp(prefix='music-gate-')
        try:
            conn = index.connect(os.path.join(directory, 'index.db'))
            rng = np.random.RandomState(3)
            # One album per artist, so the middle category is empty by construction.
            for album in range(4):
                centre = rng.randn(descriptors.DIM)
                for track in range(4):
                    vector = (centre * 6 + rng.randn(descriptors.DIM) * 0.2).astype(np.float32)
                    index.put_descriptor(
                        conn,
                        index.upsert_track(conn, f'/m/artist{album}/album{album}/{track}.flac', 1.0, 1),
                        vector)
            conn.commit()
            out = io.StringIO()
            passed = descriptors.gate(conn, stream=out)
            conn.close()
        finally:
            shutil.rmtree(directory, ignore_errors=True)
        self.assertIn('not measured', out.getvalue())
        self.assertTrue(passed, out.getvalue())

    def test_per_artist_buys_the_same_artist_row(self):
        """The middle row is the one that separates a good space from a lucky
        one: album-mates share a mastering, so clustering them is nearly free."""
        directory = tempfile.mkdtemp(prefix='music-sel-')
        try:
            conn = index.connect(os.path.join(directory, 'index.db'))
            for artist in range(6):
                for album in range(3):
                    for track in range(descriptors.MIN_ALBUM_TRACKS):
                        index.upsert_track(
                            conn, f'/m/artist{artist}/album{album}/{track}.flac', 1.0, 1)
            conn.commit()
            spread = descriptors.select_albums(conn, 6, per_artist=1)
            grouped = descriptors.select_albums(conn, 6, per_artist=3)
            conn.close()
        finally:
            shutil.rmtree(directory, ignore_errors=True)

        self.assertEqual(len({descriptors.artist_of(r['path']) for r in spread}), 6)
        self.assertEqual(len({descriptors.album_of(r['path']) for r in spread}), 6)
        self.assertEqual(len({descriptors.artist_of(r['path']) for r in grouped}), 2)
        self.assertEqual(len({descriptors.album_of(r['path']) for r in grouped}), 6)

    def test_refuses_a_corpus_too_small_to_compare(self):
        with self.assertRaises(descriptors.DescriptorError):
            descriptors.similarity_report(np.eye(3, dtype=np.float32),
                                          ['/a/b/1.flac', '/a/b/2.flac', '/a/c/3.flac'])


class TooSmallACorpusTest(unittest.TestCase):
    """⚠️ Fewer than `MIN_FIT_ROWS` rows is the NORMAL state five minutes into a
    first `--build`, and it used to greet that person with a raw `ValueError`
    from three frames inside `CorpusStats.fit`.

    The refusal itself is right and stays — a z-score over four tracks is a
    per-track normalisation in a corpus costume, which is the one thing this
    module exists to prevent. What changes is the door it arrives through:
    `fit`'s ValueError is still what an API misuse gets, and a person running the
    CLI gets a sentence telling them to describe more.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-small-')
        self.conn = index.connect(os.path.join(self.tmp, 'index.db'))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fill(self, n):
        rng = np.random.RandomState(0)
        for i in range(n):
            tid = index.upsert_track(self.conn, f'/lib/A/Al/{i:02d}. t{i}.flac', 1.0, 1)
            index.put_descriptor(self.conn, tid,
                                 rng.randn(descriptors.DIM).astype(np.float32))
        self.conn.commit()

    def test_load_normalised_explains_itself(self):
        self.fill(descriptors.MIN_FIT_ROWS - 1)
        with self.assertRaises(descriptors.DescriptorError) as caught:
            descriptors.load_normalised(self.conn)
        self.assertIn(str(descriptors.MIN_FIT_ROWS), str(caught.exception))
        self.assertIn('--build', str(caught.exception))

    def test_the_gate_reports_it_as_unrun_not_as_failed(self):
        self.fill(descriptors.MIN_FIT_ROWS - 1)
        out = io.StringIO()
        self.assertFalse(descriptors.gate(self.conn, stream=out))
        self.assertNotIn('GATE FAILED', out.getvalue())
        self.assertNotIn('not seeing the audio', out.getvalue())

    def test_fit_itself_still_raises_ValueError_for_an_api_misuse(self):
        with self.assertRaises(ValueError):
            descriptors.CorpusStats.fit(np.zeros((2, descriptors.DIM), dtype=np.float32))

    def test_enough_rows_still_fit(self):
        self.fill(descriptors.MIN_FIT_ROWS)
        matrix, _paths, _ids, stats = descriptors.load_normalised(self.conn)
        self.assertEqual(matrix.shape, (descriptors.MIN_FIT_ROWS, descriptors.DIM))
        self.assertEqual(stats.n_fit, descriptors.MIN_FIT_ROWS)


class DescriptorCircuitBreakerTest(unittest.TestCase):
    """The same guard the neural run carries, over the same shelf and the same
    shared `tracks.status` — so a dropped mount here poisons BOTH arms' queues.
    See `backfill.ABORT_AFTER` for the reasoning."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-dcb-')
        self.conn = index.connect(os.path.join(self.tmp, 'index.db'))
        self.saved_root = config.LIBRARY_ROOT

    def tearDown(self):
        config.LIBRARY_ROOT = self.saved_root
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def queue(self, n):
        for i in range(n):
            index.upsert_track(self.conn, os.path.join(self.tmp, f'absent-{i:03d}.flac'),
                               1.0, 1)
        self.conn.commit()
        return index.pending(self.conn, 'descriptors')

    def failed_rows(self):
        return self.conn.execute('SELECT COUNT(*) AS n FROM tracks WHERE status=?',
                                 (index.FAILED,)).fetchone()['n']

    def test_an_unreachable_root_stops_without_marking_anything(self):
        rows = self.queue(40)
        config.LIBRARY_ROOT = os.path.join(self.tmp, 'not-mounted')
        with self.assertRaises(descriptors.DescriptorError) as caught:
            descriptors.build(self.conn, rows, workers=2)
        self.assertIn('not reachable', str(caught.exception))
        self.assertEqual(self.failed_rows(), 0)

    def test_a_run_of_failures_stops_after_the_threshold(self):
        rows = self.queue(descriptors.ABORT_AFTER * 3)
        config.LIBRARY_ROOT = self.tmp                   # the shelf IS there
        with self.assertRaises(descriptors.DescriptorError) as caught:
            descriptors.build(self.conn, rows, workers=2)
        self.assertIn('in a row', str(caught.exception))
        self.assertLessEqual(self.failed_rows(), descriptors.ABORT_AFTER)


if __name__ == '__main__':
    unittest.main()
