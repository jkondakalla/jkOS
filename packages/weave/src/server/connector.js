'use strict'
// weave/server/connector.js — the CONNECTOR primitive factory (Layer D / F2 + G2).
//
// `defineConnector(def)` turns a ConnectorDef (an upstream base + auth + an
// endpoint→contract mapping) into:
//   • .capabilities / .datasets — CLEAN Layer-A discovery docs (the upstream/map keys
//     stripped), so the connected API/device is discovered + bound EXACTLY like a
//     native app (the lego property — a GUI/AI can't tell it apart), and
//   • .mount(router, opts)      — routes that translate each call into the upstream
//     request SERVER-SIDE, so the upstream secret never reaches the browser.
// Before this, every external integration was bespoke backend code; now it is a spec.
//
// Zero extra deps (uses global fetch; the Express router is passed in). The upstream
// secret is read from auth.env (override with opts.token). Design-time TS shapes:
// ../connector.ts. Subpath: `@jkos/weave/connector`.

// Read a dotted path out of an object: dig({a:{b:1}}, 'a.b') === 1.
function dig(obj, path) {
  if (!path) return obj
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

// Map one upstream record → the declared wire row. A field listed in `map` is read
// from its dotted upstream path; the rest map by name. Only declared `item` fields
// appear, so the wire shape IS the documented one (no upstream leakage).
function mapItem(rec, item, map) {
  const out = {}
  for (const f of item) {
    const src = map && map[f.name] ? map[f.name] : f.name
    out[f.name] = dig(rec, src)
  }
  return out
}

// Strip the upstream/map plumbing → a clean DatasetDef the connector SERVES.
function cleanDataset(read) {
  const d = { id: read.id, label: read.label, path: `/${read.id}`, item: read.item }
  if (read.filters) d.filters = read.filters
  if (read.scopes) d.scopes = read.scopes
  return d
}

// Strip plumbing → a clean CapabilityDef.
function cleanCapability(action) {
  const c = {
    id: action.id, label: action.label, method: action.method,
    path: action.path || `/${action.id}`,
  }
  if (action.body) c.body = action.body
  if (action.returns) c.returns = action.returns
  if (action.invalidates) c.invalidates = action.invalidates
  if (action.scopes) c.scopes = action.scopes
  return c
}

/**
 * @param {import('../connector').ConnectorDef} def
 * @returns {import('../connector').Connector}
 */
function defineConnector(def) {
  if (!def || typeof def !== 'object') throw new Error('defineConnector: a ConnectorDef is required')
  if (!def.app || !def.id) throw new Error('defineConnector: def.app and def.id are required')
  if (!def.base || typeof def.base !== 'string') throw new Error(`defineConnector('${def.id}'): def.base (upstream URL) is required`)
  const reads = Array.isArray(def.reads) ? def.reads : []
  const actions = Array.isArray(def.actions) ? def.actions : []

  const datasets = reads.map(cleanDataset)
  const capabilities = actions.map(cleanCapability)

  function mount(router, opts = {}) {
    const doFetch = opts.fetch || globalThis.fetch
    if (typeof doFetch !== 'function') throw new Error('defineConnector.mount: no fetch available (pass opts.fetch)')
    const base = (opts.base || def.base).replace(/\/$/, '')
    const basePath = opts.basePath || '/api'
    const auth = def.auth || { kind: 'none' }
    const token = opts.token != null ? opts.token : (auth.env ? process.env[auth.env] : undefined)

    // Build the upstream auth (headers + query additions) once.
    function authParts() {
      const headers = { ...(opts.headers || {}) }
      const query = {}
      if (token) {
        if (auth.kind === 'bearer') headers['Authorization'] = `Bearer ${token}`
        else if (auth.kind === 'header') headers[auth.header || 'Authorization'] = token
        else if (auth.kind === 'query') query[auth.param || 'apikey'] = token
      }
      return { headers, query }
    }

    function upstreamUrl(path, extraQuery) {
      const u = new URL(base + path)
      for (const [k, v] of Object.entries(extraQuery || {})) if (v != null && v !== '') u.searchParams.set(k, String(v))
      return u
    }

    const fail = (res, e, status = 502) => {
      console.error(`[${def.app}.${def.id}]`, e?.stack || e?.message || e)
      return res.status(status).json({ error: 'Upstream request failed', code: 'UPSTREAM_ERROR' })
    }

    // reads → GET routes
    for (const read of reads) {
      router.get(`${basePath}/${read.id}`, async (req, res) => {
        try {
          const { headers, query } = authParts()
          // static upstream query + the declared filters passed through from req.query
          const passthrough = {}
          for (const f of read.filters || []) if (req.query[f.name] != null) passthrough[f.name] = req.query[f.name]
          const url = upstreamUrl(read.upstream.path, { ...(read.upstream.query || {}), ...passthrough, ...query })
          const r = await doFetch(url, { method: read.upstream.method || 'GET', headers })
          if (!r.ok) return fail(res, new Error(`upstream ${r.status}`))
          const data = await r.json()
          const arr = read.collection ? dig(data, read.collection) : data
          const rows = Array.isArray(arr) ? arr : []
          res.json(rows.map((rec) => mapItem(rec, read.item, read.map)))
        } catch (e) { fail(res, e) }
      })
    }

    // actions → write routes
    for (const action of actions) {
      const method = (action.method || 'POST').toLowerCase()
      router[method](`${basePath}${action.path || `/${action.id}`}`, async (req, res) => {
        try {
          const { headers, query } = authParts()
          // substitute :params in the upstream path from the body
          const body = req.body || {}
          const path = String(action.upstream.path).replace(/:(\w+)/g, (_, k) => encodeURIComponent(String(body[k] ?? '')))
          // build the upstream body: wireField → upstream key (omitted map → same name)
          let upstreamBody
          if (action.method !== 'DELETE') {
            upstreamBody = {}
            for (const f of action.body || []) {
              const k = action.map && action.map[f.name] ? action.map[f.name] : f.name
              if (body[f.name] !== undefined) upstreamBody[k] = body[f.name]
            }
          }
          const url = upstreamUrl(path, query)
          const r = await doFetch(url, {
            method: action.upstream.method || action.method,
            headers: { ...headers, ...(upstreamBody ? { 'Content-Type': 'application/json' } : {}) },
            body: upstreamBody ? JSON.stringify(upstreamBody) : undefined,
          })
          let out = null
          try { out = await r.json() } catch { /* empty/non-JSON */ }
          if (!r.ok) return fail(res, new Error(`upstream ${r.status}`))
          res.status(action.method === 'POST' ? 201 : 200).json(out ?? { ok: true })
        } catch (e) { fail(res, e) }
      })
    }
  }

  return { app: def.app, id: def.id, capabilities, datasets, mount }
}

module.exports = { defineConnector }
