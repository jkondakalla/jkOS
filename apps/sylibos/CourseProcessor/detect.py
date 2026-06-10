"""
Format and shape detection for OCW course zips.

Format: modern (ocw-studio/Hugo exports, ~2020+, all vintages)
        legacy (Plone exports, pre-2015: OcwWeb/ trees, numeric dirs)
        unknown (anything else — handled by the heuristic HTML extractor)

Shape:  scholar | flat_feature | project_lab | seminar | video_only

detect_format() NEVER raises: an unrecognized layout returns "unknown",
which routes the course to the structure-tolerant heuristic path instead
of failing the ingest.
"""

from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Literal

CourseFormat = Literal["modern", "legacy", "unknown"]
CourseShape  = Literal["scholar", "flat_feature", "project_lab", "seminar", "video_only"]

_SKIP_SLUGS = frozenset({
    "syllabus", "resource-index", "instructor-insights",
    "related-resources", "exams",
})

_FEATURE_SLUGS = frozenset({
    "lecture-notes", "lectures", "lecture-slides", "lecture-videos",
    "video-lectures", "assignments", "assignments-and-problem-sets",
    "problem-sets", "exams", "recitations", "readings", "videos", "labs",
    "study-materials", "tools",
})

_PROJECT_PAT = re.compile(r"^(project|lab|studio|design)-")

# Bounded directory names that mark a legacy Plone export
_LEGACY_MARKERS = frozenset({"OcwWeb", "OcwExport", "PlonePages"})


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def detect_format(zip_root: Path) -> CourseFormat:
    """
    Modern:  pages/ or resources/ dirs with data.json files, or a root
             data.json carrying course_title (all ocw-studio vintages).
    Legacy:  OcwWeb/-style Plone tree or a top-level 0/ folder (bounded scan).
    Unknown: everything else. Never raises.
    """
    pages_dir     = zip_root / "pages"
    resources_dir = zip_root / "resources"
    root_data     = zip_root / "data.json"

    if root_data.exists() and "course_title" in _read_json(root_data):
        return "modern"
    if (zip_root / "content_map.json").exists():
        return "modern"
    for d in (pages_dir, resources_dir):
        if d.is_dir():
            try:
                if (d / "data.json").exists() or any(d.glob("*/data.json")):
                    return "modern"
            except OSError:
                pass
    if pages_dir.is_dir():
        return "modern"

    # Legacy Plone export — scan only the top three levels for marker dirs
    def _walk(level_dirs: list[Path], depth: int) -> bool:
        if depth > 3 or not level_dirs:
            return False
        nxt: list[Path] = []
        for d in level_dirs:
            try:
                for c in d.iterdir():
                    if not c.is_dir():
                        continue
                    if c.name in _LEGACY_MARKERS:
                        return True
                    nxt.append(c)
            except OSError:
                continue
        return _walk(nxt, depth + 1)

    if _walk([zip_root], 1):
        return "legacy"
    if (zip_root / "0").is_dir():
        return "legacy"
    # Plone exports parsed by ocw-data-parser leave a *_parsed.json master file
    try:
        if any(zip_root.glob("*_parsed.json")):
            return "legacy"
    except OSError:
        pass

    return "unknown"


def detect_shape(
    zip_root: Path,
    fmt: CourseFormat,
) -> tuple[CourseShape, float]:
    """
    Returns (shape, confidence) where confidence is 0.0–1.0.
    Decision order (first match wins):
      1. project_lab  — pages/ has project-/lab-/studio-/design- slugs
      2. scholar      — pages/ has unit dirs with ≥2 session sub-dirs (no feature slugs)
      3. video_only   — Lecture Videos but no Lecture Notes / Problem Sets
      4. seminar      — pages/readings/ exists, no lecture-notes/ or lectures/
      5. flat_feature — default
    """
    if fmt != "modern":
        return "flat_feature", 0.0

    pages_dir = zip_root / "pages"
    if not pages_dir.is_dir():
        # No pages/ tree at all — if resources hold videos, it's video-only
        if _looks_video_only(zip_root):
            return "video_only", 0.7
        return "flat_feature", 0.3

    top_dirs = [
        d for d in pages_dir.iterdir()
        if d.is_dir()
        and d.name not in _SKIP_SLUGS
        and not d.name.startswith(".")
    ]
    top_slugs = {d.name for d in top_dirs}

    # 1. Project / lab
    project_slugs = [s for s in top_slugs if _PROJECT_PAT.match(s)]
    if len(project_slugs) >= 2:
        return "project_lab", 0.9
    if len(project_slugs) == 1:
        return "project_lab", 0.7

    # 2. Scholar: unit dirs with session sub-dirs AND no feature folder names.
    has_feature = bool(top_slugs & _FEATURE_SLUGS)
    scholar_hits  = 0  # units with ≥2 sessions
    loose_hits    = 0  # units with ≥1 session
    for d in top_dirs:
        try:
            sub_with_data = [
                s for s in d.iterdir()
                if s.is_dir() and not s.name.startswith(".") and (s / "data.json").exists()
            ]
        except OSError:
            continue
        n = len(sub_with_data)
        if n >= 2:
            scholar_hits += 1
            loose_hits   += 1
        elif n == 1:
            loose_hits += 1

    if scholar_hits >= 2 and not has_feature:
        return "scholar", 0.9
    if scholar_hits >= 1 and not has_feature:
        return "scholar", 0.7
    if loose_hits >= 3 and not has_feature:
        return "scholar", 0.6

    # 3. Video-only
    if _looks_video_only(zip_root):
        return "video_only", 0.85

    # 4. Seminar
    if "readings" in top_slugs and not top_slugs & {"lecture-notes", "lectures",
                                                    "lecture-videos", "video-lectures"}:
        return "seminar", 0.8

    # 5. Default
    return "flat_feature", 0.75


def _looks_video_only(zip_root: Path) -> bool:
    """
    True when the course's instructional payload is videos with no notes/psets.
    Checks root data.json learning_resource_types first; falls back to counting
    resource_type fields in resources/*/data.json (newer exports leave
    learning_resource_types empty on the resources themselves).
    """
    data = _read_json(zip_root / "data.json")
    types = set(data.get("learning_resource_types") or [])
    if types:
        return ("Lecture Videos" in types
                and not types & {"Lecture Notes", "Problem Sets"})

    resources_dir = zip_root / "resources"
    if not resources_dir.is_dir():
        return False
    videos = docs = 0
    try:
        for dp in resources_dir.glob("*/data.json"):
            raw = _read_json(dp)
            rt = raw.get("resource_type") or ""
            ft = raw.get("file_type") or ""
            if rt == "Video" or raw.get("youtube_key"):
                videos += 1
            elif ft == "application/pdf":
                docs += 1
    except OSError:
        return False
    return videos >= 5 and docs == 0
