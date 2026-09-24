// player/station.ts — "start a station from this track", once.
//
// Five views (Home, Album, Artist, Search, Now Playing) each carried the same eight
// lines: build a radio queue around a seed, then play the seed followed by it. Now
// that a queue carries WHERE it came from (player/context.ts), a sixth copy of the
// context would have had to be remembered in all five — so it lives here.

import { radioFrom } from '../api';
import { stationContext } from './context';
import { requestPlay } from './controller';

/** Build a station around `seedId` and play it: the seed first, then its radio.
 *  Resolves true when it started. A failed build is non-fatal — whatever was
 *  playing keeps playing — and resolves false. */
export async function startStation(seedId: number, k = 60): Promise<boolean> {
  try {
    const r = await radioFrom([seedId], k);
    const ids = r.results.map((t) => t.id).filter((id) => id !== seedId);
    if (!ids.length) return false;   // an empty station is not worth interrupting for
    requestPlay({ trackIds: [seedId, ...ids], startIndex: 0, context: stationContext(seedId) });
    return true;
  } catch {
    return false;
  }
}
