"""config.py is Trap 16's home, so its tests are about the trap, not the values.

Asserting `SR == 22050` would only restate the file. What is worth asserting is
that the parameters are internally coherent, and that the signature actually
moves when a parameter moves — because the signature is the only mechanism
standing between a §8.5 config edit and a silently corrupted vector space.
"""
import unittest

import config


class CoherenceTest(unittest.TestCase):
    def test_fmax_does_not_exceed_nyquist(self):
        self.assertLessEqual(config.FMAX, config.SR / 2.0)

    def test_fmin_below_fmax(self):
        self.assertLess(config.FMIN, config.FMAX)

    def test_frames_overlap(self):
        # HOP < N_FFT is what makes consecutive frames overlap. Equal would be a
        # non-overlapping STFT; greater would silently discard audio between
        # frames, which no later stage could detect.
        self.assertLess(config.HOP, config.N_FFT)

    def test_dtype_is_float32(self):
        # index.to_blob enforces this; if the two ever disagree, every write fails
        # rather than storing a double-width vector.
        self.assertEqual(config.DTYPE, 'float32')


class FrameCountTest(unittest.TestCase):
    def test_matches_the_centred_formula(self):
        self.assertTrue(config.CENTER, 'formula below assumes centred framing')
        for n in (0, 1, 511, 512, 513, 22050, 44100):
            self.assertEqual(config.n_frames(n), 1 + n // config.HOP, f'n={n}')

    def test_monotonic(self):
        counts = [config.n_frames(n) for n in range(0, 20000, 137)]
        self.assertEqual(counts, sorted(counts))

    def test_rejects_negative(self):
        with self.assertRaises(ValueError):
            config.n_frames(-1)

    def test_frame_seconds(self):
        self.assertAlmostEqual(config.frame_seconds(), config.HOP / config.SR)


class SignatureTest(unittest.TestCase):
    def test_stable_across_calls(self):
        self.assertEqual(config.signature(), config.signature())

    def test_short_and_hexadecimal(self):
        sig = config.signature()
        self.assertEqual(len(sig), 12)
        int(sig, 16)  # raises if it is not hex

    def test_covers_every_significant_parameter(self):
        """Each parameter that changes the matrix must change the signature.

        This is the test that matters. A parameter added to config.py but left
        out of `_SIGNIFICANT` would be invisible to the drift check, which is
        precisely the silent corruption the mechanism exists to prevent — so
        every name in the tuple is mutated in turn and the signature must move.
        """
        base = config.signature()
        for name in config._SIGNIFICANT:
            original = getattr(config, name)
            mutated = (original + 1) if isinstance(original, (int, float)) \
                else (f'{original}-x' if isinstance(original, str) else 'sentinel')
            setattr(config, name, mutated)
            try:
                self.assertNotEqual(
                    config.signature(), base,
                    f'{name} changed but the signature did not — it is missing '
                    f'from _SIGNIFICANT, so a change to it would corrupt the '
                    f'vector space undetected',
                )
            finally:
                setattr(config, name, original)
        self.assertEqual(config.signature(), base, 'a mutation was not restored')

    def test_canonical_is_order_independent(self):
        # Sorted by name, so reordering the declarations in config.py must not
        # invalidate an existing backfill.
        parts = config.canonical().split(';')
        self.assertEqual(parts, sorted(parts))

    def test_library_root_is_not_significant(self):
        # Where the files live has no bearing on what the numbers mean. Moving
        # the mount must not invalidate 15,326 vectors.
        original = config.LIBRARY_ROOT
        base = config.signature()
        config.LIBRARY_ROOT = '/somewhere/else'
        try:
            self.assertEqual(config.signature(), base)
        finally:
            config.LIBRARY_ROOT = original


if __name__ == '__main__':
    unittest.main()
