# `music/models/` — the vendored encoder

**Nothing in this directory is committed.** `*.onnx` is gitignored: the audio tower is
281 MB, and a checked-in binary that can be re-fetched byte-identically from a pinned
commit is 281 MB of repository for no information. Everything needed to reproduce it is
here and in [`../encoder.py`](../encoder.py).

```bash
cd music && ./.venv/bin/python encoder.py --fetch     # download + verify the checksum
./.venv/bin/python encoder.py --verify                # the §8.5 checks
```

---

## What is vendored

| | |
|---|---|
| Model | [`Xenova/larger_clap_music_and_speech`](https://huggingface.co/Xenova/larger_clap_music_and_speech) |
| Revision | `e9fd5ac1dbf3280936a7fc3ec8a020453ff184db` — a **commit**, not `main` |
| File | `onnx/audio_model.onnx` → `models/clap_audio_model.onnx` |
| Size | 281,749,092 bytes |
| SHA-256 | `3ecc72d27740e2a09ced20cf22fd6244122e5e506008763a0f368b3b4ff6eac8` |
| Graph | `input_features (B, 1, 1001, 64) float32` → `audio_embeds (B, 512) float32` |

A model repository is mutable. "The vectors were computed with whatever `main` was that
week" is not a reproducible statement, so the revision is pinned to a commit and the
checksum is verified after download — the URL pins the graph, but nothing else would
notice a truncated transfer, and a truncated ONNX either fails to load or loads as a
different model.

## **No export was run.** That is why this checkpoint was chosen

ALGORITHMS.md §4 says to prefer a model with an already-published ONNX artifact, and this one
ships `onnx/audio_model.onnx` directly — so there is no export step, no throwaway PyTorch
venv, no opset arguments, no dynamic-axis surprises, and none of the class of failure
where *the export ran but the exported graph is subtly not the model*.

**`torch` is not installed, not imported, and not required.** `requirements.txt` is still
two lines. If a future checkpoint needs an export, it runs **once**, in a throwaway venv,
documented here — and if it will not export cleanly, the answer is to **change models**.

## Why this one, of §8.5's three candidates

- **CLAP** over PANNs/CNN14 and MERT because it is the only one of the three with a
  maintained, published ONNX export. The other two would each have required the export
  path the budget exists to avoid.
- The **music-and-speech** checkpoint rather than the general one: the right half of
  CLAP's training distribution for a music library.
- CLAP is a **joint audio–text** space, so a text query (*"rainy 3am guitar"*) is a
  second tower away rather than a different project. `onnx/text_model.onnx` is published
  in the same repo, at the same revision — **not fetched yet**; it needs a byte-level BPE
  tokenizer built against the `vocab.json`/`merges.txt` beside it, which is §8.7 work.
- **512 dimensions.** 15,326 × 512 float32 is **31 MB**, so §8.7 stays one matmul over a
  matrix that fits in memory many times over (Trap 18).

## ⚠️ The preprocessing contract is the whole risk

The graph takes a **mel spectrogram**, not audio. Everything about how that mel is built
lives in [`../config.py`](../config.py) as the `ENCODER` profile, transcribed line by
line from the `preprocessor_config.json` this checkpoint ships — never guessed, never
inferred from the paper:

```
48000 Hz · n_fft 1024 · hop 480 · 64 mels · 50–14000 Hz · slaney/slaney · power 2.0 · dB
```

`tests/test_encoder.py` re-asserts every one of those against literals, so the profile
cannot drift from the checkpoint silently.

**The trap that is easiest to walk into:** CLAP builds *two* filterbanks and chooses
between them by truncation mode — `htk`/no-norm for `"fusion"`, `slaney`/`slaney` for
`"rand_trunc"`. This checkpoint declares `rand_trunc`, so it is the **slaney** pair,
which is *not* torchaudio's default and *not* what reaching for a library default gives.
The two differ by a per-band constant and by a different hz↔mel formula. Feeding the
wrong one returns a confident, finite, unit-norm vector that is simply wrong.

That is not an argument, it is measured: `encoder.py --verify` embeds the same track
through both conventions and the vectors sit at cosine **+0.49** — nowhere near each
other, and nothing raises.

## The contained venv

`music/.venv` (gitignored) exists because this host's Python is
[PEP 668](https://peps.python.org/pep-0668/) externally-managed, so `pip install` into
the system interpreter is refused. It is created with `--system-site-packages` so it
reuses the system numpy rather than pulling a second copy:

```bash
cd music
python3 -m venv --system-site-packages .venv
./.venv/bin/pip install -r requirements.txt
```

The suite runs **either way**. Under the system interpreter the encoder tests skip
cleanly — the same convention the library-backed tests use for the missing mount — so
`python -m unittest discover` still needs nothing but numpy and ffmpeg.

## The GPU, which is optional and stays optional

`requirements.txt` is still exactly two lines, and **CPU is the supported
configuration**. What follows is an opt-in install for one workstation, with the
same status the ONNX export tooling has: a build tool, never a dependency.

```bash
cd music
./.venv/bin/pip install "onnxruntime-gpu[cuda,cudnn]"
```

⚠️ `onnxruntime` and `onnxruntime-gpu` **cannot coexist** — they install into the same
`onnxruntime/` package directory, so `pip uninstall onnxruntime` after installing the
GPU wheel deletes shared files and leaves a module with no `get_available_providers`.
Install the GPU wheel *over* the CPU one and leave the CPU one alone, or
`--force-reinstall` to recover.

`encoder.py` negotiates: it asks for `CUDAExecutionProvider` first and falls back to
`CPUExecutionProvider`, filtered against what the installed runtime actually offers, so
a machine with no GPU, no CUDA wheels, or an old driver runs unchanged. Pin the CPU path
with `MUSIC_ONNX_PROVIDER=CPUExecutionProvider` — which is how a CPU-computed vector is
reproduced on a machine that has a GPU.

**Measured on this workstation** (RTX 3080, Ryzen 7 5800XT), per 10 s window:

| provider | batch 1 | batch 4 | batch 12 | batch 24 |
|---|---|---|---|---|
| CPU, 8 threads | 0.070 s | 0.071 s | 0.086 s | 0.098 s |
| CUDA | 0.011 s | 0.005 s | **0.004 s** | 0.004 s |

The two backends want opposite batch sizes — the CPU degrades past 4, the GPU improves
to a whole track at once — so `batch_windows()` picks from the provider **in force**
rather than from a module constant frozen at import.

End to end this takes the model from 75% of a track's wall clock to ~3%, and the
backfill from ~1 track/s to **2.97 track/s at 85.5 MB/s** — which is the CIFS mount's
measured ceiling (85–96 MB/s, Trap 19). The bottleneck is now the wire, so adding
readers past 3 buys nothing and a faster GPU would buy nothing either.

### Two things that are true only because they were measured

**The provider is not part of `recipe()`.** Vectors computed on CPU and on GPU go into
one table and get compared against each other, so a backend that placed tracks
differently would fork the vector space silently — Trap 16, reached through hardware.
Checked over real tracks: worst cosine between the CPU and the CUDA vector for the same
audio is **0.99999982**, max element delta 6.5e-05. That is fp32 accumulation order, not
a different embedding. `test_encoder.py::ProviderEquivalenceTest` holds the check, and
it is what licenses the 2,283 CPU-computed rows already in the index.

**Batching is bitwise-stable on CPU and only cosine-stable on CUDA.** cuBLAS picks
different reduction strategies by batch dimension, so the bytes move (max delta 2.5e-04)
while the track does not (pooled cosine 0.9999994 — the fp32 noise floor of the
measurement itself; the CPU's own bitwise-identical vectors score 0.99999988 against
themselves). The test asserts **two tiers** rather than one: bitwise on CPU, cosine
everywhere. Weakening it to cosine everywhere would stop catching a real CPU regression;
demanding bitwise everywhere would fail on hardware that is behaving correctly.

⚠️ **The nvidia wheels install into `site-packages` but are not on the dynamic loader's
path.** Without `onnxruntime.preload_dlls()` the CUDA provider fails to load
`libcublasLt.so`, onnxruntime falls back to CPU with a warning buried in its log, and the
run takes 3.4 hours instead of one while looking completely normal. `session()` calls it;
`backfill.py` prints the provider that actually resolved at the top of every run, because
this failure has no other symptom.
