"""
Format and shape detection for OCW course zips.

Format: modern (post-2015 ocw-studio/Hugo) | legacy (Plone) | archive (IA stub)
Shape:  scholar | flat_feature | project_lab | seminar | video_only
"""

from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Literal

CourseFormat = Literal["modern", "legacy", "archive"]
CourseShape  = Literal["scholar", "flat_feature", "project_lab", "seminar", "video_only"]

_SKIP_SLUGS = frozenset({
    "syllabus", "resource-index", "instructor-insights",
    "related-resources", "exams",
})

_FEATURE_SLUGS = frozenset({
    "lecture-notes", "lectures", "assignments",
    "assignments-and-problem-sets", "problem-sets",
    "exams", "recitations", "readings", "videos",
})

_PROJECT_PAT = re.compile(r"^(project|lab|studio|design)-")


def detect_format(zip_root: Path) -> CourseFormat:
    """
    Modern:  data.json at root + pages/ directory present
    Legacy:  OcwWeb/ or 0/ folder present
    Archive: neither (stub — raises for now)
    """
    has_pages    = (zip_root / "pages").is_dir()
    has_data     = (zip_root / "data.json").exists()
    has_map      = (zip_root / "content_map.json").exists()

    if has_pages and (has_data or has_map):
        return "modern"
    if has_pages:
        return "modern"

    if any(True for _ in zip_root.rglob("OcwWeb")):
        return "legacy"
    if (zip_root / "0").is_dir():
        return "legacy"

    raise ValueError(
        f"Unknown OCW schema at {zip_root}. "
        "Expected data.json + pages/ (modern) or OcwWeb/ (legacy)."
    )


def detect_shape(
    zip_root: Path,
    fmt: CourseFormat,
) -> tuple[CourseShape, float]:
    """
    Returns (shape, confidence) where confidence is 0.0–1.0.
    Decision order (first match wins):
      1. project_lab  — pages/ has project-/lab-/studio-/design- slugs
      2. scholar      — pages/ has unit dirs with ≥2 session sub-dirs (no feature slugs)
      3. video_only   — data.json has Lecture Videos but no Lecture Notes / Problem Sets
      4. seminar      — pages/readings/ exists, no lecture-notes/ or lectures/
      5. flat_feature — default
    """
    if fmt != "modern":
        return "flat_feature", 0.5

    pages_dir = zip_root / "pages"
    if not pages_dir.is_dir():
        return "flat_feature", 0.4

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
    #    Primary signal: ≥2 sub-sessions (strong).  Secondary: ≥1 sub-session
    #    across multiple dirs (weak — catches single-reading-per-unit courses).
    has_feature = bool(top_slugs & _FEATURE_SLUGS)
    scholar_hits  = 0  # units with ≥2 sessions
    loose_hits    = 0  # units with ≥1 session
    for d in top_dirs:
        sub_with_data = [
            s for s in d.iterdir()
            if s.is_dir() and not s.name.startswith(".") and (s / "data.json").exists()
        ]
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
    data_json = zip_root / "data.json"
    if data_json.exists():
        try:
            data  = json.loads(data_json.read_text(errors="replace"))
            types = set(data.get("learning_resource_types") or [])
            if "Lecture Videos" in types and not types & {"Lecture Notes", "Problem Sets"}:
                return "video_only", 0.85
        except Exception:
            pass

    # 4. Seminar
    if "readings" in top_slugs and not top_slugs & {"lecture-notes", "lectures"}:
        return "seminar", 0.8

    # 5. Default
    return "flat_feature", 0.75
