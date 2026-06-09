"""Small, dependency-light helpers used across the pipeline."""

from __future__ import annotations

import hashlib
import mimetypes
import re
import unicodedata
from typing import Optional
from urllib.parse import parse_qs, urlparse

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_WS = re.compile(r"[ \t ]+")
_BLANKS = re.compile(r"\n{3,}")


def slugify(text: str, max_len: int = 80) -> str:
    """ASCII, lowercase, hyphenated slug."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = _SLUG_STRIP.sub("-", text.lower()).strip("-")
    return text[:max_len].strip("-") or "course"


def clean_ws(text: str) -> str:
    """Collapse runs of spaces/tabs and excess blank lines."""
    text = _WS.sub(" ", text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = _BLANKS.sub("\n\n", text)
    return text.strip()


_YT_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com",
             "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be")
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_youtube_id(url: str) -> Optional[str]:
    """Return the YouTube video id from any common URL form, else None."""
    try:
        u = urlparse(url)
    except ValueError:
        return None
    host = (u.netloc or "").lower()
    if host not in _YT_HOSTS:
        return None
    if host == "youtu.be":
        cand = u.path.lstrip("/").split("/")[0]
        return cand if _YT_ID.match(cand) else None
    parts = [p for p in u.path.split("/") if p]
    if parts and parts[0] in ("embed", "v") and len(parts) > 1 and _YT_ID.match(parts[1]):
        return parts[1]
    v = parse_qs(u.query).get("v", [None])[0]
    return v if v and _YT_ID.match(v) else None


def classify_asset(filename: str, anchor_text: str = "") -> str:
    hay = f"{filename} {anchor_text}".lower()
    if any(k in hay for k in ("solution", "soln", "answer", "_sol")):
        return "solution"
    if any(k in hay for k in ("pset", "problem set", "problem-set", "homework", "hw", "assignment")):
        return "problem-set"
    if any(k in hay for k in ("slide", "lecture-slides", "deck")):
        return "slides"
    if any(k in hay for k in ("notes", "lecture", "lec", "reading", "handout", "summary")):
        return "lecture-notes"
    return "other"


_DOC_EXTS = (".pdf", ".ps", ".doc", ".docx", ".ppt", ".pptx", ".tex")


def is_document(href: str) -> bool:
    path = urlparse(href).path.lower()
    return path.endswith(_DOC_EXTS)


def guess_mime(filename: str) -> str:
    mime, _ = mimetypes.guess_type(filename)
    return mime or "application/octet-stream"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


_LEADING_NUM = re.compile(
    r"(?:lecture|lec|session|class|unit|chapter|reading|week|ses|part)\s*#?\s*(\d+)",
    re.IGNORECASE,
)
_ANY_NUM = re.compile(r"\b(\d+)\b")


def leading_order(title: str, fallback: int) -> int:
    m = _LEADING_NUM.search(title)
    if m:
        return int(m.group(1))
    m = _ANY_NUM.search(title)
    if m:
        return int(m.group(1))
    return fallback
