"""
OCW Preprocessor pipeline orchestrator.

preprocess(zip_path) → CourseManifest

Stages:
  1. Extract zip + hash
  2. Detect format and shape
  3. Parse metadata via adapter
  4. Parse resources via adapter
  5. Attach VTT/SRT transcripts
  6. Build spine via shape builder
  7. Link resources to sessions
  8. Resolve Hugo shortcodes across all text fields
  9. Parse syllabus page for prerequisites/goals
 10. Selective PDF text extraction
 11. Assemble + validate CourseManifest
 12. Write output / cache
"""

from __future__ import annotations
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from ._utils import html_to_text, humanise_slug
from .detect import detect_format, detect_shape
from .manifest import CourseManifest, ResourceNode, UnitNode
from .pdfs import attach_pdf_texts
from .shortcodes import ShortcodeResolver, load_content_map
from .transcripts import attach_transcripts

from .adapters.modern  import ModernAdapter
from .adapters.legacy  import LegacyAdapter
from .adapters.archive import ArchiveAdapter

from .shapes.scholar     import ScholarBuilder
from .shapes.flat_feature import FlatFeatureBuilder
from .shapes.project_lab  import ProjectLabBuilder
from .shapes.seminar      import SeminarBuilder
from .shapes.video_only   import VideoOnlyBuilder

_ADAPTERS = {
    "modern":  ModernAdapter,
    "legacy":  LegacyAdapter,
    "archive": ArchiveAdapter,
}
_BUILDERS = {
    "scholar":      ScholarBuilder,
    "flat_feature": FlatFeatureBuilder,
    "project_lab":  ProjectLabBuilder,
    "seminar":      SeminarBuilder,
    "video_only":   VideoOnlyBuilder,
}


# ── Public entry point ────────────────────────────────────────────────────────

def preprocess(
    zip_path: str | Path,
    output_path: Optional[str | Path] = None,
    cache_dir:   Optional[str | Path] = None,
    no_pdfs:     bool = False,
    ocr:         bool = False,
    verbose:     bool = False,
) -> CourseManifest:
    """
    Parse an OCW course zip and return a CourseManifest.

    Parameters
    ----------
    zip_path    : path to the .zip file
    output_path : write manifest JSON here (optional)
    cache_dir   : directory for SHA256-keyed cache (idempotency)
    no_pdfs     : skip PDF text extraction
    ocr         : enable OCR fallback for scanned PDFs (requires Tesseract)
    verbose     : log progress to stdout
    """
    zip_path = Path(zip_path)
    zip_sha  = _hash_file(zip_path)

    def log(msg: str) -> None:
        if verbose:
            print(msg)

    # ── Idempotency cache ─────────────────────────────────────────────────────
    if cache_dir:
        cached = Path(cache_dir) / f"{zip_sha}.json"
        if cached.exists():
            log(f"Cache hit: {cached}")
            return CourseManifest.model_validate_json(cached.read_text())

    with tempfile.TemporaryDirectory(prefix="ocw_") as _tmp:
        zip_root = _extract_and_normalize(zip_path, Path(_tmp))
        log(f"Extracted to {zip_root}")

        # ── Format + shape ────────────────────────────────────────────────────
        fmt              = detect_format(zip_root)
        shape, confidence = detect_shape(zip_root, fmt)
        log(f"Format: {fmt}  |  Shape: {shape} (confidence={confidence:.2f})")

        # ── Adapter + builder ─────────────────────────────────────────────────
        adapter = _ADAPTERS[fmt](zip_root)
        builder = _BUILDERS[shape](zip_root, adapter)

        # ── Metadata + resources ──────────────────────────────────────────────
        log("Parsing metadata…")
        metadata = adapter.parse_metadata()

        log("Parsing resources…")
        resources = adapter.parse_resources()
        log(f"  {len(resources)} classified resources")

        # ── Transcripts ───────────────────────────────────────────────────────
        log("Attaching transcripts…")
        attach_transcripts(resources, zip_root)

        # ── Spine ─────────────────────────────────────────────────────────────
        log("Building spine…")
        units = builder.build()
        total_sessions = sum(len(u.sessions) for u in units)
        log(f"  {len(units)} units, {total_sessions} sessions")

        # ── Resource linking ──────────────────────────────────────────────────
        log("Linking resources to sessions…")
        unlinked = builder.link_resources(units, resources)
        log(f"  Unlinked: {len(unlinked)}")

        # ── Shortcode resolution ──────────────────────────────────────────────
        log("Resolving shortcodes…")
        cmap     = load_content_map(zip_root)
        resolver = ShortcodeResolver(cmap, zip_root)

        if "description" in metadata:
            metadata["description"] = resolver.resolve(metadata["description"])
        for unit in units:
            unit.overview = resolver.resolve(unit.overview)
            for session in unit.sessions:
                session.overview = resolver.resolve(session.overview)
                for r in session.resources:
                    r.title       = resolver.resolve(r.title)
                    r.description = resolver.resolve(r.description)
        for r in unlinked:
            r.title       = resolver.resolve(r.title)
            r.description = resolver.resolve(r.description)

        # ── Syllabus supplement (prerequisites / goals) ───────────────────────
        syllabus = _parse_syllabus(zip_root, resolver)
        metadata.setdefault("prerequisites", syllabus.get("prerequisites", ""))
        metadata.setdefault("goals",         syllabus.get("goals", ""))

        if not metadata.get("title") or metadata["title"].lower() == "syllabus":
            metadata["title"] = humanise_slug(zip_root.name)

        # ── PDF extraction ────────────────────────────────────────────────────
        if not no_pdfs:
            log("Extracting PDF text…")
            attach_pdf_texts(units, zip_root, ocr=ocr, verbose=verbose)

        # ── Assemble manifest ─────────────────────────────────────────────────
        manifest = CourseManifest(
            **metadata,
            source_format=fmt,
            detected_shape=shape,
            shape_confidence=confidence,
            zip_sha256=zip_sha,
            units=units,
            unlinked_resources=unlinked,
            warnings=_collect_warnings(units, resources, metadata),
        )

        if manifest.warnings:
            log(f"Warnings: {', '.join(manifest.warnings)}")

        # ── Output ────────────────────────────────────────────────────────────
        manifest_json = manifest.model_dump_json(indent=2)

        if output_path:
            Path(output_path).write_text(manifest_json, encoding="utf-8")
            log(f"Manifest written to {output_path}")

        if cache_dir:
            Path(cache_dir).mkdir(parents=True, exist_ok=True)
            (Path(cache_dir) / f"{zip_sha}.json").write_text(manifest_json, encoding="utf-8")

        return manifest


