'use strict';
// tags.js (KourOS library service, git history: item 18.2) — pure ffprobe-tag helpers for the
// music scanner. Mirrors the PURE half of papyros's src/library/probe.js
// (extractYear/parseGenres) — no narrator/series/album==title guard here, since none of
// that audiobook-specific logic applies to a per-track music catalog. Kept apart from
// scan.js (like probe.js is kept apart from papyros's scan.js) so it's unit-testable
// against hand-authored tag objects with zero I/O.

/** Pull a 4-digit year out of a `date` tag ("2021", "2021-05-14", "05/2021", …). PURE. */
function extractYear(dateStr) {
  if (dateStr == null) return null;
  const match = String(dateStr).match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

/**
 * Split a `genre` tag into a trimmed, order-preserving, de-duplicated array. Handles
 * the common multi-genre delimiters taggers use: `;`, `,`, `/` (same delimiter set as
 * papyros's parseGenres). PURE.
 */
function parseGenres(genreStr) {
  if (genreStr == null) return [];
  const seen = new Set();
  const genres = [];
  for (const raw of String(genreStr).split(/[;,/]+/)) {
    const g = raw.trim();
    if (g && !seen.has(g)) {
      seen.add(g);
      genres.push(g);
    }
  }
  return genres;
}

module.exports = { extractYear, parseGenres };
