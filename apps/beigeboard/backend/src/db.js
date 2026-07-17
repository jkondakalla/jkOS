'use strict';
// Database layer: opens the SQLite handle, runs migrations (on require, once,
// exactly as the old monolith did at startup via boot()), and exposes the tiny
// run/all/get helpers. Mirrors jkAuth's src/db.js.
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

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
  {
    id: 7, name: 'stamp_updated_at_on_insert',
    up(d) {
      /*
       * BUG FIX: migration 6 added `updated_at` with no DEFAULT and only an AFTER
       * UPDATE touch-trigger, so every INSERT (createItem, /import, calendar sync,
       * seed) left it NULL. The weave delta contract — GET /api/items?since=<cursor>
       * → `updated_at > ?` — silently drops NULLs (NULL > x is never true), so a peer
       * doing incremental sync NEVER saw a newly-created item, only later-edited ones.
       * Stamp it on insert too, and backfill rows already written NULL.
       * (The WHEN guard keeps it a no-op when a value is supplied; with SQLite's
       * default recursive_triggers=OFF the inner UPDATE won't re-fire items_touch_updated.)
       */
      d.exec(`UPDATE items SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL`);
      d.exec(`DROP TRIGGER IF EXISTS items_stamp_inserted`);
      d.exec(`CREATE TRIGGER items_stamp_inserted AFTER INSERT ON items
              FOR EACH ROW WHEN NEW.updated_at IS NULL
              BEGIN UPDATE items SET updated_at = COALESCE(NEW.created_at, datetime('now')) WHERE id = NEW.id; END`);
    },
  },
  {
    id: 8, name: 'ms_resolution_updated_at',
    up(d) {
      /*
       * BUG FIX (BUG-6.1): the weave delta contract — GET /api/items?since=<cursor>
       * → `updated_at > ?` — filtered at SECOND resolution, because datetime('now')
       * stamps 'YYYY-MM-DD HH:MM:SS'. Two writes in the SAME second get an identical
       * stamp, so a consumer whose cursor sits on the first NEVER sees the second
       * (strict >, and second == cursor is not >). Move to millisecond ISO stamps
       * ('YYYY-MM-DDTHH:MM:SS.SSSZ' — still lexically == chronologically sortable).
       *
       * Reformat EVERY existing row in the same pass: a column carrying a mix of the
       * old 'space' format and the new 'T' format would sort WRONG ('T' 0x54 > ' '
       * 0x20, so any T-row sorts after any space-row regardless of real time). One
       * format, whole column, no mixed-format delta window.
       */
      d.exec(`UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) WHERE updated_at IS NOT NULL`);
      d.exec(`DROP TRIGGER IF EXISTS items_touch_updated`);
      d.exec(`CREATE TRIGGER items_touch_updated AFTER UPDATE ON items
              FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
              BEGIN UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END`);
      d.exec(`DROP TRIGGER IF EXISTS items_stamp_inserted`);
      d.exec(`CREATE TRIGGER items_stamp_inserted AFTER INSERT ON items
              FOR EACH ROW WHEN NEW.updated_at IS NULL
              BEGIN UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END`);
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

// Run migrations once, at require time — the DB is ready before any route or the
// listen() call touches it (the monolith did this in boot() before app.listen).
runMigrations();

module.exports = { db, run, all, get, MIGRATIONS, runMigrations };
