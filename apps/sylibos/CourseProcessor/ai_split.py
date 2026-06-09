"""AI structural fallback. This is the ONLY use of AI in ingestion.

It runs only when the deterministic split (structure.py) scores below threshold,
typically flat humanities courses with no numbered sessions. The model proposes a
skeleton (units -> lecture titles + page hints); the deterministic extractor still
supplies the real content, videos, and assets for each matched page, so a
hallucinated title cannot fabricate content. Output is validated before use.

Provider: talks to Ollama's /api/generate shape, either directly (recommended while
LazurOS is a stub) or via LazurOS with a bearer token.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

import requests

from . import util
from .extract import Page
from .structure import STRUCTURE_KEYWORDS, _lecture_from_page
from .ir import Course, Unit

_PROMPT = """You are organizing an MIT OpenCourseWare course into a study structure.
Below are the course's structural pages (syllabus, calendar, readings). Produce a
JSON object that splits the course into ordered units and lessons.

Rules:
- Output ONLY valid JSON, no prose, no markdown fences.
- Shape: {{"units": [{{"title": str, "lessons": [{{"title": str, "hint": str}}]}}]}}
- "hint" is a short phrase from the source that identifies the lesson's page
  (a session number, a topic, or a reading title). Keep it verbatim where possible.
- Preserve the order the material is taught in.
- Do not invent lessons that are not present in the source.

SOURCE PAGES:
{source}

JSON:"""


@dataclass
class ProviderConfig:
    provider: str = "ollama"
    url: str = "http://localhost:11434"
    model: str = "llama3.2"
    token: str = ""
    timeout: int = 120


def propose_and_apply(course: Course, pages: list[Page], cfg: ProviderConfig) -> bool:
    """Replace course.units with an AI-derived structure. Returns True on success."""
    source = _structure_source(pages)
    if not source.strip():
        return False
    try:
        raw = _call(cfg, _PROMPT.format(source=source))
    except requests.RequestException:
        return False
    data = _parse_json(raw)
    if not _valid_shape(data):
        return False

    by_path, by_title = _page_indexes(pages)
    units: list[Unit] = []
    for u_index, u in enumerate(data["units"], start=1):
        unit = Unit(title=str(u.get("title") or f"Unit {u_index}").strip(), ord=u_index)
        for l_index, lesson in enumerate(u.get("lessons", []), start=1):
            title = str(lesson.get("title") or "").strip()
            if not title:
                continue
            page = _match_page(lesson, by_path, by_title)
            if page is not None:
                lec = _lecture_from_page(page, unit.title, l_index)
                lec.title = title or lec.title
            else:
                from .ir import Lecture
                lec = Lecture(title=title, ord=l_index, unit_title=unit.title)
            unit.lectures.append(lec)
        if unit.lectures:
            units.append(unit)

    if not units:
        return False
    course.units = units
    course.used_ai_split = True
    course.layout_format = "ai-split"
    return True


def _structure_source(pages: list[Page], max_chars: int = 8000) -> str:
    chosen = [
        p for p in pages
        if any(k in p.path.lower() or k in p.title.lower() for k in STRUCTURE_KEYWORDS)
    ]
    if not chosen:
        chosen = sorted(pages, key=lambda p: (p.depth, -p.word_count))[:6]
    blocks: list[str] = []
    budget = max_chars
    for p in chosen:
        block = f"### {p.title} ({p.path})\n{p.text}"
        block = block[: max(0, budget)]
        if not block:
            break
        blocks.append(block)
        budget -= len(block)
    return "\n\n".join(blocks)


def _call(cfg: ProviderConfig, prompt: str) -> str:
    headers = {"Content-Type": "application/json"}
    if cfg.provider == "lazuros" and cfg.token:
        headers["Authorization"] = f"Bearer {cfg.token}"
    body = {"model": cfg.model, "prompt": prompt, "stream": False, "format": "json"}
    resp = requests.post(f"{cfg.url.rstrip('/')}/api/generate",
                         json=body, headers=headers, timeout=cfg.timeout)
    resp.raise_for_status()
    return resp.json().get("response", "")


_FENCE = re.compile(r"^```(?:json)?|```$", re.MULTILINE)


def _parse_json(raw: str) -> Optional[dict]:
    if not raw:
        return None
    cleaned = _FENCE.sub("", raw).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                return None
    return None


def _valid_shape(data: Optional[dict]) -> bool:
    if not isinstance(data, dict) or not isinstance(data.get("units"), list):
        return False
    return any(isinstance(u, dict) and u.get("lessons") for u in data["units"])


def _page_indexes(pages: list[Page]):
    by_path = {p.path.lower(): p for p in pages}
    by_title = {p.title.lower(): p for p in pages}
    return by_path, by_title


def _match_page(lesson: dict, by_path: dict[str, Page], by_title: dict[str, Page]) -> Optional[Page]:
    hint = str(lesson.get("hint") or "").lower().strip()
    title = str(lesson.get("title") or "").lower().strip()
    for path, page in by_path.items():
        if hint and hint in path:
            return page
    if title in by_title:
        return by_title[title]
    best, best_score = None, 0.0
    for ptitle, page in by_title.items():
        score = SequenceMatcher(None, title, ptitle).ratio()
        if score > best_score:
            best, best_score = page, score
    return best if best_score >= 0.6 else None
