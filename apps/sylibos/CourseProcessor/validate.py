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
        if len(lec.get("content", "").split()) < 30 and not lec.get("videos"):
            warnings.append(
                f"thin lecture '{lec['title']}' in '{unit_title}': "
                f"little text and no video"
            )
        if not lec.get("videos") and not lec.get("assets"):
            warnings.append(
                f"lecture '{lec['title']}' in '{unit_title}' has no video and no assets"
            )

    return warnings
