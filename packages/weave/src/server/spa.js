'use strict'
// serveSpa — the ONE way a jkOS backend hands its built frontend to a browser.
//
// Every SPA server in the suite had grown the same two lines: express.static over
// the build directory, then `app.get('*')` → index.html so client-side routes
// deep-link. That pairing has a failure mode nobody sees until a redeploy.
//
// A Vite build names its output by content hash, and index.html is the only file
// that knows the current names. Served with nothing but a Last-Modified, index.html
// is freely cacheable: a browser may reuse yesterday's copy — the one naming
// yesterday's hashes — against today's container. Every asset it asks for is gone,
// so the `*` fallback answers each one with the HTML shell, at 200. The browser
// asked for a module and got `<!DOCTYPE`, refuses it on MIME, and the page renders
// NOTHING: a blank body under a perfectly correct <title>, no error on screen, and
// in the network panel a column of 200s. Nothing anywhere says "stale".
//
// (Found 2026-08-17: staging.jkos.net/ was a blank ORDECK for exactly this, while
// the same shell reached by a different path came up fine — that URL simply had no
// cache entry to be stale.)
//
// Two rules close it for good:
//   · The entry document is revalidated on every load (`no-cache` — stored, but
//     never used without asking), so a deploy lands on the next navigation rather
//     than whenever heuristic freshness happens to lapse. It still 304s, so the
//     cost is one conditional request.
//   · Hashed assets are immutable and FATAL when missing: /assets/* never falls
//     through to the shell, so a mismatch is a loud 404 in the console instead of
//     a silent blank screen.
//
// The nginx-served SPAs (the ORDECK shell) carry the same two rules in their own
// nginx.conf — same doctrine, different dialect, since no Express runs there.

const path = require('path')

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

/**
 * Serve a built SPA from `staticDir`: hashed assets, then the client-side-route
 * fallback. Mount AFTER every API route (the fallback swallows everything left).
 *
 * `express` is INJECTED, not required: no brick in @jkos/weave/server depends on a
 * web framework (see mediaRoutes) — the app owns that choice and already has the
 * module in scope. Nothing here is express-specific beyond `express.static`.
 *
 * @param {import('express').Express} app
 * @param {string} staticDir  the Vite build output directory
 * @param {{ express: any, assetsDir?: string }} opts
 *        express  — the caller's express module (for express.static)
 *        assetsDir — build subdir holding the hashed output (default 'assets')
 */
function serveSpa(app, staticDir, { express, assetsDir = 'assets' } = {}) {
  if (!express?.static) throw new Error('serveSpa: pass the express module — serveSpa(app, dir, { express })')
  const assetsPrefix = assetsDir + path.sep

  app.use(express.static(staticDir, {
    // index.html comes from the fallback below, so its headers are set in ONE
    // place instead of two that can disagree.
    index: false,
    setHeaders(res, filePath) {
      const rel = path.relative(staticDir, filePath)
      res.setHeader('Cache-Control', rel.startsWith(assetsPrefix) ? IMMUTABLE : REVALIDATE)
    },
  }))

  // A hashed asset that got this far does not exist. Say so — the whole point is
  // that this request must never be answered with HTML.
  app.get(`/${assetsDir}/*`, (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Client-side routes: any remaining GET is a route the SPA owns.
  app.get('*', (_req, res) => {
    res.set('Cache-Control', REVALIDATE)
    res.sendFile(path.join(staticDir, 'index.html'), err => {
      if (err) res.status(404).json({ error: 'Not found' })
    })
  })
}

module.exports = { serveSpa }
