"""
Processed-course bundle builder — trunk/branch/leaf concept tree + chunked
content, emitted as plain dicts for file output (and later DB load).

Two-phase API (the CLI orchestrates):

  1. prepare_exercise_assets(course, manifest, zip_root)
       BEFORE asset extraction: maps unlinked pset/exam document resources
       onto teaching lectures via calendar markers and appends them to
       lecture.pending_assets so assets.py materializes the files.

  2. build_bundle(course, manifest, zip_root, include_videos=...)
       AFTER asset extraction: chunk sessions, assemble nodes, map
       exercises. Returns {course, tree, concepts, exercises, lessons,
       videos, warnings} ready for json.dump.

Node ids are uuid5 over content-stable names so per-user progress survives
re-ingest: uuid5(TREE_NS, "{slug}:{session_key}:{part}[:branch:N|:leaf]").
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional
from uuid import NAMESPACE_DNS, uuid5

from . import syllabus
from .chunk import Chunk, chunk_text, chunk_video, slice_weighted
from .ir import Course, Lecture
from .manifest import CourseManifest, ResourceNode, SessionNode, UnitNode
from .transcripts import extract_caption_cues, index_captions

TREE_NS = uuid5(NAMESPACE_DNS, "sylibos.jkos.net")
SCHEMA_VERSION = 1

_EXERCISE_TITLE = re.compile(
    r"\b(problem\s?sets?|psets?|assignments?|exams?|midterms?|finals?|quiz(?:zes)?)\b",
    re.IGNORECASE,
)
_REVIEW = re.compile(r"\breview\b", re.IGNORECASE)
_EXAM_HINT = re.compile(r"\b(exam|midterm|final|quiz)\b", re.IGNORECASE)
_NUM = re.compile(r"(\d+)")
_EXCLUDED_PAGE_PREFIXES = ("pages/assignments", "pages/exams")

_MIN_TEXT_WORDS = 40


def _node_id(name: str) -> str:
    return str(uuid5(TREE_NS, name))


# ── Session/lecture alignment ────────────────────────────────────────────────

class SessCtx:
    """One manifest session paired with its IR lecture."""

    def __init__(self, session: SessionNode, lecture: Lecture, key: str):
        self.session = session
        self.lecture = lecture
        self.key = key                    # uuid5-stable session key
        self.teaching = True
        self.exclude_reason: Optional[str] = None
        self.enrich: dict = {}            # calendar join result for this ord

    @property
    def ord(self) -> int:
        return self.lecture.ord


def synthesize_manifest(course: Course) -> CourseManifest:
    """Minimal manifest for heuristic-parsed courses (no session pages):
    one SessionNode per IR lecture, no resources. Lets build_bundle run on
    courses the structured parser cannot split (single-page feature courses).
    """
    from . import util

    units: list = []
    for u in course.units:
        sessions = [
            SessionNode(
                slug=util.slugify(lec.title)[:60] or f"lecture-{lec.ord}",
                title=lec.title,
                order=lec.ord,
            )
            for lec in u.lectures
        ]
        units.append(UnitNode(
            slug=util.slugify(u.title)[:60] or f"unit-{u.ord}",
            title=u.title, order=u.ord, sessions=sessions,
        ))
    return CourseManifest(
        course_id=course.course_number or course.slug,
        title=course.title or course.slug,
        source_format="unknown",
        detected_shape="flat_feature",
        units=units,
    )


def align_sessions(course: Course, manifest: CourseManifest) -> list[SessCtx]:
    """manifest_to_ir converts sessions to lectures in iteration order, so the
    flattened session list and course.lectures are 1:1."""
    sessions = [s for u in manifest.units for s in u.sessions]
    lectures = course.lectures
    if len(sessions) != len(lectures):
        raise ValueError(
            f"session/lecture misalignment: {len(sessions)} sessions vs "
            f"{len(lectures)} lectures"
        )
    # session slugs can repeat across units (e.g. 'problem-set-1'); make keys
    # unique by prefixing the unit slug only for the duplicates, so the common
    # case keeps maximally stable ids.
    counts: dict[str, int] = {}
    for s in sessions:
        counts[s.slug] = counts.get(s.slug, 0) + 1
    ctxs: list[SessCtx] = []
    seen: dict[str, int] = {}
    for unode in manifest.units:
        for s in unode.sessions:
            lec = lectures[len(ctxs)]
            key = s.slug if counts[s.slug] == 1 else f"{unode.slug}/{s.slug}"
            # same-unit same-title sessions (heuristic splits) still collide;
            # ordinal suffix only on repeats keeps first-occurrence ids stable
            n = seen.get(key, 0)
            seen[key] = n + 1
            if n:
                key = f"{key}~{n + 1}"
            ctxs.append(SessCtx(s, lec, key))
    return ctxs


def filter_teaching(ctxs: list[SessCtx]) -> None:
    """Mark assessment/pset/exam sessions as non-teaching (exercise sources)."""
    for c in ctxs:
        title = c.session.title or ""
        if c.session.is_assessment:
            c.teaching, c.exclude_reason = False, "is_assessment"
        elif _EXERCISE_TITLE.search(title) and not _REVIEW.search(title):
            c.teaching, c.exclude_reason = False, "exercise_title"
        elif _EXERCISE_TITLE.search(c.session.slug) and not _REVIEW.search(title):
            c.teaching, c.exclude_reason = False, "exercise_slug"
        elif c.session.page_path and c.session.page_path.startswith(_EXCLUDED_PAGE_PREFIXES):
            c.teaching, c.exclude_reason = False, "feature_page"
    if not any(c.teaching for c in ctxs):
        # over-aggressive filter would empty the trunk; keep non-assessments
        for c in ctxs:
            if not c.session.is_assessment:
                c.teaching, c.exclude_reason = True, None


# ── Phase 1: route unlinked pset/exam PDFs to lectures pre-extraction ────────

def _is_exercise_resource(r: ResourceNode) -> bool:
    hay = " ".join([r.primary_type, *r.secondary_types, r.title or ""]).lower()
    return bool(re.search(r"problem set|assignment|exam|quiz", hay))


def prepare_exercise_assets(
    course: Course, manifest: CourseManifest, zip_root: Path
) -> int:
    """Append unlinked pset/exam document resources to calendar-marked
    lectures' pending_assets. Returns the number routed."""
    cal = syllabus.parse_calendar(zip_root)
    if cal is None:
        return 0

    ctxs = align_sessions(course, manifest)
    filter_teaching(ctxs)
    teaching = [c for c in ctxs if c.teaching]
    if not teaching:
        return 0
    join = syllabus.join_calendar(
        cal, [(c.ord, c.session.title) for c in teaching]
    )
    by_ord = join["by_ord"]

    candidates = [
        r for r in manifest.unlinked_resources
        if r.file_path and _is_exercise_resource(r)
    ]
    if not candidates:
        return 0

    routed = 0
    for c in teaching:
        markers = by_ord.get(c.ord, {}).get("markers", [])
        for marker in markers:
            num = _NUM.search(marker)
            want_exam = marker.startswith(("exam", "midterm", "final"))
            for r in list(candidates):
                hay = f"{r.title} {r.file_path}".lower()
                if want_exam and not _EXAM_HINT.search(hay):
                    continue
                if not want_exam and not re.search(r"problem|pset|assignment|hw", hay):
                    continue
                if num and num.group(1) not in re.findall(r"\d+", hay):
                    continue
                fname = r.file_path.rstrip("/").rsplit("/", 1)[-1]
                fname = re.sub(r"^[0-9a-f]{32}[_-]", "", fname, flags=re.IGNORECASE)
                c.lecture.pending_assets.append({
                    "zip_path": r.file_path.lstrip("/"),
                    "kind": "problem-set",
                    "title": r.title or fname,
                    "filename": fname,
                })
                candidates.remove(r)
                routed += 1
                break
    return routed


