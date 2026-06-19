'use strict';
const express      = require('express');
const path         = require('path');
const Database     = require('better-sqlite3');
const { google }   = require('googleapis');
const cookieParser = require('cookie-parser');
const { jkosAuth } = require('@jkos/auth-middleware');

/* ── Env ───────────────────────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 3001;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'beigeBoard.db');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'dist');
const SHELL_URL  = (process.env.SHELL_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Cross-origin allowlist. The suite directory (jkAuth app_registry) is the
   canonical list of app origins; ops mirrors it here via ALLOWED_ORIGINS (comma-
   separated) so a second suite app can call BeigeBoard cross-origin. SHELL_URL is
   always included for backward compatibility. */
const ALLOWED_ORIGINS = new Set(
  [SHELL_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
);

/* RSA public key from jkos-auth — used by jkosAuth middleware. Prefer JWKS-by-kid
   (key rotation, U3) when JKOS_AUTH_JWKS_URI is set; else verify against the
   static public key. */
const JKOS_AUTH_PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').trim();
const JKOS_AUTH_URL        = process.env.JKOS_AUTH_URL        || 'https://auth.jkos.net';
const JKOS_AUTH_ISSUER     = process.env.JKOS_AUTH_ISSUER     || 'jkos-auth';
const JKOS_AUTH_JWKS_URI   = (process.env.JKOS_AUTH_JWKS_URI  || '').trim();

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI
  || `http://localhost:${PORT}/api/auth/google/callback`;

const MS_CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MS_REDIRECT_URI  = process.env.MICROSOFT_REDIRECT_URI
  || `http://localhost:${PORT}/api/auth/outlook/callback`;
const MS_AUTH_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_GRAPH     = 'https://graph.microsoft.com/v1.0';

const LAZUROS_URL           = (process.env.LAZUROS_URL || 'http://localhost:8080').replace(/\/$/, '');
const LAZUROS_TOKEN         = process.env.LAZUROS_TOKEN         || '';
const LAZUROS_DEFAULT_MODEL = process.env.LAZUROS_DEFAULT_MODEL || 'llama3.2';
const BB_AI_ENABLED         = process.env.BB_AI_ENABLED === 'true';

/* ── Database ──────────────────────────────────────────────────────────── */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const run = (sql, p = []) => db.prepare(sql).run(...p);
const all = (sql, p = []) => db.prepare(sql).all(...p);
const get = (sql, p = []) => db.prepare(sql).get(...p);

/* ── Migrations ────────────────────────────────────────────────────────── */
const MIGRATIONS = [
  {
    id: 1, name: 'create_core_tables',
    up(d) {
      d.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          email         TEXT    UNIQUE NOT NULL,
          name          TEXT,
          avatar_url    TEXT,
          password_hash TEXT,
          google_id     TEXT    UNIQUE,
          role          TEXT    NOT NULL DEFAULT 'user',
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          last_login    TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash  TEXT    NOT NULL,
          expires_at  TEXT    NOT NULL,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS calendar_tokens (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider      TEXT    NOT NULL,
          access_token  TEXT,
          refresh_token TEXT,
          expiry_ms     INTEGER,
          email         TEXT,
          UNIQUE(user_id, provider)
        );
        CREATE TABLE IF NOT EXISTS items (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
          kind           TEXT    NOT NULL DEFAULT 'task',
          scope          TEXT    NOT NULL DEFAULT 'day',
          title          TEXT    NOT NULL,
          notes          TEXT,
          parent_id      INTEGER,
          accent         TEXT,
          source         TEXT    DEFAULT 'bb',
          completed      INTEGER DEFAULT 0,
          year           INTEGER,
          month          INTEGER,
          week_start     TEXT,
          due_date       TEXT,
          scheduled_time TEXT,
          scheduled_end  TEXT,
          end_date       TEXT,
          location       TEXT,
          attendees      INTEGER,
          target         TEXT,
          created_at     TEXT    DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    id: 2, name: 'migrate_legacy_schema',
    up(d) {
      try { d.exec(`ALTER TABLE items ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`); } catch (e) { if (!e.message?.includes('duplicate column')) throw e }
      try { d.exec(`ALTER TABLE items ADD COLUMN end_date TEXT`); } catch (e) { if (!e.message?.includes('duplicate column')) throw e }

      const ct = d.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='calendar_tokens'`).get();
      if (ct && !ct.sql.includes('user_id')) {
        d.exec(`
          ALTER TABLE calendar_tokens RENAME TO calendar_tokens_old;
          CREATE TABLE calendar_tokens (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            provider      TEXT    NOT NULL,
            access_token  TEXT,
            refresh_token TEXT,
            expiry_ms     INTEGER,
            email         TEXT,
            UNIQUE(user_id, provider)
          );
        `);
        d.exec(`DROP TABLE calendar_tokens_old`);
      }
    },
  },
  {
    id: 3, name: 'detach_user_fk',
    up(d) {
      /*
       * Auth is now handled by jkos-auth. Items and calendar_tokens store user_id
       * as a plain integer (jkos-auth user.id) with no local FK constraint, since
       * the users table in this DB is no longer authoritative.
       */
      d.pragma('foreign_keys = OFF');

      /* Rebuild items without FK to local users table */
      const itemsCols = `
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER,
        kind           TEXT    NOT NULL DEFAULT 'task',
        scope          TEXT    NOT NULL DEFAULT 'day',
        title          TEXT    NOT NULL,
        notes          TEXT,
        parent_id      INTEGER,
        accent         TEXT,
        source         TEXT    DEFAULT 'bb',
        completed      INTEGER DEFAULT 0,
        year           INTEGER,
        month          INTEGER,
        week_start     TEXT,
        due_date       TEXT,
        scheduled_time TEXT,
        scheduled_end  TEXT,
        end_date       TEXT,
        location       TEXT,
        attendees      INTEGER,
        target         TEXT,
        created_at     TEXT    DEFAULT (datetime('now'))
      `;
      d.exec(`
        CREATE TABLE items_new (${itemsCols});
        INSERT INTO items_new SELECT * FROM items;
        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;
      `);

      /* Rebuild calendar_tokens without FK to local users table */
      d.exec(`
        CREATE TABLE calendar_tokens_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL,
          provider      TEXT    NOT NULL,
          access_token  TEXT,
          refresh_token TEXT,
          expiry_ms     INTEGER,
          email         TEXT,
          UNIQUE(user_id, provider)
        );
        INSERT INTO calendar_tokens_new SELECT * FROM calendar_tokens;
        DROP TABLE calendar_tokens;
        ALTER TABLE calendar_tokens_new RENAME TO calendar_tokens;
      `);

      /* Drop sessions — superseded by jkos-auth sessions table */
      d.exec(`DROP TABLE IF EXISTS sessions`);

      d.pragma('foreign_keys = ON');
    },
  },
  {
    id: 4, name: 'cleanup_and_index',
    up(d) {
      // Drop the legacy users table — auth is fully delegated to jkos-auth (runs after migration 3
      // which has already removed all FK references to this table from items/calendar_tokens)
      d.exec(`DROP TABLE IF EXISTS users`);
      // Add missing indexes for per-user data queries
      d.exec(`CREATE INDEX IF NOT EXISTS idx_items_user           ON items(user_id)`);
      d.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_tokens_user ON calendar_tokens(user_id)`);
    },
  },
  {
    id: 5, name: 'goal_engine',
    up(d) {
      /*
       * The Breakdown Method (Documentation/PLANNING_METHOD.md). Goals carry a
       * definition of done + horizon; the old month/week calendar buckets become
       * ordered milestones flattened directly under their goal.
       */
      for (const col of ['done_means TEXT', 'target_date TEXT', 'position INTEGER', 'status TEXT']) {
        try { d.exec(`ALTER TABLE items ADD COLUMN ${col}`); }
        catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
      }

      d.exec(`UPDATE items SET status='active' WHERE kind='goal' AND scope='year' AND status IS NULL`);
      d.exec(`UPDATE items SET target_date = year || '-12-31'
              WHERE kind='goal' AND scope='year' AND year IS NOT NULL AND target_date IS NULL`);

      d.exec(`UPDATE items SET kind='milestone' WHERE kind='goal' AND scope IN ('month','week','project')`);

      /* Week themes lived under month goals — hoist until every milestone sits
         directly under its root goal. Depth shrinks each pass, so this terminates. */
      let changed = true;
      while (changed) {
        const r = d.prepare(`
          UPDATE items SET parent_id = (SELECT p.parent_id FROM items p WHERE p.id = items.parent_id)
          WHERE kind='milestone' AND parent_id IN (SELECT id FROM items WHERE kind='milestone')
        `).run();
        changed = r.changes > 0;
      }

      /* Milestones that lost their root (orphaned buckets) become goals so no data hides */
      d.exec(`UPDATE items SET kind='goal', status='active' WHERE kind='milestone' AND parent_id IS NULL`);

      /* Stable checkpoint order: original month, then week, then creation */
      const goals = d.prepare(`SELECT DISTINCT parent_id AS gid FROM items
                               WHERE kind='milestone' AND parent_id IS NOT NULL`).all();
      const setPos = d.prepare(`UPDATE items SET position=? WHERE id=?`);
      for (const { gid } of goals) {
        const ms = d.prepare(`SELECT id FROM items WHERE kind='milestone' AND parent_id=?
                              ORDER BY COALESCE(month, 99), COALESCE(week_start, '9999'), id`).all(gid);
        ms.forEach((m, i) => setPos.run(i, m.id));
      }
    },
  },
  // NOTE: ORDECK's pin/focus are NOT item columns. They live in the user's jkAuth
  // prefs (the suite-wide "HUD shelf"), so focus is one singleton across every app
  // and pins are a heterogeneous set — BeigeBoard doesn't carry another app's
  // surfacing concerns. See @jkos/auth-client useHudShelf.
  {
    id: 6, name: 'weave_interop_fields',
    up(d) {
      /*
       * Suite-fabric (Weave) interop surface so other apps can OWN and TRACK
       * BeigeBoard items they create, and poll cheaply:
       *   ext_ref    "<app>:<localId>" back-reference to the creating app's entity
       *   tags       JSON array for cross-app filtering (e.g. ["study","sylib:6.042"])
       *   updated_at bumped on every row UPDATE so consumers can poll ?since=
       */
      for (const col of ['ext_ref TEXT', "tags TEXT DEFAULT '[]'", 'updated_at TEXT']) {
        try { d.exec(`ALTER TABLE items ADD COLUMN ${col}`); }
        catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
      }
      d.exec(`UPDATE items SET updated_at = COALESCE(updated_at, created_at, datetime('now'))`);
      d.exec(`CREATE INDEX IF NOT EXISTS idx_items_ext_ref ON items(ext_ref)`);
      d.exec(`CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at)`);
      /* Touch updated_at on every UPDATE. The WHEN guard (NEW=OLD) means the
         trigger's own UPDATE doesn't re-fire it, so this is safe regardless of
         the recursive_triggers pragma. */
      d.exec(`DROP TRIGGER IF EXISTS items_touch_updated`);
      d.exec(`CREATE TRIGGER items_touch_updated AFTER UPDATE ON items
              FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
              BEGIN UPDATE items SET updated_at = datetime('now') WHERE id = NEW.id; END`);
    },
  },
];

function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id     INTEGER PRIMARY KEY,
    name   TEXT,
    run_at TEXT DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT id FROM migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (!applied.has(m.id)) {
      m.up(db);
      db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
      console.log(`[migration] applied: ${m.name}`);
    }
  }
}

