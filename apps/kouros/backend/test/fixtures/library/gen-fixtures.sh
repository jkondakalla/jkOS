#!/usr/bin/env bash
# gen-fixtures.sh (git history (item 18.2)) — regenerates the tiny fixture music library committed
# alongside this script. Re-run it any time the fixtures need to change; the outputs are
# deterministic (same ffmpeg/lavfi inputs → same audio, only encoder-version metadata
# like `encoder=Lavf...` may drift across ffmpeg versions, which none of the smoke's
# assertions depend on). Mirrors apps/papyros/backend/test/fixtures/library/
# gen-fixtures.sh's approach (a few KB of sine tones + a tiny cover, safe to commit).
#
# Requires `ffmpeg` on PATH.
#
#   bash apps/kouros/backend/test/fixtures/library/gen-fixtures.sh
#
# Produces TWO albums by two different artists — exercises `unit: 'file'` scanning
# (one row PER TRACK, not per folder) across a real artist→album→track hierarchy:
#   Artist One/Album One/01 song one.mp3   — track=1/2, disc=1, genre=Rock;Indie,
#                                             album_artist=Artist One (a various-
#                                             artists-style compilation would differ
#                                             per track; this one doesn't, on purpose —
#                                             the common case).
#   Artist One/Album One/02 song two.mp3   — track=2/2, disc=1, same album.
#   Artist Two/Album Two/01 solo track.mp3 — track=1/1, disc=1, genre=Jazz, a
#                                             single-track "album" with NO
#                                             album_artist tag (exercises the
#                                             artist-fallback in scan.js's mapTags).
#   Artist Two/Album Two/cover.jpg         — folder-level cover (neither of this
#                                             album's tracks carries embedded art),
#                                             gives playback.smoke.mjs a real
#                                             cover_path to exercise GET /api/cover.
#
# Each audio file is ~2s of a sine tone at 32kb/s — a few KB, safe to commit. The cover
# is a single 32x32 solid-color frame, similarly tiny.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

A_DIR="Artist One/Album One"
B_DIR="Artist Two/Album Two"
mkdir -p "$A_DIR" "$B_DIR"

echo "generating ${A_DIR}/01 song one.mp3…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -metadata title="Song One" -metadata artist="Artist One" -metadata album="Album One" \
  -metadata album_artist="Artist One" -metadata track="1/2" -metadata disc="1" \
  -metadata date=2021 -metadata genre="Rock;Indie" \
  -c:a libmp3lame -b:a 32k \
  "${A_DIR}/01 song one.mp3"

echo "generating ${A_DIR}/02 song two.mp3…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=523:duration=2" \
  -metadata title="Song Two" -metadata artist="Artist One" -metadata album="Album One" \
  -metadata album_artist="Artist One" -metadata track="2/2" -metadata disc="1" \
  -metadata date=2021 -metadata genre="Rock;Indie" \
  -c:a libmp3lame -b:a 32k \
  "${A_DIR}/02 song two.mp3"

echo "generating ${B_DIR}/01 solo track.mp3 (no album_artist tag — exercises the artist fallback)…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=659:duration=2" \
  -metadata title="Solo Track" -metadata artist="Artist Two" -metadata album="Album Two" \
  -metadata track="1/1" -metadata disc="1" \
  -metadata date=2022 -metadata genre="Jazz" \
  -c:a libmp3lame -b:a 32k \
  "${B_DIR}/01 solo track.mp3"

echo "generating ${B_DIR}/cover.jpg (folder-level cover)…"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=0x9b4a7c:s=32x32:d=1" \
  -frames:v 1 -q:v 8 \
  "${B_DIR}/cover.jpg"

echo "done:"
find "$A_DIR" "$B_DIR" -type f -exec ls -la {} \;
