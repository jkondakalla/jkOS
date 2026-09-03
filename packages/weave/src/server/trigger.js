'use strict'
// weave/server/trigger.js — the TRIGGER engine (Layer D / F1 + G1) + the F4 stud-fit check.
//
// Evaluates "WHEN x → DO y" TriggerDefs at runtime:
//   • resolveBindings(template, payload) — turn a DO body of literals + bindings into a
//     concrete request body by pulling fields out of the event payload (F4's flow),
//   • validateTriggerTypes(trigger, …)   — check each bound DO field's type matches the
//     WHEN capability's `resolves` (async) or `returns` (sync) field it reads — the
//     typed-stud fit (F4 made enforceable; WV-5 made it correct for async),
//   • createTriggerEngine({triggers,dispatch}) — emit(app, cap, payload) fires every
//     matching trigger, resolving its body and dispatching the DO,
//   • triggerWebhook(engine)              — an Express handler so a peer can PUSH events,
//   • serverDispatch({resolve,clientOpts}) — a default dispatch over weaveServerClient that
//     runs each per-user cross-app DO under the triggering user (G1 delegation), and
//     always carries the engine's derived `idempotency_key` (RESET A2c.4).
//
// ⚠️ WHAT THE KEY DOES NOT YET BUY, stated here because the opposite was written down.
// This header used to claim the key means "a retried DO cannot double-write". It does
// not, and cannot on its own: idempotency is a property of the RECEIVER. Nothing in
// the suite reads `idempotency_key` — no capability declares it as a body field, no
// route looks for it, and there is no store of seen keys — so BeigeBoard's writer
// simply drops it as an unknown key. The sending half is correct and worth having (the
// key is derived, so a retry is RECOGNISABLE as one); the deduplicating half is unbuilt
// and has to be built before any of this protects a write. See Documentation/BACKLOG.md.
//
// `check:rulings` exercises only the sending half, against an injected dispatcher —
// which is exactly why the gap survived: the test proves the key is derived and stable,
// never that anything acts on it.
// The engine is dispatch-agnostic (inject a mock to test) so the "what fires" logic is
// pure + provable; serverDispatch is the live wiring. Design-time TS shapes: ../trigger.ts.

const { weaveServerClient } = require('./serverClient')

/* ⭐ ONE BINDING MODEL (D13). The resolver lives in ../shared/binding.js and is the
   SAME one ORDECK's WidgetSpec renderer uses. These were two vocabularies for one
   idea — "point at a value that will exist at run time" — the read half and the write
   half of a system that never met, and `trigger.ts`'s own header describes itself in
   the sentence WidgetSpec's docs use.
   ⚠️ The convergence cost nothing because one form was strictly the other's
   degenerate case: `{from:'x'}` is `{src:'event', path:'x'}` with the source left
   implicit, since a trigger only ever had one. Both forms still resolve, identically,
   so every TriggerDef written before this is unchanged. */
const { isBinding, normalizeBinding, resolveBody, EVENT_SOURCE } = require('../shared/binding')

/**
 * Resolve a DO body TEMPLATE against an event PAYLOAD. The payload is bound as the
 * `event` source, so `{from:'field'}` and `{src:'event',path:'field'}` are the same
 * binding written two ways — and a trigger can now also carry an explicit `{lit}`
 * and a `fallback`, neither of which the old form could express.
 * @param {Record<string, any>} template
 * @param {Record<string, any>} payload
 */
function resolveBindings(template, payload) {
  return resolveBody(template, { [EVENT_SOURCE]: payload })
}

// Two field types are stud-compatible when equal, or both free text, or the target is a
// typed ref accepting an id/ref source. Deliberately lenient (a string id can feed a ref);
// it catches the gross mismatches (a boolean into a date) a GUI/AI would otherwise ship.
function typeFits(srcType, dstType) {
  if (srcType === dstType) return true
  const text = new Set(['string', 'text'])
  if (text.has(srcType) && text.has(dstType)) return true
  if (dstType === 'ref') return srcType === 'number' || srcType === 'string' || srcType === 'ref'
  return false
}

/**
 * F4 conformance: does this trigger's wiring type-check? Given the WHEN capability's
 * `returns` (the payload shape) and the DO capability's `body` (the input shape),
 * report every binding whose source field is missing or whose type doesn't fit the
 * target, every DO field that doesn't exist, and every required DO field left unbound.
 * @returns {import('../trigger').TriggerTypeIssue[]} empty = the studs fit.
 */
