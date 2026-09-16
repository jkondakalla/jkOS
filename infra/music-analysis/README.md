# Music analysis — the watcher, and the key that delivers to KourOS

New music lands on the shelf; a few minutes later KourOS can find it, play radio
from it, place it on the vibe map, and draw its pulsarmap. Nobody presses anything.

```
 Qobuz / SMB copy            this workstation (GPU)                         NAS                       KourOS (prod + staging)
 ───────────────▶ Plex/Music ──▶ music/analyze.py --watch ──rsync, write-only──▶ /mnt/Luna/jkos-analysis ──:ro──▶ /analysis
                                 scan → vectors → baseline → fit → gate → ship     music-index.db               reload on change
                                                                                   music-meshes.db              + rescan the library
```

The pipeline is [`music/analyze.py`](../../music/analyze.py); its header says what each stage
does and why the order is what it is. This file is how it runs unattended and how its
output reaches the NAS.

---

## Trust boundaries

| Principal | Can | Cannot |
|---|---|---|
| **The delivery key** (`~/.ssh/jkos_music_analysis_ed25519`) | Replace files in `/mnt/Luna/jkos-analysis` | Read anything, delete anything, open a shell, forward a port, or write anywhere else — its `authorized_keys` entry forces `rrsync -wo -no-del` under `restrict`. Verified 2026-09-16 against the real `rrsync`: read, `..` escape and `--delete` all refused. |
| **KourOS** (both environments) | Read the two analysis files | Write them — the mount is `:ro` |
| **The analysis dataset** `Luna/jkos-analysis` | Hold two regenerable files | Hold application data. It is its own dataset **so** a stolen delivery key is confined away from every `kouros.db`, and so the hourly 30-day snapshot task on `Luna/Backends` does not pin ~1 GB per delivery. It is not SMB-shared. |

**What a stolen key can do:** replace the analysis with garbage. KourOS's own checks and
`/api/discover/stats` would show it (coverage, calibration, mesh recipe), and the fix is
a re-delivery. It cannot reach a user's data, which is the property the confinement exists for.

---

## Setup — four steps, and the NAS ones are Jag's

**1 · Create the dataset on the NAS, before deploying.** ⚠️ Order matters: a deploy first
makes Docker auto-create `/mnt/Luna/jkos-analysis` as an empty *root-owned plain directory*,
which mounts cleanly, serves nothing, and refuses the key's writes.

```bash
ssh truenas_admin@192.168.1.108 'midclt call pool.dataset.create "{\"name\": \"Luna/jkos-analysis\"}"'
ssh truenas_admin@192.168.1.108 'midclt call -j filesystem.setperm "{\"path\": \"/mnt/Luna/jkos-analysis\", \"uid\": 950, \"gid\": 950, \"mode\": \"750\"}"'
ssh truenas_admin@192.168.1.108 'ls -ld /mnt/Luna/jkos-analysis'      # truenas_admin truenas_admin, drwxr-x---
```

`950` is `truenas_admin`. The container reads as root, so `750` costs it nothing.

⚠️ **This is the HOST path.** This workstation mounts the `Luna/Luna` SMB share at
`/mnt/Luna`, so `/mnt/Luna/jkos-analysis` here is a different, nonexistent directory.
Same trap as the music library path, one dataset over.

**2 · Install the watcher on this workstation.**

```bash
infra/music-analysis/install.sh
```

Creates the key if it is missing, writes `~/.config/jkos/music-analysis.env` (target +
key), links and starts `jkos-music-analyze.service`, and prints step 3's exact command.

**3 · Authorise the key on the NAS, restricted.** `install.sh` prints this with the real key:

