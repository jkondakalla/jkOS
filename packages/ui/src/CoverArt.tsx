// CoverArt.tsx — the suite's canonical cover-art primitive (git history Wave
// 20, item 20.2): an image with a graceful fallback placeholder on missing
// or 404'd art. Extracted from papyros's library grid tile (originally
// apps/papyros/src/views/library/CoverArt.tsx).
//
// ONE PRIMITIVE, TWO SIZES. `@jkos/player/ui` used to export its own
// `CoverArt` for the player bar's artwork thumb, frozen under the Wave-15
// migration's zero-behaviour-change contract with a note that it should
// re-point here. That migration finished long ago; the copy had no consumers
// left, and PapyrOS's player bar hand-rolled a THIRD one (`CoverThumb`) that
// never reset its failure flag — so a book whose cover 404'd blanked the NEXT
// book's good cover until the bar remounted. Both are gone; `variant="thumb"`
// is that bar's artwork now (RESET Stage F).
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
  /** `tile` (default): a full-width square for a grid — `.jk-media-cover`, lazy-
   *  loaded because a grid mounts hundreds. `thumb`: the 48px framed artwork of a
   *  player bar — `.jk-media-thumb`, loaded eagerly because there is one and it
   *  is always on screen. */
  variant?: 'tile' | 'thumb';
}

/** Image + graceful fallback tile. `failed` resets whenever `src` changes,
 *  so a dead image on one item can never ghost the next item's good one —
 *  this is the deliberate, "more correct" default for an instance that gets
 *  REUSED across changing items (a now-playing bar advancing tracks without
 *  remounting). It has no observable effect for a grid tile keyed per-item
 *  id (a fresh mount already starts at `failed = false`), which is exactly
 *  papyros's usage — so adopting it here is zero-behaviour-change for the
 *  library grid specifically, while being the right default going forward. */
export function CoverArt({ src, alt, fallback, className, variant = 'tile' }: CoverArtProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const thumb = variant === 'thumb';

  if (!src || failed) {
    return (
      <div
        className={thumb
          ? cx('jk-media-thumb', 'jk-media-thumb-placeholder', className)
          : cx('jk-well', 'jk-media-cover', 'jk-media-cover-placeholder', className)}
        aria-hidden="true"
      >
        {fallback}
      </div>
    );
  }

  return (
    <img
      className={cx(thumb ? 'jk-media-thumb' : 'jk-media-cover', className)}
      src={src}
      alt={alt}
      loading={thumb ? undefined : 'lazy'}
      onError={() => setFailed(true)}
    />
  );
}
