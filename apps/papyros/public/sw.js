/*
 * PapyrOS service worker — app-shell caching, ONLINE-FIRST.
 *
 * This file is served from the app's own base path (e.g. "/papyros/sw.js" in the
 * path-based staging deploy, "/sw.js" on the root-domain deploy), so its default
 * registration scope is that same base directory. Every path below is written
 * relative to that scope — never a leading "/" — so this one file behaves the
 * same under both deploy shapes.
 *
 * ONLINE-FIRST means: always prefer a fresh network response, and only fall back
 * to whatever's cached when the network is unavailable. This is intentionally the
 * bare minimum for "installable" — it does NOT cache media. /api/stream (Range-
 * streamed audiobook audio) and every other /api/ route are bypassed unconditionally
 * below, both so Range requests reach the network untouched and so we never risk
 * caching a partial audio response. Real media/offline caching is Wave 7.
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `papyros-shell-${CACHE_VERSION}`

// The app shell entry, relative to this SW's own scope (== the app's base URL).
// We deliberately do NOT enumerate hashed build assets here — vite fingerprints
// them per build, so there's no stable filename to precache at authoring time.
// The shell document is enough to get the app running offline; it will re-request
// its own script/style tags, which fall through to the runtime asset cache below.
const SHELL_URL = './'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_URL))
  )
  // Take over from any previous SW as soon as this one finishes installing,
  // instead of waiting for every open tab of the old version to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('papyros-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only ever handle GET. Everything else (POST/PUT/DELETE — form submits,
  // playback-position writes, etc.) passes straight through untouched.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only ever handle same-origin requests — cross-origin (fonts.googleapis.com,
  // etc.) is left to the browser's own cache/network handling.
  if (url.origin !== self.location.origin) return

  // API requests: media routes get OFFLINE fallback service (Wave 7.3), the rest
  // pass straight through untouched. The online path inside serveMedia() is a bare
  // fetch(request) — Range headers and 200/206 semantics reach the network exactly
  // as if the SW weren't there; the Cache API is consulted ONLY when that fetch
  // itself rejects (offline). We still never WRITE media into a cache here — the
  // in-app download pipeline (src/offline/store.ts) is the only writer.
  if (url.pathname.includes('/api/')) {
    if (/\/api\/(stream|cover|book)\//.test(url.pathname)) {
      event.respondWith(serveMedia(request))
    }
    return
  }

  // Full-page navigations: network-first, falling back to the cached app shell
  // when offline so the SPA shell can still boot (client-side routing takes it
  // from there).
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
    return
  }

  // Everything else reaching here is a same-origin, non-API GET for a static
  // asset under the app's own scope (scripts/styles/fonts/images) — the browser
  // only ever delivers fetch events for requests within this SW's registration
  // scope, so no further path-matching is needed. Network-first, writing
  // successful responses through to the cache; a stale cached copy is used only
  // when the network fails.
  event.respondWith(networkFirstAsset(request))
})

/** Navigation fetch: fresh page from the network, cached shell as the offline fallback. */
async function networkFirstShell(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(CACHE_NAME)
    const shell = await cache.match(SHELL_URL, { ignoreSearch: true })
    if (shell) return shell
    throw new Error('papyros sw: offline and no cached shell available')
  }
}

/** Static asset fetch: fresh from the network (cached as a side effect), stale cache offline. */
async function networkFirstAsset(request) {
  try {
    const response = await fetch(request)
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

/* ── Wave 7.3: offline media routing ─────────────────────────────────────────
 * Online-first: a healthy network is a transparent pass-through. Offline, serve
 * from the media cache the download pipeline populated. MUST match
 * src/offline/constants.ts's MEDIA_CACHE — the two files cannot import each
 * other (this one is a plain public/ script), so the name is duplicated by
 * contract; change BOTH or neither.
 *
 * Range handling: the pipeline stores each audio file as ONE full-body 200
 * keyed by its bare stream URL. A Range request offline is answered by slicing
 * that body — Blob.slice() is lazy (disk-backed), so a 400MB audiobook never
 * materializes in memory. `ignoreSearch` lets a `?compat=N` request fall back
 * to the cached original when offline. */
const MEDIA_CACHE = 'papyros-media-v1'

async function serveMedia(request) {
  try {
    return await fetch(request)
  } catch (err) {
    const cache = await caches.open(MEDIA_CACHE)
    const cached = await cache.match(request.url, { ignoreSearch: true })
    if (!cached) throw err

    const rangeHeader = request.headers.get('range')
    if (!rangeHeader) return cached

    const blob = await cached.blob()
    const total = blob.size
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
    }
    let start, end
    if (m[1] === '') {
      start = Math.max(0, total - Number.parseInt(m[2], 10))
      end = total - 1
    } else {
      start = Number.parseInt(m[1], 10)
      end = m[2] === '' ? total - 1 : Math.min(Number.parseInt(m[2], 10), total - 1)
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
    }
    return new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }
}
