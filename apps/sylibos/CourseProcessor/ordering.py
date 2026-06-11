"""
Teaching-order recovery from rendered navigation.

OCW page slugs sort alphabetically, but the rendered index.html navigation
lists child pages in the order the course teaches them. ordered_dirs() ranks
child directories by first appearance in a parent page's hrefs, falling back
to alphabetical for anything the nav doesn't mention.
"""

from __future__ import annotations
import re
from pathlib import Path

_HREF_PAT = re.compile(r'href="([^"]+)"')
_UNRANKED = 10**9


def ordered_dirs(dirs: list[Path], nav_candidates: list[Path]) -> list[Path]:
    """
    Order dirs by first appearance of their name as a path segment in the
    hrefs of the first nav candidate HTML that exists.
    """
    if len(dirs) < 2:
        return list(dirs)

    html = ""
    for cand in nav_candidates:
        if cand.exists():
            try:
                html = cand.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if html:
                break
    if not html:
        return sorted(dirs, key=lambda d: d.name)

    names = {d.name for d in dirs}
    rank: dict[str, int] = {}
    for i, href in enumerate(_HREF_PAT.findall(html)):
        clean = href.split("#", 1)[0].split("?", 1)[0]
        for seg in clean.split("/"):
            if seg in names and seg not in rank:
                rank[seg] = i

    return sorted(dirs, key=lambda d: (rank.get(d.name, _UNRANKED), d.name))
