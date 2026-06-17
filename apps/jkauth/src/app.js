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
const {
  RL_WINDOW_MS, RL_CREDENTIALS, RL_REFRESH, RL_GOOGLE,
} = require('./config')

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, '..', 'public')))
app.set('trust proxy', 1)

// CORS — allow registered app origins to call the auth API cross-origin
// (needed for POST /auth/refresh and POST /auth/logout called from app frontends)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    const allowed = getAppOrigins()
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Rate limiting (S6). Credential endpoints stay tight; refresh is legitimately
// frequent so it gets headroom; the Google flow is throttled too. All per-IP.
const mkLimiter = limit => rateLimit({
  windowMs: RL_WINDOW_MS,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
})
app.use(['/auth/login', '/auth/register', '/auth/guest'], mkLimiter(RL_CREDENTIALS))
app.use('/auth/refresh', mkLimiter(RL_REFRESH))
app.use(['/auth/google', '/auth/google/callback'], mkLimiter(RL_GOOGLE))

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
app.use(require('./routes/auth'))
app.use(require('./routes/profile'))
app.use(require('./routes/google'))

app.get('/health', (req, res) => res.json({ ok: true }))

module.exports = app
