import { useEffect } from 'react';
import { refreshToken } from './client';

/**
 * Pre-emptively rotate the access token before its 15-min TTL lapses, so a
 * long-open dashboard never hits a 401 mid-poll. `authFetch` already recovers
 * reactively (refresh + retry on a 401); this just removes the one-round-trip
 * stutter on the first expired request after the tab has been sitting idle.
 *
 * Only fires while the tab is visible — a backgrounded tab doesn't burn refreshes,
 * and the moment it's foregrounded again any expired data poll repairs itself via
 * authFetch. Default cadence is comfortably inside the 15-min access TTL.
 */
export function useSessionKeepalive(intervalMs = 12 * 60 * 1000): void {
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refreshToken(); };
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
