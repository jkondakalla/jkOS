"""Extract the documents each lecture references out of the zip into the build dir."""

from __future__ import annotations

import os
import zipfile

from . import util
from .ir import Asset, Course


def extract_course_assets(course: Course, zip_path: str, build_dir: str) -> int:
    """Materialize all pending assets. Returns the number of distinct files written."""
    assets_root = os.path.join(build_dir, "assets")
    os.makedirs(assets_root, exist_ok=True)

    written: dict[str, str] = {}
    distinct = 0

    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        for lec_index, lec in enumerate(course.lectures, start=1):
            lec_dir_rel = f"assets/lec-{lec_index:03d}"
            real_assets: list[Asset] = []
            for pend in lec.pending_assets:
                zpath = pend["zip_path"]
                resolved = _find(zpath, names)
                if resolved is None:
                    continue
                data = zf.read(resolved)
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


def _find(zip_path: str, names: set[str]) -> str | None:
    if zip_path in names:
        return zip_path
    low = zip_path.lower()
    for n in names:
        if n.lower() == low:
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
