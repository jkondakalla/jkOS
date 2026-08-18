"""M1's tests. The transform is hand-rolled, so these check the MATH, not plumbing.

Four properties carry the whole thing, and each has a failure mode that produces
a perfectly plausible matrix:

  * the filterbank is a real triangular bank with 50% overlap — get the edges
    wrong and every band still contains numbers, just the wrong frequencies;
  * a known tone lands in the band that contains it — the single check that the
    frequency axis means what it claims;
  * silence maps to the log floor, not to -inf, which would poison every
    downstream mean and norm;
  * the whole thing is bitwise deterministic, because a backfill that drifts
    between runs cannot be resumed.
"""
import unittest

import numpy as np

import config
import mel


def sine(freq, seconds=1.0, sr=None):
    sr = sr or config.SR
    t = np.arange(int(seconds * sr), dtype=np.float64) / sr
    return np.sin(2.0 * np.pi * freq * t).astype(np.float32)


class MelScaleTest(unittest.TestCase):
    def test_round_trips(self):
        hz = np.array([0.0, 100.0, 440.0, 1000.0, 4000.0, 11025.0])
        np.testing.assert_allclose(mel.mel_to_hz(mel.hz_to_mel(hz)), hz, rtol=1e-6, atol=1e-6)

    def test_monotonic(self):
        hz = np.linspace(0, config.SR / 2, 500)
        self.assertTrue(np.all(np.diff(mel.hz_to_mel(hz)) > 0))

    def test_compresses_high_frequencies(self):
        """The whole reason for the mel scale: a fixed HERTZ interval buys more
        mel-space down low than up high, so the filterbank spends its 128 bands
        where pitch discrimination actually is."""
        low = mel.hz_to_mel(540.0) - mel.hz_to_mel(440.0)      # 100 Hz at 440
        high = mel.hz_to_mel(8100.0) - mel.hz_to_mel(8000.0)   # 100 Hz at 8k
        self.assertGreater(float(low), float(high) * 3.0)

    def test_is_not_constant_q(self):
        """Documenting what mel is NOT, because it is easy to assume otherwise.

        Mel is roughly LINEAR below ~1 kHz and logarithmic above, so it is not a
        log-frequency (constant-Q) axis: an octave high up spans MORE mel than an
        octave down low. If someone later wants equal treatment per octave, that
        is a different transform (CQT), not a tweak to these constants.
        """
        low_octave = mel.hz_to_mel(440.0) - mel.hz_to_mel(220.0)
        high_octave = mel.hz_to_mel(8800.0) - mel.hz_to_mel(4400.0)
        self.assertGreater(float(high_octave), float(low_octave))

    def test_both_conventions_round_trip(self):
        original = config.MEL_SCALE
        try:
            for scale in ('htk', 'slaney'):
                config.MEL_SCALE = scale
                hz = np.array([50.0, 440.0, 999.0, 1000.0, 1001.0, 8000.0])
                np.testing.assert_allclose(
                    mel.mel_to_hz(mel.hz_to_mel(hz)), hz, rtol=1e-6, atol=1e-6,
                    err_msg=f'{scale} is not self-inverse')
        finally:
            config.MEL_SCALE = original

    def test_conventions_actually_differ(self):
        """If these ever agreed, MEL_SCALE would be a no-op knob and Trap 16 would
        have one fewer tooth. They must not."""
        original = config.MEL_SCALE
        try:
            config.MEL_SCALE = 'htk'
            htk = mel.hz_to_mel(440.0)
            config.MEL_SCALE = 'slaney'
            slaney = mel.hz_to_mel(440.0)
        finally:
            config.MEL_SCALE = original
        self.assertNotAlmostEqual(float(htk), float(slaney), places=3)


