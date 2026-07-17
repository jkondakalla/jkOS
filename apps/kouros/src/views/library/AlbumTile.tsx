import { CoverArt, Sheet } from '@jkos/ui';
import { coverUrl } from '../../api';
import { albumHref } from '../../hooks/useHashRoute';
import { initials, type AlbumTileData } from './format';

interface AlbumTileProps {
  artist: string;
  data: AlbumTileData;
}

/** One Artist-page album tile — links into `#/album/<artist>/<album>`. Square
 *  cover, same CoverArt/Sheet idiom as ArtistTile/papyros's BookCard. */
export default function AlbumTile({ artist, data }: AlbumTileProps) {
  return (
    <Sheet as="a" href={albumHref(artist, data.album)} className="kr-tile">
      <CoverArt
        src={data.cover?.cover_path ? coverUrl(data.cover.id) : undefined}
        alt=""
        fallback={<span className="jk-press-lg">{initials(data.album)}</span>}
      />
      <div className="kr-tile-body">
        <p className="kr-tile-title">{data.album}</p>
        <p className="kr-tile-sub">
          {data.year != null ? `${data.year} · ` : ''}{data.trackCount} track{data.trackCount === 1 ? '' : 's'}
        </p>
      </div>
    </Sheet>
  );
}
