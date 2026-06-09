"""
CourseManifest → SylibOS Course JSON  (v2)

Converts the structured preprocessor output into the flat Course + Lecture
format expected by the SylibOS backend API (/api/courses).

Mapping rules:
  UnitNode              → Lecture.unit
  SessionNode           → Lecture  (assessment sessions excluded by default)
  session.overview
  + lecture_notes[0].extracted_text  → Lecture.content (capped at 8 000 chars)
  resource.youtube_id   → Lecture.videoUrl  (YouTube URL)
"""

from __future__ import annotations
import random
import re
import string
import time
from typing import Any

from .manifest import CourseManifest, SessionNode, UnitNode


_CONTENT_LIMIT = 8_000

_YT_PAT  = re.compile(
    r"https?://(?:www\.)?youtube\.com/(?:watch\?v=|embed/|v/)[\w-]+"
    r"|https?://youtu\.be/[\w-]+"
)
_ARC_PAT = re.compile(r"https?://archive\.org/(?:details|download)/[\w./-]+")


def _rand_id(length: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))


def _extract_video_url(session: SessionNode) -> str | None:
    for resource in session.resources:
        if "Video" not in resource.primary_type:
            continue
        # Prefer the youtube_id field (set by ModernAdapter from video_metadata)
        if resource.youtube_id:
            return f"https://www.youtube.com/watch?v={resource.youtube_id}"
        # Fall back to URL patterns in file_path or description
        for text in (resource.file_path or "", resource.description):
            m = _YT_PAT.search(text) or _ARC_PAT.search(text)
            if m:
                return m.group(0)
    return None


def _build_lecture_content(session: SessionNode) -> str:
    """
    overview + first lecture_notes.extracted_text, capped at _CONTENT_LIMIT.
    Falls back to transcript text when no PDF notes were extracted.
    """
    parts: list[str] = []
    if session.overview:
        parts.append(session.overview)

    notes_text = next(
        (r.extracted_text for r in session.resources
         if r.primary_type == "Lecture Notes" and r.extracted_text),
        None,
    )
    if notes_text:
        parts.append(notes_text)
    else:
        # No PDF notes — use transcript as a content source (capped to avoid bloat)
        transcript = next(
            (r.transcript_text for r in session.resources if r.transcript_text),
            None,
        )
        if transcript:
            parts.append(transcript[:4_000])

    return "\n\n".join(parts)[:_CONTENT_LIMIT].strip()


def manifest_to_course(
    manifest: CourseManifest,
    exclude_exams: bool = True,
) -> dict[str, Any]:
    """
    Convert a CourseManifest to a SylibOS Course dict ready for POST /api/courses.

    Parameters
    ----------
    manifest       : parsed CourseManifest (v2)
    exclude_exams  : if True, sessions with is_assessment=True are omitted
    """
    course_id = _rand_id()
    lectures: list[dict[str, Any]] = []
    order = 1

    for unit in manifest.units:
        for session in unit.sessions:
            if exclude_exams and session.is_assessment:
                continue

            lectures.append({
                "id":         _rand_id(),
                "courseId":   course_id,
                "title":      session.title,
                "unit":       unit.title,
                "section":    None,
                "order":      order,
                "content":    _build_lecture_content(session),
                "videoUrl":   _extract_video_url(session),
                "hasSegment": False,
                "segmentId":  None,
            })
            order += 1

    description = manifest.description or manifest.goals or ""
    if manifest.prerequisites:
        description = f"{description}\n\nPrerequisites: {manifest.prerequisites}".strip()

    instructor = ""
    if manifest.instructors:
        i = manifest.instructors[0]
        parts = [p for p in (i.first_name, i.last_name) if p]
        instructor = " ".join(parts)

    subject = (
        manifest.departments[0] if manifest.departments
        else manifest.department_numbers[0] if manifest.department_numbers
        else ""
    )

    level = (
        manifest.level[0] if manifest.level
        else manifest.term or ""
    )

    return {
        "id":                course_id,
        "title":             manifest.title,
        "description":       description,
        "instructor":        instructor,
        "subject":           subject,
        "level":             level,
        "importedAt":        int(time.time() * 1000),
        "completedSegments": 0,
        "lectures":          lectures,
    }


def manifest_to_lesson_context(
    manifest: CourseManifest,
    unit_slug: str,
    session_slug: str,
    prior_session_count: int = 3,
) -> dict[str, Any]:
    """
    Build the AI prompt context for a single session.
    Matches the interface from spec section 8 (context_for_session).

    Never passes the full manifest — session + course context is sufficient.
    """
    unit: UnitNode | None = next(
        (u for u in manifest.units if u.slug == unit_slug), None
    )
    if not unit:
        raise ValueError(f"Unit '{unit_slug}' not found in manifest")

    session: SessionNode | None = next(
        (s for s in unit.sessions if s.slug == session_slug), None
    )
    if not session:
        raise ValueError(f"Session '{session_slug}' not found in unit '{unit_slug}'")

    all_sessions = [s for u in manifest.units for s in u.sessions]
    idx = next((i for i, s in enumerate(all_sessions) if s is session), -1)
    prior_titles = (
        [s.title for s in all_sessions[max(0, idx - prior_session_count): idx]]
        if idx > 0 else []
    )

    return {
        "course": {
            "title":       manifest.title,
            "id":          manifest.course_id,
            "level":       manifest.level,
            "topics":      manifest.topics,
            "description": manifest.description[:1000],
        },
        "unit": {
            "title":    unit.title,
            "overview": unit.overview,
        },
        "session": {
            "title":         session.title,
            "overview":      session.overview,
            "is_assessment": session.is_assessment,
            "lecture_notes": [
                r.extracted_text
                for r in session.resources
                if r.primary_type == "Lecture Notes" and r.extracted_text
            ],
            "transcripts": [
                r.transcript_text
                for r in session.resources
                if r.transcript_text
            ],
            "problem_sets": [
                r.description
                for r in session.resources
                if r.primary_type == "Problem Sets"
            ],
        },
        "prior_session_titles": prior_titles,
    }
