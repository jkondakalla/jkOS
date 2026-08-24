#!/usr/bin/env python3
"""Walk the library and yield one record per audio file.

Deliberately does not import from KourOS, or read its `tracks` table, or talk to
any jkOS service. M1–M4 has **zero jkOS imports** by design (ALGORITHMS.md §4) —
the isolation is the deliverable, because it is what makes a wrong similarity
result at the M4 gate unambiguous. If this project could read another system's
catalogue, a bad neighbour list would have two possible causes instead of one.

What it does do is key on the **absolute path**, which is exactly the key
KourOS's `tracks.path` uses (UNIQUE, see apps/kouros/backend/server.js). That
costs nothing now and makes M5's join free later — the walking shuffle needs to
get from a vector back to something KourOS can play. Same key, no mapping table,
no dependency.

⚠️ Trap 19 — this walk crosses a CIFS mount. It is a `stat` per file over the
network for ~15,000 files; expect seconds, not milliseconds, and do not call it
inside a loop.
"""
import os

import config


class Track(tuple):
    """(path, mtime, size) with names. A tuple subclass rather than a dataclass so
    it stays a plain sequence for `executemany` while still reading clearly at the
    call site."""
    __slots__ = ()

    def __new__(cls, path, mtime, size):
        return super().__new__(cls, (path, mtime, size))

    path = property(lambda self: self[0])
    mtime = property(lambda self: self[1])
    size = property(lambda self: self[2])

    def __repr__(self):
        return f'Track({self.path!r}, mtime={self.mtime}, size={self.size})'


def iter_tracks(root=None, exts=None):
    """Yield a `Track` per audio file under `root`, in a deterministic order.

    Sorting `dirnames`/`filenames` in place is what makes the order deterministic:
    `os.walk` otherwise yields whatever order the filesystem reports, which on a
    network share is not stable between runs. A stable order means a `--limit N`
    run in §8.6 examines the same N tracks every time, which is the difference
    between a reproducible test and a coin flip.

    Hidden directories are skipped — `.git`, `@eaDir`-style sidecar folders, and
    the trash directories network shares accumulate. So are any named in
    `config.EXCLUDE_DIRS`, which is how the retired artist-nested rip stays out
    of the shelf without being moved or deleted.

    ⚠️ `root=None` means `config.LIBRARY_ROOT` AS IT IS AT CALL TIME, not as it
    was when this module was imported. The first version spelled the default
    `root=LIBRARY_ROOT` over a name imported from config, and a default argument
    is evaluated once — so moving `config.LIBRARY_ROOT`, which is the documented
    way to run this without the Luna mount, changed nothing here and the walk
    went on reading the old shelf. It is the same defect as the frozen sample
    rate in `audio.decode`, and both are written down rather than merely fixed.
    """
    root = os.path.abspath(os.fspath(config.LIBRARY_ROOT if root is None else root))
    if not os.path.isdir(root):
        raise NotADirectoryError(f'library root does not exist: {root}')
    lowered = tuple(e.lower() for e in (config.AUDIO_EXTS if exts is None else exts))

    excluded = tuple(config.EXCLUDE_DIRS)

    for dirpath, dirnames, filenames in os.walk(root):
        # Pruned in `dirnames` rather than filtered at the file, so an excluded
        # subtree is never DESCENDED. Over CIFS that is the difference between
        # skipping a folder and paying ~15,000 network stats to skip it one file
        # at a time (Trap 19).
        dirnames[:] = sorted(d for d in dirnames
                             if not d.startswith('.') and d not in excluded)
        for name in sorted(filenames):
            if not name.lower().endswith(lowered):
                continue
            full = os.path.join(dirpath, name)
            try:
                st = os.stat(full)
            except OSError:
                # A file that vanished or is unreadable mid-walk is not a reason to
                # abandon the scan — §8.6's "failures are data" rule applies here
                # too, one level earlier.
                continue
            yield Track(full, st.st_mtime, st.st_size)


def scan(root=None, exts=None):
    """`iter_tracks` as a list. Convenience for callers that want a count first."""
    return list(iter_tracks(root, exts))


def library_reachable(root=None):
    """Whether the shelf is still there. One `stat`, and never on a hot path.

    ⚠️ This is the question a long run has to be able to ask, because "failures
    are data" is right for one corrupt FLAC and catastrophic for one dropped
    mount: over CIFS a vanished share does not hang, it returns ENOENT in
    milliseconds, so a blip in hour two of a backfill marks *every remaining
    track* failed in about a minute — and failed rows are excluded from the next
    run's queue. Both arms call this before recording a failure (see
    `backfill.ABORT_AFTER`).

    Deliberately checks the ROOT rather than the track's own directory: an album
    folder that has genuinely been deleted is a per-file fact and should be
    recorded as one; a root that has vanished is the mount, and is not.
    """
    try:
        return os.path.isdir(os.fspath(config.LIBRARY_ROOT if root is None else root))
    except OSError:
        return False


if __name__ == '__main__':
    import sys

    where = sys.argv[1] if len(sys.argv) > 1 else config.LIBRARY_ROOT
    found = scan(where)
    total = sum(t.size for t in found)
    artists = {os.path.relpath(t.path, where).split(os.sep)[0] for t in found}
    print(f'{len(found)} files across {len(artists)} top-level folders, '
          f'{total / 1e9:.1f} GB under {where}')
