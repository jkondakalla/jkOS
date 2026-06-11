"""
Concept chunking — split a session into ~15-minute learnable parts.

Pure functions over IR lectures + caption cues; no manifest, no DB, no I/O.
Used by scaffold.build_tree to produce trunk nodes and their content slices.

Rules (from the concept-tree spec §3):
  - duration = last cue end when cues exist (duration_estimated=False);
    otherwise wpm fallback: notes words/200wpm, transcript words/150wpm,
    else DEFAULT_SECONDS with a warning flag.
  - <= 18 min -> one part; else ceil(duration/900) parts, split at the best
    boundary near each proportional target: discourse marker > silence gap >
    proportional cue edge (video), heading > proportional (text).
  - < 6 min or assessment session -> 'checkpoint' kind.
  - part titles get a "(Part n)" suffix.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Optional

TARGET_SECONDS = 900          # ~15 min ideal part length
MAX_SINGLE_SECONDS = 18 * 60  # <= this stays one part
CHECKPOINT_SECONDS = 6 * 60   # < this becomes a checkpoint node
DEFAULT_SECONDS = 900         # no cues, no text: assume one target-length part

NOTES_WPM = 200
TRANSCRIPT_WPM = 150

# Phrases lecturers use when switching topics; anchored to cue start.
_DISCOURSE = re.compile(
    r"^(ok(ay)?|so|now|next|all\s?right|moving on|let's|let us)\b[,.]?\s*"
    r"(so\b|now\b|let's|let us|we turn|we move|the next|next topic|"
    r"another|a different|new topic|turn to|move on)?",
    re.IGNORECASE,
)

# A text line that looks like a section heading: short, no terminal
# punctuation, and either numbered or mostly capitalized.
_HEADING = re.compile(
    r"^(?:\d+[.)]\s+\S|[A-Z][A-Za-z0-9 ,&'\-]{2,58}$|[A-Z 0-9\-]{4,58}$)"
)


@dataclass
class Chunk:
    part: int
    parts_total: int
    title: str
    kind: str                      # 'concept' | 'checkpoint'
    start_seconds: float
    end_seconds: float
    duration_estimated: bool
    boundary_quality: str          # 'whole'|'discourse'|'gap'|'proportional'|'heading'
    text: str = ""                 # cue-text or notes slice for this part
    char_start: int = 0            # text mode: slice offsets into source text
    char_end: int = 0
    warnings: list[str] = field(default_factory=list)


def part_title(base: str, part: int, parts_total: int) -> str:
    return base if parts_total == 1 else f"{base} (Part {part})"


def estimate_duration(
    cues: list[tuple[float, float, str]],
    notes_text: str = "",
    transcript_text: str = "",
) -> tuple[float, bool, list[str]]:
    """-> (seconds, estimated?, warnings). Cue timing is span-based so a
    mid-video slice reports its own length, not its absolute end time."""
    if cues:
        return cues[-1][1] - cues[0][0], False, []
    if notes_text and len(notes_text.split()) > 40:
        return len(notes_text.split()) / NOTES_WPM * 60, True, []
    if transcript_text and len(transcript_text.split()) > 40:
        return len(transcript_text.split()) / TRANSCRIPT_WPM * 60, True, []
    return DEFAULT_SECONDS, True, ["no_duration_signal"]


def _n_parts(duration: float) -> int:
    if duration <= MAX_SINGLE_SECONDS:
        return 1
    return max(2, math.ceil(duration / TARGET_SECONDS))


def _pick_cue_boundary(
    cues: list[tuple[float, float, str]],
    target: float,
    window: float = 120.0,
) -> tuple[int, str]:
    """Best cue index to START a new part at, near target seconds."""
    in_window = [
        i for i, c in enumerate(cues)
        if abs(c[0] - target) <= window and i > 0
    ]
    if not in_window:
        # nearest cue start overall (proportional fallback)
        idx = min(range(1, len(cues)), key=lambda i: abs(cues[i][0] - target))
        return idx, "proportional"

    discourse = [i for i in in_window if _DISCOURSE.match(cues[i][2])]
    if discourse:
        return min(discourse, key=lambda i: abs(cues[i][0] - target)), "discourse"

    # largest silence before a cue = natural pause
    def gap(i: int) -> float:
        return cues[i][0] - cues[i - 1][1]
    best = max(in_window, key=gap)
    if gap(best) >= 1.5:
        return best, "gap"
    return min(in_window, key=lambda i: abs(cues[i][0] - target)), "proportional"


def slice_weighted(
    cues: list[tuple[float, float, str]],
    weights: list[int],
) -> list[list[tuple[float, float, str]]]:
    """
    Split cues into len(weights) consecutive slices whose lengths are
    proportional to the weights, snapped to discourse/gap boundaries.
    Used for the Scholar clip pattern: one lecture video shared by several
    sessions in nav order, each session owning `weight` clips of it.
    """
    if len(weights) < 2 or len(cues) < len(weights):
        return [cues] + [[] for _ in weights[1:]]
    t0 = cues[0][0]
    length = cues[-1][1] - t0
    total = sum(weights) or len(weights)
    idxs = [0]
    acc = 0
    for w in weights[:-1]:
        acc += w
        idx, _q = _pick_cue_boundary(cues, t0 + length * acc / total)
        idxs.append(max(idx, idxs[-1] + 1))
    idxs.append(len(cues))
    if any(idxs[i] >= idxs[i + 1] for i in range(len(idxs) - 1)):
        # boundary snapping collapsed a slice; fall back to even index split
        step = len(cues) // len(weights)
        idxs = [i * step for i in range(len(weights))] + [len(cues)]
    return [cues[idxs[i]:idxs[i + 1]] for i in range(len(weights))]


def chunk_video(
    title: str,
    cues: list[tuple[float, float, str]],
    *,
    is_assessment: bool = False,
    origin_zero: bool = True,
) -> list[Chunk]:
    """Split a captioned video (or a slice of one) at cue boundaries.
    origin_zero: force part 1 to start at 0 (full videos); slices keep
    their absolute start time."""
    duration, estimated, warns = estimate_duration(cues)
    kind = "checkpoint" if (is_assessment or duration < CHECKPOINT_SECONDS) else "concept"
    parts_total = 1 if kind == "checkpoint" else _n_parts(duration)
    t0 = cues[0][0] if cues else 0.0

    if parts_total == 1 or not cues:
        start = 0.0 if (origin_zero or not cues) else round(t0, 2)
        return [Chunk(
            part=1, parts_total=1, title=title, kind=kind,
            start_seconds=start,
            end_seconds=round(cues[-1][1], 2) if cues else round(duration, 2),
            duration_estimated=estimated, boundary_quality="whole",
            text=" ".join(c[2] for c in cues), warnings=warns,
        )]

    # choose split indices near each proportional target
    split_at: list[tuple[int, str]] = []
    used: set[int] = set()
    for p in range(1, parts_total):
        idx, quality = _pick_cue_boundary(cues, t0 + duration * p / parts_total)
        if idx in used:  # degenerate window overlap; nudge forward
            idx = min(len(cues) - 1, idx + 1)
        used.add(idx)
        split_at.append((idx, quality))
    split_at.sort()

    chunks: list[Chunk] = []
    bounds = [(0, "whole")] + split_at + [(len(cues), "whole")]
    for p in range(parts_total):
        lo, _ = bounds[p]
        hi, hi_quality = bounds[p + 1]
        seg = cues[lo:hi]
        if not seg:
            continue
        chunks.append(Chunk(
            part=p + 1, parts_total=parts_total,
            title=part_title(title, p + 1, parts_total), kind="concept",
            # part 1 of a full video starts at 0 so embeds begin at the top
            start_seconds=0.0 if (p == 0 and origin_zero) else round(seg[0][0], 2),
            end_seconds=round(seg[-1][1], 2),
            duration_estimated=estimated,
            # quality of the boundary that *opens* this part
            boundary_quality=bounds[p][1] if p > 0 else hi_quality,
            text=" ".join(c[2] for c in seg),
            warnings=warns if p == 0 else [],
        ))
    # renumber if any segment collapsed empty
    for i, c in enumerate(chunks, start=1):
        c.part, c.parts_total = i, len(chunks)
        c.title = part_title(title, i, len(chunks))
    return chunks


def _text_blocks(text: str) -> list[tuple[int, int, bool]]:
    """-> [(char_start, char_end, starts_with_heading)] paragraph-ish blocks."""
    blocks: list[tuple[int, int, bool]] = []
    pos = 0
    for raw in re.split(r"\n{2,}", text):
        if not raw.strip():
            pos += len(raw) + 2
            continue
        start = text.find(raw, pos)
        end = start + len(raw)
        first_line = raw.strip().splitlines()[0].strip()
        is_heading = (
            len(first_line) < 60
            and not first_line.endswith((".", "?", "!", ",", ";", ":"))
            and bool(_HEADING.match(first_line))
        )
        blocks.append((start, end, is_heading))
        pos = end
    if not blocks and text.strip():
        blocks = [(0, len(text), False)]
    return blocks


def chunk_text(
    title: str,
    text: str,
    *,
    is_assessment: bool = False,
    wpm: int = NOTES_WPM,
) -> list[Chunk]:
    """Split a text/notes session on paragraph blocks, preferring headings."""
    words = len(text.split())
    duration = max(words / wpm * 60, 1.0) if words else DEFAULT_SECONDS
    warns = [] if words else ["no_duration_signal"]
    kind = "checkpoint" if (is_assessment or duration < CHECKPOINT_SECONDS) else "concept"
    parts_total = 1 if kind == "checkpoint" else _n_parts(duration)

    blocks = _text_blocks(text)
    if parts_total == 1 or len(blocks) < 2:
        return [Chunk(
            part=1, parts_total=1, title=title, kind=kind,
            start_seconds=0.0, end_seconds=round(duration, 2),
            duration_estimated=True, boundary_quality="whole",
            text=text.strip(), char_start=0, char_end=len(text),
            warnings=warns,
        )]

    # cumulative word counts -> block index nearest each proportional target,
    # preferring a heading block within +-2 blocks
    cum: list[int] = []
    total = 0
    for s, e, _h in blocks:
        total += len(text[s:e].split())
        cum.append(total)

    split_idx: list[tuple[int, str]] = []
    used: set[int] = set()
    for p in range(1, parts_total):
        target = total * p / parts_total
        base = min(range(1, len(blocks)), key=lambda i: abs(cum[i - 1] - target))
        cand = [i for i in range(max(1, base - 2), min(len(blocks), base + 3))
                if blocks[i][2] and i not in used]
        if cand:
            idx, quality = min(cand, key=lambda i: abs(cum[i - 1] - target)), "heading"
        else:
            idx, quality = base, "proportional"
        if idx in used:
            continue
        used.add(idx)
        split_idx.append((idx, quality))
    split_idx.sort()

    chunks: list[Chunk] = []
    bounds = [(0, "whole")] + split_idx + [(len(blocks), "whole")]
    t_cursor = 0.0
    for p in range(len(bounds) - 1):
        lo, _ = bounds[p]
        hi, _hq = bounds[p + 1]
        if lo >= hi:
            continue
        c_start = blocks[lo][0]
        c_end = blocks[hi - 1][1]
        seg_words = len(text[c_start:c_end].split())
        seg_dur = seg_words / wpm * 60
        chunks.append(Chunk(
            part=p + 1, parts_total=parts_total,
            title=part_title(title, p + 1, parts_total), kind="concept",
            start_seconds=round(t_cursor, 2),
            end_seconds=round(t_cursor + seg_dur, 2),
            duration_estimated=True,
            boundary_quality=bounds[p][1] if p > 0 else "whole",
            text=text[c_start:c_end].strip(),
            char_start=c_start, char_end=c_end,
            warnings=warns if p == 0 else [],
        ))
        t_cursor += seg_dur
    for i, c in enumerate(chunks, start=1):
        c.part, c.parts_total = i, len(chunks)
        c.title = part_title(title, i, len(chunks))
    return chunks
