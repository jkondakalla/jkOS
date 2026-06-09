"""
Hugo shortcode resolver.

OCW content text contains shortcodes like:
  {{% resource_link "uuid" "Display Text" %}}
  {{% resource "uuid" %}}

These must be resolved before the manifest is written — raw shortcodes
must never appear in any text field of the final CourseManifest.
"""

from __future__ import annotations
import json
import re
from pathlib import Path

SHORTCODE_PATTERN = re.compile(
    r'{{%\s*(?P<name>\w+)\s+(?P<args>.*?)\s*%}}',
    re.DOTALL,
)
ANGLE_SHORTCODE_PATTERN = re.compile(
    r'{{<\s*(?P<name>/?[\w]+)\s*(?P<args>[^>]*?)>}}',
)
ARG_PATTERN = re.compile(r'"((?:[^"\\]|\\.)*)"')


def load_content_map(zip_root: Path) -> dict[str, str]:
    """
    Parse content_map.json → {uuid: relative_path}.

    OCW exports may use two formats:
      (a) Flat:        {"uuid": "pages/lecture-1/data.json", ...}
      (b) Hierarchical:{"pages": [...], "resources": {...}}  (some OCW Studio versions)

    Returns {} if the file is missing or unparseable.
    """
    p = zip_root / "content_map.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}

    if not isinstance(data, dict):
        return {}

    # Flat format — all values are strings (paths), not lists or dicts
    if data and not any(isinstance(v, (dict, list)) for v in list(data.values())[:5]):
        return {k: v for k, v in data.items() if isinstance(v, str)}

    # Hierarchical format — flatten pages/resources to {uid: path}
    flat: dict[str, str] = {}

    def _walk_pages(nodes: list, prefix: str = "pages") -> None:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            uid = node.get("uid") or node.get("id", "")
            text_id = node.get("text_id") or node.get("slug", "")
            if uid and text_id:
                flat[uid] = f"{prefix}/{text_id}/data.json"
            _walk_pages(node.get("children") or [], prefix)

    pages = data.get("pages") or []
    if isinstance(pages, list):
        _walk_pages(pages)

    resources = data.get("resources") or {}
    if isinstance(resources, dict):
        for uid, path in resources.items():
            if isinstance(path, str):
                flat[uid] = path

    return flat


class ShortcodeResolver:
    def __init__(self, content_map: dict[str, str], zip_root: Path):
        self._map   = content_map
        self._root  = zip_root
        self._cache: dict[str, str] = {}

    def resolve(self, text: str) -> str:
        """Replace all Hugo shortcodes with their display text."""
        if not text:
            return text
        if "{{<" in text:
            text = ANGLE_SHORTCODE_PATTERN.sub(self._replace_angle, text)
        if "{{%" in text:
            text = SHORTCODE_PATTERN.sub(self._replace, text)
        return text

    def _replace_angle(self, match: re.Match) -> str:
        name = match.group("name").lstrip("/")
        args = ARG_PATTERN.findall(match.group("args"))
        if name == "resource_link" and len(args) >= 2:
            return args[1]
        if name == "resource" and len(args) >= 1:
            return self._lookup_title(args[0])
        if name == "br":
            return "\n"
        return ""

    def _replace(self, match: re.Match) -> str:
        name = match.group("name")
        args = ARG_PATTERN.findall(match.group("args"))

        if name == "resource_link" and len(args) >= 2:
            # {{% resource_link "uuid" "Display text" %}} → Display text
            return args[1]
        if name == "resource" and len(args) >= 1:
            # {{% resource "uuid" %}} → look up title
            return self._lookup_title(args[0])
        # Unknown shortcode: strip it
        return ""

    def _lookup_title(self, uuid: str) -> str:
        if uuid in self._cache:
            return self._cache[uuid]
        path = self._map.get(uuid, "").lstrip("/")
        if not path:
            return ""
        full = self._root / path
        if full.exists():
            try:
                title = json.loads(full.read_text(encoding="utf-8", errors="replace")).get("title", "")
                self._cache[uuid] = title
                return title
            except Exception:
                pass
        return ""
