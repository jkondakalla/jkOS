import Database from 'better-sqlite3'

const DB_PATH = process.env.DB_PATH ?? 'sylibos.db'
export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL DEFAULT '',
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    instructor         TEXT NOT NULL DEFAULT '',
    subject            TEXT NOT NULL DEFAULT '',
    level              TEXT NOT NULL DEFAULT '',
    imported_at        INTEGER NOT NULL,
    completed_segments INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS lectures (
    id          TEXT PRIMARY KEY,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    unit        TEXT NOT NULL DEFAULT '',
    section     TEXT,
    ord         INTEGER NOT NULL DEFAULT 0,
    content     TEXT NOT NULL DEFAULT '',
    video_url   TEXT,
    has_segment INTEGER NOT NULL DEFAULT 0,
    segment_id  TEXT
  );

  CREATE TABLE IF NOT EXISTS segments (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL DEFAULT '',
    lecture_id    TEXT NOT NULL,
    course_id     TEXT NOT NULL,
    lecture_title TEXT NOT NULL,
    course_title  TEXT NOT NULL,
    unit          TEXT NOT NULL DEFAULT '',
    section       TEXT,
    generated_at  INTEGER NOT NULL,
    quiz          TEXT NOT NULL DEFAULT '[]',
    tasks         TEXT NOT NULL DEFAULT '[]',
    completed_at  INTEGER,
    quiz_score    INTEGER
  );

  CREATE TABLE IF NOT EXISTS daily_logs (
    user_id     TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL,
    segment_ids TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (user_id, date)
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT PRIMARY KEY,
    data    TEXT NOT NULL DEFAULT '{}'
  );
`)

// ── Migrations for existing DBs that predate user_id ────────────────────────

db.transaction(() => {
  const cols = name => db.pragma(`table_info(${name})`).map(c => c.name)

  if (!cols('courses').includes('user_id')) {
    db.exec(`ALTER TABLE courses ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_courses_user ON courses(user_id)`)

  if (!cols('segments').includes('user_id')) {
    db.exec(`ALTER TABLE segments ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_segments_user ON segments(user_id)`)

  // daily_logs: old schema had date TEXT PRIMARY KEY — recreate with composite PK
  if (!cols('daily_logs').includes('user_id')) {
    db.exec(`
      CREATE TABLE daily_logs_new (
        user_id     TEXT NOT NULL DEFAULT '',
        date        TEXT NOT NULL,
        segment_ids TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (user_id, date)
      )
    `)
    db.exec(`INSERT INTO daily_logs_new (user_id, date, segment_ids) SELECT '', date, segment_ids FROM daily_logs`)
    db.exec(`DROP TABLE daily_logs`)
    db.exec(`ALTER TABLE daily_logs_new RENAME TO daily_logs`)
  }

  // settings: old schema had id INTEGER PRIMARY KEY CHECK (id = 1) — recreate as per-user
  if (!cols('settings').includes('user_id')) {
    db.exec(`CREATE TABLE settings_new (user_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}')`)
    db.exec(`DROP TABLE settings`)
    db.exec(`ALTER TABLE settings_new RENAME TO settings`)
  }
})()

// ── Courses ──────────────────────────────────────────────────────────────────

export function getCourses(userId) {
  const courses = db.prepare('SELECT * FROM courses WHERE user_id = ? ORDER BY imported_at DESC').all(userId)
  return courses.map(c => ({
    ...c,
    importedAt: c.imported_at,
    completedSegments: c.completed_segments,
    lectures: db.prepare('SELECT * FROM lectures WHERE course_id = ? ORDER BY ord').all(c.id).map(normLecture),
  }))
}

export function getCourse(id, userId) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ? AND user_id = ?').get(id, userId)
  if (!c) return null
  return {
    ...c,
    importedAt: c.imported_at,
    completedSegments: c.completed_segments,
    lectures: db.prepare('SELECT * FROM lectures WHERE course_id = ? ORDER BY ord').all(id).map(normLecture),
  }
}