/* ── Allowed column names for items table ──────────────────────────────── */
const ITEM_COLUMNS = new Set([
  'kind', 'scope', 'title', 'notes', 'parent_id', 'accent', 'source', 'completed',
  'year', 'month', 'week_start', 'due_date', 'scheduled_time', 'scheduled_end',
  'end_date', 'location', 'attendees', 'target',
  'done_means', 'target_date', 'position', 'status',
  'ext_ref', 'tags',   // Weave interop (updated_at is trigger-managed, not client-writable)
]);

/* Coerce a client value to its stored column form. `tags` is ALWAYS normalized to
   a JSON-array string (the shape toRow parses back and the ?tags= filter matches
   with LIKE '%"tag"%'): an array/object is JSON-encoded; a comma-separated string
   — what the createItem capability declares — is split into an array; existing
   JSON-array text passes through. Storing a raw CSV string here (the old bug) made
   toRow's JSON.parse throw, silently dropping every tag. Booleans → 0/1. */
function coerceColumn(k, v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (k === 'tags') {
    if (v == null) return v;
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return '[]';
      if (s.startsWith('[')) return s;   // already a JSON array
      return JSON.stringify(s.split(',').map(t => t.trim()).filter(Boolean));
    }
  }
  return v;
}

/* ── Safe JSON for embedding in <script> tags ──────────────────────────── */
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\//g, '\\u002f');
}

