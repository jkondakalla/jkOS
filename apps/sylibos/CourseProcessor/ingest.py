"""
Unified zip → Course IR ingestion.

This is the single entry point library_cli uses. Strategy ladder:

  1. Structured parse — format detection routes to the modern adapter +
     shape builders (pipeline.build_manifest_from_dir), converted to IR via
     manifest_to_ir. Deterministic and preferred whenever it yields lectures.
  2. Heuristic parse — structure-tolerant HTML walking (extract + structure)
     for legacy/unknown formats, or when the structured parse comes up empty.
     Legacy metadata (title/term/instructors) is merged in when available.
  3. AI structural split — only when the heuristic split scores below the
     confidence threshold AND the caller opted in (--ai). The model proposes
     a skeleton; deterministic extraction still supplies all content.

Never raises for unrecognized layouts — only for unreadable zips or zips
with no parsable content at all.
"""

from __future__ import annotations

import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import extract, structure, util
from .adapters.legacy import LegacyAdapter
from .ai_split import ProviderConfig, propose_and_apply
from .detect import detect_format
from .ir import Course
from .manifest_to_ir import manifest_to_ir
from .pipeline import build_manifest_from_dir, extract_and_normalize


class IngestError(Exception):
    pass


@dataclass
class IngestResult:
    course: Course
    confidence: float
    source_format: str
    detected_shape: Optional[str] = None
    used_ai: bool = False
    warnings: list[str] = field(default_factory=list)
    # Set by ingest_dir only: the manifest and its (still-living) source dir,
    # so downstream stages (scaffold.build_bundle) can reuse session-level
    # detail the IR flattens away. ingest_zip leaves these None because its
    # extracted tree dies with the temp dir.
    manifest: Optional[object] = None
    source_dir: Optional[Path] = None


def ingest_zip(
    zip_path: str | Path,
    *,
    course_number: str = "",
    term: str = "",
    ocw_url: Optional[str] = None,
    use_ai: bool = False,
    ai_cfg: Optional[ProviderConfig] = None,
    min_confidence: float = 0.45,
    no_pdfs: bool = False,
    verbose: bool = False,
) -> IngestResult:
    zip_path = Path(zip_path)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zip_names = set(zf.namelist())
    except (OSError, zipfile.BadZipFile) as exc:
        raise IngestError(f"cannot read zip: {exc}") from exc

    warnings: list[str] = []

    with tempfile.TemporaryDirectory(prefix="ocw_ingest_") as tmp:
        try:
            zip_root = extract_and_normalize(zip_path, Path(tmp))
        except ValueError as exc:
            raise IngestError(str(exc)) from exc

        fmt = detect_format(zip_root)

        # ── 1. Structured parse ───────────────────────────────────────────────
        if fmt == "modern":
            try:
                manifest = build_manifest_from_dir(
                    zip_root, no_pdfs=no_pdfs, verbose=verbose,
                )
            except Exception as exc:  # corrupted data.json trees etc.
                warnings.append(f"structured_parse_failed: {exc}")
                manifest = None

            if manifest is not None:
                course = manifest_to_ir(
                    manifest, zip_names,
                    course_number=course_number, term=term, ocw_url=ocw_url,
                )
                if course.lecture_count > 0:
                    return IngestResult(
                        course=course,
                        confidence=_structured_confidence(course),
                        source_format=fmt,
                        detected_shape=manifest.detected_shape,
                        warnings=warnings + manifest.warnings,
                    )
                warnings.append("structured_parse_empty")

        # ── 2. Heuristic parse ────────────────────────────────────────────────
        pages, _names = extract.read_zip(str(zip_path))
        if not pages:
            raise IngestError(f"no HTML pages found in {zip_path}")

        course, confidence = structure.build_course(
            pages, course_number=course_number, term=term, ocw_url=ocw_url,
        )
        if fmt == "legacy":
            _merge_legacy_metadata(course, LegacyAdapter(zip_root).parse_metadata())

        # ── 3. AI structural split (opt-in, low-confidence only) ─────────────
        used_ai = False
        if confidence < min_confidence and use_ai and ai_cfg is not None:
            if propose_and_apply(course, pages, ai_cfg):
                confidence = 1.0
                used_ai = True
            else:
                warnings.append("ai_split_failed")

        if course.lecture_count == 0:
            raise IngestError(
                f"no lectures could be derived from {zip_path} "
                f"(format={fmt}; try --ai or report the layout)"
            )

        return IngestResult(
            course=course,
            confidence=confidence,
            source_format=fmt,
            used_ai=used_ai,
            warnings=warnings,
        )


