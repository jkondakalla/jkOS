#!/usr/bin/env python3
"""M3a — the pretrained encoder, chosen and vendored (ToDo §8.5).

    decode → config.ENCODER profile → log-mel → ONNX → 512-d per window

**`Xenova/larger_clap_music_and_speech`**, revision pinned below. CLAP is a joint
audio–text space: the audio tower and the text tower were trained to put a clip
and its description in the same place, which is why the ToDo notes a query like
*"rainy 3am guitar"* comes free later. Here only the audio tower is used.

WHY THIS ONE, out of the three candidates §8.5 names:

  * **It ships `onnx/audio_model.onnx` already exported.** §8.5 says to prefer a
    published artifact because that removes the export entirely — and with it the
    throwaway PyTorch venv, the opset arguments, the dynamic-axis surprises, and
    the whole class of "the export ran but the graph is subtly not the model".
    Nothing was exported to build this. The file was downloaded.
  * It is the **music-and-speech** checkpoint rather than the general one, which
    is the right half of CLAP's training distribution for a music library.
  * 512 dimensions: 15,326 × 512 float32 is **31 MB**, so §8.7 stays one matmul
    over a matrix that fits in memory several times over (Trap 18).

`torch` is not installed, not imported, and not required — the commitment §8.5
makes explicitly. `requirements.txt` still has two lines.

⚠️ **THIS MODULE IS WHERE TRAP 16 BITES, AND THE ANSWER IS `config.ENCODER`.**
CLAP does not want the baseline's analysis parameters: it wants 48 kHz, 1024-
sample windows, 480-sample hops, 64 SLANEY mels over 50–14000 Hz, and dB
compression. Every one of those is declared in config.py's `ENCODER` profile,
copied line by line from the `preprocessor_config.json` the checkpoint ships —
never guessed, and never inferred from the paper. Feeding this model a mel built
under any other profile returns a confident 512-float vector that is simply
wrong, with no exception and no NaN to notice. Everything below runs inside
`config.using(config.ENCODER)`, and `embed_windows` refuses to run outside it.

⚠️ **THE SLANEY FORK IS THE EASY WAY TO GET THIS WRONG.** CLAP builds *two*
filterbanks and chooses between them by truncation mode — htk/no-norm for
`"fusion"`, slaney/slaney for `"rand_trunc"`. This checkpoint's preprocessor
declares `rand_trunc`, so it is the slaney pair: NOT torchaudio's default, and
not what picking a library default would give you. The two banks differ by a
per-band constant and a different hz↔mel formula, which is invisible in a
picture and fatal to a vector space.
"""
import os

import numpy as np

import config
import mel

# ── The vendored artifact ───────────────────────────────────────────────────────
MODEL_ID = 'Xenova/larger_clap_music_and_speech'
# Pinned to a commit, not to `main`. A model repository is mutable, and "the
# vectors were computed with whatever main was that week" is not a reproducible
# statement. This exact string is stamped into every row of `local_vectors`.
REVISION = 'e9fd5ac1dbf3280936a7fc3ec8a020453ff184db'
MODEL_FILE = 'onnx/audio_model.onnx'
SHA256 = '3ecc72d27740e2a09ced20cf22fd6244122e5e506008763a0f368b3b4ff6eac8'
DIM = 512

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
MODEL_PATH = os.path.join(MODELS_DIR, 'clap_audio_model.onnx')
URL = f'https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{MODEL_FILE}'

# 10-second windows at 50% overlap, per ToDo §8.6 and the checkpoint's
# `chunk_length_s`. The model was trained on 10 s of audio; feeding it more by
# stretching the mel would be feeding it something it has never seen.
WINDOW_SECONDS = 10.0
OVERLAP = 0.5

