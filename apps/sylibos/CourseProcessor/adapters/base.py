"""Abstract interface that all format adapters must implement."""

from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path

from ..manifest import Instructor, ResourceNode


class CourseAdapter(ABC):
    def __init__(self, zip_root: Path):
        self.zip_root = zip_root

    @abstractmethod
    def parse_metadata(self) -> dict:
        """
        Return a dict matching CourseManifest top-level fields (excluding units).
        Required keys: course_id, title.
        Optional: extra_course_ids, site_uid, legacy_uid, description,
                  department_numbers, departments, topics, level, term, year,
                  instructors, learning_resource_types.
        """

    @abstractmethod
    def parse_resources(self) -> list[ResourceNode]:
        """Return flat list of all instructional resources in the course."""

    @abstractmethod
    def load_content_map(self) -> dict[str, str]:
        """Return UUID → relative-path mapping for shortcode resolution."""
