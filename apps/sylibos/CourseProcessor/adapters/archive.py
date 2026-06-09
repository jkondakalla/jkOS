"""
Internet Archive adapter stub.

Pre-2005 OCW courses sourced from archive.org have no standardised structure.
This adapter is a documented extension point for v2+.
"""

from __future__ import annotations
from pathlib import Path

from ..manifest import ResourceNode
from .base import CourseAdapter


class ArchiveAdapter(CourseAdapter):

    def parse_metadata(self) -> dict:
        raise NotImplementedError(
            "Internet Archive format is not yet supported. "
            "Download a modern OCW zip from ocw.mit.edu instead, "
            "or hand-craft a CourseManifest JSON and POST to /api/import-manifest."
        )

    def parse_resources(self) -> list[ResourceNode]:
        raise NotImplementedError("ArchiveAdapter not implemented")

    def load_content_map(self) -> dict[str, str]:
        return {}
