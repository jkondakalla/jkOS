"""
Seminar shape builder.

Reading-heavy courses where pages/readings/ is the spine.
If readings are organized by week (week-1-readings/, week-2-readings/),
each week becomes a unit. Otherwise all readings go into one synthetic unit.
"""

from __future__ import annotations
import re
from pathlib import Path

from .._utils import enrich_overview, html_to_text, read_json, str_field
from ..manifest import SessionNode, UnitNode
from .base import SpineBuilder

_WEEK_PAT = re.compile(r"^week-?(\d+)", re.IGNORECASE)


class SeminarBuilder(SpineBuilder):

    def build(self) -> list[UnitNode]:
        readings_dir = self.zip_root / "pages" / "readings"
        if not readings_dir.is_dir():
            return []

        sub_dirs = sorted(
            d for d in readings_dir.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        )

        # Detect week-based organisation
        if any(_WEEK_PAT.match(d.name) for d in sub_dirs):
            return self._build_by_week(sub_dirs)
        else:
            return self._build_flat(readings_dir, sub_dirs)

    def _build_by_week(self, week_dirs: list[Path]) -> list[UnitNode]:
        units: list[UnitNode] = []
        unit_idx = 0
        for week_dir in week_dirs:
            if not _WEEK_PAT.match(week_dir.name):
                continue
            up = week_dir / "data.json"
            title = week_dir.name.replace("-", " ").title()
            overview = ""
            if up.exists():
                try:
                    d = read_json(up)
                    title    = str_field(d, "title", title)
                    overview = html_to_text(d.get("content"))
                except ValueError:
                    pass

            sessions: list[SessionNode] = []
            for si, sub in enumerate(sorted(
                s for s in week_dir.iterdir()
                if s.is_dir() and not s.name.startswith(".")
            )):
                sp = sub / "data.json"
                if not sp.exists():
                    continue
                try:
                    data = read_json(sp)
                except ValueError:
                    continue
                if data.get("deleted"):
                    continue
                sessions.append(SessionNode(
                    slug=sub.name,
                    title=str_field(data, "title", sub.name),
                    overview=enrich_overview(html_to_text(data.get("content")), data),
                    is_assessment=False,
                    order=si,
                    page_uid=data.get("uid") or data.get("id"),
                ))

            if not sessions:
                continue

            units.append(UnitNode(
                slug=week_dir.name,
                title=title,
                overview=overview,
                order=unit_idx,
                sessions=sessions,
                is_synthetic=False,
            ))
            unit_idx += 1

        return units

    def _build_flat(self, readings_dir: Path, sub_dirs: list[Path]) -> list[UnitNode]:
        """All readings → one synthetic unit."""
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
            sessions.append(SessionNode(
                slug=sub.name,
                title=str_field(data, "title", sub.name),
                overview=enrich_overview(html_to_text(data.get("content")), data),
                is_assessment=False,
                order=si,
                page_uid=data.get("uid") or data.get("id"),
            ))

        if not sessions:
            return []

        return [UnitNode(
            slug="readings",
            title="Readings",
            overview="",
            order=0,
            sessions=sessions,
            is_synthetic=True,
        )]
