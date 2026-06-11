"""
VTT / SRT caption extraction.

Caption files in static_resources/ follow the naming pattern:
  {hash}_{youtube_id}.vtt   e.g. 8b7622bf59449df1c89208bb3d10a0a9_UCc9q_cAhho.vtt

This module indexes those files and attaches the plain-text transcript
to any ResourceNode whose youtube_id matches.
"""

from __future__ import annotations
import re
from pathlib import Path

YOUTUBE_ID_PAT = re.compile(r"_([A-Za-z0-9_-]{11})\.(vtt|srt)$")

_BARE_YT_ID = re.compile(r"^([A-Za-z0-9_-]{11})\.(vtt|srt)$", re.IGNORECASE)


def index_captions(zip_root: Path) -> dict[str, Path]:
    """
    Returns {youtube_id: caption_file_path}.
    Prefers VTT over SRT when both exist.
    Handles two naming conventions:
      (a) {32hex}_{yt_id}.vtt  — modern OCW hash-prefixed files
      (b) {yt_id}.vtt          — files stored without a hash prefix
    """
    captions: dict[str, Path] = {}
    static_dir = zip_root / "static_resources"
    if not static_dir.exists():
        return captions

    for caption in sorted(static_dir.iterdir()):
        # Extension match must be case-insensitive: some courses ship .SRT
        if caption.suffix.lower() not in (".vtt", ".srt"):
            continue
        name_lower = caption.name.lower()
        yt_id: str | None = None
        m = YOUTUBE_ID_PAT.search(name_lower)
        if m:
            # Recover original-case id from the same span (ids are case-sensitive)
            yt_id = caption.name[m.start(1):m.end(1)]
        else:
            m2 = _BARE_YT_ID.match(caption.name)
            if m2:
                yt_id = m2.group(1)
        if yt_id and (yt_id not in captions or caption.suffix.lower() == ".vtt"):
            captions[yt_id] = caption

    return captions


def extract_caption_text(path: Path) -> str:
    """
    Strip VTT/SRT timing metadata and inline tags.
    Returns clean prose, deduplicated consecutive lines.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    lines: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line == "WEBVTT" or line.startswith("WEBVTT "):
            continue
        if line.isdigit():
            continue
        if "-->" in line:
            continue
        if line.startswith(("NOTE", "STYLE", "REGION")):
            continue
        line = re.sub(r"<[^>]+>", "", line)   # strip inline tags like <v Speaker>
        if line:
            lines.append(line)

    # Deduplicate consecutive identical lines (common in auto-generated captions)
    deduped: list[str] = []
    for line in lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    return " ".join(deduped)


# Matches "HH:MM:SS.mmm" (VTT) and "HH:MM:SS,mmm" (SRT); hours optional in VTT.
_TIMESTAMP = re.compile(
    r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{3})"
)
_CUE_LINE = re.compile(
    r"(?:(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})"
)


def _parse_timestamp(ts: str) -> float:
    m = _TIMESTAMP.match(ts.strip())
    if not m:
        return 0.0
    h = int(m.group(1) or 0)
    return h * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000


def extract_caption_cues(path: Path) -> list[tuple[float, float, str]]:
    """
    Parse VTT/SRT into [(start_sec, end_sec, text)] in file order.
    Consecutive duplicate cue texts are merged (auto-caption roll-up style),
    extending the previous cue's end time.
    """
    raw = path.read_text(encoding="utf-8", errors="replace")
    cues: list[tuple[float, float, str]] = []
    cur_start: float | None = None
    cur_end: float = 0.0
    cur_lines: list[str] = []

    def flush() -> None:
        nonlocal cur_start, cur_lines
        if cur_start is None:
            return
        text = " ".join(cur_lines).strip()
        if text:
            if cues and cues[-1][2] == text:
                # roll-up duplicate: extend previous cue instead of repeating
                s, _, t = cues[-1]
                cues[-1] = (s, cur_end, t)
            else:
                cues.append((cur_start, cur_end, text))
        cur_start, cur_lines = None, []

    for line in raw.splitlines():
        line = line.strip()
        if _CUE_LINE.search(line):
            flush()
            parts = line.split("-->")
            cur_start = _parse_timestamp(parts[0])
            cur_end = _parse_timestamp(parts[1])
            continue
        if cur_start is None:
            continue  # headers, NOTE blocks, sequence numbers before any cue
        if not line:
            flush()
            continue
        if line.isdigit():  # SRT sequence number of the next block
            flush()
            continue
        cleaned = re.sub(r"<[^>]+>", "", line)
        if cleaned and cleaned != "WEBVTT" and not cleaned.startswith(("NOTE", "STYLE", "REGION")):
            cur_lines.append(cleaned)
    flush()

    return cues


def attach_transcripts(resources: list, zip_root: Path) -> None:
    """
    Mutates ResourceNode objects in-place: sets transcript_text on video resources
    whose youtube_id has a matching caption file in static_resources/.
    """
    captions = index_captions(zip_root)
    if not captions:
        return

    for r in resources:
        # Any resource with a YouTube id is a video, whatever its declared type
        if not r.youtube_id:
            continue
        caption_path = captions.get(r.youtube_id)
        if caption_path:
            r.transcript_text = extract_caption_text(caption_path)
