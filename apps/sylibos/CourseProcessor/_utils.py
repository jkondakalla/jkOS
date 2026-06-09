"""Shared utilities used across adapters, shapes, and pipeline."""

from __future__ import annotations
import json
import re
from pathlib import Path

# Markdown patterns that survive HTML stripping (OCW content field is often
# pure markdown or a mix of HTML + markdown + shortcodes)
_MD_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"!\[.*?\]\(.*?\)"),              ""),      # images
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"),         r"\1"),  # links → text
    (re.compile(r"#{1,6}\s+"),                     ""),     # ATX headers
    (re.compile(r"\*{1,2}([^*]+)\*{1,2}"),         r"\1"),  # bold/italic
    (re.compile(r"_{1,2}([^_]+)_{1,2}"),           r"\1"),  # underscore bold/italic
    (re.compile(r"`{1,3}[^`]*`{1,3}"),             ""),     # code spans/blocks
    (re.compile(r"^>\s+", re.MULTILINE),           ""),     # blockquotes
    (re.compile(r"^[-*+]\s+", re.MULTILINE),       ""),     # unordered list markers
    (re.compile(r"^\d+\.\s+", re.MULTILINE),       ""),     # ordered list markers
    (re.compile(r"[-]{3,}|[*]{3,}|[_]{3,}"),       ""),     # horizontal rules
]


def html_to_text(html: object) -> str:
    """Strip HTML tags, shortcode remnants, markdown syntax, collapse whitespace."""
    if not html:
        return ""
    text = str(html).replace("\r\n", "\n").replace("\r", "\n")
    try:
        from bs4 import BeautifulSoup
        text = BeautifulSoup(text, "lxml").get_text(" ", strip=True)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", text)
    # Strip common markdown patterns that survive HTML parsing
    for pat, repl in _MD_PATTERNS:
        text = pat.sub(repl, text)
    return re.sub(r"\s{2,}", " ", text).strip()


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"Bad JSON at {path}: {e}") from e


def str_field(data: dict, key: str, fallback: str = "") -> str:
    """Read a string field that may be null in the JSON."""
    v = data.get(key)
    return str(v).strip() if v else fallback


def enrich_overview(overview: str, data: dict) -> str:
    """
    Append structured metadata fields to the session overview text.
    OCW page data.json sometimes carries learning_outcomes and prerequisites
    in its `metadata` field — valuable context for the AI prompt.
    """
    meta = data.get("metadata") or {}
    extras: list[str] = []

    outcomes = meta.get("learning_outcomes")
    if isinstance(outcomes, list):
        clean = [str(o).strip() for o in outcomes if o and str(o).strip()]
        if clean:
            extras.append("Learning outcomes: " + "; ".join(clean))

    prereqs = meta.get("prerequisites")
    if isinstance(prereqs, str) and prereqs.strip():
        extras.append("Prerequisites: " + prereqs.strip())
    elif isinstance(prereqs, list):
        clean = [str(p).strip() for p in prereqs if p and str(p).strip()]
        if clean:
            extras.append("Prerequisites: " + "; ".join(clean))

    if not extras:
        return overview
    suffix = " ".join(extras)
    return (overview + " " + suffix).strip() if overview else suffix


def humanise_slug(slug: str) -> str:
    """'18-06sc-linear-algebra-fall-2011' → 'Linear Algebra'"""
    parts = slug.split("-")
    clean = [
        p for p in parts
        if not re.match(r"^\d{4}$", p)
        and p not in ("fall", "spring", "summer", "winter")
        and not re.match(r"^\d+[a-z]{0,3}$", p)
    ]
    return " ".join(clean).title() or slug
