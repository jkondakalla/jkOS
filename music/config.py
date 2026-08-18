#!/usr/bin/env python3
"""The single source of truth for every analysis parameter.

⚠️ THIS MODULE IS TRAP 16 (Documentation/ALGORITHMS.md §10). Extraction and the
encoder disagreeing on any value below corrupts the vector space SILENTLY AND
TOTALLY — no exception, no NaN, no empty result. A model trained on 48 kHz /
64 mels, fed 22.05 kHz / 128 mels, returns confident garbage that looks exactly
like a working embedding and produces nearest-neighbour lists that are simply
wrong. There is no downstream check that catches it, which is why the defence
has to live here, at the source.

The rule, stated once: **nothing anywhere re-derives these.** Not mel.py, not
the backfill, not the encoder wrapper, not a test fixture. Everything imports
from this module. When §8.5 picks an encoder, either the model matches these
values or THESE VALUES CHANGE TO MATCH THE MODEL — but there is exactly one
place the answer lives, either way.

`signature()` is the mechanical half of that defence: a short stable hash over
every parameter that changes the resulting matrix. index.py stores it beside
each vector, so a config edit after a backfill becomes a LOUD failure at the
next write instead of a quiet corruption discovered months later at M4.
"""
import hashlib

# ── The analysis parameters ─────────────────────────────────────────────────────
# Chosen for M1 (ALGORITHMS.md §4 "M1 — mel extraction"). Every one of them is a
# candidate for revision at §8.5 when the encoder is chosen; none of them may be
# revised anywhere else.

SR = 22050          # Hz. Mel extraction discards everything above SR/2 anyway, which
                    # is why the library being lossless buys nothing here (Trap 15).
N_FFT = 2048        # samples per analysis frame — ~93 ms at 22.05 kHz.
HOP = 512           # samples between frame starts — ~23 ms, 75% overlap.
N_MELS = 128        # mel bands. The 128 in "a 128 × T matrix".
FMIN = 0.0          # Hz, low edge of the filterbank.
FMAX = SR / 2.0     # Hz, high edge. Nyquist; never let this exceed SR/2.

# ── The convention forks ────────────────────────────────────────────────────────
# Each of these is a place where two reasonable implementations differ, produce
# different matrices, and neither errors. They are named constants rather than
# hardcoded choices in mel.py precisely so that §8.5 can match an encoder by
# editing this file and nothing else.

WINDOW = 'hann'     # applied per frame before the FFT.
MEL_SCALE = 'htk'   # 'htk' | 'slaney'. The hz↔mel formula itself differs between
                    # them. torchaudio defaults to htk; librosa defaults to slaney.
                    # htk chosen because §8.5's likely candidates are torchaudio-
                    # preprocessed exports.
MEL_NORM = None     # None | 'slaney'. Filterbank area normalisation. torchaudio's
                    # default is None; librosa's is 'slaney'. Changes band energies
                    # by a per-band constant — invisible in a ridgeline, fatal to a
                    # model that expects the other one.
POWER = 2.0         # 2.0 = power spectrogram, 1.0 = magnitude.
CENTER = True       # pad by N_FFT//2 so frame k is centred on sample k*HOP.
PAD_MODE = 'reflect'

LOG_MODE = 'ln'     # 'ln' → log(max(x, LOG_FLOOR)). The compression applied to the
                    # mel energies. 'db' (10*log10) is the other common choice.
LOG_FLOOR = 1e-10   # floor before the log, so silence maps to a finite constant
                    # (ln(1e-10) ≈ -23.026) rather than -inf.

DTYPE = 'float32'   # every matrix and every stored vector. Enforced in index.py:
                    # a float64 vector written as a BLOB silently doubles its byte
                    # length and reads back as garbage at half the dimension.

# ── Library location ────────────────────────────────────────────────────────────
# Overridable so the suite runs on a machine without the Luna mount. Measured
# 2026-08-18: 15,326 FLACs across 89 artist folders, on a CIFS share at 85–96 MB/s
# — the network filesystem is the bottleneck, not the FFT and not the model
# (Trap 19).
LIBRARY_ROOT = '/mnt/Luna/Plex/Music'
AUDIO_EXTS = ('.flac',)   # measured: zero mp3/m4a/wav/ogg in the tree.


# ── Derived quantities ──────────────────────────────────────────────────────────
def n_frames(n_samples):
    """Frames a signal of `n_samples` produces under the framing above.

    Lives here, not in mel.py, for the same reason as everything else in this
    file: the backfill sizes buffers with it, the tests assert against it, and
    mel.py produces it. Three places agreeing by construction beats three places
    agreeing by coincidence.
    """
    if n_samples < 0:
        raise ValueError(f'n_samples must be non-negative, got {n_samples}')
    if CENTER:
        return 1 + n_samples // HOP
    if n_samples < N_FFT:
        return 0
    return 1 + (n_samples - N_FFT) // HOP


def frame_seconds():
    """Seconds of audio per analysis frame — the tolerance unit for the §8.1 gate."""
    return HOP / float(SR)


# ── The Trap 16 alarm ───────────────────────────────────────────────────────────
# Every parameter above that changes the resulting matrix. LIBRARY_ROOT is
# deliberately absent: where the files live has no bearing on what the numbers
# mean, and including it would invalidate a whole backfill when the mount moves.
_SIGNIFICANT = (
    'SR', 'N_FFT', 'HOP', 'N_MELS', 'FMIN', 'FMAX',
    'WINDOW', 'MEL_SCALE', 'MEL_NORM', 'POWER', 'CENTER', 'PAD_MODE',
    'LOG_MODE', 'LOG_FLOOR', 'DTYPE',
)


def canonical():
    """The parameter set as one deterministic string. Sorted, so the hash is
    stable against reordering the declarations above."""
    g = globals()
    return ';'.join(f'{k}={g[k]!r}' for k in sorted(_SIGNIFICANT))


def signature():
    """A short stable fingerprint of the analysis configuration.

    Stored beside every vector (index.py). If this changes while vectors exist,
    those vectors were computed under different rules and are not comparable to
    anything computed now — index.py raises rather than letting the two mix.
    """
    return hashlib.sha256(canonical().encode('utf-8')).hexdigest()[:12]


if __name__ == '__main__':
    print(canonical().replace(';', '\n'))
    print(f'\nsignature: {signature()}')
