#!/usr/bin/env python3
"""M3's COMPARISON ARM — the classical descriptor baseline (ToDo §8.4).

Built **before** the encoder on purpose. M4 is a gate, and a gate needs something
to weigh against: "are these ten neighbours good?" is a question with no failing
answer until there is a second list to be worse than. An arm built *after* the
thing it judges never gets built, and the gate quietly becomes a vibe check.

    decode → mel.iter_blocks → { time-domain · linear spectrum · mel } → 119 floats

Everything here is numpy over the STFT `mel.py` already computes — no second
framing, no second FFT, and nothing imported that is not already in the two-line
budget. What comes out is the pre-deep-learning state of the art for music
similarity, which is a genuinely respectable opponent: MFCC statistics alone will
happily cluster an artist's discography. **If the encoder cannot beat this, the
encoder path is broken** (ALGORITHMS.md §4, M4's stop condition).

⚠️ **THE Z-SCORE IS ACROSS THE CORPUS, NOT PER TRACK.** Normalising each track's
own vector to zero mean and unit variance destroys exactly the information the
space is made of — a bright track and a dark track both come out "average
brightness for themselves", and every distance collapses toward noise. It is the
same mistake `ridge.py` guards against one step earlier and in pixels, where it
was a per-panel level scale. It is guarded the same way here: **by API shape.**
There is no function in this module that normalises one vector. `CorpusStats`
can only be built by fitting over a matrix of many tracks, or loaded from the
index where a previous fit stored it — which is also what lets a track added
months later normalise identically to the ones fitted today.

⚠️ **RAW VECTORS ARE WHAT GET STORED.** The z-score is applied on the way OUT,
never on the way in. Storing normalised vectors would freeze one corpus's
statistics into every row, so re-fitting after the library grows would silently
mean comparing new rows against new stats and old rows against old ones. Raw in,
fitted stats in `meta`, normalisation at load. Re-fitting is then free and total.
"""
import base64
import os
import threading

import numpy as np

import config
import index
import mel

DESCRIPTOR_VERSION = 1

# ── The knobs, all in one place ─────────────────────────────────────────────────
N_MFCC = 20             # DCT-II coefficients kept, per ToDo §8.4.
ROLLOFF_PERCENT = 0.85  # the classical choice: the frequency below which 85% of
                        # the magnitude sits. Higher reads as "where the top end
                        # stops", lower drifts toward the centroid it duplicates.
TEMPO_MIN_BPM = 40.0
TEMPO_MAX_BPM = 240.0
TEMPO_PRIOR_BPM = 120.0     # centre of the log-normal tempo prior…
TEMPO_PRIOR_OCTAVES = 1.0   # …and its width, in octaves of tempo. See `tempo()`.
CHROMA_FMAX = 5000.0    # above this, what a bin contains is overtones of
                        # something lower, and folding them into pitch classes
                        # adds noise rather than harmony.
MIN_FRAMES = 4          # below this a track has no statistics worth taking.
MIN_FIT_ROWS = 8        # below this a corpus mean/std is not a corpus anything.
ZERO_STD = 1e-8         # a dimension flatter than this is constant — see CorpusStats.


class DescriptorError(RuntimeError):
    """A track could not be described. The batch's per-track catch, alongside
    `audio.DecodeError` — failures are data (§8.6), and a 40-second interlude
    with no detectable beat must not kill a run."""


# ── The layout ──────────────────────────────────────────────────────────────────
# Declared here, assembled below, and checked against each other on every call.
# The point is debuggability at M4: when two tracks that should be neighbours are
# not, the first question is *which dimensions* separate them, and that question
# is unanswerable against a bare 119-float array. Names and values cannot drift
# because `describe()` asserts the parts it built match this tuple exactly.
LAYOUT = (
    ('mfcc_mean', N_MFCC),      # timbre — the shape of the spectral envelope
    ('mfcc_std', N_MFCC),       # …and how much it moves
    ('dmfcc_mean', N_MFCC),     # timbre CHANGE — texture over time, not just texture
    ('dmfcc_std', N_MFCC),
    ('chroma_mean', 12),        # harmony — energy per pitch class
    ('chroma_std', 12),
    ('shape_mean', 6),          # centroid · bandwidth · rolloff · flatness · zcr · logrms
    ('shape_std', 6),
    ('tempo', 3),               # log2(bpm) · autocorrelation strength · onset rate
)

SHAPE_NAMES = ('centroid', 'bandwidth', 'rolloff', 'flatness', 'zcr', 'logrms')
TEMPO_NAMES = ('tempo_log2bpm', 'tempo_strength', 'onset_rate')

DIM = sum(n for _, n in LAYOUT)


def feature_names():
    """One name per dimension, in vector order. `python descriptors.py --names`."""
    out = []
    for block, count in LAYOUT:
        if block.startswith('shape'):
            out += [f'{n}_{block.split("_")[1]}' for n in SHAPE_NAMES]
        elif block == 'tempo':
            out += list(TEMPO_NAMES)
        else:
            out += [f'{block}[{i}]' for i in range(count)]
    return out


# ── MFCC: the DCT-II ────────────────────────────────────────────────────────────
def _build_dct():
    """The orthonormal DCT-II matrix, (N_MFCC, N_MELS).

    WHAT IT IS FOR. The 128 log-mel bands are heavily correlated — energy at
    200 Hz strongly predicts energy at 210 Hz — so as a similarity vector they
    waste most of their dimensions restating each other. The DCT is a rotation
    into a basis where the low coefficients carry the *broad shape* of the
    spectral envelope (coefficient 1 is essentially spectral tilt, i.e. dark
    versus bright) and the high ones carry fine detail nobody hears as timbre.
    Keeping 20 of 128 is therefore a real compression rather than a truncation:
    it drops the pitch-specific harmonic ripple and keeps the timbre.

    Coefficient 0 is kept deliberately — it is proportional to the mean log
    energy, i.e. loudness. That is one of 119 dimensions, and after the corpus
    z-score it is one comparable dimension among many, which is a fair weight
    for something that genuinely does distinguish a whisper from a wall of sound.
    """
    n = config.N_MELS
    k = np.arange(N_MFCC, dtype=np.float64)[:, None]
    j = np.arange(n, dtype=np.float64)[None, :]
    d = np.cos(np.pi * k * (2.0 * j + 1.0) / (2.0 * n))
    # Orthonormal scaling: the rows then form an orthonormal set, so the rotation
    # preserves distance and coefficient magnitudes are directly comparable.
    d *= np.sqrt(2.0 / n)
    d[0] *= np.sqrt(0.5)
    return d.astype(np.float32)


