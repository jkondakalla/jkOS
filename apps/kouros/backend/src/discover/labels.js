'use strict';
// labels.js — the few lines of text the Home rails show, said by the server.
//
// A widget binds values and never computes them (the rescope's rule: a computed value
// is a declared field). So "3 hr 12 min left" and "12 plays · 340 in library" are
// fields of the answer, worded exactly as the app's own formatters word them
// (src/views/library/format.ts): durations of a SET are coarse ("48 min"), counts are
// grouped and pluralised. Grouping is pinned to en-US — a container's locale is not
// the listener's, and a separator that changed with the host would be a bug nobody saw.

/** A coarse duration for a set — "48 min", "3 hr 12 min" (format.ts formatSpan). */
function span(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m ? `${h} hr ${m} min` : `${h} hr`;
  return `${m} min`;
}

/** "1 track", "1,204 tracks" (format.ts formatCount). */
function count(n, singular, plural = `${singular}s`) {
  return `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? singular : plural}`;
}

module.exports = { span, count };
