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


class ProfileTest(unittest.TestCase):
    """§8.5 gave config.py a second answer — the encoder's — and these are the
    guards that keep two answers from becoming two sources of truth."""

    def test_profiles_are_complete(self):
        """⚠️ A profile must declare EVERY significant parameter. A partial one
        would inherit whatever the baseline says, so adding a parameter to
        config.py later would silently change what the encoder is fed — a Trap 16
        corruption introduced by an edit that looks purely additive.
        """
        for profile in (config.baseline(), config.ENCODER):
            self.assertEqual(set(profile.values), set(config._SIGNIFICANT), profile.name)

    def test_a_partial_profile_is_refused(self):
        with self.assertRaises(ValueError):
            config.Profile('half', SR=48000)

    def test_an_unknown_parameter_is_refused(self):
        values = dict(config.ENCODER.values, NOT_A_PARAMETER=1)
        with self.assertRaises(ValueError):
            config.Profile('extra', **values)

    def test_profiles_have_distinct_signatures(self):
        self.assertNotEqual(config.baseline().signature(), config.ENCODER.signature())

    def test_using_swaps_the_values_and_restores_them(self):
        before = {k: getattr(config, k) for k in config._SIGNIFICANT}
        with config.using(config.ENCODER):
            self.assertEqual(config.SR, 48000)
            self.assertEqual(config.N_MELS, 64)
            self.assertEqual(config.signature(), config.ENCODER.signature())
        self.assertEqual({k: getattr(config, k) for k in config._SIGNIFICANT}, before)

    def test_the_module_signature_follows_the_active_profile(self):
        with config.using(config.ENCODER):
            self.assertEqual(config.signature(), config.active().signature())
        self.assertEqual(config.active().signature(), config.baseline().signature())

    def test_baseline_is_frozen_at_import_not_read_live(self):
        """⚠️ REGRESSION, and the subtle one. `baseline()` used to derive from the
        live globals — so INSIDE `using(ENCODER)` it returned a profile named
        'baseline' carrying the ENCODER's values, with the encoder's signature.
        The nesting guard then compared two identical signatures and waved the
        switch through as harmless re-entry, defeating the only thing standing
        between §8.6's worker threads and a silently mixed vector space.
        """
        outside = config.baseline().signature()
        with config.using(config.ENCODER):
            self.assertEqual(config.baseline().signature(), outside)
            self.assertNotEqual(config.baseline().signature(), config.signature())

    def test_switching_to_a_different_profile_while_one_is_active_raises(self):
        """⚠️ Module globals are process-wide, not thread-local. Two profiles in
        force at once would let one thread compute under A and another store the
        result under B — Trap 16 with no symptom at all."""
        with config.using(config.ENCODER):
            with self.assertRaises(RuntimeError):
                with config.using(config.baseline()):
                    pass

    def test_re_entering_the_same_profile_is_a_no_op(self):
        """§8.6 wraps a whole run once and calls per-track helpers inside it; the
        helpers enter the same profile again, and that has to be free."""
        with config.using(config.ENCODER):
            with config.using(config.ENCODER):
                self.assertEqual(config.SR, 48000)
            self.assertEqual(config.SR, 48000)
        self.assertEqual(config.SR, config._BASELINE_VALUES['SR'])

    def test_the_profile_is_restored_even_when_the_block_raises(self):
        before = config.SR
        with self.assertRaises(ZeroDivisionError):
            with config.using(config.ENCODER):
                raise ZeroDivisionError
        self.assertEqual(config.SR, before)


if __name__ == '__main__':
    unittest.main()

