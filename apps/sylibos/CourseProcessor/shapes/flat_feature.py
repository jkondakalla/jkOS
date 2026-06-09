"""
Flat-feature shape builder.

Most regular OCW courses. pages/ has named feature folders:
  lecture-notes/, assignments/, exams/, recitations/, readings/

Each item inside a feature folder becomes a session. All sessions are
combined into one synthetic unit and sorted by lecture/pset/exam number.
"""

from __future__ import annotations
import json
import re
from pathlib import Path

from .._utils import enrich_overview, html_to_text, read_json, str_field
from ..manifest import SessionNode, UnitNode
from .base import SpineBuilder

# Ordered list of feature slugs — determines collection priority.
# Covers the full range of slug names seen across OCW Studio exports.
_FEATURE_PRIORITY = [
    "lecture-notes", "lectures", "lecture-slides",
    "recitations",
    "assignments", "assignments-and-problem-sets", "problem-sets",
    "exams",
    "readings",
    "tools",
    "study-materials",
]

_SKIP_SLUGS = frozenset({
    "syllabus", "resource-index", "instructor-insights", "related-resources",
})

_LECTURE_PAT  = re.compile(r"(?:lecture|lec|L)[\s._-]*(\d+)", re.IGNORECASE)
_RECIT_PAT    = re.compile(r"(?:recitation|rec|r)[\s._-]*(\d+)", re.IGNORECASE)
_PSET_PAT     = re.compile(r"(?:problem\s*set|pset|ps|assignment|hw|homework)[\s._-]*(\d+)", re.IGNORECASE)
_EXAM_PAT     = re.compile(r"(?:exam|quiz|midterm|final)[\s._-]*(\d+)?", re.IGNORECASE)


def _sort_key(title: str, slug: str) -> tuple:
    m = _LECTURE_PAT.search(title) or _LECTURE_PAT.search(slug)
    if m:
        return (0, int(m.group(1)), title)
    m = _RECIT_PAT.search(title) or _RECIT_PAT.search(slug)
    if m:
        return (1, int(m.group(1)), title)
    m = _PSET_PAT.search(title) or _PSET_PAT.search(slug)
    if m:
        return (2, int(m.group(1)), title)
    m = _EXAM_PAT.search(title) or _EXAM_PAT.search(slug)
    if m:
        return (3, int(m.group(1)) if m.group(1) else 0, title)
    return (4, 0, title)


class FlatFeatureBuilder(SpineBuilder):

    def build(self) -> list[UnitNode]:
        pages_dir = self.zip_root / "pages"
        if not pages_dir.is_dir():
            return []

        present = [
            slug for slug in _FEATURE_PRIORITY
            if (pages_dir / slug).is_dir()
        ]

        sessions: list[tuple[tuple, SessionNode]] = []

        if present:
            for feature_slug in present:
                feature_dir = pages_dir / feature_slug
                for sub in sorted(feature_dir.iterdir()):
                    if not sub.is_dir() or sub.name.startswith("."):
                        continue
                    sp = sub / "data.json"
                    if not sp.exists():
                        continue
                    try:
                        data = read_json(sp)
                    except ValueError:
                        continue
                    if data.get("deleted"):
                        continue
                    title = str_field(data, "title", sub.name)
                    key = _sort_key(title, sub.name)
                    sessions.append((key, SessionNode(
                        slug=sub.name,
                        title=title,
                        overview=enrich_overview(html_to_text(data.get("content")), data),
                        is_assessment=bool(_EXAM_PAT.search(sub.name)),
                        order=0,
                        page_uid=data.get("uid") or data.get("id"),
                    )))
        else:
            # Fallback: top-level pages/ items as sessions
            for i, d in enumerate(sorted(
                d for d in pages_dir.iterdir()
                if d.is_dir()
                and d.name not in _SKIP_SLUGS
                and not d.name.startswith(".")
            )):
                sp = d / "data.json"
                if not sp.exists():
                    continue
                try:
                    data = read_json(sp)
                except ValueError:
                    continue
                if data.get("deleted"):
                    continue
                title = str_field(data, "title", d.name)
                sessions.append((_sort_key(title, d.name), SessionNode(
                    slug=d.name,
                    title=title,
                    overview=enrich_overview(html_to_text(data.get("content")), data),
                    is_assessment=bool(_EXAM_PAT.search(d.name)),
                    order=0,
                    page_uid=data.get("uid") or data.get("id"),
                )))

        if not sessions:
            return []

        sessions.sort(key=lambda x: x[0])
        ordered = [s for _, s in sessions]
        for i, s in enumerate(ordered):
            s.order = i

        # Course title for synthetic unit name
        unit_title = "Course Materials"
        root_data = self.zip_root / "data.json"
        if root_data.exists():
            try:
                unit_title = json.loads(
                    root_data.read_text(encoding="utf-8")
                ).get("course_title", unit_title)
            except Exception:
                pass

        return [UnitNode(
            slug="course-materials",
            title=unit_title,
            overview="",
            order=0,
            sessions=ordered,
            is_synthetic=True,
        )]
