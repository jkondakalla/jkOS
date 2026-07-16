import { CoverArt, Sheet } from '@jkos/ui';
import { coverUrl } from '../../api';
import { artistHref } from '../../hooks/useHashRoute';
import { initials, type ArtistTileData } from './format';

interface ArtistTileProps {
  data: ArtistTileData;
}

/** One Artists-grid tile — `Sheet as="a"` so the whole card is one tap target
 *  into `#/artist/<name>` (mirrors papyros's BookCard). The cover is the
 *  artist's own representative track's art (ArtistTileData.cover, picked in
 *  format.ts's groupTracksByArtist — disc/track order's first track that
 *  actually has one); no art at all falls back to the initials tile. */
export default function ArtistTile({ data }: ArtistTileProps) {
  return (
    <Sheet as="a" href={artistHref(data.artist)} className="kr-tile">
      <CoverArt
        src={data.cover?.cover_path ? coverUrl(data.cover.id) : undefined}
        alt=""
        fallback={<span className="jk-press-lg">{initials(data.artist)}</span>}
        className="kr-tile-cover-round"
      />
      <div className="kr-tile-body">
        <p className="kr-tile-title">{data.artist}</p>
        <p className="kr-tile-sub">
          {data.albumCount} album{data.albumCount === 1 ? '' : 's'} &middot; {data.trackCount} track{data.trackCount === 1 ? '' : 's'}
        </p>
      </div>
    </Sheet>
  );
}