# ── Private helpers ───────────────────────────────────────────────────────────

def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


_JUNK_NAMES = frozenset({"__MACOSX", "__pycache__", ".DS_Store"})


def _extract_and_normalize(zip_path: Path, dest: Path) -> Path:
    dest_resolved = dest.resolve()
    try:
        with zipfile.ZipFile(zip_path) as zf:
            # Zip-slip guard: reject any entry that would escape the destination
            for entry in zf.namelist():
                target = (dest / entry).resolve()
                if not str(target).startswith(str(dest_resolved) + "/") and target != dest_resolved:
                    raise ValueError(f"Unsafe zip entry (zip-slip): {entry}")
            zf.extractall(dest)
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Not a valid ZIP file: {exc}") from exc

    children = [
        c for c in dest.iterdir()
        if c.name not in _JUNK_NAMES and not c.name.startswith(".")
    ]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return dest


def _extract_between(text: str, start: str, end_candidates: list[str]) -> str:
    """Extract text between start header and the first matching end header."""
    m = re.search(
        rf"(?:^|\n)\s*{re.escape(start)}[:\s]*\n",
        text, re.IGNORECASE,
    )
    if not m:
        return ""
    body_start = m.end()
    end_pos = len(text)
    for end_word in end_candidates:
        em = re.search(
            rf"(?:^|\n)\s*{re.escape(end_word)}[:\s]*\n",
            text, re.IGNORECASE,
        )
        if em and em.start() > body_start and em.start() < end_pos:
            end_pos = em.start()
    return text[body_start:end_pos].strip()


_SYLLABUS_SLUGS = ("syllabus", "course-info", "about-this-course", "overview", "calendar")
_PREREQ_HEADERS = ("Prerequisites", "Required Background", "Background")
_GOALS_HEADERS  = ("Course Goals", "Learning Goals", "Learning Objectives", "Goals", "Objectives")
_END_HEADERS    = ("Format", "Grading", "Textbooks", "Materials", "Calendar",
                   "Schedule", "Assignments", "Policies")


def _parse_syllabus(zip_root: Path, resolver: ShortcodeResolver) -> dict:
    """
    Parse pages/{syllabus-slug}/data.json for prerequisites and goals.
    Tries multiple candidate page slugs in priority order.
    Returns dict with keys: prerequisites, goals.
    """
    pages_dir = zip_root / "pages"
    content_html = ""

    for slug in _SYLLABUS_SLUGS:
        sp = pages_dir / slug / "data.json"
        if sp.exists():
            try:
                data = json.loads(sp.read_text(encoding="utf-8", errors="replace"))
                content_html = data.get("content") or ""
                if content_html:
                    break
            except Exception:
                continue

    if not content_html:
        return {}

    text = html_to_text(resolver.resolve(content_html))

    prereqs = ""
    for h in _PREREQ_HEADERS:
        prereqs = _extract_between(text, h, list(_GOALS_HEADERS) + list(_END_HEADERS))
        if prereqs:
            break

    goals = ""
    for h in _GOALS_HEADERS:
        goals = _extract_between(text, h, list(_PREREQ_HEADERS) + list(_END_HEADERS))
        if goals:
            break

    return {"prerequisites": prereqs, "goals": goals}


def _collect_warnings(
    units: list[UnitNode],
    resources: list[ResourceNode],
    metadata: dict,
) -> list[str]:
    w: list[str] = []
    if not any(u.sessions for u in units):
        w.append("no_sessions_found")
    has_videos = any(r.primary_type == "Lecture Videos" for r in resources)
    if not has_videos:
        w.append("no_lecture_videos")
    if has_videos and any(
        r.primary_type == "Lecture Videos" and not r.transcript_text
        for r in resources
    ):
        w.append("missing_transcripts")
    if not metadata.get("instructors"):
        w.append("no_instructors_found")
    return w
