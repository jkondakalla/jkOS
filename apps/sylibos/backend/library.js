// library.js - SylibOS Library runtime (ESM, sylibos-api/backend)
//
// Opens library.db READ-ONLY and exposes:
//   GET  /api/library                 catalog, annotated `added` per user
//   GET  /api/library/:slug           preview (units + lecture titles, no content)
//   POST /api/library/:slug/add       copy the course into this user's rows (fan-out)
//   GET  /api/library/asset/:assetId  serve a PDF BLOB (register BEFORE auth; public)
//
// library.db is the canonical content master written by the Python ingest pipeline.
// Its schema must match CourseProcessor/db.py SCHEMA_SQL. Reads are live: a `load` from
// the pipeline is visible to the running API on the next query (SQLite WAL). If you
// replace the db file wholesale, restart the API.

import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'

const LIBRARY_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS courses (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  instructor TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '', course_number TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '', ocw_url TEXT, layout_format TEXT,
  used_ai_split INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1,
  tool_version TEXT, lecture_count INTEGER NOT NULL DEFAULT 0,
  has_video INTEGER NOT NULL DEFAULT 0, ingested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
  title TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_units_slug ON units(slug);
CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
  unit_title TEXT NOT NULL DEFAULT '', section TEXT, title TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0, content TEXT NOT NULL DEFAULT '',
  videos TEXT NOT NULL DEFAULT '[]', resources TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_lectures_slug ON lectures(slug);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
  lecture_id TEXT REFERENCES lectures(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other', title TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL, mime TEXT NOT NULL DEFAULT 'application/pdf',
  sha256 TEXT, bytes BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_lecture ON assets(lecture_id);
`

export function openLibraryDb(libraryDbPath) {
  // If library.db doesn't exist yet (Python pipeline hasn't run), seed the schema
  // so the API boots with an empty-but-valid catalog rather than crashing.
  if (!existsSync(libraryDbPath)) {
    console.log(`[library] ${libraryDbPath} not found — seeding empty schema`)
    const seed = new Database(libraryDbPath)
    seed.exec(LIBRARY_SCHEMA_SQL)
    seed.close()
  }
  const ldb = new Database(libraryDbPath, { readonly: true, fileMustExist: true })
  ldb.pragma('foreign_keys = ON')
  return {
    ldb,
    listCourses: ldb.prepare(`
      SELECT slug, title, description, subject, level, course_number, term,
             lecture_count, has_video, used_ai_split
      FROM courses ORDER BY subject, title`),
    getCourse: ldb.prepare(`SELECT * FROM courses WHERE slug = ?`),
    getUnits: ldb.prepare(`SELECT id, title, ord FROM units WHERE slug = ? ORDER BY ord`),
    getLectureTitles: ldb.prepare(`
      SELECT id, unit_id, title, ord, videos FROM lectures WHERE slug = ? ORDER BY ord`),
    getLecturesFull: ldb.prepare(`
      SELECT id, unit_id, unit_title, section, title, ord, content, videos, resources
      FROM lectures WHERE slug = ? ORDER BY ord`),
    getAssetsForLecture: ldb.prepare(`
      SELECT id, kind, title, filename, mime FROM assets WHERE lecture_id = ? ORDER BY rowid`),
    getAssetBytes: ldb.prepare(`SELECT mime, filename, bytes FROM assets WHERE id = ?`),
  }
}

// ---- Public asset route (register BEFORE the auth middleware) --------------

export function attachLibraryAssetRoute(app, lib) {
  app.get('/api/library/asset/:assetId', (req, res) => {
    const row = lib.getAssetBytes.get(req.params.assetId)
    if (!row) return res.status(404).json({ error: 'asset not found' })
    res.setHeader('Content-Type', row.mime || 'application/octet-stream')
    res.setHeader('Content-Disposition',
      `inline; filename="${String(row.filename).replace(/"/g, '')}"`)
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
    res.send(row.bytes)
  })
}

// ---- Authenticated routes (register AFTER the auth middleware) -------------

export function attachLibraryRoutes(app, { lib, db }) {
  // Catalog
  app.get('/api/library', (req, res) => {
    const userId = String(req.user.sub)
    const added = new Set(
      db.prepare(`SELECT source_slug FROM courses WHERE user_id = ? AND source_slug IS NOT NULL`)
        .all(userId).map(r => r.source_slug)
    )
    const courses = lib.listCourses.all().map(c => ({
      slug: c.slug,
      title: c.title,
      description: c.description,
      subject: c.subject,
      level: c.level,
      courseNumber: c.course_number,
      term: c.term,
      lectureCount: c.lecture_count,
      hasVideo: !!c.has_video,
      usedAiSplit: !!c.used_ai_split,
      added: added.has(c.slug),
    }))
    res.json({ courses })
  })

  // Preview (no lecture content; titles only)
  app.get('/api/library/:slug', (req, res) => {
    const course = lib.getCourse.get(req.params.slug)
    if (!course) return res.status(404).json({ error: 'course not found' })
    const units = lib.getUnits.all(req.params.slug)
    const lectures = lib.getLectureTitles.all(req.params.slug)
    const byUnit = units.map(u => ({
      title: u.title,
      ord: u.ord,
      lectures: lectures
        .filter(l => l.unit_id === u.id)
        .map(l => ({
          title: l.title,
          ord: l.ord,
          hasVideo: safeLen(l.videos) > 0,
        })),
    }))
    res.json({
      slug: course.slug,
      title: course.title,
      description: course.description,
      instructor: course.instructor,
      subject: course.subject,
      level: course.level,
      courseNumber: course.course_number,
      term: course.term,
      lectureCount: course.lecture_count,
      units: byUnit,
    })
  })

  // Add to dash (fan-out)
  app.post('/api/library/:slug/add', (req, res) => {
    const userId = String(req.user.sub)
    const result = addCourseForUser({ lib, db }, userId, req.params.slug)
    if (!result) return res.status(404).json({ error: 'course not found in library' })
    res.json(result)
  })
}

