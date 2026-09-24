'use strict'
// weave/server/serverClient.js — the headless peer path (backend → backend).
//
// The server-side twin of the browser weaveClient: a backend (cron, agent,
// webhook) calls a peer's API WITHOUT a user cookie. It mints + caches a service
// token via jkAuth's client-credentials grant (POST /auth/token) and presents it
// as `Authorization: Bearer`, auto-refreshing once on a 401.
//
// Without `actingUser` a service token has no human user, so peers reject it on
// per-user writes (weaveWriteGate → NO_USER_CONTEXT) — read/aggregate only. Pass
// `actingUser` (G1) and, IF this client is delegation-enrolled in jkAuth, the minted
// token carries an `act` claim so per-user writes commit AS that user. One client
// instance acts for one user; the trigger engine makes a client per acting user.
// Targets the peer's public origin over TLS; an internal-DNS fast path is later.
//
// Config (opts or env): JKOS_AUTH_URL, JKOS_SERVICE_CLIENT_ID,
// JKOS_SERVICE_CLIENT_SECRET. baseUrl may be passed to skip registry discovery.
//
// ⚠️ `actingZone` GOES WITH `actingUser`, and the pair is why it exists (D5 + G1).
// authFetch stamps X-JKOS-TZ on every BROWSER request, so `callerDay(req)` answers in
// the user's own day. This path is not a browser and stamped nothing, so a delegated
// write — a token whose `act` names a real human — arrived with no zone and
// `callerDay` fell back to the UTC day. That fallback is right for a peer reading on
// its OWN behalf (no user, so no local day) and wrong the moment there is an acting
// user, because then the day IS knowable and the server quietly picks a different one.
//
// It is not cosmetic. BB-1 deliberately opened BeigeBoard's routine reconcile to
// service callers, so a LazurOS write-back rolls that user's horizon — and east of
// Greenwich, between local midnight and UTC midnight, it rolled it against YESTERDAY
// and minted an occurrence the user had already lived through. That is BB-10, which
// D5 closed for browsers and left open on exactly the path D11 had just enabled.
// It also defeats `ensureHorizon`'s once-per-user-per-day memo: a service caller and
// a browser caller straddling UTC midnight disagree about "today", so the marker
// flips back and forth and every read does a full horizon pass.
//
// The caller supplies it because the caller is the one who knows: LazurOS captures
// `callerZone(req)` onto the job at enqueue — the zone of the request that ASKED for
// the work — and hands it back when the result is committed.

const { CALLER_ZONE_HEADER, isZone } = require('./callerDay')

/** Assert at BOOT that a delegated-write client is actually provisioned (WV-1 /
 *  D11).
 *
 *  ⚠️ Without this the failure is DEFERRED to the first delegated write, in
 *  production, and presents as a job that failed for an unrelated-looking
 *  reason. `POST /auth/token` 503s unless jkAuth has JKOS_SERVICE_CLIENTS set,
 *  and that variable appeared in no compose file — so LazurOS's write-back, the
 *  whole G1 seam, threw on first call in every deployed environment while every
 *  test passed, because tests inject a fake client.
 *
 *  An app that NEEDS a service client calls this where it starts up. In
 *  production a missing credential is fatal; elsewhere it warns, so a dev
 *  checkout still boots without secrets. */
function assertServiceClientProvisioned(who = 'this app') {
  const missing = ['JKOS_SERVICE_CLIENT_ID', 'JKOS_SERVICE_CLIENT_SECRET']
    .filter((k) => !process.env[k])
  if (!missing.length) return true
  const msg = `[weave] ${who} performs delegated writes but ${missing.join(' and ')} `
    + `${missing.length > 1 ? 'are' : 'is'} not set — POST /auth/token would 503 and every `
    + 'write-back would fail at request time. See Documentation/TODO.md (service-client secrets).'
  if (process.env.NODE_ENV === 'production') {
    console.error(msg.replace('[weave]', '[weave] FATAL:'))
    process.exit(1)
  }
  console.warn(msg)
  return false
}

function weaveServerClient(appId, opts = {}) {
  const authUrl = (opts.authUrl || process.env.JKOS_AUTH_URL || 'https://auth.jkos.net').replace(/\/$/, '')
  const clientId = opts.clientId || process.env.JKOS_SERVICE_CLIENT_ID
  const clientSecret = opts.clientSecret || process.env.JKOS_SERVICE_CLIENT_SECRET
  const scope = opts.scope // optional: clamp the minted token to a subset
  const actingUser = opts.actingUser != null && String(opts.actingUser) !== '' ? String(opts.actingUser) : null
  /* Validated here rather than trusted: a stored zone can be stale, hand-edited, or
     from a runtime with different ICU data. An unusable one is DROPPED, which lands
     back on the UTC fallback — the same answer as before, never a broken header. */
  const actingZone = isZone(opts.actingZone) ? String(opts.actingZone).trim() : null
  if (opts.actingZone && !actingZone) {
    console.warn(`[weave] serverClient(${appId}): ignoring unusable actingZone `
      + `${JSON.stringify(opts.actingZone)} — falling back to the UTC day`)
  }
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
      body: JSON.stringify({
        client_id: clientId, client_secret: clientSecret,
        ...(scope ? { scope } : {}),
        ...(actingUser ? { on_behalf_of: actingUser } : {}),
      }),
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
      headers: {
        Authorization: `Bearer ${tok}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // D5: the acting user's day, not the container's. See the header.
        ...(actingZone ? { [CALLER_ZONE_HEADER]: actingZone } : {}),
      },
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

module.exports = { weaveServerClient, assertServiceClientProvisioned }
