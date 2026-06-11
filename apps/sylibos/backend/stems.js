// stems.js - parameterized question stems ("algorithmic questions").
//
// Stems are distilled FROM the course's actual assignments: each problem-set /
// exam PDF in a user's course is text-extracted and one AI call per assignment
// turns its real problems into stem TEMPLATES — question text with {{variable}}
// slots, sampling ranges, constraints, and answer/distractor expressions.
// Instantiation is then deterministic and AI-free: a seeded RNG samples values,
// expr.js computes the answers — so each original problem yields any number of
// slightly-different questions that all practice the same exercise, and the
// same seed always reproduces the same variant set.
//
//   GET    /api/stems/assignments       ?courseId= → discoverable assignment PDFs
//   POST   /api/stems/from-course       { courseId, lectureId?, perAssignment? } → distill each assignment
//   POST   /api/stems/generate          { assignmentText, courseId?, count? } → manual text path
//   GET    /api/stems                   list this user's stems (?courseId= filter)
//   GET    /api/stems/:id               one stem
//   GET    /api/stems/:id/variants      ?count=5&seed=123 → deterministic variants
//   DELETE /api/stems/:id
//
// Stems are per-user rows in sylibos.db, linked to (course_id, lecture_id,
// asset_id) so every stem traces back to the assignment it came from.

import { randomUUID } from 'crypto'
import { evaluate, makeRng, sampleVariables, renderTemplate } from './expr.js'

