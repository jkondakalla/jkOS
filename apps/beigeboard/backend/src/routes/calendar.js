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
/* The caller's IANA zone (D5 / BB-15). A calendar event is an INSTANT upstream and
   a due_date + scheduled_time in our items table, and that conversion has no answer
   until you say where the user is. Threaded into every sync below; null (a caller
   with no zone header — an OAuth redirect landing in a fresh tab, a peer service)
   resolves to UTC inside the normalisers. */
const { callerZone } = require('@jkos/weave/server');
const { wantsForce, syncBody, purgeCalendarSource } = require('../calendar/replace');
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

    try { await syncGoogleEvents(oauth2, req.user.sub, false, callerZone(req)); } catch (e) { console.warn('Google calendar sync:', e.message); }

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
    try { await syncOutlookEvents(t.access_token, req.user.sub, false, callerZone(req)); } catch (e) { console.warn('Outlook calendar sync:', e.message); }
    close({ type: 'outlook-auth-success', email });
  } catch (e) {
    console.error('Outlook callback error:', e);
    close({ type: 'outlook-auth-error', error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE THREE PROVIDERS' HTTP HALF, ONCE (BB-6 / D10)
   ══════════════════════════════════════════════════════════════════════════════

   `provider.js` unified the FETCH half — one CalendarProvider contract, one shared
   writer — and said so in its own header. The HTTP half never followed: status,
   disconnect and sync existed three times each, ~100 lines of bodies differing only
   in a provider literal and in how credentials are loaded. Nine routes, three
   distinct ideas.

   ⚠️ NOT `defineConnector`, which is what RESET proposed and which is the wrong
   instrument — the code wins. That primitive turns "an upstream base + auth + an
   endpoint→contract mapping" into a server-side PROXY: a caller asks, it forwards,
   it maps the reply back. Calendar sync does not proxy anything. It fetches a
   90-day window, normalises three dialects into one shape, and WRITES INTO THE LOCAL
   ITEMS TABLE through a guarded replace. Forcing it into a proxy factory would mean
   describing a sync as a read and losing the wipe guard, the zone threading and the
   cascade — everything that makes it correct.

   ⚠️ EACH ROUTE IS STILL REGISTERED WITH ITS LITERAL PATH, deliberately, rather than
   in a `for (const p of PROVIDERS)` loop. `98-surface-coverage` censuses mounted
   routes by parsing their path literals out of source, so a loop would collapse nine
   visible surfaces into one unparseable `/api/auth/${id}/status` — trading a
   duplication problem for an invisibility problem, which is the more expensive one.
   The bodies are shared; the mount points stay legible.

   NO SCHEDULER, still, and that is a decision rather than an omission: this suite has
   no cron by design (see routines.js on the same bargain). A calendar syncs when the
   user connects it and when they ask. */

/** How each provider turns a stored `calendar_tokens` row into a completed sync.
 *  The ONLY thing that genuinely differs between the three. */
const PROVIDERS = {
  google: {
    label: 'Google Calendar',
    async sync(row, req) {
      const oauth2 = makeOAuth2();
      oauth2.setCredentials({
        access_token: decryptSecret(row.access_token),
        refresh_token: decryptSecret(row.refresh_token),
        expiry_date: row.expiry_ms,
      });
      /* Google hands back a refreshed access token out-of-band; persist it (and a
         rotated refresh token when one arrives) or the next sync re-does the dance. */
      oauth2.on('tokens', (t) => {
        run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? ${t.refresh_token ? ',refresh_token=?' : ''} WHERE id=?`,
          t.refresh_token
            ? [encryptSecret(t.access_token), t.expiry_date, encryptSecret(t.refresh_token), row.id]
            : [encryptSecret(t.access_token), t.expiry_date, row.id]);
      });
      return syncGoogleEvents(oauth2, req.user.sub, wantsForce(req), callerZone(req));
    },
  },
  outlook: {
    label: 'Outlook Calendar',
    async sync(row, req) {
      const token = await getMsToken(row);
      return syncOutlookEvents(token, req.user.sub, wantsForce(req), callerZone(req));
    },
  },
  icloud: {
    label: 'iCloud Calendar',
    /* No zone: an ICS literal is floating by construction (see icloud.js). */
    async sync(row, req) {
      return syncICloudEvents(row.email, decryptSecret(row.access_token), req.user.sub, wantsForce(req));
    },
  },
};

/** Is this provider connected, and as whom. */
const statusHandler = (provider) => (req, res) => {
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, provider]);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { fail(res, e); }
};

/** Forget the credentials AND everything this provider put on the board.
 *  ⚠️ Through `purgeCalendarSource`, which CASCADES. All three of these used to
 *  raw-`DELETE FROM items WHERE source=…`, and `items.parent_id` carries no foreign
 *  key — so a note or checklist nested under a synced event was left parented to a
 *  row that no longer existed, reachable by no view. */
const disconnectHandler = (provider) => (req, res) => {
  try {
    run('DELETE FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, provider]);
    const removed = purgeCalendarSource(provider, req.user.sub);
    res.json({ ok: true, removed });
  } catch (e) { fail(res, e); }
};

/** Pull this provider's window and swap it in. */
const syncHandler = (provider) => async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, provider]);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const result = await PROVIDERS[provider].sync(row, req);
    res.json(syncBody(result));
  } catch (e) { fail(res, e, `${PROVIDERS[provider].label} sync failed`); }
};

/* ── Google ────────────────────────────────────────────────────────────── */
router.get('/api/auth/google/status', statusHandler('google'));      // app-private: connector state for this app's own settings panel
router.delete('/api/auth/google', disconnectHandler('google'));      // app-private: forgets credentials this app stores; the RESULT is the declared connector state
router.post('/api/calendar/google/sync', syncHandler('google'));

/* ── Outlook ───────────────────────────────────────────────────────────── */
router.get('/api/auth/outlook/status', statusHandler('outlook'));    // app-private: connector state for this app's own settings panel
router.delete('/api/auth/outlook', disconnectHandler('outlook'));    // app-private: forgets credentials this app stores; the RESULT is the declared connector state
router.post('/api/calendar/outlook/sync', syncHandler('outlook'));

/* ── iCloud ────────────────────────────────────────────────────────────── */
router.get('/api/auth/icloud/status', statusHandler('icloud'));      // app-private: connector state for this app's own settings panel
router.delete('/api/auth/icloud', disconnectHandler('icloud'));      // app-private: forgets credentials this app stores; the RESULT is the declared connector state
router.post('/api/calendar/icloud/sync', syncHandler('icloud'));

/* iCloud CONNECTS here rather than through an OAuth redirect: it takes an
   app-specific password, and the credential is only proven good by using it — so the
   connect IS a sync, and the row is stored only once that succeeds. */
router.post('/api/auth/icloud', async (req, res) => {  // app-private: stores an app-specific password; the RESULT is the declared connector state
  const { username, appPassword } = req.body || {};
  if (!username || !appPassword) return res.status(400).json({ error: 'username and appPassword required' });
  try {
    const result = await syncICloudEvents(username, appPassword, req.user.sub, wantsForce(req));
    run(
      `INSERT INTO calendar_tokens (user_id,provider,access_token,email)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id,provider) DO UPDATE SET access_token=excluded.access_token, email=excluded.email`,
      [req.user.sub, 'icloud', encryptSecret(appPassword), username],
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

module.exports = router;
