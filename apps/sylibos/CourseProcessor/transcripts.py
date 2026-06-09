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

_VIDEO_TYPES = frozenset({
    "Lecture Videos",
    "Problem-solving Videos",
    "Other Video",
})


_BARE_YT_ID = re.compile(r"^([A-Za-z0-9_-]{11})\.(vtt|srt)$")


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

    for ext in ("*.vtt", "*.srt"):
        for caption in static_dir.glob(ext):
            yt_id: str | None = None
            m = YOUTUBE_ID_PAT.search(caption.name)
            if m:
                yt_id = m.group(1)
            else:
                # Bare {yt_id}.vtt with no hash prefix
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


def attach_transcripts(resources: list, zip_root: Path) -> None:
    """
    Mutates ResourceNode objects in-place: sets transcript_text on video resources
    whose youtube_id has a matching caption file in static_resources/.
    """
    captions = index_captions(zip_root)
    if not captions:
        return

    for r in resources:
        if r.primary_type not in _VIDEO_TYPES:
            continue
        if not r.youtube_id:
            continue
        caption_path = captions.get(r.youtube_id)
        if caption_path:
            r.transcript_text = extract_caption_text(caption_path)
