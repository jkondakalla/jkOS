"""
Calendar/syllabus enrichment for the concept tree.

The manifest spine (nav-ordered sessions) is the trunk source of truth;
this module's job is purely additive: join the institution-authored
calendar table onto sessions to recover TOPICS-verbatim text, sub-topic
split hints, and pset/exam due markers. When no calendar exists, callers
fall back to the session title — still institution-authored.

parse_calendar(zip_root)  -> CalendarTable | None
join_calendar(rows, sessions) -> per-session enrichment + match rate
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

_NBSP = "\xa0"

_SES_HEADERS = ("ses", "lec", "#", "session", "week")
_TOPIC_HEADERS = ("topic", "topics", "lecture topics", "subject")
_DATE_HEADERS = ("key date", "key dates", "date", "dates", "due", "assignment")

_EXAM_ROW = re.compile(r"\b(exam|midterm|final|quiz)\b", re.IGNORECASE)
_MARKER = re.compile(
    r"\b(?:(problem\s*set|pset|assignment|homework|hw)\s*#?\s*(\d+)\s*(?:due|out)?"
    r"|(midterm|final)(?:\s+exam)?|exam\s*#?\s*(\d+))\b",
    re.IGNORECASE,
)
_LECTURE_PARA = re.compile(
    r"^(?:lecture|lec\.?|session|class)\s*#?\s*(\d+)\s*[:.–—-]\s*(.+)$",
    re.IGNORECASE,
)
_ROW_NUM = re.compile(r"^([LR])?\s*(\d+)\s*$", re.IGNORECASE)


@dataclass
class CalendarRow:
    kind: str                      # 'lecture' | 'recitation' | 'exam' | 'header'
    number: Optional[int]
    topic: str
    markers: list[str] = field(default_factory=list)


@dataclass
class CalendarTable:
    source: str                    # page the table came from, e.g. 'pages/calendar'
    parser: str                    # 'table' | 'paragraphs'
    rows: list[CalendarRow] = field(default_factory=list)

    @property
    def lecture_rows(self) -> list[CalendarRow]:
        return [r for r in self.rows if r.kind == "lecture"]


def _clean(cell: str) -> str:
    return re.sub(r"\s+", " ", cell.replace(_NBSP, " ")).strip()


def _extract_markers(*texts: str) -> list[str]:
    found: list[str] = []
    for t in texts:
        for m in _MARKER.finditer(t):
            if m.group(1):  # pset-family
                found.append(f"pset {m.group(2)}")
            elif m.group(3):
                found.append(m.group(3).lower())
            elif m.group(4):
                found.append(f"exam {m.group(4)}")
    # de-dup preserving order
    seen: set[str] = set()
    return [x for x in found if not (x in seen or seen.add(x))]


def _classify_table(soup: BeautifulSoup):
    """Find the first table whose headers look like a course calendar."""
    for table in soup.find_all("table"):
        header_cells = [
            _clean(th.get_text()).lower()
            for th in table.find_all("th")
        ]
        if not header_cells:
            first_row = table.find("tr")
            if first_row:
                header_cells = [_clean(td.get_text()).lower()
                                for td in first_row.find_all("td")]
        hits = 0
        if any(any(h.startswith(s) for s in _SES_HEADERS) for h in header_cells):
            hits += 1
        if any(any(s in h for s in _TOPIC_HEADERS) for h in header_cells):
            hits += 1
        if any(any(s in h for s in _DATE_HEADERS) for h in header_cells):
            hits += 1
        if hits >= 2:
            return table, header_cells
    return None, []


def _parse_table(table, header_cells: list[str]) -> list[CalendarRow]:
    def col(prefixes) -> Optional[int]:
        for i, h in enumerate(header_cells):
            if any(p in h for p in prefixes):
                return i
        return None

    ses_col = col(_SES_HEADERS) or 0
    topic_col = col(_TOPIC_HEADERS)
    date_col = col(_DATE_HEADERS)

    rows: list[CalendarRow] = []
    for tr in table.find_all("tr"):
        cells = [_clean(td.get_text()) for td in tr.find_all("td")]
        if not cells:
            continue  # header row (th only)
        if len(cells) == 1:
            rows.append(CalendarRow(kind="header", number=None, topic=cells[0]))
            continue

        ses = cells[ses_col] if ses_col < len(cells) else ""
        topic = cells[topic_col] if topic_col is not None and topic_col < len(cells) else \
            (cells[1] if len(cells) > 1 else "")
        dates = cells[date_col] if date_col is not None and date_col < len(cells) else ""
        markers = _extract_markers(topic, dates)

        m = _ROW_NUM.match(ses)
        if m:
            kind = "recitation" if (m.group(1) or "").upper() == "R" else "lecture"
            if _EXAM_ROW.search(topic) and not _MARKER.search(topic):
                kind = "exam"
            rows.append(CalendarRow(kind=kind, number=int(m.group(2)),
                                    topic=topic, markers=markers))
        elif _EXAM_ROW.search(ses) or _EXAM_ROW.search(topic):
            rows.append(CalendarRow(kind="exam", number=None,
                                    topic=topic or ses, markers=markers))
        elif topic:
            rows.append(CalendarRow(kind="header", number=None,
                                    topic=topic, markers=markers))
    return rows


def _parse_paragraphs(soup: BeautifulSoup) -> list[CalendarRow]:
    """Fallback for calendar pages written as 'Lecture N: Title' paragraphs."""
    rows: list[CalendarRow] = []
    for el in soup.find_all(["p", "li", "h2", "h3", "h4"]):
        text = _clean(el.get_text())
        m = _LECTURE_PARA.match(text)
        if m:
            rows.append(CalendarRow(
                kind="lecture", number=int(m.group(1)),
                topic=m.group(2).strip(), markers=_extract_markers(text),
            ))
    return rows


_CAL_PAGES = ("pages/calendar/index.html", "pages/syllabus/index.html")


def parse_calendar(zip_root: Path) -> Optional[CalendarTable]:
    for rel in _CAL_PAGES:
        page = zip_root / rel
        if not page.exists():
            continue
        try:
            raw = page.read_text(encoding="utf-8", errors="replace")
            soup = BeautifulSoup(raw, "html.parser")
            # OCW calendar markup often has stray <p>/</p> inside <tr>, which
            # truncates html.parser's table tree — strip them for table parsing
            # only (cells are read via get_text, so no content is lost).
            table_soup = BeautifulSoup(
                re.sub(r"</?p[^>]*>", "", raw), "html.parser"
            )
        except Exception:
            continue
        table, headers = _classify_table(table_soup)
        if table is not None:
            rows = _parse_table(table, headers)
            if rows:
                return CalendarTable(source=rel.rsplit("/", 1)[0],
                                     parser="table", rows=rows)
        paras = _parse_paragraphs(soup)
        if len(paras) >= 5:
            return CalendarTable(source=rel.rsplit("/", 1)[0],
                                 parser="paragraphs", rows=paras)
    return None


def split_sub_topics(topic: str) -> list[str]:
    """Split a TOPICS cell into sub-topic hints (semicolons, numbered lists)."""
    parts = [p.strip() for p in re.split(r";|(?:\d+[.)]\s+)", topic) if p and p.strip()]
    if len(parts) <= 1:
        parts = [p.strip() for p in re.split(r"\.\s+(?=[A-Z])", topic) if p.strip()]
    return parts if len(parts) > 1 else [topic.strip()]


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


_TITLE_NUM = re.compile(r"^(?:lecture|session|class|lec\.?)\s*#?\s*(\d+)", re.IGNORECASE)


def join_calendar(
    cal: CalendarTable,
    sessions: list[tuple[int, str]],
    *,
    min_similarity: float = 0.55,
) -> dict:
    """
    Map calendar lecture rows onto sessions [(ord, title)].

    Title-similarity is primary; lecture-number-in-title second; ordinal
    position over lecture rows last. Returns:
      {by_ord: {ord: {session_number, syllabus_topic_verbatim, sub_topics,
                      markers, match_method}},
       match_rate, unmatched_rows}
    """
    lec_rows = cal.lecture_rows
    by_ord: dict[int, dict] = {}
    used_rows: set[int] = set()

    def claim(ord_: int, ri: int, method: str) -> None:
        row = lec_rows[ri]
        used_rows.add(ri)
        by_ord[ord_] = {
            "session_number": str(row.number) if row.number is not None else "",
            "syllabus_topic_verbatim": row.topic,
            "sub_topics": split_sub_topics(row.topic),
            "markers": row.markers,
            "match_method": method,
        }

    # pass 1: title similarity
    for ord_, title in sessions:
        best, best_score = None, 0.0
        for ri, row in enumerate(lec_rows):
            if ri in used_rows:
                continue
            score = _similarity(title, row.topic)
            if score > best_score:
                best, best_score = ri, score
        if best is not None and best_score >= min_similarity:
            claim(ord_, best, "title")

    # pass 2: lecture number embedded in the session title
    for ord_, title in sessions:
        if ord_ in by_ord:
            continue
        m = _TITLE_NUM.match(title)
        if not m:
            continue
        n = int(m.group(1))
        for ri, row in enumerate(lec_rows):
            if ri not in used_rows and row.number == n:
                claim(ord_, ri, "lecture_number")
                break

    # pass 3: ordinal over remaining lecture rows
    remaining_sessions = [s for s in sessions if s[0] not in by_ord]
    remaining_rows = [ri for ri in range(len(lec_rows)) if ri not in used_rows]
    for (ord_, _title), ri in zip(remaining_sessions, remaining_rows):
        claim(ord_, ri, "ordinal")

    match_rate = (
        sum(1 for v in by_ord.values() if v["match_method"] in ("title", "lecture_number"))
        / len(sessions)
    ) if sessions else 0.0

    return {
        "by_ord": by_ord,
        "match_rate": round(match_rate, 3),
        "unmatched_rows": [
            {"number": lec_rows[ri].number, "topic": lec_rows[ri].topic}
            for ri in range(len(lec_rows)) if ri not in used_rows
        ],
    }
