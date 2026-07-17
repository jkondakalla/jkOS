// NowPlaying.tsx — the title/artist/artwork meta block (ToDo.md §3 Wave 16, item
// 16.6). Markup is papyros PlayerBar's `meta` cluster verbatim: art | stacked
// title-over-subtitle, both ellipsized. `art` is a slot (papyros passes its own
// CoverThumb — see that file for why it stays bespoke); <CoverArt> below is the
// stock artwork part for kit-first consumers.
import { useEffect, useState, type ReactNode } from 'react';
import { IconArtwork } from './icons';

export interface NowPlayingProps {
  /** Artwork slot (e.g. <CoverArt/>). Renders nothing when omitted. */
  art?: ReactNode;
  title: ReactNode;
  /** Renders the title as an <a href> (papyros links to the item's detail view). */
  titleHref?: string;
  /** The title element's `title` tooltip; defaults to `title` when it's a string. */
  titleTip?: string;
  subtitle?: ReactNode;
}

export function NowPlaying({ art, title, titleHref, titleTip, subtitle }: NowPlayingProps) {
  const tip = titleTip ?? (typeof title === 'string' ? title : undefined);
  return (
    <div className="pb-meta">
      {art}
      <div className="pb-meta-text">
        {titleHref != null
          ? <a className="pb-title" href={titleHref} title={tip}>{title}</a>
          : <span className="pb-title" title={tip}>{title}</span>}
        {subtitle != null && <span className="pb-sub">{subtitle}</span>}
      </div>
    </div>
  );
}

/** Stock artwork thumb: image with a glyph fallback on missing/404'd art. Unlike
 *  papyros's original CoverThumb, the failure flag RESETS when `src` changes, so a
 *  dead cover on one item can't ghost the next item's good one — which is why
 *  papyros (zero-behavior-change migration) keeps its own for now. */
export function CoverArt({ src, alt, fallback }: {
  src?: string;
  alt: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) {
    return <div className="pb-cover pb-cover-empty" aria-hidden="true">{fallback ?? <IconArtwork />}</div>;
  }
  return <img className="pb-cover" src={src} alt={alt} onError={() => setFailed(true)} />;
}
