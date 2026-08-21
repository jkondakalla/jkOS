import { useEffect, useState } from 'react';
import { getNowPlaying, onNowPlaying, type NowPlayingState } from '../player/controller';

/** Which track is loaded and whether it is playing, for any view that wants to
 *  mark its own rows.
 *
 *  This reads the controller BROADCAST rather than calling usePlayerEngine():
 *  PlayerBar holds the only engine instance, and a second one would mount a
 *  second <audio> element and a second queue that immediately disagrees with the
 *  first. The seam exists precisely so a track list can know what is playing
 *  without owning playback.
 *
 *  Seeded from `getNowPlaying()` so a list mounted mid-playback marks the right
 *  row on its FIRST paint instead of flashing unmarked until the next broadcast. */
export function useNowPlaying(): NowPlayingState {
  const [state, setState] = useState<NowPlayingState>(() => getNowPlaying());
  useEffect(() => onNowPlaying(setState), []);
  return state;
}
