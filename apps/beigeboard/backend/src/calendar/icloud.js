'use strict';
// iCloud CalDAV provider: principal/home/calendar discovery, a minimal ICS parser,
// and fetch/normalize behind the shared CalendarProvider contract (provider.js).
//
// KNOWN LIMITATIONS (documented deliberately — this is the seam a real ICS library
// would replace, behind the SAME contract; ask Jag before adding `ical.js`):
//   • TZID is IGNORED. A DTSTART/DTEND carrying a TZID (floating or zoned local
//     time) is read by slicing the raw digits — the wall-clock time is stored as-is,
//     not resolved to the user's zone. Only a trailing 'Z' (UTC) is stripped. For a
//     UTC-stamped or all-day event this matches Google/Outlook; for a zoned event the
//     stored time is the upstream wall time.
//   • RRULE is NOT expanded. A recurring VEVENT contributes only its base instance;
//     future occurrences do not appear. (A CalDAV time-range REPORT often expands
//     server-side, but we do not expand client-side.)
// Both are the reasons a future ical.js swap lives behind fetchWindow/normalizeICal.
const { ICLOUD_CALDAV } = require('../config');
const { isoDateStr } = require('../util');
const { syncProvider, SYNC_WINDOW_DAYS } = require('./provider');

function basicAuth(u, p) { return 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64'); }

async function caldavReq(url, method, body, username, password, depth = '0') {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuth(username, password),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: depth,
    },
    body,
  });
  if (r.status === 401) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
  if (!r.ok && r.status !== 207) throw new Error(`CalDAV ${method} ${r.status}: ${r.statusText}`);
  return { text: await r.text(), finalUrl: r.url };
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}
function xmlTagAll(xml, tag) {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'gi');
  const out = []; let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}
function xmlHref(block) {
  const m = block.match(/<(?:[^:>]+:)?href[^>]*>([^<]+)<\/(?:[^:>]+:)?href>/i);
  return m ? m[1].trim() : null;
}
function resolveHref(base, href) {
  if (/^https?:\/\//i.test(href)) return href;
  const u = new URL(base); return `${u.protocol}//${u.host}${href}`;
}
function parseVEvents(ical) {
  const text = ical.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const events = []; let ev = null;
  for (const line of text.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT')   { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const ci = line.indexOf(':'); if (ci < 0) continue;
    const key = line.slice(0, ci), val = line.slice(ci + 1);
    const base = key.split(';')[0].toUpperCase();
    ev[base] = { val, params: key.slice(base.length) };
  }
  return events;
}
function icalDate(prop) {
  if (!prop) return null;
  const allDay = /VALUE=DATE/i.test(prop.params) || /^\d{8}$/.test(prop.val.trim());
  const v   = prop.val.trim().replace(/Z$/, '');   // NB: TZID params are ignored — see file header
  const iso = `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
  return allDay ? { iso, time: null, allDay: true } : { iso, time: `${v.slice(9,11)}:${v.slice(11,13)}`, allDay: false };
}
function icalText(prop) {
  if (!prop?.val) return null;
  return prop.val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/* Pure: one calendar's raw ICS text → NormalizedEvent[]. Exported for TEST-8. */
function normalizeICal(icalRaw) {
  const out = [];
  for (const ev of parseVEvents(icalRaw)) {
    const start = icalDate(ev['DTSTART']), end = icalDate(ev['DTEND']);
    if (!start) continue;
    let end_date = null;
    if (start.allDay && end) {
      const ed = new Date(end.iso + 'T00:00:00Z'); ed.setDate(ed.getDate() - 1);   // DTEND is exclusive
      const s = isoDateStr(ed); if (s !== start.iso) end_date = s;
    } else if (!start.allDay && end && end.iso !== start.iso) {
      end_date = end.iso;
    }
    out.push({
      title: icalText(ev['SUMMARY']) || '(No title)',
      notes: icalText(ev['DESCRIPTION']),
      due_date: start.iso, scheduled_time: start.time, scheduled_end: end?.time || null,
      location: icalText(ev['LOCATION']), end_date,
    });
  }
  return out;
}

const icloudProvider = {
  id: 'icloud',
  async fetchWindow({ username, password }, days = SYNC_WINDOW_DAYS) {
    const { text: p0, finalUrl: base0 } = await caldavReq(
      ICLOUD_CALDAV, 'PROPFIND',
      `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
      username, password, '0'
    );
    const principalHref = xmlHref(xmlTag(p0, 'current-user-principal') || '');
    if (!principalHref) throw new Error('iCloud CalDAV: could not discover principal');

    const principalUrl = resolveHref(base0, principalHref);
    const { text: p1, finalUrl: base1 } = await caldavReq(
      principalUrl, 'PROPFIND',
      `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`,
      username, password, '0'
    );
    const homeHref = xmlHref(xmlTag(p1, 'calendar-home-set') || '');
    if (!homeHref) throw new Error('iCloud CalDAV: could not discover calendar home');

    const homeUrl = resolveHref(base1, homeHref);
    const { text: p2 } = await caldavReq(
      homeUrl, 'PROPFIND',
      `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>`,
      username, password, '1'
    );
    const calUrls = xmlTagAll(p2, 'response')
      .filter(b => /<(?:[^:>]+:)?calendar\s*\/>/i.test(b))
      .map(b => xmlHref(b)).filter(Boolean)
      .map(href => resolveHref(homeUrl, href));
    if (!calUrls.length) throw new Error('iCloud CalDAV: no calendars found');

    const now = new Date(), far = new Date(now.getTime() + days * 86400000);
    const startZ = now.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
    const endZ   = far.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';

    // Fetch + parse EVERY calendar first; if any REPORT fails, abort the whole sync
    // WITHOUT deleting (the throw propagates before syncProvider reaches the writer) —
    // a partial sync after a delete would silently drop the events of the failed
    // collection. Only once all calendars are in hand does the writer swap atomically.
    const events = [];
    for (const calUrl of calUrls) {
      let reportText;
      try {
        const { text } = await caldavReq(calUrl, 'REPORT',
          `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${startZ}" end="${endZ}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`,
          username, password, '1');
        reportText = text;
      } catch (e) {
        throw new Error(`iCloud sync aborted (calendar fetch failed): ${e.message}`);
      }

      const calDatas = xmlTagAll(reportText, 'calendar-data')
        .map(s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#13;/g,'\r'));

      for (const icalRaw of calDatas) events.push(...normalizeICal(icalRaw));
    }
    return events;
  },
};

/* Wrapper kept for the routes (unchanged signature). */
function syncICloudEvents(username, password, userId, force = false) {
  return syncProvider(icloudProvider, { username, password }, userId, { force });
}

module.exports = { normalizeICal, parseVEvents, icloudProvider, syncICloudEvents };
