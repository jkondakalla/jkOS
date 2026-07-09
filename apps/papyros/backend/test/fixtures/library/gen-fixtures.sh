#!/usr/bin/env bash
# gen-fixtures.sh (task 2.5) — regenerates the tiny fixture audiobook library committed
# alongside this script. Re-run it any time the fixtures need to change; the outputs are
# deterministic (same ffmpeg/lavfi inputs → same audio, only encoder-version metadata like
# `encoder=Lavf...` in the container may drift across ffmpeg versions, which none of the
# smoke's assertions depend on).
#
# Requires `ffmpeg` on PATH (not just `ffprobe` — probe.js/scan.js only need ffprobe at
# runtime, but generating these fixtures needs the encoder too).
#
#   bash apps/papyros/backend/test/fixtures/library/gen-fixtures.sh
#
# Produces:
#   Fixture Book A/book.m4b   — ONE file, embedded chapters (2×1s) + full tag set, via an
#                                 ;FFMETADATA1 sidecar muxed in with -map_metadata (this is
#                                 the documented way to embed chapters with ffmpeg; there is
#                                 no per-chapter CLI flag). Exercises scan.js's single-file
#                                 "trust the embedded chapter list" path.
#   Fixture Book B/01 track one.mp3
#   Fixture Book B/02 track two.mp3
#                               — TWO files, no chapters, `track=1/2`/`2/2` tags so
#                                 scan.js's parseTrackNumber/naturalCompare ordering has
#                                 something real to sort. Exercises the multi-file
#                                 aggregation (duration summed, chapters NOT synthesized).
#                                 Deliberately NO per-file `title` tag: scan.js derives a
#                                 book's title from mapTagsToColumns(firstFile.tags).title
#                                 || folder-basename, and `album` maps to `series` (not
#                                 title) — so a real multi-file rip almost always falls
#                                 back to the folder name for its title, and this fixture
#                                 mirrors that instead of accidentally asserting on a
#                                 per-track title tag.
#
# Each file is a couple of seconds of a sine tone at 32kb/s — a few KB, safe to commit.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

A_DIR="Fixture Book A"
B_DIR="Fixture Book B"
META="$(mktemp -t papyros-fixture-meta-XXXXXX.txt)"
trap 'rm -f "$META"' EXIT

cat > "$META" <<'EOF'
;FFMETADATA1
title=Fixture Book A
artist=Fixture Author A
album=Fixture Series One
composer=Fixture Narrator A
date=2024
genre=Fantasy;Adventure

[CHAPTER]
TIMEBASE=1/1000
START=0
END=1000
title=Chapter One

[CHAPTER]
TIMEBASE=1/1000
START=1000
END=2000
title=Chapter Two
EOF

echo "generating ${A_DIR}/book.m4b (single file, embedded chapters)…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -f ffmetadata -i "$META" -map_metadata 1 \
  -c:a aac -b:a 32k -f ipod \
  "${A_DIR}/book.m4b"

echo "generating ${B_DIR}/01 track one.mp3…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=523:duration=2" \
  -metadata artist="Fixture Author B" \
  -metadata album="Fixture Book B" -metadata track="1/2" \
  -metadata date=2023 -metadata genre="Sci-Fi" \
  -c:a libmp3lame -b:a 32k \
  "${B_DIR}/01 track one.mp3"

echo "generating ${B_DIR}/02 track two.mp3…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=659:duration=2" \
  -metadata artist="Fixture Author B" \
  -metadata album="Fixture Book B" -metadata track="2/2" \
  -metadata date=2023 -metadata genre="Sci-Fi" \
  -c:a libmp3lame -b:a 32k \
  "${B_DIR}/02 track two.mp3"

echo "done:"
find "$A_DIR" "$B_DIR" -type f -exec ls -la {} \;
