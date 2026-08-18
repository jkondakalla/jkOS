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
  {
    id: 9, name: 'routines',
    up(d) {
      /*
       * ROUTINES — the cadence engine (Documentation/PLANNING_METHOD.md).
       *
       * A routine (kind:'routine') declares WHEN a habit repeats; its occurrences
       * are ordinary kind:'task' rows minted under it. See src/item-fields.js for
       * what the two columns mean and src/routines.js for the mint rules.
       */
      for (const col of ['cadence_days TEXT', 'cadence_count INTEGER']) {
        try { d.exec(`ALTER TABLE items ADD COLUMN ${col}`); }
        catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
      }

      /*
       * ONE OCCURRENCE PER ROUTINE PER DAY, enforced by the database rather than
       * by the materializer being careful.
       *
       * The materializer is idempotent — it runs on every unfiltered GET /api/items,
       * so it re-asks "does 2026-08-14 exist for routine 42?" many times a session.
       * A check-then-insert is a race under concurrent requests (two tabs, or a tab
       * plus a peer app polling), and losing that race writes a DUPLICATE occurrence
       * that then shows up twice on the day and double-counts in the streak. So the
       * uniqueness lives here and the mint uses INSERT OR IGNORE: the loser of the
       * race writes nothing and neither request errors.
       *
       * The key is `ext_ref = 'routine:<routineId>:<YYYY-MM-DD>'` rather than
       * (parent_id, due_date), for two reasons. (1) A FLOAT occurrence has NO
       * due_date (it sits on the week bench), so a due_date-based key can't name it
       * — its ext_ref carries the week instead. (2) ext_ref is already the declared
       * "back-reference to the creating entity" and is already exposed to peers
       * through the dataset's ext_ref_prefix filter, so `?ext_ref_prefix=routine:`
       * gives any app the occurrence list for free.
       *
       * Partial (the LIKE guard) so it constrains ONLY routine occurrences: other
       * apps write their own ext_refs through the weave interop surface and must
       * stay free to repeat them.
       */
      d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_items_routine_occurrence
              ON items(user_id, ext_ref)
              WHERE ext_ref IS NOT NULL AND ext_ref LIKE 'routine:%'`);
    },
  },
  {
    id: 10, name: 'routine_spec_and_library',
    up(d) {
      /*
       * THE ROUTINE PRIMITIVE — content, progression, and the record of what
       * actually happened. See src/routine-spec.js for the document itself.
       *
       * Migration 9 gave a routine a CADENCE. It still had no CONTENT: every
       * occurrence it minted was a copy of the routine's title, so "Push Day"
       * produced fourteen rows called "Push Day" and there was nowhere to say what
       * a push day consists of, let alone how it gets harder. These four columns
       * are that missing half, split by WHO OWNS EACH ONE:
       *
       *   spec          on the ROUTINE. The document: steps, progression rules,
       *                 phases, variant ladders. Rules, never numbers.
       *   prescription  on the OCCURRENCE. The document RENDERED at that
       *                 occurrence's cycle — concrete numbers, frozen.
       *   cycle_index   on the OCCURRENCE. Which cycle it rendered at, so the
       *                 snapshot can be explained and re-derived.
       *   performed     on the OCCURRENCE. What the user actually did.
       *
       * WHY A JSON COLUMN AND NOT TABLES. The alternative was `routine_steps` +
       * `routine_progressions` + a `routine_log`, and it loses on all three axes
       * that matter here. (1) The occurrence would stop being ONE ROW, and "an
       * occurrence is an ordinary task row" is the property migration 9 bought and
       * that every downstream surface — Today, Week, Calendar, the ORDECK widgets,
       * the weave `items` dataset — depends on for free. (2) A rendered
       * prescription is a SNAPSHOT, not live data: it is never queried across
       * rows, never joined, never aggregated in SQL — it is read whole, with its
       * row, exactly once per render. That is the shape a blob is for. (3) The
       * document has to round-trip verbatim to and from an AI author; five tables
       * would need a serialiser that could disagree with the parser.
       *
       * What we give up is querying INTO the document from SQL ("every routine
       * with a squat in it"). That is a real cost and it is accepted: it is a
       * search feature over a per-user set of at most a few dozen routines, which
       * is a scan in JS, not an index.
       *
       * All four are NULL on every other kind and on every routine that has not
       * been given a document — a bare cadence routine keeps working exactly as it
       * did, which is what makes this migration additive rather than a rewrite.
       */
      for (const col of [
        'spec TEXT', 'prescription TEXT', 'performed TEXT', 'cycle_index INTEGER',
      ]) {
        try { d.exec(`ALTER TABLE items ADD COLUMN ${col}`); }
        catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
      }

      /*
       * THE LIBRARY — the organised set of sub-tasks a routine pulls steps from.
       * Exercises for training, recipes for cooking, pieces for practice: one
       * mechanism, discriminated by `collection`.
       *
       * A SEPARATE TABLE, not `kind:'library'` rows in `items`. A library entry is
       * not a plan item: it has no date, no parent, no completion, and it must
       * never appear in a tree walk, a rollup, a calendar query, or the weave
       * `items` dataset. Giving it a kind would mean every one of those surfaces
       * grows a filter to exclude it — the exact tax the routine-occurrence design
       * was built to avoid paying.
       *
       * WHY IT EARNS ITS KEEP. It is what makes a routine authorable by something
       * that does not know anything: an agent reads the library, writes
       * `{ ref: 'back-squat', sets: 5 }`, and the normaliser fills in the unit, the
       * load unit, the rest interval, the variant ladder and a sane progression.
       * The library is the vocabulary; the spec is the sentence.
       *
       * `defaults` and `variants` are JSON for the same reason `spec` is — they are
       * fragments OF a spec, read whole, and a second representation of the same
       * shape is a second thing to keep in sync.
       */
      d.exec(`
        CREATE TABLE IF NOT EXISTS library (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL,
          collection  TEXT    NOT NULL DEFAULT 'exercise',
          slug        TEXT    NOT NULL,
          title       TEXT    NOT NULL,
          notes       TEXT,
          unit        TEXT,
          load_unit   TEXT,
          tags        TEXT,
          variants    TEXT,
          defaults    TEXT,
          source      TEXT    DEFAULT 'bb',
          created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at  TEXT
        )`);

      /* Identity is (user, collection, slug) — the same key a spec's `ref` names.
         Unique so that re-importing a library document UPDATES rather than
         duplicating, which is what makes the import idempotent and therefore safe
         to hand to a retrying agent. */
      d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_library_slug
              ON library(user_id, collection, slug)`);

      /* Same millisecond-ISO delta discipline the items table settled on in
         migration 8 — a peer polling the library needs the same strict-`>` cursor
         to be safe against two writes in one second. */
      d.exec(`DROP TRIGGER IF EXISTS library_touch_updated`);
      d.exec(`CREATE TRIGGER library_touch_updated AFTER UPDATE ON library
              FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
              BEGIN UPDATE library SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END`);
      d.exec(`DROP TRIGGER IF EXISTS library_stamp_inserted`);
      d.exec(`CREATE TRIGGER library_stamp_inserted AFTER INSERT ON library
              FOR EACH ROW WHEN NEW.updated_at IS NULL
              BEGIN UPDATE library SET updated_at = NEW.created_at WHERE id = NEW.id; END`);
    },
  },
  {
    id: 11, name: 'routine_cadence_deload_revisions',
    up(d) {
      /*
       * ROUTINE WAVE 2 — the three things migration 10 left unsaid.
       *
       *   cadence_rule     WHEN, beyond a weekly grid. Empty (the default, and what
       *                    every existing routine is) means weekly via
       *                    cadence_days/cadence_count. Otherwise a tiny positional
       *                    grammar — `every_n_days:3`, `monthly:15`, `monthly:last`,
       *                    `rolling:3`, `rrule:FREQ=WEEKLY;...` — parsed by
       *                    parseCadence() in routine-spec.js. A STRING and not a
       *                    second JSON document because both an author and a
       *                    validator have to read it, and a nested object here would
       *                    be a second thing to keep in sync with `spec`.
       *
       *   deload_override  On an OCCURRENCE: "take this one easy". Renders the
       *                    session at the deload factor regardless of the
       *                    programme's own deload cadence, AND gives it no rung on
       *                    the cycle ladder, so taking it easy costs no progress.
       *                    A per-occurrence column rather than a spec edit because
       *                    it is a decision about one day, not a change to the plan.
       *                    NULL = follow the programme; 1 = forced light; 0 = forced
       *                    normal (an explicit override of a programmed deload).
       *
       *   spec_version     On a ROUTINE: which revision its document is on, bumped
       *                    on every spec write and stamped into each occurrence's
       *                    prescription as `sv`.
       *
       * Additive and NULL-safe throughout: a routine that predates all three keeps
       * behaving exactly as it did, which is the same property migration 10 held to.
       */
      for (const col of ['cadence_rule TEXT', 'deload_override INTEGER', 'spec_version INTEGER']) {
        try { d.exec(`ALTER TABLE items ADD COLUMN ${col}`); }
        catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
      }

      /*
       * ROUTINE REVISIONS — the history that makes a frozen snapshot legible.
       *
       * An occurrence's prescription is deliberately frozen, so last March keeps
       * saying 5 × 5. What it could not say was WHY — the rule that produced it is
       * long overwritten, and "5 × 5" with no way back to the document that asked
       * for it is a number without a reason. Every spec write appends the previous
       * document here, keyed by the version the snapshots stamp, so
       * `prescription.sv` → `routine_revisions.version` closes that loop.
       *
       * APPEND-ONLY and never rewritten: this is the one table in the app whose
       * whole value is that it is not current. Pruning is a policy question for
       * later (it grows one row per spec edit, which is a human-rate event); it is
       * deliberately not automatic, because silently discarding the reason for a
       * number is the failure the table exists to prevent.
       */
      d.exec(`
        CREATE TABLE IF NOT EXISTS routine_revisions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL,
          routine_id  INTEGER NOT NULL,
          version     INTEGER NOT NULL,
          spec        TEXT,
          summary     TEXT,
          note        TEXT,
          created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )`);
      d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_revisions_version
              ON routine_revisions(user_id, routine_id, version)`);
      d.exec(`CREATE INDEX IF NOT EXISTS idx_routine_revisions_routine
              ON routine_revisions(routine_id)`);

      /* Existing routines start at version 1 so `sv` is meaningful from the first
         render rather than null until someone happens to edit them. */
      d.exec(`UPDATE items SET spec_version = 1 WHERE kind = 'routine' AND spec_version IS NULL`);
    },
  },
  {
    id: 12, name: 'routine_skips',
    up(d) {
      /*
       * THE SKIP LIST — the exception that makes DELETING an occurrence mean
       * something.
       *
       * Occurrences are minted rows, and the mint runs on every unfiltered
       * GET /api/items. That made deleting one a no-op with a delay: the row
       * vanished from the view you were looking at, the next read re-derived it
       * from the routine's rules, and it was back on Today and the Week and the
       * calendar as if nothing had happened. There was no way to say "not this
       * one" — the only lever was to un-commit the whole WEEKDAY, which takes out
       * every future week too.
       *
       * So a routine now carries its own exceptions. `cadence_skips` is a CSV of
       * OCCURRENCE REF SUFFIXES — the part of an occurrence's ext_ref after
       * `routine:<id>:`, so a dated one is `YYYY-MM-DD` and a float is
       * `<weekStart>#<index>`. Deleting an occurrence appends its suffix here;
       * plannedOccurrences() then filters that ref out of the horizon for good.
       *
       * ON THE ROUTINE and not on a tombstone row, because a skip is a RULE —
       * exactly the same kind of fact as the cadence beside it, and exactly what
       * an RRULE calls EXDATE. The alternative, keeping the deleted row with a
       * `skipped` flag, would leave it to be filtered out of Today, Week,
       * Calendar, the ORDECK widgets and the weave `items` dataset separately,
       * which is the whole class of bug the "an occurrence is an ordinary task
       * row" bet exists to avoid.
       *
       * Additive and NULL-safe: NULL (every existing routine) means no
       * exceptions, which is exactly today's behaviour.
       */
      try { d.exec(`ALTER TABLE items ADD COLUMN cadence_skips TEXT`); }
      catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
    },
  },
  {
    id: 13, name: 'variance_instrumentation',
    up(d) {
      /*
       * THE TWO FACTS THE SCHEMA COULD NOT ANSWER — and why this migration is
       * urgent in a way no other one has been (Documentation/ALGORITHMS.md §3).
       *
       * A routine holds DECLARED INTENT as progression rules; its occurrences hold
       * ACTUAL BEHAVIOUR. Those two records diverge invisibly from either side
       * alone, and reconciling them is the one thing this app can say that nothing
       * else can. But three of the five statistics that reconciliation needs are
       * not derivable from anything stored today:
       *
       *   skip clustering by DATE   there is no completion timestamp. `updated_at`
       *                             is trigger-managed and clobbered by every later
       *                             edit — renaming a task last week rewrites when
       *                             it looks like it was finished.
       *   ordering violations       `performed.steps` is an OBJECT. The order the
       *                             steps were actually done in is not recorded
       *                             anywhere, in any form.
       *   drift in start time       `scheduled_time` is the PLAN. There has never
       *                             been an actual.
       *
       * NO CODE CAN BACKFILL ANY OF THIS. It is a calendar dependency running
       * backwards: every day these columns are not deployed is a day of history the
       * analysis will never have. Which is why this lands long before anything
       * reads it — the columns start the clock, and that is deliberately all they
       * do. (The two per-step fields, `performed.steps[k].at` and `.seq`, are the
       * other half and live in routine-spec.js, since `performed` is a document,
       * not a column.)
       *
       * DELIBERATELY NOT BACKFILLED. Every row that predates this reads NULL, and
       * that is the correct answer rather than a gap to be filled: stamping
       * existing completions from `updated_at` would manufacture a history that
       * looks real, sorts plausibly, and is wrong — the exact failure the analysis
       * exists to avoid producing. The analysable span starts here.
       *
       * Additive and NULL-safe throughout, exactly as 10–12 were: a routine that
       * predates this keeps working unchanged.
       */
      for (const col of ['started_at TEXT', 'completed_at TEXT']) {
        try { d.exec(`ALTER TABLE items ADD COLUMN ${col}`); }
        catch (e) { if (!e.message?.includes('duplicate column')) throw e; }
      }

      /*
       * A TRIGGER, NOT A STAMP IN A ROUTE HANDLER. `completed` is written from at
       * least four paths — PATCH /api/items/:id, /import, the routine engine's
       * reconcile, and calendar sync — so a stamp in one handler would miss three
       * and the column would be silently, partially true, which is worse than
       * empty. The rule belongs to the table.
       *
       * Same millisecond-ISO format migration 8 moved the whole *_at family to, so
       * completed_at and updated_at sort together and two completions in the same
       * second stay distinguishable.
       *
       * ON THE 0→1 EDGE ONLY, and CLEARED on 1→0: un-ticking a task is not a
       * completion at a slightly later time, it is the retraction of one, and a
       * stale stamp left behind would be a completion date for something that is
       * not complete.
       *
       * INSERT is deliberately not covered. A row that arrives already completed is
       * a bulk import of history, and stamping it 'now' would date someone else's
       * past to today — precisely the fabrication the no-backfill rule above
       * refuses. Occurrences are always minted completed=0 (routines.js) and reach
       * 1 through an UPDATE, so the path that matters is fully covered.
       *
       * `recursive_triggers` is OFF by default, so the inner UPDATE re-fires
       * neither of these nor items_touch_updated. That is fine and intended:
       * items_touch_updated has already fired on the OUTER update that set
       * completed = 1, so the weave delta cursor has already moved and a peer
       * polling ?since= sees the row.
       */
      d.exec(`DROP TRIGGER IF EXISTS items_stamp_completed`);
      d.exec(`CREATE TRIGGER items_stamp_completed AFTER UPDATE ON items
              FOR EACH ROW WHEN NEW.completed = 1 AND OLD.completed = 0
              BEGIN UPDATE items SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END`);
      d.exec(`DROP TRIGGER IF EXISTS items_clear_completed`);
      d.exec(`CREATE TRIGGER items_clear_completed AFTER UPDATE ON items
              FOR EACH ROW WHEN NEW.completed = 0 AND OLD.completed = 1
              BEGIN UPDATE items SET completed_at = NULL WHERE id = NEW.id; END`);
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
