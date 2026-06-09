"""
Legacy OCW adapter (Plone export, pre-2015).

Plone exports have an OcwWeb/ directory or a top-level 0/ folder.
Full parsing wraps mitodl/ocw-data-parser (pip install ocw-data-parser).
"""

from __future__ import annotations
from pathlib import Path

from ..manifest import ResourceNode
from .base import CourseAdapter


class LegacyAdapter(CourseAdapter):

    def parse_metadata(self) -> dict:
        try:
            return self._parse_with_ocw_data_parser()
        except ImportError:
            raise RuntimeError(
                "Legacy OCW format requires ocw-data-parser: "
                "pip install ocw-data-parser"
            )

    def parse_resources(self) -> list[ResourceNode]:
        return []

    def load_content_map(self) -> dict[str, str]:
        return {}

    def _parse_with_ocw_data_parser(self) -> dict:
        import ocw_data_parser  # noqa: F401 — validates install
        # The Plone export structure varies considerably. The minimal contract:
        # find the course JSON produced by ocw-data-parser and map it to our fields.
        # Full implementation pending — emit a warning dict so the pipeline can continue.
        return {
            "course_id":   self.zip_root.name,
            "title":       self.zip_root.name,
            "description": "",
            "department_numbers": [],
            "departments": [],
            "topics":      [],
            "level":       [],
            "term":        "",
            "year":        "",
            "instructors": [],
            "learning_resource_types": [],
        }
