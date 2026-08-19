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

# ⚠️ **THE LEVER §8.5 LEFT FOR §8.6 TO PULL, NOW PULLED AT 12 — AND THE NUMBER
# WAS CHOSEN BY THE ANSWERS IT CHANGES, NOT BY A COSINE.** Uncapped, the median
# track is 41 windows; at 0.058 s of model time each that is 15 hours over 15,326
# tracks, against §8.6's 1.5–3 h budget.
#
# The obvious way to pick a cap is cosine against the all-windows pool, and it is
# the wrong measure: §8.7 reads a RANKING, not a vector. So the cap was measured
# over 71 tracks from 8 complete albums — the closest pairs in the library and
# therefore the ranking most easily disturbed — by whether the capped space
# returns the same neighbours:
#
#     cap   NN agrees   top-5 overlap   NN shares an album   cos to full pool
#       6       0.662           0.789                0.915            0.98301
#       8       0.746           0.839                0.901            0.99130
#      12       0.873           0.899                0.887            0.99716
#      16       0.873           0.952                0.887            0.99882
#     all       1.000           1.000                0.887            1.00000
#
# **The quality column is the flat one.** How often the nearest neighbour shares
# an album — the only column that says whether the answer is any GOOD — does not
# degrade at any cap; at 6 it is nominally higher. What the disagreements are is
# tie-breaking: album-mates sit at mean cosine **+0.868** against +0.443 for
# everything else, so "which album-mate ranks first" flips between two vectors
# that are both defensible estimates of the same track. The full pool is not
# ground truth here; it is simply the uncapped recipe.
#
# 12 buys a 3.4× speedup for a top-5 list that agrees 9 times in 10 and no
# measurable loss of quality. It is the smallest cap where NN agreement reaches
# its plateau. **It changes the vectors, so it is stamped into the index** — see
# `recipe()` and `index.assert_recipe`.
MAX_WINDOWS = 12

# ⚠️ **8, MEASURED — AND 16 IS SLOWER THAN 8 ON A 16-THREAD MACHINE.** Trap 19
# says the wire is the bottleneck and the model should not be given every core;
# §8.5 measured that at this stage the model is the bottleneck instead. Both are
# true, and the number that settles it is the sweep (per-window, 1001×64 input):
#
#     threads    1       2       4       8      16
#     s/window   0.291   0.162   0.094   0.058   0.087
#
# 8 is the knee — it is the physical core count, and the four hyperthread pairs
# past it contend rather than add. That leaves half the machine for §8.6's decode
# readers, which is exactly the split Trap 19 asks for.
INTRA_OP_THREADS = int(os.environ.get('MUSIC_ONNX_THREADS', '8'))

# Windows per session call. Batching buys fewer Python round trips, and it is
# ALMOST noise — but not quite, and not in the direction one would guess:
# 0.058 s/window at batch 1 and at batch 4, **0.066 at batch 8**. A 12-window
# track fed as 8+4 therefore spends ~7% longer in the model than the same track
# fed as 4+4+4, which §8.6 measured end to end as 1.05 against 1.12 track/s. So
# the default is the largest size the runtime still likes, not the largest that
# fits.
#
# It is deliberately NOT part of `recipe()`, and that is checked rather than
# assumed: the same tensor run at batch 1, 4 and 8 comes back **bit-identical**,
# so batching is a speed knob and not a property of the vector space.
BATCH_WINDOWS = 4


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
        try:
            _SESSION = onnxruntime.InferenceSession(
                MODEL_PATH, options, providers=['CPUExecutionProvider'])
        except Exception as exc:
            # onnxruntime raises its own exception family for a graph it cannot
            # parse, and §8.6's per-track catch would happily record "failed" for
            # all 15,326 tracks rather than say the weights are the problem. The
            # likely cause is named in the message because it is the likely
            # cause: a download interrupted before this file was made atomic.
            raise EncoderError(
                f'{MODEL_PATH} would not load as an ONNX graph ({exc}). Verify it '
                f'with `encoder.py --verify`, and re-fetch with '
                f'`encoder.py --fetch --force` if the checksum is wrong.') from exc
    return _SESSION


# ── Windowing ───────────────────────────────────────────────────────────────────
def windows(x, max_windows=None):
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
    cap = MAX_WINDOWS if max_windows is None else int(max_windows)
    if cap < 0:
        # 0 is UNCAPPED and documented as such (`--max-windows 0`); a negative
        # reaches `np.linspace(..., cap)` and dies there with a message about
        # sample counts, several frames away from anything the caller wrote.
        raise EncoderError(f'max_windows must be 0 (uncapped) or more, got {cap}')
    x = np.asarray(x, dtype=np.float32)
    size = window_samples()
    if x.size == 0:
        raise EncoderError('cannot window an empty signal')
    if not np.all(np.isfinite(x)):
        # A non-finite sample survives the mel, the log and the matmul, and comes
        # back from the model as 512 NaNs that `pool` rejects with "windows
        # cancelled to zero" — a true sentence about entirely the wrong thing.
        raise EncoderError('signal contains non-finite samples')
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
    if cap and len(starts) > cap:
        # EVENLY SPACED, never the first N: the first N windows of a long track
        # are its intro, and an index built from intros would rank tracks by how
        # they open. Endpoints are kept so the span still covers the whole track.
        picks = np.linspace(0, len(starts) - 1, cap)
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


