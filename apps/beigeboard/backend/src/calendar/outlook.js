'use strict';
// Outlook / Microsoft Graph provider: access-token refresh + fetch/normalize behind
// the shared CalendarProvider contract (provider.js).
const { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TOKEN_URL, MS_GRAPH } = require('../config');
const { run } = require('../db');
const { encryptSecret, decryptSecret } = require('../crypto');
const { isoDateStr } = require('../util');
const { timedInterval, syncProvider, SYNC_WINDOW_DAYS } = require('./provider');

async function getMsToken(row) {
  // Refresh when the expiry is unknown (legacy/null row) OR within 60s of expiring —
  // returning a possibly-expired token would make the sync silently 401 forever.
  if (row.expiry_ms && Date.now() < row.expiry_ms - 60000) return decryptSecret(row.access_token);
  const r = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      refresh_token: decryptSecret(row.refresh_token), grant_type: 'refresh_token',
    }).toString(),
  });
  const t = await r.json();
  if (t.error) throw new Error(t.error_description || t.error);
  const expiry = Date.now() + (t.expires_in || 3600) * 1000;
  // MS rotates the refresh token on each refresh (offline_access). Persist the new
  // one when present — otherwise the stored token eventually rotates out and every
  // future sync 401s forever until the user reconnects by hand. (Mirrors the Google
  // 'tokens'-event handler, which already does this.)
  if (t.refresh_token) {
    run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=?, refresh_token=? WHERE id=?`,
      [encryptSecret(t.access_token), expiry, encryptSecret(t.refresh_token), row.id]);
  } else {
    run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? WHERE id=?`,
      [encryptSecret(t.access_token), expiry, row.id]);
  }
  return t.access_token;
}

/* Pure: Graph `calendarView.value[]` → NormalizedEvent[]. Exported for TEST-8.
   A malformed event (missing start/end or an unparseable date) is skipped, never
   thrown — so one bad row can't abort the whole sync. */
function normalizeOutlook(value) {
  const out = [];
  for (const ev of (value || [])) {
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
    const isAllDay = !!ev.isAllDay;
    const sd = new Date(ev.start.dateTime + (ev.start.timeZone === 'UTC' ? 'Z' : ''));
    const ed = new Date(ev.end.dateTime   + (ev.end.timeZone   === 'UTC' ? 'Z' : ''));
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) continue;
    const base = { title: ev.subject || '(No title)', notes: ev.bodyPreview || null, location: ev.location?.displayName || null };
    if (isAllDay) {
      const due_date = isoDateStr(sd);
      const adj = new Date(ed); adj.setDate(adj.getDate() - 1);   // Graph all-day end is exclusive
      const s = isoDateStr(adj);
      out.push({ ...base, due_date, scheduled_time: null, scheduled_end: null, end_date: s !== due_date ? s : null });
    } else {
      out.push({ ...base, ...timedInterval(sd, ed) });
    }
  }
  return out;
}

const outlookProvider = {
  id: 'outlook',
  async fetchWindow(token, days = SYNC_WINDOW_DAYS) {
    const now = new Date(), end = new Date(now.getTime() + days * 86400000);
    const url = `${MS_GRAPH}/me/calendarView`
      + `?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}`
      + `&$top=500&$select=subject,start,end,isAllDay,location,bodyPreview`;
    const r    = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    return normalizeOutlook(data.value);
  },
};

/* Wrapper kept for the routes (unchanged signature). */
function syncOutlookEvents(token, userId, force = false) {
  return syncProvider(outlookProvider, token, userId, { force });
}

module.exports = { getMsToken, normalizeOutlook, outlookProvider, syncOutlookEvents };
