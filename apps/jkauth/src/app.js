'use strict'
// Express app factory: wires middleware (json/cookies/static/CORS/rate-limit/
// security-headers) in the same order the monolith used, then mounts the route
// modules. server.js just require()s this and listens.

const express = require('express')
const cookieParser = require('cookie-parser')
const crypto = require('crypto')
const path = require('path')
const rateLimit = require('express-rate-limit')
const { getAppOrigins } = require('./db')
const { weaveCors, healthHandler } = require('@jkos/weave/server')
const { isJsonReq, waitPhrase } = require('./util')
const { loginPage } = require('./views')
const {
  RL_WINDOW_MS, RL_CREDENTIALS, RL_REFRESH,
} = require('./config')

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, '..', 'public')))
app.set('trust proxy', 1)

// CORS — allow registered app origins to call the auth API cross-origin (needed
// for POST /auth/refresh and POST /auth/logout from app frontends). The shared
// weave header block over the registry-backed origin list (the single source).
app.use(weaveCors(getAppOrigins))

// Rate limiting (S6). Credential endpoints stay tight; refresh is legitimately
// frequent so it gets headroom. All per-IP.
//
// What a limiter does when it TRIPS matters as much as its budget. app.use()
// mounts middleware for every method, so the credential limiter counted GET
// /auth/login too — every page render, every bounce through the sign-in screen
// from a gated origin, every reload. Once the budget went, the default handler
// answered the login PAGE with a bare JSON error for the rest of the window:
// the sign-in surface itself was gone, and nothing on screen said "wait". Two
// rules make it a wait instead of a wall:
//
//   · countUnsafeOnly — rendering the form is not an attempt; POSTing a
//     credential is. Safe methods pass. (Kept as an option: a future flow whose
//     whole traffic is GETs would need every request counted.)
//   · a human-shaped 429 — a browser gets the login page back with the wait
//     spelled out and Retry-After set; a JSON caller keeps its machine body.
//
// Brute force stays bounded by the POST budget, and the per-account exponential
// backoff (loginBackoffMs, routes/auth.js) is the half that tracks the account
// under attack rather than the address in front of it.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const mkLimiter = (limit, { countUnsafeOnly = true, htmlPage = false } = {}) => rateLimit({
  windowMs: RL_WINDOW_MS,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => countUnsafeOnly && SAFE_METHODS.has(req.method),
  handler: (req, res) => {
    const resetAt = req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + RL_WINDOW_MS
    const retryMs = Math.max(0, resetAt - Date.now())
    const msg = `Too many attempts. Please wait ${waitPhrase(retryMs / 1000)} and try again.`
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))))
    if (htmlPage && !isJsonReq(req)) {
      return res.status(429).send(loginPage({
        error:      msg,
        redirectTo: req.body?.redirect_to,
        mode:       req.originalUrl.startsWith('/auth/register') ? 'register' : undefined,
      }))
    }
    res.status(429).json({ error: msg, code: 'RATE_LIMITED', retry_after_ms: retryMs })
  },
})
app.use(['/auth/login', '/auth/register', '/auth/guest'], mkLimiter(RL_CREDENTIALS, { htmlPage: true }))
app.use('/auth/refresh', mkLimiter(RL_REFRESH))
// Service-token issuance presents a SECRET (client-credentials), so it belongs on
// the tight credential budget, not refresh's relaxed one — otherwise the secret is
// brute-forceable at the refresh rate. Tokens live ~10 min, so issuance is rare.
app.use('/auth/token', mkLimiter(RL_CREDENTIALS))
// The C3 account flows are credential surfaces too and belong on the tight
// budget: /auth/password takes the current password, and the reset pair is an
// unauthenticated path that mints and consumes codes. `/auth/reset` covers both
// `/request` and `/confirm` (app.use matches by prefix). `htmlPage` is off —
// these render their own pages, and the limiter's login-page fallback would be
// the wrong surface to bounce someone to mid-reset.
app.use('/auth/password', mkLimiter(RL_CREDENTIALS))
app.use('/auth/reset', mkLimiter(RL_CREDENTIALS))
app.use('/auth/verify', mkLimiter(RL_CREDENTIALS))

// Security headers on every dynamic response (static assets are served above and
// stay cacheable): clickjacking defence + nosniff + a tight referrer policy +
// no-store so auth payloads are never cached by intermediaries (S7), plus a
// real CSP with a per-request nonce so the portal's inline <script>/<style> run
// without 'unsafe-inline' (S11). res.locals.cspNonce is read by views.js.
app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64')
  res.locals.cspNonce = nonce
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    `style-src 'self' 'nonce-${nonce}'`,
    `script-src 'self' 'nonce-${nonce}'`,
  ].join('; '))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Cache-Control', 'no-store')
  next()
})

// ── Routes ──────────────────────────────────────────────────────────────────
// The credential limiter mounted on '/auth/login' also covers '/auth/login/2fa'
// (app.use matches by path prefix), so the 2FA code-verify endpoint is throttled.
app.use(require('./routes/auth'))
app.use(require('./routes/twofactor'))
app.use(require('./routes/account'))
app.use(require('./routes/profile'))
app.use(require('./routes/weave'))

app.get('/health', healthHandler('jkauth'))

module.exports = app