# ── Phase 2: bundle assembly ─────────────────────────────────────────────────

def _session_notes_text(s: SessionNode) -> str:
    notes = next(
        (r.extracted_text for r in s.resources
         if r.extracted_text and "Notes" in r.primary_type),
        "",
    )
    return notes or ""


def _session_transcript_text(s: SessionNode) -> str:
    return next((r.transcript_text for r in s.resources if r.transcript_text), "") or ""


def _chunk_session(
    c: SessCtx,
    captions: dict[str, Path],
    shared_slices: dict[tuple[str, str], dict],
) -> tuple[list[Chunk], str, Optional[str]]:
    """-> (chunks, mode 'video'|'text', primary_youtube_id)"""
    for v in c.lecture.videos:
        yt = v.get("id")
        if not yt:
            continue
        share = shared_slices.get((yt, c.key))
        if share is not None:
            if not share["cues"]:
                break  # degenerate slice; fall through to text path
            chunks = chunk_video(c.session.title, share["cues"],
                                 origin_zero=share["first"])
            if not share["first"]:
                # the session boundary itself is a clip-count estimate
                chunks[0].boundary_quality = "clip_share"
            chunks[0].warnings = chunks[0].warnings + ["shared_video_sliced"]
            return chunks, "video", yt
        if yt in captions:
            cues = extract_caption_cues(captions[yt])
            if cues:
                return chunk_video(c.session.title, cues), "video", yt
    if c.lecture.videos:
        # video session without usable captions: single estimated-duration part
        yt = c.lecture.videos[0].get("id")
        transcript = _session_transcript_text(c.session)
        chunks = chunk_text(c.session.title, transcript, wpm=150) if transcript \
            else chunk_video(c.session.title, [])
        return chunks, "video", yt
    text = _session_notes_text(c.session) or c.lecture.content
    return chunk_text(c.session.title, text), "text", None


