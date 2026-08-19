#!/usr/bin/env python3
"""M1 — the mel spectrogram, hand-rolled in numpy.

    frame → Hann → rfft → power → mel filterbank → log     →  (128, T) float32

No audio library, no `librosa.filters.mel`. At this scale the filterbank is ~30
lines, and writing it is the difference between demonstrating the transform and
demonstrating a library call (ALGORITHMS.md §4). Every parameter comes from
config.py and **nothing here re-derives one** — that is Trap 16, and this module
is its largest consumer.

WHY A MEL SPECTROGRAM AT ALL. Raw waveform amplitude is close to useless for
similarity: two masterings of one track have different amplitude envelopes, and
two unrelated songs at the same loudness look nearly identical. A recommender
built on time-domain amplitude tracks loudness and nothing else. The mel
spectrogram instead answers "how much energy, in which frequency band, at which
moment" — and it warps the frequency axis to match human pitch perception, so
that a fixed interval in HERTZ buys far more resolution down low than up high:
100 Hz spans ~95 mel around 440 Hz but only ~13 mel around 8 kHz. That warping
is the `hz_to_mel` pair below, and it is the only reason 128 numbers per frame
can describe music at all — a linear 128-band split would spend most of its
bands on the octave nobody hears melody in.

⚠️ Mel is NOT a log-frequency axis. It is roughly linear below ~1 kHz and
logarithmic above, so an octave up high spans MORE mel than an octave down low
(701 vs 242 for 4400→8800 against 220→440). Equal treatment per octave is a
constant-Q transform, a different thing entirely. A test pins this, because it
is an easy and expensive assumption to make.

MEMORY. `np.fft.rfft` does not preserve single precision — it upcasts float32 to
complex128 — so a 20-minute track computed in one shot is over a gigabyte of
transient. §8.6 runs parallel decode workers, several tracks in flight at once,
so per-track memory must not scale with track length. Everything below is
therefore computed in **blocks of frames**: peak memory is a function of
BLOCK_FRAMES, not of duration.
"""
import numpy as np

import config

# One block of frames through the FFT at a time. 1024 frames × 1025 bins ×
# 16 bytes (complex128) ≈ 17 MB transient, whatever the track length.
BLOCK_FRAMES = 1024


# ── The mel scale ───────────────────────────────────────────────────────────────
# The frequency warping, and the reason a mel spectrogram is not just a coarse
# spectrogram. Both conventions are implemented because config.MEL_SCALE may have
# to change to match an encoder at §8.5 — and the two disagree by enough to
# corrupt a vector space while raising nothing.

_SLANEY_F_SP = 200.0 / 3.0          # Hz per mel in the linear region
_SLANEY_MIN_LOG_HZ = 1000.0         # the linear/log breakpoint
_SLANEY_MIN_LOG_MEL = _SLANEY_MIN_LOG_HZ / _SLANEY_F_SP     # = 15.0
_SLANEY_LOGSTEP = np.log(6.4) / 27.0


def hz_to_mel(hz):
    """Hertz → mel.

    'htk'    a single logarithmic curve, m = 2595·log10(1 + f/700).
    'slaney' LINEAR below 1 kHz, logarithmic above — closer to the original
             psychoacoustic measurements, and what librosa defaults to.
    """
    hz = np.asarray(hz, dtype=np.float64)
    if config.MEL_SCALE == 'htk':
        return 2595.0 * np.log10(1.0 + hz / 700.0)
    if config.MEL_SCALE == 'slaney':
        mel = hz / _SLANEY_F_SP
        log_region = hz >= _SLANEY_MIN_LOG_HZ
        mel = np.where(
            log_region,
            _SLANEY_MIN_LOG_MEL
            + np.log(np.maximum(hz, _SLANEY_MIN_LOG_HZ) / _SLANEY_MIN_LOG_HZ) / _SLANEY_LOGSTEP,
            mel,
        )
        return mel
    raise ValueError(f'unknown MEL_SCALE {config.MEL_SCALE!r}')


def mel_to_hz(mel):
    """mel → Hertz. The exact inverse of `hz_to_mel` for the same convention."""
    mel = np.asarray(mel, dtype=np.float64)
    if config.MEL_SCALE == 'htk':
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)
    if config.MEL_SCALE == 'slaney':
        hz = mel * _SLANEY_F_SP
        log_region = mel >= _SLANEY_MIN_LOG_MEL
        hz = np.where(
            log_region,
            _SLANEY_MIN_LOG_HZ
            * np.exp(_SLANEY_LOGSTEP * (mel - _SLANEY_MIN_LOG_MEL)),
            hz,
        )
        return hz
    raise ValueError(f'unknown MEL_SCALE {config.MEL_SCALE!r}')