/**
 * Check that every bound DO field can actually take the WHEN field it reads.
 *
 * ⚠️ `whenResolves` WINS OVER `whenReturns`, and that is the whole of WV-5. An async
 * capability's `returns` is its JOB HANDLE — correct for the HTTP response, useless
 * for composition. Binding from it type-checks (`string` → `string`) and produces a
 * task titled `a3f1c8e2-…`: no error, no warning, just a nonsense row. So when the
 * WHEN capability declares `resolves`, that is the only surface a binding may read,
 * and a binding that names a `returns` field it no longer exposes is REFUSED rather
 * than silently allowed through.
 *
 * @param {object} trigger
 * @param {{ whenReturns?: Array, whenResolves?: Array, doBody?: Array }} shapes
 */
function validateTriggerTypes(trigger, { whenReturns = [], whenResolves = null, doBody = [] } = {}) {
  const issues = []
  /* An async capability composes on what its WORK produces, never on its handle.
     `resolves` present ⇒ the capability is asynchronous (there is deliberately no
     separate `async` flag to disagree with it). */
  const isAsync = Array.isArray(whenResolves)
  const whenFields = isAsync ? whenResolves : whenReturns
  const whenByName = new Map(whenFields.map((f) => [f.name, f]))
  const doByName = new Map(doBody.map((f) => [f.name, f]))
  const body = (trigger.do && trigger.do.body) || {}
  for (const [field, v] of Object.entries(body)) {
    const target = doByName.get(field)
    if (!target) { issues.push({ field, msg: `DO '${trigger.do.capability}' has no body field '${field}'` }); continue }
    if (isBinding(v)) {
      /* Normalised, so a trigger written in either vocabulary type-checks the same
         way. A binding at a source other than the event is not the WHEN payload and
         cannot be type-checked against it — it is left to the renderer that owns
         that source. */
      const b = normalizeBinding(v)
      if (b.src !== EVENT_SOURCE) continue
      const src = whenByName.get(String(b.path).split('.')[0])
      if (!src) {
        issues.push({
          field,
          msg: isAsync
            ? `binding from '${b.path}' — WHEN '${trigger.when.capability}' is ASYNC and resolves no such field `
              + '(its `returns` is a job handle; bind from what the work produces, not from the handle)'
            : `binding from '${b.path}' — WHEN '${trigger.when.capability}' returns no such field`,
        })
        continue
      }
      if (!String(b.path).includes('.') && !typeFits(src.type, target.type)) {
        issues.push({ field, msg: `type mismatch: ${trigger.when.capability}.${b.path} is '${src.type}' but ${trigger.do.capability}.${field} expects '${target.type}'` })
      }
    }
  }
  for (const f of doBody) {
    if (f.required && !(f.name in body)) issues.push({ field: f.name, msg: `required DO field '${f.name}' is unbound` })
  }
  return issues
}

/* A stable key for "this trigger, reacting to this event". Same inputs ⇒ same key.
 *
 * ⚠️ The payload is folded in through a canonical (key-sorted) JSON so that two
 * events carrying the same facts in a different key order produce the SAME key —
 * otherwise a peer that reserialised its payload would defeat the whole mechanism
 * without changing anything meaningful.
 *
 * Not a cryptographic hash: this is a collision-avoidance id, not a secret, and a
 * dependency-free FNV-1a keeps the trigger engine loadable in a bare checkout — the
 * property that lets it be tested with an injected dispatcher and no I/O at all. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
}

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function idempotencyFor(trigger, app, capability, payload) {
  const id = trigger.id || `${trigger.when.app}.${trigger.when.capability}->${trigger.do.app}.${trigger.do.capability}`
  return `trg_${fnv1a(`${id}|${app}.${capability}|${canonicalJson(payload ?? null)}`)}`
}

/**
 * Build a trigger engine over a set of TriggerDefs and an injectable dispatcher.
 * @param {{ triggers?: import('../trigger').TriggerDef[],
 *           dispatch: (doSpec, body, ctx) => Promise<{ok?: boolean}> }} cfg
 */