/* ── Google OAuth factory ──────────────────────────────────────────────── */
function makeOAuth2() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/* ── isoDateStr helpers ────────────────────────────────────────────────── */
function isoDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmt24(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ── Microsoft / Outlook helpers ───────────────────────────────────────── */
async function getMsToken(row) {
  if (!row.expiry_ms || Date.now() < row.expiry_ms - 60000) return row.access_token;
  const r = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      refresh_token: row.refresh_token, grant_type: 'refresh_token',
    }).toString(),
  });
  const t = await r.json();
  if (t.error) throw new Error(t.error_description || t.error);
  const expiry = Date.now() + (t.expires_in || 3600) * 1000;
  run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? WHERE id=?`,
    [t.access_token, expiry, row.id]);
  return t.access_token;
}

async function syncOutlookEvents(token, userId) {
  const now = new Date(), end = new Date(now.getTime() + 90 * 86400000);
  const url = `${MS_GRAPH}/me/calendarView`
    + `?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}`
    + `&$top=500&$select=subject,start,end,isAllDay,location,bodyPreview`;
  const r    = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);

  run("DELETE FROM items WHERE source='outlook' AND user_id=?", [userId]);
  for (const ev of data.value || []) {
    const isAllDay = !!ev.isAllDay;
    const sd = new Date(ev.start.dateTime + (ev.start.timeZone === 'UTC' ? 'Z' : ''));
    const ed = new Date(ev.end.dateTime   + (ev.end.timeZone   === 'UTC' ? 'Z' : ''));
    const due_date = isoDateStr(sd);
    let end_date = null;
    if (isAllDay) {
      const adj = new Date(ed); adj.setDate(adj.getDate() - 1);
      const s = isoDateStr(adj); if (s !== due_date) end_date = s;
    } else {
      const endStr = isoDateStr(ed);
      if (endStr !== due_date) end_date = endStr;
    }
    run(
      `INSERT INTO items (user_id,kind,scope,title,notes,source,due_date,scheduled_time,scheduled_end,location,end_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [userId,'event','day',ev.subject||'(No title)',ev.bodyPreview||null,'outlook',
       due_date, isAllDay?null:fmt24(sd), isAllDay?null:fmt24(ed),
       ev.location?.displayName||null, end_date]
    );
  }
  return (data.value||[]).length;
}

