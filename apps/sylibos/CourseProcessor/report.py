"""Render a human-readable report of a course IR for the review gate."""

from __future__ import annotations

from typing import Any


def render(course_dict: dict[str, Any], confidence: float | None,
           warnings: list[str] | None = None) -> str:
    meta = course_dict.get("meta", {})
    stats = course_dict.get("stats", {})
    lines: list[str] = []

    lines.append("=" * 70)
    lines.append(f"  {meta.get('title', '(no title)')}")
    lines.append(f"  slug={course_dict.get('slug')}  "
                 f"number={course_dict.get('course_number') or '-'}  "
                 f"term={course_dict.get('term') or '-'}")
    lines.append(f"  layout={course_dict.get('layout_format')}  "
                 f"ai_split={'YES' if course_dict.get('used_ai_split') else 'no'}"
                 + (f"  confidence={confidence}" if confidence is not None else ""))
    lines.append(f"  units={stats.get('unit_count')}  "
                 f"lectures={stats.get('lecture_count')}  "
                 f"has_video={stats.get('has_video')}")
    lines.append("=" * 70)

    for u in course_dict.get("units", []):
        lines.append(f"\n[{u['ord']:>2}] {u['title']}")
        for lec in u["lectures"]:
            words = len(lec.get("content", "").split())
            v = "V" if lec.get("videos") else "-"
            a = f"{len(lec.get('assets', []))}pdf" if lec.get("assets") else "----"
            flag = "  <-- thin" if (words < 30 and not lec.get("videos")) else ""
            lines.append(f"      {lec['ord']:>3}. [{v}|{a:>5}|{words:>5}w] "
                         f"{lec['title']}{flag}")

    if warnings:
        lines.append("\nWARNINGS:")
        for w in warnings:
            lines.append(f"  - {w}")

    lines.append("")
    return "\n".join(lines)