function createTriggerEngine({ triggers = [], dispatch } = {}) {
  if (typeof dispatch !== 'function') throw new Error('createTriggerEngine: a dispatch(doSpec, body, ctx) function is required')
  const enabled = (triggers || []).filter((t) => t && t.enabled !== false)

  // The event (a capability firing) → fire every matching trigger. `ctx.actingUser` is
  // the user who caused the event; a trigger's do.actingUser may pin a fixed user instead.
  async function emit(app, capability, payload, ctx = {}) {
    const matched = enabled.filter((t) => t.when.app === app && t.when.capability === capability)
    const results = []
    for (const t of matched) {
      const body = resolveBindings(t.do.body, payload)
      const actingUser = t.do.actingUser && t.do.actingUser !== 'event' ? t.do.actingUser : (ctx.actingUser ?? null)
      /* ⭐ ALWAYS AN IDEMPOTENCY KEY (RESET A2c.4). A trigger's DO is a WRITE fired by
         an event, and both halves of that sentence can repeat: a webhook redelivers,
         a dispatch times out and is retried, a peer replays. Without a key the second
         attempt is a second task on someone's board, and the user has no way to know
         which of the two is the real one.
         ⚠️ The key is SENT, not yet HONOURED — see this file's header. No receiver
         dedupes on it today, so the duplicate above is still possible.
         DERIVED, never random: same trigger + same event ⇒ same key, which is the
         only property that makes a retry recognisable AS a retry. A random key would
         make every attempt look new, which is worse than no key at all because it
         looks like the problem is solved. */
      const idempotencyKey = ctx.idempotencyKey || idempotencyFor(t, app, capability, payload)
      try {
        const r = await dispatch(t.do, body, {
          actingUser, idempotencyKey, trigger: t, event: { app, capability, payload },
        })
        results.push({ trigger: t.id, ok: r ? r.ok !== false : true, result: r })
      } catch (e) {
        results.push({ trigger: t.id, ok: false, error: e && e.message ? e.message : String(e) })
      }
    }
    return results
  }

  return { emit, triggers: enabled }
}

/**
 * Express handler so a peer can PUSH an event (cross-app, cross-process). Mount behind
 * the host app's weaveAuth (+ a scope) — the caller's identity defaults the acting user.
 * Body: { app, capability, payload?, actingUser? }.
 */
function triggerWebhook(engine) {
  return async function triggerWebhookHandler(req, res) {
    const { app, capability, payload, actingUser } = req.body || {}
    if (!app || !capability) return res.status(400).json({ error: 'app and capability are required' })
    try {
      const fired = await engine.emit(app, capability, payload || {}, { actingUser: actingUser != null ? actingUser : req.user && req.user.sub })
      res.json({ fired })
    } catch (e) {
      console.error('[trigger] emit failed', e && e.stack ? e.stack : e)
      res.status(500).json({ error: 'trigger emit failed' })
    }
  }
}

/**
 * The live dispatcher: invoke the DO capability on its app via weaveServerClient,
 * running per-user cross-app DOs AS the acting user (G1 delegation — needs a
 * delegation-enrolled service client). `resolve(app, capId)` yields the target
 * capability's `{ method, path }` (look it up in the served capability docs).
 * Caches one client per (app, actingUser).
 * @param {{ resolve: (app: string, capId: string) => ({method?: string, path: string}|null),
 *           clientOpts?: object }} cfg
 */
function serverDispatch({ resolve, clientOpts = {} } = {}) {
  if (typeof resolve !== 'function') throw new Error('serverDispatch: resolve(app, capId) is required')
  const clients = new Map()
  function clientFor(app, actingUser) {
    const k = `${app}|${actingUser || ''}`
    if (!clients.has(k)) clients.set(k, weaveServerClient(app, { ...clientOpts, ...(actingUser ? { actingUser } : {}) }))
    return clients.get(k)
  }
  return async function dispatch(doSpec, body, ctx) {
    const cap = resolve(doSpec.app, doSpec.capability)
    if (!cap) throw new Error(`serverDispatch: unknown capability ${doSpec.app}.${doSpec.capability}`)
    const path = String(cap.path).replace(/:(\w+)/g, (_, k) => encodeURIComponent(String(body[k] ?? '')))
    const client = clientFor(doSpec.app, ctx && ctx.actingUser)
    const method = (cap.method || 'POST').toLowerCase()
    if (method === 'get') return client.get(path)
    if (method === 'delete') return client.delete(path)
    /* ⭐ THE IDEMPOTENCY KEY RIDES IN THE BODY (RESET A2c.4), under the reserved
       `idempotency_key` name that write capabilities declare.
       ⚠️ In the BODY rather than a header on purpose: this suite's write surface is
       declared as typed body fields, and a capability doc has no vocabulary for
       headers — a key sent as one would be invisible to the declaration, which is
       exactly the "undeclared surface" class the whole contract exists to close.
       Never overwrites a key a caller already bound: an explicit one wins. */
    const withKey = ctx && ctx.idempotencyKey && body && body.idempotency_key === undefined
      ? { ...body, idempotency_key: ctx.idempotencyKey }
      : body
    return client[method](path, withKey)
  }
}

module.exports = { resolveBindings, validateTriggerTypes, createTriggerEngine, triggerWebhook, serverDispatch }
