import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import cron from 'node-cron'
import { randomUUID } from 'crypto'
import { jkosAuth } from '@jkos/auth-middleware'
import {
  db,
  getCourses, getCourse, insertCourse, deleteCourse,
  getSegments, insertSegment, patchSegment, updateCourseCompletedSegments,
  getDailyLogs, upsertDailyLog,
  getSettings, saveSettings,
  getLecturesWithoutSegments,
} from './db.js'
import { generateSegmentContent } from './ai.js'
import { openLibraryDb, attachLibraryAssetRoute, attachLibraryRoutes, attachLibraryUploadRoute } from './library.js'
import { runLibraryMigrations } from './migrations.js'

const app = express()
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT ?? 8004)
const NIGHTLY_CRON = process.env.NIGHTLY_CRON ?? '0 2 * * *'
const SHELL_URL        = process.env.SHELL_URL        ?? 'https://sylibos.jkos.net'
const JKOS_AUTH_ISSUER = process.env.JKOS_AUTH_ISSUER ?? 'jkos-auth'
const JKOS_AUTH_PUBLIC_KEY = (process.env.JKOS_AUTH_PUBLIC_KEY || '').trim()

app.use(cors({ origin: SHELL_URL, credentials: true }))
app.use(express.json({ limit: '20mb' }))
app.use(cookieParser())

const LIBRARY_DB_PATH = process.env.LIBRARY_DB_PATH || '/data/library.db'
const lib = openLibraryDb(LIBRARY_DB_PATH)
runLibraryMigrations(db)

// ── Health (public — before auth middleware) ───────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sylibos-api' })
})

// ── Library asset route (public — before auth middleware) ─────────────────────

attachLibraryAssetRoute(app, lib)

// ── Auth (all routes below require a valid jkos_token cookie) ─────────────────

if (!JKOS_AUTH_PUBLIC_KEY && process.env.NODE_ENV === 'production') {
  console.error('[boot] FATAL: JKOS_AUTH_PUBLIC_KEY is not set in production. Refusing to start.')
  process.exit(1)
}
const authMiddleware = JKOS_AUTH_PUBLIC_KEY
  ? jkosAuth({ publicKey: JKOS_AUTH_PUBLIC_KEY, issuer: JKOS_AUTH_ISSUER })
  : (req, _res, next) => { req.user = { sub: 1, role: 'admin' }; next() } // dev fallback (non-prod only)

app.use(authMiddleware)

// ── Library catalog/preview/add routes (authenticated) ───────────────────────

attachLibraryRoutes(app, { lib, db })
attachLibraryUploadRoute(app, LIBRARY_DB_PATH)

app.get('/api/auth/me', (req, res) => {
  const { sub, iat, exp, iss, ...rest } = req.user
  res.json({ user: { id: String(sub), ...rest } })
})

// ── Courses ───────────────────────────────────────────────────────────────────

app.get('/api/courses', (req, res) => {
  res.json(getCourses(String(req.user.sub)))
})

