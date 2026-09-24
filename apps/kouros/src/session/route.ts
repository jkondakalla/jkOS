// session/route.ts — which of three things THIS tab is, for the listening session.
// PURE: the one decision every other session module reads.
//
//   local   this tab is the OUTPUT — its engine plays, it reports, commands land here
//   remote  another device (or another tab of this browser) is the output and is
//           online — this tab shows that device's session and every verb is a command
//   idle    nothing is playing anywhere reachable — this tab's engine holds the
//           session's item CUED (paused at its second), and pressing play claims the
//           output (Spotify: the device you touch becomes the one playing)
//   solo    no session at all (an old backend, a guest, the network never came up) —
//           the pre-session app, unchanged
//
// ⚠️ ONE BROWSER IS ONE DEVICE. Its tabs share a device id (localStorage), so "the
// session's output is this device" is not yet "this TAB plays": the tab holding the
// Web Lock (session/outputLock.ts) does, and every other tab of the device is a
// remote for it. That is the whole reason `holdsLock` and `lockElsewhere` exist.

export type SessionMode = 'local' | 'remote' | 'idle' | 'solo';

export interface ModeFacts {
  /** False until the session is reachable at all (and for good, on a solo tab). */
  available: boolean;
  /** The session's output device id, or null. */
  active: string | null;
  /** This device's id. */
  me: string;
  /** Does the output device hold at least one open stream? */
  activeOnline: boolean;
  /** Does THIS tab hold the output lock? */
  holdsLock: boolean;
  /** Does another tab of this browser hold it? */
  lockElsewhere: boolean;
}

export function modeOf(f: ModeFacts): SessionMode {
  if (!f.available) return 'solo';
  if (f.active === f.me) {
    if (f.holdsLock) return 'local';
    // The session names this device and another of its tabs is playing it.
    if (f.lockElsewhere) return 'remote';
    // This device, but no tab of it is playing — a reload, a crashed tab. Nothing is
    // actually playing: idle, and the lock is free for this tab to take.
    return 'idle';
  }
  if (f.active && f.activeOnline) return 'remote';
  return 'idle';
}
