'use strict'
// Express app factory: wires middleware (json/cookies/static/CORS/rate-limit/
// security-headers) in the same order the monolith used, then mounts the route
// modules. server.js just require()s this and listens.

const express = require('express')
const cookieParser = require('cookie-parser')
const path = require('path')
const rateLimit = require('express-rate-limit')
const { getAppOrigins } = require('./db')

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

// Rate limit login and register — 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
})
app.use(['/auth/login', '/auth/register', '/auth/guest'], authLimiter)

// Security headers on every dynamic response (static assets are served above and
// stay cacheable): clickjacking defence + nosniff + a tight referrer policy +
// no-store so auth payloads are never cached by intermediaries. (S7)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
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
