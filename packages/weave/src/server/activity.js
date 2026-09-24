'use strict'
// weave/server/activity.js — mount an app's activity surface (XC-2 / D6).
//
// ⭐ THE RULE THIS FILE IS BUILT AROUND: declare one shape, do NOT share an
// implementation. What lives here is the envelope, the query vocabulary, and the
// validator. What does NOT live here — and must not — is any knowledge of how an
// app records what its user did. Each app hands in a `read` function that runs its
// OWN SQL over its OWN ledger, and stays free to index, reshape or purge that
// ledger without a suite-wide migration.
//
// The split matters more than it looks. `defineCollection` is the opposite bargain:
// it owns the table, the DDL and the routes, which is right for a generic per-user
// CRUD list. A ledger is not that. kouros's `history` means "a listening stretch",
// beigeboard's `started_at`/`completed_at` are two columns on a wide items table,
// and lazuros's `jobs` is a work queue that happens to remember. Forcing those into
// one table would be inventing a fifth schema to replace four honest ones. Forcing
// them into one ANSWER is exactly what was missing.
//
// The shape, the validator and the merge live in ../shared/activity.js, shared with
// the browser read path so producer and consumer cannot disagree on "valid".
//
// ⚠️ ZERO HEAVY DEPS, and that is a hard constraint rather than a preference. This
// is reached through the lean `@jkos/weave/activity` subpath because an app's
// discovery.js is imported AS DATA by the suite-prober (sources.mjs), and pulling
// express/jsonwebtoken in through the full `@jkos/weave/server` barrel would break
// that. Same bargain `@jkos/weave/collection` already makes. `canonicalTime` and
// `extRef` are re-exported here for the same reason: a discovery doc needs all
// three and must not need a second import path to get them. `checkActivityDoc` rides
// along for the same reason: an app's own smoke asserts its served doc against the
// contract, and reaching into ../shared/ past the export map is not a thing a
// consumer should have to do.

const {
  ACTIVITY_PATH, ACTIVITY_MAX_LIMIT, ACTIVITY_DEFAULT_LIMIT,
  checkActivityDoc, isValidActivityDoc,
} = require('../shared/activity')
const { canonical: canonicalTime } = require('./wireTime')
const { extRef, checkExtRefDoc, extRefFieldDoc } = require('../shared/extref')
const { pageLimit, PAGE_DEFAULT, PAGE_MAX, CURSOR_PARAM } = require('../shared/paging')
const { idempotencyBodyField } = require('../shared/idempotency')

/* Canonical millisecond ISO — the format `at` is held to, and therefore the format
   the `since`/`until` cursors must speak, since they are compared against it as
   strings. Accepting a looser input here would let a caller hand in a value that
   sorts wrongly against the column and get a silently wrong window: the exact XC-1
   failure, re-introduced through the query string. */
const CANONICAL_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function cursor(v) {
  const s = String(v ?? '').trim()
  return CANONICAL_AT.test(s) ? s : null
}

/* From the ONE paging contract (WEAVE.md §3.2) rather than a fourth hand-rolled clamp.
   Three that disagreed is what made a cross-app fan-out unmergeable: "give me 100"
   meaning three different windows, and the merged page silently short. */
const limitOf = (v) => pageLimit(v, { fallback: ACTIVITY_DEFAULT_LIMIT, max: ACTIVITY_MAX_LIMIT })

/**
 * Build an app's activity surface.
 *
 * @param {object} def
 * @param {string} def.app        the app id, matching @jkos/suite-manifest
 * @param {number} [def.version]  the doc version (bump on a breaking kind change)
 * @param {Array<{id: string, label: string, verb?: string}>} def.kinds
 *   this app's closed vocabulary of verbs. Declared, not inferred, so a consumer
 *   can render a filter UI without having read every row first.
 * @param {(db: object, userId: string|number, opts: {since: string|null, until: string|null, limit: number}) => Array}
 *   def.read the app's OWN query. Returns ActivityEvent[] — newest first, already
 *   limited. Weave supplies the envelope so an app cannot get it wrong.
 *   ⚠️ The db handle is passed IN at mount time, never imported here — the same
 *   arrangement defineCollection's `mount(router, db)` uses, and what keeps a
 *   discovery doc free of any database import so the prober can load it as data.
 *
 * @returns {{ path: string, doc: Function, handler: Function, mount: Function }}
 */
function defineActivity({ app, version = 1, kinds, read }) {
  if (typeof app !== 'string' || !app) throw new Error('weave: defineActivity needs an app id')
  if (typeof read !== 'function') throw new Error(`weave: defineActivity(${app}) needs a read function`)

  /* Validate the DECLARATION at boot, with an empty event list, so a typo'd kind
     fails on the producer at startup rather than on a consumer at 2am. The events
     themselves can only be checked per request — they are data. */
  const shapeErr = checkActivityDoc({ app, version, kinds, activity: [] })
  if (shapeErr) throw new Error(`weave: activity doc for '${app}' — ${shapeErr}`)

  function doc(db, userId, opts) {
    return { app, version, kinds, activity: read(db, userId, opts) || [] }
  }

  function handler(db) {
    return function activityHandler(req, res) {
      try {
        const opts = {
          since: cursor(req.query.since),
          until: cursor(req.query.until),
          limit: limitOf(req.query.limit),
        }
        const out = doc(db, req.user?.sub, opts)
        /* Validate our OWN answer before serving it. A malformed doc is dropped
           wholesale by the consumer (fetchActivity applies the same rule), so
           without this an app with one bad row disappears from the merged feed
           silently and looks like an app with nothing to say. 500 rather than
           filtering the bad rows out: this is a bug in the app, and a feed that
           quietly omits events is worse than one that admits it is broken. */
        const err = checkActivityDoc(out)
        if (err) {
          console.error(`[weave] activity: '${app}' produced an invalid doc — ${err}`)
          return res.status(500).json({ error: 'Invalid activity document', code: 'ACTIVITY_INVALID' })
        }
        return res.json(out)
      } catch (e) {
        console.error(`[weave] activity: '${app}' read failed —`, e?.stack || e?.message || e)
        return res.status(500).json({ error: 'Activity read failed' })
      }
    }
  }

  /** Wire GET <basePath><path> — the whole surface, one route. Mirrors
   *  defineCollection's mount(router, db) so an app mounts its three declarations
   *  the same way. `basePath` defaults to '/api', which is what the edge strips
   *  `/api/<app>` down to. */
  function mount(router, db, { basePath = '/api' } = {}) {
    router.get(`${basePath}${ACTIVITY_PATH}`, handler(db))
  }

  return { app, version, kinds, path: ACTIVITY_PATH, doc, handler, mount }
}

module.exports = {
  defineActivity, canonicalTime, extRef, checkActivityDoc, isValidActivityDoc,
  // WEAVE.md §3.2: the one paging contract, reachable from the same lean subpath.
  pageLimit, PAGE_DEFAULT, PAGE_MAX, CURSOR_PARAM,
  // BB-5: the ext_ref namespace, reached from the same lean subpath a discovery doc
  // already imports — it declares its schemes right next to its datasets.
  checkExtRefDoc, extRefFieldDoc,
  // WEAVE.md §3.4: a HAND-ROLLED write door declares the reserved idempotency field
  // from its discovery doc, which is data — so the declaration helper rides the
  // lean subpath too. The receiver (withIdempotency) needs a db and stays in the
  // server barrel.
  idempotencyBodyField,
}