def _assert_encoder_profile():
    """⚠️ Refuse to compute outside `config.using(config.ENCODER)`.

    The mel built here IS the model's input, so a mel built under any other
    profile is the exact silent corruption Trap 16 names — a confident, finite,
    unit-norm vector that is simply wrong. "Remember to enter the context" is not
    a defence, it is a hope, so both halves of the pipeline below check.
    """
    if config.signature() != config.ENCODER.signature():
        raise EncoderError(
            'the active analysis profile is not the encoder profile. Wrap this in '
            '`with config.using(config.ENCODER):` — a mel built under any other '
            'profile makes this model return confident garbage (Trap 16).'
        )


# ⚠️ **THE PIPELINE IS SPLIT IN TWO HERE, AND THE SPLIT IS §8.6's WHOLE SHAPE.**
# `window_features` is the parallel half — decode-adjacent, numpy, GIL-releasing,
# and MEASURED at 30 ms per window against the model's 58 ms. Running it on the
# main thread alongside the session costs 33% of the run's wall clock for nothing;
# running it in the decode workers costs nothing at all, because they are idle
# waiting on the wire. `embed_features` is the serial half — one session, one
# thread of control, 8 intra-op threads.
#
# The split is also what bounds memory. A tensor of 12 windows is **3.1 MB**,
# where the decoded signal it came from can be **1.4 GB** (the library's longest
# file is a two-hour, 545 MB FLAC). Handing decoded SIGNALS to a bounded queue
# would put several of those in flight at once; handing over feature tensors
# cannot.
def window_features(signal, max_windows=None):
    """Every window of `signal` as one (n, 1, frames, mels) float32 tensor.

    The model's axes are (batch, channels, height, width), so this is the
    batched form of `input_features` — ready to hand straight to the session.
    """
    _assert_encoder_profile()
    frames = [input_features(w) for w in windows(signal, max_windows=max_windows)]
    if not frames:
        raise EncoderError('no windows to featurise')
    return np.concatenate(frames, axis=0)[:, None, :, :].astype(np.float32)


def _run_batches(tensor, batch_size):
    """Run the session over a (n, 1, frames, mels) tensor in batches of
    `BATCH_WINDOWS`, so a long track under `MAX_WINDOWS=None` never builds one
    enormous activation."""
    runner = session()
    out = []
    for start in range(0, len(tensor), max(1, batch_size)):
        block = tensor[start:start + max(1, batch_size)]
        out.append(runner.run(['audio_embeds'], {'input_features': block})[0])
    if not out:
        raise EncoderError('no windows produced an embedding')
    return np.concatenate(out, axis=0).astype(np.float32)


def embed_features(tensor, batch_size=BATCH_WINDOWS):
    """A prepared feature tensor → (n_windows, DIM) float32. §8.6's serial half."""
    _assert_encoder_profile()
    tensor = np.asarray(tensor, dtype=np.float32)
    if tensor.ndim != 4 or tensor.shape[1] != 1 or tensor.shape[3] != config.N_MELS:
        raise EncoderError(
            f'expected a (n, 1, frames, {config.N_MELS}) tensor, got shape {tensor.shape}')
    return _run_batches(tensor, batch_size)


def embed_windows(signal, batch_size=BATCH_WINDOWS, max_windows=None):
    """Every window of `signal` as a (n_windows, DIM) float32 array."""
    return embed_features(window_features(signal, max_windows=max_windows), batch_size)


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


def embed(signal, max_windows=None):
    """One decoded signal → one L2-normalised (DIM,) float32 track vector."""
    with config.using(config.ENCODER):
        vector = pool(embed_windows(signal, max_windows=max_windows))
    if vector.size != DIM:
        raise EncoderError(f'expected {DIM} dimensions, got {vector.size}')
    if not np.all(np.isfinite(vector)):
        raise EncoderError('embedding contains non-finite values')
    return vector


def embed_file(path, max_windows=None):
    """`(vector, duration_seconds)` for one audio file, decoded at the ENCODER
    profile's sample rate — 48 kHz, not the baseline's 22.05 kHz."""
    import audio
    with config.using(config.ENCODER):
        signal = audio.decode(path, sr=config.SR)
        vector = pool(embed_windows(signal, max_windows=max_windows))
        seconds = audio.duration_of(signal, sr=config.SR)
    return vector, seconds


