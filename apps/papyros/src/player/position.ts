// position.ts — the pure position math for the player (task 5.4's hard part).
//
// The whole player speaks ONE number: `globalPos`, a second offset across the WHOLE
// book with the files concatenated in files[].index order. Only the <audio> element
// speaks per-file offsets. This module owns the mapping in both directions plus the
// prev/next "chapter" model and the clock formatter — no React, no network, so the
// arithmetic can be read (and reasoned about at the float boundaries) in isolation.

import type { BookChapter, BookFile } from '../api';

export interface FileMap {
  /** Files sorted by their real backend `.index` — the concatenation order the
   *  global timeline is defined against, and the id `streamUrl` needs. */
  files: BookFile[];
  /** starts[i] = the global second at which files[i] begins (cumulative durations). */
  starts: number[];
  /** Total playable seconds = the sum of every file's duration. The scrubber's max
   *  and every clamp use THIS (derived from files) so a position can never point
   *  past the last file, whatever book.duration claims. */
  total: number;
}

export const EMPTY_MAP: FileMap = { files: [], starts: [], total: 0 };

/** Build the cumulative-offset table from a book's files. Sorts defensively by
 *  `.index` (never assume the server already did) and treats a missing/negative
 *  duration as 0 so one bad file can't poison the whole timeline. */
export function buildFileMap(rawFiles: BookFile[]): FileMap {
  const files = [...rawFiles].sort((a, b) => a.index - b.index);
  const starts: number[] = [];
  let acc = 0;
  for (const f of files) {
    starts.push(acc);
    acc += Math.max(0, f.duration || 0);
  }
  return { files, starts, total: acc };
}

export interface FilePos {
  /** Position within `map.files` (0-based) — the playlist cursor for auto-advance. */
  arrayIndex: number;
  /** The file's real backend index (what `streamUrl` wants). */
  fileIndex: number;
  /** Seconds into that file (what `<audio>.currentTime` wants). */
  offset: number;
}

/** Map a global second offset → the file that's playing and the offset into it.
 *
 *  Boundary rule (the float edge the task calls out): a position landing exactly on
 *  a file boundary belongs to the LATER file at offset 0, so seeking to a chapter /
 *  file start plays that file from its top rather than the tail of the previous one.
 *  At (or past) `total` it resolves to the last file at offset === its own duration,
 *  which is exactly where "the book ended" sits. */
export function locate(map: FileMap, globalPos: number): FilePos {
  const { files, starts } = map;
  if (files.length === 0) return { arrayIndex: 0, fileIndex: 0, offset: 0 };
  const g = clamp(globalPos, 0, map.total);
  // Walk from the last file down: the highest start we're still >= is our file.
  // `g < starts[i]` steps back; at an exact boundary g === starts[i] we stop on the
  // later file (offset 0). Zero-length files (duplicate starts) collapse harmlessly.
  let i = files.length - 1;
  while (i > 0 && g < starts[i]) i--;
  return { arrayIndex: i, fileIndex: files[i].index, offset: g - starts[i] };
}

/** Inverse of `locate` for a known playlist cursor + in-file offset. */
export function toGlobal(map: FileMap, arrayIndex: number, offset: number): number {
  if (arrayIndex < 0 || arrayIndex >= map.starts.length) return 0;
  return map.starts[arrayIndex] + Math.max(0, offset);
}

export interface NavPoint {
  start: number;
  end: number;
  title: string;
}

/** The prev/next-chapter targets: the book's real chapters when it has them, else
 *  one entry per file (its global span). Always sorted by start and gap-free across
 *  [0, total], so `currentNav` can treat them as a simple cursor. */
export function navPoints(map: FileMap, chapters: BookChapter[]): NavPoint[] {
  if (chapters.length > 0) {
    return [...chapters]
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ start: c.start, end: c.end, title: c.title }));
  }
  return map.files.map((f, i) => ({
    start: map.starts[i],
    end: map.starts[i] + Math.max(0, f.duration || 0),
    title: `Track ${f.index + 1}`,
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
