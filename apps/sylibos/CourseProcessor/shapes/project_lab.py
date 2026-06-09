"""
Project / lab shape builder.

pages/ has top-level dirs matching project-*, lab-*, studio-*, design-*.
Each such dir becomes a unit; its sub-pages become sessions.
If a dir has no sub-pages, the dir itself becomes a single-session unit.
"""

from __future__ import annotations
import re
from pathlib import Path

from .._utils import enrich_overview, html_to_text, read_json, str_field
from ..manifest import SessionNode, UnitNode
from .base import SpineBuilder

_PROJECT_PAT    = re.compile(r"^(project|lab|studio|design)-", re.IGNORECASE)
_SKIP_SLUGS     = frozenset({
    "syllabus", "resource-index", "instructor-insights", "related-resources",
})
_ASSESSMENT_PAT = re.compile(
    r"deliverable|due[-\s]date|milestone|submission|report|exam|quiz",
    re.IGNORECASE,
)


class ProjectLabBuilder(SpineBuilder):

    def build(self) -> list[UnitNode]:
        pages_dir = self.zip_root / "pages"
        if not pages_dir.is_dir():
            return []

        unit_dirs = sorted(
            d for d in pages_dir.iterdir()
            if d.is_dir()
            and _PROJECT_PAT.match(d.name)
            and d.name not in _SKIP_SLUGS
        )

        units: list[UnitNode] = []
        for unit_idx, unit_dir in enumerate(unit_dirs):
            up = unit_dir / "data.json"
            if not up.exists():
                continue
            try:
                unit_data = read_json(up)
            except ValueError:
                continue

            if unit_data.get("deleted"):
                continue

            sub_dirs = sorted(
                d for d in unit_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            )

            sessions: list[SessionNode] = []
            for si, sub in enumerate(sub_dirs):
                sp = sub / "data.json"
                if not sp.exists():
                    continue
                try:
                    data = read_json(sp)
                except ValueError:
                    continue
                if data.get("deleted"):
                    continue
                content = data.get("content") or ""
                is_assessment = bool(
                    _ASSESSMENT_PAT.search(sub.name)
                    or _ASSESSMENT_PAT.search(content[:500])
                )
                sessions.append(SessionNode(
                    slug=sub.name,
                    title=str_field(data, "title", sub.name),
                    overview=enrich_overview(html_to_text(data.get("content")), data),
                    is_assessment=is_assessment,
                    order=si,
                    page_uid=data.get("uid") or data.get("id"),
                ))

            if not sessions:
                # The unit dir itself is a single-session unit
                sessions = [SessionNode(
                    slug=unit_dir.name,
                    title=str_field(unit_data, "title", unit_dir.name),
                    overview=enrich_overview(html_to_text(unit_data.get("content")), unit_data),
                    is_assessment=False,
                    order=0,
                    page_uid=unit_data.get("uid") or unit_data.get("id"),
                )]

            units.append(UnitNode(
                slug=unit_dir.name,
                title=str_field(unit_data, "title", unit_dir.name),
                overview=html_to_text(unit_data.get("content")),
                order=unit_idx,
                sessions=sessions,
                is_synthetic=False,
            ))

        return units
