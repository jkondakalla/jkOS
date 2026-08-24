"""M3a under test (ToDo §8.5).

Split in two on purpose. The checks that need no weights and no `onnxruntime`
run everywhere — and they are the ones that matter most, because they cover the
CONTRACT rather than the arithmetic:

  * **the ENCODER profile matches the checkpoint's own `preprocessor_config.json`,
    value by value, as literals.** This is Trap 16's only real defence at this
    stage. A model fed a mel built under different parameters returns a
    confident, finite, unit-norm vector that is simply wrong, and nothing
    downstream can tell. The literals below are a transcription of the file the
    checkpoint ships; if `config.ENCODER` drifts from them, this fails;
  * `embed_windows` refuses to run outside that profile at all;
  * the windowing covers the whole track, includes the tail, and repeat-pads
    rather than silence-pads;
  * pooling normalises per window BEFORE the mean, so one loud window cannot
    become the track.

The forward-pass checks skip cleanly when the weights or the runtime are absent,
the same way the library-backed checks skip without the mount. Run them with the
contained venv: `./.venv/bin/python -m unittest discover`.
"""
import io
import os
import shutil
import tempfile
import unittest
import unittest.mock

import numpy as np

import config
import encoder


# A transcription of `preprocessor_config.json` from
# Xenova/larger_clap_music_and_speech at the pinned revision. Deliberately
# LITERALS, not a re-read of config.py — a test that derives its expectation from
# the thing it is testing checks nothing.
CHECKPOINT_PREPROCESSOR = {
    'sampling_rate': 48000,
    'fft_window_size': 1024,
    'hop_length': 480,
    'feature_size': 64,
    'frequency_min': 50,
    'frequency_max': 14000,
    'chunk_length_s': 10,
    'nb_frequency_bins': 513,
    'nb_max_samples': 480000,
    'truncation': 'rand_trunc',
    'padding': 'repeatpad',
}


class ProfileContractTest(unittest.TestCase):
    """⚠️ TRAP 16'S DEFENCE. Every assertion here is a line of the checkpoint's
    own preprocessor configuration."""

    def test_matches_the_checkpoints_declared_parameters(self):
        values = config.ENCODER.values
        self.assertEqual(values['SR'], CHECKPOINT_PREPROCESSOR['sampling_rate'])
        self.assertEqual(values['N_FFT'], CHECKPOINT_PREPROCESSOR['fft_window_size'])
        self.assertEqual(values['HOP'], CHECKPOINT_PREPROCESSOR['hop_length'])
        self.assertEqual(values['N_MELS'], CHECKPOINT_PREPROCESSOR['feature_size'])
        self.assertEqual(values['FMIN'], CHECKPOINT_PREPROCESSOR['frequency_min'])
        self.assertEqual(values['FMAX'], CHECKPOINT_PREPROCESSOR['frequency_max'])

    def test_uses_the_slaney_pair_because_truncation_is_rand_trunc(self):
        """⚠️ THE EASY WAY TO GET THIS WRONG. CLAP builds TWO filterbanks and picks
        by truncation mode: htk/no-norm for "fusion", slaney/slaney for
        "rand_trunc". This checkpoint declares `rand_trunc`, so it is the slaney
        pair — which is NOT torchaudio's default and not what reaching for a
        library default would give. The two differ by a per-band constant and a
        different hz↔mel formula: invisible in a picture, fatal to a space.
        """
        self.assertEqual(CHECKPOINT_PREPROCESSOR['truncation'], 'rand_trunc')
        self.assertEqual(config.ENCODER.values['MEL_SCALE'], 'slaney')
        self.assertEqual(config.ENCODER.values['MEL_NORM'], 'slaney')

    def test_uses_decibel_compression(self):
        """`log_mel="dB"` in ClapFeatureExtractor → 10·log10(max(x, 1e-10))."""
        self.assertEqual(config.ENCODER.values['LOG_MODE'], 'db')
        self.assertEqual(config.ENCODER.values['LOG_FLOOR'], 1e-10)

    def test_differs_from_the_baseline(self):
        """If these ever agreed, the whole profile mechanism would be a no-op and
        the per-table drift alarm would be guarding nothing."""
        self.assertNotEqual(config.ENCODER.signature(), config.baseline().signature())

    def test_window_is_the_models_native_chunk(self):
        self.assertEqual(encoder.WINDOW_SECONDS, CHECKPOINT_PREPROCESSOR['chunk_length_s'])
        with config.using(config.ENCODER):
            self.assertEqual(encoder.window_samples(),
                             CHECKPOINT_PREPROCESSOR['nb_max_samples'])

    def test_frame_count_matches_the_graphs_height_axis(self):
        """1001, not the checkpoint's `nb_max_frames` of 1000: `center=True` pads
        by half a window, so 480000/480 + 1 frames come out. Pinned because a
        silently mis-sized tensor is the failure this whole module guards."""
        with config.using(config.ENCODER):
            self.assertEqual(encoder.expected_frames(), 1001)
            self.assertEqual(config.N_FFT // 2 + 1,
                             CHECKPOINT_PREPROCESSOR['nb_frequency_bins'])

    def test_provenance_records_what_made_the_vector(self):
        provenance = encoder.provenance()
        self.assertEqual(provenance['dim'], 512)
        self.assertEqual(provenance['model'], encoder.MODEL_ID)
        self.assertEqual(len(provenance['revision']), 40)     # a full commit sha
        self.assertEqual(provenance['config_sig'], config.ENCODER.signature())

    def test_revision_is_a_commit_not_a_branch(self):
        """A model repository is mutable. 'computed with whatever main was that
        week' is not a reproducible statement."""
        self.assertNotIn(encoder.REVISION, ('main', 'master', 'refs/heads/main'))
        int(encoder.REVISION, 16)