# ── Fetching and verifying ──────────────────────────────────────────────────────
def fetch(force=False):
    """Download the pinned artifact into `models/`. Not committed — 281 MB.

    `urllib` from the stdlib, and the checksum is verified against the constant
    above: the URL pins a commit, but nothing else would notice a truncated
    download, and a truncated ONNX either fails to load or loads as a different
    graph.

    ⚠️ **DOWNLOADED BESIDE, VERIFIED, THEN RENAMED INTO PLACE.** 281 MB over a
    home connection is a minute or two of exposure to a Ctrl-C, a dropped Wi-Fi
    or a full disk, and the first version streamed straight into `MODEL_PATH` —
    so any of those left a truncated file at exactly the path `available()`
    checks for existence. The next backfill would then report the encoder as
    present, fail somewhere inside onnxruntime, and mark the library failed.
    `os.replace` is atomic within a filesystem, so `MODEL_PATH` either does not
    exist or is a file that passed its checksum, and there is no third state.
    """
    import urllib.request

    os.makedirs(MODELS_DIR, exist_ok=True)
    if os.path.exists(MODEL_PATH) and not force:
        return MODEL_PATH, verify_checksum()

    partial = MODEL_PATH + '.partial'
    try:
        with urllib.request.urlopen(URL) as response, open(partial, 'wb') as handle:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                handle.write(chunk)
        if not verify_checksum(partial):
            raise EncoderError(
                f'the download does not match the pinned checksum {SHA256} — it was '
                f'truncated, or the pin is stale. Left nothing behind; try again.')
        os.replace(partial, MODEL_PATH)
    finally:
        if os.path.exists(partial):
            os.remove(partial)
    return MODEL_PATH, verify_checksum()


def verify_checksum(path=None):
    import hashlib
    digest = hashlib.sha256()
    with open(MODEL_PATH if path is None else path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest() == SHA256


def provenance():
    """What gets stamped into `local_vectors` — the answer to 'which model made
    this vector', per row, because §8.5 may well try more than one."""
    return {'model': MODEL_ID, 'revision': REVISION, 'dim': DIM,
            'config_sig': config.ENCODER.signature(), 'recipe': recipe()}


def recipe(max_windows=None):
    """The pooling policy as one short string, for `index.assert_recipe`.

    ⚠️ **`config.signature()` does not cover this, and it changes the vectors.**
    The profile fingerprints how a mel is built; the window length, the overlap
    and the cap decide which mels a track's vector is the mean OF. Two vectors
    pooled from 12 windows and from 41 sit at cosine ~0.997 — not the "silent and
    total" corruption Trap 16 names, but still two recipes in one space, and the
    kind of difference nobody remembers a year later. So it is recorded where the
    vectors are, and drift raises rather than mixes.
    """
    cap = MAX_WINDOWS if max_windows is None else max_windows
    return (f'{MODEL_ID}@{REVISION[:8]}/w{WINDOW_SECONDS:g}s/ov{OVERLAP:g}/'
            f'max{cap or "none"}/meanpool-l2')


def _main(argv=None):
    import argparse
    import sys

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('files', nargs='*', help='embed these files')
    parser.add_argument('--fetch', action='store_true', help='download the pinned weights')
    parser.add_argument('--force', action='store_true',
                        help='with --fetch: re-download even if the file is there')
    parser.add_argument('--verify', action='store_true', help='run the §8.5 checks')
    args = parser.parse_args(argv)

    if args.fetch:
        try:
            path, ok = fetch(force=args.force)
        except (EncoderError, OSError) as exc:
            print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
            return 1
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


def embed_windows_unchecked(signal, batch_size=BATCH_WINDOWS):
    """`embed_windows` without the profile assertion — for `verify()` alone, which
    deliberately runs the model on a WRONG mel to prove it notices. Nothing else
    may use this, which is why the guard lives on the public functions and this
    one is spelled out in full."""
    frames = [input_features(w) for w in windows(signal)]
    tensor = np.concatenate(frames, axis=0)[:, None, :, :].astype(np.float32)
    return _run_batches(tensor, batch_size)


def _embed_each(paths):
    import sys

    import audio

    bad = 0
    for path in paths:
        try:
            vector, seconds = embed_file(path)
        except (EncoderError, audio.DecodeError, OSError) as exc:
            # Same rule as the batch: one bad argument reports itself and the
            # rest of the list still gets embedded.
            print(f'{os.path.basename(path)}  {type(exc).__name__}: {exc}', file=sys.stderr)
            bad += 1
            continue
        print(f'{os.path.basename(path)}  {seconds:6.1f}s  '
              f'norm {float(np.linalg.norm(vector)):.4f}  '
              f'range [{vector.min():+.3f}, {vector.max():+.3f}]')
    return 1 if bad == len(paths) else 0


if __name__ == '__main__':
    raise SystemExit(_main())