export const insertCourse = db.transaction((course) => {
  db.prepare(`
    INSERT OR REPLACE INTO courses (id, user_id, title, description, instructor, subject, level, imported_at, completed_segments)
    VALUES (@id, @user_id, @title, @description, @instructor, @subject, @level, @imported_at, @completed_segments)
  `).run({
    id: course.id,
    user_id: course.userId,
    title: course.title,
    description: course.description ?? '',
    instructor: course.instructor ?? '',
    subject: course.subject ?? '',
    level: course.level ?? '',
    imported_at: course.importedAt ?? Date.now(),
    completed_segments: course.completedSegments ?? 0,
  })

  for (const lec of (course.lectures ?? [])) {
    db.prepare(`
      INSERT OR REPLACE INTO lectures (id, course_id, title, unit, section, ord, content, video_url, has_segment, segment_id)
      VALUES (@id, @course_id, @title, @unit, @section, @ord, @content, @video_url, @has_segment, @segment_id)
    `).run({
      id: lec.id,
      course_id: course.id,
      title: lec.title,
      unit: lec.unit ?? '',
      section: lec.section ?? null,
      ord: lec.order ?? 0,
      content: lec.content ?? '',
      video_url: lec.videoUrl ?? null,
      has_segment: lec.hasSegment ? 1 : 0,
      segment_id: lec.segmentId ?? null,
    })
  }
})

export const deleteCourse = db.transaction((id, userId) => {
  db.prepare('DELETE FROM segments WHERE course_id = ? AND user_id = ?').run(id, userId)
  db.prepare('DELETE FROM courses WHERE id = ? AND user_id = ?').run(id, userId)
})

// ── Segments ─────────────────────────────────────────────────────────────────

export function getSegments(userId) {
  const rows = db.prepare('SELECT * FROM segments WHERE user_id = ?').all(userId)
  const out = {}
  for (const s of rows) out[s.id] = normSegment(s)
  return out
}

export function insertSegment(seg) {
  db.prepare(`
    INSERT OR IGNORE INTO segments
      (id, user_id, lecture_id, course_id, lecture_title, course_title, unit, section, generated_at, quiz, tasks, completed_at, quiz_score)
    VALUES
      (@id, @user_id, @lecture_id, @course_id, @lecture_title, @course_title, @unit, @section, @generated_at, @quiz, @tasks, @completed_at, @quiz_score)
  `).run({
    id: seg.id,
    user_id: seg.userId,
    lecture_id: seg.lectureId,
    course_id: seg.courseId,
    lecture_title: seg.lectureTitle,
    course_title: seg.courseTitle,
    unit: seg.unit ?? '',
    section: seg.section ?? null,
    generated_at: seg.generatedAt ?? Date.now(),
    quiz: JSON.stringify(seg.quiz ?? []),
    tasks: JSON.stringify(seg.tasks ?? []),
    completed_at: seg.completedAt ?? null,
    quiz_score: seg.quizScore ?? null,
  })

  db.prepare(`
    UPDATE lectures SET has_segment = 1, segment_id = ?
    WHERE id = ? AND course_id IN (SELECT id FROM courses WHERE user_id = ?)
  `).run(seg.id, seg.lectureId, seg.userId)
}