/* ── iCloud CalDAV helpers ─────────────────────────────────────────────── */
const ICLOUD_CALDAV = 'https://caldav.icloud.com';

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
  const v   = prop.val.trim().replace(/Z$/, '');
  const iso = `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
  return allDay ? { iso, time: null, allDay: true } : { iso, time: `${v.slice(9,11)}:${v.slice(11,13)}`, allDay: false };
}
function icalText(prop) {
  if (!prop?.val) return null;
  return prop.val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

async function syncICloudEvents(username, password, userId) {
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

  const now = new Date(), far = new Date(now.getTime() + 90 * 86400000);
  const startZ = now.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
  const endZ   = far.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';

  run("DELETE FROM items WHERE source='icloud' AND user_id=?", [userId]);
  let total = 0;

  for (const calUrl of calUrls) {
    let reportText;
    try {
      const { text } = await caldavReq(calUrl, 'REPORT',
        `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${startZ}" end="${endZ}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`,
        username, password, '1');
      reportText = text;
    } catch (e) { console.warn(`iCloud: skipping ${calUrl}: ${e.message}`); continue; }

    const calDatas = xmlTagAll(reportText, 'calendar-data')
      .map(s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#13;/g,'\r'));

    for (const icalRaw of calDatas) {
      for (const ev of parseVEvents(icalRaw)) {
        const start = icalDate(ev['DTSTART']), end = icalDate(ev['DTEND']);
        if (!start) continue;
        let end_date = null;
        if (start.allDay && end) {
          const ed = new Date(end.iso + 'T00:00:00Z'); ed.setDate(ed.getDate() - 1);
          const s = isoDateStr(ed); if (s !== start.iso) end_date = s;
        } else if (!start.allDay && end && end.iso !== start.iso) {
          end_date = end.iso;
        }
        run(
          `INSERT INTO items (user_id,kind,scope,title,notes,source,due_date,scheduled_time,scheduled_end,location,end_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [userId,'event','day', icalText(ev['SUMMARY'])||'(No title)',
           icalText(ev['DESCRIPTION']),'icloud',start.iso,start.time,end?.time||null,
           icalText(ev['LOCATION']),end_date]
        );
        total++;
      }
    }
  }
  return total;
}

