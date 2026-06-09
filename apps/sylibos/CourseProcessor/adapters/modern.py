"""
Modern OCW adapter (ocw-studio / Hugo format, post-2015).

Reads root data.json, content_map.json, and resources/*/data.json.
Falls back to slug-based metadata if root data.json is absent.
"""

from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Any

from ..manifest import Instructor, ResourceNode
from .base import CourseAdapter


# ── Department number → name lookup ──────────────────────────────────────────

_DEPT_MAP: dict[str, str] = {
    "1":   "Civil & Environmental Engineering",
    "2":   "Mechanical Engineering",
    "3":   "Materials Science & Engineering",
    "4":   "Architecture",
    "5":   "Chemistry",
    "6":   "Electrical Engineering & Computer Science",
    "7":   "Biology",
    "8":   "Physics",
    "9":   "Brain & Cognitive Sciences",
    "10":  "Chemical Engineering",
    "11":  "Urban Studies & Planning",
    "12":  "Earth, Atmospheric & Planetary Sciences",
    "14":  "Economics",
    "15":  "Management",
    "16":  "Aeronautics & Astronautics",
    "17":  "Political Science",
    "18":  "Mathematics",
    "20":  "Biological Engineering",
    "21":  "Humanities",
    "21A": "Anthropology",
    "21G": "Global Languages",
    "21H": "History",
    "21L": "Literature",
    "21M": "Music & Theater Arts",
    "22":  "Nuclear Science & Engineering",
    "24":  "Linguistics & Philosophy",
    "STS": "Science, Technology & Society",
    "EC":  "Edgerton Center",
    "ES":  "Experimental Study Group",
    "HST": "Health Sciences & Technology",
    "MAS": "Media Arts & Sciences",
    "SP":  "Special Programs",
}

# File types with no instructional text value
_SKIP_FILE_TYPES = frozenset({
    "image/jpeg", "image/png", "image/gif",
    "image/webp", "image/svg+xml", "text/plain",
})

# Matches an 11-char YouTube ID at end of a string
_YT_ID_PAT = re.compile(r"[A-Za-z0-9_-]{11}$")

# ── Field normalisation helpers ───────────────────────────────────────────────

def _coerce_str_list(raw: Any) -> list[str]:
    """Convert whatever OCW sends for a string-list field to list[str]."""
    if not raw:
        return []
    if isinstance(raw, str):
        return [raw] if raw.strip() else []
    if isinstance(raw, list):
        return [str(s) for s in raw if s and str(s).strip()]
    return []


def _normalize_topics(raw: Any) -> list[list[str]]:
    """
    OCW topics can be:
      [[str, str, ...], ...]    — expected shape
      [{topic: str, subtopic: str, ...}, ...]  — dict form (some exports)
      [str, str, ...]           — flat list (rare)
    """
    if not isinstance(raw, list):
        return []
    out: list[list[str]] = []
    for item in raw:
        if isinstance(item, list):
            row = [str(s) for s in item if s and str(s).strip()]
            if row:
                out.append(row)
        elif isinstance(item, dict):
            row = [
                str(item[k]) for k in ("topic", "subtopic", "specialty")
                if item.get(k) and str(item[k]).strip()
            ]
            if row:
                out.append(row)
        elif isinstance(item, str) and item.strip():
            out.append([item])
    return out


def _normalize_level(raw: Any) -> list[str]:
    """Coerce OCW level field (sometimes a bare string, sometimes a list)."""
    if isinstance(raw, list):
        return [str(s) for s in raw if s and str(s).strip()]
    if isinstance(raw, str) and raw.strip():
        return [raw]
    return []


_SLUG_TYPE_HINTS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"lecture|^lec[-_]|^l\d", re.IGNORECASE), "Lecture Notes"),
    (re.compile(r"exam|quiz|midterm|final",              re.IGNORECASE), "Exams"),
    (re.compile(r"problem|pset|homework|hw|assignment",  re.IGNORECASE), "Problem Sets"),
    (re.compile(r"recitation|rec[-_]",                  re.IGNORECASE), "Recitations"),
    (re.compile(r"reading",                              re.IGNORECASE), "Readings"),
]


def _infer_resource_types(slug: str, file_type: str) -> list[str]:
    """
    Guess resource type from slug keywords and file_type when
    learning_resource_types is missing.  Returns [] to skip the resource
    if no useful classification can be made.
    """
    if file_type == "application/pdf" or file_type == "":
        for pat, label in _SLUG_TYPE_HINTS:
            if pat.search(slug):
                return [label]
        if file_type == "application/pdf":
            return ["Lecture Notes"]  # unclassified PDF → assume lecture notes
    return []