# ⚠️ **MEASURED, AND IT CONTRADICTS §8.6's WALL-CLOCK ESTIMATE.** On this machine
# (Ryzen 7 5800XT, 8c/16t) one window costs **0.084 s** with the session given 8
# threads — and threads past 8 buy nothing, so the model already saturates the
# CPU and parallel workers cannot rescue it. A four-minute track at 50% overlap
# is 48 windows ≈ **4.0 s of model time**, which over 15,326 tracks is
# **~17 hours**, not the 1.5–3 h §8.6 budgets. Decode is no longer the bottleneck
# at this stage; the model is (which is the one place Trap 19 does NOT apply).
#
# `MAX_WINDOWS` is the lever, and it is left at None here so this module matches
# what §8.6 specifies rather than quietly redefining it. Capping at 12 evenly
# spaced windows still covers the whole track and costs ~4.3 h; at 8, ~2.9 h,
# which is the stated budget. Mean-pooling converges quickly, so the cost of the
# cap is small — but it IS a change to the spec, and §8.6 should make it with
# these numbers in hand rather than inherit it as a default nobody chose.
MAX_WINDOWS = None

# ⚠️ ONE thread for the model, deliberately (Trap 19). §8.6 runs parallel decode
# workers because the wire is the bottleneck; giving the ONNX session 16 threads
# as well oversubscribes the machine and makes both halves slower. Overridable
# for a machine where the model IS the bottleneck, which this one is not.
INTRA_OP_THREADS = int(os.environ.get('MUSIC_ONNX_THREADS', '4'))


class EncoderError(RuntimeError):
    """The encoder could not produce a vector. §8.6's per-track catch, alongside
    `audio.DecodeError` and `descriptors.DescriptorError`."""


def window_samples():
    return int(round(WINDOW_SECONDS * config.SR))


def expected_frames():
    """Mel frames in one window — the model's `height` axis.

    Derived from the profile rather than from the checkpoint's `nb_max_frames`,
    so that if the profile and the model ever disagree the shape check below
    fails loudly instead of the model silently accepting a mis-sized tensor.
    """
    return config.n_frames(window_samples())


# ── The session ─────────────────────────────────────────────────────────────────
_SESSION = None


def available():
    """Whether the encoder can run here — `onnxruntime` importable and weights on
    disk. Everything encoder-shaped skips cleanly when this is False, the same way
    the library-backed checks skip without the mount."""
    if not os.path.exists(MODEL_PATH):
        return False
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        return False
    return True


def session():
    """The ONNX session, built once per process."""
    global _SESSION
    if _SESSION is None:
        try:
            import onnxruntime
        except ImportError as exc:
            raise EncoderError(
                'onnxruntime is not importable. It is line 2 of requirements.txt; '
                'see music/models/README.md for the contained venv this project uses.'
            ) from exc
        if not os.path.exists(MODEL_PATH):
            raise EncoderError(f'{MODEL_PATH} is missing — run `python encoder.py --fetch`')
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = INTRA_OP_THREADS
        options.inter_op_num_threads = 1
        _SESSION = onnxruntime.InferenceSession(
            MODEL_PATH, options, providers=['CPUExecutionProvider'])
    return _SESSION


# ── Windowing ───────────────────────────────────────────────────────────────────
def windows(x):
    """Yield 10-second windows of the signal at 50% overlap.

    A track is minutes long and the model takes ten seconds, so something has to
    decide which ten. Windowing the whole track and mean-pooling (§8.6) uses all
    of it — as against the checkpoint's own `rand_trunc`, which takes ONE random
    crop, because it was built for training where randomness across epochs is the
    point. For indexing, a random crop would make a track's vector depend on a
    coin flip: re-run the backfill and the neighbours change.

    A track shorter than one window is padded by REPEATING it rather than with
    silence — the checkpoint's `"padding": "repeatpad"`. Silence-padding a 4-second
    interlude to 10 seconds would tell the model that 60% of it is silence, which
    is a statement about the padding, not about the music.
    """
    x = np.asarray(x, dtype=np.float32)
    size = window_samples()
    if x.size == 0:
        raise EncoderError('cannot window an empty signal')
    if x.size < size:
        repeats = int(np.ceil(size / x.size))
        yield np.tile(x, repeats)[:size]
        return
    step = max(1, int(round(size * (1.0 - OVERLAP))))
    starts = list(range(0, x.size - size + 1, step))
    # Always include the tail, so the last seconds of a track are not simply
    # dropped when the length is not a whole number of hops.
    if starts[-1] + size < x.size:
        starts.append(x.size - size)
    if MAX_WINDOWS and len(starts) > MAX_WINDOWS:
        # EVENLY SPACED, never the first N: the first N windows of a long track
        # are its intro, and an index built from intros would rank tracks by how
        # they open. Endpoints are kept so the span still covers the whole track.
        picks = np.linspace(0, len(starts) - 1, MAX_WINDOWS)
        starts = [starts[int(round(i))] for i in picks]
    for start in starts:
        yield x[start:start + size]