async function syncGoogleEvents(auth, userId) {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 500,
  });

  run("DELETE FROM items WHERE source='google' AND user_id=?", [userId]);

  for (const ev of (data.items || [])) {
    const isAllDay = !!ev.start?.date;
    if (!ev.start?.dateTime && !ev.start?.date) continue;
    // Use date strings directly for all-day events — new Date("YYYY-MM-DD") parses as UTC
    // midnight and local getDate() returns the previous day in negative-offset timezones.
    const due_date = isAllDay
      ? ev.start.date
      : isoDateStr(new Date(ev.start.dateTime));
    const sd = isAllDay ? null : new Date(ev.start.dateTime);
    let end_date = null;
    if (ev.end) {
      if (isAllDay && ev.end.date) {
        // Google all-day end dates are exclusive — subtract one day
        const edArr = ev.end.date.split('-').map(Number);
        const edObj = new Date(edArr[0], edArr[1] - 1, edArr[2] - 1);
        const endStr = isoDateStr(edObj);
        if (endStr !== due_date) end_date = endStr;
      } else if (!isAllDay && ev.end.dateTime) {
        const edObj = new Date(ev.end.dateTime);
        const endStr = isoDateStr(edObj);
        if (endStr !== due_date) end_date = endStr;
      }
    }
    run(
      `INSERT INTO items (user_id,kind,scope,title,notes,source,due_date,scheduled_time,scheduled_end,location,end_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [userId,'event','day',ev.summary||'(No title)',ev.description||null,'google',
       due_date,
       sd ? fmt24(sd) : null,
       (!isAllDay && ev.end?.dateTime) ? fmt24(new Date(ev.end.dateTime)) : null,
       ev.location||null, end_date]
    );
  }
  return (data.items||[]).length;
}

/* ── Express app ───────────────────────────────────────────────────────── */
const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ── Auth middleware (jkos SSO) ────────────────────────────────────────── */
/* These API paths are reachable without a valid jkos_token cookie */
const PUBLIC_PATHS = [
  '/api/auth/google',     // initiates Google Calendar OAuth
  '/api/auth/outlook',    // initiates Outlook Calendar OAuth
  '/api/capabilities',    // Weave capability declaration — public, no secrets
];

if (!JKOS_AUTH_PUBLIC_KEY && !JKOS_AUTH_JWKS_URI && process.env.NODE_ENV === 'production') {
  console.error('[boot] FATAL: neither JKOS_AUTH_PUBLIC_KEY nor JKOS_AUTH_JWKS_URI is set in production. Refusing to start.');
  process.exit(1);
}
const authMiddleware = JKOS_AUTH_JWKS_URI
  ? jkosAuth({ jwksUri: JKOS_AUTH_JWKS_URI, issuer: JKOS_AUTH_ISSUER })
  : JKOS_AUTH_PUBLIC_KEY
    ? jkosAuth({ publicKey: JKOS_AUTH_PUBLIC_KEY, issuer: JKOS_AUTH_ISSUER })
    : (req, _res, next) => { req.user = { sub: 1, role: 'admin' }; next(); }; // dev fallback (non-prod only)

/* Only the API carries user data and is gated. The SPA shell and assets are
   public so a logged-out browser loads the app, gets 401 from /api/auth/me,
   and is redirected to jkAuth — instead of a raw 401 in place of the page. */
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (PUBLIC_PATHS.some(p => req.path === p)) return next();
  authMiddleware(req, res, next);
});

/* Write authorization — three gates, most-specific first. (Reads need no extra
   gate beyond a valid token; every row is already scoped to req.user.sub.) */
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const u = req.user;
  // 1. Guests are read-only.
  if (u?.role === 'guest') {
    return res.status(403).json({ error: 'Guest access is read-only' });
  }
  // 2. A service token carries no user (sub is 'svc:<id>', not a numeric id), so a
  //    per-user write would create orphan rows owned by a non-user. Reject until an
  //    explicit on-behalf-of mechanism exists. (Weave service tokens, Phase 4.)
  if (u?.typ === 'service') {
    return res.status(403).json({ error: 'Service tokens cannot write per-user data', code: 'NO_USER_CONTEXT' });
  }
  // 3. Capability scope enforcement: a token carrying scopes must hold
  //    beigeboard:write. Tokens minted before Weave carry no scope array and fall
  //    through to the role gate above (rollout-safe — see Documentation/WEAVE.md).
  if (Array.isArray(u?.scope) && !u.scope.includes('beigeboard:write')) {
    return res.status(403).json({ error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPE', required: ['beigeboard:write'] });
  }
  next();
});

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'beigeboard' }));

/* ── Weave capability declaration ──────────────────────────────────────────
   What can be DONE to BeigeBoard, as pure data. The portal (and eventually an
   AI step) discovers this at GET /api/bb/capabilities and composes write widgets
   against it — no portal code per action. Public; the resource routes still
   enforce auth + scope. See Documentation/WEAVE.md. */
const CAPABILITIES = {
  app: 'beigeboard',
  version: 1,
  capabilities: [
    {
      id: 'createItem', label: 'Add a task', method: 'POST', path: '/items',
      body: [
        { name: 'title',          type: 'string', label: 'Title', required: true, max: 200 },
        { name: 'due_date',       type: 'date',   label: 'Due date' },
        { name: 'scheduled_time', type: 'time',   label: 'Time' },
        { name: 'notes',          type: 'text',   label: 'Notes' },
        { name: 'kind',           type: 'enum',   label: 'Kind', enum: ['task', 'event'], default: 'task' },
        { name: 'tags',           type: 'string', label: 'Tags (comma-separated)' },
        { name: 'ext_ref',        type: 'string', label: 'External ref' },
      ],
      invalidates: ['bb.items'], scopes: ['beigeboard:write'],
    },
    {
      id: 'completeItem', label: 'Mark done', method: 'PATCH', path: '/items/:id',
      body: [
        { name: 'id',        type: 'number',  label: 'Item id', required: true },
        { name: 'completed', type: 'boolean', label: 'Completed', required: true, default: true },
      ],
      invalidates: ['bb.items'], scopes: ['beigeboard:write'],
    },
    {
      id: 'deleteItem', label: 'Delete', method: 'DELETE', path: '/items/:id',
      body: [{ name: 'id', type: 'number', label: 'Item id', required: true }],
      invalidates: ['bb.items'], scopes: ['beigeboard:write'],
    },
  ],
};
app.get('/api/capabilities', (_req, res) => res.json(CAPABILITIES));

/* ── Auth: me ──────────────────────────────────────────────────────────── */
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user });
});

/* ── Auth: Google Calendar OAuth ───────────────────────────────────────── */
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(501).send('Google credentials not configured.');
  }
  const url = makeOAuth2().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  const close = (msg) => res.send(
    `<script>window.opener?.postMessage(${safeJson(msg)},window.location.origin);window.close();</script>`
  );
  if (error) return close({ type: 'google-auth-error', error });

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
      [req.user.sub, 'google', tokens.access_token, tokens.refresh_token||null, tokens.expiry_date||null, req.user.email||null]
    );

    oauth2.on('tokens', t => {
      run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? ${t.refresh_token?',refresh_token=?':''} WHERE user_id=? AND provider='google'`,
        t.refresh_token ? [t.access_token, t.expiry_date, t.refresh_token, req.user.sub] : [t.access_token, t.expiry_date, req.user.sub]);
    });

    try { await syncGoogleEvents(oauth2, req.user.sub); } catch (e) { console.warn('Google calendar sync:', e.message); }

    close({ type: 'google-auth-success', email: req.user.email });
  } catch (e) {
    console.error('Google callback error:', e);
    close({ type: 'google-auth-error', error: e.message });
  }
});