def ingest_dir(
    course_dir: str | Path,
    *,
    course_number: str = "",
    term: str = "",
    ocw_url: Optional[str] = None,
    no_pdfs: bool = False,
    verbose: bool = False,
) -> IngestResult:
    """
    Ingest an already-extracted course directory (structured parse only).

    Structured parse first; heuristic HTML walk (extract.read_dir +
    structure.build_course) when the structured parse yields no lectures —
    single-page feature courses (one big readings/notes table, no session
    subdirs) detect as "modern" but only the heuristic can split them.
    No AI rung: directory ingest is for local bulk processing.
    """
    zip_root = Path(course_dir)
    if not zip_root.is_dir():
        raise IngestError(f"not a directory: {zip_root}")
    # unwrap a single nested root dir, mirroring extract_and_normalize
    children = [c for c in zip_root.iterdir() if not c.name.startswith(".")]
    if len(children) == 1 and children[0].is_dir():
        zip_root = children[0]

    fmt = detect_format(zip_root)
    warnings: list[str] = []

    if fmt == "modern":
        try:
            manifest = build_manifest_from_dir(zip_root, no_pdfs=no_pdfs, verbose=verbose)
        except Exception as exc:
            warnings.append(f"structured_parse_failed: {exc}")
            manifest = None

        if manifest is not None:
            zip_names = {
                p.relative_to(zip_root).as_posix()
                for p in zip_root.rglob("*") if p.is_file()
            }
            course = manifest_to_ir(
                manifest, zip_names,
                course_number=course_number, term=term, ocw_url=ocw_url,
            )
            if course.lecture_count > 0:
                return IngestResult(
                    course=course,
                    confidence=_structured_confidence(course),
                    source_format=fmt,
                    detected_shape=manifest.detected_shape,
                    warnings=warnings + manifest.warnings,
                    manifest=manifest,
                    source_dir=zip_root,
                )
            warnings.append("structured_parse_empty")

    pages, _names = extract.read_dir(zip_root)
    if not pages:
        raise IngestError(f"no HTML pages found in {zip_root}")

    course, confidence = structure.build_course(
        pages, course_number=course_number, term=term, ocw_url=ocw_url,
    )
    if fmt == "legacy":
        _merge_legacy_metadata(course, LegacyAdapter(zip_root).parse_metadata())
    elif fmt == "modern":
        # data.json identity is authoritative even when the page structure
        # forced the heuristic split
        _merge_modern_metadata(course, zip_root)
    if course.lecture_count == 0:
        raise IngestError(f"no lectures could be derived from {zip_root}")

    return IngestResult(
        course=course,
        confidence=confidence,
        source_format=fmt,
        warnings=warnings,
        manifest=None,
        source_dir=zip_root,
    )


def _merge_modern_metadata(course: Course, zip_root: Path) -> None:
    try:
        from .adapters.modern import ModernAdapter
        meta = ModernAdapter(zip_root).parse_metadata()
    except Exception:
        return
    title = (meta.get("title") or "").strip()
    if title and course.title.strip().lower() in _JUNK_TITLES:
        course.title = title
    if not course.course_number and meta.get("course_id"):
        course.course_number = meta["course_id"]
    if not course.term:
        course.term = f"{meta.get('term', '')} {meta.get('year', '')}".strip()
    if not course.description and meta.get("description"):
        course.description = meta["description"]
    if not course.instructor and meta.get("instructors"):
        course.instructor = ", ".join(
            " ".join(p for p in (i.first_name, i.last_name) if p).strip()
            for i in meta["instructors"]
        )
    if meta.get("level") and not course.level:
        course.level = meta["level"][0] if isinstance(meta["level"], list) else meta["level"]
    course.slug = util.slugify(
        f"{course.course_number or course.title} {course.term}".strip()
    )


def _structured_confidence(course: Course) -> float:
    """
    Deterministic spine ⇒ structure is trustworthy; score by how enriched
    the lectures are (video, assets, or substantial text).
    """
    lectures = course.lectures
    if not lectures:
        return 0.0
    enriched = sum(
        1 for l in lectures
        if l.has_video or l.assets or l.pending_assets or len(l.content.split()) > 80
    )
    return round(0.5 + 0.5 * (enriched / len(lectures)), 3)


_JUNK_TITLES = frozenset({
    "", "untitled course", "course home", "home", "index", "syllabus",
})


def _merge_legacy_metadata(course: Course, meta: dict) -> None:
    """Fill course fields the heuristic path could not derive."""
    title = (meta.get("title") or "").strip()
    if title and course.title.strip().lower() in _JUNK_TITLES:
        course.title = title
    if not course.course_number and meta.get("course_id"):
        course.course_number = meta["course_id"]
    if not course.term and meta.get("term"):
        course.term = meta["term"]
    if not course.description and meta.get("description"):
        course.description = meta["description"]
    if not course.instructor and meta.get("instructors"):
        course.instructor = ", ".join(
            " ".join(p for p in (i.first_name, i.last_name) if p).strip()
            for i in meta["instructors"]
        )
    # The heuristic slug may have been derived from a junk title before the
    # metadata was known — recompute it from the merged identity.
    course.slug = util.slugify(
        f"{course.course_number or course.title} {course.term}".strip()
    )