export const patchSegment = db.transaction((id, userId, patch) => {
  let result = { changes: 0 }
  if (patch.completedAt !== undefined) {
    // Guard: only set completed_at if not already completed — prevents double-increment of course counter
    result = db.prepare('UPDATE segments SET completed_at = ?, quiz_score = ? WHERE id = ? AND user_id = ? AND completed_at IS NULL')
      .run(patch.completedAt, patch.quizScore ?? null, id, userId)
  }
  if (patch.quiz !== undefined) {
    db.prepare('UPDATE segments SET quiz = ?, tasks = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(patch.quiz), JSON.stringify(patch.tasks ?? []), id, userId)
  }
  return result
})

export function updateCourseCompletedSegments(courseId, userId, delta) {
  db.prepare('UPDATE courses SET completed_segments = completed_segments + ? WHERE id = ? AND user_id = ?')
    .run(delta, courseId, userId)
}

// ── Daily logs ───────────────────────────────────────────────────────────────

export function getDailyLogs(userId) {
  return db.prepare('SELECT * FROM daily_logs WHERE user_id = ? ORDER BY date DESC').all(userId)
    .map(r => {
      let segmentIds = []
      try { segmentIds = JSON.parse(r.segment_ids) } catch { console.warn('[db] corrupt segment_ids for', r.date) }
      return { date: r.date, segmentIds }
    })
}

export function upsertDailyLog(userId, log) {
  db.prepare('INSERT OR REPLACE INTO daily_logs (user_id, date, segment_ids) VALUES (?, ?, ?)')
    .run(userId, log.date, JSON.stringify(log.segmentIds ?? []))
}

// ── Settings ─────────────────────────────────────────────────────────────────

const ENV_SETTINGS_DEFAULTS = {
  aiProvider:   process.env.AI_PROVIDER  ?? 'none',
  ollamaUrl:    process.env.OLLAMA_URL   ?? 'http://localhost:11434',
  ollamaModel:  process.env.OLLAMA_MODEL ?? 'llama3.2',
  lazurosUrl:   process.env.LAZUROS_URL  ?? '',
  lazurosToken: process.env.LAZUROS_TOKEN ?? '',
  dailyGoal:    2,
}

export function getSettings(userId) {
  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(userId)
  let stored = {}
  if (row) { try { stored = JSON.parse(row.data) } catch { console.warn('[db] corrupt settings for user', userId) } }
  return { ...ENV_SETTINGS_DEFAULTS, ...stored }
}

export function saveSettings(userId, settings) {
  db.prepare('INSERT OR REPLACE INTO settings (user_id, data) VALUES (?, ?)').run(userId, JSON.stringify(settings))
}

// ── Normalise DB rows to frontend shape ───────────────────────────────────────

function normLecture(r) {
  let videoUrl = r.video_url ?? undefined
  if (!videoUrl && r.videos) {
    try {
      const vids = JSON.parse(r.videos)
      if (Array.isArray(vids) && vids[0]?.url) videoUrl = vids[0].url
    } catch {}
  }
  return {
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    unit: r.unit,
    section: r.section ?? undefined,
    order: r.ord,
    content: r.content,
    videoUrl,
    hasSegment: r.has_segment === 1,
    segmentId: r.segment_id ?? undefined,
  }
}

function normSegment(r) {
  let quiz = [], tasks = []
  try { quiz  = JSON.parse(r.quiz)  } catch { console.warn('[db] corrupt quiz for segment', r.id) }
  try { tasks = JSON.parse(r.tasks) } catch { console.warn('[db] corrupt tasks for segment', r.id) }
  return {
    id: r.id,
    lectureId: r.lecture_id,
    courseId: r.course_id,
    lectureTitle: r.lecture_title,
    courseTitle: r.course_title,
    unit: r.unit,
    section: r.section ?? undefined,
    generatedAt: r.generated_at,
    quiz,
    tasks,
    completedAt: r.completed_at ?? undefined,
    quizScore: r.quiz_score ?? undefined,
  }
}

// ── Helpers for nightly job ───────────────────────────────────────────────────

export function getLecturesWithoutSegments() {
  return db.prepare(`
    SELECT l.*, c.title AS course_title, c.user_id
    FROM lectures l
    JOIN courses c ON c.id = l.course_id
    WHERE l.has_segment = 0 AND l.content != ''
  `).all().map(r => ({
    id: r.id,
    userId: r.user_id,
    courseId: r.course_id,
    courseTitle: r.course_title,
    title: r.title,
    unit: r.unit,
    section: r.section ?? undefined,
    content: r.content,
  }))
}
