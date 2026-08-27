'use strict';
// Small pure helpers shared across route modules (no DB, no env side effects).
const { zonedParts } = require('@jkos/weave/server');

/* Safe JSON for embedding in a <script> tag (the OAuth popup postMessage payload). */
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\//g, '\\u002f');
}

/* Date/time formatting for calendar event normalization, in an EXPLICIT zone.
 *
 * ⚠️ Both of these used to read `d.getFullYear()` / `d.getHours()` — the zone the
 * CONTAINER happens to run in (BB-15). A fact about the deployment was therefore
 * written into the user's data: the same Google event filed on a different day, at
 * a different clock time, depending on the host's `TZ`. Nothing in the suite even
 * had a notion of where the user was, so there was no correct value to use.
 *
 * Now there is: `zone` is the caller's IANA zone from `callerZone(req)`
 * (@jkos/weave/server, D5). Passing null/undefined resolves to UTC — deliberately
 * NOT the server's zone, because "we don't know" should degrade to the one zone
 * that is a stated convention rather than to an accident of deployment.
 *
 * @param {Date} d @param {string|null} zone IANA zone */
function isoDateStr(d, zone) { return zonedParts(d, zone).iso; }
function fmt24(d, zone) { return zonedParts(d, zone).time; }

/* Calendar-string arithmetic on a floating YYYY-MM-DD — no instant, no zone.
 *
 * An all-day event has no time and therefore no zone: "the 27th" is the 27th
 * wherever you read it. The three providers each expressed their exclusive-end
 * subtraction by round-tripping through a Date instead, and iCloud's was wrong
 * because of it — `new Date(iso+'T00:00:00Z')` then a LOCAL `setDate(-1)` then a
 * LOCAL format lands two days back west of UTC, not one. String math cannot have
 * that bug.
 *
 * The UTC-NOON anchor is what keeps a DST spring-forward from eating the step:
 * midnight + 24h can land back on the same date, noon has 12 hours of slack. */
function shiftDay(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new TypeError(`shiftDay: not a date: ${iso}`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const nextDay = (iso) => shiftDay(iso, 1);
const prevDay = (iso) => shiftDay(iso, -1);

/* Generic 500 responder — log the detail, return a generic message so internal
   errors (SQLite text, stack hints) don't leak to clients. */
function fail(res, e, msg = 'Internal error') {
  console.error('[bb]', e?.stack || e?.message || e);
  return res.status(500).json({ error: msg });
}

/* Normalise a stored `items` row for the wire: completed → boolean, tags → array. */
function toRow(raw) {
  if (!raw) return null;
  let tags = [];
  if (raw.tags) { try { tags = JSON.parse(raw.tags); } catch { tags = []; } }
  return { ...raw, completed: raw.completed === 1, tags };
}

module.exports = { safeJson, isoDateStr, fmt24, shiftDay, nextDay, prevDay, fail, toRow };