GALLERY_MIN_VIDEOS = 6


def _session_trunk_units(
    c: SessCtx,
    captions: dict[str, Path],
    shared_slices: dict[tuple[str, str], dict],
) -> list[dict]:
    """
    A session normally yields one trunk unit. Video-gallery pages (a single
    feature page linking many lecture videos, e.g. video-lectures/part-1)
    yield one unit per captioned video so each lecture gets its own nodes.

    unit = {suffix, cid_suffix, title, chunks, mode, yt, extras: bool}
    suffix/cid_suffix stay empty for the normal case so node/chunk ids are
    unchanged for non-gallery courses.
    """
    cap_vids = [
        v for v in c.lecture.videos
        if v.get("id") and v["id"] in captions
        and (v["id"], c.key) not in shared_slices
    ]
    if len(cap_vids) < GALLERY_MIN_VIDEOS:
        chunks, mode, yt = _chunk_session(c, captions, shared_slices)
        return [{"suffix": "", "cid_suffix": "", "title": c.session.title,
                 "chunks": chunks, "mode": mode, "yt": yt, "extras": True}]

    units: list[dict] = []
    for vi, v in enumerate(cap_vids, start=1):
        cues = extract_caption_cues(captions[v["id"]])
        if not cues:
            continue
        title = v.get("title") or f"{c.session.title} — Video {vi}"
        units.append({
            "suffix": f":v{vi}", "cid_suffix": f".v{vi}", "title": title,
            "chunks": chunk_video(title, cues), "mode": "video",
            "yt": v["id"], "extras": False,
        })
    if not units:  # all cue parses failed; fall back to the normal path
        chunks, mode, yt = _chunk_session(c, captions, shared_slices)
        return [{"suffix": "", "cid_suffix": "", "title": c.session.title,
                 "chunks": chunks, "mode": mode, "yt": yt, "extras": True}]
    units[0]["chunks"][0].warnings = units[0]["chunks"][0].warnings + [
        f"gallery_session_split:{len(units)}"]
    return units


