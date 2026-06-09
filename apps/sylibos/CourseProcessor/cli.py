"""
OCW Preprocessor CLI

Usage:
  python -m preprocessor path/to/course.zip
  python -m preprocessor path/to/course.zip --output manifest.json
  python -m preprocessor path/to/course.zip --push-to http://TRUENAS_IP:8004
  python -m preprocessor path/to/course.zip --push-to http://TRUENAS_IP:8004 --verbose
  python -m preprocessor path/to/course.zip --ocr          # enable OCR for scanned PDFs
  python -m preprocessor path/to/course.zip --no-pdfs      # skip PDF extraction
  python -m preprocessor path/to/course.zip --cache ./cache --verbose
"""

from __future__ import annotations
import sys
from pathlib import Path
from typing import Optional

import typer

from .pipeline import preprocess
from .converter import manifest_to_course

app = typer.Typer(
    name="preprocessor",
    help="Convert MIT OCW ZIP archives into structured CourseManifest JSON for SylibOS.",
    add_completion=False,
)


@app.command()
def main(
    zip_path: Path = typer.Argument(
        ...,
        help="Path to the MIT OCW course ZIP file.",
        exists=True, file_okay=True, dir_okay=False, resolve_path=True,
    ),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o",
        help="Write manifest JSON to this file (default: stdout).",
    ),
    push_to: Optional[str] = typer.Option(
        None, "--push-to",
        help="POST the converted course to a SylibOS backend URL (e.g. http://localhost:8004).",
    ),
    token: Optional[str] = typer.Option(
        None, "--token", "-t",
        help="Bearer token for the SylibOS backend.",
        envvar="SYLIBOS_TOKEN",
    ),
    include_exams: bool = typer.Option(
        False, "--include-exams",
        help="Include assessment/exam sessions as lectures (excluded by default).",
    ),
    no_pdfs: bool = typer.Option(
        False, "--no-pdfs",
        help="Skip PDF text extraction (faster; uses session overviews only).",
    ),
    ocr: bool = typer.Option(
        False, "--ocr",
        help="Enable OCR fallback for scanned PDFs (requires Tesseract).",
    ),
    cache: Optional[Path] = typer.Option(
        None, "--cache",
        help="Cache directory for SHA256-keyed idempotency.",
    ),
    verbose: bool = typer.Option(
        False, "--verbose", "-v",
        help="Print progress to stderr.",
    ),
) -> None:
    """Parse an MIT OCW ZIP and produce a structured CourseManifest."""

    manifest = preprocess(
        zip_path,
        output_path=output,
        cache_dir=cache,
        no_pdfs=no_pdfs,
        ocr=ocr,
        verbose=verbose,
    )

    typer.echo(f"Course: {manifest.title} ({manifest.course_id})", err=True)
    typer.echo(
        f"Format: {manifest.source_format}  |  "
        f"Shape: {manifest.detected_shape} (confidence={manifest.shape_confidence:.2f})",
        err=True,
    )
    typer.echo(
        f"Units: {len(manifest.units)}  |  "
        f"Sessions: {sum(len(u.sessions) for u in manifest.units)}",
        err=True,
    )
    if manifest.warnings:
        typer.echo(f"Warnings: {', '.join(manifest.warnings)}", err=True)

    if not output and not push_to:
        typer.echo(manifest.model_dump_json(indent=2))

    if push_to:
        _push_course(manifest, push_to, token, include_exams, verbose)


def _push_course(
    manifest,
    backend_url: str,
    token: Optional[str],
    include_exams: bool,
    verbose: bool,
) -> None:
    try:
        import httpx
    except ImportError:
        typer.echo("ERROR: httpx required for --push-to. Run: pip install httpx", err=True)
        raise typer.Exit(1)

    def log(msg: str) -> None:
        if verbose:
            typer.echo(msg, err=True)

    course = manifest_to_course(manifest, exclude_exams=not include_exams)
    url    = backend_url.rstrip("/") + "/api/courses"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    log(f"Pushing to {url} ({len(course['lectures'])} lectures)…")
    try:
        r = httpx.post(url, json=course, headers=headers, timeout=30)
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        typer.echo(
            f"ERROR: Backend returned {e.response.status_code}: {e.response.text}",
            err=True,
        )
        raise typer.Exit(1)
    except httpx.RequestError as e:
        typer.echo(f"ERROR: Could not reach backend: {e}", err=True)
        raise typer.Exit(1)

    typer.echo(
        f"Pushed '{manifest.title}' successfully "
        f"({len(course['lectures'])} lectures, id={course['id']})"
    )


def run() -> None:
    app()


if __name__ == "__main__":
    run()
