/*
 * KourOS service worker — APP SHELL ONLY, online-first.
 *
 * This file is served from the app's own base path ("/sw.js" on the prod
 * subdomain, "/kouros/sw.js" under the staging subpath), so its registration
 * scope is that same directory. EVERY path below is relative — never a leading
 * "/" — which is the one property that lets one file serve both deploy shapes.
 * (Same reasoning as apps/papyros/public/sw.js, which this follows.)
 *
 * WHAT IT IS FOR: making the installed app open instantly and fail honestly.
 * Launched from the home screen with no signal, a TWA with no service worker
 * shows the browser's own error page inside what is supposed to be an app. With
 * one, the shell boots from cache and the app's own empty states explain
 * themselves. That is the whole ambition here.
 *
 * ⚠️ THREE RULES THIS FILE MUST NOT BREAK.
 *
 * 1. NEVER TOUCH /api/. Audio is Range-served (206 + Content-Range) by
 *    @jkos/weave/mediaRoutes, and a service worker that intercepts a Range
 *    request without reproducing those semantics exactly will break seeking, or
 *    cache a partial body and serve it as if it were whole. Covers and streams
 *    both pass through untouched. KourOS streams by design — offline downloads
 *    are a separate feature with a separate cache, not something to fall into
 *    by accident here.
 *
 * 2. NEVER RESURRECT A HASHED ASSET THAT THE SERVER 404s. serveSpa
 *    (packages/weave/src/server/spa.js) deliberately answers a MISSING
 *    /assets/* with 404 instead of falling through to index.html, because the
 *    alternative is a stale shell being handed HTML for its scripts and
 *    rendering a blank page under a correct <title>. Only `response.ok` is
 *    written to the cache below, so a 404 is never stored; and a 404 arriving
 *    from a healthy network is returned as-is rather than being patched from
 *    cache. Losing that rule reintroduces the silent blank page.
 *
 * 3. NEVER STRIP CREDENTIALS. <audio src> and <img src> are plain same-origin
 *    URLs that work because the browser attaches the jkos_token cookie itself.
 *    Everything here either passes the original Request through untouched or
 *    replays it as-is, so the cookie rides along.
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `kouros-shell-${CACHE_VERSION}`

// The shell entry, relative to this SW's scope (== the app's base URL). Hashed
// build assets are deliberately NOT precached: vite fingerprints them per build,
// so there is no stable name to enumerate at authoring time. The shell is enough
// to boot; its own <script>/<link> tags then fall through to the runtime cache.
const SHELL_URL = './'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_URL)))
  // Replace a previous worker immediately rather than waiting for every tab of
  // the old version to close — an installed app is usually exactly one tab.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('kouros-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // GET only. Every write — history, ratings, playlists — passes straight
  // through; queueing those offline is a separate feature with its own storage.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Same-origin only. Google Fonts and anything else cross-origin is left to
  // the browser's own handling.
  if (url.origin !== self.location.origin) return

  // RULE 1: the API is never touched — audio Range semantics above all.
  if (url.pathname.includes('/api/')) return

  // Full-page navigations: fresh from the network, cached shell when offline so
  // the SPA can boot and route client-side from there.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
    return
  }

  // Everything left is a same-origin, non-API GET for a static asset inside this
  // worker's scope. The browser only delivers fetch events for in-scope requests,
  // so no further matching is needed.
  event.respondWith(networkFirstAsset(request))
})

/** Navigation: fresh page, cached shell as the offline fallback. */
async function networkFirstShell(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(CACHE_NAME)
    const shell = await cache.match(SHELL_URL, { ignoreSearch: true })
    if (shell) return shell
    throw new Error('kouros sw: offline and no cached shell available')
  }
}

/** Static asset: fresh from the network (written through), stale cache offline. */
async function networkFirstAsset(request) {
  try {
    const response = await fetch(request)
    // RULE 2: only a real response is cached. A 404 for a hashed asset is the
    // server telling the truth about a stale shell — store it and the lie
    // becomes permanent; patch it from cache and the blank page comes back.
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch (err) {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    throw err
  }
}
