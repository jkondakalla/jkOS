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

Do not point --ai at LazurOS while it returns stub responses. Use the real
Ollama on the GPU desktop: --ai-url http://<desktop-ip>:11434. Clean STEM
courses do not call the model at all.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

from . import assets as assets_mod
from . import db as db_mod
from . import extract, report, structure, validate
from .ai_split import ProviderConfig, propose_and_apply
from .ir import Course

DEFAULT_DB = os.environ.get("LIBRARY_DB_PATH", "/mnt/Luna/Backends/SylibOS-Data/library.db")
DEFAULT_MIN_CONFIDENCE = 0.45


def _build_ir(zip_path, course_number, term, ocw_url, use_ai, cfg, min_conf):
    pages, _names = extract.read_zip(zip_path)
    if not pages:
        sys.exit(f"error: no HTML pages found in {zip_path}")

    course, confidence = structure.build_course(
        pages, course_number=course_number, term=term, ocw_url=ocw_url
    )

    if confidence < min_conf:
        if use_ai:
            ok = propose_and_apply(course, pages, cfg)
            if ok:
                confidence = 1.0
            else:
                print("warning: AI split fallback failed; keeping deterministic split",
                      file=sys.stderr)
        else:
            print(f"warning: low split confidence ({confidence}); "
                  f"consider re-running with --ai", file=sys.stderr)
    return course, confidence, pages


def cmd_inspect(args):
    cfg = _provider_from_args(args)
    course, confidence, _pages = _build_ir(
        args.zip, args.course_number, args.term, args.ocw_url,
        use_ai=args.ai, cfg=cfg, min_conf=args.min_confidence,
    )
    d = course.to_dict()
    warnings = []
    try:
        warnings = validate.validate_ir(d, build_dir=None)
    except validate.ValidationError as e:
        warnings = [f"WOULD FAIL VALIDATION: {e}"]
    print(report.render(d, confidence, warnings))


def cmd_build(args):
    cfg = _provider_from_args(args)
    course, confidence, _pages = _build_ir(
        args.zip, args.course_number, args.term, args.ocw_url,
        use_ai=args.ai, cfg=cfg, min_conf=args.min_confidence,
    )

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

    print(report.render(d, confidence, warnings))
    print(f"built -> {build_dir}  ({n_assets} asset files)")
    print(f"next:  python -m preprocessor.library_cli load {build_dir} --db {args.db}")


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

    args = p.parse_args(argv)

    if getattr(args, "zip", None) and (not args.course_number or not args.term):
        guess_num, guess_term = _guess_from_filename(args.zip)
        args.course_number = args.course_number or guess_num
        args.term = args.term or guess_term

    args.func(args)


if __name__ == "__main__":
    main()