```bash
printf 'command="/usr/bin/rrsync -wo -no-del /mnt/Luna/jkos-analysis",restrict %s\n' \
  "$(cat ~/.ssh/jkos_music_analysis_ed25519.pub)" \
| ssh truenas_admin@192.168.1.108 'cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Optionally prefix `from="<this machine's IP>",` to the entry. It is left off by default
for the backup key's reason: a DHCP change would silently stop delivery.

**4 · Deploy** (Jag's button). Both compose files mount the dataset read-only at `/analysis`
and point `VECTOR_DB_PATH` / `MESH_DB_PATH` into it.

⚠️ Until the first delivery lands, staging's pulsarmap reads *unavailable*. The 1.7 MB
`music-meshes.db` already in staging's `kouros-data` (dated 2026-09-16) is no longer read
once this deploys; removing it is yours.

---

## Operating it

```bash
cd music && ./.venv/bin/python analyze.py --status     # every stage, the last ship, the last delivery
journalctl --user -u jkos-music-analyze -f              # what the watcher is doing
systemctl --user stop jkos-music-analyze                # pause (drains the track in flight)
systemctl --user start jkos-music-analyze               # resume — every stage picks up where it stopped
```

The watcher holds the analysis lock ([`music/runlock.py`](../../music/runlock.py)) for its
whole life, so `backfill.py`, `descriptors.py --build`, `mesh.py --pending` and a hand-typed
`analyze.py` refuse to start beside it and name the holder. **Stop the unit to run one by hand.**

### What one cycle does (every 5 minutes)

| Stage | Runs when | Guard |
|---|---|---|
| scan | always — but a full walk (145 s over CIFS, measured) only on the first cycle and daily; otherwise only directories whose mtime moved are re-listed, plus a re-`stat` of files still settling (`scan.CachedShelf`, 7.6 s over the same shelf) | A new or changed file counts only once untouched for **120 s AND unchanged across two walks**, so an upload is analysed one to two cycles after it lands. The Qobuz downloader re-tags after its rename, and a copy tool can stamp the source's old mtime on a half-written file. A scan that would send **> 500 finished tracks** back to `pending` holds those changes and logs why; new files still land. |
| vectors · baseline | something is queued | The shelf gone → stop, mark nothing. 25 consecutive failures → stop. |
| fit | an arm grew ≥ 5% since its fit, or was never fitted | — |
| gate | this calibration has no verdict | A FAILED verdict blocks every later ship until the calibration changes. |
| ship | the stores changed since the last ship | `ship.check` + `mesh.check`, run on **the copies**. |
| deliver | the last ship is not delivered yet | A failed rsync is retried next cycle. |

### On the NAS side

KourOS re-reads each analysis file's identity (inode · size · mtime) once its discovery TTL
(5 min) lapses. When one has been replaced it reloads the file **and rescans the library**,
because new analysis means new music, and nothing else in KourOS walks `MUSIC_DIR` after
boot. An unchanged file costs a `stat`, not a reload. Covered end to end by section 7 of
`apps/kouros/backend/test/discover.smoke.mjs`.

---

## When it goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `deliver … rsync exited 255` | key not authorised, or the NAS unreachable | Step 3; `ssh -i ~/.ssh/jkos_music_analysis_ed25519 truenas_admin@192.168.1.108` should print an rrsync refusal, not a password prompt |
| `rrsync error: unable to chdir to restricted dir` | step 1 not done, or the dataset path differs | Step 1 |
| `rsync … Permission denied` on the NAS | Docker created the directory first (root-owned) | Step 1's `setperm` |
| `⚠️ scan … over the 500 ceiling` | a tagging sweep, or a real re-download | If the audio really changed: stop the unit, `analyze.py --allow-invalidate`, start the unit |
| `GateFailed` every cycle | the refit geometry no longer beats the baseline | §8.7's stop condition. `query.py --gate` / `--hand`; nothing ships until it is fixed |
| unit restarting every 60 s, `Busy` in the journal | a hand-started run holds the lock | Let it finish; the watcher takes over |
| `vectors … provider CPU` | the CUDA libraries did not load | See `music/models/README.md`; the run still works, ~21× slower |