// ---- Fan-out ---------------------------------------------------------------

export function addCourseForUser({ lib, db }, userId, slug) {
  // Idempotent: a user who already added this slug gets their existing course back.
  const existing = db
    .prepare(`SELECT id FROM courses WHERE user_id = ? AND source_slug = ?`)
    .get(userId, slug)
  if (existing) return { courseId: existing.id, alreadyAdded: true }

  const course = lib.getCourse.get(slug)
  if (!course) return null
  const lectures = lib.getLecturesFull.all(slug)

  // courses INSERT: reconciled against backend/db.js - columns match exactly.
  // source_slug is new; migrations.js adds it before this code runs.
  const insertCourse = db.prepare(`
    INSERT INTO courses
      (id, user_id, title, description, instructor, subject, level,
       source_slug, imported_at, completed_segments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)

  // lectures INSERT: reconciled against backend/db.js.
  // - No user_id column on lectures (linked via course_id -> courses.user_id).
  // - unit column (not unit_title) is the correct column name.
  // - videos, assets, resources are new; migrations.js adds them.
  // - has_segment = 0 so the nightly job picks up every copied lecture.
  const insertLecture = db.prepare(`
    INSERT INTO lectures
      (id, course_id, unit, section, title, ord, content,
       videos, assets, resources, has_segment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)

  const courseId = randomUUID()
  const tx = db.transaction(() => {
    insertCourse.run(
      courseId, userId, course.title, course.description, course.instructor,
      course.subject, course.level, slug, Date.now()
    )
    for (const lec of lectures) {
      const assets = lib.getAssetsForLecture.all(lec.id).map(a => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        filename: a.filename,
        mime: a.mime,
        url: `/api/library/asset/${a.id}`,
      }))
      insertLecture.run(
        randomUUID(), courseId,
        lec.unit_title, lec.section, lec.title, lec.ord, lec.content,
        lec.videos,                // already a JSON string in library.db
        JSON.stringify(assets),    // rewritten with library asset URLs
        lec.resources              // already a JSON string in library.db
      )
    }
  })
  tx()
  return { courseId, alreadyAdded: false }
}

function safeLen(json) {
  try { return JSON.parse(json || '[]').length } catch { return 0 }
}

// ---- Manifest upload (admin only — write connection) -----------------------

export function importManifestToLibrary(libraryDbPath, manifest) {
  const { slug, meta, units = [], course_number, term, ocw_url,
          layout_format, used_ai_split, schema_version } = manifest

  if (!slug || !meta?.title || !Array.isArray(units) || units.length === 0) {
    return { ok: false, error: 'Manifest missing required fields: slug, meta.title, units' }
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return { ok: false, error: 'slug must be lowercase alphanumeric with hyphens' }
  }

  let lectureCount = 0
  let hasVideo = false
  for (const unit of units) {
    for (const lec of unit.lectures ?? []) {
      lectureCount++
      if (safeLen(JSON.stringify(lec.videos ?? [])) > 0) hasVideo = true
    }
  }

  const wdb = new Database(libraryDbPath)
  wdb.pragma('journal_mode = WAL')
  wdb.pragma('foreign_keys = ON')
  wdb.exec(LIBRARY_SCHEMA_SQL)

  try {
    const tx = wdb.transaction(() => {
      wdb.prepare(`
        INSERT OR REPLACE INTO courses
          (slug, title, description, instructor, subject, level, course_number,
           term, ocw_url, layout_format, used_ai_split, schema_version,
           tool_version, lecture_count, has_video, ingested_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        slug,
        meta.title,
        meta.description ?? '',
        meta.instructor ?? '',
        meta.subject ?? '',
        meta.level ?? '',
        course_number ?? '',
        term ?? '',
        ocw_url ?? null,
        layout_format ?? 'manual',
        used_ai_split ? 1 : 0,
        schema_version ?? 1,
        manifest.tool_version ?? null,
        lectureCount,
        hasVideo ? 1 : 0,
        new Date().toISOString(),
      )

      // Delete stale units/lectures so an OR REPLACE on the course cascades cleanly
      wdb.prepare('DELETE FROM units WHERE slug = ?').run(slug)

      for (const unit of units) {
        const unitId = randomUUID()
        wdb.prepare(`
          INSERT INTO units (id, slug, title, ord) VALUES (?,?,?,?)
        `).run(unitId, slug, unit.title ?? '', unit.ord ?? 0)

        for (const lec of unit.lectures ?? []) {
          const lecId = randomUUID()
          wdb.prepare(`
            INSERT INTO lectures
              (id, slug, unit_id, unit_title, section, title, ord, content, videos, resources)
            VALUES (?,?,?,?,?,?,?,?,?,?)
          `).run(
            lecId,
            slug,
            unitId,
            unit.title ?? '',
            lec.section ?? null,
            lec.title ?? '',
            lec.ord ?? 0,
            lec.content ?? '',
            JSON.stringify(lec.videos ?? []),
            JSON.stringify(lec.resources ?? []),
          )
        }
      }
    })
    tx()
    return { ok: true, slug, lectureCount }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    wdb.close()
  }
}

export function attachLibraryUploadRoute(app, libraryDbPath) {
  app.post('/api/library/upload', (req, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' })
    }
    const result = importManifestToLibrary(libraryDbPath, req.body)
    if (!result.ok) return res.status(400).json({ error: result.error })
    res.json(result)
  })
}