class ProfileGuardTest(unittest.TestCase):
    def test_embed_windows_refuses_outside_the_encoder_profile(self):
        """⚠️ The guard exists because 'remember to enter the context' is a hope,
        not a defence — and the failure it prevents has no symptom."""
        with self.assertRaises(encoder.EncoderError) as caught:
            encoder.embed_windows(np.zeros(48000, dtype=np.float32))
        self.assertIn('profile', str(caught.exception))

    def test_both_halves_of_the_split_pipeline_refuse_it(self):
        """§8.6 hands the mel to reader threads and the forward pass to the main
        thread. One guard on the composed function would leave the half that
        actually builds the mel unguarded."""
        for call in (lambda: encoder.window_features(np.zeros(48000, dtype=np.float32)),
                     lambda: encoder.embed_features(np.zeros((1, 1, 4, 4), np.float32))):
            with self.assertRaises(encoder.EncoderError) as caught:
                call()
            self.assertIn('profile', str(caught.exception))

    def test_the_wrong_mel_profile_is_a_real_alternative(self):
        """`verify()` compares against it, so it has to actually differ."""
        self.assertNotEqual(encoder.WRONG_MEL.signature(), config.ENCODER.signature())
        self.assertEqual(encoder.WRONG_MEL.values['SR'], config.ENCODER.values['SR'])


