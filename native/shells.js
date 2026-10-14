'use strict'
// native/shells.js — THE single source of truth for jkOS's native shells.
//
// A "shell" is an installable app that shows the suite: an Android APK or a Linux desktop
// window. One row per shell in SHELLS. Everything else DERIVES from it:
//   • the Android build's flavors + per-variant resources   (gen-native.mjs → native/android/…)
//   • the desktop app's origin list                          (gen-native.mjs → native/desktop/src/shells.json)
//   • the release signing script's asset-links entries       (native/android/signing.mjs)
//   • the edge's asset-links coverage check                  (infra/nginx/gen-nginx-weave.mjs --check)
//
// ⚠️ EVERY SHELL LOADS THE LIVE SITE AT ITS REAL ORIGIN. None bundles a copy of a frontend.
// A bundled app runs at a local origin (`capacitor://localhost`, `file://`), where the
// `.jkos.net` session cookie never flows, the CORS-free peer proxy is cross-origin, and
// jkAuth's cookie-only user tokens do not work. Keeping the real origin means auth needs zero
// changes — which is the whole reason Capacitor was rejected for KourOS (OPERATIONS.md).
//
// THE TRUST BOUNDARY IS THE ORIGIN LIST. A shell keeps a navigation inside itself only if it
// lands on one of its `origins`; anything else goes to the system browser (the Android TWAs,
// the desktop shell) or is refused (the home launcher, which is a kiosk). An origin list is
// therefore a grant, and each is DERIVED here from @jkos/suite-manifest rather than typed —
// adding an app to the suite reaches the shells that take `reach: 'suite'` with no edit here.
//
// Zero deps, CJS, no build step, no env, no network — safe to require() anywhere, like
// suite-manifest itself.

const { APPS } = require('../packages/suite-manifest/apps.js')

/** Semver of every shell. versionCode (Android) is derived from it; the desktop package's own
 *  version must equal it (check:native asserts it). Bump it for every build you install. */
const VERSION = '0.1.0'

/** A debug build is a staging build: it points at staging.jkos.net and installs BESIDE the
 *  release app instead of over it. */
const STAGING_SUFFIX = '.staging'

/**
 * kind (android):
 *   'twa'  — a Trusted Web Activity: Chrome renders the origin with its URL bar removed.
 *            Chrome owns the cookies, the media notification and the lock-screen controls.
 *            No app code runs next to the page, so there is no bridge to attack.
 *   'home' — a home-screen replacement (Android's HOME intent): our own WebView, so it can
 *            stay up with the network down and hide the device's apps behind a gesture. The
 *            one shell with native code beside the page, so the one with a bridge
 *            (origin-scoped to `start` only — see NATIVE.md).
 *   'native' — the start app rebuilt as a NATIVE Android app (Kotlin + Compose), in the
 *            module named after it (native/android/<start>/). No web page at all: it signs in
 *            through jkAuth's native flow (RFC 8252 — the system browser + PKCE, a revocable
 *            device token) and calls the app's API with a Bearer token. `reach` is unused:
 *            it trusts no origin to render, it only calls its API origin and jkAuth.
 *
 * start      the app the shell opens on (a suite-manifest id).
 * reach      'suite' — every suite app with its own production origin (derived, below);
 *            or an explicit list of app ids. jkAuth is always added: sign-in is a
 *            full-page redirect to auth.jkos.net, and a shell that refused it could never
 *            sign in.
 * shortcuts  (TWA only) 'suite' — a long-press launcher shortcut to every other reachable app.
 * desktop    also ship a Linux desktop build of this shell.
 * channel    (optional) 'alpha' — a pre-release build: its versionName carries the channel
 *            (0.1.0-alpha) and the app says so on its own screen.
 */
const SHELLS = [
  {
    id: 'jkos', name: 'jkOS', package: 'net.jkos.app',
    start: 'ordeck', reach: 'suite', shortcuts: 'suite',
    android: 'twa', desktop: true,
  },
  {
    // KourOS is part of jkOS AND its own app — Plex and Plexamp. Its own launcher icon, its own
    // entry in recents, and kouros.jkos.net links open here rather than in the portal.
    id: 'kouros', name: 'KourOS', package: 'net.jkos.kouros',
    start: 'kouros', reach: [],
    android: 'twa', desktop: true,
  },
  {
    // ORDECK as a home panel (a wall/kitchen/bedside device). Kiosk: the device's own apps
    // sit behind a long-press, meant to keep guests out — not an attacker holding the device.
    id: 'home', name: 'jkOS Home', package: 'net.jkos.home',
    start: 'ordeck', reach: 'suite',
    android: 'home',
  },
  {
    // KourOS as a native phone app — the first app rebuilt natively, for testing. It installs
    // beside the KourOS TWA (its own package), so the two can be compared on one phone.
    id: 'kouros-alpha', name: 'KourOS Alpha', package: 'net.jkos.kouros.alpha',
    start: 'kouros', reach: [],
    android: 'native', channel: 'alpha',
  },
]

/* ── derivations ────────────────────────────────────────────────────────────── */

const byId = new Map(APPS.map((a) => [a.id, a]))
const STAGING_ORIGIN = byId.get('staging').origin

function app(id) {
  const a = byId.get(id)
  if (!a) throw new Error(`native/shells.js: unknown suite app '${id}'`)
  if (!a.origin) throw new Error(`native/shells.js: suite app '${id}' has no browsable origin`)
  return a
}