def input_features(window):
    """One window → the `(1, frames, mels)` tensor the graph names `input_features`.

    The model's axes are (batch, channels, height, width) = (B, 1, frames, mels),
    so the mel matrix is TRANSPOSED out of this project's (mels, frames)
    convention. Getting that backwards yields a tensor of exactly the right total
    size when frames happens to equal mels, and a shape error otherwise — which
    is the good case.
    """
    matrix = mel.logmelspectrogram(window)               # (N_MELS, frames)
    if matrix.shape[0] != config.N_MELS:
        raise EncoderError(f'expected {config.N_MELS} mel bands, got {matrix.shape[0]}')
    return matrix.T[None, :, :].astype(np.float32)       # (1, frames, mels)


def embed_windows(signal, batch_size=8):
    """Every window of `signal` as a (n_windows, DIM) float32 array.

    ⚠️ Refuses to run outside `config.using(config.ENCODER)`. The mel this builds
    is the model's input, so a mel built under any other profile is the exact
    silent corruption Trap 16 names — and "remember to enter the context" is not
    a defence, it is a hope.
    """
    if config.signature() != config.ENCODER.signature():
        raise EncoderError(
            'the active analysis profile is not the encoder profile. Wrap this in '
            '`with config.using(config.ENCODER):` — a mel built under any other '
            'profile makes this model return confident garbage (Trap 16).'
        )
    runner = session()
    out = []
    batch = []

    def flush():
        if not batch:
            return
        tensor = np.concatenate(batch, axis=0)[:, None, :, :]      # (B, 1, frames, mels)
        out.append(runner.run(['audio_embeds'], {'input_features': tensor})[0])
        batch.clear()

    for window in windows(signal):
        batch.append(input_features(window))
        if len(batch) >= batch_size:
            flush()
    flush()
    if not out:
        raise EncoderError('no windows produced an embedding')
    return np.concatenate(out, axis=0).astype(np.float32)


def pool(window_vectors):
    """Mean-pool the windows, then L2-normalise. THE track vector.

    ⚠️ **NORMALISE AFTER POOLING, AND NORMALISE THE WINDOWS FIRST.** Without the
    per-window normalisation a single loud, spectrally extreme window can have a
    much larger norm than the rest and dominate the mean, so the track's vector
    describes its most unusual ten seconds rather than the track. Without the
    final normalisation, §8.7's `M @ q` is not a cosine and longer or busier
    tracks score higher against everything simply for being bigger.

    ⚠️ float32 all the way out. `np.mean` over float32 returns float32 here, but
    a float64 slipping through would be refused at `index.to_blob` — which is
    where that guard was put and why.
    """
    vectors = np.asarray(window_vectors, dtype=np.float32)
    if vectors.ndim != 2 or not vectors.size:
        raise EncoderError(f'expected a (n_windows, dim) array, got shape {vectors.shape}')
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    unit = vectors / np.where(norms > 0, norms, 1.0)
    pooled = unit.mean(axis=0)
    norm = float(np.linalg.norm(pooled))
    if not np.isfinite(norm) or norm == 0.0:
        raise EncoderError('pooled vector has no direction — windows cancelled to zero')
    return (pooled / norm).astype(np.float32)


def embed(signal):
    """One decoded signal → one L2-normalised (DIM,) float32 track vector."""
    with config.using(config.ENCODER):
        vector = pool(embed_windows(signal))
    if vector.size != DIM:
        raise EncoderError(f'expected {DIM} dimensions, got {vector.size}')
    if not np.all(np.isfinite(vector)):
        raise EncoderError('embedding contains non-finite values')
    return vector


