'use strict'
// weave/server/callerDay.js — what day is it, and WHERE. One answer for the suite.
//
// WHY THIS EXISTS (XC-4 / D5)
// Four notions of "today" coexisted, none of them shared and none of them aware of
// where the user actually is:
//
//   · BeigeBoard's `X-BB-Today` header — a client-computed DAY, honoured by two
//     hand-copied `callerToday()` helpers in two route files
//   · routines.js's `iso()` — UTC, so the routine horizon rolled over at UTC midnight
//   · items-store.js's `toISOString().slice(0,10)` — UTC, so the first-run seed put
//     "today's" task on tomorrow for every user west of Greenwich (BB-10)
//   · @jkos/cards' `isoDate()` — the browser's local zone, which is the right answer
//     but only exists on the frontend
//
// So ORDECK and BeigeBoard could render different days from the same data (BB-2),
// and calendar events were normalised in whatever zone the CONTAINER happened to run
// in (BB-15) — a fact about the deployment leaking into the user's data.
//
// ⚠️ The fix carries a ZONE, not a day. A day answers exactly one question; the zone
// answers every one the server has — what day is it, what wall-clock time is this
// instant, where does midnight fall. BB-15 is the finding a day-header cannot close:
// normalising a calendar event needs `hour`, not just `date`. The zone is also a
// FACT about the caller rather than a value the caller computed, so there is less for
// a client to get wrong, and it is stable enough to log and cache.
//
// The header is stamped once, suite-wide, by `authFetch` in @jkos/auth-client — so
// every request from every app already carries it and no app opts in. The zone it
// sends is the user's `preferences.timezone` when set, else the browser's resolved
// zone. See that file for the sending half; the two literals are pinned together by
// `pnpm check:today`.

/** The one header. Every jkOS frontend sends it; every jkOS backend reads it here. */
const CALLER_ZONE_HEADER = 'X-JKOS-TZ'

/* ── Time travel, and why it is locked the way it is ───────────────────────────
 *
 * A zone says WHERE, which is what production needs and all it needs. It cannot say
 * WHEN, and one caller legitimately needs to: BeigeBoard's routine smoke pins a
 * "today" a week ahead of the run and then reads again "a week later" to prove the
 * horizon rolls forward on being looked at. That is a real assertion about a real
 * engine and it cannot be written against the wall clock.
 *
 * The old `X-BB-Today` gave every client that power in every environment. This does
 * not. It is behind TWO locks, both evaluated once at module load so that nothing at
 * request time can turn it on:
 *
 *   1. NODE_ENV must not be 'production'
 *   2. JKOS_TIME_TRAVEL must be exactly '1' — opt-in, absent everywhere but the test
 *      harness, and absent from every compose file
 *
 * ⚠️ Why it is worth two locks rather than one: this is not a read-only lie. The
 * routine engine MINTS occurrence rows relative to "today", so a caller who can move
 * the date can write future state into the database. Bounded to that user's own rows
 * and to the two-week horizon, but a write nonetheless.
 */
const DAY_OVERRIDE_HEADER = 'X-JKOS-TODAY'
const TIME_TRAVEL_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.JKOS_TIME_TRAVEL === '1'
if (TIME_TRAVEL_ENABLED) {
  console.warn(`[weave] TIME TRAVEL ENABLED — ${DAY_OVERRIDE_HEADER} may override "today". Test harness only.`)
}

/** A strict YYYY-MM-DD that names a real calendar day. `2026-02-30` fails here;
 *  `new Date()` would happily roll it into March. */
function isDay(v) {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/* Intl.DateTimeFormat construction is not cheap and these are per-request, so the
   formatter for a zone is built once. The key space is bounded by validity — an
   unparseable zone never reaches the cache. */
const fmtCache = new Map()

function formatterFor(zone) {
  let f = fmtCache.get(zone)
  if (!f) {
    // `hourCycle: 'h23'` rather than `hour12: false`: the latter renders midnight as
    // hour "24" under some ICU versions, which would write `24:00` into a
    // scheduled_time column. Not hypothetical — it is why this is spelled out.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
    fmtCache.set(zone, f)
  }
  return f
}

/** Is `z` an IANA zone this runtime can actually resolve? Untrusted input — a
 *  header is a header — so the answer is "did the engine accept it", not a regex. */
function isZone(z) {
  if (typeof z !== 'string') return false
  const s = z.trim()
  // A zone id is short; anything longer is not one, and refusing early keeps a
  // pathological header out of Intl and out of the cache.
  if (!s || s.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: s }); return true }
  catch { return false }
}

/** The caller's IANA zone, or null when the request didn't carry a usable one.
 *  Null is a real answer and callers must handle it — it means "this request came
 *  from something that isn't a browser" (a peer service, a scheduler, curl). */
/* Read one header off an Express request — or off a bare `{headers}` object, which
   is what the unit tests and any non-Express host hand us. */
function header(req, name) {
  if (req && typeof req.get === 'function') return req.get(name)
  return req?.headers?.[name.toLowerCase()]
}

function callerZone(req) {
  const raw = header(req, CALLER_ZONE_HEADER)
  if (!isZone(raw)) return null
  return String(raw).trim()
}

/** An instant, broken into wall-clock pieces in `zone`. `zone` null/invalid ⇒ UTC,
 *  which is the only zone the server itself can honestly claim to know.
 *  @returns {{iso: string, time: string, year: number, month: number, day: number,
 *             hour: number, minute: number}} `iso` is YYYY-MM-DD, `time` is HH:MM. */
function zonedParts(date, zone) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) throw new TypeError('zonedParts: invalid date')
  const z = isZone(zone) ? String(zone).trim() : 'UTC'
  const p = {}
  for (const part of formatterFor(z).formatToParts(d)) p[part.type] = part.value
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute),
  }
}

/** The calendar day (YYYY-MM-DD) an instant falls on in `zone`. */
function dayIn(date, zone) {
  return zonedParts(date, zone).iso
}

/**
 * ⭐ The caller's today. THE one definition — nothing in the suite may compute a
 * "today" from a raw Date again; `pnpm check:today` enforces that.
 *
 * Falls back to the UTC day when the request carries no zone. That fallback is a
 * real behaviour change for a service caller, and the right one: a peer app reading
 * on its own behalf has no user and therefore no local day, so UTC is the only
 * defensible answer rather than the server's incidental `TZ` env.
 *
 * @param {import('express').Request} req
 * @param {Date} [at] the instant to ask about (tests pin it; production omits it)
 */
function callerDay(req, at = new Date()) {
  if (TIME_TRAVEL_ENABLED) {
    const pinned = header(req, DAY_OVERRIDE_HEADER)
    if (isDay(pinned)) return String(pinned).trim()
  }
  return dayIn(at, callerZone(req))
}

module.exports = {
  CALLER_ZONE_HEADER, DAY_OVERRIDE_HEADER, TIME_TRAVEL_ENABLED,
  isZone, isDay, callerZone, zonedParts, dayIn, callerDay,
}
