#!/usr/bin/env python3
"""One writer at a time over the analysis stores (`index.db`, `meshes.db`).

    with runlock.hold('backfill.py'):
        ...                                   # raises runlock.Busy if another run holds it

WHY THIS EXISTS NOW. Until `analyze.py --watch`, every run was started by a person
who could see whether another one was going. A watcher that wakes on its own
removes that person: `control.py`'s Resume button, a hand-typed `backfill.py` and
the watcher's own vectors stage would all pull the SAME `index.pending()` rows and
embed them twice. Nothing corrupts — `put_vector` is an upsert — but two runs
share one CIFS mount that plateaus at three readers (Trap 19) and one GPU, so both
go at half speed and the ETA each prints is fiction.

`flock`, not a pid file: the kernel releases it when the holder dies, however it
dies, so there is no stale lock to clean up after a power cut and no
"is that pid still us" check to get wrong (`control.py` has to do exactly that
dance for its own pid file). The holder's pid and command are written into the
file only so `Busy` can say who has it.
"""
import contextlib
import fcntl
import os

LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.analysis.lock')


class Busy(RuntimeError):
    """Another run holds the analysis lock."""


@contextlib.contextmanager
def hold(what, path=None):
    """Hold the analysis lock for the duration of the block, or raise `Busy`.

    ⚠️ `path=None` means `LOCK_PATH` AS IT IS AT CALL TIME — the default-argument
    trap `index.connect` documents, so a test can point the lock somewhere else.
    """
    path = LOCK_PATH if path is None else path
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            holder = os.pread(fd, 200, 0).decode('utf-8', 'replace').strip() or 'unknown'
            raise Busy(f'another analysis run holds {path} ({holder}) — two writers would '
                       f'embed the same pending tracks twice at half speed each. '
                       f'Wait for it, or stop it first.') from None
        os.ftruncate(fd, 0)
        os.pwrite(fd, f'pid {os.getpid()} · {what}\n'.encode('utf-8'), 0)
        try:
            yield
        finally:
            os.ftruncate(fd, 0)
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def holder(path=None):
    """Who holds the lock right now, or None. Never blocks and never takes it."""
    path = LOCK_PATH if path is None else path
    try:
        fd = os.open(path, os.O_RDWR)
    except OSError:
        return None
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return os.pread(fd, 200, 0).decode('utf-8', 'replace').strip() or 'unknown'
        fcntl.flock(fd, fcntl.LOCK_UN)
        return None
    finally:
        os.close(fd)
