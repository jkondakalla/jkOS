// reorder.ts — the pure drag-drop-target math under PlaylistDetail's track-reorder
// list (git history: Wave 18 item 18.6). A deliberate small LOCAL copy of the same
// two functions `@jkos/player/ui`'s <QueuePanel> already ships (packages/player/src/
// ui/scrub.ts's `insertionSlot`/`reorderTarget`) rather than an import from that
// package: packages/player/src/ui is under papyros's zero-behaviour-change contract
// (18.4's file-ownership note) and this is an unrelated app feature (playlist track
// order, not the playback queue) — importing the player kit here would wire a real
// runtime dependency between two features that don't otherwise touch. The algorithm
// is unchanged (same house "measure rows once on activate, resolve the live pointer
// y against row midpoints" idiom usePointerDrag's own doc comment describes).
//
// No DOM/React here — trivially unit-testable in isolation if a later wave adds
// coverage, same reasoning as views/library/format.ts staying pure.

export interface RowSpan {
  top: number;
  bottom: number;
}

/** Insertion slot (0..n) for a pointer at `y` over the measured rows: the index of
 *  the first row whose midpoint is still below the pointer. Above every midpoint →
 *  0; below them all → n (append). */
export function insertionSlot(rows: readonly RowSpan[], y: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (y < (rows[i]!.top + rows[i]!.bottom) / 2) return i;
  }
  return rows.length;
}

/** Map an insertion slot (0..n, computed over the ORIGINAL row list) onto the
 *  destination index a remove-then-insert reorder wants: slots past the dragged
 *  row shift down one because the row leaves first. A result === `from` is the
 *  no-move case. */
export function reorderTarget(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** Move the item at `from` to `to` (both canonical indices, `to` already passed
 *  through reorderTarget) — remove-then-insert, immutable. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to) return list.slice();
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}
