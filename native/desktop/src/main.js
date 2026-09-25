'use strict'
// main.js — the jkOS desktop shell: one window on the live site, at its real origin.
//
// Everything this file decides is decided in policy.js; this file only applies it. Which
// shell it is (jkOS or KourOS) is baked into the packaged package.json by scripts/dist.mjs;
// in development JKOS_SHELL picks it. A packaged app points at production, an unpackaged
// one at staging.

const { app, BrowserWindow, Menu, session, shell } = require('electron')
const path = require('node:path')
const policy = require('./policy.js')
const SHELLS = require('./shells.json')
const pkg = require('../package.json')

const cfg = policy.shellConfig(SHELLS, pkg.jkosShell || process.env.JKOS_SHELL || 'jkos',
  app.isPackaged ? 'release' : 'debug')

// Each shell × environment gets its OWN profile — cookie jar, storage, cache — so the KourOS
// app, the jkOS app and a staging run never share a session.
app.setPath('userData', path.join(app.getPath('appData'), cfg.applicationId))

function openExternal(url) {
  if (policy.externalAllowed(url)) shell.openExternal(url)
}

// Applied to EVERY webContents, including any the page manages to create — not only the
// window below.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    // A new window is never opened. A shell URL navigates this one (through the guard
    // below); anything else goes to the system browser.
    if (policy.allows(url, cfg.origins)) contents.loadURL(url)
    else openExternal(url)
    return { action: 'deny' }
  })
  const guard = (e, url) => {
    if (policy.allows(url, cfg.origins)) return
    e.preventDefault()
    openExternal(url)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
})

// Electron already refuses a bad certificate when nothing handles this event. Handling it to
// say so again makes the refusal visible here instead of implied by an absence.
app.on('certificate-error', (_e, _contents, _url, _error, _cert, callback) => callback(false))

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 480,
    title: cfg.name,
    backgroundColor: cfg.themeColor,
    autoHideMenuBar: true,
    show: false,
    // Packaged builds get their icon from the .desktop entry; in development point at the
    // web icon the shell is derived from.
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '..', '..', '..', cfg.icon) }),
    webPreferences: { ...policy.WEB_PREFERENCES },
  })
  win.once('ready-to-show', () => win.show())

  // Unreachable portal (NAS rebooting, network down, a 502 at the edge): a local page that
  // retries, instead of Chromium's error screen. -3 is ERR_ABORTED — our own guard cancelling
  // a navigation, which is not a failure.
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: cfg.startUrl } })
  })

  win.loadURL(cfg.startUrl)
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })

  app.whenReady().then(() => {
    const ses = session.defaultSession
    ses.setPermissionRequestHandler((_wc, permission, callback, details) =>
      callback(policy.permissionAllowed(permission, details.requestingUrl, cfg.origins)))
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
      policy.permissionAllowed(permission, requestingOrigin, cfg.origins))

    // No menu in a packaged app (the page is the whole UI); keep Electron's default one in
    // development for DevTools and reload.
    if (app.isPackaged) Menu.setApplicationMenu(null)
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
