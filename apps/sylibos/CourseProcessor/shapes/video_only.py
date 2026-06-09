"""
Video-only shape builder.

Courses where "Lecture Videos" resources are the spine and there are
no Lecture Notes or Problem Sets. Sessions are built directly from
video resources, ordered by lecture number if detectable.
"""

from __future__ import annotations
import re

from ..manifest import ResourceNode, SessionNode, UnitNode
from .base import SpineBuilder

_LECTURE_NUM_PAT = re.compile(r"(?:lecture|lec|L)[\s._-]*(\d+)", re.IGNORECASE)
_VIDEO_TYPES     = frozenset({"Lecture Videos", "Problem-solving Videos", "Other Video"})


def _video_sort_key(r: ResourceNode) -> tuple:
    m = _LECTURE_NUM_PAT.search(r.title)
    if m:
        return (int(m.group(1)), r.title)
    return (999, r.title)


class VideoOnlyBuilder(SpineBuilder):

    def build(self) -> list[UnitNode]:
        # No pages/ structure — spine built in link_resources() from resources
        return []

    def link_resources(
        self,
        units: list[UnitNode],
        resources: list[ResourceNode],
    ) -> list[ResourceNode]:
        """
        Override: convert video resources into sessions in a synthetic unit.
        Non-video resources become unlinked.
        """
        videos   = [r for r in resources if r.primary_type in _VIDEO_TYPES]
        unlinked = [r for r in resources if r.primary_type not in _VIDEO_TYPES]

        if not videos:
            return unlinked

        videos.sort(key=_video_sort_key)
        sessions = [
            SessionNode(
                slug=v.slug,
                title=v.title,
                overview=v.transcript_text or v.description or "",
                is_assessment=False,
                order=i,
                resources=[v],
            )
            for i, v in enumerate(videos)
        ]

        units.append(UnitNode(
            slug="lectures",
            title="Lecture Videos",
            overview="",
            order=0,
            sessions=sessions,
            is_synthetic=True,
        ))
        return unlinked
