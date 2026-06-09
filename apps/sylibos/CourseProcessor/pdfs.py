"""
Selective PDF text extraction.

Primary:  pdfplumber  (handles text-layer PDFs)
Fallback: pytesseract + pdf2image  (scanned PDFs — opt-in via ocr=True)

Only called for resource types in EXTRACT_FOR_TYPES.
"""

from __future__ import annotations
import re
from pathlib import Path
from typing import Optional

try:
    import pdfplumber
    _PDFPLUMBER_OK = True
except ImportError:
    _PDFPLUMBER_OK = False

_OCR_CHECKED   = False
_OCR_AVAILABLE = False
_OCR_THRESHOLD = 100   # chars — below this pdfplumber yield triggers OCR attempt


def _check_ocr() -> bool:
    global _OCR_CHECKED, _OCR_AVAILABLE
    if _OCR_CHECKED:
        return _OCR_AVAILABLE
    _OCR_CHECKED = True
    try:
        import pytesseract        # noqa: F401
        from pdf2image import convert_from_path  # noqa: F401
        _OCR_AVAILABLE = True
    except ImportError:
        _OCR_AVAILABLE = False
    return _OCR_AVAILABLE


EXTRACT_FOR_TYPES = frozenset({
    "Lecture Notes",
    "Problem Sets",
    "Problem Set Solutions",
    "Exams",
    "Exams with Solutions",
})

_BOILERPLATE: list[re.Pattern] = [
    re.compile(r"Cite as:.*?OpenCourseWare[^\n]*",        re.IGNORECASE | re.DOTALL),
    re.compile(r"MIT OpenCourseWare\s+https?://ocw\.mit\.edu[^\n]*", re.IGNORECASE),
    re.compile(r"Creative Commons[^\n]*licen[sc]e[^\n]*", re.IGNORECASE),
    re.compile(r"^\s*\d+\s*$",                            re.MULTILINE),
    re.compile(r"(Next|Previous)\s*[|»«]",                re.IGNORECASE),
    re.compile(r"Image removed due to copyright restrictions\.", re.IGNORECASE),
]


def clean_pdf_text(text: str) -> str:
    for pat in _BOILERPLATE:
        text = pat.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


_HASH_PREFIX = re.compile(r"^[0-9a-f]{32}[_-]", re.IGNORECASE)


def _resolve_pdf_path(file_path: str, zip_root: Path) -> Optional[Path]:
    """
    file_path is the `file` field from resource data.json.
    It may be:
      (a) a URL-like path:  /courses/18-06sc.../resources/ses1-1/.../notes.pdf
      (b) a relative path:  static_resources/{hash}_notes.pdf
      (c) just a filename:  notes.pdf

    PDFs in static_resources/ are stored with a 32-char hex hash prefix:
      {32hex}_{original-name}.pdf
    so direct filename lookup fails — we need a hash-prefix-aware search.
    """
    if not file_path:
        return None

    filename = Path(file_path.lstrip("/")).name
    if not filename:
        return None

    def is_pdf(p: Path) -> bool:
        return p.exists() and p.suffix.lower() == ".pdf"

    # 1. Exact match in static_resources (works when file field already has hash prefix)
    c = zip_root / "static_resources" / filename
    if is_pdf(c):
        return c

    # 2. Strip course-slug prefix from URL and resolve within zip_root.
    #    e.g. /courses/18-06sc.../static_resources/notes.pdf  →  static_resources/notes.pdf
    parts = Path(file_path.lstrip("/")).parts
    for i, part in enumerate(parts):
        if part in ("static_resources", "resources"):
            candidate = zip_root.joinpath(*parts[i:])
            if is_pdf(candidate):
                return candidate

    # 3. Hash-prefix search in static_resources/ — the common case for modern OCW.
    #    Files are stored as {32hex}_{original-filename}.pdf; the `file` URL only
    #    has the original name.  Scan the directory rather than glob to handle
    #    case-insensitive filesystems and slight name variations.
    sr_dir = zip_root / "static_resources"
    if sr_dir.is_dir():
        stem_lower = Path(filename).stem.lower()
        for f in sr_dir.iterdir():
            if f.suffix.lower() != ".pdf":
                continue
            # Strip hash prefix to compare against the original name
            orig = _HASH_PREFIX.sub("", f.name)
            if orig.lower() == filename.lower():
                return f
            # Looser: match by stem (ignores quality suffix like _300k)
            orig_stem = Path(orig).stem.lower()
            if orig_stem and stem_lower.startswith(orig_stem[:12]):
                return f

    # 4. Any PDF anywhere under resources/ matching the filename
    for p in (zip_root / "resources").rglob(filename):
        if is_pdf(p):
            return p

    return None


def extract_pdf_text(
    resource,
    zip_root: Path,
    ocr: bool = False,
) -> Optional[str]:
    """
    Extract text from the PDF associated with resource.
    resource may be a ResourceNode object or a dict.
    Returns None if the type is not in EXTRACT_FOR_TYPES, PDF not found, or extraction fails.
    """
    primary_type = getattr(resource, "primary_type", None) or resource.get("primary_type", "")
    file_type    = getattr(resource, "file_type",    None) or resource.get("file_type",    "")
    file_path    = getattr(resource, "file_path",    None) or resource.get("file_path",    "")

    if primary_type not in EXTRACT_FOR_TYPES:
        return None
    if file_type != "application/pdf":
        return None

    pdf_path = _resolve_pdf_path(file_path or "", zip_root)
    if not pdf_path:
        return None

    if _PDFPLUMBER_OK:
        text = _extract_pdfplumber(pdf_path)
        if text and len(text) >= _OCR_THRESHOLD:
            return clean_pdf_text(text)

    if ocr and _check_ocr():
        text = _extract_ocr(pdf_path)
        if text:
            return clean_pdf_text(text)

    return None


def _extract_pdfplumber(pdf_path: Path) -> Optional[str]:
    try:
        import pdfplumber
        pages: list[str] = []
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    pages.append(t)
        return "\n\n".join(pages) if pages else None
    except Exception:
        return None


def _extract_ocr(pdf_path: Path) -> Optional[str]:
    try:
        import pytesseract
        from pdf2image import convert_from_path
        pages = convert_from_path(str(pdf_path), dpi=150)
        texts: list[str] = []
        for img in pages:
            t = pytesseract.image_to_string(img, lang="eng")
            if t.strip():
                texts.append(t)
        return "\n\n".join(texts) if texts else None
    except Exception:
        return None


def attach_pdf_texts(spine: list, zip_root: Path, ocr: bool = False, verbose: bool = False) -> None:
    """Batch-attach extracted_text to ResourceNodes across the spine."""
    total = sum(
        1
        for unit in spine
        for sess in unit.sessions
        for r in sess.resources
        if r.primary_type in EXTRACT_FOR_TYPES and r.file_type == "application/pdf"
    )
    done = 0
    for unit in spine:
        for sess in unit.sessions:
            for resource in sess.resources:
                if resource.primary_type not in EXTRACT_FOR_TYPES:
                    continue
                if resource.file_type != "application/pdf":
                    continue
                done += 1
                if verbose:
                    print(f"  [{done}/{total}] {resource.title or resource.slug}")
                resource.extracted_text = extract_pdf_text(resource, zip_root, ocr=ocr)
