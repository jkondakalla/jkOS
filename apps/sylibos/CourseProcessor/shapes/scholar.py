"""
Scholar shape builder.

Walks pages/{unit-slug}/{session-slug}/ — the two-level hierarchy used by
18.06SC Linear Algebra and other Scholar-track courses.
"""

from __future__ import annotations
import re
from pathlib import Path

from .._utils import enrich_overview, html_to_text, read_json, str_field
from ..manifest import SessionNode, UnitNode
from .base import SpineBuilder

_SKIP_SLUGS = frozenset({
    "syllabus", "resource-index", "instructor-insights",
    "related-resources", "exams", "readings",
})

_ASSESSMENT_PAT = re.compile(r"exam|quiz|review|midterm|final", re.IGNORECASE)


class ScholarBuilder(SpineBuilder):

    def build(self) -> list[UnitNode]:
        pages_dir = self.zip_root / "pages"
        if not pages_dir.is_dir():
            return []

        unit_dirs = sorted(
            d for d in pages_dir.iterdir()
            if d.is_dir()
            and d.name not in _SKIP_SLUGS
            and not d.name.startswith(".")
        )

        units: list[UnitNode] = []
        unit_idx = 0
        for unit_dir in unit_dirs:
            data_path = unit_dir / "data.json"
            if not data_path.exists():
                continue
            try:
                unit_data = read_json(data_path)
            except ValueError:
                continue

            if unit_data.get("deleted"):
                continue

            sessions: list[SessionNode] = []
            sess_idx = 0
            for session_dir in sorted(
                d for d in unit_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ):
                sp = session_dir / "data.json"
                if not sp.exists():
                    continue
                try:
                    sess_data = read_json(sp)
                except ValueError:
                    continue

                if sess_data.get("deleted"):
                    continue

                sessions.append(SessionNode(
                    slug=session_dir.name,
                    title=str_field(sess_data, "title", session_dir.name),
                    overview=enrich_overview(html_to_text(sess_data.get("content")), sess_data),
                    is_assessment=bool(_ASSESSMENT_PAT.search(session_dir.name)),
                    order=sess_idx,
                    page_uid=sess_data.get("uid") or sess_data.get("id"),
                ))
                sess_idx += 1

            if not sessions:
                continue

            units.append(UnitNode(
                slug=unit_dir.name,
                title=str_field(unit_data, "title", unit_dir.name),
                overview=html_to_text(unit_data.get("content")),
                order=unit_idx,
                sessions=sessions,
                is_synthetic=False,
            ))
            unit_idx += 1

        return units
