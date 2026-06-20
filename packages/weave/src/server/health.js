'use strict'
// weave/server/health.js — the one health-probe shape, { status:'ok', service }.
// The portal's systems panel probes /health/<app>; a uniform payload means one
// reader handles every app.

/** @param {string} service the app id reported in the payload. */
function healthHandler(service) {
  return (_req, res) => res.json({ status: 'ok', service })
}

module.exports = { healthHandler }
