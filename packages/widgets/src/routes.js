// routes.js — a page widget's `route`, and the one way a path is matched to it or built.
//
// A widget with `"route": "/books/:id"` is a PAGE: a host that routes (KourOS, from phase
// 5 of the rescope) draws it when the location matches, with `$route.id` in its scope. A
// `go` action builds a path from a route and its params. Both directions are here, once,
// so a host's router and the renderer cannot disagree about what `/books/:id` means.
//
// The route table is DERIVED from the files — each page says its own route — never a
// list typed somewhere else that could drift from them.

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/
const PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)$/

/** Why `route` is not a route pattern, or null when it is: '/', or '/'-separated
 *  segments, each a lowercase literal or a `:param`, no param twice, no trailing '/'. */
export function routeProblem(route) {
  if (typeof route !== 'string' || !route.startsWith('/')) return 'a route is a path starting with "/" ("/books/:id")'
  if (route.length > 200) return 'a route is at most 200 characters'
  if (route === '/') return null
  const segs = route.slice(1).split('/')
  const seen = new Set()
  for (const s of segs) {
    const p = s.match(PARAM)
    if (p) {
      if (seen.has(p[1])) return `the param :${p[1]} appears twice`
      seen.add(p[1])
    } else if (!SEGMENT.test(s)) {
      return s === '' ? 'a route has no empty segment (and no trailing "/")' : `"${s}" is not a segment — a lowercase literal or a :param`
    }
  }
  return null
}

/** The `:params` a route pattern names, in order. */
export function routeParams(route) {
  return typeof route === 'string' ? [...route.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]) : []
}

/** Match a location path against a route pattern: its params (decoded), or null. The
 *  query and hash are ignored, and so is one trailing '/'. */
export function matchRoute(route, path) {
  const clean = String(path).split(/[?#]/)[0].replace(/(.)\/$/, '$1')
  const a = route === '/' ? [] : route.slice(1).split('/')
  const b = clean === '/' ? [] : clean.replace(/^\//, '').split('/')
  if (a.length !== b.length) return null
  const params = {}
  for (let i = 0; i < a.length; i++) {
    const p = a[i].match(PARAM)
    if (p) {
      let v
      try { v = decodeURIComponent(b[i]) } catch { return null }
      if (!v) return null
      params[p[1]] = v
    } else if (a[i] !== b[i]) return null
  }
  return params
}

/** Build a path from a route pattern and its params (each encoded), or null when one is
 *  missing — a `go` never navigates to "/books/undefined". */
export function fillRoute(route, params = {}) {
  let missing = false
  const path = String(route).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => {
    const v = params[k]
    if (v == null || v === '') { missing = true; return '' }
    return encodeURIComponent(String(v))
  })
  return missing ? null : path
}

/**
 * The route table of a set of widget defs (one app's): route → page id, plus every
 * conflict — two pages that answer the same route, or patterns that match the same
 * paths (`/books/:id` and `/books/:slug`).
 * @param {{ id: string, route?: string }[]} defs
 */
export function routeTable(defs) {
  const routes = new Map()
  const problems = []
  const shape = (r) => r.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':')
  const byShape = new Map()
  for (const d of defs) {
    if (!d || typeof d.route !== 'string') continue
    const other = byShape.get(shape(d.route))
    if (other) problems.push(`${d.id} (${d.route}) and ${other.id} (${other.route}) answer the same paths`)
    else byShape.set(shape(d.route), d)
    routes.set(d.route, d.id)
  }
  return { routes, problems }
}

/** The page a location shows: { route, id, params } — a host's router, over routeTable's
 *  routes — or null. The most literal route wins (`/books/new` over `/books/:id`), so
 *  the answer never depends on the order the files were read in. */
export function pageFor(routes, path) {
  const ranked = [...routes].sort(([a], [b]) => routeParams(a).length - routeParams(b).length || a.localeCompare(b))
  for (const [route, id] of ranked) {
    const params = matchRoute(route, path)
    if (params) return { route, id, params }
  }
  return null
}