def dct_matrix():
    return mel._cached('dct', _build_dct)


def mfcc(logmel):
    """(N_MFCC, T) from (N_MELS, T). One small matmul."""
    return dct_matrix() @ logmel


# ── Chroma: the pitch-class projection ──────────────────────────────────────────
def chroma_min_hz():
    """The lowest frequency at which this FFT can resolve a semitone. DERIVED.

    ⚠️ **CHROMA CANNOT SEE THE BASS LINE AT THIS FFT SIZE, AND THAT IS ARITHMETIC,
    NOT AN OVERSIGHT.** FFT bins are evenly spaced in Hz (SR/N_FFT ≈ 10.8 Hz here)
    while semitones are evenly spaced in *ratio* — a semitone spans f·(2^(1/12)−1),
    which is 3.9 Hz at 65 Hz and 15.6 Hz at 262 Hz. Below the crossover the bins
    are wider than the notes, so a "chroma" computed down there is not a weak
    measurement of harmony, it is bins smeared across two or three pitch classes
    at once. Computed rather than hardcoded so that if §8.5 moves N_FFT or SR to
    match an encoder, the floor moves with them instead of quietly becoming a lie.
    """
    return (config.SR / config.N_FFT) / (2.0 ** (1.0 / 12.0) - 1.0)


def _build_chroma():
    """The pitch-class filterbank: (12, n_freqs).

    Each FFT bin is placed on the continuous MIDI pitch axis and split between
    the two semitones it falls between, with triangular weights that sum to one —
    the same partition-of-unity property the mel filterbank has, for the same
    reason: energy is REDISTRIBUTED across pitch classes, never created or lost
    by where a bin happens to land. The semitone is then folded modulo 12, which
    is what makes it a chroma rather than a spectrum: every C, in every octave,
    lands in the same bin, so a song transposed by an octave is unchanged and a
    song transposed by a fifth is not.
    """
    freqs = mel.fft_frequencies()
    fmin, fmax = chroma_min_hz(), min(CHROMA_FMAX, config.FMAX)
    band = (freqs >= fmin) & (freqs <= fmax)
    if not band.any():
        raise ValueError(
            f'no FFT bin lies between {fmin:.1f} Hz and {fmax:.1f} Hz — N_FFT is '
            f'too small for a chroma at SR={config.SR}'
        )

    midi = np.full(freqs.shape, np.nan)
    midi[band] = 69.0 + 12.0 * np.log2(freqs[band] / 440.0)

    cb = np.zeros((12, freqs.size), dtype=np.float64)
    lower = np.floor(midi[band])
    frac = midi[band] - lower
    cols = np.nonzero(band)[0]
    for semitone, weight in ((lower, 1.0 - frac), (lower + 1.0, frac)):
        classes = np.mod(semitone.astype(np.int64), 12)
        np.add.at(cb, (classes, cols), weight)
    return cb.astype(np.float32)


def chroma_filterbank():
    return mel._cached('chroma', _build_chroma)


def chroma(magnitude_block):
    """(12, block) chroma from a (block, n_freqs) magnitude spectrum.

    ⚠️ NORMALISED PER FRAME, and that is NOT the per-track normalisation this
    module's header refuses. Chroma answers "which pitch classes are sounding",
    a question about proportion; without the per-frame normalisation the loud
    parts of a track would simply out-vote the quiet ones and the feature would
    re-measure the loudness that six other dimensions already carry. The
    forbidden normalisation is the one that rescales a whole TRACK against
    itself, erasing how it compares to other tracks. This one erases nothing:
    every frame keeps its place in the corpus.
    """
    c = chroma_filterbank() @ magnitude_block.T          # (12, block)
    peak = c.max(axis=0)
    return c / np.where(peak > 0.0, peak, 1.0)


# ── The linear-spectrum shape descriptors ───────────────────────────────────────
def spectral_shape(magnitude, freqs):
    """Centroid, bandwidth, rolloff and flatness, one value per frame.

    Four numbers that between them describe the *shape* of a spectrum without
    describing its contents — where its mass sits, how spread out it is, where
    its top end stops, and whether it is a tone or a hiss.

    Silent frames are handled without a branch: the guarded denominators make a
    frame of digital silence read as centroid 0, bandwidth 0, rolloff 0 and
    flatness 1. That last one is the mathematically consistent answer (a constant
    spectrum IS maximally flat) rather than a special case, and it matters little
    in practice — real recordings have a noise floor, not digital silence.
    """
    total = magnitude.sum(axis=1)
    live = total > 0.0
    safe = np.where(live, total, 1.0)

    centroid = (magnitude @ freqs) / safe                       # the balance point, in Hz
    deviation = freqs[None, :] - centroid[:, None]
    bandwidth = np.sqrt((magnitude * deviation * deviation).sum(axis=1) / safe)

    # Rolloff: the lowest bin whose cumulative sum crosses the threshold. Counting
    # how many bins fall SHORT is the same answer as searching for the first that
    # does not, without a per-frame searchsorted.
    crossings = (np.cumsum(magnitude, axis=1) < (ROLLOFF_PERCENT * total)[:, None]).sum(axis=1)
    rolloff = freqs[np.minimum(crossings, freqs.size - 1)]

    # Flatness: geometric mean over arithmetic mean of the POWER spectrum. 1 is a
    # flat (noise-like) spectrum, → 0 is a peaky (tonal) one. Computed from
    # magnitude² rather than from `_power_of`'s output so the definition does not
    # move if §8.5 changes config.POWER.
    power = np.maximum(magnitude * magnitude, config.LOG_FLOOR)
    flatness = np.exp(np.log(power).mean(axis=1)) / power.mean(axis=1)

    return (np.where(live, centroid, 0.0),
            np.where(live, bandwidth, 0.0),
            np.where(live, rolloff, 0.0),
            flatness)


