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

/**
 * A publisher blurb, flattened to plain text.
 *
 * ⚠️ The description is THIRD-PARTY HTML. iTunes ships `<b>`, `<i>` and
 * `<br />` inside it (16 of Jag's 18 books carry markup), and the view used to
 * render the string straight — so the tags appeared literally on screen, on
 * every enriched book.
 *
 * The fix is to STRIP, not to render. `dangerouslySetInnerHTML` would put a
 * remote metadata provider's markup into the page unsanitised, which is a real
 * injection surface for a string this app does not control — and buying an
 * italic is not worth that. So: paragraph and line breaks become newlines, every
 * other tag is dropped, the five HTML entities that survive that are decoded,
 * and runs of blank lines collapse. `white-space: pre-line` on
 * `.book-description` turns the newlines back into paragraphs.
 *
 * PURE — no DOM, so the transpile-and-drive gate can exercise it directly.
 */
export function plainDescription(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw)
    // Breaks first, while the tags are still there to recognise.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    // Only after tag removal, so a decoded "&lt;b&gt;" can't become a live tag.
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')   // last: an entity's own ampersand must not re-arm
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
