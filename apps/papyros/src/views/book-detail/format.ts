// book-detail/format.ts — small time-formatting helpers shared by BookDetail's
// resume button, progress readout, and chapter/track rows. Positions/durations always
// arrive in seconds (api.ts's BookChapter/BookFile/ProgressRow contract) — nothing
// here talks to the network, it's pure formatting.

/** Clock-style position — "h:mm:ss" once past an hour, "m:ss" under one. Used for the
 *  Resume button's readout and every chapter/track row's start/length time. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Coarse duration — "3h 42m" (or "42m" under an hour) — for the metadata panel's
 *  total-runtime line. */
export function formatHM(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