/* ── Auth: Outlook Calendar OAuth ──────────────────────────────────────── */
app.get('/api/auth/outlook', (req, res) => {
  if (!MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    return res.status(501).send('Microsoft credentials not configured.');
  }
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID, response_type: 'code',
    redirect_uri: MS_REDIRECT_URI,
    scope: 'offline_access Calendars.Read User.Read',
    response_mode: 'query',
  });
  res.redirect(`${MS_AUTH_URL}?${params}`);
});

app.get('/api/auth/outlook/callback', async (req, res) => {
  const { code, error } = req.query;
  const close = (msg) => res.send(
    `<script>window.opener?.postMessage(${safeJson(msg)},window.location.origin);window.close();</script>`
  );
  if (error) return close({ type: 'outlook-auth-error', error });

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
      [req.user.sub, 'outlook', t.access_token, t.refresh_token||null, expiry, email]
    );

    await syncOutlookEvents(t.access_token, req.user.sub);
    close({ type: 'outlook-auth-success', email });
  } catch (e) {
    console.error('Outlook callback error:', e);
    close({ type: 'outlook-auth-error', error: e.message });
  }
});

/* ── Items ─────────────────────────────────────────────────────────────── */
function toRow(raw) {
  if (!raw) return null;
  let tags = [];
  if (raw.tags) { try { tags = JSON.parse(raw.tags); } catch { tags = []; } }
  return { ...raw, completed: raw.completed === 1, tags };
}

