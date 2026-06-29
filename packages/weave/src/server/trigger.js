'use strict'
// weave/server/trigger.js — the TRIGGER engine (Layer D / F1 + G1) + the F4 stud-fit check.
//
// Evaluates "WHEN x → DO y" TriggerDefs at runtime:
//   • resolveBindings(template, payload) — turn a DO body of literals + bindings into a
//     concrete request body by pulling fields out of the event payload (F4's flow),
//   • validateTriggerTypes(trigger, …)   — check each bound DO field's type matches the
//     WHEN capability's `returns` field it reads (the typed-stud fit; F4 made enforceable),
//   • createTriggerEngine({triggers,dispatch}) — emit(app, cap, payload) fires every
//     matching trigger, resolving its body and dispatching the DO,
//   • triggerWebhook(engine)              — an Express handler so a peer can PUSH events,
//   • serverDispatch({resolve,clientOpts}) — a default dispatch over weaveServerClient that
//     runs each per-user cross-app DO under the triggering user (G1 delegation).
// The engine is dispatch-agnostic (inject a mock to test) so the "what fires" logic is
// pure + provable; serverDispatch is the live wiring. Design-time TS shapes: ../trigger.ts.

const { weaveServerClient } = require('./serverClient')

function isBinding(v) { return v && typeof v === 'object' && !Array.isArray(v) && typeof v.from === 'string' }
function dig(obj, path) {
  if (!path) return obj
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/**
 * Resolve a DO body TEMPLATE against an event PAYLOAD: bindings ({from:'field'}) are
 * replaced with the payload value at that (dotted) path; literals pass through.
 * @param {Record<string, any>} template
 * @param {Record<string, any>} payload
 */
function resolveBindings(template, payload) {
  const out = {}
  for (const [k, v] of Object.entries(template || {})) out[k] = isBinding(v) ? dig(payload, v.from) : v
  return out
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
function validateTriggerTypes(trigger, { whenReturns = [], doBody = [] } = {}) {
  const issues = []
  const whenByName = new Map(whenReturns.map((f) => [f.name, f]))
  const doByName = new Map(doBody.map((f) => [f.name, f]))
  const body = (trigger.do && trigger.do.body) || {}
  for (const [field, v] of Object.entries(body)) {
    const target = doByName.get(field)
    if (!target) { issues.push({ field, msg: `DO '${trigger.do.capability}' has no body field '${field}'` }); continue }
    if (isBinding(v)) {
      const src = whenByName.get(String(v.from).split('.')[0])
      if (!src) { issues.push({ field, msg: `binding from '${v.from}' — WHEN '${trigger.when.capability}' returns no such field` }); continue }
      if (!String(v.from).includes('.') && !typeFits(src.type, target.type)) {
        issues.push({ field, msg: `type mismatch: ${trigger.when.capability}.${v.from} is '${src.type}' but ${trigger.do.capability}.${field} expects '${target.type}'` })
      }
    }
  }
  for (const f of doBody) {
    if (f.required && !(f.name in body)) issues.push({ field: f.name, msg: `required DO field '${f.name}' is unbound` })
  }
  return issues
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
      try {
        const r = await dispatch(t.do, body, { actingUser, trigger: t, event: { app, capability, payload } })
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
    return client[method](path, body)
  }
}

module.exports = { resolveBindings, validateTriggerTypes, createTriggerEngine, triggerWebhook, serverDispatch }
