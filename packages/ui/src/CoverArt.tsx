// CoverArt.tsx — the suite's canonical cover-art primitive (ToDo.md §3 Wave
// 20, item 20.2): an image with a graceful fallback placeholder on missing
// or 404'd art. Extracted from papyros's library grid tile (originally
// apps/papyros/src/views/library/CoverArt.tsx).
//
// NOTE on the sibling in packages/player: `packages/player/src/ui/
// NowPlaying.tsx` already exports its OWN `CoverArt` (the player bar's
// artwork thumb). That one stays put — packages/player/src/ui/ is under a
// zero-behaviour-change contract for the Wave-15 migration and is off
// limits here. The two happen to share the same shape (src/alt/fallback,
// reset-on-src-change) by design, not by copy-paste accident; see this
// task's report for how they should converge later (the player-kit one is
// the candidate to re-point at this one, not the other way around — THIS
// is the suite-level primitive going forward).
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from './primitives';

export interface CoverArtProps {
  /** Image URL. Omit (or falsy) to render the fallback immediately, skipping
   *  the network round-trip entirely — the caller decides whether "no art"
   *  is worth a request at all (e.g. papyros only passes a URL once its
   *  scanner has actually found/matched cover art for the item). */
  src?: string | null;
  /** Alt text for the `<img>`. Pass `""` for decorative covers (papyros's
   *  grid tiles are — the tile's own text does the describing). */
  alt: string;
  /** Rendered inside the fallback tile (e.g. initials, an icon). Renders an
   *  empty tinted tile when omitted. */
  fallback?: ReactNode;
  className?: string;
}

/** Image + graceful fallback tile. `failed` resets whenever `src` changes,
 *  so a dead image on one item can never ghost the next item's good one —
 *  this is the deliberate, "more correct" default for an instance that gets
 *  REUSED across changing items (a now-playing bar advancing tracks without
 *  remounting). It has no observable effect for a grid tile keyed per-item
 *  id (a fresh mount already starts at `failed = false`), which is exactly
 *  papyros's usage — so adopting it here is zero-behaviour-change for the
 *  library grid specifically, while being the right default going forward. */
export function CoverArt({ src, alt, fallback, className }: CoverArtProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={cx('jk-well', 'jk-media-cover', 'jk-media-cover-placeholder', className)} aria-hidden="true">
        {fallback}
      </div>
    );
  }

  return (
    <img
      className={cx('jk-media-cover', className)}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
