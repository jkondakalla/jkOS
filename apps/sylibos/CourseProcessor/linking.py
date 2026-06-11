"""
Session ↔ resource linking.

Modern OCW session pages reference exactly their own resources, giving a
deterministic linking channel that beats fuzzy matching. Three signals,
checked per session in spine order:

  1. hrefs to resources/{slug}/ in the session's rendered index.html
  2. data-uuid attributes / resource_link shortcode uuids, resolved through
     content_map.json → /resources/{slug}/data.json
  3. hrefs to static_resources/{hash}_{filename} → matched to the resource
     whose `file` field carries the same basename

Resources not referenced by any page fall back to parent_uid matching, then
(only when page-reference coverage is poor) to slug/title fuzzy matching.
A resource links to at most one session — the first that references it.
"""

from __future__ import annotations
import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from .manifest import ResourceNode, SessionNode, UnitNode

_LINK_THRESHOLD = 0.45
_HASH_PREFIX = re.compile(r"^[0-9a-f]{32}[_-]", re.IGNORECASE)
_HREF_PAT    = re.compile(r'href="([^"]+)"')
_DATA_UUID_PAT = re.compile(r'data-uuid="([0-9a-f-]{36})"')
_SHORTCODE_UUID_PAT = re.compile(
    r'{{[%<]\s*resource(?:_link)?\s+"?([0-9a-f-]{36})"?', re.IGNORECASE
)
_RES_PATH_PAT = re.compile(r"^/?resources/([^/]+)/data\.json$")


def _slug_sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _title_sim(a: str, b: str) -> float:
    norm = lambda s: s.lower().replace("-", " ").replace("_", " ")
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def _stripped_basename(path_or_name: str) -> str:
    name = path_or_name.rstrip("/").rsplit("/", 1)[-1].lower()
    return _HASH_PREFIX.sub("", name)


def _referenced_slugs(session: SessionNode, zip_root: Path,
                      content_map: dict[str, str],
                      basename_to_slug: dict[str, str]) -> list[str]:
    """Resource slugs referenced by this session's page, in document order."""
    if not session.page_path:
        return []
    page_dir = zip_root / session.page_path

    refs: list[str] = []
    seen: set[str] = set()

    def add(slug: str) -> None:
        slug = slug.lower()
        if slug and slug not in seen:
            seen.add(slug)
            refs.append(slug)

    html_path = page_dir / "index.html"
    if not html_path.exists():
        html_path = page_dir / "index.htm"
    if html_path.exists():
        try:
            html = html_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            html = ""
        for href in _HREF_PAT.findall(html):
            href = href.split("#", 1)[0].split("?", 1)[0]
            segs = [s for s in href.split("/") if s and s != ".."]
            for i, seg in enumerate(segs):
                if seg == "resources" and i + 1 < len(segs):
                    nxt = segs[i + 1]
                    if not nxt.endswith((".html", ".htm")):
                        add(nxt)
                    break
                if seg == "static_resources" and i + 1 < len(segs):
                    slug = basename_to_slug.get(_stripped_basename(segs[i + 1]))
                    if slug:
                        add(slug)
                    break
        for uuid in _DATA_UUID_PAT.findall(html):
            m = _RES_PATH_PAT.match(content_map.get(uuid, ""))
            if m:
                add(m.group(1))

    data_path = page_dir / "data.json"
    if data_path.exists():
        try:
            content = json.loads(
                data_path.read_text(encoding="utf-8", errors="replace")
            ).get("content") or ""
        except Exception:
            content = ""
        for uuid in _SHORTCODE_UUID_PAT.findall(str(content)):
            m = _RES_PATH_PAT.match(content_map.get(uuid, ""))
            if m:
                add(m.group(1))

    return refs


def link_resources_for_spine(
    units: list[UnitNode],
    resources: list[ResourceNode],
    zip_root: Path,
    content_map: dict[str, str] | None = None,
) -> list[ResourceNode]:
    """
    Attach resources to sessions. Mutates unit.sessions[*].resources in place
    and returns the unlinked remainder.
    """
    content_map = content_map or {}
    sessions = [s for u in units for s in u.sessions]
    if not sessions or not resources:
        return list(resources)

    by_slug: dict[str, ResourceNode] = {}
    basename_to_slug: dict[str, str] = {}
    for r in resources:
        by_slug.setdefault(r.slug.lower(), r)
        if r.file_path:
            basename_to_slug.setdefault(_stripped_basename(r.file_path), r.slug)

    linked: set[int] = set()  # id() of linked ResourceNodes
    sessions_with_refs = 0

    # ── Pass 1: exact page references ─────────────────────────────────────────
    for sess in sessions:
        refs = _referenced_slugs(sess, zip_root, content_map, basename_to_slug)
        if refs:
            sessions_with_refs += 1
        for slug in refs:
            r = by_slug.get(slug)
            if r is not None and id(r) not in linked:
                sess.resources.append(r)
                linked.add(id(r))

    remaining = [r for r in resources if id(r) not in linked]

    # ── Pass 2: parent_uid → page_uid ─────────────────────────────────────────
    uid_to_session = {s.page_uid: s for s in sessions if s.page_uid}
    if uid_to_session:
        still: list[ResourceNode] = []
        for r in remaining:
            sess = uid_to_session.get(r.parent_uid) if r.parent_uid else None
            if sess is not None:
                sess.resources.append(r)
                linked.add(id(r))
            else:
                still.append(r)
        remaining = still

    # ── Pass 3: fuzzy slug/title matching — only when page refs were sparse ──
    # When most sessions carried exact references, an unreferenced resource is
    # genuinely supplementary (e.g. translated dubs); fuzzy-matching it onto a
    # session would be a false link.
    if sessions_with_refs < max(1, len(sessions) // 3):
        still = []
        for r in remaining:
            best_score, best_sess = 0.0, None
            for sess in sessions:
                score = _slug_sim(r.slug, sess.slug)
                if r.slug.startswith(sess.slug):
                    score = max(score, 0.7)
                if score > best_score:
                    best_score, best_sess = score, sess
            if best_score < _LINK_THRESHOLD:
                for sess in sessions:
                    score = _title_sim(r.title, sess.title)
                    if score > best_score:
                        best_score, best_sess = score, sess
            if best_sess is not None and best_score >= _LINK_THRESHOLD:
                best_sess.resources.append(r)
            else:
                still.append(r)
        remaining = still

    return remaining