class FilterbankTest(unittest.TestCase):
    def setUp(self):
        self.fb = mel.mel_filterbank()
        self.edges = mel.mel_edges()
        self.freqs = mel.fft_frequencies()

    def test_shape_and_dtype(self):
        self.assertEqual(self.fb.shape, (config.N_MELS, config.N_FFT // 2 + 1))
        self.assertEqual(self.fb.dtype, np.dtype('float32'))

    def test_non_negative(self):
        self.assertTrue(np.all(self.fb >= 0.0))

    def test_no_empty_filters(self):
        """A band too narrow to contain an FFT bin is all zeros — it contributes
        nothing and quietly costs a dimension. Real hazard: it depends on N_MELS,
        SR and N_FFT together, so any of the three moving can cause it."""
        empty = np.where(self.fb.sum(axis=1) == 0)[0]
        self.assertEqual(len(empty), 0, f'bands {empty.tolist()} are empty')

    def test_each_row_is_a_single_triangle(self):
        """Rises monotonically to one peak, then falls monotonically. Catches an
        edge-ordering bug, which otherwise yields plausible non-negative rows."""
        for m in range(config.N_MELS):
            row = self.fb[m]
            support = np.where(row > 0)[0]
            peak = int(row.argmax())
            rising, falling = row[support[0]:peak + 1], row[peak:support[-1] + 1]
            self.assertTrue(np.all(np.diff(rising) >= -1e-7), f'band {m} not rising to peak')
            self.assertTrue(np.all(np.diff(falling) <= 1e-7), f'band {m} not falling from peak')

    def test_peak_sits_at_the_middle_edge(self):
        for m in range(0, config.N_MELS, 7):
            peak_hz = self.freqs[int(self.fb[m].argmax())]
            # within one FFT bin of edges[m+1]
            self.assertLess(abs(peak_hz - self.edges[m + 1]), self.freqs[1] - self.freqs[0] + 1e-6)

    def test_fifty_percent_overlap(self):
        """Adjacent bands share exactly one half-support; non-adjacent share none.

        This is the structural definition of the bank, and it is what makes the
        128 outputs a smooth re-basis of the spectrum rather than 128 disjoint
        buckets that alias against the FFT grid.
        """
        support = [set(np.where(self.fb[m] > 0)[0].tolist()) for m in range(config.N_MELS)]
        for m in range(config.N_MELS - 1):
            self.assertTrue(support[m] & support[m + 1], f'bands {m},{m+1} do not overlap')
        for m in range(config.N_MELS - 2):
            self.assertFalse(support[m] & support[m + 2],
                             f'bands {m},{m+2} overlap but should not')

    def test_adjacent_ramps_sum_to_one(self):
        """Between two peaks, band m's falling ramp and band m+1's rising ramp sum
        to exactly 1 — a partition of unity. Energy is redistributed across bands,
        never created or destroyed. Only holds unnormalised."""
        if config.MEL_NORM is not None:
            self.skipTest('area normalisation deliberately breaks unit partition')
        for m in range(config.N_MELS - 1):
            lo = int(self.fb[m].argmax())
            hi = int(self.fb[m + 1].argmax())
            if hi - lo < 2:
                continue                     # too few FFT bins between peaks to test
            between = slice(lo + 1, hi)
            total = self.fb[m][between] + self.fb[m + 1][between]
            np.testing.assert_allclose(total, 1.0, atol=1e-6,
                                       err_msg=f'bands {m},{m+1} do not partition unity')

    def test_rebuilds_when_config_changes(self):
        """The bank is cached; the cache must be keyed on the config, or a §8.5
        edit serves a filterbank built for the old parameters."""
        before = mel.mel_filterbank().shape
        original = config.N_MELS
        try:
            config.N_MELS = 64
            self.assertEqual(mel.mel_filterbank().shape[0], 64)
        finally:
            config.N_MELS = original
        self.assertEqual(mel.mel_filterbank().shape, before)


class WindowTest(unittest.TestCase):
    def test_periodic_hann(self):
        w = mel.hann_window()
        self.assertEqual(w.shape, (config.N_FFT,))
        self.assertAlmostEqual(float(w[0]), 0.0, places=6)
        # Periodic, not symmetric: the last sample is NOT zero (np.hanning's is).
        self.assertGreater(float(w[-1]), 0.0)
        self.assertAlmostEqual(float(w.max()), 1.0, places=6)
        # symmetric about the centre
        np.testing.assert_allclose(w[1:], w[1:][::-1], atol=1e-6)


class FramingTest(unittest.TestCase):
    def test_frame_count_matches_config(self):
        for n in (0, 1, 511, 512, 513, 2048, 22050, 100000):
            self.assertEqual(mel.frame(np.zeros(n, dtype=np.float32)).shape[0],
                             config.n_frames(n), f'n={n}')

    def test_frame_width(self):
        self.assertEqual(mel.frame(np.zeros(22050, dtype=np.float32)).shape[1], config.N_FFT)

    def test_short_signal_does_not_raise(self):
        # Shorter than the half-window: reflect padding is impossible, so it
        # falls back to zeros rather than raising. A short file is data.
        self.assertGreater(mel.frame(np.zeros(10, dtype=np.float32)).shape[0], 0)

    def test_rejects_2d(self):
        with self.assertRaises(ValueError):
            mel.frame(np.zeros((2, 100), dtype=np.float32))


class SpectrogramTest(unittest.TestCase):
    def test_shape_and_dtype(self):
        x = sine(440.0, 1.0)
        M = mel.logmelspectrogram(x)
        self.assertEqual(M.shape, (config.N_MELS, config.n_frames(len(x))))
        self.assertEqual(M.dtype, np.dtype('float32'))

    def test_all_finite(self):
        self.assertTrue(np.all(np.isfinite(mel.logmelspectrogram(sine(440.0, 0.5)))))

    def test_silence_maps_to_the_log_floor(self):
        M = mel.logmelspectrogram(np.zeros(config.SR, dtype=np.float32))
        np.testing.assert_allclose(M, mel.log_floor_value(), rtol=1e-5)

    def test_a_tone_lands_in_the_band_that_contains_it(self):
        """THE test. A 440 Hz sine must peak in a band whose triangular support
        actually spans 440 Hz — if the mel axis is mislabelled anywhere, this is
        where it shows."""
        M = mel.melspectrogram(sine(440.0, 2.0))
        loudest = int(M.mean(axis=1).argmax())

        fb = mel.mel_filterbank()
        bin_440 = int(np.argmin(np.abs(mel.fft_frequencies() - 440.0)))
        containing = set(np.where(fb[:, bin_440] > 0)[0].tolist())

        self.assertIn(loudest, containing,
                      f'440 Hz peaked in band {loudest}, but only bands '
                      f'{sorted(containing)} contain 440 Hz')

    def test_a_tone_lands_nowhere_else(self):
        """...and the rest of the spectrum stays quiet. Bands more than two away
        from the tone must hold a negligible share of the energy — otherwise the
        'spectrogram' is smearing and carries no frequency information."""
        M = mel.melspectrogram(sine(440.0, 2.0))
        energy = M.mean(axis=1)
        peak = int(energy.argmax())
        near = slice(max(0, peak - 2), peak + 3)
        share = energy[near].sum() / energy.sum()
        self.assertGreater(share, 0.90,
                           f'only {share:.1%} of energy within +/-2 bands of the tone')

    def test_two_tones_land_in_two_places(self):
        low = int(mel.melspectrogram(sine(440.0, 1.0)).mean(axis=1).argmax())
        high = int(mel.melspectrogram(sine(3520.0, 1.0)).mean(axis=1).argmax())
        self.assertLess(low, high, 'a higher tone must occupy a higher band')

    def test_louder_is_louder(self):
        quiet = mel.melspectrogram(sine(440.0, 1.0) * np.float32(0.1))
        loud = mel.melspectrogram(sine(440.0, 1.0))
        self.assertGreater(float(loud.max()), float(quiet.max()))

    def test_time_axis_tracks_the_audio(self):
        """A tone in the second half must show up in the second half of the frames
        — i.e. the time axis is not reversed or offset."""
        n = config.SR
        x = np.concatenate([np.zeros(n, dtype=np.float32), sine(440.0, 1.0)])
        M = mel.melspectrogram(x)
        half = M.shape[1] // 2
        self.assertGreater(float(M[:, half:].sum()), 100.0 * float(M[:, :half].sum()))

    def test_blocking_does_not_change_the_result(self):
        """Peak memory is bounded by processing in blocks; that must be an
        implementation detail with no effect on the numbers."""
        x = sine(440.0, 3.0)
        full = mel.melspectrogram(x)
        original = mel.BLOCK_FRAMES
        try:
            mel.BLOCK_FRAMES = 7          # deliberately awkward, forces ragged blocks
            blocked = mel.melspectrogram(x)
        finally:
            mel.BLOCK_FRAMES = original
        np.testing.assert_array_equal(full, blocked)

    def test_bitwise_deterministic(self):
        """A backfill that drifts between runs cannot be resumed, and a vector
        space assembled from two runs would be subtly inconsistent."""
        x = sine(440.0, 1.0)
        self.assertEqual(mel.logmelspectrogram(x).tobytes(),
                         mel.logmelspectrogram(x).tobytes())


if __name__ == '__main__':
    unittest.main()
