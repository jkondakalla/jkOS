import { useState } from 'react';
import { coverUrl } from '../api';

interface CoverProps {
  /** Track id whose extracted art to show. Null/undefined means the fallback. */
  id?: number | null;
  /** Whether the catalog says art exists. When false the fetch is skipped entirely —
   *  a 404 per tile across a several-thousand-album grid is a lot of pointless
   *  requests, and every one of them is a real round trip on a phone. */
  has?: boolean;
  alt: string;
  /** Seed for the fallback's letter — the album or artist name. */
  name?: string;
  className?: string;
  /** Loaded eagerly and at high priority. The Now Playing hero only. */
  eager?: boolean;
  /** A ready-made art URL, in place of a track id — an audiobook's jacket lives on
   *  its own route (/api/books/cover), which a TRACK id cannot address. `null`
   *  means "no art" and shows the fallback, like `has={false}`. */
  src?: string | null;
}

/** One square of album art, with the app's single fallback treatment.
 *
 *  `loading="lazy"` and `decoding="async"` are load-bearing rather than
 *  decorative: a browse grid at this library's scale mounts hundreds of these at
 *  once, and decoding them synchronously on the main thread is exactly what makes
 *  a cover grid stutter under a thumb. */
export default function Cover({ id, has = true, alt, name, className, eager, src }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const url = src !== undefined ? src : id != null ? coverUrl(id) : null;
  const showImage = url != null && has && !failed;
  const letter = (name || alt || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className={`kr-cover${className ? ` ${className}` : ''}`}>
      {showImage ? (
        <img
          src={url!}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="kr-cover-fallback" aria-hidden="true">{letter}</div>
      )}
    </div>
  );
}