def zero_crossing_rate(frames):
    """Sign changes per sample, on the UNWINDOWED frames.

    The cheapest useful noisiness measure there is, and the only feature here
    computed in the time domain — which is why it earns its two dimensions
    despite correlating with flatness: a distorted guitar and a cymbal are both
    "flat", but they cross zero at very different rates.
    """
    return np.diff(np.signbit(frames), axis=1).sum(axis=1) / float(frames.shape[1] - 1)


def rms(frames):
    """Per-frame RMS amplitude, on the UNWINDOWED frames."""
    f = frames.astype(np.float64, copy=False)
    return np.sqrt(np.einsum('ij,ij->i', f, f) / f.shape[1])


# ── Tempo ───────────────────────────────────────────────────────────────────────
def onset_envelope(logmel):
    """Spectral flux: how much energy APPEARED in each frame, summed over bands.

    Positive differences only. A note ending is not an onset, and counting it as
    one would double the apparent event rate of anything staccato.
    """
    if logmel.shape[1] < 2:
        return np.zeros(logmel.shape[1], dtype=np.float64)
    flux = np.maximum(0.0, np.diff(logmel.astype(np.float64), axis=1)).sum(axis=0)
    return np.concatenate([[0.0], flux])


def frames_per_second():
    return config.SR / float(config.HOP)


