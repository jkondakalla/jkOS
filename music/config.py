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
import os

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

# ⚠️ **THE HOST PATH AND THE MOUNT PATH ARE NOT THE SAME STRING.** The value above
# is correct on the workstation, where `//192.168.1.108/Luna` is mounted at
# `/mnt/Luna`. On the TrueNAS host itself that same share is the dataset at
# `/mnt/Luna/Luna`, so the library is `/mnt/Luna/Luna/Plex/Music` there — and
# `/mnt/Luna/Plex/Music` is an EMPTY directory docker auto-created as a bind
# source. That is how KourOS came up with a `/music` mount containing nothing:
# not a missing variable, a variable pointing at a real directory that happened
# to be empty. A bind mount does not check that its source has content.

# ── Directories the walk refuses to enter ───────────────────────────────────────
# Matched on the DIRECTORY NAME, at any depth, so one entry retires a whole
# subtree wherever it sits.
#
# `Old (Needs to be trimmed)` is the previous artist-nested rip — 15,326 FLACs,
# the entire population the index was built against before the library was
# re-downloaded flat. Its rows are still in `tracks` and its vectors are still in
# `local_vectors`/`descriptors`: excluding it does not delete anything, it takes
# those rows out of the resume queue (`index.pending`) and stops the walk
# re-discovering them. Deleting this line puts all of it back, which is the
# property "ignore the old folder FOR NOW" actually needs.
#
# Deliberately NOT in `_SIGNIFICANT`, for the same reason LIBRARY_ROOT is not:
# which files you choose to analyse has no bearing on what the numbers mean, and
# putting it in the signature would invalidate a finished backfill the moment the
# shelf is re-scoped.
EXCLUDE_DIRS = ('Old (Needs to be trimmed)',)


def is_excluded(path):
    """Whether `path` lies under any `EXCLUDE_DIRS` directory.

    Splits on the separator rather than testing `in path`: a substring test would
    also match a FILE whose name happens to contain the folder's name, and — more
    to the point — an album legitimately named after an excluded folder would be
    dropped with no error and no count to notice it by.
    """
    if not EXCLUDE_DIRS:
        return False
    parts = set(os.path.normpath(os.fspath(path)).split(os.sep))
    return any(d in parts for d in EXCLUDE_DIRS)


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


# ── Profiles ────────────────────────────────────────────────────────────────────
# §8.5 chose an encoder, and the encoder does not want the parameters above: CLAP
# expects 48 kHz / 1024-sample windows / 480-sample hops / 64 slaney mels over
# 50–14000 Hz / dB compression. The rule at the top of this file offered two ways
# out — the model matches these values, or these values change to match the model
# — and the second one has a cost that only became visible with the numbers in
# hand:
#
#   ⚠️ **CLAP'S STFT MAKES THE §8.4 BASELINE WORSE.** 1024 samples at 48 kHz is a
#   46.9 Hz frequency bin, against 10.8 Hz at the baseline. Chroma can only
#   resolve a semitone above the frequency where a semitone is wider than a bin
#   (`descriptors.chroma_min_hz`), so adopting CLAP's numbers globally moves that
#   floor from 181 Hz to **788 Hz — above most of the melodic range** — and 24 of
#   the baseline's 119 dimensions stop measuring harmony.
#
#   That is not a fair trade, and not because the baseline deserves protection:
#   **M4 judges the encoder AGAINST the baseline, and its stop condition is "if
#   the descriptors win, something upstream is broken."** Handicapping the
#   opponent to suit the contender makes that gate easier to pass, which is
#   precisely the wrong direction for the one check the whole project turns on.
#
# So the answer is neither "one flat set of values" nor "two files each with their
# own idea" — the second being the actual corruption Trap 16 names. It is one
# module holding NAMED, COMPLETE profiles, one per vector space, each stamped onto
# its own rows by its own signature. The invariant that matters is unchanged and
# now enforced per table: everything that feeds a given encoder agrees with that
# encoder. What is gone is only the assumption that there is exactly one encoder.


class Profile:
    """One complete, named analysis configuration.

    COMPLETE, not partial: a profile must answer for every significant parameter,
    and `test_config.py` asserts it. A partial profile would inherit whatever the
    baseline says, so adding a parameter here later would silently change what the
    encoder is fed — a Trap 16 corruption introduced by an edit that looks additive.
    """

    def __init__(self, name, **values):
        missing = set(_SIGNIFICANT) - set(values)
        unknown = set(values) - set(_SIGNIFICANT)
        if missing or unknown:
            raise ValueError(
                f'profile {name!r} must declare exactly the significant parameters; '
                f'missing {sorted(missing)}, unknown {sorted(unknown)}'
            )
        self.name = name
        self.values = dict(values)

    def signature(self):
        return hashlib.sha256(
            ';'.join(f'{k}={self.values[k]!r}' for k in sorted(_SIGNIFICANT))
            .encode('utf-8')
        ).hexdigest()[:12]

    def __repr__(self):
        return f'Profile({self.name!r}, signature={self.signature()})'


