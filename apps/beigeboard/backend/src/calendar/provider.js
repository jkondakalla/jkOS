'use strict';
// ARCH-3 — the one CalendarProvider contract + the one shared writer.
//
// The three calendar integrations used to be three bespoke sync engines, each
// re-implementing "fetch a window → build item rows → delete-all-then-reinsert".
// They now share this contract:
//
//   Provider = { id, fetchWindow(creds, days) → Promise<NormalizedEvent[]> }
//
//   NormalizedEvent = {
//     title, notes,            // strings (title defaults to '(No title)')
//     due_date,                // 'YYYY-MM-DD' (event start day)
//     scheduled_time,          // 'HH:MM' | null   (null = all-day)
//     scheduled_end,           // 'HH:MM' | null
//     location,                // string | null
//     end_date,                // 'YYYY-MM-DD' | null (multi-day; INCLUSIVE last day)
//   }
//
// Each provider owns ONLY its upstream fetch + the normalization of that upstream's
// shape into NormalizedEvent[] (a pure `normalize*` fn per provider, exported so
// TEST-8 can fixture-drive it without HTTP). syncProvider() owns everything shared:
// mapping a NormalizedEvent to the items-table row and the guarded replace (BUG-2).
//
// This is the seam a future ICS library (ical.js) drops into: replace iCloud's
// fetchWindow/normalizeICal behind this SAME contract — with real TZID resolution
// and RRULE expansion — and nothing else changes. See DESIGN.md → Calendar sync.
const { isoDateStr, fmt24 } = require('../util');
const { replaceCalendarSource } = require('./replace');

/* How many days forward every provider fetches. One knob, all three. */
const SYNC_WINDOW_DAYS = 90;

/* Shared normalization for a TIMED interval given two JS Dates (google + outlook
   both parse their upstream into Dates and computed this identically). `ed` may be
   null (an event with a start but no end). end_date is set only when the event spans
   into a different calendar day than it starts. */
function timedInterval(sd, ed) {
  const due_date = isoDateStr(sd);
  const scheduled_time = fmt24(sd);
  let scheduled_end = null, end_date = null;
  if (ed) {
    scheduled_end = fmt24(ed);
    const endStr = isoDateStr(ed);
    if (endStr !== due_date) end_date = endStr;
  }
  return { due_date, scheduled_time, scheduled_end, end_date };
}

/* The one writer. Fetches a provider's window, maps each NormalizedEvent to an
   items row (kind 'event', scope 'day', source = provider.id), and swaps them in
   through the empty-upstream-guarded replace. Returns { synced, skipped, reason? }. */
async function syncProvider(provider, creds, userId, { force = false, days = SYNC_WINDOW_DAYS } = {}) {
  const events = await provider.fetchWindow(creds, days);
  const rows = events.map((e) => [
    userId, 'event', 'day', e.title, e.notes, provider.id,
    e.due_date, e.scheduled_time, e.scheduled_end, e.location, e.end_date,
  ]);
  return replaceCalendarSource(provider.id, userId, rows, { force });
}

module.exports = { SYNC_WINDOW_DAYS, timedInterval, syncProvider };
