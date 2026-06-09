"""The library.db layer (Python side, used by `load`).

library.db is the canonical content master that the ingest writes and the runtime
reads. This module owns its schema and the upsert that loads a built course from a
build directory (ir.json + extracted asset files) into the database.

Note: the runtime backend (backend/library.js) opens this same file read-only and
must use the identical schema. If you change columns here, change them there too.
"""

from __future__ import annotations

import os
import sqlite3
import uuid

from .ir import Course

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS courses (
  slug           TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  instructor     TEXT NOT NULL DEFAULT '',
  subject        TEXT NOT NULL DEFAULT '',
  level          TEXT NOT NULL DEFAULT '',
  course_number  TEXT NOT NULL DEFAULT '',
  term           TEXT NOT NULL DEFAULT '',
  ocw_url        TEXT,
  layout_format  TEXT,
  used_ai_split  INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  tool_version   TEXT,
  lecture_count  INTEGER NOT NULL DEFAULT 0,
  has_video      INTEGER NOT NULL DEFAULT 0,
  ingested_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id    TEXT PRIMARY KEY,
  slug  TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ord   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_units_slug ON units(slug);

CREATE TABLE IF NOT EXISTS lectures (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
  unit_id    TEXT REFERENCES units(id) ON DELETE CASCADE,
  unit_title TEXT NOT NULL DEFAULT '',
  section    TEXT,
  title      TEXT NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  content    TEXT NOT NULL DEFAULT '',
  videos     TEXT NOT NULL DEFAULT '[]',
  resources  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_lectures_slug ON lectures(slug);

CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
  lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'other',
  title      TEXT NOT NULL DEFAULT '',
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL DEFAULT 'application/pdf',
  sha256     TEXT,
  bytes      BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_lecture ON assets(lecture_id);
"""


def connect(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL)
    return conn


def upsert_course(conn: sqlite3.Connection, course: Course, build_dir: str) -> None:
    """Replace this course's subtree with the built IR. One transaction."""
    import json
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with conn:
        conn.execute("DELETE FROM courses WHERE slug = ?", (course.slug,))
        conn.execute(
            """INSERT INTO courses
               (slug,title,description,instructor,subject,level,course_number,term,
                ocw_url,layout_format,used_ai_split,schema_version,tool_version,
                lecture_count,has_video,ingested_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (course.slug, course.title, course.description, course.instructor,
             course.subject, course.level, course.course_number, course.term,
             course.ocw_url, course.layout_format, int(course.used_ai_split),
             course.schema_version, course.tool_version, course.lecture_count,
             int(course.has_video), now),
        )
        for unit in course.units:
            unit_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO units (id,slug,title,ord) VALUES (?,?,?,?)",
                (unit_id, course.slug, unit.title, unit.ord),
            )
            for lec in unit.lectures:
                lec_id = str(uuid.uuid4())
                conn.execute(
                    """INSERT INTO lectures
                       (id,slug,unit_id,unit_title,section,title,ord,content,videos,resources)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (lec_id, course.slug, unit_id, lec.unit_title, lec.section,
                     lec.title, lec.ord, lec.content,
                     json.dumps(lec.videos), json.dumps(lec.resources)),
                )
                for asset in lec.assets:
                    abs_path = os.path.join(build_dir, asset.rel_path)
                    with open(abs_path, "rb") as fh:
                        data = fh.read()
                    conn.execute(
                        """INSERT INTO assets
                           (id,slug,lecture_id,kind,title,filename,mime,sha256,bytes)
                           VALUES (?,?,?,?,?,?,?,?,?)""",
                        (str(uuid.uuid4()), course.slug, lec_id, asset.kind,
                         asset.title, asset.filename, asset.mime, asset.sha256, data),
                    )


def list_slugs(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute("SELECT slug FROM courses ORDER BY slug")]