app.post('/api/courses', (req, res) => {
  try {
    const userId = String(req.user.sub)
    const course = { ...req.body, userId }
    if (!course?.id || !course?.title) {
      return res.status(400).json({ error: 'id and title required' })
    }
    insertCourse(course)
    res.status(201).json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/courses/:id', (req, res) => {
  try {
    const course = getCourse(req.params.id, String(req.user.sub))
    if (!course) return res.status(404).json({ error: 'Not found' })
    res.json(course)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/courses/:id', (req, res) => {
  try {
    deleteCourse(req.params.id, String(req.user.sub))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Segments ──────────────────────────────────────────────────────────────────

app.get('/api/segments', (req, res) => {
  res.json(getSegments(String(req.user.sub)))
})

app.post('/api/segments', (req, res) => {
  try {
    const userId = String(req.user.sub)
    const seg = { ...req.body, userId }
    if (!seg?.id || !seg?.lectureId) {
      return res.status(400).json({ error: 'id and lectureId required' })
    }
    insertSegment(seg)
    res.status(201).json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/segments/:id', (req, res) => {
  try {
    const userId = String(req.user.sub)
    const patch = req.body
    const result = patchSegment(req.params.id, userId, patch)
    // Only increment completedSegments if patchSegment actually marked it complete
    // (patchSegment guards with AND completed_at IS NULL, so result.changes === 0 means already completed)
    if (patch.completedAt && patch.courseId && result?.changes > 0) {
      updateCourseCompletedSegments(patch.courseId, userId, 1)
    }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Daily logs ────────────────────────────────────────────────────────────────

app.get('/api/daily-logs', (req, res) => {
  res.json(getDailyLogs(String(req.user.sub)))
})

app.post('/api/daily-logs', (req, res) => {
  try {
    const log = req.body
    if (!log?.date) return res.status(400).json({ error: 'date required' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(log.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
    upsertDailyLog(String(req.user.sub), log)
    res.status(201).json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json(getSettings(String(req.user.sub)))
})

app.put('/api/settings', (req, res) => {
  try {
    saveSettings(String(req.user.sub), req.body)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Summary (for ORDECK widget) ───────────────────────────────────────────────

app.get('/api/summary', (req, res) => {
  const userId = String(req.user.sub)
  const courses = getCourses(userId)
  const segments = getSegments(userId)
  const logs = getDailyLogs(userId)
  const settings = getSettings(userId)
  const dailyGoal = settings.dailyGoal ?? 2

  const today = new Date().toISOString().slice(0, 10)
  const todayLog = logs.find(l => l.date === today)
  const todayDone = todayLog?.segmentIds?.length ?? 0

  let streak = 0
  const d = new Date()
  for (let i = 0; i < 366; i++) {
    const key = d.toISOString().slice(0, 10)
    const log = logs.find(l => l.date === key)
    if (log && log.segmentIds.length >= dailyGoal) {
      streak++
      d.setDate(d.getDate() - 1)
    } else if (key === today) {
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }

  const activeCourse = courses.find(c => c.completedSegments < c.lectures.length) ?? courses[0]
  let nextLesson = null
  if (activeCourse) {
    const todayDoneIds = new Set(todayLog?.segmentIds ?? [])
    for (const lec of activeCourse.lectures) {
      if (!lec.segmentId) continue
      const seg = segments[lec.segmentId]
      if (!seg || seg.completedAt || todayDoneIds.has(seg.id)) continue
      nextLesson = { segmentId: seg.id, title: seg.lectureTitle }
      break
    }
  }

  res.json({
    todayDone,
    dailyGoal,
    streak,
    activeCourse: activeCourse
      ? {
          title: activeCourse.title,
          total: activeCourse.lectures.length,
          done: activeCourse.completedSegments,
          pct: activeCourse.lectures.length > 0
            ? Math.round((activeCourse.completedSegments / activeCourse.lectures.length) * 100)
            : 0,
        }
      : null,
    nextLesson,
    courseCount: courses.length,
  })
})

// ── Nightly job ───────────────────────────────────────────────────────────────

let _nightlyRunning = false

async function runNightlyJob() {
  if (_nightlyRunning) {
    console.log('[nightly] Already running — skipping.')
    return
  }
  _nightlyRunning = true
  try {
    const lectures = getLecturesWithoutSegments()

    if (lectures.length === 0) {
      console.log('[nightly] No unprocessed lectures found.')
      return
    }

    console.log(`[nightly] Processing ${lectures.length} lectures…`)

    let ok = 0, fail = 0
    for (const lec of lectures) {
      try {
        const settings = getSettings(lec.userId)
        const content = await generateSegmentContent(settings, lec.title, lec.content, lec.unit, lec.courseTitle)

        insertSegment({
          id: randomUUID(),
          userId: lec.userId,
          lectureId: lec.id,
          courseId: lec.courseId,
          lectureTitle: lec.title,
          courseTitle: lec.courseTitle,
          unit: lec.unit,
          section: lec.section,
          generatedAt: Date.now(),
          quiz: content.quiz,
          tasks: content.tasks,
        })
        ok++
      } catch (e) {
        console.error(`[nightly] Failed for "${lec.title}":`, e.message)
        fail++
      }
    }

    console.log(`[nightly] Done — ${ok} generated, ${fail} failed.`)
  } finally {
    _nightlyRunning = false
  }
}

cron.schedule(NIGHTLY_CRON, () => {
  console.log(`[nightly] Starting job (cron: ${NIGHTLY_CRON})`)
  runNightlyJob().catch(e => console.error('[nightly] Unexpected error:', e))
})

// ── Manifest import ───────────────────────────────────────────────────────────

app.post('/api/import-manifest', (req, res) => {
  const userId = String(req.user.sub)
  const manifest = req.body
  if (!manifest?.units || !Array.isArray(manifest.units)) {
    return res.status(400).json({ error: 'Invalid manifest: units array required' })
  }

  const courseId = randomUUID()
  const lectures = []
  let order = 1

  for (const unit of manifest.units) {
    for (const session of (unit.sessions ?? [])) {
      if (session.is_assessment) continue

      const parts = [session.overview ?? '']
      const notes = (session.resources ?? []).find(r => r.primary_type === 'Lecture Notes')
      if (notes?.extracted_text) parts.push(notes.extracted_text)
      const content = parts.join('\n\n').slice(0, 8000).trim()

      const videoResource = (session.resources ?? []).find(r =>
        r.primary_type?.includes('Video') && r.file_path?.startsWith('http')
      )

      lectures.push({
        id:         randomUUID(),
        courseId,
        title:      session.title,
        unit:       unit.title,
        section:    null,
        order:      order++,
        content,
        videoUrl:   videoResource?.file_path ?? null,
        hasSegment: false,
        segmentId:  null,
      })
    }
  }

  const description = [
    manifest.goals ?? '',
    manifest.prerequisites ? `Prerequisites: ${manifest.prerequisites}` : '',
  ].filter(Boolean).join('\n\n')

  const course = {
    id:                courseId,
    userId,
    title:             manifest.title ?? 'Untitled Course',
    description,
    instructor:        '',
    subject:           manifest.department ?? '',
    level:             manifest.term ?? '',
    importedAt:        Date.now(),
    completedSegments: 0,
    lectures,
  }

  insertCourse(course)
  res.status(201).json({ ok: true, courseId, lectureCount: lectures.length })
})

// ── Manual trigger for nightly job ───────────────────────────────────────────

app.post('/api/admin/run-nightly', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  if (_nightlyRunning) return res.status(409).json({ ok: false, message: 'Job is already running' })
  res.json({ ok: true, message: 'Nightly job started' })
  runNightlyJob().catch(e => console.error('[nightly] Error from manual trigger:', e))
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[sylibos-api] Running on port ${PORT}`)
  console.log(`[sylibos-api] DB: ${process.env.DB_PATH ?? 'sylibos.db'}`)
  console.log(`[sylibos-api] Auth: jkOS Auth RS256 (JKOS_AUTH_PUBLIC_KEY ${process.env.JKOS_AUTH_PUBLIC_KEY ? 'set' : 'MISSING'})`)
  console.log(`[sylibos-api] Nightly cron: ${NIGHTLY_CRON}`)
})
