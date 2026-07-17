'use strict'
// weave/server/health.js — the one health-probe shape, { status:'ok', service }.
// The portal's systems panel probes /health/<app>; a uniform payload means one
// reader handles every app.
//
// `details` is the opt-in seam for an app that has MORE to say than up/down. The
// uniform keys are always present and always first, so the shared reader keeps
// working; an app that adds keys is adding to the payload, never reshaping it.
// LazurOS uses it to report `compute_online` (its GPU node may be asleep — a warn,
// not a fault), which the ORDECK systems panel already reads.

/**
 * @param {string} service the app id reported in the payload.
 * @param {() => (object | Promise<object>)} [details] optional extra fields to merge in.
 *        Must be cheap and must not throw — a health probe that hangs or 500s is worse
 *        than one that says less, so a failing `details` degrades to the uniform payload.
 */
function healthHandler(service, details) {
  return async (_req, res) => {
    let extra = {}
    if (details) {
      try { extra = (await details()) || {} }
      catch (e) { console.warn(`[health] ${service}: details() failed, reporting base payload — ${e.message}`) }
    }
    res.json({ status: 'ok', service, ...extra })
  }
}

module.exports = { healthHandler }