const MAX_VARIABLES = 8
const MAX_CONSTRAINTS = 6
const MAX_DISTRACTORS = 3
const MAX_OPTIONS = 12
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function initStemTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS question_stems (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      course_id      TEXT,
      lecture_id     TEXT,
      assignment     TEXT NOT NULL DEFAULT '',
      asset_id       TEXT,
      skill          TEXT NOT NULL DEFAULT '',
      stem           TEXT NOT NULL,
      variables      TEXT NOT NULL,
      constraints    TEXT NOT NULL DEFAULT '[]',
      answer         TEXT NOT NULL,
      source_excerpt TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stems_user ON question_stems(user_id);
  `)
}

// ── Assignment discovery ─────────────────────────────────────────────────────
// A user's library-sourced lectures carry an assets JSON column (kind/title/
// filename/id). Mirror the Python pipeline's classification (_exercise_assets):
// problem-set kind or pset/exam-looking names are assignments; 'solution'
// assets on the same lecture are kept as reference material for the AI.

const EXAM_RE = /exam|quiz|midterm|final/i
const PROBLEM_RE = /problem|pset|assignment|homework|hw\d/i

export function collectCourseAssignments(db, userId, courseId) {
  const rows = db.prepare(`
    SELECT l.id, l.title, l.unit, l.assets
    FROM lectures l JOIN courses c ON c.id = l.course_id
    WHERE c.id = ? AND c.user_id = ? ORDER BY l.ord
  `).all(courseId, userId)

  const assignments = []
  for (const lec of rows) {
    let assets = []
    try { assets = JSON.parse(lec.assets ?? '[]') } catch { continue }
    const solutions = assets.filter(a => a.kind === 'solution')
    for (const a of assets) {
      const hay = `${a.filename ?? ''} ${a.title ?? ''}`
      const isProblem = a.kind === 'problem-set' || PROBLEM_RE.test(hay) ||
        (EXAM_RE.test(hay) && a.kind !== 'solution' && a.kind !== 'lecture-notes')
      if (!isProblem || a.kind === 'solution') continue
      assignments.push({
        lectureId: lec.id,
        lectureTitle: lec.title,
        unit: lec.unit,
        assetId: a.id,
        label: a.title || a.filename,
        kind: EXAM_RE.test(hay) ? 'exam' : 'pset',
        solutionAssetIds: solutions.map(s => s.id),
      })
    }
  }
  return assignments
}

// ── Template validation ──────────────────────────────────────────────────────
// AI output is untrusted: shape-check everything, then prove the template
// actually works by sampling + evaluating with a few seeds. Throws on failure.

export function validateStemTemplate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('stem is not an object')
  const stem = String(raw.stem ?? '').trim()
  if (!stem) throw new Error('empty stem text')
  const skill = String(raw.skill ?? '').trim()

  if (!Array.isArray(raw.variables) || raw.variables.length === 0) throw new Error('variables array required')
  if (raw.variables.length > MAX_VARIABLES) throw new Error(`too many variables (max ${MAX_VARIABLES})`)
  const seen = new Set()
  const variables = raw.variables.map(v => {
    const name = String(v?.name ?? '')
    if (!NAME_RE.test(name)) throw new Error(`bad variable name "${name}"`)
    if (seen.has(name)) throw new Error(`duplicate variable "${name}"`)
    seen.add(name)
    if (v.kind === 'int' || v.kind === 'float') {
      const min = Number(v.min), max = Number(v.max)
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        throw new Error(`variable "${name}": bad range [${v.min}, ${v.max}]`)
      }
      const out = { name, kind: v.kind, min, max }
      if (v.kind === 'int' && v.step != null) {
        const step = Number(v.step)
        if (!Number.isFinite(step) || step <= 0) throw new Error(`variable "${name}": bad step`)
        out.step = step
      }
      if (v.kind === 'float') out.decimals = Math.min(Math.max(Number(v.decimals ?? 2) || 0, 0), 6)
      return out
    }
    if (v.kind === 'choice') {
      if (!Array.isArray(v.options) || v.options.length === 0 || v.options.length > MAX_OPTIONS) {
        throw new Error(`variable "${name}": choice needs 1–${MAX_OPTIONS} options`)
      }
      const options = v.options.map(o => (typeof o === 'number' ? o : String(o)))
      return { name, kind: 'choice', options }
    }
    throw new Error(`variable "${name}": unknown kind "${v.kind}"`)
  })

  // Every placeholder must be a declared variable ({{answer}} is reserved for explanations).
  for (const m of stem.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    if (!seen.has(m[1])) throw new Error(`stem references undeclared variable "${m[1]}"`)
  }

  const constraints = (raw.constraints ?? []).slice(0, MAX_CONSTRAINTS).map(String)

  if (!raw.answer || typeof raw.answer.expression !== 'string') throw new Error('answer.expression required')
  const answer = {
    expression: raw.answer.expression,
    decimals: raw.answer.decimals != null ? Math.min(Math.max(Number(raw.answer.decimals) || 0, 0), 6) : null,
    distractors: (raw.answer.distractors ?? []).slice(0, MAX_DISTRACTORS).map(String),
    explanation: String(raw.answer.explanation ?? ''),
  }

  // Functional proof: the template must sample and compute under multiple seeds.
  const badDistractors = new Set()
  for (const seed of [1, 2, 3]) {
    const vars = sampleVariables(variables, constraints, makeRng(seed))
    if (!vars) throw new Error('constraints unsatisfiable within sampling budget')
    const numeric = numericOnly(vars)
    evaluate(answer.expression, numeric) // throws if broken
    for (const d of answer.distractors) {
      try { evaluate(d, numeric) } catch { badDistractors.add(d) }
    }
  }
  // A broken distractor degrades the stem, it doesn't invalidate it.
  answer.distractors = answer.distractors.filter(d => !badDistractors.has(d))

  return { skill, stem, variables, constraints, answer }
}

// ── Variant instantiation (deterministic, no AI) ────────────────────────────

export function instantiateVariants(template, count, baseSeed) {
  const variants = []
  const seenValues = new Set()
  const maxAttempts = count * 4

  for (let i = 0; variants.length < count && i < maxAttempts; i++) {
    const variantSeed = (baseSeed + i * 0x9E3779B9) >>> 0
    const rng = makeRng(variantSeed)
    const vars = sampleVariables(template.variables, template.constraints, rng)
    if (!vars) continue
    const key = JSON.stringify(vars)
    if (seenValues.has(key)) continue // identical numbers teach nothing new
    seenValues.add(key)

    const numeric = numericOnly(vars)
    const answerValue = roundTo(evaluate(template.answer.expression, numeric), template.answer.decimals)

    // Distractor values: drop ones that collide with the answer or each other.
    const distractorValues = []
    for (const d of template.answer.distractors) {
      let v
      try { v = roundTo(evaluate(d, numeric), template.answer.decimals) } catch { continue }
      if (v !== answerValue && !distractorValues.includes(v)) distractorValues.push(v)
    }

    const explanation = renderTemplate(template.answer.explanation, { ...vars, answer: answerValue })

    const variant = {
      seed: variantSeed,
      text: renderTemplate(template.stem, vars),
      values: vars,
      explanation,
    }
    if (distractorValues.length >= 2) {
      // Enough plausible wrong answers for multiple choice; shuffle seeded.
      const options = shuffle([answerValue, ...distractorValues], rng)
      variant.answer = { type: 'multiple-choice', options, correctIndex: options.indexOf(answerValue) }
    } else {
      variant.answer = { type: 'numeric', value: answerValue }
    }
    variants.push(variant)
  }
  return variants
}

function numericOnly(vars) {
  const out = {}
  for (const [k, v] of Object.entries(vars)) if (typeof v === 'number') out[k] = v
  return out
}

function roundTo(value, decimals) {
  return Number(value.toFixed(decimals ?? 4))
}

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function attachStemRoutes(app, { db, lib, getSettings, generateQuestionStems, extractPdfText }) {
  initStemTables(db)

  const rowToStem = (r) => ({
    id: r.id,
    courseId: r.course_id ?? undefined,
    lectureId: r.lecture_id ?? undefined,
    assignment: r.assignment || undefined,
    assetId: r.asset_id ?? undefined,
    skill: r.skill,
    stem: r.stem,
    variables: JSON.parse(r.variables),
    constraints: JSON.parse(r.constraints),
    answer: JSON.parse(r.answer),
    sourceExcerpt: r.source_excerpt,
    createdAt: r.created_at,
  })

  const insertStmt = db.prepare(`
    INSERT INTO question_stems
      (id, user_id, course_id, lecture_id, assignment, asset_id,
       skill, stem, variables, constraints, answer, source_excerpt, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)

  const insertValidated = (userId, accepted, link, excerpt) =>
    db.transaction(() => accepted.map(t => {
      const id = randomUUID()
      insertStmt.run(
        id, userId, link.courseId ?? null, link.lectureId ?? null,
        link.assignment ?? '', link.assetId ?? null,
        t.skill, t.stem,
        JSON.stringify(t.variables), JSON.stringify(t.constraints), JSON.stringify(t.answer),
        excerpt, Date.now(),
      )
      return { id, ...link, ...t, preview: instantiateVariants(t, 1, 1)[0] ?? null }
    }))()

  const validateAll = (rawStems, max) => {
    const accepted = []
    let rejected = 0
    for (const raw of (rawStems ?? []).slice(0, max)) {
      try { accepted.push(validateStemTemplate(raw)) }
      catch (e) { rejected++; console.warn('[stems] rejected AI stem:', e.message) }
    }
    return { accepted, rejected }
  }

  // Which assignments would from-course process? (cheap preview, no AI)
  app.get('/api/stems/assignments', (req, res) => {
    const courseId = String(req.query.courseId ?? '')
    if (!courseId) return res.status(400).json({ error: 'courseId required' })
    res.json({ assignments: collectCourseAssignments(db, String(req.user.sub), courseId) })
  })

  // The main flow: distill every assignment PDF in a course into stems.
  app.post('/api/stems/from-course', async (req, res) => {
    try {
      const userId = String(req.user.sub)
      const { courseId, lectureId, perAssignment } = req.body ?? {}
      if (!courseId) return res.status(400).json({ error: 'courseId required' })
      const stemsPer = Math.min(Math.max(Number(perAssignment) || 3, 1), 10)

      let assignments = collectCourseAssignments(db, userId, String(courseId))
      if (lectureId) assignments = assignments.filter(a => a.lectureId === lectureId)
      if (assignments.length === 0) {
        return res.status(404).json({ error: 'no assignment PDFs found in this course' })
      }
      assignments = assignments.slice(0, 12)

      const settings = getSettings(userId)
      const results = []
      for (const a of assignments) {
        const out = { lectureId: a.lectureId, assignment: a.label, kind: a.kind, stems: [], rejected: 0 }
        results.push(out)
        try {
          const pdf = lib.getAssetBytes.get(a.assetId)
          if (!pdf) { out.error = 'assignment asset missing from library'; continue }
          let text = await extractPdfText(pdf.bytes)
          if (text.length < 40) { out.error = 'no extractable text in PDF'; continue }

          // Solutions help the AI produce correct answer expressions.
          for (const sid of a.solutionAssetIds.slice(0, 2)) {
            const sol = lib.getAssetBytes.get(sid)
            if (!sol) continue
            const solText = await extractPdfText(sol.bytes, 2000)
            if (solText) text += `\n\n--- Solutions (reference) ---\n${solText}`
          }

          const rawStems = await generateQuestionStems(settings, text, stemsPer, {
            assignment: a.label, lecture: a.lectureTitle, unit: a.unit,
          })
          const { accepted, rejected } = validateAll(rawStems, stemsPer)
          out.rejected = rejected
          if (accepted.length > 0) {
            out.stems = insertValidated(userId, accepted,
              { courseId: String(courseId), lectureId: a.lectureId, assignment: a.label, assetId: a.assetId },
              text.slice(0, 500))
          }
        } catch (e) {
          if (e.status === 503) throw e // no AI provider — pointless to continue the loop
          out.error = e.message
        }
      }

      const total = results.reduce((n, r) => n + r.stems.length, 0)
      if (total === 0) {
        return res.status(502).json({ error: 'no usable stems from any assignment', assignments: results })
      }
      res.status(201).json({ assignments: results, total })
    } catch (e) {
      res.status(e.status ?? 500).json({ error: e.message })
    }
  })

  // Manual path: paste assignment text directly (e.g. non-PDF sources).
  app.post('/api/stems/generate', async (req, res) => {
    try {
      const userId = String(req.user.sub)
      const { assignmentText, courseId, count } = req.body ?? {}
      if (typeof assignmentText !== 'string' || assignmentText.trim().length < 20) {
        return res.status(400).json({ error: 'assignmentText required (min 20 chars)' })
      }
      const wanted = Math.min(Math.max(Number(count) || 3, 1), 10)

      const settings = getSettings(userId)
      const rawStems = await generateQuestionStems(settings, assignmentText, wanted)
      const { accepted, rejected } = validateAll(rawStems, wanted)
      if (accepted.length === 0) {
        return res.status(502).json({ error: 'AI produced no usable stems', rejected })
      }
      const stems = insertValidated(userId, accepted, { courseId }, assignmentText.trim().slice(0, 500))
      res.status(201).json({ stems, rejected })
    } catch (e) {
      res.status(e.status ?? 500).json({ error: e.message })
    }
  })

  app.get('/api/stems', (req, res) => {
    const userId = String(req.user.sub)
    const rows = req.query.courseId
      ? db.prepare('SELECT * FROM question_stems WHERE user_id = ? AND course_id = ? ORDER BY created_at DESC')
          .all(userId, String(req.query.courseId))
      : db.prepare('SELECT * FROM question_stems WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    res.json({ stems: rows.map(rowToStem) })
  })

  app.get('/api/stems/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM question_stems WHERE id = ? AND user_id = ?')
      .get(req.params.id, String(req.user.sub))
    if (!row) return res.status(404).json({ error: 'stem not found' })
    res.json(rowToStem(row))
  })

  app.get('/api/stems/:id/variants', (req, res) => {
    const row = db.prepare('SELECT * FROM question_stems WHERE id = ? AND user_id = ?')
      .get(req.params.id, String(req.user.sub))
    if (!row) return res.status(404).json({ error: 'stem not found' })
    const count = Math.min(Math.max(Number(req.query.count) || 5, 1), 50)
    const seed = req.query.seed != null
      ? (Number(req.query.seed) >>> 0)
      : (Date.now() & 0xffffffff) >>> 0
    const template = rowToStem(row)
    const variants = instantiateVariants(template, count, seed)
    if (variants.length === 0) {
      return res.status(422).json({ error: 'could not instantiate variants (constraints too tight)' })
    }
    res.json({ stemId: row.id, seed, variants })
  })

  app.delete('/api/stems/:id', (req, res) => {
    db.prepare('DELETE FROM question_stems WHERE id = ? AND user_id = ?')
      .run(req.params.id, String(req.user.sub))
    res.json({ ok: true })
  })
}