function cascadeDeleteInner(id, userId) {
  const children = all('SELECT id FROM items WHERE parent_id = ? AND user_id = ?', [id, userId]);
  for (const c of children) cascadeDeleteInner(c.id, userId);
  run('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId]);
}
const cascadeDelete = db.transaction((id, userId) => cascadeDeleteInner(id, userId));

app.get('/api/items', async (req, res) => {
  try {
    /* Server-side filters so other suite apps fetch only what they own/need
       instead of dumping every row: by kind/scope/due_date, by ext_ref prefix
       (an app's own items), by tag, and by ?since= (deltas via updated_at). */
    const q = req.query;
    const clauses = ['user_id = ?'];
    const params  = [req.user.sub];
    if (q.kind)            { clauses.push('kind = ?');        params.push(String(q.kind)); }
    if (q.scope)           { clauses.push('scope = ?');       params.push(String(q.scope)); }
    if (q.due_date)        { clauses.push('due_date = ?');    params.push(String(q.due_date)); }
    if (q.ext_ref_prefix)  { clauses.push('ext_ref LIKE ?');  params.push(String(q.ext_ref_prefix) + '%'); }
    if (q.since)           { clauses.push('updated_at > ?');  params.push(String(q.since)); }
    if (q.tags) {
      for (const t of String(q.tags).split(',').map(s => s.trim()).filter(Boolean)) {
        clauses.push('tags LIKE ?'); params.push('%"' + t + '"%');   // matches a JSON-array element
      }
    }
    const where    = clauses.join(' AND ');
    const filtered = Object.keys(q).length > 0;
    let rows = all(`SELECT * FROM items WHERE ${where} ORDER BY id ASC`, params);
    // Lazy first-run seed only for an unfiltered, empty, non-guest account — a
    // filter returning nothing must NOT trigger seeding.
    if (rows.length === 0 && !filtered && req.user.role !== 'guest') {
      await seedDefaults(req.user.sub);
      rows = all(`SELECT * FROM items WHERE ${where} ORDER BY id ASC`, params);
    }
    res.json(rows.map(toRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/items', (req, res) => {
  try {
    const raw  = req.body;
    if (!raw?.title?.toString().trim()) return res.status(400).json({ error: 'title is required' });
    const d    = { user_id: req.user.sub };
    for (const k of Object.keys(raw)) {
      if (ITEM_COLUMNS.has(k)) d[k] = coerceColumn(k, raw[k]);
    }
    const keys = Object.keys(d);
    const cols = keys.join(', ');
    const phs  = keys.map(() => '?').join(', ');
    const r    = run(`INSERT INTO items (${cols}) VALUES (${phs})`, keys.map(k => d[k]));
    const row  = get('SELECT * FROM items WHERE id = ?', [r.lastInsertRowid]);
    res.status(201).json(toRow(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/items/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const raw = req.body;
    const valid = Object.keys(raw).filter(k => ITEM_COLUMNS.has(k));
    if (!valid.length) return res.status(400).json({ error: 'No valid fields to update' });
    const sets = valid.map(k => `${k} = ?`).join(', ');
    const vals = valid.map(k => coerceColumn(k, raw[k]));
    run(`UPDATE items SET ${sets} WHERE id = ? AND user_id = ?`, [...vals, id, req.user.sub]);
    const row = get('SELECT * FROM items WHERE id = ? AND user_id = ?', [id, req.user.sub]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(toRow(row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = get('SELECT id FROM items WHERE id = ? AND user_id = ?', [id, req.user.sub]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    cascadeDelete(id, req.user.sub);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Calendar status routes ────────────────────────────────────────────── */
app.get('/api/auth/google/status', (req, res) => {
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'google']);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/auth/google', (req, res) => {
  try {
    run("DELETE FROM calendar_tokens WHERE user_id=? AND provider='google'", [req.user.sub]);
    run("DELETE FROM items WHERE source='google' AND user_id=?", [req.user.sub]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calendar/google/sync', async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'google']);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const oauth2 = makeOAuth2();
    oauth2.setCredentials({ access_token: row.access_token, refresh_token: row.refresh_token, expiry_date: row.expiry_ms });
    oauth2.on('tokens', t => {
      run(`UPDATE calendar_tokens SET access_token=?, expiry_ms=? ${t.refresh_token?',refresh_token=?':''} WHERE id=?`,
        t.refresh_token ? [t.access_token, t.expiry_date, t.refresh_token, row.id] : [t.access_token, t.expiry_date, row.id]);
    });
    const count = await syncGoogleEvents(oauth2, req.user.sub);
    res.json({ ok: true, synced: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/outlook/status', (req, res) => {
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'outlook']);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/auth/outlook', (req, res) => {
  try {
    run("DELETE FROM calendar_tokens WHERE user_id=? AND provider='outlook'", [req.user.sub]);
    run("DELETE FROM items WHERE source='outlook' AND user_id=?", [req.user.sub]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calendar/outlook/sync', async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'outlook']);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const token = await getMsToken(row);
    const count = await syncOutlookEvents(token, req.user.sub);
    res.json({ ok: true, synced: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/icloud/status', (req, res) => {
  try {
    const row = get('SELECT email FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'icloud']);
    res.json({ connected: !!row, email: row?.email || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/icloud', async (req, res) => {
  const { username, appPassword } = req.body || {};
  if (!username || !appPassword) return res.status(400).json({ error: 'username and appPassword required' });
  try {
    const count = await syncICloudEvents(username, appPassword, req.user.sub);
    run(
      `INSERT INTO calendar_tokens (user_id,provider,access_token,email)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id,provider) DO UPDATE SET access_token=excluded.access_token, email=excluded.email`,
      [req.user.sub, 'icloud', appPassword, username]
    );
    res.json({ ok: true, synced: count, email: username });
  } catch (e) {
    res.status(e.status === 401 ? 401 : 500).json({ error: e.message });
  }
});

app.delete('/api/auth/icloud', (req, res) => {
  try {
    run("DELETE FROM calendar_tokens WHERE user_id=? AND provider='icloud'", [req.user.sub]);
    run("DELETE FROM items WHERE source='icloud' AND user_id=?", [req.user.sub]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calendar/icloud/sync', async (req, res) => {
  try {
    const row = get('SELECT * FROM calendar_tokens WHERE user_id=? AND provider=?', [req.user.sub, 'icloud']);
    if (!row) return res.status(401).json({ error: 'Not connected' });
    const count = await syncICloudEvents(row.email, row.access_token, req.user.sub);
    res.json({ ok: true, synced: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── AI endpoint ───────────────────────────────────────────────────────── */
app.post('/api/ai/parse-task', async (req, res) => {
  if (!BB_AI_ENABLED) return res.status(503).json({ error: 'AI parsing is not enabled on this instance.' });
  try {
    const { text, today } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const trimmed = text.trim().slice(0, 500);

    const todayStr    = today || new Date().toISOString().split('T')[0];
    const d           = new Date(todayStr + 'T12:00:00');
    const tomorrowStr = new Date(d.getTime() + 86400000).toISOString().split('T')[0];
    const dayName     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];

    const prompt = `Parse this task or event description into structured JSON fields.

Description: "${trimmed}"

Context:
- Today is ${dayName} ${todayStr}
- Tomorrow is ${tomorrowStr}
- Resolve relative dates like "tomorrow", "friday", "next week" to YYYY-MM-DD

Return ONLY a JSON object with exactly these fields:
{
  "title": "clean title without date/time info",
  "kind": "task" or "event",
  "scope": "day" or "week" or "month",
  "due_date": "YYYY-MM-DD" or null,
  "scheduled_time": "HH:MM" (24h) or null,
  "notes": "extra context" or null
}`;

    const aiHeaders = { 'Content-Type': 'application/json' };
    if (LAZUROS_TOKEN) aiHeaders['Authorization'] = `Bearer ${LAZUROS_TOKEN}`;

    const r = await fetch(`${LAZUROS_URL}/api/chat`, {
      method: 'POST',
      headers: aiHeaders,
      body: JSON.stringify({
        model: LAZUROS_DEFAULT_MODEL,
        messages: [
          { role: 'system', content: 'You are a JSON API. Respond with a single valid JSON object only. No markdown, no explanation.' },
          { role: 'user',   content: prompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!r.ok) {
      const err = await r.text().catch(() => r.status);
      return res.status(502).json({ error: `LazurOS error: ${err}` });
    }

    const aiData = await r.json();
    const raw    = aiData?.message?.content ?? '';
    const start  = raw.indexOf('{');
    const end    = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) return res.status(502).json({ error: 'AI returned no JSON', raw });

    let parsed;
    try {
      parsed = JSON.parse(raw.slice(start, end));
    } catch {
      return res.status(502).json({ error: 'AI returned malformed JSON', raw });
    }
    res.json(parsed);
  } catch (e) {
    console.error('[ai/parse-task]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── AI: draft a goal ladder (Breakdown Method step 2) ─────────────────── */
app.post('/api/ai/breakdown', async (req, res) => {
  if (!BB_AI_ENABLED) return res.status(503).json({ error: 'AI is not enabled on this instance.' });
  try {
    const { title, done_means, target_date } = req.body || {};
    if (!title?.toString().trim()) return res.status(400).json({ error: 'title is required' });

    const prompt = `You are helping break a long-term goal into checkpoints and first actions.

Goal: "${title.toString().slice(0, 200)}"
${done_means ? `Done means: "${done_means.toString().slice(0, 300)}"` : ''}
${target_date ? `Target date: ${target_date.toString().slice(0, 10)}` : ''}

Rules:
- 2 to 5 milestones: verifiable checkpoints in order, each provable when passed.
- 2 to 4 first_actions: concrete tasks toward ONLY the first milestone, each small enough to finish in one sitting.
- Plain language, no numbering in the text itself.

Return ONLY a JSON object: {"milestones": ["...", ...], "first_actions": ["...", ...]}`;

    const aiHeaders = { 'Content-Type': 'application/json' };
    if (LAZUROS_TOKEN) aiHeaders['Authorization'] = `Bearer ${LAZUROS_TOKEN}`;

    const r = await fetch(`${LAZUROS_URL}/api/chat`, {
      method: 'POST',
      headers: aiHeaders,
      body: JSON.stringify({
        model: LAZUROS_DEFAULT_MODEL,
        messages: [
          { role: 'system', content: 'You are a JSON API. Respond with a single valid JSON object only. No markdown, no explanation.' },
          { role: 'user',   content: prompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => r.status);
      return res.status(502).json({ error: `LazurOS error: ${err}` });
    }

    const aiData = await r.json();
    const raw    = aiData?.message?.content ?? '';
    const start  = raw.indexOf('{');
    const end    = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) return res.status(502).json({ error: 'AI returned no JSON' });

    let parsed;
    try { parsed = JSON.parse(raw.slice(start, end)); }
    catch { return res.status(502).json({ error: 'AI returned malformed JSON' }); }

    const clean = (arr, max) => (Array.isArray(arr) ? arr : [])
      .filter(s => typeof s === 'string' && s.trim())
      .map(s => s.trim().slice(0, 200))
      .slice(0, max);

    res.json({ milestones: clean(parsed.milestones, 5), first_actions: clean(parsed.first_actions, 4) });
  } catch (e) {
    console.error('[ai/breakdown]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── Static + SPA fallback ─────────────────────────────────────────────── */
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(STATIC_DIR));
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'), err => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

/* ── Seed defaults (lazy, on first item load per user) ─────────────────── */
/* One example goal shaped by the Breakdown Method: a defined finish line,
   ordered checkpoints, and the first actions already committed to days. */
async function seedDefaults(userId) {
  const now = new Date();
  const todayStr    = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const targetStr   = `${now.getFullYear()}-12-31`;

  const ins = (data) => {
    const cols = Object.keys(data).join(', ');
    const phs  = Object.keys(data).map(() => '?').join(', ');
    const r = run(`INSERT INTO items (${cols}) VALUES (${phs})`, Object.values(data));
    return r.lastInsertRowid;
  };

  const g = ins({
    user_id: userId, kind: 'goal', scope: 'year', status: 'active',
    title: 'Build something meaningful',
    done_means: 'A working project I can show someone, live and usable',
    target_date: targetStr, accent: '#B85C3A', source: 'bb',
  });
  const m1 = ins({ user_id: userId, kind:'milestone', parent_id: g, position: 0, title: 'Decide what to build',     accent: '#B85C3A', source: 'bb' });
  ins({ user_id: userId, kind:'milestone', parent_id: g, position: 1, title: 'A rough working prototype', accent: '#B85C3A', source: 'bb' });
  ins({ user_id: userId, kind:'milestone', parent_id: g, position: 2, title: 'Polished and shared',       accent: '#B85C3A', source: 'bb' });
  ins({ user_id: userId, kind:'task', scope:'day', parent_id: m1, title: 'Write down three project ideas',           accent: '#B85C3A', due_date: todayStr,    source: 'bb' });
  ins({ user_id: userId, kind:'task', scope:'day', parent_id: m1, title: 'Pick one and sketch its single core feature', accent: '#B85C3A', due_date: tomorrowStr, source: 'bb' });
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
function boot() {
  runMigrations();
  app.listen(PORT, () => console.log(`BeigeBoard running on :${PORT}`));
}

boot();
