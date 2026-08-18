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

from config import AUDIO_EXTS, LIBRARY_ROOT


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


def iter_tracks(root=LIBRARY_ROOT, exts=AUDIO_EXTS):
    """Yield a `Track` per audio file under `root`, in a deterministic order.

    Sorting `dirnames`/`filenames` in place is what makes the order deterministic:
    `os.walk` otherwise yields whatever order the filesystem reports, which on a
    network share is not stable between runs. A stable order means a `--limit N`
    run in §8.6 examines the same N tracks every time, which is the difference
    between a reproducible test and a coin flip.

    Hidden directories are skipped — `.git`, `@eaDir`-style sidecar folders, and
    the trash directories network shares accumulate.
    """
    root = os.path.abspath(os.fspath(root))
    if not os.path.isdir(root):
        raise NotADirectoryError(f'library root does not exist: {root}')
    lowered = tuple(e.lower() for e in exts)

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
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


def scan(root=LIBRARY_ROOT, exts=AUDIO_EXTS):
    """`iter_tracks` as a list. Convenience for callers that want a count first."""
    return list(iter_tracks(root, exts))


if __name__ == '__main__':
    import sys

    where = sys.argv[1] if len(sys.argv) > 1 else LIBRARY_ROOT
    found = scan(where)
    total = sum(t.size for t in found)
    artists = {os.path.relpath(t.path, where).split(os.sep)[0] for t in found}
    print(f'{len(found)} files across {len(artists)} top-level folders, '
          f'{total / 1e9:.1f} GB under {where}')