def tempo(env):
    """(log2 BPM, autocorrelation strength, onsets per second).

    Autocorrelation of the onset envelope: at the lag matching one beat, the
    envelope lines up with itself, so the correlation peaks there.

    ⚠️ **METRICAL HARMONICS ARE THE FAILURE MODE, AND §8.2 ALREADY SAW ONE** — a
    punk track measured 185 BPM when the beat was near 92, because a signal that
    correlates with itself at one beat also correlates at half a beat and at two.
    Autocorrelation cannot break that tie; nothing in the signal does. The
    mitigation is a **log-normal prior centred at 120 BPM**, one octave of tempo
    wide, which is the standard trick and expresses the plain fact that a
    perceived tempo of 185 is much rarer than one of 92. It shifts the odds; it
    does not remove the ambiguity, and no amount of tuning here will.

    Which is why the third value exists. `onset_rate` counts events per second
    directly, so it is **immune to the octave question** — 92 and 185 disagree
    about the beat but agree about how much is happening. Stored as a companion
    on purpose, so a whole tempo dimension being wrong costs one dimension of
    119 rather than the track's whole rhythmic character.

    log2 of BPM rather than BPM, because tempo is heard multiplicatively: 60→120
    and 120→240 are the same interval, and a linear BPM axis would make the
    second look twice as far. It also puts an octave error at a constant ±1.
    """
    fps = frames_per_second()
    n = env.size
    lag_lo = max(1, int(round(60.0 * fps / TEMPO_MAX_BPM)))
    lag_hi = int(round(60.0 * fps / TEMPO_MIN_BPM))
    duration = n / fps

    peaks = 0
    if n >= 3:
        threshold = env.mean() + env.std()
        interior = env[1:-1]
        peaks = int((((interior > env[:-2]) & (interior >= env[2:])) & (interior > threshold)).sum())
    onset_rate = peaks / duration if duration > 0 else 0.0

    if n <= lag_hi + 1 or not np.any(env):
        # Too short to see the slowest tempo, or no onsets at all. The prior's
        # centre is the honest answer — an unmeasured tempo, not a measured 0.
        return np.log2(TEMPO_PRIOR_BPM), 0.0, onset_rate

    detrended = env - env.mean()
    size = 1 << int(np.ceil(np.log2(2 * n)))
    spectrum = np.fft.rfft(detrended, size)
    ac = np.fft.irfft(spectrum * np.conj(spectrum), size)[:lag_hi + 1]
    if ac[0] <= 0:
        return np.log2(TEMPO_PRIOR_BPM), 0.0, onset_rate
    ac = ac / ac[0]

    lags = np.arange(lag_lo, lag_hi + 1)
    bpms = 60.0 * fps / lags
    prior = np.exp(-0.5 * (np.log2(bpms / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES) ** 2)
    best = int(np.argmax(ac[lag_lo:lag_hi + 1] * prior))
    return float(np.log2(bpms[best])), float(ac[lags[best]]), onset_rate


# ── The one pass ────────────────────────────────────────────────────────────────
def describe_parts(x):
    """Every named block of the descriptor, from ONE traversal of the signal.

    The loop below is the whole reason `mel.iter_blocks` exists: the time-domain
    features want the raw frames, the shape features and chroma want the linear
    magnitude spectrum, and MFCC and the onset envelope want the mel projection.
    All three come out of the same framing and the same FFT, so they cannot
    disagree about where a frame starts, and the FFT is paid for once.
    """
    x = np.asarray(x, dtype=np.float32)
    freqs = mel.fft_frequencies().astype(np.float64)
    fb = mel.mel_filterbank()

    mels, chromas = [], []
    centroid, bandwidth, rolloff, flatness, zcr, amplitude = [], [], [], [], [], []

    for _start, frames_block, power in mel.iter_blocks(x):
        magnitude = mel.magnitude_of(power)             # (block, n_freqs)
        mels.append((fb @ power.T).astype(np.float32))
        chromas.append(chroma(magnitude).astype(np.float32))
        c, b, r, f = spectral_shape(magnitude, freqs)
        centroid.append(c); bandwidth.append(b); rolloff.append(r); flatness.append(f)
        zcr.append(zero_crossing_rate(frames_block))
        amplitude.append(rms(frames_block))

    if not mels or sum(m.shape[1] for m in mels) < MIN_FRAMES:
        raise DescriptorError(
            f'{len(x)} samples is under {MIN_FRAMES} analysis frames — too short '
            f'to take statistics over'
        )

    logmel = mel.apply_log(np.concatenate(mels, axis=1))
    chroma_t = np.concatenate(chromas, axis=1)
    shape = np.stack([
        np.concatenate(centroid), np.concatenate(bandwidth), np.concatenate(rolloff),
        np.concatenate(flatness), np.concatenate(zcr),
        mel.apply_log(np.concatenate(amplitude)),
    ])

    coefficients = mfcc(logmel)
    # First difference along time: how fast the timbre is moving. A sustained pad
    # and a chopped sample can share an average spectrum and share nothing else.
    deltas = (np.diff(coefficients, axis=1) if coefficients.shape[1] > 1
              else np.zeros((N_MFCC, 1), dtype=np.float32))

    return {
        'mfcc_mean': coefficients.mean(axis=1), 'mfcc_std': coefficients.std(axis=1),
        'dmfcc_mean': deltas.mean(axis=1), 'dmfcc_std': deltas.std(axis=1),
        'chroma_mean': chroma_t.mean(axis=1), 'chroma_std': chroma_t.std(axis=1),
        'shape_mean': shape.mean(axis=1), 'shape_std': shape.std(axis=1),
        'tempo': np.asarray(tempo(onset_envelope(logmel))),
    }


def describe(x):
    """THE ARTIFACT: one raw (DIM,) float32 descriptor for one decoded signal.

    RAW — unnormalised, by the rule at the top of this file. `CorpusStats` is
    what makes these comparable, and it is applied on the way out of the index.
    """
    parts = describe_parts(x)
    if tuple(parts) != tuple(name for name, _ in LAYOUT):
        raise AssertionError(
            f'describe_parts built {tuple(parts)} but LAYOUT declares '
            f'{tuple(n for n, _ in LAYOUT)} — the names and the numbers have drifted'
        )
    out = []
    for name, count in LAYOUT:
        block = np.asarray(parts[name], dtype=np.float32).ravel()
        if block.size != count:
            raise AssertionError(f'{name} is {block.size} wide, LAYOUT says {count}')
        out.append(block)
    vector = np.concatenate(out).astype(np.float32)
    if not np.all(np.isfinite(vector)):
        bad = [feature_names()[i] for i in np.nonzero(~np.isfinite(vector))[0]]
        raise DescriptorError(f'non-finite descriptor dimensions: {bad[:8]}')
    return vector


def describe_file(path):
    """`(vector, duration_seconds)` for one audio file."""
    import audio
    signal = audio.decode(path)
    return describe(signal), audio.duration_of(signal)


# ── The corpus z-score ──────────────────────────────────────────────────────────
class CorpusStats:
    """Per-dimension mean and standard deviation OVER THE WHOLE CORPUS.

    The 119 dimensions are in wildly different units — a centroid is thousands of
    Hz, a chroma value is at most 1, MFCC coefficient 0 is tens. Cosine distance
    over that raw vector is a distance dominated entirely by whichever dimension
    happens to have the largest numbers, and it would rank tracks by spectral
    centroid with 118 dimensions along for the ride. The z-score is what makes
    every dimension worth the same, which is the minimum condition for the
    distance to mean anything.

    ⚠️ There is deliberately **no way to build one of these from a single track.**
    `fit` refuses fewer than MIN_FIT_ROWS rows, and nothing else constructs one
    except `load`, which reads a fit that already happened. That refusal is the
    module's central warning made mechanical.
    """

    def __init__(self, mean, std, n_fit=0, version=DESCRIPTOR_VERSION, degenerate=()):
        self.mean = np.asarray(mean, dtype=np.float32)
        self.std = np.asarray(std, dtype=np.float32)
        self.n_fit = int(n_fit)
        self.version = int(version)
        # Dimensions that were constant across the corpus and had their std
        # substituted. Carried rather than merely handled: a dimension that never
        # varies contributes nothing to any distance, and several appearing at
        # once means a FEATURE is broken — stuck at a default, or a guard firing
        # on every track — rather than merely uninformative. `--gate` prints them.
        self.degenerate = tuple(int(i) for i in degenerate)
        if self.mean.shape != self.std.shape or self.mean.ndim != 1:
            raise ValueError(f'mean {self.mean.shape} and std {self.std.shape} must be one 1-D pair')

    @property
    def dim(self):
        return int(self.mean.size)

    def degenerate_names(self):
        names = feature_names()
        return [names[i] if i < len(names) else str(i) for i in self.degenerate]

    @classmethod
    def fit(cls, matrix):
        """Fit over an (N, DIM) matrix of RAW descriptors."""
        matrix = np.asarray(matrix, dtype=np.float32)
        if matrix.ndim != 2:
            raise ValueError(f'expected an (N, dim) matrix, got shape {matrix.shape}')
        if matrix.shape[0] < MIN_FIT_ROWS:
            raise ValueError(
                f'refusing to fit corpus statistics over {matrix.shape[0]} track(s); '
                f'{MIN_FIT_ROWS} is the floor. A z-score fitted on a handful of tracks '
                f'is a per-track normalisation wearing a corpus costume, and that is '
                f'the one thing this module exists to prevent (ToDo §8.4).'
            )
        mean = matrix.mean(axis=0)
        std = matrix.std(axis=0)
        # ⚠️ A dimension that is constant across the corpus has std 0, and dividing
        # by it yields inf or NaN — which propagates through the whole matmul at
        # §8.7 and poisons every similarity, not just that dimension's. Substitute
        # 1: the centred value is already 0, so the dimension simply contributes
        # nothing instead of destroying everything.
        flat = std < ZERO_STD
        return cls(mean, np.where(flat, np.float32(1.0), std), n_fit=matrix.shape[0],
                   degenerate=np.nonzero(flat)[0])

    def apply(self, matrix):
        """z-score an (N, DIM) matrix — or a single (DIM,) vector against the
        corpus, which is the whole point of storing the fit."""
        arr = np.asarray(matrix, dtype=np.float32)
        if arr.shape[-1] != self.dim:
            raise ValueError(f'expected {self.dim} dimensions, got {arr.shape[-1]}')
        return ((arr - self.mean) / self.std).astype(np.float32)

    # ── persistence, in `meta` ──────────────────────────────────────────────────
    # base64 of the float32 bytes, because `meta.value` is TEXT and a float
    # round-tripped through decimal text is a vector that is nearly the one that
    # was fitted.
    def save(self, conn):
        index.set_meta(conn, 'descriptor_mean', _b64(self.mean))
        index.set_meta(conn, 'descriptor_std', _b64(self.std))
        index.set_meta(conn, 'descriptor_n_fit', self.n_fit)
        index.set_meta(conn, 'descriptor_version', self.version)
        index.set_meta(conn, 'descriptor_degenerate', ','.join(str(i) for i in self.degenerate))

    @classmethod
    def load(cls, conn):
        mean = index.get_meta(conn, 'descriptor_mean')
        std = index.get_meta(conn, 'descriptor_std')
        if mean is None or std is None:
            return None
        flat = index.get_meta(conn, 'descriptor_degenerate', '')
        return cls(
            _unb64(mean), _unb64(std),
            n_fit=int(index.get_meta(conn, 'descriptor_n_fit', 0)),
            version=int(index.get_meta(conn, 'descriptor_version', DESCRIPTOR_VERSION)),
            degenerate=[int(i) for i in flat.split(',') if i.strip()],
        )


def _b64(vec):
    return base64.b64encode(index.to_blob(np.asarray(vec, dtype=np.float32))).decode('ascii')


def _unb64(text):
    return index.from_blob(base64.b64decode(text.encode('ascii')))


def fit_corpus(conn):
    """Fit the corpus statistics over everything in `descriptors` and store them."""
    matrix, _paths, _ids = index.load_matrix(conn, 'descriptors')
    stats = CorpusStats.fit(matrix)
    stats.save(conn)
    conn.commit()
    return stats


def load_normalised(conn, refit=False):
    """`(matrix, paths, ids, stats)` — every descriptor, z-scored and L2-normalised.

    L2 on top of the z-score so that §8.7's `M @ q` IS the cosine similarity, with
    no per-query division. Same contract the neural arm will present, so `query.py`
    can hold both arms in one hand.

    ⚠️ A table holding fewer than `MIN_FIT_ROWS` descriptors and no stored fit
    raises `DescriptorError`, not `CorpusStats.fit`'s `ValueError`. The refusal
    itself is right and stays — but it is a normal state for anyone five minutes
    into their first `--build`, and greeting them with a raw traceback from three
    frames down reads as a broken program rather than as "describe a few more".
    `fit`'s ValueError is still what an API misuse gets; this is the same fact
    arriving through the door a person actually walks through.
    """
    matrix, paths, ids = index.load_matrix(conn, 'descriptors')
    if not len(matrix):
        return matrix, paths, ids, None
    stats = None if refit else CorpusStats.load(conn)
    if (stats is None or stats.dim != matrix.shape[1]) and len(matrix) < MIN_FIT_ROWS:
        raise DescriptorError(
            f'{len(matrix)} descriptor(s) in the index, and the corpus z-score needs '
            f'at least {MIN_FIT_ROWS} to be a corpus statistic rather than a per-track '
            f'one (see the warning at the top of this module). Describe more first: '
            f'`descriptors.py --build --limit 50`.')
    if stats is None or stats.dim != matrix.shape[1]:
        stats = fit_corpus(conn)
    z = stats.apply(matrix)
    norms = np.linalg.norm(z, axis=1, keepdims=True)
    return (z / np.where(norms > 0, norms, 1.0)).astype(np.float32), paths, ids, stats


# ── Filling the table ───────────────────────────────────────────────────────────
# §8.6 builds the real backfill, for the neural arm, with a serial ONNX session at
# its centre. This is the same shape at a smaller size, and it exists because the
# gate below needs rows to read. Two properties are kept even at this size because
# they are the ones that are painful to add later:
#
#   * RESUMABLE FROM THE FIRST COMMIT (Trap 17). The work queue is
#     `index.pending('descriptors')`, a LEFT JOIN — progress is the absence of a
#     join partner, not a counter. One commit per track, so Ctrl-C at any moment
#     loses at most the track in flight.
#   * FAILURES ARE DATA. A corrupt file marks its own row and the batch continues.
#
# Threads, not processes: `subprocess` releases the GIL while ffmpeg reads over
# the wire, and numpy releases it inside the FFT and the matmuls, so the two parts
# that cost anything both parallelise. The SQLite connection stays on the main
# thread and is the only writer.
DEFAULT_WORKERS = 8
MIN_ALBUM_TRACKS = 4


# ⚠️ **THE SHELF IS NOT UNIFORMLY THREE LEVELS DEEP, AND §8.7 FOUND OUT THE HARD
# WAY.** 1,131 of the 15,326 files — 7.4%, every one of them a multi-disc release —
# sit at `<artist>/<album>/Disc N/<title>.flac`. Read naively, `Disc 1` becomes the
# ALBUM and the album title becomes the ARTIST, so a deluxe edition is a different
# band from the record it is a deluxe edition of, and its tracks can never match
# the rest of that artist's catalogue. The symptom is not an error; it is a
# same-artist rate quietly a few points low for BOTH arms at once, which is
# exactly the kind of thing a comparison hides by affecting it evenly.
#
# It surfaced from `query.duplicate_audit`: 184 nearest-neighbour pairs sat at
# cosine 1.00000 while the path claimed they were different songs — `Crash Love`
# and `Crash Love (Deluxe)/Disc 1`, the identical master filed twice.
DISC_DIR = __import__('re').compile(r'^(disc|disk|cd|vol|volume)[\s._-]*\d+$', __import__('re').I)


def album_of(path):
    """The album a track belongs to — its parent directory, disc folders folded in.

    The directory IS the grouping. No tags are read: an ID3 pass would be a
    second source of truth about which tracks belong together, and the gate below
    would then be testing the tags as much as the descriptors.

    A `Disc 2` directory is folded into its parent because disc two of a record
    is not a second record — splitting it would report a true album-mate as a
    miss for both arms.
    """
    parent = os.path.dirname(path)
    return os.path.dirname(parent) if DISC_DIR.match(os.path.basename(parent)) else parent


# The library root's own directory NAME, matched case-insensitively so the
# workstation's `…/Plex/Music` and a container's `/music` both answer to it.
# Compared by name rather than by full path because `artist_of` is handed paths
# from whichever side is asking, and only the segments BELOW the root are a
# thing the two agree on (KourOS `src/discover/vectors.js`, ToDo §8.8).
def _root_name():
    # Read at CALL time, never captured as a default argument — `config.LIBRARY_ROOT`
    # is overridable and this module has already been bitten three times by a
    # default that froze a module constant at import (see `index.connect`).
    return os.path.basename(os.path.normpath(config.LIBRARY_ROOT))


def artist_of(path, root_name=None):
    """The artist a track belongs to, as a NAME — not a path.

    ⚠️ **THIS USED TO BE `os.path.dirname(album_of(path))`, AND THAT IS ONLY
    RIGHT FOR A NESTED LIBRARY.** The shelf carries both layouts at once:

        nested  <root>/<Artist>/<Album> (year)/07. Title.flac
        flat    <root>/<Artist> - <Album> (year) [FLAC]/07. Artist - Title.flac

    For a flat album the parent of the album folder IS THE LIBRARY ROOT, so the
    old reader answered `/mnt/Luna/Plex/Music` for every one of them — measured
    on the final library, **10,771 tracks (22.7%) collapsed into a single fake
    artist**. Nothing errors. The gate's same-artist rate is then computed over a
    22%-of-the-library bucket, and `query.fit_calibration`'s stranger pool — the
    spread KourOS divides every served cosine by — silently excludes every pair
    inside it. A plausible number, from a grouping that means nothing.

    ⚠️ **THE DIRECTORY WINS OVER THE `<Artist> - ` PREFIX, NOT THE OTHER WAY
    ROUND.** Reading the prefix first is the obvious port of the KourOS content
    key, and it is wrong here: 494 nested tracks live in album folders whose
    TITLE contains a hyphen — `Taking Back Sunday/Live From Orensanz (Live From
    Orensanz, New York, NY - 2009)` — and prefix-first credits them to an artist
    named after half an album title. A parent directory below the root is an
    unambiguous statement about the artist; the prefix is a guess that is only
    needed when there is no such directory.

    Returning a name rather than a path is what lets the two spellings of one
    artist unify: 125 artists on this shelf have some albums filed flat and some
    nested, and as paths those are two different artists.
    """
    root = (root_name or _root_name()).lower()
    album = album_of(path)
    parent = os.path.basename(os.path.dirname(album))
    if parent and parent.lower() != root:
        return parent
    name = os.path.basename(album)
    return name.split(' - ')[0].strip() if ' - ' in name else name


# The same circuit breaker the neural run carries, for the same reason and with
# the same number — see `backfill.ABORT_AFTER`, which is where the reasoning is
# written down, and `scan.library_reachable`, which is the check both arms share.
# This arm reads the same shelf over the same CIFS mount and writes the same
# `tracks.status`, so a dropped mount here poisons the queue for BOTH arms.
ABORT_AFTER = 25


def build(conn, rows, workers=DEFAULT_WORKERS, progress=None):
    """Describe every track in `rows`, committing one at a time.

    Returns `(n_ok, n_failed)`; `build.aborted` is not a thing — a systemic stop
    raises `DescriptorError` here, because unlike §8.6's three-hour run this one
    is minutes and has no summary worth preserving past the message.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor

    import scan

    stopping = threading.Event()

    def work(row):
        if stopping.is_set():
            # Cancelled futures cover most of the queue, but the ones already
            # running are not cancellable — this keeps them from spending a
            # network read each on a run that has already decided to stop.
            return row, None, None, None
        try:
            vector, duration = describe_file(row['path'])
            return row, vector, duration, None
        except Exception as exc:                      # DecodeError, DescriptorError, OSError
            return row, None, None, exc

    started, done, failed, bytes_read = time.time(), 0, 0, 0
    consecutive, abort = 0, None
    with ThreadPoolExecutor(max_workers=max(1, int(workers))) as pool:
        for row, vector, duration, error in pool.map(work, rows):
            if stopping.is_set():
                continue                              # drain, do not record
            if error is None and vector is None:
                continue                              # skipped by the stop flag
            if error is None:
                index.put_descriptor(conn, row['id'], vector, version=DESCRIPTOR_VERSION)
                index.mark_ok(conn, row['id'], duration=duration)
                done += 1
                bytes_read += row['size'] or 0
                consecutive = 0
            elif not scan.library_reachable():
                abort = (f'the library root {config.LIBRARY_ROOT} is not reachable — '
                         f'stopped rather than marking the rest of the queue failed '
                         f'for a fault that is not theirs. Remount and re-run.')
                stopping.set()
                conn.commit()
                continue
            else:
                index.mark_failed(conn, row['id'], error)
                failed += 1
                consecutive += 1
            conn.commit()                             # per track — Trap 17
            if consecutive >= ABORT_AFTER:
                abort = (f'{consecutive} failures in a row with no success between '
                         f'them — systemic, not {consecutive} bad files. Read them '
                         f'with `backfill.py --failures`.')
                stopping.set()
                continue
            if progress:
                elapsed = max(time.time() - started, 1e-6)
                progress(done, failed, len(rows), done / elapsed, bytes_read / elapsed / 1e6)
    if abort:
        raise DescriptorError(f'{abort} ({done} described, {failed} failed before the stop)')
    return done, failed


def select_albums(conn, n_albums, min_tracks=MIN_ALBUM_TRACKS, per_artist=1):
    """`n_albums` COMPLETE albums, spread across the shelf. Deterministic.

    Spread rather than the first N: the tracks table is ordered by path, so the
    first N albums are the first two or three artists in the alphabet, and a gate
    run on three artists measures far less than one run on twenty. Evenly-spaced
    indices over the sorted album list cost nothing and sample the whole library.

    ⚠️ `per_artist` is what makes the gate's MIDDLE row measurable. At the default
    of 1 the selection takes one album per artist, so "same artist, other album"
    has no pairs at all — the gate then reports two categories out of three and
    cannot see the case that actually distinguishes a good space from a lucky
    one: album-mates share a mastering, so clustering them is nearly free, while
    clustering an artist ACROSS albums means the descriptors found the band
    rather than the session. Raise it to 2 or 3 to buy that row.
    """
    rows = conn.execute('SELECT id, path, size FROM tracks ORDER BY path').fetchall()
    albums = {}
    for row in rows:
        albums.setdefault(album_of(row['path']), []).append(row)
    usable = [k for k in sorted(albums) if len(albums[k]) >= min_tracks]
    if not usable:
        return []

    by_artist = {}
    for name in usable:
        by_artist.setdefault(artist_of(albums[name][0]['path']), []).append(name)
    # Keep only artists that can actually supply the quota, so asking for 3 albums
    # each does not silently degrade into a handful of artists contributing one.
    eligible = sorted(a for a, names in by_artist.items() if len(names) >= per_artist)
    if not eligible:
        eligible = sorted(by_artist)

    wanted_artists = max(1, -(-n_albums // max(1, per_artist)))
    if wanted_artists >= len(eligible):
        chosen_artists = eligible
    else:
        step = len(eligible) / float(wanted_artists)
        chosen_artists = [eligible[int(i * step)] for i in range(wanted_artists)]

    chosen = []
    for artist in chosen_artists:
        chosen += by_artist[artist][:per_artist]
    return [row for name in chosen[:n_albums] for row in albums[name]]


# ── The sanity gate ─────────────────────────────────────────────────────────────
# ToDo §8.4: "two tracks from one album should sit closer than two random tracks."
# A gate that needs no encoder, which is the point — it says whether the DESCRIPTOR
# arm is sound before there is anything to compare it against, so a failure at M4
# cannot be blamed on a baseline nobody ever checked.
#
# It is deliberately weak as a claim about music and strong as a claim about
# plumbing. Album-mates share a mastering engineer, a room, a band and usually a
# tempo range, so if the descriptors cannot see that, they are not measuring the
# audio at all — a framing bug, a normalisation bug, or a vector written to the
# wrong row. Passing does NOT mean the features are good; it means they are real.
def similarity_report(matrix, paths, pairs=200000, seed=0):
    """Mean cosine within an album, within an artist, and across the library —
    plus the nearest-neighbour rates §8.7 will want for both arms.
    """
    n = len(paths)
    if n < 4:
        raise DescriptorError(f'{n} tracks is not enough to compare — build more first')
    albums = np.array([album_of(p) for p in paths])
    artists = np.array([artist_of(p) for p in paths])

    rng = np.random.RandomState(seed)
    i = rng.randint(0, n, size=pairs)
    j = rng.randint(0, n, size=pairs)
    keep = i != j
    i, j = i[keep], j[keep]
    cosine = np.einsum('ij,ij->i', matrix[i], matrix[j])

    same_album = albums[i] == albums[j]
    same_artist = (artists[i] == artists[j]) & ~same_album
    other = ~(same_album | (artists[i] == artists[j]))

    def summarise(mask):
        values = cosine[mask]
        return (float(values.mean()), float(values.std()), int(values.size)) if values.size else (float('nan'), float('nan'), 0)

    # Nearest neighbour, excluding self. The whole matrix at once: 15,326² floats
    # would be 940 MB, so this is chunked — the same brute-force-is-fine argument
    # as §8.7, one order of magnitude up because it is every query at once.
    nn = np.empty(n, dtype=np.int64)
    for start in range(0, n, 512):
        block = matrix[start:start + 512] @ matrix.T
        np.fill_diagonal(block[:, start:start + block.shape[0]], -np.inf)
        nn[start:start + block.shape[0]] = block.argmax(axis=1)

    return {
        'n_tracks': n,
        'n_albums': int(len(set(albums))),
        'n_artists': int(len(set(artists))),
        'same_album': summarise(same_album),
        'same_artist': summarise(same_artist),
        'different': summarise(other),
        'nn_same_album': float((albums[nn] == albums).mean()),
        'nn_same_artist': float((artists[nn] == artists).mean()),
        # What a coin flip would score, given how the library is shaped. Without
        # it "62% of neighbours share an album" is a number with no scale: on a
        # corpus of four albums it would be unremarkable.
        'chance_album': chance_rate(albums),
        'chance_artist': chance_rate(artists),
    }


def chance_rate(labels):
    """The probability that a uniformly-random OTHER track shares your label.

    Weighted by group size rather than averaged over groups: a track on a
    20-track album has more album-mates to find than one on a 2-track EP, and
    the baseline has to describe the same population the measurement does.
    """
    _values, inverse, counts = np.unique(labels, return_inverse=True, return_counts=True)
    return float(np.mean(counts[inverse] - 1) / max(len(labels) - 1, 1))


def gate(conn, stream=None):
    """Run the §8.4 sanity gate and print the verdict. True if it passes."""
    import sys
    out = stream or sys.stdout
    try:
        matrix, paths, _ids, stats = load_normalised(conn)
    except DescriptorError as exc:
        # Too few rows to fit the corpus. Not a failed gate — an unrun one.
        print(f'{exc}', file=out)
        return False
    if not len(matrix):
        print('no descriptors in the index — run --build first', file=out)
        return False
    if len(matrix) < 4:
        print(f'{len(matrix)} descriptors is not enough to compare — run --build first',
              file=out)
        return False

    report = similarity_report(matrix, paths)
    album_mean = report['same_album'][0]
    artist_mean = report['same_artist'][0]
    other_mean = report['different'][0]

    print(f'{report["n_tracks"]} tracks · {report["n_albums"]} albums · '
          f'{report["n_artists"]} artists · {matrix.shape[1]} dims', file=out)
    print(f'corpus fit over {stats.n_fit} tracks'
          + (f', {len(stats.degenerate)} degenerate dim(s): {stats.degenerate_names()}'
             if stats.degenerate else ', no degenerate dimensions'), file=out)
    print('', file=out)
    print('  mean cosine similarity', file=out)
    for label, key in (('same album', 'same_album'),
                       ('same artist, other album', 'same_artist'),
                       ('different artist', 'different')):
        mean, std, count = report[key]
        if count:
            print(f'    {label:<26} {mean:+.4f}  ± {std:.4f}   ({count:,} pairs)', file=out)
        else:
            # Not a failure and not a zero. `select_albums` spreads one album per
            # artist by default, so this category can be legitimately EMPTY — and
            # an unmeasured category must not read as a measured nothing.
            print(f'    {label:<26}      —    not measured (no such pairs in this set)',
                  file=out)
    print('', file=out)
    print('  nearest neighbour', file=out)
    print(f'    shares an album            {report["nn_same_album"]:6.1%}   '
          f'(chance {report["chance_album"]:.1%})', file=out)
    print(f'    shares an artist           {report["nn_same_artist"]:6.1%}   '
          f'(chance {report["chance_artist"]:.1%})', file=out)
    print('', file=out)

    # ⚠️ Each condition is skipped when its category has no pairs to measure.
    # An unmeasured category is not a failed one, and `nan > x` is False — which
    # is exactly how this gate first reported FAILED on a set whose descriptors
    # were separating album-mates from strangers by +0.47.
    checks = [album_mean > other_mean] if report['same_album'][2] else []
    if report['same_artist'][2]:
        checks.append(artist_mean > other_mean)
    checks.append(report['nn_same_album'] > report['chance_album'] * 3.0)
    passed = bool(checks) and all(checks)
    print(f'GATE {"PASSED" if passed else "FAILED"} — album-mates sit '
          f'{album_mean - other_mean:+.4f} closer than strangers, and '
          f'{report["nn_same_album"]:.1%} of nearest neighbours share an album '
          f'against {report["chance_album"]:.1%} by chance.', file=out)
    if not passed:
        print('  ⚠️ The descriptors are not seeing the audio. Look upstream — framing, '
              'the corpus fit, or vectors written to the wrong row — before blaming '
              'the features.', file=out)
    return passed


# ── CLI ─────────────────────────────────────────────────────────────────────────
def _main(argv=None):
    import argparse
    import sys

    import audio

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('files', nargs='*', help='describe these files and print the numbers')
    parser.add_argument('--scan', action='store_true', help='walk the library into `tracks`')
    parser.add_argument('--build', action='store_true', help='describe pending tracks')
    parser.add_argument('--albums', type=int, default=0,
                        help='with --build: N complete albums, spread across the shelf')
    parser.add_argument('--per-artist', type=int, default=1,
                        help='albums taken from each artist; >1 makes the gate\'s '
                             '"same artist, other album" row measurable')
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--artist', default=None, help='path fragment filter')
    parser.add_argument('--root', default=None,
                        help='with --scan: walk this directory instead of '
                             'config.LIBRARY_ROOT')
    parser.add_argument('--encoded', action='store_true',
                        help='with --build: only tracks the neural arm already holds — '
                             '§8.7 reads both arms over ONE population or not at all')
    parser.add_argument('--workers', type=int, default=DEFAULT_WORKERS)
    parser.add_argument('--gate', action='store_true', help='run the §8.4 sanity gate')
    parser.add_argument('--refit', action='store_true', help='re-fit the corpus statistics')
    parser.add_argument('--names', action='store_true', help='print the dimension layout')
    args = parser.parse_args(argv)

    if args.names:
        for i, name in enumerate(feature_names()):
            print(f'{i:>4}  {name}')
        print(f'\n{DIM} dimensions, version {DESCRIPTOR_VERSION}')
        return 0

    if args.files:
        bad = 0
        for path in args.files:
            try:
                vector, duration = describe_file(path)
            except (DescriptorError, audio.DecodeError, OSError) as exc:
                # One unreadable file among several is data here too: report it
                # and describe the rest, rather than abandoning the run on the
                # first bad argument.
                print(f'\n{path}\n  {type(exc).__name__}: {exc}', file=sys.stderr)
                bad += 1
                continue
            print(f'\n{path}\n  {duration:.1f}s → {vector.size} dims, '
                  f'range [{vector.min():.2f}, {vector.max():.2f}]')
            names = feature_names()
            for label in ('centroid_mean', 'bandwidth_mean', 'rolloff_mean', 'flatness_mean',
                          'zcr_mean', 'logrms_mean', 'tempo_log2bpm', 'tempo_strength',
                          'onset_rate'):
                k = names.index(label)
                shown = 2.0 ** vector[k] if label == 'tempo_log2bpm' else vector[k]
                print(f'  {label:<16} {shown:10.3f}' + ('  BPM' if label == 'tempo_log2bpm' else ''))
        return 1 if bad == len(args.files) else 0

    conn = index.connect()
    try:
        if args.scan:
            # ⚠️ `--artist` is a path FRAGMENT everywhere else in this CLI, and
            # this branch used to hand it to `scan.scan()` as a directory ROOT —
            # so `--scan --artist "again&again"` did not narrow the scan, it
            # raised NotADirectoryError on a relative path. One flag, two
            # meanings, and the wrong one only visible at the traceback. The
            # fragment now narrows the walk the same way it narrows the queue,
            # and `--root` is the separate thing it was being confused with.
            import time
            started = time.time()
            found = index.ingest_scan(conn, root=args.root)
            if args.artist:
                found = conn.execute(
                    'SELECT COUNT(*) AS n FROM tracks WHERE path LIKE ?',
                    (f'%{args.artist}%',)).fetchone()['n']
                print(f'scanned in {time.time() - started:.1f}s; '
                      f'{found} row(s) match {args.artist!r}', file=sys.stderr)
            else:
                print(f'scanned {found} files in {time.time() - started:.1f}s',
                      file=sys.stderr)

        if args.build:
            if args.albums:
                rows = [r for r in select_albums(conn, args.albums, per_artist=args.per_artist)
                        if index.get_vector(conn, r['id'], 'descriptors') is None]
            else:
                rows = index.pending(conn, 'descriptors', limit=args.limit, artist=args.artist,
                                     having='local_vectors' if args.encoded else None)
            if args.limit:
                rows = rows[:args.limit]
            print(f'{len(rows)} track(s) to describe, {args.workers} workers', file=sys.stderr)

            def report(done, failed, total, rate, mb_s):
                print(f'\r  {done + failed}/{total}  {rate:5.2f} track/s  '
                      f'{mb_s:6.1f} MB/s  {failed} failed', end='', file=sys.stderr)

            done, failed = build(conn, rows, workers=args.workers, progress=report)
            print(f'\n{done} described, {failed} failed', file=sys.stderr)
            if done:
                stats = fit_corpus(conn)
                print(f'corpus fit over {stats.n_fit} tracks', file=sys.stderr)

        if args.refit:
            stats = fit_corpus(conn)
            print(f'refit over {stats.n_fit} tracks, {len(stats.degenerate)} degenerate',
                  file=sys.stderr)

        if args.gate:
            return 0 if gate(conn) else 1

        if not (args.scan or args.build or args.refit):
            print(index.stats(conn))
    except (DescriptorError, audio.DecodeError, index.ConfigDriftError,
            NotADirectoryError) as exc:
        # Every one of these already carries a sentence saying what to do about
        # it. A traceback puts that sentence at the bottom of twelve frames of
        # noise and reads as a crash — which is what an unmounted share, a
        # too-small corpus and a config edit all looked like before this.
        print(f'\n{type(exc).__name__}: {exc}', file=sys.stderr)
        return 1
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(_main())
