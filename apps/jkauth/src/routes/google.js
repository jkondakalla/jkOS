'use strict'
// Google OAuth — three plain HTTPS calls (auth URL, token exchange, userinfo)
// with Node's global fetch; no googleapis SDK (dropping that 116 MB dep is what
// keeps the image building in ~1 min).

const express = require('express')
const crypto = require('crypto')
const {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OAUTH_NONCE_COOKIE,
} = require('../config')
const { get, run, logEvent } = require('../db')
const { validateRedirectTo } = require('../util')
const { loginPage } = require('../views')
const { issueTokens } = require('../tokens')

const router = express.Router()

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).send(loginPage({ error: 'Google sign-in is not configured' }))
  }
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = Buffer.from(JSON.stringify({
    redirect_to: req.query.redirect_to || '',
    nonce,
  })).toString('base64url')
  // Store nonce in a short-lived httpOnly cookie; verified on callback to prevent CSRF
  res.cookie(OAUTH_NONCE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 10 * 60 * 1000, path: '/' })
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  })
  res.redirect(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`)
})

router.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.redirect('/auth/login?error=google_no_code')
  let redirectTo = ''
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    redirectTo = validateRedirectTo(parsed.redirect_to) || ''
    const storedNonce = req.cookies?.[OAUTH_NONCE_COOKIE]
    if (!storedNonce || parsed.nonce !== storedNonce) {
      res.clearCookie(OAUTH_NONCE_COOKIE)
      return res.redirect('/auth/login?error=google_invalid_state')
    }
  } catch {
    res.clearCookie(OAUTH_NONCE_COOKIE)
    return res.redirect('/auth/login?error=google_invalid_state')
  }
  res.clearCookie(OAUTH_NONCE_COOKIE)
  try {
    // 1) Exchange the auth code for an access token.
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`)
    const tokens = await tokenRes.json()

    // 2) Fetch the user's basic profile (id, email, verified_email, name, picture).
    const profileRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!profileRes.ok) throw new Error(`userinfo failed (${profileRes.status})`)
    const profile = await profileRes.json()

    // Never link/create from an unverified Google email — an attacker-controlled
    // unverified address matching an existing jkOS account would be takeover. (S1)
    if (profile.verified_email === false) {
      return res.redirect('/auth/login?error=google_unverified')
    }

    const profileEmail = (profile.email || '').toLowerCase()
    let user = get('SELECT * FROM users WHERE google_id=?', [profile.id])
    if (!user) user = get('SELECT * FROM users WHERE email=?', [profileEmail])
    let isNew = false
    if (user) {
      run('UPDATE users SET google_id=?, avatar_url=?, last_login=datetime("now") WHERE id=?',
        [profile.id, profile.picture, user.id])
      user = get('SELECT * FROM users WHERE id=?', [user.id])
    } else {
      // First non-guest user becomes admin (see S12 note in routes/auth.js).
      const realUsers = get("SELECT COUNT(*) AS c FROM users WHERE role != 'guest'").c
      const role = realUsers === 0 ? 'admin' : 'user'
      const result = run('INSERT INTO users (email, name, avatar_url, google_id, role) VALUES (?,?,?,?,?)',
        [profileEmail, profile.name, profile.picture, profile.id, role])
      user = get('SELECT * FROM users WHERE id=?', [result.lastInsertRowid])
      isNew = true
    }
    issueTokens(res, user)
    logEvent(isNew ? 'google_register' : 'google_login', user.id, req)
    res.redirect(redirectTo || '/auth/dashboard')
  } catch (e) {
    console.error('[google callback]', e)
    res.redirect('/auth/login?error=google_failed')
  }
})

module.exports = router