def _exercise_assets(lec: Lecture, session: SessionNode) -> list[dict]:
    """Classify a lecture's materialized assets into exercise sources."""
    out = []
    for a in lec.assets:
        hay = f"{a.filename} {a.title}".lower()
        if a.kind == "solution":
            out.append({"role": "solution", "asset": a})
        elif a.kind == "problem-set" or re.search(r"problem|pset|assignment", hay):
            source = "ocw_exam" if _EXAM_HINT.search(hay) else "ocw_pset"
            out.append({"role": "problem", "asset": a, "source": source})
        elif _EXAM_HINT.search(hay) or session.is_assessment:
            if a.kind in ("other", "problem-set"):
                out.append({"role": "problem", "asset": a, "source": "ocw_exam"})
    return out


def _pair_solutions(items: list[dict]) -> list[dict]:
    """Attach each solution asset to the problem whose numbers it shares."""
    problems = [i for i in items if i["role"] == "problem"]
    solutions = [i for i in items if i["role"] == "solution"]
    for sol in solutions:
        nums = set(_NUM.findall(sol["asset"].filename))
        target = next(
            (p for p in problems if nums & set(_NUM.findall(p["asset"].filename))),
            problems[0] if problems else None,
        )
        if target is not None:
            target.setdefault("solutions", []).append(sol["asset"])
    return problems


