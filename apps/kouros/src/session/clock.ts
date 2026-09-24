// session/clock.ts — where a REMOTE device's music has got to. PURE.
//
// The output reports its position with the server's receipt time stamped on it
// (`reported_at`); every other device works out "now" from that. Two clocks are in
// play and neither is trusted to agree with the other: a phone can be seconds off
// the server. So the offset between this device's clock and the server's is measured
// (a request's round trip, halved) and the extrapolation runs on SERVER time.
//
// ⚠️ This is only ever for a remote's display. The output's own position always comes
// off its media element (engine.livePosition) — extrapolating a LOCAL element with a
// clock of its own drifts on buffering and on a rate change (TRAPS.md § the
// pulsarmap's clock).

export interface ClockSample {
  /** serverTime − localTime, milliseconds. */
  offsetMs: number;
  /** The round trip it was measured over — the smaller, the better the sample. */
  rttMs: number;
}

/** One offset sample from a request sent at `sentAt` and answered at `receivedAt`
 *  (local ms) carrying the server's `serverNow` (ISO). Assumes the server stamped it
 *  halfway through the round trip — the error is bounded by rtt/2. */
export function sampleClock(sentAt: number, receivedAt: number, serverNow: string): ClockSample | null {
  const server = Date.parse(serverNow);
  if (!Number.isFinite(server) || receivedAt < sentAt) return null;
  return { offsetMs: server - (sentAt + receivedAt) / 2, rttMs: receivedAt - sentAt };
}

/** Keep the sample with the shortest round trip — the one whose midpoint guess is
 *  the least wrong (NTP's rule, minus the filter). */
export function betterClock(a: ClockSample | null, b: ClockSample | null): ClockSample | null {
  if (!a) return b;
  if (!b) return a;
  return b.rttMs < a.rttMs ? b : a;
}

export interface SessionPositionFacts {
  position_ms: number;
  playing: boolean;
  rate: number;
  reported_at: string | null;
}

/** Milliseconds into the item at server time `serverNowMs`. Paused holds still; a
 *  clock behind the report never runs it backwards; `durationMs` (when known) caps
 *  it, so a remote whose output vanished mid-report does not scrub past the end. */
export function extrapolateMs(s: SessionPositionFacts, serverNowMs: number, durationMs?: number): number {
  let ms = s.position_ms;
  if (s.playing && s.reported_at) {
    const since = Math.max(0, serverNowMs - Date.parse(s.reported_at));
    if (Number.isFinite(since)) ms += since * (s.rate || 1);
  }
  if (durationMs != null && durationMs > 0) ms = Math.min(ms, durationMs);
  return Math.max(0, Math.round(ms));
}

/** A timed sleep's remaining milliseconds at server time `serverNowMs`, counting down
 *  from the report the same way the position counts up. Null when none is running
 *  (or it is 'segment' — end of chapter has no clock). */
export function sleepRemainingMs(
  s: { sleep_remaining_ms: number | null; playing: boolean; reported_at: string | null },
  serverNowMs: number,
): number | null {
  if (s.sleep_remaining_ms == null) return null;
  if (!s.playing || !s.reported_at) return s.sleep_remaining_ms;
  const since = Math.max(0, serverNowMs - Date.parse(s.reported_at));
  return Math.max(0, Math.round(s.sleep_remaining_ms - (Number.isFinite(since) ? since : 0)));
}