def embed_file(path):
    """`(vector, duration_seconds)` for one audio file, decoded at the ENCODER
    profile's sample rate — 48 kHz, not the baseline's 22.05 kHz."""
    import audio
    with config.using(config.ENCODER):
        signal = audio.decode(path, sr=config.SR)
        vector = pool(embed_windows(signal))
        seconds = audio.duration_of(signal, sr=config.SR)
    return vector, seconds


# ── Fetching and verifying ──────────────────────────────────────────────────────
def fetch(force=False):
    """Download the pinned artifact into `models/`. Not committed — 281 MB.

    `urllib` from the stdlib, and the checksum is verified against the constant
    above: the URL pins a commit, but nothing else would notice a truncated
    download, and a truncated ONNX either fails to load or loads as a different
    graph.
    """
    import hashlib
    import urllib.request

    os.makedirs(MODELS_DIR, exist_ok=True)
    if os.path.exists(MODEL_PATH) and not force:
        return MODEL_PATH, verify_checksum()
    with urllib.request.urlopen(URL) as response, open(MODEL_PATH, 'wb') as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
    return MODEL_PATH, verify_checksum()


def verify_checksum():
    import hashlib
    digest = hashlib.sha256()
    with open(MODEL_PATH, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest() == SHA256


def provenance():
    """What gets stamped into `local_vectors` — the answer to 'which model made
    this vector', per row, because §8.5 may well try more than one."""
    return {'model': MODEL_ID, 'revision': REVISION, 'dim': DIM,
            'config_sig': config.ENCODER.signature()}


def _main(argv=None):
    import argparse
    import sys

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('files', nargs='*', help='embed these files')
    parser.add_argument('--fetch', action='store_true', help='download the pinned weights')
    parser.add_argument('--verify', action='store_true', help='run the §8.5 checks')
    args = parser.parse_args(argv)

    if args.fetch:
        path, ok = fetch()
        print(f'{path}\nchecksum {"OK" if ok else "MISMATCH"} ({SHA256})')
        return 0 if ok else 1

    print(f'{MODEL_ID}@{REVISION[:8]}  {DIM}-d  profile {config.ENCODER.signature()}')
    print(f'weights {"present" if os.path.exists(MODEL_PATH) else "MISSING"}, '
          f'runtime {"available" if available() else "UNAVAILABLE"}')
    with config.using(config.ENCODER):
        print(f'window {WINDOW_SECONDS}s @ {config.SR} Hz = {window_samples()} samples '
              f'→ {expected_frames()} frames × {config.N_MELS} mels')

    if args.verify:
        return 0 if verify(args.files or None, stream=sys.stdout) else 1
    if args.files:
        return _embed_each(args.files)
    return 0


# A profile identical to ENCODER except for the mel convention — the single fork
# a reasonable person is most likely to get wrong, since it is the one where the
# library default (torchaudio's htk/None) differs from what this checkpoint's
# preprocessor declares. Used only by `verify()`, to show the model is genuinely
# sensitive to it: if these two profiles produced similar vectors, "we matched
# the convention" would be an untested claim rather than a checked one.
WRONG_MEL = config.Profile(
    'clap-wrong-mel-convention',
    **{**config.ENCODER.values, 'MEL_SCALE': 'htk', 'MEL_NORM': None})


def verify(paths=None, stream=None):
    """§8.5's verification. True if every check passes.

    §8.5 asks for two things — a fixed input gives a stable output, and the
    vector is neither all-zero nor NaN. Both are here, and both are necessary
    rather than sufficient: a completely mis-fed model returns stable, finite,
    unit-norm garbage all day. So three more checks sit alongside them, each
    aimed at a way the Trap 16 mismatch would actually show:

      SPREAD      A mis-scaled input drives a network toward a constant output,
                  so unrelated tracks collapse onto one point. Real embeddings of
                  deliberately unalike music must be spread out.
      STRUCTURE   Two windows of ONE track must be closer to each other than to
                  windows of a different track. This is the cheapest statement
                  that the vectors carry information about the audio at all.
      SENSITIVITY The same audio through the wrong mel convention must give a
                  materially different vector — otherwise matching the convention
                  was untested luck, and the two banks differing by a per-band
                  constant would mean nothing.
    """
    import sys

    import audio
    import ridge

    out = stream or sys.stdout
    paths = paths or ridge.check_set_paths()
    checks = []

    def record(label, ok, detail=''):
        checks.append(ok)
        print(f'  [{"PASS" if ok else "FAIL"}] {label:<38} {detail}', file=out)

    print(f'{MODEL_ID}@{REVISION[:8]}  {DIM}-d  profile {config.ENCODER.signature()}', file=out)
    record('weights checksum', os.path.exists(MODEL_PATH) and verify_checksum(), SHA256[:16] + '…')
    if not available():
        print('  encoder unavailable — nothing further to check', file=out)
        return False

    # A signal that never touches the disk, so stability is checkable with no
    # library mount at all.
    fixed = (0.2 * np.random.RandomState(20260818).randn(48000 * 25)).astype(np.float32)
    first, second = embed(fixed), embed(fixed)
    record('stable across runs', first.tobytes() == second.tobytes(), 'bitwise identical')
    record('finite', bool(np.all(np.isfinite(first))))
    record('not all-zero', bool(np.any(first != 0)),
           f'range [{first.min():+.3f}, {first.max():+.3f}]')
    record('unit norm', abs(float(np.linalg.norm(first)) - 1.0) < 1e-5)

    if not paths:
        print('\n  library not mounted — SPREAD, STRUCTURE and SENSITIVITY skipped', file=out)
        return all(checks)

    print(f'\n  {len(paths)} check-set track(s)', file=out)
    vectors, halves = [], []
    for path in paths:
        with config.using(config.ENCODER):
            signal = audio.decode(path, sr=config.SR)
        vectors.append(embed(signal))
        middle = signal.size // 2
        halves.append((embed(signal[:middle]), embed(signal[middle:])))
        print(f'    {os.path.basename(path)[:52]}', file=out)

    matrix = np.stack(vectors)
    similarity = matrix @ matrix.T
    off_diagonal = similarity[~np.eye(len(paths), dtype=bool)]
    record('SPREAD — unalike tracks do not collapse', float(off_diagonal.max()) < 0.95,
           f'max off-diagonal cosine {float(off_diagonal.max()):+.3f}, '
           f'mean {float(off_diagonal.mean()):+.3f}')

    self_similarity = [float(a @ b) for a, b in halves]
    worst_self = min(self_similarity)
    best_other = float(off_diagonal.max())
    record('STRUCTURE — halves of one track match', worst_self > best_other,
           f'weakest self {worst_self:+.3f} vs strongest cross {best_other:+.3f}')

    with config.using(WRONG_MEL):
        wrong = pool(embed_windows_unchecked(
            audio.decode(paths[0], sr=config.SR)))
    record('SENSITIVITY — wrong mel convention differs', float(wrong @ vectors[0]) < 0.9,
           f'cosine to the correct vector {float(wrong @ vectors[0]):+.3f}')

    print(f'\n{"VERIFIED" if all(checks) else "FAILED"} — {sum(checks)}/{len(checks)} checks',
          file=out)
    return all(checks)


def embed_windows_unchecked(signal, batch_size=8):
    """`embed_windows` without the profile assertion — for `verify()` alone, which
    deliberately runs the model on a WRONG mel to prove it notices. Nothing else
    may use this, which is why the guard lives on the public function."""
    runner = session()
    out, batch = [], []
    for window in windows(signal):
        batch.append(input_features(window))
        if len(batch) >= batch_size:
            tensor = np.concatenate(batch, axis=0)[:, None, :, :]
            out.append(runner.run(['audio_embeds'], {'input_features': tensor})[0])
            batch.clear()
    if batch:
        tensor = np.concatenate(batch, axis=0)[:, None, :, :]
        out.append(runner.run(['audio_embeds'], {'input_features': tensor})[0])
    return np.concatenate(out, axis=0).astype(np.float32)


def _embed_each(paths):
    for path in paths:
        vector, seconds = embed_file(path)
        print(f'{os.path.basename(path)}  {seconds:6.1f}s  '
              f'norm {float(np.linalg.norm(vector)):.4f}  '
              f'range [{vector.min():+.3f}, {vector.max():+.3f}]')
    return 0


if __name__ == '__main__':
    raise SystemExit(_main())