def mel_edges():
    """N_MELS + 2 band edges, EQUALLY SPACED IN MEL, returned in Hz.

    Equal spacing in mel is the whole point: converted back to Hz the low bands
    come out narrow and the high bands wide, which is what matches how pitch is
    actually heard. Each filter m spans edges[m] → edges[m+2] and peaks at
    edges[m+1], so consecutive filters share exactly half their support — hence
    N_MELS + 2 edges for N_MELS filters.
    """
    lo, hi = hz_to_mel(config.FMIN), hz_to_mel(config.FMAX)
    return mel_to_hz(np.linspace(lo, hi, config.N_MELS + 2))


def fft_frequencies():
    """Centre frequency of each `rfft` output bin, in Hz."""
    return np.linspace(0.0, config.SR / 2.0, config.N_FFT // 2 + 1)


def _build_filterbank():
    """The triangular mel filterbank: (N_MELS, N_FFT//2 + 1).

    One row per mel band, one column per FFT bin. Multiplying a power spectrum
    by this matrix is a weighted sum of neighbouring FFT bins into each band —
    i.e. the projection from 1025 linear-frequency numbers down to 128
    perceptually-spaced ones. That single matmul is the entire mel step.
    """
    freqs = fft_frequencies()
    edges = mel_edges()
    if not np.all(np.diff(edges) > 0):
        raise ValueError(
            'mel band edges are not strictly increasing — N_MELS is too high for '
            'this FMIN/FMAX/SR, and the filterbank would contain divide-by-zero rows'
        )

    fb = np.zeros((config.N_MELS, freqs.size), dtype=np.float64)
    for m in range(config.N_MELS):
        lo, mid, hi = edges[m], edges[m + 1], edges[m + 2]
        rising = (freqs - lo) / (mid - lo)          # 0 at lo,  1 at mid
        falling = (hi - freqs) / (hi - mid)         # 1 at mid, 0 at hi
        fb[m] = np.maximum(0.0, np.minimum(rising, falling))

    if config.MEL_NORM == 'slaney':
        # Scale each filter to unit AREA rather than unit peak, so a wide
        # high-frequency band does not simply out-weigh a narrow low one.
        fb *= (2.0 / (edges[2:] - edges[:-2]))[:, None]
    elif config.MEL_NORM is not None:
        raise ValueError(f'unknown MEL_NORM {config.MEL_NORM!r}')

    return fb.astype(np.float32)


def _build_window():
    """A PERIODIC Hann window: 0.5·(1 − cos(2πn/N)).

    Periodic (denominator N), not symmetric (denominator N−1) — `np.hanning` gives
    the symmetric one. For overlapping STFT analysis the periodic form is the
    correct choice; the symmetric one leaves a small discontinuity between frames.
    """
    n = np.arange(config.N_FFT, dtype=np.float64)
    return (0.5 - 0.5 * np.cos(2.0 * np.pi * n / config.N_FFT)).astype(np.float32)


# Built once, as §8.2 requires — but keyed on the config signature so that
# changing a parameter (a test, or §8.5 matching an encoder) rebuilds rather than
# silently serving a filterbank for the old configuration. "Built once" and
# "built for the wrong config" are one edit apart otherwise.
_CACHE = {}


def _cached(name, builder):
    key = (name, config.signature())
    if key not in _CACHE:
        _CACHE.clear()
        _CACHE[key] = builder()
    return _CACHE[key]


def mel_filterbank():
    return _cached('filterbank', _build_filterbank)


def hann_window():
    return _cached('window', _build_window)


# ── Framing and the spectrogram ─────────────────────────────────────────────────
def frame(x):
    """Slice the signal into overlapping frames: (n_frames, N_FFT).

    With CENTER on, the signal is reflect-padded by N_FFT//2 first, so frame k is
    CENTRED on sample k·HOP rather than starting there — that is what makes the
    time axis line up with the audio, and it is why the frame count is
    1 + n//HOP rather than the shorter (n − N_FFT)//HOP + 1.

    `sliding_window_view` makes this a VIEW, not a copy: the 83 MB of overlapping
    frames a four-minute track would otherwise materialise costs nothing until
    something multiplies it.
    """
    x = np.asarray(x, dtype=np.float32)
    if x.ndim != 1:
        raise ValueError(f'expected a 1-D signal, got shape {x.shape}')

    if config.CENTER:
        pad = config.N_FFT // 2
        # Reflect padding needs at least `pad` samples to reflect. A clip shorter
        # than the half-window (well under 50 ms here) falls back to zeros rather
        # than raising — a short file is data, not an error (§8.6).
        mode = config.PAD_MODE if x.size > pad else 'constant'
        x = np.pad(x, pad, mode=mode)
    elif x.size < config.N_FFT:
        return np.empty((0, config.N_FFT), dtype=np.float32)

    from numpy.lib.stride_tricks import sliding_window_view
    return sliding_window_view(x, config.N_FFT)[::config.HOP]


def _power_of(frames_block, window):
    """One block of frames → power spectrum. The FFT step."""
    spectrum = np.fft.rfft(frames_block * window, axis=-1)
    if config.POWER == 2.0:
        # |z|² without the sqrt that np.abs would take and then square back.
        return spectrum.real ** 2 + spectrum.imag ** 2
    return np.abs(spectrum) ** config.POWER


def iter_blocks(x):
    """Yield `(start, frames_block, power_block)` — the framing and FFT stages,
    one block of frames at a time.

    THE SINGLE FFT PATH. `melspectrogram` below is one consumer; descriptors.py
    is the other, and it needs three things from the same pass — the raw frames
    (for ZCR and RMS, which are time-domain), the LINEAR power spectrum (for the
    spectral shape descriptors and chroma, which are defined over Hz and not over
    mel bands), and the mel projection. Computing those from three separate
    traversals would triple the FFT cost and, worse, give three chances for one
    of them to be framed differently from the others — which is Trap 16 wearing
    a different hat.

    Blocked for the reason stated at the top of this file: `np.fft.rfft` upcasts
    float32 to complex128, so peak memory must track BLOCK_FRAMES rather than
    track length or §8.6's parallel workers will exhaust the machine on a long
    track.
    """
    frames = frame(x)
    window = hann_window()
    for start in range(0, frames.shape[0], BLOCK_FRAMES):
        block = frames[start:start + BLOCK_FRAMES]
        yield start, block, _power_of(block, window)


def magnitude_of(power):
    """The MAGNITUDE spectrum, whatever `config.POWER` currently says.

    The classical spectral descriptors (centroid, bandwidth, rolloff) are defined
    over |Z|, not over |Z|^p. Deriving magnitude here rather than reading
    `_power_of`'s output directly means those definitions do not silently change
    meaning if §8.5 flips POWER to 1.0 to match an encoder.
    """
    if config.POWER == 1.0:
        return power
    if config.POWER == 2.0:
        return np.sqrt(power)
    return power ** (1.0 / config.POWER)


def melspectrogram(x):
    """LINEAR mel spectrogram: (N_MELS, T) float32, no log applied.

    Computed in blocks so peak memory tracks BLOCK_FRAMES, not track length.
    """
    fb = mel_filterbank()
    out = np.empty((config.N_MELS, config_frames(x)), dtype=np.float32)

    for start, _block, power in iter_blocks(x):
        # The mel projection: (N_MELS, n_freqs) @ (n_freqs, block) → (N_MELS, block)
        out[:, start:start + power.shape[0]] = (fb @ power.T).astype(np.float32)

    return out


def config_frames(x):
    """Frames `x` will produce — asked of `frame()` itself rather than of
    `config.n_frames`, so a signal shorter than the pad fallback still sizes its
    own output correctly."""
    return frame(x).shape[0]


def logmelspectrogram(x):
    """THE PIPELINE ARTIFACT: log-mel, (N_MELS, T) float32.

    The log is not cosmetic. Loudness is perceived logarithmically and musical
    energy spans many orders of magnitude, so without it a single loud moment
    dominates every distance computation and quiet detail contributes nothing.
    Values are floored at LOG_FLOOR first, so silence maps to a finite constant
    instead of −inf — which would poison every downstream mean, norm and matmul.
    """
    return apply_log(melspectrogram(x))


def apply_log(x):
    """The configured log compression, floored. The single implementation.

    Shared with descriptors.py, which stores RMS in the log domain for exactly
    the same reason the mel matrix is compressed here — a linear loudness figure
    across a corpus is dominated by its own tail. One function, so `LOG_MODE`
    means one thing everywhere.
    """
    floored = np.maximum(np.asarray(x, dtype=np.float32), np.float32(config.LOG_FLOOR))
    if config.LOG_MODE == 'ln':
        return np.log(floored).astype(np.float32)
    if config.LOG_MODE == 'db':
        return (10.0 * np.log10(floored)).astype(np.float32)
    raise ValueError(f'unknown LOG_MODE {config.LOG_MODE!r}')


def log_floor_value():
    """What silence maps to — the constant a silent frame produces."""
    if config.LOG_MODE == 'ln':
        return float(np.log(np.float32(config.LOG_FLOOR)))
    return float(10.0 * np.log10(np.float32(config.LOG_FLOOR)))


if __name__ == '__main__':
    import sys
    import audio

    if len(sys.argv) != 2:
        raise SystemExit('usage: python mel.py <audio-file>')
    signal = audio.decode(sys.argv[1])
    M = logmelspectrogram(signal)
    band_energy = M.mean(axis=1)
    print(f'{M.shape[0]} bands × {M.shape[1]} frames, {M.dtype}, '
          f'{M.nbytes / 1e6:.1f} MB')
    print(f'range [{M.min():.2f}, {M.max():.2f}]  mean {M.mean():.2f}  '
          f'floor {log_floor_value():.2f}')
    print(f'loudest band {int(band_energy.argmax())} '
          f'(~{mel_edges()[int(band_energy.argmax()) + 1]:.0f} Hz), '
          f'quietest band {int(band_energy.argmin())}')
    print(f'non-finite values: {int((~np.isfinite(M)).sum())}')
