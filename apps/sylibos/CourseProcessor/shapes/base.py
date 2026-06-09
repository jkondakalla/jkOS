"""
Abstract SpineBuilder + shared two-pass resource linker.

All shape builders extend SpineBuilder. The default link_resources()
uses slug similarity + title similarity (SequenceMatcher). Shape builders
that need a different linking strategy override it.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from difflib import SequenceMatcher
from pathlib import Path

from ..manifest import ResourceNode, UnitNode

_LINK_THRESHOLD = 0.45


def _slug_sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _title_sim(a: str, b: str) -> float:
    norm = lambda s: s.lower().replace("-", " ").replace("_", " ")
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def link_resources_to_sessions(
    units: list[UnitNode],
    resources: list[ResourceNode],
) -> list[ResourceNode]:
    """
    Two-pass fuzzy linker (slug + title similarity).
    Mutates unit.sessions[*].resources in place.
    Returns the list of resources that had no good match.
    """
    flat = [
        (ui, si, sess)
        for ui, unit in enumerate(units)
        for si, sess in enumerate(unit.sessions)
    ]
    unlinked: list[ResourceNode] = []

    for resource in resources:
        best_score = 0.0
        best_pos: tuple[int, int] | None = None

        # Pass 1 — slug similarity
        for ui, si, sess in flat:
            score = _slug_sim(resource.slug, sess.slug)
            if resource.slug.startswith(sess.slug):
                score = max(score, 0.7)
            if score > best_score:
                best_score = score
                best_pos = (ui, si)

        # Pass 2 — title similarity (only when slug match is weak)
        if best_score < _LINK_THRESHOLD:
            for ui, si, sess in flat:
                score = _title_sim(resource.title, sess.title)
                if score > best_score:
                    best_score = score
                    best_pos = (ui, si)

        if best_pos and best_score >= _LINK_THRESHOLD:
            ui, si = best_pos
            units[ui].sessions[si].resources.append(resource)
        else:
            unlinked.append(resource)

    return unlinked


def link_resources_uid_first(
    units: list[UnitNode],
    resources: list[ResourceNode],
) -> list[ResourceNode]:
    """
    UID-first linker for modern OCW courses.

    Uses resource.parent_uid → session.page_uid for exact matching, then
    falls back to slug/title similarity for resources without a parent_uid
    or whose parent_uid doesn't match any known session.
    """
    uid_to_pos: dict[str, tuple[int, int]] = {}
    for ui, unit in enumerate(units):
        for si, sess in enumerate(unit.sessions):
            if sess.page_uid:
                uid_to_pos[sess.page_uid] = (ui, si)

    if not uid_to_pos:
        return link_resources_to_sessions(units, resources)

    unmatched: list[ResourceNode] = []
    for resource in resources:
        if resource.parent_uid and resource.parent_uid in uid_to_pos:
            ui, si = uid_to_pos[resource.parent_uid]
            units[ui].sessions[si].resources.append(resource)
        else:
            unmatched.append(resource)

    return link_resources_to_sessions(units, unmatched)


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
        return link_resources_uid_first(units, resources)
