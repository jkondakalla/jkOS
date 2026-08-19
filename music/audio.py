#!/usr/bin/env python3
"""Decode audio to a numpy array, via an ffmpeg subprocess. No audio library.

ffmpeg decodes a FLAC to raw float32 in ~0.13 s, which is what makes `librosa`
and `soundfile` refusable rather than merely unwanted (ALGORITHMS.md §4, the
dependency budget). The whole decode path is: argv list → `subprocess.run` →
`np.frombuffer`. That is the entire reason `requirements.txt` has room to be two
lines long.

⚠️ TRAP 20 — THE PATHS ARE HOSTILE. The library contains `again&again`,
`Today's Lesson.flac`, `[16B-44.1kHz]`. **Never `shell=True`, anywhere, for any
reason.** Every call in this file passes an argv list, which hands the filename
to the kernel as one opaque argument and gives no shell a chance to see the `&`,
the quote, or the bracket. This bit during the first probe of the library, which
is why it is written at the top of the file rather than in a commit message.

⚠️ FAILURES ARE DATA (§8.6). One corrupt or zero-length FLAC out of 15,326 must
not kill a two-hour backfill, so every failure mode here raises `DecodeError`
specifically — a single exception type the batch loop can catch per track, mark
the row failed, and continue. It deliberately does not raise the underlying
`OSError`/`ValueError` zoo, which a caller would have to enumerate to be safe.
"""
import os
import subprocess

import numpy as np

import config

# ── Binaries ────────────────────────────────────────────────────────────────────
# Overridable for a machine where these are not on PATH; resolved at call time so
# a test can point them elsewhere without reimporting.
FFMPEG = os.environ.get('FFMPEG_BIN', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE_BIN', 'ffprobe')

# A generous ceiling, not a performance knob. Its job is to stop a stalled CIFS
# read from parking a backfill worker forever (Trap 19) — a real decode of the
# longest plausible track is two orders of magnitude under this.
TIMEOUT_S = 300


class DecodeError(RuntimeError):
    """A track could not be decoded. The one exception type §8.6 catches per track."""


def _run(argv, timeout):
    """Run an argv list, capturing both streams. The single subprocess seam.

    `stdin=DEVNULL` and ffmpeg's own `-nostdin` are belt and braces for the same
    hazard: ffmpeg reads stdin for interactive keys by default, and inside a
    batch loop that lets it swallow the parent's input stream.
    """
    try:
        return subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise DecodeError(f'{argv[0]} not found on PATH — is ffmpeg installed?') from exc
    except subprocess.TimeoutExpired as exc:
        raise DecodeError(f'{argv[0]} timed out after {timeout}s: {argv[-1]}') from exc


def _stderr_tail(proc, limit=400):
    return (proc.stderr or b'').decode('utf-8', 'replace').strip()[-limit:]


def decode(path, sr=None, timeout=TIMEOUT_S):
    """Decode any file ffmpeg can read to mono float32 at `sr`.

    ⚠️ `sr=None` means THE RATE IN FORCE AT CALL TIME, read from `config` rather
    than captured in the signature. This used to be `sr=SR` over a
    `from config import SR`, and a default argument is evaluated once, when the
    module is first imported. Import `audio` for the first time from inside
    `with config.using(config.ENCODER):` — which is a two-line edit away, since
    three call sites already import it lazily — and every later baseline decode
    in that process silently runs at 48 kHz while the descriptors analyse it as
    22.05 kHz. That is Trap 16 exactly: no exception, no NaN, a confident wrong
    answer. Resolving the profile at the call is the only version of this that
    cannot be broken from a distance.

    Returns a 1-D `np.float32` array of samples. Downmix to mono and the
    resample both happen inside ffmpeg, so nothing in this repo implements
    either — the array that comes back is already in the analysis domain that
    config.py defines.

    The returned array is a READ-ONLY view over the subprocess output buffer
    (`np.frombuffer` does not copy). That is deliberate: it costs nothing, and
    it makes accidental in-place mutation of what is conceptually the source
    signal fail loudly instead of quietly changing the input to a later stage.
    Callers needing to write should `np.array(x)` or produce a new array, which
    every numpy transform in the pipeline does anyway.

    Raises `DecodeError` on a missing file, an ffmpeg failure, a truncated
    stream, or silence-length output.
    """
    sr = config.SR if sr is None else sr
    path = os.fspath(path)
    argv = [
        FFMPEG, '-v', 'error', '-nostdin',
        '-i', path,                 # argv list, never a shell string — Trap 20.
        '-f', 'f32le',              # raw 32-bit float, little-endian
        '-ac', '1',                 # downmix to mono
        '-ar', str(int(sr)),        # resample to the analysis rate
        '-',                        # to stdout
    ]
    proc = _run(argv, timeout)
    if proc.returncode != 0:
        raise DecodeError(f'ffmpeg failed ({proc.returncode}) on {path}: {_stderr_tail(proc)}')

    raw = proc.stdout or b''
    if not raw:
        raise DecodeError(f'ffmpeg produced no samples for {path}: {_stderr_tail(proc)}')
    if len(raw) % 4 != 0:
        raise DecodeError(f'truncated f32 stream for {path}: {len(raw)} bytes is not a multiple of 4')

    # '<f4' rather than np.float32: `-f f32le` is little-endian by definition, and
    # spelling the endianness out means the array is correct rather than
    # accidentally correct on a little-endian host.
    return np.frombuffer(raw, dtype='<f4')


def probe_duration(path, timeout=TIMEOUT_S):
    """Container-reported duration in seconds, per ffprobe.

    This is the INDEPENDENT witness in the §8.1 gate: it reads the FLAC header's
    own idea of the length, on a path that never goes through `decode`. Checking
    the decoded sample count against it catches a wrong sample rate, a dropped
    channel, and a silently truncated read — the three ways a decode can succeed
    and still be wrong.
    """
    path = os.fspath(path)
    argv = [
        FFPROBE, '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1',
        '-i', path,             # `-i`, not a bare positional: a path beginning
                                # with `-` would otherwise be read as an option.
    ]
    proc = _run(argv, timeout)
    if proc.returncode != 0:
        raise DecodeError(f'ffprobe failed ({proc.returncode}) on {path}: {_stderr_tail(proc)}')
    text = (proc.stdout or b'').decode('utf-8', 'replace').strip()
    try:
        return float(text)
    except ValueError as exc:
        raise DecodeError(f'ffprobe gave no usable duration for {path}: {text!r}') from exc


def duration_of(x, sr=None):
    """Seconds of audio in a decoded array, at the rate in force (see `decode`)."""
    return len(x) / float(config.SR if sr is None else sr)


if __name__ == '__main__':
    import sys

    if len(sys.argv) != 2:
        raise SystemExit('usage: python audio.py <audio-file>')
    target = sys.argv[1]
    samples = decode(target)
    print(f'{len(samples)} samples @ {config.SR} Hz = {duration_of(samples):.3f}s '
          f'(ffprobe says {probe_duration(target):.3f}s), '
          f'peak {float(np.max(np.abs(samples))):.4f}')
