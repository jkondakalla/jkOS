"""The §8.1 gate: a decoded track's length must match ffprobe's, within one frame.

Why this is the gate and not something narrower: `decode` can fail in three ways
that all LOOK like success. Ignore `-ar` and you get the right samples at the
wrong rate. Ignore `-ac` and a stereo file returns interleaved channels that
read as a signal of double the length. Truncate the pipe and you get a short but
perfectly valid float array. Every one of those produces a mel matrix, an
embedding, and a neighbour list — all wrong, none raising.

Comparing the decoded sample count against the CONTAINER'S OWN idea of duration
catches all three at once, and does it via a path (`ffprobe`, reading the header)
that shares no code with the path under test.
"""
import os
import shutil
import tempfile
import unittest

import numpy as np

from config import HOP, SR, frame_seconds
from audio import DecodeError, decode, duration_of, probe_duration
from tests.helpers import first_library_track, have, make_sine_flac

NEED_FFMPEG = unittest.skipUnless(have('ffmpeg') and have('ffprobe'),
                                  'ffmpeg/ffprobe not on PATH')


@NEED_FFMPEG
class DecodeTest(unittest.TestCase):
    """Against a synthetic FLAC, so this runs with no library mount."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='music-audio-')
        cls.seconds = 3.0
        cls.path = make_sine_flac(cls.tmp, seconds=cls.seconds, freq=440.0, rate=44100)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_hostile_filename_survives(self):
        # The fixture's name carries &, ', [, ] and spaces. It existing and being
        # decodable at all IS the Trap 20 assertion — a shell would have mangled
        # it before ffmpeg ever saw it.
        self.assertIn('&', os.path.basename(self.path))
        self.assertIn("'", os.path.basename(self.path))
        self.assertTrue(os.path.isfile(self.path))
        self.assertGreater(len(decode(self.path)), 0)

    def test_returns_1d_float32(self):
        x = decode(self.path)
        self.assertEqual(x.ndim, 1)
        self.assertEqual(x.dtype, np.dtype('float32'))

    def test_duration_matches_ffprobe_within_one_frame(self):
        """THE GATE."""
        x = decode(self.path)
        decoded = duration_of(x)
        probed = probe_duration(self.path)
        self.assertLessEqual(
            abs(decoded - probed), frame_seconds(),
            f'decoded {decoded:.4f}s vs ffprobe {probed:.4f}s — '
            f'more than one frame ({frame_seconds():.4f}s) apart',
        )

    def test_resampled_to_the_analysis_rate(self):
        # Generated at 44.1 kHz; if `-ar` were dropped this count would double.
        x = decode(self.path)
        self.assertAlmostEqual(len(x) / SR, self.seconds, delta=HOP / SR)

    def test_decodes_a_correctly_scaled_sine(self):
        """Not silence, and genuinely a sine at the right amplitude.

        A bare `peak > 0` would pass for noise, for a constant, and for a decode
        scaled by 1/32768. The shape check is what makes this mean something: a
        pure sine of amplitude A has RMS exactly A/√2, and that ratio survives no
        scaling bug, no dithering, and no dropped channel.

        The absolute level is deliberately not asserted — ffmpeg's `sine` source
        generates at −18 dBFS, not full scale (confirmed against ffmpeg's own
        `volumedetect`), and pinning that would be pinning a detail of the
        fixture generator rather than a property of the decoder.
        """
        x = decode(self.path)
        peak = float(np.max(np.abs(x)))
        rms = float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))
        self.assertGreater(peak, 0.01, 'decoded to silence')
        self.assertLessEqual(peak, 1.0, 'decoded above full scale')
        self.assertAlmostEqual(rms, peak / np.sqrt(2.0), delta=peak * 0.01)

    def test_read_only_view(self):
        # Documented contract: the array is a view over the subprocess buffer, so
        # in-place mutation of the source signal fails loudly.
        x = decode(self.path)
        with self.assertRaises(ValueError):
            x[0] = 1.0


@NEED_FFMPEG
class FailureTest(unittest.TestCase):
    """Failures are data (§8.6): each of these must raise DecodeError specifically,
    so one bad file out of 15,326 marks its row and the batch continues."""

    def test_missing_file(self):
        with self.assertRaises(DecodeError):
            decode('/nonexistent/nowhere.flac')

    def test_not_audio(self):
        with tempfile.NamedTemporaryFile(suffix='.flac', delete=False) as fh:
            fh.write(b'this is not a FLAC file' * 100)
            junk = fh.name
        try:
            with self.assertRaises(DecodeError):
                decode(junk)
        finally:
            os.unlink(junk)

    def test_zero_length_file(self):
        with tempfile.NamedTemporaryFile(suffix='.flac', delete=False) as fh:
            empty = fh.name
        try:
            with self.assertRaises(DecodeError):
                decode(empty)
        finally:
            os.unlink(empty)

    def test_probe_of_junk_raises(self):
        with tempfile.NamedTemporaryFile(suffix='.flac', delete=False) as fh:
            fh.write(b'nope')
            junk = fh.name
        try:
            with self.assertRaises(DecodeError):
                probe_duration(junk)
        finally:
            os.unlink(junk)


@NEED_FFMPEG
class RealLibraryTest(unittest.TestCase):
    """The same gate against a real FLAC off the shelf. Skips without the mount —
    a real file has real channel counts, real sample rates and real tag chunks
    that a generated sine does not, so this is worth running when it can be."""

    def test_first_track_decodes_to_its_stated_length(self):
        path = first_library_track()
        if not path:
            self.skipTest('library not mounted')
        x = decode(path)
        self.assertEqual(x.dtype, np.dtype('float32'))
        self.assertLessEqual(abs(duration_of(x) - probe_duration(path)), frame_seconds())


if __name__ == '__main__':
    unittest.main()
