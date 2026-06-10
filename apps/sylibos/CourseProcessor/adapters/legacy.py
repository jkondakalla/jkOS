"""
Legacy OCW adapter (Plone export, pre-2015).

Plone exports (OcwWeb/ trees, top-level 0/ folders) carry no machine-readable
manifest, so this adapter extracts course metadata natively from the
CourseHome HTML (title tag, Dublin Core / description meta tags, instructor
labels). The course *structure* for legacy zips is built by the heuristic
HTML extractor (extract.py + structure.py) in the ingest fallback path —
parse_resources() intentionally returns [] here.
"""

from __future__ import annotations
import re
from pathlib import Path

from ..manifest import Instructor, ResourceNode
from .base import CourseAdapter

# "18.06 Linear Algebra, Spring 2010 | MIT OpenCourseWare ..."
_TITLE_PAT = re.compile(
    r"^\s*(?P<num>[A-Z0-9]{1,4}\.[A-Za-z0-9.]+)\s+(?P<title>[^|,]+?)"
    r"(?:,\s*(?P<term>(?:Spring|Summer|Fall|Winter|January|IAP)\s+\d{4}))?\s*(?:\||$)",
    re.IGNORECASE,
)
_TERM_PAT = re.compile(
    r"\b(Spring|Summer|Fall|Winter|January|IAP)\s+(\d{4})\b", re.IGNORECASE
)
_HOME_NAMES = ("CourseHome", "index.htm", "index.html")


class LegacyAdapter(CourseAdapter):

    def parse_metadata(self) -> dict:
        meta = {
            "course_id":   "",
            "extra_course_ids": [],
            "site_uid":    "",
            "legacy_uid":  None,
            "title":       "",
            "description": "",
            "department_numbers": [],
            "departments": [],
            "topics":      [],
            "level":       [],
            "term":        "",
            "year":        "",
            "instructors": [],
            "learning_resource_types": [],
        }

        home = self._find_home_page()
        if home is None:
            meta["title"] = self.zip_root.name
            return meta

        try:
            html = home.read_text(encoding="utf-8", errors="replace")
        except OSError:
            meta["title"] = self.zip_root.name
            return meta

        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            meta["title"] = self.zip_root.name
            return meta

        title_text = ""
        if soup.title and soup.title.string:
            title_text = str(soup.title.string).strip()
        elif soup.h1:
            title_text = soup.h1.get_text(" ", strip=True)

        m = _TITLE_PAT.match(title_text)
        if m:
            meta["course_id"] = m.group("num").upper()
            meta["title"]     = m.group("title").strip()
            if m.group("term"):
                meta["term"] = m.group("term").title()
        else:
            meta["title"] = title_text.split("|")[0].strip() or self.zip_root.name

        if not meta["term"]:
            tm = _TERM_PAT.search(title_text) or _TERM_PAT.search(html[:5000])
            if tm:
                meta["term"] = f"{tm.group(1).title()} {tm.group(2)}"
        ym = re.search(r"\d{4}", meta["term"])
        if ym:
            meta["year"] = ym.group(0)

        for name in ("description", "Description", "DC.Description"):
            tag = soup.find("meta", attrs={"name": name})
            if tag and tag.get("content"):
                meta["description"] = str(tag["content"]).strip()
                break

        for name in ("author", "Author", "DC.Creator"):
            tag = soup.find("meta", attrs={"name": name})
            if tag and tag.get("content"):
                for person in re.split(r"[;,]| and ", str(tag["content"])):
                    person = re.sub(r"^\s*(Prof\.?|Dr\.?)\s*", "", person).strip()
                    if person:
                        parts = person.split()
                        meta["instructors"].append(Instructor(
                            first_name=" ".join(parts[:-1]),
                            last_name=parts[-1],
                        ))
                break

        if meta["course_id"]:
            dept = meta["course_id"].split(".")[0]
            meta["department_numbers"] = [dept]

        return meta

    def parse_resources(self) -> list[ResourceNode]:
        # Structure and resources for legacy zips come from the heuristic
        # HTML extractor; there is no per-resource metadata to parse here.
        return []

    def load_content_map(self) -> dict[str, str]:
        return {}

    def _find_home_page(self) -> Path | None:
        """Locate the course home HTML, preferring CourseHome/ dirs."""
        candidates: list[tuple[int, Path]] = []
        for p in self.zip_root.rglob("*.htm*"):
            if p.suffix.lower() not in (".htm", ".html"):
                continue
            parts = p.relative_to(self.zip_root).parts
            if len(parts) > 6:
                continue
            score = len(parts)
            if "CourseHome" in parts:
                score -= 10
            if p.stem.lower() == "index":
                score -= 2
            candidates.append((score, p))
            if len(candidates) > 500:
                break
        if not candidates:
            return None
        candidates.sort(key=lambda t: (t[0], str(t[1])))
        return candidates[0][1]
