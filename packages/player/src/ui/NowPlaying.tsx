// NowPlaying.tsx — the title/artist/artwork meta block (git history, Wave 16, item
// 16.6). Markup is papyros PlayerBar's `meta` cluster verbatim: art | stacked
// title-over-subtitle, both ellipsized. `art` is a slot — pass `<CoverArt
// variant="thumb">` from @jkos/ui. This kit used to ship its own CoverArt for that
// slot; it was deleted when the Wave-15 freeze was lifted, because the suite's one
// cover primitive lives in @jkos/ui and two copies of it had already become three.
import type { ReactNode } from 'react';

export interface NowPlayingProps {
  /** Artwork slot — `<CoverArt variant="thumb">` from @jkos/ui. Renders nothing when omitted. */
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
