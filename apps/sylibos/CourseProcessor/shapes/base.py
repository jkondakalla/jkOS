"""
Abstract SpineBuilder.

All shape builders extend SpineBuilder. The default link_resources()
delegates to linking.link_resources_for_spine (exact page references →
parent_uid → gated fuzzy matching). Shape builders that need a different
strategy (e.g. video_only) override it.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path

from ..linking import link_resources_for_spine
from ..manifest import ResourceNode, UnitNode


class SpineBuilder(ABC):
    def __init__(self, zip_root: Path, adapter):
        self.zip_root = zip_root
        self.adapter  = adapter

    @abstractmethod
    def build(self) -> list[UnitNode]:
        """Return the ordered list of units with sessions."""

    def link_resources(
        self,
        units: list[UnitNode],
        resources: list[ResourceNode],
    ) -> list[ResourceNode]:
        """Attach resources to sessions. Returns unlinked remainder."""
        return link_resources_for_spine(
            units, resources, self.zip_root, self.adapter.load_content_map()
        )
