"""
Scholar shape builder.

Walks the unit hierarchy used by Scholar-track courses:

  two-level:   pages/{unit}/{session}/            (e.g. 18.06SC)
  three-level: pages/{unit}/{part}/{session}/     (e.g. 18.01SC)

Levels are detected per part: a second-level dir whose children carry their
own data.json is an intermediate "part" — its leaf dirs become sessions
tagged with the part title via SessionNode.section. A second-level dir with
no such children (e.g. exam-1/) is itself a session. Ordering follows the
rendered navigation (see ordering.py), not slug alphabetics.
"""

from __future__ import annotations
import re
from pathlib import Path

from .._utils import enrich_overview, html_to_text, read_json, str_field
from ..manifest import SessionNode, UnitNode
from ..ordering import ordered_dirs
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

        unit_dirs = ordered_dirs(
            [
                d for d in pages_dir.iterdir()
                if d.is_dir()
                and d.name not in _SKIP_SLUGS
                and not d.name.startswith(".")
            ],
            [self.zip_root / "index.html", pages_dir / "index.html"],
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
            for child in self._child_dirs(unit_dir):
                child_data = self._page_data(child)
                if child_data is None:
                    continue

                leaf_dirs = [
                    d for d in self._child_dirs(child)
                    if (d / "data.json").exists()
                ]
                if leaf_dirs:
                    # Three-level: child is a "part"; its leaves are sessions
                    part_title = str_field(child_data, "title", child.name)
                    for leaf in leaf_dirs:
                        leaf_data = self._page_data(leaf)
                        if leaf_data is None:
                            continue
                        sessions.append(self._session(leaf, leaf_data,
                                                      len(sessions), part_title))
                else:
                    sessions.append(self._session(child, child_data,
                                                  len(sessions), None))

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

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _child_dirs(self, parent: Path) -> list[Path]:
        return ordered_dirs(
            [
                d for d in parent.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ],
            [parent / "index.html"],
        )

    @staticmethod
    def _page_data(page_dir: Path) -> dict | None:
        sp = page_dir / "data.json"
        if not sp.exists():
            return None
        try:
            data = read_json(sp)
        except ValueError:
            return None
        if data.get("deleted"):
            return None
        return data

    def _session(self, page_dir: Path, data: dict,
                 order: int, section: str | None) -> SessionNode:
        return SessionNode(
            slug=page_dir.name,
            title=str_field(data, "title", page_dir.name),
            overview=enrich_overview(html_to_text(data.get("content")), data),
            is_assessment=bool(_ASSESSMENT_PAT.search(page_dir.name)),
            section=section,
            order=order,
            page_uid=data.get("uid") or data.get("id"),
            page_path=str(page_dir.relative_to(self.zip_root)),
        )
