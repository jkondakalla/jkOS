// idempotency.js — the reserved idempotency field, named ONCE (WEAVE.md §3.4).
//
// ⚠️ THIS FILE EXISTS BECAUSE THE NAME HAD TWO SPELLINGS. `capability.ts` declared
// `IDEMPOTENCY_FIELD = 'idempotency_key'` for design-time consumers while
// `server/trigger.js` — the only thing that actually sent one — spelled the string
// literally, twice. Neither was wrong and nothing could tell them apart, which is
// the shape of every drift this suite gates against: two sources for one fact,
// agreeing by coincidence.
//
// Shared rather than server-only because a browser write path may want to send a
// key too, and `keyOf` is the rule for reading one. No Node built-ins here.

/** The reserved body field every write capability may accept, and that the trigger
 *  engine always sends. */
export const IDEMPOTENCY_FIELD = 'idempotency_key'

/** The longest key a door will honour. A ceiling rather than a preference: the
 *  key becomes half a primary key, and an unbounded string there is an unbounded
 *  index entry a caller chooses the size of. */
export const IDEMPOTENCY_MAX_LEN = 200

/**
 * The key in `body`, or null.
 *
 * ⚠️ **AN ABSENT KEY MEANS NO DEDUP, NOT AN ERROR.** The field is optional by
 * declaration: every hand-made write from a GUI arrives without one, and a door
 * that rejected those would break every app in the suite to protect a path with
 * no call sites yet. A blank key is absent too.
 *
 * An over-long or non-string key also reads as null HERE — the alternative is a
 * store keyed on `"[object Object]"`, silently collapsing unrelated writes into one —
 * but a door must not stop at this reader. See `idempotencyKeyError` below.
 */
export function idempotencyKeyOf(body) {
  const v = body && body[IDEMPOTENCY_FIELD]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed || trimmed.length > IDEMPOTENCY_MAX_LEN) return null
  return trimmed
}

/**
 * Why a PRESENT key is unusable, or null.
 *
 * ⚠️ **A KEY THAT IS THERE BUT CANNOT BE HONOURED IS REFUSED, NOT IGNORED.** This
 * used to fall through the reader above as "no key", so a caller who sent a 300-char
 * key got a write with no dedup and a 201 — the one outcome the key exists to
 * prevent, reached with the key in hand and nothing to say so. The field DECLARES
 * `max`, and BeigeBoard's contract smoke (which violates every declared cap and
 * expects a 400) is what caught that the cap was declared and never enforced.
 * Absent, null and blank stay fine: those are "no key", not a broken one.
 */
export function idempotencyKeyError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const v = body[IDEMPOTENCY_FIELD]
  if (v == null) return null
  if (typeof v !== 'string') return `${IDEMPOTENCY_FIELD} must be a string`
  if (v.trim().length > IDEMPOTENCY_MAX_LEN) {
    return `${IDEMPOTENCY_FIELD} exceeds the ${IDEMPOTENCY_MAX_LEN}-character limit`
  }
  return null
}

/** The optional body field a write capability declares, so a GUI or an AI can SEE
 *  that the door dedups rather than having to know. Derived from the constant
 *  above — an app that spelled the name itself would get no protection and no
 *  complaint. */
export function idempotencyBodyField() {
  return {
    name: IDEMPOTENCY_FIELD,
    type: 'string',
    label: 'Idempotency key (optional)',
    max: IDEMPOTENCY_MAX_LEN,
  }
}
