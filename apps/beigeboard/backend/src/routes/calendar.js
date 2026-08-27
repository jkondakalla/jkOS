'use strict';
// Auth + calendar routes: the signed-in user (/api/auth/me), the three provider
// OAuth/connect flows, and their status/disconnect/sync endpoints.
const express = require('express');
const {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI, MS_AUTH_URL, MS_TOKEN_URL, MS_GRAPH,
} = require('../config');
const { run, get } = require('../db');
const { authMiddleware, optionalAuth } = require('../auth');
const { encryptSecret, decryptSecret, setOAuthState, checkOAuthState } = require('../crypto');
const { safeJson, fail } = require('../util');
const { wantsForce, syncBody } = require('../calendar/replace');
const { makeOAuth2, syncGoogleEvents } = require('../calendar/google');
const { getMsToken, syncOutlookEvents } = require('../calendar/outlook');
const { syncICloudEvents } = require('../calendar/icloud');

const router = express.Router();

/* ── Auth: me ──────────────────────────────────────────────────────────── */
router.get('/api/auth/me', (req, res) => {  // app-private: echoes the verified identity back to this app's own SPA; jkAuth owns the identity contract
  res.json({ user: req.user });
});

/* ── Auth: Google Calendar OAuth ───────────────────────────────────────── */
router.get('/api/auth/google', (req, res) => {  // app-private: starts the OAuth consent redirect; the RESULT is the declared connector state
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(501).send('Google credentials not configured.');
  }
  const state = setOAuthState(res);
  const url = makeOAuth2().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    prompt: 'consent',
    state,
  });
  res.redirect(url);
});

router.get('/api/auth/google/callback', optionalAuth(authMiddleware), async (req, res) => {  // app-private: OAuth redirect target — the browser lands here, it is not a composable surface
  const { code, error } = req.query;
  const close = (msg) => res.send(
    `<script>window.opener?.postMessage(${safeJson(msg)},window.location.origin);window.close();</script>`
  );
  // The popup arrived without a valid session cookie — we can't attach the calendar
  // to anyone, so tell the opener (postMessage) instead of returning a bare 401 page.
  if (!req.user) return close({ type: 'google-auth-error', error: 'Your session expired — sign in and reconnect.' });
  const stateOk = checkOAuthState(req, res);   // CSRF: must match the cookie set on initiate
  if (error) return close({ type: 'google-auth-error', error });
  if (!stateOk) return close({ type: 'google-auth-error', error: 'Invalid state' });

  try {
    const oauth2 = makeOAuth2();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    run(
      `INSERT INTO calendar_tokens (user_id,provider,access_token,refresh_token,expiry_ms,email)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id,provider) DO UPDATE SET
         access_token=excluded.access_token,
         refresh_token=COALESCE(excluded.refresh_token, refresh_token),
         expiry_ms=excluded.expiry_ms, email=excluded.email`,
      [req.user.sub, 'google', encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token||null), tokens.expiry_date||null, req.user.email||null]
    );

    oauth2.on('tokens', t => {
      run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? ${t.refresh_token?',refresh_token=?':''} WHERE user_id=? AND provider='google'`,
        t.refresh_token ? [encryptSecret(t.access_token), t.expiry_date, encryptSecret(t.refresh_token), req.user.sub] : [encryptSecret(t.access_token), t.expiry_date, req.user.sub]);
    });

    try { await syncGoogleEvents(oauth2, req.user.sub); } catch (e) { console.warn('Google calendar sync:', e.message); }

    close({ type: 'google-auth-success', email: req.user.email });
  } catch (e) {
    console.error('Google callback error:', e);
    close({ type: 'google-auth-error', error: e.message });
  }
});

/* ── Auth: Outlook Calendar OAuth ──────────────────────────────────────── */
router.get('/api/auth/outlook', (req, res) => {  // app-private: starts the OAuth consent redirect; the RESULT is the declared connector state
  if (!MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    return res.status(501).send('Microsoft credentials not configured.');
  }
  const state = setOAuthState(res);
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID, response_type: 'code',
    redirect_uri: MS_REDIRECT_URI,
    scope: 'offline_access Calendars.Read User.Read',
    response_mode: 'query', state,
  });
  res.redirect(`${MS_AUTH_URL}?${params}`);
});

router.get('/api/auth/outlook/callback', optionalAuth(authMiddleware), async (req, res) => {  // app-private: OAuth redirect target — the browser lands here, it is not a composable surface
  const { code, error } = req.query;
  const close = (msg) => res.send(
    `<script>window.opener?.postMessage(${safeJson(msg)},window.location.origin);window.close();</script>`
  );
  if (!req.user) return close({ type: 'outlook-auth-error', error: 'Your session expired — sign in and reconnect.' });
  const stateOk = checkOAuthState(req, res);   // CSRF: must match the cookie set on initiate
  if (error) return close({ type: 'outlook-auth-error', error });
  if (!stateOk) return close({ type: 'outlook-auth-error', error: 'Invalid state' });

  try {
    const r = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
        code, redirect_uri: MS_REDIRECT_URI, grant_type: 'authorization_code',
      }).toString(),
    });
    const t = await r.json();
    if (t.error) return close({ type: 'outlook-auth-error', error: t.error_description || t.error });

    const expiry = Date.now() + (t.expires_in || 3600) * 1000;
    const me = await fetch(`${MS_GRAPH}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${t.access_token}` },
    }).then(r => r.json());
    const email = me.mail || me.userPrincipalName || '';

    run(
      `INSERT INTO calendar_tokens (user_id,provider,access_token,refresh_token,expiry_ms,email)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id,provider) DO UPDATE SET
         access_token=excluded.access_token, refresh_token=excluded.refresh_token,
         expiry_ms=excluded.expiry_ms, email=excluded.email`,
      [req.user.sub, 'outlook', encryptSecret(t.access_token), encryptSecret(t.refresh_token||null), expiry, email]
    );

    // The token is saved; a sync blip now must NOT report the connection as failed
    // (the user IS connected — sync retries on the next poll/manual sync). Mirrors
    // the Google callback, whose initial sync is wrapped for the same reason.
    try { await syncOutlookEvents(t.access_token, req.user.sub); } catch (e) { console.warn('Outlook calendar sync:', e.message); }
    close({ type: 'outlook-auth-success', email });
  } catch (e) {
    console.error('Outlook callback error:', e);
    close({ type: 'outlook-auth-error', error: e.message });
  }
});

/* ── Google status / disconnect / sync ─────────────────────────────────── */
router.get('/api/auth/google/status', (req, res) => {  // app-private: connector state for this app's own settings panel
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'google']);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { fail(res, e); }
});

router.delete('/api/auth/google', (req, res) => {  // app-private: starts the OAuth consent redirect; the RESULT is the declared connector state
  try {
    run("DELETE FROM calendar_tokens WHERE user_id=? AND provider='google'", [req.user.sub]);
    run("DELETE FROM items WHERE source='google' AND user_id=?", [req.user.sub]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.post('/api/calendar/google/sync', async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'google']);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const oauth2 = makeOAuth2();
    oauth2.setCredentials({ access_token: decryptSecret(row.access_token), refresh_token: decryptSecret(row.refresh_token), expiry_date: row.expiry_ms });
    oauth2.on('tokens', t => {
      run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? ${t.refresh_token?',refresh_token=?':''} WHERE id=?`,
        t.refresh_token ? [encryptSecret(t.access_token), t.expiry_date, encryptSecret(t.refresh_token), row.id] : [encryptSecret(t.access_token), t.expiry_date, row.id]);
    });
    const result = await syncGoogleEvents(oauth2, req.user.sub, wantsForce(req));
    res.json(syncBody(result));
  } catch (e) { fail(res, e); }
});

