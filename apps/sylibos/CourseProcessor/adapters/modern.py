"""
Modern OCW adapter (ocw-studio / Hugo format, all export vintages).

Reads root data.json, content_map.json, and resources/*/data.json.
Falls back to slug-based metadata if root data.json is absent.

Resource field vintages handled:
  v1 (~2020):  learning_resource_types + video_metadata.youtube_id
  v2 (~2023+): resource_type ("Video"/"Document"/"Other") + youtube_key,
               learning_resource_types often empty, captions/transcript/
               archive_url fields on video resources
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

# Caption/sidecar files exposed as resources (v2 exports list every static
# file as a resource; the .vtt/.srt entries duplicate static_resources/ and
# the "3play" PDFs are machine-generated transcript sidecars)
_CAPTION_FILE_TYPES = frozenset({
    "application/x-subrip", "text/vtt", "text/srt",
})
_JUNK_TITLE_PAT = re.compile(r"^3play\b|caption file$", re.IGNORECASE)
_CAPTION_EXT_PAT = re.compile(r"\.(vtt|srt)$", re.IGNORECASE)

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

_LECTUREISH_PAT = re.compile(
    r"lecture|^lec[\s._-]|^ses[\s._-]?\d|session|^l\d{1,2}\b|^\d{1,2}[\s.:_-]",
    re.IGNORECASE,
)
_RECITATIONISH_PAT = re.compile(r"recitation|problem[\s-]*solving", re.IGNORECASE)

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
    (re.compile(r"exam|quiz|midterm|final",              re.IGNORECASE), "Exams"),
    (re.compile(r"sol(?:ution|n)?s?\b|_sol\b|[-_]sol\b", re.IGNORECASE), "Problem Set Solutions"),
    (re.compile(r"problem|pset|homework|\bhw\b|assignment", re.IGNORECASE), "Problem Sets"),
    (re.compile(r"recitation|\brec[-_]",                 re.IGNORECASE), "Recitations"),
    (re.compile(r"reading",                              re.IGNORECASE), "Readings"),
    (re.compile(r"slide|deck",                           re.IGNORECASE), "Presentation Assets"),
    (re.compile(r"lecture|^lec[-_]|^l\d|note|summary|\bsum\b", re.IGNORECASE), "Lecture Notes"),
]


def _infer_document_types(slug: str, title: str, file_path: str) -> list[str]:
    """Classify an untyped document by slug/title/filename keywords."""
    hay = f"{slug} {title} {Path(file_path or '').name}"
    for pat, label in _SLUG_TYPE_HINTS:
        if pat.search(hay):
            return [label]
    return ["Lecture Notes"]  # unclassified PDF → assume lecture notes


def _extract_yt_from_url(url: str) -> str | None:
    m = (re.search(r"[?&]v=([A-Za-z0-9_-]{11})", url)
         or re.search(r"/(?:embed|v)/([A-Za-z0-9_-]{11})", url)
         or re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", url))
    return m.group(1) if m else None


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
        if not isinstance(data, dict):
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
        # Some exports carry instructors as plain strings
        instructors += [
            Instructor(last_name=str(i).strip())
            for i in (data.get("instructors") or [])
            if isinstance(i, str) and str(i).strip()
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
        for data_path in sorted(resources_dir.rglob("data.json")):
            slug = data_path.parent.name
            try:
                raw = json.loads(data_path.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue
            if not isinstance(raw, dict) or raw.get("deleted"):
                continue

            node = self._parse_resource(slug, raw)
            if node is not None:
                results.append(node)

        return results

    def _parse_resource(self, slug: str, raw: dict) -> ResourceNode | None:
        title     = str(raw.get("title") or slug).strip()
        file_path = raw.get("file") or ""
        file_type = raw.get("file_type") or ""
        rtype     = raw.get("resource_type") or ""
        types     = _coerce_str_list(raw.get("learning_resource_types"))

        # Caption sidecars duplicate static_resources/ and pollute the catalog
        if file_type in _CAPTION_FILE_TYPES or _CAPTION_EXT_PAT.search(file_path):
            return None
        if _JUNK_TITLE_PAT.search(title):
            return None

        youtube_id  = self._extract_youtube_id(raw, slug)
        archive_url = raw.get("archive_url") or None
        is_video = bool(
            youtube_id
            or rtype == "Video"
            or any("Video" in t for t in types)
        )

        if is_video:
            if not types:
                types = self._classify_video(slug, title)
        else:
            if file_type in _SKIP_FILE_TYPES:
                return None
            if not types:
                is_doc = (rtype == "Document"
                          or file_type == "application/pdf"
                          or file_path.lower().endswith(".pdf"))
                if not is_doc:
                    return None  # no useful classification possible
                types = _infer_document_types(slug, title, file_path)

        return ResourceNode(
            slug=slug,
            uid=raw.get("uid") or raw.get("id") or raw.get("site_uid"),
            parent_uid=raw.get("parent_uid") or raw.get("parent_id"),
            title=title,
            description=raw.get("description") or "",
            primary_type=types[0],
            secondary_types=types[1:],
            file_path=file_path,
            file_type=file_type,
            youtube_id=youtube_id,
            archive_url=archive_url,
        )

    @staticmethod
    def _classify_video(slug: str, title: str) -> list[str]:
        """Type an untyped video by name; non-lecture material → Other Video."""
        hay = f"{slug} {title}"
        if _RECITATIONISH_PAT.search(hay):
            return ["Problem-solving Videos"]
        if _LECTUREISH_PAT.search(hay):
            return ["Lecture Videos"]
        # Mostly non-ASCII titles are translated duplicates (e.g. zh-hans dubs)
        if title and sum(1 for c in title if ord(c) > 127) > len(title) / 2:
            return ["Other Video"]
        return ["Lecture Videos"]

    # ── Content map ───────────────────────────────────────────────────────────

    def load_content_map(self) -> dict[str, str]:
        p = self.zip_root / "content_map.json"
        if not p.exists():
            return {}
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
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
    def _extract_youtube_id(raw: dict, slug: str) -> str | None:
        # v2 exports: youtube_key directly on the resource
        yk = str(raw.get("youtube_key") or "").strip()
        if _YT_ID.match(yk):
            return yk

        # v1 exports: video_metadata block
        vm = raw.get("video_metadata") or {}
        if isinstance(vm, dict):
            if vm.get("youtube_id") and _YT_ID.match(str(vm["youtube_id"])):
                return str(vm["youtube_id"])
            for field in ("youtube_description_url", "youtube_embed_url", "youtube_url"):
                got = _extract_yt_from_url(str(vm.get(field) or ""))
                if got:
                    return got

        # Some courses put a YouTube URL straight in the file field
        got = _extract_yt_from_url(str(raw.get("file") or ""))
        if got:
            return got

        # Slug heuristic only when the resource is explicitly a video
        is_video = (raw.get("resource_type") == "Video"
                    or any("Video" in t
                           for t in _coerce_str_list(raw.get("learning_resource_types"))))
        if is_video and _YT_ID.match(slug):
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