class ModernAdapter(CourseAdapter):

    # ── Metadata ──────────────────────────────────────────────────────────────

    def parse_metadata(self) -> dict:
        data_path = self.zip_root / "data.json"
        if not data_path.exists():
            return self._metadata_from_slug()

        try:
            data = json.loads(data_path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            return self._metadata_from_slug()

        dept_numbers: list[str] = _coerce_str_list(data.get("department_numbers"))
        instructors = [
            Instructor(
                first_name=i.get("first_name") or "",
                last_name=i.get("last_name") or "",
                middle_initial=i.get("middle_initial") or "",
                salutation=i.get("salutation") or "",
                title=i.get("title") or "",
            )
            for i in (data.get("instructors") or [])
            if isinstance(i, dict)
        ]

        return {
            "course_id":              self._normalize_course_id(
                                          data.get("primary_course_number") or ""
                                          or self._slug_course_id()
                                      ),
            "extra_course_ids":       self._parse_extra_numbers(
                                          data.get("extra_course_numbers") or ""
                                      ),
            "site_uid":               data.get("site_uid") or "",
            "legacy_uid":             data.get("legacy_uid"),
            "title":                  data.get("course_title") or "",
            "description":            data.get("course_description") or "",
            "department_numbers":     dept_numbers,
            "departments":            [_DEPT_MAP.get(n, n) for n in dept_numbers],
            "topics":                 _normalize_topics(data.get("topics")),
            "level":                  _normalize_level(data.get("level")),
            "term":                   data.get("term") or "",
            "year":                   str(data.get("year") or ""),
            "instructors":            instructors,
            "learning_resource_types": _coerce_str_list(data.get("learning_resource_types")),
        }

    # ── Resources ─────────────────────────────────────────────────────────────

    def parse_resources(self) -> list[ResourceNode]:
        resources_dir = self.zip_root / "resources"
        if not resources_dir.is_dir():
            return []

        results: list[ResourceNode] = []
        for data_path in resources_dir.rglob("data.json"):
            slug = data_path.parent.name
            try:
                raw = json.loads(data_path.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue

            types = _coerce_str_list(raw.get("learning_resource_types"))
            file_type = raw.get("file_type") or ""

            if not types:
                # Heuristically classify untyped resources by file extension / slug
                types = _infer_resource_types(slug, file_type)
                if not types:
                    continue

            if file_type in _SKIP_FILE_TYPES:
                continue

            # Skip soft-deleted resources
            if raw.get("deleted"):
                continue

            is_video = any("Video" in t for t in types)
            youtube_id = self._extract_youtube_id(raw, slug, is_video=is_video)

            results.append(ResourceNode(
                slug=slug,
                uid=raw.get("uid") or raw.get("id") or raw.get("site_uid"),
                parent_uid=raw.get("parent_uid") or raw.get("parent_id"),
                title=raw.get("title") or slug,
                description=raw.get("description") or "",
                primary_type=types[0],
                secondary_types=types[1:],
                file_path=raw.get("file") or "",
                file_type=file_type,
                youtube_id=youtube_id,
            ))

        return results

    # ── Content map ───────────────────────────────────────────────────────────

    def load_content_map(self) -> dict[str, str]:
        p = self.zip_root / "content_map.json"
        if not p.exists():
            return {}
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {}

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_course_id(raw: str) -> str:
        return raw.strip().upper().replace(" ", "")

    @staticmethod
    def _parse_extra_numbers(raw) -> list[str]:
        if not raw:
            return []
        if isinstance(raw, list):
            return [str(n).strip().upper() for n in raw if n and str(n).strip()]
        return [n.strip().upper() for n in str(raw).split(",") if n.strip()]

    @staticmethod
    def _extract_youtube_id(raw: dict, slug: str, *, is_video: bool = False) -> str | None:
        vm = raw.get("video_metadata") or {}

        if vm.get("youtube_id"):
            return vm["youtube_id"]

        # Some exports use description/embed URL fields instead of youtube_id
        _YT_URL_FIELDS = ("youtube_description_url", "youtube_embed_url", "youtube_url")
        for field in _YT_URL_FIELDS:
            url = vm.get(field) or ""
            m = (re.search(r"[?&]v=([A-Za-z0-9_-]{11})", url)
                 or re.search(r"/(?:embed|v)/([A-Za-z0-9_-]{11})", url)
                 or re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", url))
            if m:
                return m.group(1)

        # Check the file field for YouTube URLs (some courses link directly)
        file_url = raw.get("file") or ""
        m = (re.search(r"[?&]v=([A-Za-z0-9_-]{11})", file_url)
             or re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", file_url))
        if m:
            return m.group(1)

        # Slug heuristic only applies to video resources — non-video slugs that
        # happen to be 11 chars (e.g. "lecture-pdf") would produce false positives
        if is_video and re.match(r"^[A-Za-z0-9_-]{11}$", slug):
            return slug
        return None

    def _slug_course_id(self) -> str:
        """Derive course_id from the directory slug when data.json is absent."""
        slug  = self.zip_root.name
        parts = slug.split("-")
        dept  = parts[0].upper() if parts else "UNKNOWN"
        num   = parts[1] if len(parts) > 1 else ""
        digits  = re.match(r"^\d+", num)
        variant = re.sub(r"^\d+", "", num).upper()
        return f"{dept}.{digits.group(0)}{variant}" if digits else dept

    def _metadata_from_slug(self) -> dict:
        """Minimal metadata derived from the directory slug."""
        slug  = self.zip_root.name
        parts = slug.split("-")

        year_m   = re.search(r"(20\d{2}|19\d{2})", slug)
        year     = year_m.group(1) if year_m else ""
        season_m = re.search(r"\b(fall|spring|summer|winter)\b", slug)
        season   = season_m.group(1).title() if season_m else ""
        term     = f"{season} {year}".strip()

        return {
            "course_id":              self._slug_course_id(),
            "extra_course_ids":       [],
            "site_uid":               "",
            "legacy_uid":             None,
            "title":                  "",
            "description":            "",
            "department_numbers":     [],
            "departments":            [],
            "topics":                 [],
            "level":                  [],
            "term":                   term,
            "year":                   year,
            "instructors":            [],
            "learning_resource_types": [],
        }
