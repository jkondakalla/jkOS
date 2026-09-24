-- The PapyrOS database schema, frozen at its final migration (12 — list below), for
-- test/import-papyros.smoke.mjs. PapyrOS folded into KourOS on 2026-09-23 and its code
-- is gone; this is what scripts/import-papyros.js reads FROM. Dumped from a database
-- the real PapyrOS server.js migrated, not hand-written.
-- migrations applied: 1:create_books, 2:create_progress, 3:create_bookmarks, 4:create_clubs, 5:create_club_members, 6:add_book_description, 7:null_series_equal_title, 8:progress_unique_user_book, 9:create_history, 10:canonical_wire_timestamps, 11:index_history_started, 12:rebackfill_wire_timestamps

CREATE TABLE bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        book_ref TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT,
        note TEXT,
        created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT
      );

CREATE TABLE books (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          path            TEXT    NOT NULL UNIQUE,
          title           TEXT,
          subtitle        TEXT,
          author          TEXT,
          narrator        TEXT,
          series          TEXT,
          series_seq      REAL,
          year            INTEGER,
          genres          TEXT    DEFAULT '[]',
          duration        REAL,
          files           TEXT    DEFAULT '[]',
          chapters        TEXT    DEFAULT '[]',
          cover_path      TEXT,
          metadata_source TEXT    CHECK (metadata_source IS NULL OR metadata_source IN ('embedded', 'itunes', 'manual')),
          ext_ref         TEXT,
          mtime           INTEGER,
          added_at        TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at      TEXT
        , description TEXT);

CREATE TABLE club_members (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        club_ref TEXT NOT NULL,
        member_sub TEXT NOT NULL,
        created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT
      );

CREATE TABLE clubs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        current_pick TEXT,
        created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT
      );

CREATE TABLE history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        item_ref TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ms_played INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT
      );

CREATE TABLE migrations (
    id INTEGER PRIMARY KEY, name TEXT, run_at TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE progress (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        book_ref TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        duration INTEGER,
        finished INTEGER DEFAULT 0,
        last_played TEXT,
        created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT
      );

CREATE TABLE weave_idempotency (
  scope      TEXT NOT NULL,          -- '<app>.<collection>' — WHICH write door
  user_id    TEXT NOT NULL,          -- '' when the collection is unscoped
  key        TEXT NOT NULL,
  status     INTEGER NOT NULL,       -- what the first attempt answered
  body       TEXT NOT NULL,          -- and the body it answered with, verbatim
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, user_id, key)
);

CREATE INDEX idx_bookmarks_updated ON bookmarks(updated_at);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

CREATE INDEX idx_books_author  ON books(author);

CREATE INDEX idx_books_series  ON books(series);

CREATE INDEX idx_books_updated ON books(updated_at);

CREATE INDEX idx_club_members_updated ON club_members(updated_at);

CREATE INDEX idx_club_members_user ON club_members(user_id);

CREATE INDEX idx_clubs_updated ON clubs(updated_at);

CREATE INDEX idx_clubs_user ON clubs(user_id);

CREATE INDEX idx_history_updated ON history(updated_at);

CREATE INDEX idx_history_user ON history(user_id);

CREATE INDEX idx_history_user_started ON history(user_id, started_at);

CREATE INDEX idx_progress_updated ON progress(updated_at);

CREATE INDEX idx_progress_user ON progress(user_id);

CREATE UNIQUE INDEX idx_progress_user_book ON progress(user_id, book_ref);

CREATE INDEX weave_idempotency_created ON weave_idempotency(created_at);

CREATE TRIGGER bookmarks_canon_created AFTER INSERT ON bookmarks
        FOR EACH ROW WHEN NEW.created_at IS NOT NULL AND NEW.created_at NOT LIKE '____-__-__T__:__:__.___Z'
        BEGIN UPDATE bookmarks SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) WHERE id = NEW.id; END;

CREATE TRIGGER bookmarks_stamp_inserted AFTER INSERT ON bookmarks
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE bookmarks SET updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TRIGGER bookmarks_touch_updated AFTER UPDATE ON bookmarks
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE bookmarks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER books_stamp_added AFTER INSERT ON books
          FOR EACH ROW WHEN NEW.updated_at IS NULL
          BEGIN UPDATE books SET updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.added_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TRIGGER books_touch_updated AFTER UPDATE ON books
          FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
          BEGIN UPDATE books SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER club_members_canon_created AFTER INSERT ON club_members
        FOR EACH ROW WHEN NEW.created_at IS NOT NULL AND NEW.created_at NOT LIKE '____-__-__T__:__:__.___Z'
        BEGIN UPDATE club_members SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) WHERE id = NEW.id; END;

CREATE TRIGGER club_members_stamp_inserted AFTER INSERT ON club_members
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE club_members SET updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TRIGGER club_members_touch_updated AFTER UPDATE ON club_members
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE club_members SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER clubs_canon_created AFTER INSERT ON clubs
        FOR EACH ROW WHEN NEW.created_at IS NOT NULL AND NEW.created_at NOT LIKE '____-__-__T__:__:__.___Z'
        BEGIN UPDATE clubs SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) WHERE id = NEW.id; END;

CREATE TRIGGER clubs_stamp_inserted AFTER INSERT ON clubs
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE clubs SET updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TRIGGER clubs_touch_updated AFTER UPDATE ON clubs
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE clubs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER history_canon_created AFTER INSERT ON history
        FOR EACH ROW WHEN NEW.created_at IS NOT NULL AND NEW.created_at NOT LIKE '____-__-__T__:__:__.___Z'
        BEGIN UPDATE history SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) WHERE id = NEW.id; END;

CREATE TRIGGER history_stamp_inserted AFTER INSERT ON history
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE history SET updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TRIGGER history_touch_updated AFTER UPDATE ON history
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE history SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER progress_canon_created AFTER INSERT ON progress
        FOR EACH ROW WHEN NEW.created_at IS NOT NULL AND NEW.created_at NOT LIKE '____-__-__T__:__:__.___Z'
        BEGIN UPDATE progress SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at) WHERE id = NEW.id; END;

CREATE TRIGGER progress_stamp_inserted AFTER INSERT ON progress
        FOR EACH ROW WHEN NEW.updated_at IS NULL
        BEGIN UPDATE progress SET updated_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TRIGGER progress_touch_updated AFTER UPDATE ON progress
        FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
        BEGIN UPDATE progress SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER progress_upsert_on_conflict BEFORE INSERT ON progress
          FOR EACH ROW WHEN EXISTS (
            SELECT 1 FROM progress WHERE user_id = NEW.user_id AND book_ref = NEW.book_ref
          )
          BEGIN
            DELETE FROM progress WHERE user_id = NEW.user_id AND book_ref = NEW.book_ref;
          END;
