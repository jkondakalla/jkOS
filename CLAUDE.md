# jkOS — standing instructions for agents

A self-hosted suite on TrueNAS SCALE: ORDECK (portal), jkAuth (SSO + app directory), BeigeBoard,
KourOS (music + audiobooks), LazurOS (AI gateway), jkDeploy, and Weave (the contract between them).
Repo root is `/media/jag/The Forge/jkOS` — **the path has a space; quote it.** Work on `staging`.

## Where things are

- **`Documentation/TODO.md` is the one list of open work.** Close items there (delete them), never
  in a second list. Its "Standing decisions" section is settled — don't re-propose those.
- **`Documentation/agents/`** holds the engineering references: `TRAPS.md` (check it before
  debugging anything that smells familiar), `TESTING.md` (every command, gate and suite),
  `WEAVE.md` (the contract an app implements), `DESIGN.md`, `ALGORITHMS.md` (music + LazurOS
  design record — code cites its § numbers, so don't renumber), `ROUTINES.md`, and the generated
  `ROUTINE_PROMPT.md` (regenerate, never hand-edit).
- `Documentation/ARCHITECTURE.md` and `OPERATIONS.md` are the map and the runbook.
- **The code is the source of truth. A doc is a map;** where they disagree, fix the doc.
- Two skills encode suite knowledge: `suite-health` (run the gates in order, map a failure to its
  cause) and `new-tester` (write a test in the house pattern and wire it into the gate).

## What this project is for

**jkOS is a portfolio piece for Jag's IT-auditing career.** Access control, session integrity,
least privilege and auditability are the product, not hygiene. So:

1. **A control that exists in configuration but not in code is the worst defect class here.**
2. **Prefer the enforceable fix** — a SQLite trigger over a route check, a probe over a doc
   sentence, a derived value over a re-typed one.
3. **Leave behind the thing that proves it stays fixed.** Verify a new assertion fails against
   the pre-fix code before believing it passes.

Each app is built by a fresh agent. **Weave is a dev-time contract boundary, not a runtime bus:**
an app decides its internals freely as long as its declared inputs and outputs stay consistent.
Zero cross-app calls in production is the correct steady state. Two apps with the same kind of
data get a *common declared shape*, never a shared implementation. Anything that hands the next
agent wrong or incomplete declarations is a real defect.

## You may, without asking

Rewrite or delete docs; move, rename, split or merge source files; retire abstractions with no
consumers; overrule a decision recorded in a doc or memory (say so in your report — don't stall).
Work through every unblocked item without waiting for approval between them.

## Ask Jag first

1. **Adding a dependency to `music/requirements.txt`.** It is `numpy` + `onnxruntime` and nothing
   else. No `torch`, with no fallback — if a model won't export to ONNX, change models.
2. **Deleting data.** `music/index.db` (+ `-wal`/`-shm`), `music/meshes*.db`, the live staging and
   production databases, and anything under `/mnt/Luna` (Jag's library). Never `rm` a `.db` to
   "reset" something. `music/.venv` is gitignored but holds `onnxruntime-gpu` (21× faster than
   the CPU build in `requirements.txt`) — don't clean it up.
3. **Deploying, promoting, or pushing to a branch that auto-deploys.** Commit freely on
   `staging`; the deploy is a button Jag presses. `jkos-deploy` promotes `origin/staging` to prod.
4. **Irreversible changes to a deployed service** — a migration that drops a column, a token
   format change that signs every device out. Reversible migration first, then ask.
5. **Rewriting git history.** Refused by standing decision — report, don't rewrite.
6. **Changing machine state** (installing systemd units etc.) — stop at "here is the installer".

## ⚠️ The four files that silently invalidate the music index

**`music/config.py` · `mel.py` · `encoder.py` · `audio.py`** define what a vector *means*.

- Change a config **parameter** (`SR`, `N_MELS`, the encoder profile) → `config.signature()`
  moves and the index refuses the next write with `ConfigDriftError`. Loud; fine.
- Change the **computation** without moving a parameter (refactor the framing, "tidy" the
  resample) → nothing errors, and the index quietly holds two incomparable vector sets. Wrong
  neighbours, no exception, no NaN.

If you touch any of the four, the whole library must be re-analysed from zero (hours of CIFS-bound
decode) — so ask first. Everything else in `music/` may be refactored freely.
`cd music && ./.venv/bin/python analyze.py --status` shows where the pipeline stands. The fit
stage is not optional: an unfitted index ships raw cosines and nothing errors (`ship.py --check`
refuses one). `music/` runs its own tests (`./.venv/bin/python -m unittest discover`) and is
**not** on the node gate.

## Physical facts that constrain the code

| Fact | Consequence |
|---|---|
| **The gate must be green at every commit** — `pnpm test:contracts`. | If a change makes it red, the change isn't done. |
| Prod and staging share one checkout behind a standalone nginx whose confs are file bind-mounts. | **Never `nginx -s reload`** — it serves the old inode. See OPERATIONS.md § Nginx config. |
| `/mnt/Luna` is a CIFS mount at ~100 MB/s. | The wire is the bottleneck; parallel readers are the lever (plateaus at 3). |
| Library paths are hostile (`!!!`, `&`, `[24B-96kHz]`, apostrophes). | **Never `shell=True`; argv lists everywhere.** A glob over album folders silently matches nothing. |
| The NAS music path is `/mnt/Luna/Luna/Plex/Music`. `/mnt/Luna/Plex/Music` also exists on the host and is **empty**. | A container given the decoy path sees zero tracks and nothing errors. |
| `music/` sits outside the pnpm workspace on purpose. | Keeps Python off the node gate and the dependency budget honest. |
| KourOS's listening-session hub lives in memory. | KourOS runs as **one** container; scaling it needs a shared bus first. |

## Rules of engagement

- **Verify, then trust.** Every doc and memory line predates you; re-read the code.
- **Small, separately-committed diffs, one concern each.**
- **Throwaway verification scripts stay in the scratchpad.** Ask before promoting one to a
  committed test — the suite's test style is uniform on purpose.
- **Say what you didn't do.** Half-done and reported as done is worse than named as skipped.
- **Close items in `TODO.md` by deleting them**, not by adding ✅ — git is the history.
