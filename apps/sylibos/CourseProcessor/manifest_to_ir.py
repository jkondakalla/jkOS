"""
CourseManifest → library Course IR.

Bridges the format/shape-aware preprocessor output into the normalized IR
that build/load write into library.db:

  UnitNode                 → Unit
  SessionNode              → Lecture (overview + notes/transcript text)
  video resources          → Lecture.videos  [{provider, id, title}]
  archive_url              → Lecture.resources [{title, url}]
  document resources       → Lecture.pending_assets (zip entries resolved by
                             basename, hash-prefix aware)
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from . import util
from ._utils import html_to_text
from .ir import Course, Lecture, Unit
from .manifest import CourseManifest, ResourceNode, SessionNode

_CONTENT_LIMIT    = 8_000
_TRANSCRIPT_LIMIT = 4_000

_HASH_PREFIX = re.compile(r"^[0-9a-f]{32}[_-]", re.IGNORECASE)


def manifest_to_ir(
    manifest: CourseManifest,
    zip_names: Iterable[str],
    *,
    course_number: str = "",
    term: str = "",
    ocw_url: Optional[str] = None,
) -> Course:
    course_number = course_number or manifest.course_id
    term = term or f"{manifest.term} {manifest.year}".strip()

    instructor = ", ".join(
        name for name in (
            " ".join(p for p in (i.first_name, i.last_name) if p).strip()
            for i in manifest.instructors
        ) if name
    )
    subject = (manifest.departments[0] if manifest.departments
               else manifest.department_numbers[0] if manifest.department_numbers
               else "")

    description = html_to_text(manifest.description) or manifest.goals
    if manifest.prerequisites:
        description = f"{description}\n\nPrerequisites: {manifest.prerequisites}".strip()

    course = Course(
        slug=util.slugify(f"{course_number or manifest.title} {term}".strip()),
        title=html_to_text(manifest.title) or course_number or "Untitled Course",
        description=description,
        instructor=instructor,
        subject=subject,
        level=manifest.level[0] if manifest.level else "",
        course_number=course_number,
        term=term,
        ocw_url=ocw_url,
        layout_format=f"{manifest.source_format}/{manifest.detected_shape}",
    )

    zip_index = _build_zip_index(zip_names)
    ord_counter = 0

    for u_idx, unode in enumerate(manifest.units, start=1):
        unit = Unit(title=unode.title or f"Unit {u_idx}", ord=u_idx)
        for snode in unode.sessions:
            ord_counter += 1
            unit.lectures.append(
                _session_to_lecture(snode, unit.title, ord_counter, zip_index)
            )
        if unit.lectures:
            course.units.append(unit)

    return course


# ── Session conversion ────────────────────────────────────────────────────────

def _session_to_lecture(
    session: SessionNode,
    unit_title: str,
    ord_: int,
    zip_index: dict[str, str],
) -> Lecture:
    lec = Lecture(
        title=session.title,
        ord=ord_,
        content=_lecture_content(session),
        unit_title=unit_title,
        section=session.section,
    )

    seen_videos: set[str] = set()
    for r in session.resources:
        if r.youtube_id and r.youtube_id not in seen_videos:
            seen_videos.add(r.youtube_id)
            lec.videos.append({
                "provider": "youtube",
                "id": r.youtube_id,
                "title": r.title or "Lecture video",
            })
        if r.archive_url:
            lec.resources.append({
                "title": f"{r.title} (archive.org)" if r.title else r.archive_url,
                "url": r.archive_url,
            })

        zip_path = _resolve_zip_entry(r, zip_index)
        if zip_path:
            display_name = _HASH_PREFIX.sub("", zip_path.rsplit("/", 1)[-1])
            lec.pending_assets.append({
                "zip_path": zip_path,
                "kind": _asset_kind(r, display_name),
                "title": r.title or display_name,
                "filename": display_name,
            })

    return lec


def _lecture_content(session: SessionNode) -> str:
    """overview + first lecture-notes text, else transcript. Capped."""
    parts: list[str] = []
    if session.overview:
        parts.append(session.overview)

    notes = next(
        (r.extracted_text for r in session.resources
         if r.extracted_text and "Notes" in r.primary_type),
        None,
    )
    if notes:
        parts.append(notes)
    else:
        transcript = next(
            (r.transcript_text for r in session.resources if r.transcript_text),
            None,
        )
        if transcript:
            parts.append(transcript[:_TRANSCRIPT_LIMIT])

    return "\n\n".join(parts)[:_CONTENT_LIMIT].strip()


# ── Asset resolution ──────────────────────────────────────────────────────────

def _build_zip_index(zip_names: Iterable[str]) -> dict[str, str]:
    """basename (and hash-stripped basename) → zip entry name."""
    idx: dict[str, str] = {}
    for n in sorted(zip_names):
        if n.endswith("/"):
            continue
        base = n.rsplit("/", 1)[-1].lower()
        idx.setdefault(base, n)
        stripped = _HASH_PREFIX.sub("", base)
        if stripped != base:
            idx.setdefault(stripped, n)
    return idx


def _resolve_zip_entry(r: ResourceNode, zip_index: dict[str, str]) -> Optional[str]:
    """Map a resource's `file` field to an actual zip entry, or None."""
    if not r.file_path or not util.is_document(r.file_path):
        return None
    base = r.file_path.rstrip("/").rsplit("/", 1)[-1].lower()
    hit = zip_index.get(base)
    if hit:
        return hit
    return zip_index.get(_HASH_PREFIX.sub("", base))


_KIND_BY_TYPE: list[tuple[str, str]] = [
    ("solution",      "solution"),
    ("problem set",   "problem-set"),
    ("assignment",    "problem-set"),
    ("slide",         "slides"),
    ("presentation",  "slides"),
    ("lecture note",  "lecture-notes"),
    ("reading",       "lecture-notes"),
]


def _asset_kind(r: ResourceNode, filename: str) -> str:
    hay = " ".join([r.primary_type, *r.secondary_types]).lower()
    for needle, kind in _KIND_BY_TYPE:
        if needle in hay:
            return kind
    return util.classify_asset(filename, r.title)