/** Origin of a URL string, e.g. 'https://staging.jkos.net/deploy/' → 'https://staging.jkos.net'. */
const originOf = (url) => new URL(url).origin

/** Suite apps with their OWN production origin — not origin-less (LazurOS), not the staging
 *  shell, and not an app that lives under the staging origin (jkDeploy). The set a
 *  `reach: 'suite'` shell may keep inside itself. */
function suiteApps() {
  return APPS.filter((a) => a.origin && originOf(a.origin) !== STAGING_ORIGIN)
}

/** Where an app sits on staging.jkos.net: the portal at '/', every other app at '/<id>/'.
 *  check:native holds each path to a real `location /<id>/` in the staging server block. */
function stagingPathOf(id) {
  return id === 'ordeck' ? '/' : `/${id}/`
}

/** Where a shell in `env` opens app `id`: its production origin, or its staging path. */
function urlOf(id, env) {
  return env === 'debug' ? STAGING_ORIGIN + stagingPathOf(id) : app(id).origin.replace(/\/?$/, '/')
}

/** The app ids a shell reaches, jkAuth included, start first, no duplicates. */
function reachIds(shell) {
  const ids = shell.reach === 'suite' ? suiteApps().map((a) => a.id) : [...shell.reach]
  return [...new Set([shell.start, 'auth', ...ids])]
}

/** Integer versionCode from VERSION: 1.2.3 → 10203. Monotonic as long as minor/patch < 100. */
function versionCode(v = VERSION) {
  const [maj, min, pat] = v.split('.').map(Number)
  if (![maj, min, pat].every((n) => Number.isInteger(n) && n >= 0 && n < 100)) {
    throw new Error(`native/shells.js: VERSION '${v}' is not a plain x.y.z with parts < 100`)
  }
  return maj * 10000 + min * 100 + pat
}

/**
 * Everything one shell needs in one environment.
 *   env 'release' → production origins;  env 'debug' → staging.jkos.net, `.staging` package.
 * Returns { applicationId, name, startUrl, host, origins[], bridgeOrigin, shortcuts[] }.
 */
function shellConfig(shell, env) {
  if (env !== 'release' && env !== 'debug') throw new Error(`native/shells.js: env '${env}'`)
  const staging = env === 'debug'
  const url = (id) => urlOf(id, env)
  const startUrl = url(shell.start)
  const origins = [...new Set(reachIds(shell).map((id) => originOf(url(id))))]
  const shortcuts = shell.shortcuts === 'suite'
    ? reachIds(shell).filter((id) => id !== shell.start && id !== 'auth')
      .map((id) => ({ id, name: app(id).name, url: url(id) }))
    : []
  return {
    applicationId: shell.package + (staging ? STAGING_SUFFIX : ''),
    name: shell.name + (staging ? ' (staging)' : ''),
    startUrl,
    host: new URL(startUrl).host,
    origins,
    // Only the page the shell opens on may talk to native code — never jkAuth, never a peer.
    bridgeOrigin: originOf(startUrl),
    shortcuts,
  }
}

const androidShells = () => SHELLS.filter((s) => s.android)
const desktopShells = () => SHELLS.filter((s) => s.desktop)
/** Android shells that open origins in a Trusted Web Activity — what Chrome verifies against
 *  assetlinks.json, so what signing.mjs lists and what the edge must serve asset links for. */
const twaLaunchers = () => SHELLS.filter((s) => s.android === 'twa')

/** Where a native app's sign-in returns: a private-use URI scheme named after its package
 *  (RFC 8252 §7.1). jkAuth accepts exactly this URI for exactly this client id. */
const NATIVE_REDIRECT_PATH = ':/oauth2redirect'

/**
 * What a native shell needs in one environment — and what jkAuth needs to know about it.
 *   apiBase     the start app's API root, without a trailing slash; requests go to
 *               `${apiBase}/api/...` (staging: https://staging.jkos.net/kouros)
 *   authOrigin  the jkAuth that signs it in (staging: https://staging.jkos.net)
 *   clientId    its OAuth client id — the package, so one install is one client
 *   redirectUri `${clientId}:/oauth2redirect`
 */
function nativeConfig(shell, env) {
  if (shell.android !== 'native') throw new Error(`native/shells.js: '${shell.id}' is not a native shell`)
  const cfg = shellConfig(shell, env)
  return {
    applicationId: cfg.applicationId,
    name: cfg.name,
    app: shell.start,
    apiBase: cfg.startUrl.replace(/\/$/, ''),
    authOrigin: originOf(urlOf('auth', env)),
    clientId: cfg.applicationId,
    redirectUri: cfg.applicationId + NATIVE_REDIRECT_PATH,
  }
}

/** jkAuth's native client registry, by jkAuth environment: a staging (debug) build signs in
 *  against staging jkAuth only, a release build against production only. */
function nativeClients() {
  const native = SHELLS.filter((s) => s.android === 'native')
  const rows = (env) => native.map((s) => {
    const c = nativeConfig(s, env)
    return { client_id: c.clientId, redirect_uri: c.redirectUri, name: c.name, app: c.app }
  })
  return { production: rows('release'), staging: rows('debug') }
}

module.exports = {
  VERSION, STAGING_SUFFIX, SHELLS,
  shellConfig, versionCode, stagingPathOf, reachIds, suiteApps,
  androidShells, desktopShells, twaLaunchers, nativeConfig, nativeClients,
}