# ⚠️ FROZEN AT IMPORT, BEFORE ANY PROFILE CAN BE ENTERED. `baseline()` used to
# read the live globals, and that is wrong in exactly one situation that matters:
# inside `using(ENCODER)`, the live globals ARE the encoder's, so `baseline()`
# returned a profile named "baseline" carrying the encoder's values — with the
# encoder's signature. The nesting guard then compared two identical signatures
# and let the switch through as a harmless re-entry, defeating the one check
# standing between §8.6's worker threads and a silently mixed vector space.
# The baseline is what this file DECLARES, not what happens to be in force.
_BASELINE_VALUES = {k: globals()[k] for k in _SIGNIFICANT}


def baseline():
    """The values written at the top of this file — the §8.4 descriptor arm's
    profile, derived rather than duplicated so the two cannot disagree."""
    return Profile('baseline', **_BASELINE_VALUES)


# The encoder's profile: `Xenova/larger_clap_music_and_speech`, read from the
# `preprocessor_config.json` it ships with — never guessed, never inferred from a
# paper. Each line below has a counterpart in that file.
ENCODER = Profile(
    'clap-music-speech',
    SR=48000,               # sampling_rate
    N_FFT=1024,             # fft_window_size / n_fft
    HOP=480,                # hop_length
    N_MELS=64,              # feature_size
    FMIN=50.0,              # frequency_min
    FMAX=14000.0,           # frequency_max
    WINDOW='hann',          # window_function(..., "hann"), periodic
    # ⚠️ CLAP builds TWO filterbanks and picks between them by truncation mode:
    # htk/no-norm for "fusion", slaney/slaney for "rand_trunc". This checkpoint's
    # preprocessor_config declares `"truncation": "rand_trunc"`, so it is the
    # SLANEY pair — the one that is NOT torchaudio's default, and the one a
    # reasonable person would get wrong by picking the library default.
    MEL_SCALE='slaney',
    MEL_NORM='slaney',
    POWER=2.0,              # spectrogram(..., power=2.0)
    CENTER=True,            # transformers' spectrogram() default
    PAD_MODE='reflect',     # transformers' spectrogram() default
    LOG_MODE='db',          # log_mel="dB" → 10*log10(max(x, amin))
    LOG_FLOOR=1e-10,        # power_to_db's amin
    DTYPE='float32',
)

_ACTIVE = None


def active():
    """The profile currently in force, or the baseline when none is."""
    return _ACTIVE or baseline()


class using:
    """Compute under `profile` for the duration of the block.

    ⚠️ **THIS SWAPS MODULE GLOBALS, SO IT IS PROCESS-WIDE, NOT THREAD-LOCAL.**
    §8.6 runs parallel decode workers, and a worker that read these values while
    another thread had a different profile in force would produce a matrix under
    one configuration and have it stored under another signature — Trap 16 with
    no symptom whatsoever. Two defences, both here rather than in a comment
    somewhere downstream:

      1. Entering a DIFFERENT profile while one is active raises. Two conflicting
         profiles therefore cannot be in force at once, in any thread.
      2. Re-entering the SAME profile is a no-op, so the backfill can wrap its
         whole run once and every worker inside it reads consistent values —
         which is the shape §8.6 must use, and the reason nesting is allowed at all.
    """

    def __init__(self, profile):
        self.profile = profile
        self.saved = None

    def __enter__(self):
        global _ACTIVE
        if _ACTIVE is not None:
            if _ACTIVE.signature() != self.profile.signature():
                raise RuntimeError(
                    f'cannot switch to profile {self.profile.name!r} while '
                    f'{_ACTIVE.name!r} is active — module globals are process-wide, '
                    f'so two profiles in force at once would let one thread compute '
                    f'under configuration A and another store it under B'
                )
            return self.profile                       # same profile: no-op re-entry
        self.saved = {k: globals()[k] for k in _SIGNIFICANT}
        globals().update(self.profile.values)
        _ACTIVE = self.profile
        return self.profile

    def __exit__(self, *exc):
        global _ACTIVE
        if self.saved is not None:
            globals().update(self.saved)
            _ACTIVE = None
        return False


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
