"""Intermediate representation for an ingested course.

This is the single normalized shape every layout adapter produces and every
later stage (validate, report, load-into-library.db) consumes. It mirrors the
library.db schema 1:1, so load is a near-mechanical insert.

Asset bytes are NOT held here. During build, asset files are extracted to the
build directory and referenced by rel_path; load reads the bytes from disk
and writes them into library.db as BLOBs.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional

TOOL_VERSION = "2.0.0"
SCHEMA_VERSION = 1

ASSET_KINDS = ("lecture-notes", "problem-set", "solution", "slides", "other")


@dataclass
class Asset:
    kind: str
    title: str
    filename: str
    rel_path: str
    mime: str
    sha256: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Lecture:
    title: str
    ord: int
    content: str = ""
    unit_title: str = ""
    section: Optional[str] = None
    videos: list[dict[str, str]] = field(default_factory=list)
    resources: list[dict[str, str]] = field(default_factory=list)
    assets: list[Asset] = field(default_factory=list)

    pending_assets: list[dict[str, str]] = field(default_factory=list, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "ord": self.ord,
            "content": self.content,
            "unit_title": self.unit_title,
            "section": self.section,
            "videos": self.videos,
            "resources": self.resources,
            "assets": [a.to_dict() for a in self.assets],
        }

    @property
    def has_video(self) -> bool:
        return len(self.videos) > 0


@dataclass
class Unit:
    title: str
    ord: int
    lectures: list[Lecture] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "ord": self.ord,
            "lectures": [lec.to_dict() for lec in self.lectures],
        }


@dataclass
class Course:
    slug: str
    title: str
    description: str = ""
    instructor: str = ""
    subject: str = ""
    level: str = ""
    course_number: str = ""
    term: str = ""
    ocw_url: Optional[str] = None
    layout_format: str = ""
    used_ai_split: bool = False
    schema_version: int = SCHEMA_VERSION
    tool_version: str = TOOL_VERSION
    units: list[Unit] = field(default_factory=list)

    @property
    def lectures(self) -> list[Lecture]:
        return [lec for u in self.units for lec in u.lectures]

    @property
    def lecture_count(self) -> int:
        return len(self.lectures)

    @property
    def has_video(self) -> bool:
        return any(lec.has_video for lec in self.lectures)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "tool_version": self.tool_version,
            "slug": self.slug,
            "course_number": self.course_number,
            "term": self.term,
            "ocw_url": self.ocw_url,
            "layout_format": self.layout_format,
            "used_ai_split": self.used_ai_split,
            "meta": {
                "title": self.title,
                "description": self.description,
                "instructor": self.instructor,
                "subject": self.subject,
                "level": self.level,
            },
            "stats": {
                "unit_count": len(self.units),
                "lecture_count": self.lecture_count,
                "has_video": self.has_video,
            },
            "units": [u.to_dict() for u in self.units],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Course":
        meta = d.get("meta", {})
        course = cls(
            slug=d["slug"],
            title=meta.get("title", ""),
            description=meta.get("description", ""),
            instructor=meta.get("instructor", ""),
            subject=meta.get("subject", ""),
            level=meta.get("level", ""),
            course_number=d.get("course_number", ""),
            term=d.get("term", ""),
            ocw_url=d.get("ocw_url"),
            layout_format=d.get("layout_format", ""),
            used_ai_split=bool(d.get("used_ai_split", False)),
            schema_version=int(d.get("schema_version", SCHEMA_VERSION)),
            tool_version=d.get("tool_version", TOOL_VERSION),
        )
        for ud in d.get("units", []):
            unit = Unit(title=ud["title"], ord=int(ud.get("ord", 0)))
            for ld in ud.get("lectures", []):
                lec = Lecture(
                    title=ld["title"],
                    ord=int(ld.get("ord", 0)),
                    content=ld.get("content", ""),
                    unit_title=ld.get("unit_title", unit.title),
                    section=ld.get("section"),
                    videos=ld.get("videos", []),
                    resources=ld.get("resources", []),
                    assets=[
                        Asset(
                            kind=a["kind"], title=a["title"], filename=a["filename"],
                            rel_path=a["rel_path"], mime=a["mime"], sha256=a["sha256"],
                        )
                        for a in ld.get("assets", [])
                    ],
                )
                unit.lectures.append(lec)
            course.units.append(unit)
        return course
