"""Extract the documents each lecture references out of the zip into the build dir."""

from __future__ import annotations

import os
import re
import zipfile

from . import util
from .ir import Asset, Course

# Assets above this size are almost certainly bundled video/media, not documents
_MAX_ASSET_BYTES = 100 * 1024 * 1024


def extract_course_assets(course: Course, zip_path: str, build_dir: str) -> int:
    """Materialize all pending assets. Returns the number of distinct files written."""
    assets_root = os.path.join(build_dir, "assets")
    os.makedirs(assets_root, exist_ok=True)

    written: dict[str, str] = {}
    distinct = 0

    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        sizes = {i.filename: i.file_size for i in zf.infolist()}
        for lec_index, lec in enumerate(course.lectures, start=1):
            lec_dir_rel = f"assets/lec-{lec_index:03d}"
            real_assets: list[Asset] = []
            for pend in lec.pending_assets:
                zpath = pend["zip_path"]
                resolved = _find(zpath, names)
                if resolved is None:
                    continue
                if sizes.get(resolved, 0) > _MAX_ASSET_BYTES:
                    continue
                try:
                    data = zf.read(resolved)
                except (KeyError, zipfile.BadZipFile):
                    continue
                digest = util.sha256_bytes(data)
                if digest in written:
                    rel_path = written[digest]
                else:
                    os.makedirs(os.path.join(build_dir, lec_dir_rel), exist_ok=True)
                    rel_path = f"{lec_dir_rel}/{pend['filename']}"
                    abs_path = os.path.join(build_dir, rel_path)
                    rel_path = _avoid_collision(build_dir, rel_path, abs_path)
                    with open(os.path.join(build_dir, rel_path), "wb") as fh:
                        fh.write(data)
                    written[digest] = rel_path
                    distinct += 1
                real_assets.append(Asset(
                    kind=pend["kind"],
                    title=pend["title"],
                    filename=pend["filename"],
                    rel_path=rel_path,
                    mime=util.guess_mime(pend["filename"]),
                    sha256=digest,
                ))
            lec.assets = real_assets
            lec.pending_assets = []
    return distinct


def extract_course_assets_from_dir(course: Course, course_dir: str, build_dir: str) -> int:
    """extract_course_assets for an already-extracted course directory:
    pending zip_path values are paths relative to course_dir."""
    from pathlib import Path

    root = Path(course_dir)
    assets_root = os.path.join(build_dir, "assets")
    os.makedirs(assets_root, exist_ok=True)

    names = {p.relative_to(root).as_posix(): p
             for p in root.rglob("*") if p.is_file()}
    name_set = set(names)

    written: dict[str, str] = {}
    distinct = 0
    for lec_index, lec in enumerate(course.lectures, start=1):
        lec_dir_rel = f"assets/lec-{lec_index:03d}"
        real_assets: list[Asset] = []
        for pend in lec.pending_assets:
            resolved = _find(pend["zip_path"], name_set)
            if resolved is None:
                continue
            src = names[resolved]
            if src.stat().st_size > _MAX_ASSET_BYTES:
                continue
            try:
                data = src.read_bytes()
            except OSError:
                continue
            digest = util.sha256_bytes(data)
            if digest in written:
                rel_path = written[digest]
            else:
                os.makedirs(os.path.join(build_dir, lec_dir_rel), exist_ok=True)
                rel_path = f"{lec_dir_rel}/{pend['filename']}"
                abs_path = os.path.join(build_dir, rel_path)
                rel_path = _avoid_collision(build_dir, rel_path, abs_path)
                with open(os.path.join(build_dir, rel_path), "wb") as fh:
                    fh.write(data)
                written[digest] = rel_path
                distinct += 1
            real_assets.append(Asset(
                kind=pend["kind"],
                title=pend["title"],
                filename=pend["filename"],
                rel_path=rel_path,
                mime=util.guess_mime(pend["filename"]),
                sha256=digest,
            ))
        lec.assets = real_assets
        lec.pending_assets = []
    return distinct


_HASH_PREFIX = re.compile(r"^[0-9a-f]{32}[_-]", re.IGNORECASE)


def _find(zip_path: str, names: set[str]) -> str | None:
    if zip_path in names:
        return zip_path
    low = zip_path.lower()
    for n in names:
        if n.lower() == low:
            return n
    # Basename match, tolerating the {32hex}_ prefix modern exports add
    base = _HASH_PREFIX.sub("", low.rsplit("/", 1)[-1])
    if not base:
        return None
    for n in sorted(names):
        nl = n.lower()
        if nl.endswith("/"):
            continue
        if _HASH_PREFIX.sub("", nl.rsplit("/", 1)[-1]) == base:
            return n
    return None


def _avoid_collision(build_dir: str, rel_path: str, abs_path: str) -> str:
    if not os.path.exists(abs_path):
        return rel_path
    base, ext = os.path.splitext(rel_path)
    i = 2
    while os.path.exists(os.path.join(build_dir, f"{base}-{i}{ext}")):
        i += 1
    return f"{base}-{i}{ext}"
