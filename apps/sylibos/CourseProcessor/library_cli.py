"""Library ingestion CLI - separate from the existing OCW pipeline.

The existing `python -m preprocessor COURSE.zip` workflow uses the typer-based
pipeline to produce manifests for direct course import. This module handles the
DIFFERENT workflow: ingesting courses into library.db (the shared catalog that
users browse and add from).

Usage:
  python -m preprocessor.library_cli inspect COURSE.zip [--course-number 18.01SC] [--term "Fall 2010"]
  python -m preprocessor.library_cli build   COURSE.zip --out ./build [--ai]
  python -m preprocessor.library_cli load    ./build/<slug> [--db /data/library.db]

Default DB path: /mnt/Luna/Backends/SylibOS-Data/library.db (or $LIBRARY_DB_PATH).

Ingestion ladder (see ingest.py): structured format/shape-aware parse first,
heuristic HTML walking for legacy/unknown layouts, AI structural split only
as an opt-in last resort (--ai). Do not point --ai at LazurOS while it returns
stub responses; use the real Ollama on the GPU desktop: --ai-url http://<ip>:11434.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys

from . import assets as assets_mod
from . import db as db_mod
from . import report, scaffold, validate
from .ai_split import ProviderConfig
from .ingest import IngestError, IngestResult, ingest_dir, ingest_zip
from .ir import Course

DEFAULT_DB = os.environ.get("LIBRARY_DB_PATH", "/mnt/Luna/Backends/SylibOS-Data/library.db")
DEFAULT_MIN_CONFIDENCE = 0.45


def _run_ingest(args) -> IngestResult:
    cfg = _provider_from_args(args)
    try:
        result = ingest_zip(
            args.zip,
            course_number=args.course_number,
            term=args.term,
            ocw_url=args.ocw_url,
            use_ai=args.ai,
            ai_cfg=cfg,
            min_confidence=args.min_confidence,
            no_pdfs=args.no_pdfs,
            verbose=args.verbose,
        )
    except IngestError as e:
        sys.exit(f"error: {e}")

    if result.confidence < args.min_confidence and not result.used_ai:
        hint = "" if args.ai else "; consider re-running with --ai"
        print(f"warning: low split confidence ({result.confidence}){hint}",
              file=sys.stderr)
    for w in result.warnings:
        print(f"warning: {w}", file=sys.stderr)
    return result


def cmd_inspect(args):
    result = _run_ingest(args)
    d = result.course.to_dict()
    warnings = []
    try:
        warnings = validate.validate_ir(d, build_dir=None)
    except validate.ValidationError as e:
        warnings = [f"WOULD FAIL VALIDATION: {e}"]
    print(f"format={result.source_format}"
          + (f"  shape={result.detected_shape}" if result.detected_shape else ""))
    print(report.render(d, result.confidence, warnings))


def cmd_build(args):
    result = _run_ingest(args)
    course = result.course

    build_dir = os.path.join(args.out, course.slug)
    os.makedirs(build_dir, exist_ok=True)

    n_assets = assets_mod.extract_course_assets(course, args.zip, build_dir)

    d = course.to_dict()
    try:
        warnings = validate.validate_ir(d, build_dir=build_dir)
    except validate.ValidationError as e:
        sys.exit(f"validation failed: {e}")

    with open(os.path.join(build_dir, "ir.json"), "w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=2, ensure_ascii=False)

    print(f"format={result.source_format}"
          + (f"  shape={result.detected_shape}" if result.detected_shape else ""))
    print(report.render(d, result.confidence, warnings))
    print(f"built -> {build_dir}  ({n_assets} asset files)")
    print(f"next:  python -m preprocessor.library_cli load {build_dir} --db {args.db}")


def _build_processed_dir(course_dir: str, out_root: str, *,
                         include_videos: bool, no_pdfs: bool,
                         verbose: bool) -> dict:
    """ingest_dir -> assets -> ir.json + scaffold bundle files. Returns the
    summary row for batch reporting."""
    result = ingest_dir(course_dir, no_pdfs=no_pdfs, verbose=verbose)
    course, manifest, src = result.course, result.manifest, result.source_dir
    if manifest is None:  # heuristic path: no session pages to align against
        manifest = scaffold.synthesize_manifest(course)
    for w in result.warnings:
        print(f"warning: {w}", file=sys.stderr)

    routed = scaffold.prepare_exercise_assets(course, manifest, src)

    build_dir = os.path.join(out_root, course.slug)
    # processed folders are regenerated wholesale; a stale assets/ would make
    # _avoid_collision suffix every re-extracted file
    if os.path.isdir(build_dir):
        shutil.rmtree(build_dir)
    os.makedirs(build_dir, exist_ok=True)
    n_assets = assets_mod.extract_course_assets_from_dir(course, str(src), build_dir)

    d = course.to_dict()
    warnings = validate.validate_ir(d, build_dir=build_dir)
    with open(os.path.join(build_dir, "ir.json"), "w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=2, ensure_ascii=False)

    bundle = scaffold.build_bundle(course, manifest, src,
                                   include_videos=include_videos)
    tree_warnings = validate.validate_tree(bundle, build_dir=build_dir)

    for name in ("course", "tree", "concepts", "exercises", "lessons", "videos"):
        if bundle.get(name) is None:
            continue
        with open(os.path.join(build_dir, f"{name}.json"), "w", encoding="utf-8") as fh:
            json.dump(bundle[name], fh, indent=2, ensure_ascii=False)

    print(f"format={result.source_format}  shape={result.detected_shape}")
    print(report.render(d, result.confidence, warnings + tree_warnings))
    print(report.render_tree(bundle))
    counts = bundle["course"]["counts"]
    print(f"built -> {build_dir}  ({n_assets} asset files, {routed} routed exercises)")
    return {
        "slug": course.slug, "title": course.title,
        "lectures": course.lecture_count,
        "trunk": counts["trunk_nodes"], "nodes": counts["nodes"],
        "backed": counts["backed_exercises"],
        "match_rate": bundle["course"]["match_rate"],
        "assets": n_assets,
        "warnings": len(result.warnings) + len(bundle["warnings"]),
    }


def cmd_build_dir(args):
    try:
        _build_processed_dir(args.course_dir, args.out,
                             include_videos=not args.no_videos,
                             no_pdfs=args.no_pdfs, verbose=args.verbose)
    except (IngestError, validate.ValidationError) as e:
        sys.exit(f"error: {e}")


def cmd_batch(args):
    root = args.courses_root
    dirs = sorted(
        d for d in (os.path.join(root, n) for n in os.listdir(root))
        if os.path.isdir(d) and (
            os.path.exists(os.path.join(d, "data.json"))
            or os.path.exists(os.path.join(d, "content_map.json"))
        )
    )
    if not dirs:
        sys.exit(f"error: no course directories found under {root}")

    rows, failures = [], []
    for i, d in enumerate(dirs, 1):
        name = os.path.basename(d)
        if args.skip and name in args.skip:
            print(f"\n### [{i}/{len(dirs)}] {name} — skipped")
            continue
        print(f"\n### [{i}/{len(dirs)}] {name}")
        try:
            rows.append(_build_processed_dir(
                d, args.out, include_videos=not args.no_videos,
                no_pdfs=args.no_pdfs, verbose=args.verbose,
            ))
        except Exception as e:  # keep the batch alive
            failures.append((name, str(e)))
            print(f"FAILED: {e}", file=sys.stderr)

    print("\n" + "=" * 98)
    print(f"{'slug':<38} {'lec':>4} {'trunk':>5} {'nodes':>5} {'backed':>6} "
          f"{'match':>5} {'assets':>6} {'warn':>4}")
    print("-" * 98)
    for r in rows:
        mr = f"{r['match_rate']:.2f}" if r["match_rate"] is not None else "-"
        print(f"{r['slug']:<38} {r['lectures']:>4} {r['trunk']:>5} {r['nodes']:>5} "
              f"{r['backed']:>6} {mr:>5} {r['assets']:>6} {r['warnings']:>4}")
    if failures:
        print(f"\nFAILED ({len(failures)}):")
        for name, err in failures:
            print(f"  - {name}: {err}")
    print(f"\n{len(rows)} ok, {len(failures)} failed -> {args.out}")


def cmd_load(args):
    ir_path = os.path.join(args.build_dir, "ir.json")
    if not os.path.exists(ir_path):
        sys.exit(f"error: {ir_path} not found (run `build` first)")
    with open(ir_path, encoding="utf-8") as fh:
        d = json.load(fh)

    try:
        validate.validate_ir(d, build_dir=args.build_dir)
    except validate.ValidationError as e:
        sys.exit(f"validation failed: {e}")

    course = Course.from_dict(d)
    conn = db_mod.connect(args.db)
    try:
        db_mod.upsert_course(conn, course, args.build_dir)
    finally:
        conn.close()
    print(f"loaded '{course.slug}' ({course.lecture_count} lectures) into {args.db}")


def _provider_from_args(args):
    return ProviderConfig(
        provider=getattr(args, "ai_provider", "ollama"),
        url=getattr(args, "ai_url", "http://localhost:11434"),
        model=getattr(args, "ai_model", "llama3.2"),
        token=getattr(args, "ai_token", "") or os.environ.get("LAZUROS_TOKEN", ""),
    )


def _guess_from_filename(zip_path):
    name = os.path.basename(zip_path)
    term = ""
    m = re.search(r"(spring|summer|fall|winter|january|iap)[-_ ]?(\d{4})", name, re.IGNORECASE)
    if m:
        term = f"{m.group(1).title()} {m.group(2)}"
    return "", term


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m preprocessor.library_cli",
                                description="Ingest an MIT OCW zip into library.db")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_common(sp):
        sp.add_argument("--course-number", default="")
        sp.add_argument("--term", default="")
        sp.add_argument("--ocw-url", default=None)
        sp.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)
        sp.add_argument("--no-pdfs", action="store_true", default=False,
                        help="skip PDF text extraction (faster)")
        sp.add_argument("--verbose", "-v", action="store_true", default=False)
        sp.add_argument("--ai", action="store_true", default=False)
        sp.add_argument("--ai-provider", choices=["ollama", "lazuros"], default="ollama")
        sp.add_argument("--ai-url", default="http://localhost:11434")
        sp.add_argument("--ai-model", default="llama3.2")
        sp.add_argument("--ai-token", default="")

    sp_i = sub.add_parser("inspect", help="dry-run report, no writes")
    sp_i.add_argument("zip")
    add_common(sp_i)
    sp_i.set_defaults(func=cmd_inspect)

    sp_b = sub.add_parser("build", help="zip -> validated IR + extracted assets")
    sp_b.add_argument("zip")
    sp_b.add_argument("--out", default="./build")
    sp_b.add_argument("--db", default=DEFAULT_DB)
    add_common(sp_b)
    sp_b.set_defaults(func=cmd_build)

    sp_l = sub.add_parser("load", help="IR -> library.db (upsert by slug)")
    sp_l.add_argument("build_dir")
    sp_l.add_argument("--db", default=DEFAULT_DB)
    sp_l.set_defaults(func=cmd_load)

    sp_d = sub.add_parser(
        "build-dir",
        help="extracted course dir -> processed folder (ir + tree + chunks)")
    sp_d.add_argument("course_dir")
    sp_d.add_argument("--out", default="./ProcessedCourses")
    sp_d.add_argument("--no-videos", action="store_true", default=False,
                      help="skip videos.json (skeleton mode)")
    sp_d.add_argument("--no-pdfs", action="store_true", default=False)
    sp_d.add_argument("--verbose", "-v", action="store_true", default=False)
    sp_d.set_defaults(func=cmd_build_dir)

    sp_a = sub.add_parser(
        "batch",
        help="process every course dir under a root into --out")
    sp_a.add_argument("courses_root")
    sp_a.add_argument("--out", default="./ProcessedCourses")
    sp_a.add_argument("--no-videos", action="store_true", default=False)
    sp_a.add_argument("--no-pdfs", action="store_true", default=False)
    sp_a.add_argument("--skip", action="append", default=[],
                      help="course dir basename to skip (repeatable)")
    sp_a.add_argument("--verbose", "-v", action="store_true", default=False)
    sp_a.set_defaults(func=cmd_batch)

    args = p.parse_args(argv)

    if getattr(args, "zip", None) and (not args.course_number or not args.term):
        guess_num, guess_term = _guess_from_filename(args.zip)
        args.course_number = args.course_number or guess_num
        args.term = args.term or guess_term

    args.func(args)


if __name__ == "__main__":
    main()
