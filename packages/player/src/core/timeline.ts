// timeline.ts — the pure timeline math for the player. Lifted VERBATIM (algorithm,
// edge cases, and comment intent unchanged) from apps/papyros/src/player/position.ts,
// generalized with a rename only: BookFile → MediaSource, BookChapter → Segment,
// FileMap → Timeline, EMPTY_MAP → EMPTY_TIMELINE, buildFileMap → buildTimeline,
// FilePos → SourcePos (fileIndex → sourceIndex; arrayIndex is already generic and
// keeps its name). See git history: PLAYER_PARITY.md, retired for why this promotes
// cleanly: PapyrOS's "book" was never book-shaped, it's N sources concatenated into
// one global timeline with a gap-free list of nav points over it.
//
// The whole player speaks ONE number: `globalPos`, a second offset across the WHOLE
// timeline with the sources concatenated in `sources[].index` order. Only the media
// element speaks per-source offsets. This module owns the mapping in both directions
// plus the prev/next "chapter" model and the clock formatter — no React, no network,
// so the arithmetic can be read (and reasoned about at the float boundaries) in
// isolation.

/** One playable unit inside a Timeline — a file/stream, generically. Layer 0 only
 *  ever touches `.index` (the concatenation order) and `.duration` (for the
 *  cumulative-offset table); callers are free to carry richer objects that satisfy
 *  this shape (a path, a codec, a compat variant, …) — the timeline math doesn't
 *  care and must not be taught to. */
export interface MediaSource {
  /** The source's position in playback order — the concatenation order the global
   *  timeline is defined against, and the id a backend stream lookup needs. */
  index: number;
  /** Seconds of playable media this source contributes. */
  duration: number;
}

export interface Timeline {
  /** Sources sorted by their real backend `.index` — the concatenation order the
   *  global timeline is defined against, and the id a stream lookup needs. */
  sources: MediaSource[];
  /** starts[i] = the global second at which sources[i] begins (cumulative durations). */
  starts: number[];
  /** Total playable seconds = the sum of every source's duration. The scrubber's max
   *  and every clamp use THIS (derived from sources) so a position can never point
   *  past the last source, whatever a higher-level duration claims. */
  total: number;
}

export const EMPTY_TIMELINE: Timeline = { sources: [], starts: [], total: 0 };

/** Build the cumulative-offset table from a Timeline's sources. Sorts defensively by
 *  `.index` (never assume the caller already did) and treats a missing/negative
 *  duration as 0 so one bad source can't poison the whole timeline. */
export function buildTimeline(rawSources: MediaSource[]): Timeline {
  const sources = [...rawSources].sort((a, b) => a.index - b.index);
  const starts: number[] = [];
  let acc = 0;
  for (const s of sources) {
    starts.push(acc);
    acc += Math.max(0, s.duration || 0);
  }
  return { sources, starts, total: acc };
}

export interface SourcePos {
  /** Position within `timeline.sources` (0-based) — the playlist cursor for auto-advance. */
  arrayIndex: number;
  /** The source's real backend index (what a stream lookup wants). */
  sourceIndex: number;
  /** Seconds into that source (what a media element's `currentTime` wants). */
  offset: number;
}

/** Map a global second offset → the source that's playing and the offset into it.
 *
 *  Boundary rule (the float edge the task calls out): a position landing exactly on
 *  a source boundary belongs to the LATER source at offset 0, so seeking to a
 *  chapter / source start plays that source from its top rather than the tail of the
 *  previous one. At (or past) `total` it resolves to the last source at offset ===
 *  its own duration, which is exactly where "playback ended" sits. */
export function locate(timeline: Timeline, globalPos: number): SourcePos {
  const { sources, starts } = timeline;
  if (sources.length === 0) return { arrayIndex: 0, sourceIndex: 0, offset: 0 };
  const g = clamp(globalPos, 0, timeline.total);
  // Walk from the last source down: the highest start we're still >= is our source.
  // `g < starts[i]` steps back; at an exact boundary g === starts[i] we stop on the
  // later source (offset 0). Zero-length sources (duplicate starts) collapse
  // harmlessly.
  let i = sources.length - 1;
  while (i > 0 && g < starts[i]) i--;
  return { arrayIndex: i, sourceIndex: sources[i].index, offset: g - starts[i] };
}

/** Inverse of `locate` for a known playlist cursor + in-source offset. */
export function toGlobal(timeline: Timeline, arrayIndex: number, offset: number): number {
  if (arrayIndex < 0 || arrayIndex >= timeline.starts.length) return 0;
  return timeline.starts[arrayIndex] + Math.max(0, offset);
}

/** A named span over the global timeline — a book's real chapter, a video chapter
 *  marker, a skip-intro region, … Layer 0 only cares about its span and label. */
export interface Segment {
  start: number;
  end: number;
  title: string;
}

export interface NavPoint {
  start: number;
  end: number;
  title: string;
}

/** The prev/next-"chapter" targets: the timeline's real segments when it has them,
 *  else one entry per source (its global span). Always sorted by start and gap-free
 *  across [0, total], so `currentNav` can treat them as a simple cursor. */
export function navPoints(timeline: Timeline, segments: Segment[]): NavPoint[] {
  if (segments.length > 0) {
    return [...segments]
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ start: c.start, end: c.end, title: c.title }));
  }
  return timeline.sources.map((s, i) => ({
    start: timeline.starts[i],
    end: timeline.starts[i] + Math.max(0, s.duration || 0),
    title: `Track ${s.index + 1}`,
  }));
}

/** Index of the nav point currently playing — the last one whose start we've passed. */
export function currentNav(points: NavPoint[], pos: number): number {
  let i = 0;
  for (let k = 0; k < points.length; k++) {
    if (pos + 1e-3 >= points[k].start) i = k;
    else break;
  }
  return i;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** h:mm:ss once past an hour, m:ss under one — the bar's elapsed / total readout. */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
