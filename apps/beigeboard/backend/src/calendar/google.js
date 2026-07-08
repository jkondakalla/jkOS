'use strict';
// Google Calendar provider: OAuth2 client factory + fetch/normalize behind the
// shared CalendarProvider contract (provider.js).
const { google } = require('googleapis');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config');
const { isoDateStr } = require('../util');
const { timedInterval, syncProvider, SYNC_WINDOW_DAYS } = require('./provider');

function makeOAuth2() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/* Pure: Google `events.list().items[]` → NormalizedEvent[]. Exported for TEST-8. */
function normalizeGoogle(items) {
  const out = [];
  for (const ev of (items || [])) {
    const isAllDay = !!ev.start?.date;
    if (!ev.start?.dateTime && !ev.start?.date) continue;
    if (isAllDay) {
      // Use the date string directly — new Date("YYYY-MM-DD") parses as UTC midnight
      // and local getDate() returns the previous day in negative-offset timezones.
      const due_date = ev.start.date;
      let end_date = null;
      if (ev.end?.date) {
        // Google all-day end dates are exclusive — subtract one day for the inclusive last day.
        const edArr = ev.end.date.split('-').map(Number);
        const edObj = new Date(edArr[0], edArr[1] - 1, edArr[2] - 1);
        const endStr = isoDateStr(edObj);
        if (endStr !== due_date) end_date = endStr;
      }
      out.push({ title: ev.summary || '(No title)', notes: ev.description || null, due_date, scheduled_time: null, scheduled_end: null, location: ev.location || null, end_date });
    } else {
      const sd = new Date(ev.start.dateTime);
      const ed = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
      out.push({ title: ev.summary || '(No title)', notes: ev.description || null, ...timedInterval(sd, ed), location: ev.location || null });
    }
  }
  return out;
}

const googleProvider = {
  id: 'google',
  async fetchWindow(auth, days = SYNC_WINDOW_DAYS) {
    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + days * 86400000).toISOString(),
      singleEvents: true, orderBy: 'startTime', maxResults: 500,
    });
    return normalizeGoogle(data.items);
  },
};

/* Wrapper kept for the routes/OAuth callbacks (unchanged signature). */
function syncGoogleEvents(auth, userId, force = false) {
  return syncProvider(googleProvider, auth, userId, { force });
}

module.exports = { makeOAuth2, normalizeGoogle, googleProvider, syncGoogleEvents };
