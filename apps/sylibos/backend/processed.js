// processed.js - read-only routes over the file-based ProcessedCourses output
// of `python -m CourseProcessor.library_cli build-dir|batch`.
//
//   GET /api/processed                      catalog (course.json of every course)
//   GET /api/processed/:slug                course.json
//   GET /api/processed/:slug/tree           tree.json   (trunk/branch/leaf graph)
//   GET /api/processed/:slug/concepts       concepts.json
//   GET /api/processed/:slug/exercises      exercises.json
//   GET /api/processed/:slug/lessons        lessons.json
//   GET /api/processed/:slug/videos         videos.json (404 for skeleton builds)
//   GET /api/processed/:slug/asset/<rel>    PDF/file under the course's assets/
//
// The folder layout is the contract (see SERVICES.md); this module never
// writes. Catalog is re-scanned per request so a fresh batch run shows up
// without an API restart — course folders are small JSON reads.

import { existsSync, readFileSync, readdirSync, createReadStream, statSync } from 'fs'
import { join, normalize, resolve } from 'path'

const ARTIFACTS = ['tree', 'concepts', 'exercises', 'lessons', 'videos']
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function attachProcessedRoutes(app, processedRoot) {
  const root = resolve(processedRoot)
  if (!existsSync(root)) {
    console.log(`[processed] ${root} not found — routes will 404 until a build runs`)
  }

  app.get('/api/processed', (_req, res) => {
    if (!existsSync(root)) return res.json({ courses: [] })
    const courses = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => readJson(join(root, e.name, 'course.json')))
      .filter(Boolean)
      .map(({ slug, title, course_number, term, level, subject, instructor,
              calendar_source, match_rate, counts, artifacts }) => ({
        slug, title, courseNumber: course_number, term, level, subject,
        instructor, calendarSource: calendar_source, matchRate: match_rate,
        counts, hasVideos: Boolean(artifacts?.videos),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug))
    res.json({ courses })
  })

  app.get('/api/processed/:slug', (req, res) => {
    const { slug } = req.params
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'bad slug' })
    const data = readJson(join(root, slug, 'course.json'))
    if (!data) return res.status(404).json({ error: 'course not found' })
    res.json(data)
  })

  app.get('/api/processed/:slug/:artifact', (req, res, next) => {
    const { slug, artifact } = req.params
    if (artifact === 'asset') return next()
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'bad slug' })
    if (!ARTIFACTS.includes(artifact)) {
      return res.status(404).json({ error: 'unknown artifact' })
    }
    const data = readJson(join(root, slug, `${artifact}.json`))
    if (!data) return res.status(404).json({ error: `${artifact} not built for ${slug}` })
    res.json(data)
  })

  // Serves the JSON's asset_rel_path values verbatim, e.g.
  // GET /api/processed/<slug>/asset/assets/lec-001/notes.pdf
  app.get('/api/processed/:slug/asset/*', (req, res) => {
    const { slug } = req.params
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'bad slug' })
    const rel = req.params[0] || ''
    const courseDir = join(root, slug)
    const target = normalize(join(courseDir, rel))
    if (!target.startsWith(join(courseDir, 'assets') + '/')) {
      return res.status(400).json({ error: 'bad path' })
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      return res.status(404).json({ error: 'asset not found' })
    }
    const mime = target.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'
    res.setHeader('Content-Type', mime)
    createReadStream(target).pipe(res)
  })
}