class WindowingTest(unittest.TestCase):
    def setUp(self):
        self.context = config.using(config.ENCODER)
        self.context.__enter__()
        self.size = encoder.window_samples()

    def tearDown(self):
        self.context.__exit__(None, None, None)

    def test_every_window_is_exactly_one_chunk(self):
        signal = np.zeros(self.size * 4 + 12345, dtype=np.float32)
        for window in encoder.windows(signal):
            self.assertEqual(window.size, self.size)

    def test_fifty_percent_overlap(self):
        signal = np.arange(self.size * 3, dtype=np.float32)
        starts = [int(w[0]) for w in encoder.windows(signal)]
        self.assertEqual(starts[1] - starts[0], self.size // 2)

    def test_the_tail_is_never_dropped(self):
        """A track whose length is not a whole number of hops must not lose its
        last seconds — an index built from truncated tracks would silently ignore
        every outro."""
        signal = np.arange(self.size * 2 + 7, dtype=np.float32)
        last = list(encoder.windows(signal))[-1]
        self.assertEqual(float(last[-1]), float(signal[-1]))

    def test_short_input_is_repeat_padded_not_silence_padded(self):
        """The checkpoint's `"padding": "repeatpad"`. Silence-padding a 4-second
        interlude to 10 would tell the model that 60% of it is silence — a
        statement about the padding, not about the music."""
        signal = np.ones(self.size // 4, dtype=np.float32)
        produced = list(encoder.windows(signal))
        self.assertEqual(len(produced), 1)
        self.assertEqual(produced[0].size, self.size)
        self.assertEqual(float(produced[0].min()), 1.0)

    def test_empty_input_is_refused(self):
        with self.assertRaises(encoder.EncoderError):
            list(encoder.windows(np.zeros(0, dtype=np.float32)))

    def test_max_windows_spreads_across_the_track_and_keeps_the_ends(self):
        """⚠️ Evenly spaced, never the first N: the first N windows of a long
        track are its intro, and an index built from intros would rank tracks by
        how they open."""
        signal = np.arange(self.size * 20, dtype=np.float32)
        uncapped = [int(w[0]) for w in encoder.windows(signal, max_windows=0)]
        capped = [int(w[0]) for w in encoder.windows(signal, max_windows=5)]
        self.assertEqual(len(capped), 5)
        self.assertEqual(capped[0], uncapped[0])
        self.assertEqual(capped[-1], uncapped[-1])
        self.assertEqual(capped, sorted(capped))
        self.assertGreater(min(np.diff(capped)), self.size // 2)

    def test_the_cap_is_an_argument_not_a_global_to_reach_for(self):
        """§8.6 runs threads. A cap set by mutating a module global would be one
        more piece of process-wide state for a worker to read mid-change, which
        is the shape of bug `config.using` already exists to prevent."""
        signal = np.arange(self.size * 20, dtype=np.float32)
        self.assertEqual(len(list(encoder.windows(signal, max_windows=3))), 3)
        self.assertEqual(len(list(encoder.windows(signal))), encoder.MAX_WINDOWS)

    def test_zero_means_uncapped_and_none_means_the_default(self):
        """`--max-windows 0` has to mean *every window*, not *the default*, or
        the flag that undoes the cap quietly re-applies it."""
        signal = np.arange(self.size * 20, dtype=np.float32)
        self.assertGreater(len(list(encoder.windows(signal, max_windows=0))),
                           encoder.MAX_WINDOWS)
        self.assertEqual(len(list(encoder.windows(signal, max_windows=None))),
                         encoder.MAX_WINDOWS)

    def test_max_windows_is_the_cap_section_8_6_measured(self):
        """§8.5 left this at None for §8.6 to pull with the numbers in hand. It
        was pulled at 12: measured over 71 tracks from 8 complete albums, the
        nearest neighbour agrees with the uncapped answer 87% of the time, the
        top-5 lists overlap 0.90, and how often the nearest neighbour shares an
        album — the column that says whether the answer is any good — does not
        move at all. It buys 3.4x."""
        self.assertEqual(encoder.MAX_WINDOWS, 12)

    def test_window_features_is_the_batched_form_of_input_features(self):
        """The tensor that crosses §8.6's queue: (n, 1, frames, mels), assembled
        in the reader thread so the main thread does nothing but run the model."""
        signal = np.arange(self.size * 6, dtype=np.float32)
        tensor = encoder.window_features(signal, max_windows=3)
        self.assertEqual(tensor.shape,
                         (3, 1, encoder.expected_frames(), config.N_MELS))
        self.assertEqual(tensor.dtype, np.dtype('float32'))
        first = encoder.input_features(next(iter(encoder.windows(signal, max_windows=3))))
        np.testing.assert_array_equal(tensor[0, 0], first[0])

    def test_embed_features_refuses_a_tensor_of_the_wrong_shape(self):
        """A mel handed over as (mels, frames), or without the channel axis, must
        not reach the session — where it would either throw a shape error deep in
        the runtime or, when the axes happen to match, quietly embed nonsense."""
        for shape in ((4, 4), (2, 2, 4, 4), (2, 1, 4, 4)):
            with self.assertRaises(encoder.EncoderError):
                encoder.embed_features(np.zeros(shape, dtype=np.float32))

    def test_input_features_is_frames_by_mels_not_mels_by_frames(self):
        """The graph's axes are (batch, channels, height, width) = (B, 1, frames,
        mels), and this project's mel convention is (mels, frames). Getting the
        transpose backwards is a shape error — which is the good case."""
        tensor = encoder.input_features(np.zeros(self.size, dtype=np.float32))
        self.assertEqual(tensor.shape, (1, encoder.expected_frames(), config.N_MELS))
        self.assertEqual(tensor.dtype, np.dtype('float32'))


class PoolTest(unittest.TestCase):
    def test_result_is_a_unit_vector(self):
        vectors = np.random.RandomState(0).randn(7, encoder.DIM).astype(np.float32)
        self.assertAlmostEqual(float(np.linalg.norm(encoder.pool(vectors))), 1.0, places=5)

    def test_one_huge_window_cannot_become_the_track(self):
        """⚠️ Windows are L2-normalised BEFORE the mean. Without that, a single
        loud, spectrally extreme ten seconds can carry a far larger norm than the
        rest and dominate — so the track's vector would describe its most unusual
        moment rather than the track."""
        rng = np.random.RandomState(1)
        ordinary = rng.randn(9, encoder.DIM).astype(np.float32)
        outlier = (rng.randn(1, encoder.DIM) * 500.0).astype(np.float32)
        pooled = encoder.pool(np.concatenate([ordinary, outlier]))
        outlier_direction = outlier[0] / np.linalg.norm(outlier[0])
        self.assertLess(float(pooled @ outlier_direction), 0.7)

    def test_output_is_float32(self):
        """float64 would be refused at `index.to_blob`, which is where that guard
        was put — but failing here names the cause instead of the symptom."""
        vectors = np.random.RandomState(2).randn(4, encoder.DIM).astype(np.float32)
        self.assertEqual(encoder.pool(vectors).dtype, np.dtype('float32'))

    def test_windows_that_cancel_to_nothing_are_refused(self):
        opposite = np.zeros((2, encoder.DIM), dtype=np.float32)
        opposite[0, 0], opposite[1, 0] = 1.0, -1.0
        with self.assertRaises(encoder.EncoderError):
            encoder.pool(opposite)

    def test_wrong_shape_is_refused(self):
        with self.assertRaises(encoder.EncoderError):
            encoder.pool(np.zeros(encoder.DIM, dtype=np.float32))


@unittest.skipUnless(encoder.available(), 'onnxruntime or the weights are absent')
class ForwardPassTest(unittest.TestCase):
    """The §8.5 verification, as assertions. `encoder.py --verify` prints the same
    checks against real library tracks; these run on synthesised noise so they
    need no mount."""

    @classmethod
    def setUpClass(cls):
        cls.signal = (0.2 * np.random.RandomState(20260818).randn(48000 * 25)).astype(np.float32)
        cls.vector = encoder.embed(cls.signal)

    def test_dimension_is_what_the_graph_declares(self):
        self.assertEqual(self.vector.shape, (encoder.DIM,))

    def test_stable_across_runs(self):
        self.assertEqual(encoder.embed(self.signal).tobytes(), self.vector.tobytes())

    def test_neither_all_zero_nor_nan(self):
        """§8.5's stated check, verbatim — necessary, and nowhere near sufficient,
        which is why `verify()` adds spread, structure and sensitivity."""
        self.assertTrue(np.all(np.isfinite(self.vector)))
        self.assertTrue(np.any(self.vector != 0))

    def test_unit_norm(self):
        self.assertAlmostEqual(float(np.linalg.norm(self.vector)), 1.0, places=5)

    def test_one_embedding_per_window(self):
        with config.using(config.ENCODER):
            produced = encoder.embed_windows(self.signal)
            expected = len(list(encoder.windows(self.signal)))
        self.assertEqual(produced.shape, (expected, encoder.DIM))

    def test_the_window_count_itself_depends_on_the_active_profile(self):
        """⚠️ `windows()` sizes itself from `config.SR`, so counting windows
        outside the encoder context counts BASELINE windows — 22.05 kHz ones,
        which are less than half as long. Harmless in a test that then fails;
        silent in caller code that pre-allocates from the wrong number."""
        outside = len(list(encoder.windows(self.signal)))
        with config.using(config.ENCODER):
            inside = len(list(encoder.windows(self.signal)))
        self.assertGreater(outside, inside)

    def test_the_profile_is_restored_afterwards(self):
        """`embed` swaps module globals. If it leaked, every descriptor computed
        after an embedding would silently be built at 48 kHz / 64 mels."""
        before = config.signature()
        encoder.embed(self.signal)
        self.assertEqual(config.signature(), before)
        self.assertEqual(config.signature(), config.baseline().signature())

    def test_the_weights_are_the_pinned_artifact(self):
        self.assertTrue(encoder.verify_checksum())

    def test_batch_size_does_not_change_the_answer(self):
        """§8.6 picked batch 4 over 8 on speed alone (0.058 vs 0.066 s/window),
        and the GPU path picks 12 for the same kind of reason. That is only a free
        choice if batching cannot move the vectors — so this pins it, and it is
        why `recipe()` leaves the batch size out.

        ⚠️ **THE STRENGTH OF THE GUARANTEE IS BACKEND-DEPENDENT, AND THAT IS
        MEASURED.** On CPU the result is BITWISE identical at every batch size.
        On CUDA it is not: cuBLAS selects different reduction strategies by batch
        dimension, so accumulation order changes and the bytes change with it
        (max element delta 2.5e-04). What does NOT change is where the track
        lands — pooled cosine stays at 0.9999994, which is the fp32 noise floor
        of this very measurement (the CPU's own bitwise-identical vectors score
        0.99999988 against themselves).

        Asserted as two tiers rather than weakened to one: dropping to cosine
        everywhere would stop noticing a real CPU regression, and demanding
        bitwise everywhere would fail on hardware that is behaving correctly.
        """
        import numpy as np

        with config.using(config.ENCODER):
            tensor = encoder.window_features(self.signal)
            batches = {b: encoder.embed_features(tensor, batch_size=b)
                       for b in (1, 4, 8, 12)}
        ref = batches[4]
        bitwise_expected = encoder.active_provider() == 'CPUExecutionProvider'

        for b, got in batches.items():
            if bitwise_expected:
                self.assertEqual(got.tobytes(), ref.tobytes(),
                                 f'CPU must be bitwise stable across batch sizes (batch {b})')
            a, c = encoder.pool(ref), encoder.pool(got)
            cos = float(a @ c)
            self.assertGreater(cos, 0.9999,
                               f'batch {b} moved the track (cosine {cos:.9f}) — batching '
                               f'would be a property of the vector space, not a speed knob')
            self.assertLess(np.abs(got - ref).max(), 1e-3, f'batch {b}')


class WindowGuardTest(unittest.TestCase):
    """The two ways a signal reaches `windows()` already broken, and the one way
    the cap does."""

    def test_a_negative_cap_is_refused_by_name(self):
        """⚠️ 0 is UNCAPPED and documented as such (`--max-windows 0`), so a
        negative is a typo rather than a synonym — and it reached
        `np.linspace(..., cap)` and died there talking about sample counts,
        several frames from anything the caller wrote."""
        signal = np.zeros(48000 * 30, dtype=np.float32)
        with config.using(config.ENCODER):
            with self.assertRaises(encoder.EncoderError) as caught:
                list(encoder.windows(signal, max_windows=-1))
        self.assertIn('max_windows', str(caught.exception))

    def test_zero_still_means_uncapped(self):
        signal = np.zeros(48000 * 130, dtype=np.float32)
        with config.using(config.ENCODER):
            capped = len(list(encoder.windows(signal)))
            uncapped = len(list(encoder.windows(signal, max_windows=0)))
        self.assertEqual(capped, encoder.MAX_WINDOWS)
        self.assertGreater(uncapped, capped)

    def test_a_non_finite_signal_is_refused_at_the_door(self):
        """A NaN survives the mel, the log and the matmul and comes back as 512
        NaNs, which `pool` then rejects with "windows cancelled to zero" — a true
        sentence about entirely the wrong thing. Named where it happened."""
        signal = np.zeros(48000 * 30, dtype=np.float32)
        signal[1000] = np.nan
        with config.using(config.ENCODER):
            with self.assertRaises(encoder.EncoderError) as caught:
                list(encoder.windows(signal))
        self.assertIn('non-finite', str(caught.exception))


class FetchAtomicityTest(unittest.TestCase):
    """⚠️ 281 MB over a home connection is a minute of exposure to a Ctrl-C.

    The first version streamed straight into `MODEL_PATH`, so any interruption
    left a truncated file at exactly the path `available()` checks for existence
    — and the next backfill reported the encoder present, failed inside
    onnxruntime, and marked the library failed. The file must now be either
    absent or checksum-clean, with no third state.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-fetch-')
        self.saved_dir, self.saved_path = encoder.MODELS_DIR, encoder.MODEL_PATH
        encoder.MODELS_DIR = self.tmp
        encoder.MODEL_PATH = os.path.join(self.tmp, 'model.onnx')

    def tearDown(self):
        encoder.MODELS_DIR, encoder.MODEL_PATH = self.saved_dir, self.saved_path
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_an_interrupted_download_leaves_nothing_behind(self):
        class Torn(io.BytesIO):
            def read(self, n=-1):
                raise OSError('connection reset')

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with unittest.mock.patch('urllib.request.urlopen', lambda url: Torn()):
            with self.assertRaises(OSError):
                encoder.fetch()
        self.assertFalse(os.path.exists(encoder.MODEL_PATH))
        self.assertFalse(os.path.exists(encoder.MODEL_PATH + '.partial'))
        self.assertFalse(encoder.available())

    def test_a_complete_download_with_the_wrong_bytes_is_refused(self):
        class Wrong(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with unittest.mock.patch('urllib.request.urlopen',
                                 lambda url: Wrong(b'not an onnx graph')):
            with self.assertRaises(encoder.EncoderError) as caught:
                encoder.fetch()
        self.assertIn('checksum', str(caught.exception))
        self.assertFalse(os.path.exists(encoder.MODEL_PATH))


if __name__ == '__main__':
    unittest.main()


class ProviderNegotiationTest(unittest.TestCase):
    """The provider is chosen at runtime and must never change the answer."""

    def setUp(self):
        self.saved_override = encoder.PROVIDER_OVERRIDE

    def tearDown(self):
        encoder.PROVIDER_OVERRIDE = self.saved_override

    def test_cpu_is_always_in_the_preference_list(self):
        """CPU is the SUPPORTED configuration; the GPU is an optimisation one
        machine happens to afford. A preference list that could come back without
        a CPU entry would turn a missing driver into a dead pipeline."""
        self.assertIn('CPUExecutionProvider', encoder.PROVIDER_PREFERENCE)
        if encoder.available():
            encoder.PROVIDER_OVERRIDE = None
            self.assertIn('CPUExecutionProvider', encoder.preferred_providers())

    def test_preference_order_puts_cuda_first(self):
        self.assertLess(encoder.PROVIDER_PREFERENCE.index('CUDAExecutionProvider'),
                        encoder.PROVIDER_PREFERENCE.index('CPUExecutionProvider'))

    @unittest.skipUnless(encoder.available(), 'onnxruntime or the weights are absent')
    def test_only_available_providers_are_requested(self):
        """Asking onnxruntime for a provider its build does not carry makes it warn
        and fall back silently — the one outcome this project will not accept."""
        import onnxruntime
        encoder.PROVIDER_OVERRIDE = None
        available = set(onnxruntime.get_available_providers())
        self.assertTrue(set(encoder.preferred_providers()) <= available)

    def test_override_pins_one_provider(self):
        encoder.PROVIDER_OVERRIDE = 'CPUExecutionProvider'
        self.assertEqual(encoder.preferred_providers(), ['CPUExecutionProvider'])

    def test_batch_size_is_resolved_per_call_not_at_import(self):
        """The default-argument trap, asserted. `batch_size=BATCH_WINDOWS` in the
        signature would freeze the CPU's 4 before any session exists, and the GPU
        would run at a third of its throughput with no symptom."""
        import inspect
        for fn in (encoder.embed_features, encoder.embed_windows,
                   encoder.embed_windows_unchecked):
            self.assertIsNone(inspect.signature(fn).parameters['batch_size'].default,
                              f'{fn.__name__} must resolve its batch size at call time')

    @unittest.skipUnless(encoder.available(), 'onnxruntime or the weights are absent')
    def test_batch_size_matches_the_live_provider(self):
        self.assertEqual(
            encoder.batch_windows(),
            encoder.BATCH_WINDOWS_CUDA if encoder.active_provider() == 'CUDAExecutionProvider'
            else encoder.BATCH_WINDOWS)

    def test_provider_is_not_part_of_the_recipe(self):
        """Vectors computed on CPU and on GPU go into ONE table and are compared
        against each other, so the recipe must not name the backend — otherwise
        `index.assert_recipe` would reject the 2,283 CPU rows the moment the GPU
        came online."""
        for name in ('CUDA', 'CPU', 'Execution', 'provider'):
            self.assertNotIn(name, encoder.recipe())


@unittest.skipUnless(
    'CUDAExecutionProvider' in __import__('onnxruntime').get_available_providers()
    if encoder.available() else False,
    'CUDA execution provider not available')
class ProviderEquivalenceTest(unittest.TestCase):
    """The check that licenses mixing CPU- and GPU-computed rows in one table.

    A backend that placed tracks differently would fork the vector space with no
    error anywhere — Trap 16, reached through hardware instead of config. Cosine
    rather than element equality: fp32 accumulation order legitimately differs
    across backends, and what must not differ is WHERE THE TRACK LANDS.
    """

    def test_cpu_and_cuda_agree_on_the_same_signal(self):
        import numpy as np
        import onnxruntime

        rng = np.random.RandomState(20260821)
        with config.using(config.ENCODER):
            sig = (0.2 * rng.randn(config.SR * 25)).astype(np.float32)
            feats = np.stack([encoder.input_features(w) for w in encoder.windows(sig)]
                             ).astype(np.float32)

        def run(provider):
            opts = onnxruntime.SessionOptions()
            opts.intra_op_num_threads = 4
            sess = onnxruntime.InferenceSession(encoder.MODEL_PATH, opts, providers=[provider])
            self.assertEqual(sess.get_providers()[0], provider)
            out = sess.run(['audio_embeds'], {'input_features': feats})[0].mean(axis=0)
            return out / np.linalg.norm(out)

        cos = float(run('CPUExecutionProvider') @ run('CUDAExecutionProvider'))
        self.assertGreater(cos, 0.9999,
                           f'CPU and CUDA disagree (cosine {cos:.9f}) — the two backends '
                           f'would build one table out of two vector spaces')


class CheckSetTest(unittest.TestCase):
    """`ridge.CHECK_SET` pins four paths into a real library, and the library got
    reorganised once already — taking SPREAD, STRUCTURE and SENSITIVITY offline
    while `verify()` still printed PASS. These are the guards on that."""

    def test_check_set_is_four_unalike_tracks(self):
        import ridge
        self.assertEqual(len(ridge.CHECK_SET), 4)
        self.assertEqual(len(set(ridge.CHECK_SET)), 4)

    def test_check_set_entries_are_relative(self):
        """Absolute paths here would make the set un-relocatable and silently
        unresolvable under `--root`."""
        import os
        import ridge
        for rel in ridge.CHECK_SET:
            self.assertFalse(os.path.isabs(rel), rel)

    def test_missing_is_the_complement_of_found(self):
        import ridge
        found = len(ridge.check_set_paths())
        self.assertEqual(found + len(ridge.check_set_missing()), len(ridge.CHECK_SET))

    @unittest.skipUnless(__import__('scan').library_reachable(), 'library not mounted')
    def test_every_pinned_path_exists_when_the_library_is_mounted(self):
        """The regression that already happened: a live mount and a stale set."""
        import ridge
        self.assertEqual(ridge.check_set_missing(), [],
                         'ridge.CHECK_SET is stale — verify() would skip its three '
                         'real checks while still reporting PASS')
