'use strict'
// weave/server/serverClient.js — the headless peer path (backend → backend).
//
// The server-side twin of the browser weaveClient: a backend (cron, agent,
// webhook) calls a peer's API WITHOUT a user cookie. It mints + caches a service
// token via jkAuth's client-credentials grant (POST /auth/token) and presents it
// as `Authorization: Bearer`, auto-refreshing once on a 401.
//
// Limit (by design): a service token has no human user, so peers reject it on
// per-user writes (weaveWriteGate → NO_USER_CONTEXT). This client is therefore
// read/aggregate-capable today; per-user writes await the on-behalf-of delegation
// seam (see WEAVE.md). Targets the peer's public origin over TLS; an internal-DNS
// fast path is a later optimisation.
//
// Config (opts or env): JKOS_AUTH_URL, JKOS_SERVICE_CLIENT_ID,
// JKOS_SERVICE_CLIENT_SECRET. baseUrl may be passed to skip registry discovery.

function weaveServerClient(appId, opts = {}) {
  const authUrl = (opts.authUrl || process.env.JKOS_AUTH_URL || 'https://auth.jkos.net').replace(/\/$/, '')
  const clientId = opts.clientId || process.env.JKOS_SERVICE_CLIENT_ID
  const clientSecret = opts.clientSecret || process.env.JKOS_SERVICE_CLIENT_SECRET
  const scope = opts.scope // optional: clamp the minted token to a subset
  let baseUrl = opts.baseUrl ? String(opts.baseUrl).replace(/\/$/, '') : null

  let token = null
  let tokenExp = 0
  let minting = null   // in-flight mint, so concurrent calls share ONE token request

  async function mint() {
    if (!clientId || !clientSecret) {
      throw new Error('weaveServerClient: JKOS_SERVICE_CLIENT_ID and JKOS_SERVICE_CLIENT_SECRET are required')
    }
    const r = await fetch(`${authUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...(scope ? { scope } : {}) }),
    })
    if (!r.ok) throw new Error(`weaveServerClient: token mint failed (${r.status})`)
    const d = await r.json()
    token = d.access_token
    // refresh 30s before expiry; the grant currently issues 600s tokens
    tokenExp = Date.now() + ((Number(d.expires_in) || 600) * 1000) - 30_000
    return token
  }

  async function getToken() {
    if (token && Date.now() < tokenExp) return token
    // Coalesce concurrent mints (e.g. a burst of peer calls after a cold start or
    // a 401 refresh) into a single /auth/token round-trip.
    if (!minting) minting = mint().finally(() => { minting = null })
    return minting
  }

  // Resolve the peer's reachable API root. baseUrl wins; otherwise discover the
  // app's public origin from the registry and use `<origin>/api`.
  async function resolveBase() {
    if (baseUrl) return baseUrl
    const r = await fetch(`${authUrl}/auth/apps`, { headers: { Authorization: `Bearer ${await getToken()}` } })
    if (!r.ok) throw new Error(`weaveServerClient: registry fetch failed (${r.status})`)
    const d = await r.json()
    const app = (d.apps || d || []).find(a => a && a.id === appId)
    if (!app || !app.origin) throw new Error(`weaveServerClient: no origin for app '${appId}'`)
    baseUrl = `${String(app.origin).replace(/\/$/, '')}/api`
    return baseUrl
  }

  async function request(method, path, body) {
    const base = await resolveBase()
    const send = (tok) => fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tok}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let r = await send(await getToken())
    if (r.status === 401) { token = null; r = await send(await getToken()) } // refresh once
    let data = null
    try { data = await r.json() } catch { /* empty / non-JSON */ }
    return {
      ok: r.ok,
      status: r.status,
      data: r.ok ? data : undefined,
      error: r.ok ? undefined : ((data && data.error) || `HTTP ${r.status}`),
    }
  }

  return {
    get:    (path) => request('GET', path),
    post:   (path, body) => request('POST', path, body),
    patch:  (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
    token:  getToken, // expose for callers that need the raw bearer
  }
}

module.exports = { weaveServerClient }
