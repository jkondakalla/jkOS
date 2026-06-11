"""Validate a course IR before it is allowed into the build dir or library.db."""

from __future__ import annotations

import json
import os
from typing import Any

from jsonschema import Draft7Validator

_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema", "library.schema.json")


class ValidationError(Exception):
    pass


def _schema() -> dict[str, Any]:
    with open(_SCHEMA_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def validate_tree(bundle: dict[str, Any], build_dir: str | None = None) -> list[str]:
    """Structural checks on a scaffold bundle. Raises on integrity violations
    a GUI cannot tolerate; returns soft warnings otherwise."""
    tree = bundle["tree"]
    nodes = tree["nodes"]
    warnings: list[str] = []

    ids = [n["id"] for n in nodes]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise ValidationError(f"duplicate node ids: {dupes[:3]}")
    id_set = set(ids)

    for n in nodes:
        if n["parent_id"] is not None and n["parent_id"] not in id_set:
            raise ValidationError(f"orphan parent_id on node {n['id']}")
        if n["kind"] not in ("trunk", "branch", "leaf", "checkpoint"):
            raise ValidationError(f"bad kind '{n['kind']}' on node {n['id']}")
    for e in tree["edges"]:
        if e["from"] not in id_set or e["to"] not in id_set:
            raise ValidationError(f"edge references unknown node: {e}")

    chunk_ids = {c["id"] for c in bundle["concepts"]["chunks"]}
    ex_ids = {c["id"] for c in bundle["exercises"]["chunks"]}
    for n in nodes:
        ref = n.get("content_ref")
        if ref and ref.split("#", 1)[1] not in chunk_ids:
            raise ValidationError(f"unresolvable content_ref {ref}")
        ref = n.get("exercise_ref")
        if ref and ref.split("#", 1)[1] not in ex_ids:
            raise ValidationError(f"unresolvable exercise_ref {ref}")

    if build_dir is not None:
        missing = []
        for c in bundle["exercises"]["chunks"]:
            p = c.get("source_asset_rel_path")
            if p and not os.path.exists(os.path.join(build_dir, p)):
                missing.append(p)
        for c in bundle["concepts"]["chunks"]:
            for item in c["items"]:
                p = item.get("asset_rel_path")
                if p and not os.path.exists(os.path.join(build_dir, p)):
                    missing.append(p)
        if missing:
            warnings.append(f"{len(missing)} referenced asset files missing "
                            f"(first: {missing[0]})")

    trunk = [n for n in nodes if n["kind"] in ("trunk", "checkpoint")]
    positions = sorted(n["trunk_position"] for n in trunk)
    if positions != list(range(1, len(trunk) + 1)):
        raise ValidationError("trunk_position is not a contiguous 1..N sequence")

    return warnings


def validate_ir(course_dict: dict[str, Any], build_dir: str | None = None) -> list[str]:
    """Hard-validate the IR. Returns a list of soft warnings. Raises on hard errors."""
    errors = sorted(Draft7Validator(_schema()).iter_errors(course_dict),
                    key=lambda e: list(e.path))
    if errors:
        first = errors[0]
        loc = "/".join(str(p) for p in first.path) or "(root)"
        raise ValidationError(f"schema error at {loc}: {first.message}")

    warnings: list[str] = []
    lectures = [
        (u["title"], lec)
        for u in course_dict["units"]
        for lec in u["lectures"]
    ]

    if build_dir is not None:
        for unit_title, lec in lectures:
            for asset in lec.get("assets", []):
                path = os.path.join(build_dir, asset["rel_path"])
                if not os.path.exists(path):
                    raise ValidationError(
                        f"asset missing on disk: {asset['rel_path']} "
                        f"(lecture '{lec['title']}')"
                    )

    for unit_title, lec in lectures:
        has_assets = lec.get("assets") or lec.get("pending_assets")
        if len(lec.get("content", "").split()) < 30 and not lec.get("videos"):
            warnings.append(
                f"thin lecture '{lec['title']}' in '{unit_title}': "
                f"little text and no video"
            )
        if not lec.get("videos") and not has_assets:
            warnings.append(
                f"lecture '{lec['title']}' in '{unit_title}' has no video and no assets"
            )

    return warnings
