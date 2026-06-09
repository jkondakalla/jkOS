"""Turn extracted Pages into a normalized Course IR by deterministic heuristics."""

from __future__ import annotations

import re
from typing import Optional

from . import util
from .extract import Page
from .ir import Asset, Course, Lecture, Unit  # noqa: F401

_NON_LECTURE = re.compile(
    r"\b(home|about|syllabus|calendar|schedule|instructor|staff|download|"
    r"index|search|related resources|bibliography|acknowledg|how to|"
    r"this course at mit)\b",
    re.IGNORECASE,
)
STRUCTURE_KEYWORDS = ("syllabus", "calendar", "schedule", "readings", "lecture-notes",
                      "lecture notes", "assignments")

_MIN_LECTURE_WORDS = 40


def build_course(pages: list[Page], *, course_number: str, term: str,
                 ocw_url: Optional[str] = None) -> tuple[Course, float]:
    meta = _extract_meta(pages, course_number=course_number, term=term)
    slug = util.slugify(f"{meta['course_number'] or meta['title']} {term}".strip())

    course = Course(
        slug=slug,
        title=meta["title"],
        description=meta["description"],
        instructor=meta["instructor"],
        subject=meta["subject"],
        level=meta["level"],
        course_number=meta["course_number"],
        term=term,
        ocw_url=ocw_url,
        layout_format="heuristic",
    )

    lecture_pages = [p for p in pages if _is_lecture(p)]
    if not lecture_pages:
        return course, 0.0

    groups: dict[str, list[Page]] = {}
    for p in lecture_pages:
        groups.setdefault(p.slug_segment, []).append(p)

    multi_unit = len(groups) > 1
    for u_index, (seg, group) in enumerate(_sorted_groups(groups), start=1):
        unit_title = _unit_title(seg, multi_unit, u_index)
        unit = Unit(title=unit_title, ord=u_index)
        group_sorted = sorted(group, key=lambda p: (util.leading_order(p.title, 10_000), p.path))
        for l_index, page in enumerate(group_sorted, start=1):
            unit.lectures.append(_lecture_from_page(page, unit_title, l_index))
        course.units.append(unit)

    confidence = _confidence(course, lecture_pages)
    return course, confidence


def _lecture_from_page(page: Page, unit_title: str, fallback_ord: int) -> Lecture:
    lec = Lecture(
        title=page.title,
        ord=util.leading_order(page.title, fallback_ord),
        content=page.text,
        unit_title=unit_title,
        videos=page.videos,
        resources=page.resources,
    )
    for zip_path, anchor in page.pdf_links:
        filename = zip_path.rsplit("/", 1)[-1]
        lec.pending_assets.append({
            "zip_path": zip_path,
            "kind": util.classify_asset(filename, anchor),
            "title": anchor or filename,
            "filename": filename,
        })
    return lec


def _is_lecture(page: Page) -> bool:
    if page.word_count < _MIN_LECTURE_WORDS and not page.videos and not page.pdf_links:
        return False
    if _NON_LECTURE.search(page.title):
        return False
    if any(k in page.path.lower() for k in ("syllabus", "calendar", "/about", "/download")):
        return False
    return True


def _confidence(course: Course, lecture_pages: list[Page]) -> float:
    lectures = course.lectures
    if not lectures:
        return 0.0
    numbered = sum(1 for l in lectures if util.leading_order(l.title, -1) >= 0)
    enriched = sum(1 for l in lectures if l.has_video or l.assets or len(l.content.split()) > 120)
    n = len(lectures)
    score = 0.5 * (numbered / n) + 0.5 * (enriched / n)
    if n == 1:
        score *= 0.5
    return round(score, 3)


def _extract_meta(pages: list[Page], *, course_number: str, term: str) -> dict[str, str]:
    home = _home_page(pages)
    title = ""
    description = ""
    if home is not None:
        title = _strip_course_number(home.title)
        description = _first_paragraph(home.text)
    return {
        "title": title or (course_number or "Untitled Course"),
        "description": description,
        "instructor": "",
        "subject": "",
        "level": "",
        "course_number": course_number,
    }


def _home_page(pages: list[Page]) -> Optional[Page]:
    candidates = sorted(pages, key=lambda p: (p.depth, p.path))
    for p in candidates:
        low = p.path.lower()
        if low.endswith("index.html") or "/home" in low or p.depth == 0:
            return p
    return candidates[0] if candidates else None


_COURSE_NUM_PREFIX = re.compile(r"^\s*\d+\.\w+\s*[:\-]?\s*", re.IGNORECASE)


def _strip_course_number(title: str) -> str:
    return _COURSE_NUM_PREFIX.sub("", title).strip()


def _first_paragraph(text: str, max_chars: int = 600) -> str:
    for chunk in text.split("\n\n"):
        chunk = chunk.strip()
        if len(chunk) > 80:
            return chunk[:max_chars].rstrip()
    return ""


def _sorted_groups(groups: dict[str, list[Page]]):
    def key(item):
        seg, pages = item
        first = min((util.leading_order(p.title, 10_000) for p in pages), default=10_000)
        return (first, seg)
    return sorted(groups.items(), key=key)


def _unit_title(seg: str, multi_unit: bool, index: int) -> str:
    if not multi_unit or not seg:
        return "All Sessions"
    pretty = seg.replace("-", " ").replace("_", " ").strip().title()
    return pretty or f"Unit {index}"
