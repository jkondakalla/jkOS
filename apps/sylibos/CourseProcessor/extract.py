"""Generic, structure-tolerant extraction from an OCW course zip.

Walks every HTML page, strips boilerplate, and pulls the things every layout
shares: a title, readable text, linked documents (PDFs), and embedded/linked
YouTube videos. The structure stage decides how those pages group into units.

VERIFY against real OCW zips: the boilerplate selectors below and the
main-content heuristic are deliberately broad. Tighten _MAIN_HINTS and
_BOILERPLATE for cleaner text once you have sample courses to test against.
"""

from __future__ import annotations

import posixpath
import zipfile
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup, Tag

from . import util

_DROP_TAGS = ("script", "style", "noscript", "form", "svg", "button", "input")
_BOILERPLATE = ("nav", "header", "footer", "aside")
_MAIN_HINTS = ("main", "article", '[role="main"]', "#main-content", "#content",
               ".course-content", ".page-content")


@dataclass
class Page:
    path: str
    depth: int
    title: str
    text: str
    pdf_links: list[tuple[str, str]] = field(default_factory=list)
    videos: list[dict[str, str]] = field(default_factory=list)
    resources: list[dict[str, str]] = field(default_factory=list)
    word_count: int = 0

    @property
    def slug_segment(self) -> str:
        parts = [p for p in self.path.split("/")[:-1] if p]
        return parts[-1] if parts else ""


def read_zip(zip_path: str) -> tuple[list[Page], set[str]]:
    pages: list[Page] = []
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        for name in sorted(names):
            low = name.lower()
            if not (low.endswith(".html") or low.endswith(".htm")):
                continue
            try:
                raw = zf.read(name)
            except KeyError:
                continue
            page = _parse_page(name, raw)
            if page is not None:
                pages.append(page)
    return pages, names


def _parse_page(path: str, raw: bytes) -> Optional[Page]:
    soup = BeautifulSoup(raw, "lxml")
    title = _title(soup)
    main = _main_region(soup)
    if main is None:
        return None

    pdf_links: list[tuple[str, str]] = []
    videos: list[dict[str, str]] = []
    resources: list[dict[str, str]] = []
    seen_video_ids: set[str] = set()

    for a in main.find_all("a", href=True):
        href = a["href"].strip()
        anchor = util.clean_ws(a.get_text(" ", strip=True))
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        vid = util.extract_youtube_id(href)
        if vid and vid not in seen_video_ids:
            seen_video_ids.add(vid)
            videos.append({"provider": "youtube", "id": vid, "title": anchor or "Lecture video"})
            continue
        if util.is_document(href):
            resolved = _resolve(path, href)
            if resolved:
                pdf_links.append((resolved, anchor))
            continue
        if href.startswith(("http://", "https://")):
            resources.append({"title": anchor or href, "url": href})

    for ifr in main.find_all("iframe", src=True):
        vid = util.extract_youtube_id(ifr["src"].strip())
        if vid and vid not in seen_video_ids:
            seen_video_ids.add(vid)
            videos.append({"provider": "youtube", "id": vid, "title": "Lecture video"})

    text = _readable_text(main)
    return Page(
        path=path,
        depth=len([p for p in path.split("/") if p]) - 1,
        title=title,
        text=text,
        pdf_links=pdf_links,
        videos=videos,
        resources=resources,
        word_count=len(text.split()),
    )


def _title(soup: BeautifulSoup) -> str:
    for sel in ("h1", "title"):
        el = soup.find(sel)
        if el:
            t = util.clean_ws(el.get_text(" ", strip=True))
            if t:
                return t
    return "Untitled"


def _main_region(soup: BeautifulSoup) -> Optional[Tag]:
    body = soup.body or soup
    for tag in body.find_all(_BOILERPLATE):
        tag.decompose()
    for tag in body.find_all(_DROP_TAGS):
        tag.decompose()
    for hint in _MAIN_HINTS:
        el = body.select_one(hint)
        if el and len(el.get_text(strip=True)) > 40:
            return el
    return body


def _readable_text(region: Tag) -> str:
    for br in region.find_all("br"):
        br.replace_with("\n")
    text = region.get_text("\n", strip=True)
    return util.clean_ws(text)


def _resolve(page_path: str, href: str) -> Optional[str]:
    href = href.split("#", 1)[0].split("?", 1)[0]
    if not href or href.startswith(("http://", "https://", "//")):
        return None
    base = posixpath.dirname(page_path)
    resolved = posixpath.normpath(posixpath.join(base, href))
    return resolved.lstrip("/")
