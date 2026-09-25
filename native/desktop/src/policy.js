'use strict'
// policy.js — every security decision the desktop shell makes, as plain data and pure
// functions. No `require('electron')`: test/native.mjs loads this file directly and asserts
// it, and main.js may only APPLY what is decided here.

/**
 * The renderer's preferences. Each line is a door closed on the live page:
 *   contextIsolation/sandbox/no nodeIntegration — the page is a web page, with no Node and no
 *     Electron API. There is NO preload script at all: nothing is exposed to the page.
 *   webviewTag false — a page cannot embed an unpoliced <webview>.
 *   spellcheck false — Chromium's spellchecker fetches dictionaries from a Google CDN.
 */
const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
  navigateOnDragDrop: false,
  spellcheck: false,
  safeDialogs: true,
})

/**
 * Browser permissions the page is granted — and only on a shell origin. Everything else
 * (camera, mic, geolocation, notifications, MIDI, HID, serial…) is denied without a prompt.
 * Derived from what the suite's frontends actually call (2026-09-24): BeigeBoard's routine
 * import writes to the clipboard, and nothing else asks for anything. Add a permission here
 * when a frontend starts to need one, not before.
 */
const GRANTED_PERMISSIONS = Object.freeze(['clipboard-sanitized-write'])

/**
 * May the shell SHOW this URL? The rule every native shell implements, declared as test
 * vectors in native/origin-cases.json (the Android launcher's OriginPolicy.kt passes the same):
 * https only · no userinfo · the default port only · origin EXACTLY equal to a listed origin.
 * WHATWG URL is Chromium's own parser, so this sees a URL the way the navigation will.
 */
function allows(url, origins) {
  let u
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  return origins.includes(u.origin)
}

/** May a URL the shell refuses be handed to the system browser? Web and mail only — never
 *  file:, smb:, a custom scheme handler, or anything else `shell.openExternal` would launch. */
function externalAllowed(url) {
  let u
  try { u = new URL(url) } catch { return false }
  return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
}

function permissionAllowed(permission, requestingUrl, origins) {
  return GRANTED_PERMISSIONS.includes(permission) && allows(String(requestingUrl || ''), origins)
}

/** One shell's config for one environment, from the generated shells.json. */
function shellConfig(doc, id, env) {
  const shell = doc.shells[id]
  if (!shell) throw new Error(`no desktop shell '${id}' (have: ${Object.keys(doc.shells).join(', ')})`)
  if (env !== 'release' && env !== 'debug') throw new Error(`env '${env}'`)
  return { ...shell[env], id, themeColor: shell.themeColor, icon: shell.icon }
}

module.exports = { WEB_PREFERENCES, GRANTED_PERMISSIONS, allows, externalAllowed, permissionAllowed, shellConfig }
