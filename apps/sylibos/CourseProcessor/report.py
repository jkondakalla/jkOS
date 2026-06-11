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
            n_assets = len(lec.get("assets") or lec.get("pending_assets") or [])
            a = f"{n_assets}pdf" if n_assets else "----"
            flag = "  <-- thin" if (words < 30 and not lec.get("videos")) else ""
            lines.append(f"      {lec['ord']:>3}. [{v}|{a:>5}|{words:>5}w] "
                         f"{lec['title']}{flag}")

    if warnings:
        lines.append("\nWARNINGS:")
        for w in warnings:
            lines.append(f"  - {w}")

    lines.append("")
    return "\n".join(lines)


def _mmss(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 60}:{s % 60:02d}"


def render_tree(bundle: dict[str, Any], max_trunk_rows: int = 40) -> str:
    """Review-gate summary of a scaffold bundle."""
    course = bundle["course"]
    counts = course["counts"]
    lines: list[str] = []

    lines.append("-" * 70)
    lines.append(f"  CONCEPT TREE  calendar={course['calendar_source']}"
                 + (f"  match_rate={course['match_rate']}"
                    if course.get("match_rate") is not None else ""))
    lines.append(f"  trunk={counts['trunk_nodes']}  nodes={counts['nodes']}  "
                 f"exercises={counts['exercises']} "
                 f"({counts['backed_exercises']} backed)  "
                 f"lessons={counts['lesson_chunks']}  videos={counts['videos']}")
    lines.append("-" * 70)

    trunk = [n for n in bundle["tree"]["nodes"]
             if n["kind"] in ("trunk", "checkpoint")]
    for n in trunk[:max_trunk_rows]:
        mark = "*" if n["kind"] == "checkpoint" else " "
        lines.append(f"   {n['trunk_position']:>3}.{mark}[{_mmss(n['est_duration_seconds']):>6} "
                     f"{(n['boundary_quality'] or '-')[:4]}|{n['match_method'][:7]:>7}] "
                     f"{n['title'][:64]}")
    if len(trunk) > max_trunk_rows:
        lines.append(f"   ... {len(trunk) - max_trunk_rows} more trunk nodes")

    excluded = course.get("excluded_sessions", [])
    if excluded:
        lines.append(f"\n  excluded sessions ({len(excluded)}):")
        for e in excluded[:12]:
            lines.append(f"    - [{e['reason']}] {e['title'][:58]}")
        if len(excluded) > 12:
            lines.append(f"    ... {len(excluded) - 12} more")

    unattached = bundle["exercises"].get("unattached", [])
    if unattached:
        lines.append(f"\n  unattached exercise sources: {len(unattached)}")

    if bundle.get("warnings"):
        lines.append(f"\n  tree warnings ({len(bundle['warnings'])}):")
        for w in bundle["warnings"][:8]:
            lines.append(f"    - {w}")

    lines.append("")
    return "\n".join(lines)