def build_bundle(
    course: Course,
    manifest: CourseManifest,
    zip_root: Path,
    *,
    include_videos: bool = True,
) -> dict:
    warnings: list[str] = []
    ctxs = align_sessions(course, manifest)
    filter_teaching(ctxs)
    teaching = [c for c in ctxs if c.teaching]
    excluded = [c for c in ctxs if not c.teaching]

    # calendar enrichment (best-effort)
    cal = syllabus.parse_calendar(zip_root)
    calendar_source, match_rate = "session-titles", None
    if cal is not None:
        join = syllabus.join_calendar(cal, [(c.ord, c.session.title) for c in teaching])
        calendar_source = f"{cal.source} ({cal.parser})"
        match_rate = join["match_rate"]
        for c in teaching:
            c.enrich = join["by_ord"].get(c.ord, {})
    for c in teaching:
        c.enrich.setdefault("syllabus_topic_verbatim", c.session.title)
        c.enrich.setdefault("session_number", str(c.ord))
        c.enrich.setdefault("match_method", "session_title")
        c.enrich.setdefault("markers", [])

    captions = index_captions(zip_root)
    slug = course.slug

    # Scholar clip pattern: one lecture video shared by several sessions in
    # nav order, with no per-clip offsets in the export. Apportion the video
    # across its sessions by clip count (number of video resources in the
    # session pointing at it), snapped to discourse boundaries.
    holders_by_id: dict[str, list[SessCtx]] = {}
    for c in teaching:
        for yt in {v.get("id") for v in c.lecture.videos if v.get("id")}:
            holders_by_id.setdefault(yt, []).append(c)
    shared_slices: dict[tuple[str, str], dict] = {}
    for yt, holders in holders_by_id.items():
        if len(holders) < 2 or yt not in captions:
            continue
        cues = extract_caption_cues(captions[yt])
        if not cues:
            continue
        weights = [
            max(1, sum(1 for r in c.session.resources if r.youtube_id == yt))
            for c in holders
        ]
        for i, (c, sl) in enumerate(zip(holders, slice_weighted(cues, weights))):
            shared_slices[(yt, c.key)] = {"cues": sl, "first": i == 0}

    nodes: list[dict] = []
    edges: list[dict] = []
    concept_chunks: list[dict] = []
    lesson_chunks: list[dict] = []
    exercise_chunks: list[dict] = []
    video_entries: list[dict] = []

    trunk_pos = 0
    prev_trunk_id: Optional[str] = None

    def add_exercise(node_id: str, kind: str, payload: dict) -> str:
        ex_id = f"ex:{len(exercise_chunks) + 1}"
        exercise_chunks.append({"id": ex_id, "node_id": node_id, "kind": kind, **payload})
        return ex_id

    for c in teaching:
        trunk_units = _session_trunk_units(c, captions, shared_slices)
        notes_assets = [a for a in c.lecture.assets if a.kind == "lecture-notes"]
        backed = _pair_solutions(_exercise_assets(c.lecture, c.session))
        session_trunk_ids: list[str] = []
        session_mode = trunk_units[0]["mode"]

        for ui, tu in enumerate(trunk_units):
            chunks, mode, primary_yt = tu["chunks"], tu["mode"], tu["yt"]
            last_unit = ui == len(trunk_units) - 1
            for w in (chunks[0].warnings if chunks else []):
                warnings.append(f"{c.key}: {w}")
            unit_last_part = chunks[-1].part if chunks else 0

            for ch in chunks:
                trunk_pos += 1
                nid = _node_id(f"{slug}:{c.key}{tu['suffix']}:{ch.part}")
                chunk_id = f"c:{c.ord}{tu['cid_suffix']}.{ch.part}"
                session_trunk_ids.append(nid)

                items: list[dict] = []
                if mode == "video" and primary_yt:
                    items.append({
                        "kind": "video", "provider": "youtube", "youtube_id": primary_yt,
                        "start_seconds": ch.start_seconds, "end_seconds": ch.end_seconds,
                        "text": ch.text,
                    })
                elif ch.text:
                    items.append({
                        "kind": "text", "text": ch.text,
                        "char_start": ch.char_start, "char_end": ch.char_end,
                    })
                if ch.part == ch.parts_total and last_unit:
                    # review material + any extra videos ride on the last part
                    for a in notes_assets:
                        items.append({"kind": "pdf_ref", "asset_rel_path": a.rel_path,
                                      "title": a.title})
                    extra_vids = (c.lecture.videos[1:]
                                  if mode == "video" and tu["extras"] else [])
                    for v in extra_vids:
                        if v.get("id") and v["id"] != primary_yt:
                            items.append({"kind": "video", "provider": "youtube",
                                          "youtube_id": v["id"], "start_seconds": 0,
                                          "end_seconds": None, "title": v.get("title", "")})

                concept_chunks.append({
                    "id": chunk_id, "node_id": nid, "title": ch.title,
                    "lecture_ord": c.ord, "session_slug": c.session.slug,
                    "part": ch.part, "parts_total": ch.parts_total,
                    "start_seconds": ch.start_seconds, "end_seconds": ch.end_seconds,
                    "duration_estimated": ch.duration_estimated,
                    "boundary_quality": ch.boundary_quality,
                    "items": items,
                })

                nodes.append({
                    "id": nid, "kind": "checkpoint" if ch.kind == "checkpoint" else "trunk",
                    "parent_id": None, "trunk_position": trunk_pos, "branch_position": None,
                    "title": ch.title, "session_number": c.enrich["session_number"],
                    "session_slug": c.session.slug, "lecture_ord": c.ord,
                    "syllabus_topic_verbatim": c.enrich["syllabus_topic_verbatim"],
                    "match_method": c.enrich["match_method"],
                    "est_duration_seconds": round(ch.end_seconds - ch.start_seconds),
                    "boundary_quality": ch.boundary_quality,
                    "content_ref": f"concepts.json#{chunk_id}", "exercise_ref": None,
                })
                if prev_trunk_id is not None:
                    edges.append({"from": nid, "to": prev_trunk_id, "rel": "follows"})
                prev_trunk_id = nid

            # ── branches + leaf on this trunk unit's last node ──────────────
            if not session_trunk_ids:
                continue
            last_id = session_trunk_ids[-1]

            def add_branch(n: int, ex_payload: dict, ex_kind: str = "branch") -> None:
                suffix = ":leaf" if ex_kind == "leaf" else f":branch:{n}"
                bid = _node_id(f"{slug}:{c.key}{tu['suffix']}:{unit_last_part}{suffix}")
                ex_id = add_exercise(bid, ex_kind, ex_payload)
                nodes.append({
                    "id": bid, "kind": ex_kind, "parent_id": last_id,
                    "trunk_position": None, "branch_position": n,
                    "title": ex_payload.get("source_label") or
                             ("Bonus challenge" if ex_kind == "leaf" else f"Practice {n}"),
                    "session_number": c.enrich["session_number"],
                    "session_slug": c.session.slug, "lecture_ord": c.ord,
                    "syllabus_topic_verbatim": c.enrich["syllabus_topic_verbatim"],
                    "match_method": c.enrich["match_method"],
                    "est_duration_seconds": 0, "boundary_quality": None,
                    "content_ref": None, "exercise_ref": f"exercises.json#{ex_id}",
                })
                edges.append({"from": bid, "to": last_id,
                              "rel": "leaf_of" if ex_kind == "leaf" else "branch_of"})

            bpos = 1
            add_branch(bpos, {"difficulty": 1, "source": "authored", "status": "stub",
                              "source_label": None, "body": "", "answer": ""})
            unit_backed = backed if last_unit else []
            for item in unit_backed:
                bpos += 1
                a = item["asset"]
                add_branch(bpos, {
                    "difficulty": 3 if item["source"] == "ocw_exam" else 2,
                    "source": item["source"], "status": "backed",
                    "source_label": a.title or a.filename,
                    "source_asset_rel_path": a.rel_path,
                    "solution_asset_rel_paths": [s.rel_path for s in item.get("solutions", [])],
                    "body": "", "answer": "",
                })
            if not unit_backed:
                bpos += 1
                add_branch(bpos, {"difficulty": 2, "source": "authored", "status": "stub",
                                  "source_label": None, "body": "", "answer": ""})
            add_branch(bpos + 1, {"difficulty": 0, "source": "authored", "status": "stub",
                                  "source_label": None, "body": "", "answer": ""},
                       ex_kind="leaf")

        # ── lessons: textual reading per session ────────────────────────────
        lesson_text = _session_notes_text(c.session)
        if not lesson_text and session_mode == "text":
            lesson_text = c.lecture.content
        if lesson_text and len(lesson_text.split()) >= _MIN_TEXT_WORDS:
            for lch in chunk_text(c.session.title, lesson_text):
                lesson_chunks.append({
                    "id": f"ls:{c.ord}.{lch.part}",
                    "trunk_node_ids": session_trunk_ids,
                    "lecture_ord": c.ord, "session_slug": c.session.slug,
                    "title": lch.title, "part": lch.part,
                    "parts_total": lch.parts_total,
                    "est_duration_seconds": round(lch.end_seconds - lch.start_seconds),
                    "boundary_quality": lch.boundary_quality,
                    "text": lch.text,
                    "char_start": lch.char_start, "char_end": lch.char_end,
                })

        # ── videos: per-video segments, deduped by youtube id ──────────────
        if include_videos:
            for v in c.lecture.videos:
                yt = v.get("id")
                if not yt:
                    continue
                existing = next((e for e in video_entries if e["youtube_id"] == yt), None)
                if existing is not None:
                    # shared full-lecture video: record this session too
                    existing["trunk_node_ids"].extend(
                        i for i in session_trunk_ids
                        if i not in existing["trunk_node_ids"])
                    existing["session_slugs"].append(c.session.slug)
                    continue
                segments = []
                if yt in captions:
                    cues = extract_caption_cues(captions[yt])
                    if cues:
                        for i, vch in enumerate(chunk_video(v.get("title") or c.session.title, cues), 1):
                            segments.append({
                                "idx": i, "start_seconds": vch.start_seconds,
                                "end_seconds": vch.end_seconds, "title": vch.title,
                                "text": vch.text,
                            })
                video_entries.append({
                    "youtube_id": yt, "lecture_ord": c.ord,
                    "session_slugs": [c.session.slug],
                    "title": v.get("title") or c.session.title,
                    "trunk_node_ids": list(session_trunk_ids),
                    "captioned": bool(segments),
                    "segments": segments,
                })

    # exercise sources from excluded (assessment/pset) sessions attach to the
    # nearest preceding teaching session's last trunk node
    unattached: list[dict] = []
    last_trunk_by_ord = {
        c.ord: [n for n in nodes if n["lecture_ord"] == c.ord and n["kind"] in ("trunk", "checkpoint")][-1]
        for c in teaching if any(n["lecture_ord"] == c.ord for n in nodes)
    }
    teaching_ords = sorted(last_trunk_by_ord)
    for c in excluded:
        backed = _pair_solutions(_exercise_assets(c.lecture, c.session))
        prev_ords = [o for o in teaching_ords if o < c.ord]
        for item in backed:
            a = item["asset"]
            payload = {
                "difficulty": 3 if item["source"] == "ocw_exam" else 2,
                "source": item["source"], "status": "backed",
                "source_label": a.title or a.filename,
                "source_asset_rel_path": a.rel_path,
                "solution_asset_rel_paths": [s.rel_path for s in item.get("solutions", [])],
                "body": "", "answer": "",
                "from_session": c.session.slug,
            }
            if not prev_ords:
                unattached.append(payload)
                continue
            host = last_trunk_by_ord[prev_ords[-1]]
            existing = [n for n in nodes if n["parent_id"] == host["id"]]
            # insert before the leaf: renumber it to stay last
            leaf = next((n for n in existing if n["kind"] == "leaf"), None)
            bpos = max((n["branch_position"] or 0) for n in existing) if existing else 0
            bid = _node_id(f"{slug}:{c.key}:exercise:{a.filename}")
            ex_id = add_exercise(bid, "branch", payload)
            nodes.append({
                "id": bid, "kind": "branch", "parent_id": host["id"],
                "trunk_position": None,
                "branch_position": (leaf["branch_position"] if leaf else bpos + 1),
                "title": payload["source_label"],
                "session_number": host["session_number"],
                "session_slug": c.session.slug, "lecture_ord": host["lecture_ord"],
                "syllabus_topic_verbatim": host["syllabus_topic_verbatim"],
                "match_method": "excluded_session",
                "est_duration_seconds": 0, "boundary_quality": None,
                "content_ref": None, "exercise_ref": f"exercises.json#{ex_id}",
            })
            if leaf:
                leaf["branch_position"] = nodes[-1]["branch_position"] + 1
            edges.append({"from": bid, "to": host["id"], "rel": "branch_of"})

    trunk_nodes = [n for n in nodes if n["kind"] in ("trunk", "checkpoint")]
    base = {"slug": slug, "schema_version": SCHEMA_VERSION,
            "generated_by": f"CourseProcessor {course.tool_version}"}

    return {
        "course": {
            **base,
            "title": course.title, "course_number": course.course_number,
            "term": course.term, "level": course.level,
            "subject": course.subject, "instructor": course.instructor,
            "description": course.description,
            "layout_format": course.layout_format,
            "calendar_source": calendar_source, "match_rate": match_rate,
            "counts": {
                "sessions": len(ctxs), "teaching_sessions": len(teaching),
                "excluded_sessions": len(excluded),
                "trunk_nodes": len(trunk_nodes), "nodes": len(nodes),
                "concept_chunks": len(concept_chunks),
                "lesson_chunks": len(lesson_chunks),
                "exercises": len(exercise_chunks),
                "backed_exercises": sum(1 for e in exercise_chunks if e.get("status") == "backed"),
                "videos": len(video_entries),
            },
            "artifacts": {
                "ir": "ir.json", "tree": "tree.json", "concepts": "concepts.json",
                "exercises": "exercises.json", "lessons": "lessons.json",
                "videos": "videos.json" if include_videos else None,
            },
            "excluded_sessions": [
                {"slug": c.session.slug, "title": c.session.title,
                 "reason": c.exclude_reason} for c in excluded
            ],
        },
        "tree": {**base, "calendar_source": calendar_source,
                 "match_rate": match_rate, "nodes": nodes, "edges": edges},
        "concepts": {**base, "chunks": concept_chunks},
        "exercises": {**base, "chunks": exercise_chunks, "unattached": unattached},
        "lessons": {**base, "chunks": lesson_chunks},
        "videos": {**base, "videos": video_entries} if include_videos else None,
        "warnings": warnings,
    }
