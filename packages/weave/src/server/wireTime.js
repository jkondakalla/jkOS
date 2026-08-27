'use strict'
// The suite's wire timestamp format — ONE definition (XC-1).
//
// ⚠️ There were two, and they sort against each other INCORRECTLY as strings,
// which is the part that makes this a correctness bug rather than a style one:
//
//     SQLite datetime('now')  →  "2026-08-27 05:21:34"      (space, whole seconds)
//     millisecond ISO-8601    →  "2026-08-27T05:21:34.353Z" (T, milliseconds)
//
// `' ' (0x20) < 'T' (0x54)`, so every whole-second stamp sorts BEFORE every
// ISO stamp of the same instant — and `?since=<cursor>` is a string comparison
// (`updated_at > ?`). A cursor taken from one app and used against another
// therefore returns the wrong window, silently. That is why a delta cursor was
// not portable across this suite even in principle.
//
// The second, older defect is resolution. BeigeBoard's `items` moved to
// millisecond ISO in migration 8 for a measured reason: at whole-second
// granularity, two rows written in the same second are indistinguishable to a
// `>` cursor, so a poller either re-reads a row forever or skips one. Nine
// collections across three apps kept the second-resolution default.
//
// This matters beyond the UI. The incremental-embedding cursor for the music
// vector space runs off `?since=`, over tens of thousands of rows, where
// "skipped one" means a track that is never embedded and never noticed.

/** SQLite expression producing the canonical wire format for a given time.
 *  Use `sqlNow()` in DDL defaults and triggers. */
const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

/** Convert an existing column (in either legacy or canonical form) in place.
 *  `strftime` parses the space-separated form, so this is safe to run over a
 *  table holding a mix — and it is idempotent, because re-formatting an
 *  already-canonical value yields the same string. */
const sqlConvert = (col) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${col})`

/** The same instant from JS. Node's toISOString() is exactly this format. */
const now = () => new Date().toISOString()

/** True for the canonical form. Deliberately strict — the point is to catch a
 *  value that came from the legacy default, and that value differs only by its
 *  separator and its missing fraction. */
const CANONICAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const isCanonical = (v) => CANONICAL_RE.test(String(v))

/** Parse either form to epoch ms. Kept here so callers never hand-roll the
 *  space→'T' fixup and quietly get it wrong for one of the two. */
function parse(value) {
  const s = String(value)
  return Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
}

module.exports = { SQL_NOW, sqlConvert, now, isCanonical, parse, CANONICAL_RE }