/* ── Outlook status / disconnect / sync ────────────────────────────────── */
router.get('/api/auth/outlook/status', (req, res) => {  // app-private: connector state for this app's own settings panel
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'outlook']);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { fail(res, e); }
});

router.delete('/api/auth/outlook', (req, res) => {  // app-private: starts the OAuth consent redirect; the RESULT is the declared connector state
  try {
    run("DELETE FROM calendar_tokens WHERE user_id=? AND provider='outlook'", [req.user.sub]);
    run("DELETE FROM items WHERE source='outlook' AND user_id=?", [req.user.sub]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.post('/api/calendar/outlook/sync', async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'outlook']);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const token = await getMsToken(row);
    const result = await syncOutlookEvents(token, req.user.sub, wantsForce(req));
    res.json(syncBody(result));
  } catch (e) { fail(res, e); }
});

/* ── iCloud status / connect / disconnect / sync ───────────────────────── */
router.get('/api/auth/icloud/status', (req, res) => {  // app-private: connector state for this app's own settings panel
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'icloud']);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { fail(res, e); }
});

router.post('/api/auth/icloud', async (req, res) => {  // app-private: stores an app-specific password; the RESULT is the declared connector state
  const { username, appPassword } = req.body || {};
  if (!username || !appPassword) return res.status(400).json({ error: 'username and appPassword required' });
  try {
    const result = await syncICloudEvents(username, appPassword, req.user.sub, wantsForce(req));
    run(
      `INSERT INTO calendar_tokens (user_id,provider,access_token,email)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id,provider) DO UPDATE SET access_token=excluded.access_token, email=excluded.email`,
      [req.user.sub, 'icloud', encryptSecret(appPassword), username]
    );
    res.json({ ...syncBody(result), email: username });
  } catch (e) {
    // Redact like every other route's fail() — an invalid-credentials 401 keeps a
    // fixed, actionable message; anything else logs the detail and returns generic
    // (raw e.message could carry CalDAV server internals). (BUG-6.3)
    if (e.status === 401) return res.status(401).json({ error: 'iCloud rejected those credentials — check the username and app-specific password.' });
    fail(res, e, 'iCloud sync failed');
  }
});

router.delete('/api/auth/icloud', (req, res) => {  // app-private: stores an app-specific password; the RESULT is the declared connector state
  try {
    run("DELETE FROM calendar_tokens WHERE user_id=? AND provider='icloud'", [req.user.sub]);
    run("DELETE FROM items WHERE source='icloud' AND user_id=?", [req.user.sub]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.post('/api/calendar/icloud/sync', async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'icloud']);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const result = await syncICloudEvents(row.email, decryptSecret(row.access_token), req.user.sub, wantsForce(req));
    res.json(syncBody(result));
  } catch (e) { fail(res, e); }
});

module.exports = router;
