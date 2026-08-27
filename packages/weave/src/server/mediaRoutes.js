'use strict'
// weave/server/mediaRoutes.js — the MEDIA-ROUTES primitive factory (Layer D, the 4th
// brick next to defineCollection / defineConnector / triggers; git history: Wave 17, 17.3).
//
// `defineMediaRoutes(spec)` turns a pure-data media SPEC (how an app maps an id → the
// file(s) on disk, plus a transcode ladder) into the routes every catalog-backed media
// backend hand-wrote: range-aware streaming, cover art, whole-item download (1 file
// direct, N files zipped store-only), and the compat/transcode pipeline — PLUS the
// piece the whole thing exists to generalize:
//
//   the PLAYBACK DECISION ENGINE (decidePlayback, exported separately + pure): client
//   capabilities in → { rung: 'direct'|'remux'|'reencode', rendition, reason } out.
//   Rung 0 direct-play → rung 1 remux (`-c copy`) → rung 2 re-encode. This is precisely
//   Jellyfin's direct-play → direct-stream → transcode ladder; papyros's Firefox-m4b
//   compat ladder is that engine wearing an audiobook disguise, and video (Wave 19)
//   inherits rungs 0–2 of it. The papyros rules become papyros-SUPPLIED ladder config,
//   never brick literals.
//
// Sits on @jkos/files (17.1) for the Range logic — rangeStream is NOT reimplemented
// here. Path CONTAINMENT stays the app's job (its resolveFile vouches for the absolute
// paths it returns, using @jkos/files' containPath against its OWN mount roots — the
// brick knows no roots and bakes in no app/hardware literals). Every swappable piece
// (mime, cover resolution, download naming, cache dir, ffmpeg binary, the archiver, the
// ladder) is injectable config.
//
// Invariants preserved verbatim from apps/papyros/backend/src/media.js — each was a real
// production bug once:
//   • freshness = exists && size>0 && mtime ≥ source          (isFresh)
//   • generation ONLY on POST …/prepare, NEVER on the GET read path
//       (streamHandler asserts freshness and 404s; it never calls ensureGeneration —
//        the text-scan gate test/… pins this by scanning the marked handler body)
//   • single-flight keyed `id:file:level`                     (inFlight Map, per instance)
//   • `spawn` never `spawnSync`                               (runGeneration; gate-scanned)
//   • atomic `rename` on ffmpeg exit 0                        (runGeneration close handler)
//
// Design-time TS shapes: ../mediaRoutes.ts. Subpath: `@jkos/weave/mediaRoutes`. Plain CJS
// with an .mjs twin (mediaRoutes.mjs) so both `require` and `import` resolve it.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { rangeStream } = require('@jkos/files')

/* ═══ The playback decision engine (pure — no fs, no ffmpeg, no network) ═══════════
   Exported standalone so it is testable in isolation. Two modes over one ladder:

     • requestedLevel != null — the client asked for a specific rung (papyros's wire:
       the player tries direct, catches the decode failure, then asks for level 1, then
       2). The engine resolves that level → its rung, or reports it unknown.

     • client capabilities — walk the ladder from the lowest rung and return the FIRST
       rung the client can consume (each rung carries a `satisfies(source, client)`
       predicate; an absent predicate = universal, the transcode floor). This is the
       Jellyfin form: direct-play if the client can, else direct-stream (remux) if THAT
       is playable, else transcode.

   A ladder is an ordered array of rungs, lowest-cost first:
     { level, strategy: 'direct'|'remux'|'reencode', ext?, contentType?,
       args?(srcPath, tmpPath) => string[], satisfies?(source, client) => boolean }
   The `direct` rung (level 0, no args) means "serve the source itself"; its rendition
   is null (there is nothing to generate). Every other rung's rendition IS the rung
   (carrying the ext + ffmpeg args the generator needs). */

/**
 * @param {{
 *   ladder: Array<object>,
 *   source?: object,
 *   client?: object,
 *   requestedLevel?: number|null,
 * }} args
 * @returns {{ rung: string|null, level: number|null, rendition: object|null, reason: string }}
 */
function decidePlayback({ ladder = [], source = {}, client = {}, requestedLevel = null } = {}) {
  const renditionOf = (rung) => (rung && rung.strategy !== 'direct' ? rung : null)

  if (requestedLevel != null) {
    const rung = ladder.find((r) => r.level === requestedLevel)
    if (!rung) return { rung: null, level: requestedLevel, rendition: null, reason: `no rung at level ${requestedLevel}` }
    return {
      rung: rung.strategy, level: rung.level, rendition: renditionOf(rung),
      reason: `client requested rung ${rung.level} (${rung.strategy})`,
    }
  }

  for (const rung of ladder) {
    const pred = rung.satisfies
    const okRung = typeof pred === 'function' ? !!pred(source, client) : true
    if (okRung) {
      return {
        rung: rung.strategy, level: rung.level, rendition: renditionOf(rung),
        reason: `${rung.strategy} (rung ${rung.level}) — first rung the client can consume`,
      }
    }
  }

  // Nothing matched (every rung had a predicate and all returned false) — fall back to
  // the highest rung, the last-resort transcode. A well-formed ladder ends in a
  // predicate-less re-encode so this is only reached by a deliberately-exhaustive one.
  const last = ladder[ladder.length - 1] || null
  if (!last) return { rung: null, level: null, rendition: null, reason: 'empty ladder' }
  return { rung: last.strategy, level: last.level, rendition: renditionOf(last), reason: 'fallback to highest rung' }
}

/* ═══ filename helpers (generic — no media-type knowledge) ═════════════════════════ */

/** Strip characters illegal in Windows/macOS/Linux filenames (\/:*?"<>|) + control
 *  chars, collapse whitespace, trim. Unicode letters are KEPT (media titles are often
 *  non-English); only the legacy ASCII `filename=` header parameter strips further
 *  (attachmentHeader). */
function sanitizeFilenameStem(raw) {
  return String(raw)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/["\\/:*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A `Content-Disposition: attachment` value carrying BOTH the legacy ASCII `filename=`
 *  (every client understands it) and the RFC 6266/5987 `filename*=UTF-8''…` form (full
 *  Unicode, preferred by modern browsers) — a non-English title downloads with its real
 *  name where supported and a sane ASCII fallback everywhere else. */
function attachmentHeader(stem, ext) {
  const full = `${stem}${ext}`
  const asciiStem = stem.replace(/[^\x20-\x7e]/g, '').trim() || 'download'
  const asciiName = `${asciiStem}${ext}`
  const encoded = encodeURIComponent(full).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`
}

/* ═══ the factory ══════════════════════════════════════════════════════════════════ */

/**
 * @param {import('../mediaRoutes').MediaRoutesSpec} spec
 * @returns {import('../mediaRoutes').MediaRoutes}
 */
function defineMediaRoutes(spec = {}) {
  if (typeof spec.resolveFile !== 'function') {
    throw new Error('defineMediaRoutes: spec.resolveFile(id) -> { id, files:[{index,path}], name } is required')
  }
  if (typeof spec.contentType !== 'function') {
    throw new Error('defineMediaRoutes: spec.contentType(absPath) -> mime string is required')
  }

  const resolveFile = spec.resolveFile
  const resolveCover = typeof spec.resolveCover === 'function' ? spec.resolveCover : null
  const contentType = spec.contentType
  const coverContentType = typeof spec.coverContentType === 'function' ? spec.coverContentType : contentType
  const coverCacheControl = spec.coverCacheControl || 'private, max-age=86400'
  const ladder = Array.isArray(spec.ladder) ? spec.ladder : []
  const hasLadder = ladder.length > 0
  const cacheDir = spec.cacheDir || null
  const ffmpeg = spec.ffmpeg || 'ffmpeg'
  const archiverFactory = spec.archiver || null   // injected (papyros passes require('archiver'))
  const routes = {
    stream: (spec.routes && spec.routes.stream) || '/api/stream',
    cover: (spec.routes && spec.routes.cover) || '/api/cover',
    download: (spec.routes && spec.routes.download) || '/api/download',
  }
  const variantName = typeof spec.variantName === 'function'
    ? spec.variantName
    : (id, fileIndex, level, ext) => `${id}-${fileIndex}.c${level}${ext || ''}`
  const onError = typeof spec.onError === 'function'
    ? spec.onError
    : (ctx, err) => console.error(`[@jkos/weave:media] ${ctx}: ${err && err.message ? err.message : err}`)

  if (hasLadder && !cacheDir) {
    throw new Error('defineMediaRoutes: spec.cacheDir is required when a transcode ladder is supplied')
  }

  // ── single-flight, per instance, keyed `id:file:level` ──────────────────────────
  // Shared by the prepare route AND any app-driven pre-generation sweep (both go
  // through ensureGeneration below), so a poll-triggered prepare and a background sweep
  // can never run two ffmpegs for the same variant.
  const inFlight = new Map()

  const nonDirectRung = (level) => ladder.find((r) => r.strategy !== 'direct' && r.level === level) || null
  const variantPathFor = (id, fileIndex, rung) => path.join(cacheDir, variantName(id, fileIndex, rung.level, rung.ext || ''))

  /** Fresh = the variant exists, is a non-empty file, and is at least as new as the
   *  source it was built from (the mtime-compare regeneration rule — a re-scanned or
   *  replaced source stops serving a stale variant). */
  function isFresh(srcStat, variantPath) {
    let vStat
    try { vStat = fs.statSync(variantPath) } catch { return false }
    return vStat.isFile() && vStat.size > 0 && vStat.mtimeMs >= srcStat.mtimeMs
  }

  /** Resolve (id, fileIndex) → the ONE source file's absolute path. Strict integer
   *  fileIndex (a bookId/fileIndex reaching a route IS attacker-supplied); the app's
   *  resolveFile has already containment-checked the path it returns (null = a
   *  containment violation the app refused to resolve). */
  function resolveSource(idRaw, fileIndexRaw) {
    const fileIndex = Number.parseInt(fileIndexRaw, 10)
    if (!Number.isInteger(fileIndex) || String(fileIndex) !== String(fileIndexRaw).trim()) return null
    const desc = resolveFile(idRaw)
    if (!desc || !Array.isArray(desc.files)) return null
    const file = desc.files.find((f) => f && f.index === fileIndex)
    if (!file || !file.path) return null
    return { filePath: file.path, id: desc.id != null ? desc.id : idRaw, fileIndex }
  }

  /* ── ffmpeg generation (the ONLY place spawn is called) ───────────────────────────
     Writes to a `.tmp` sibling and atomically renames into place ONLY on exit 0 — a
     crashed/killed run never leaves a half-written file a later request could serve.
     ALWAYS child_process.spawn, NEVER spawnSync: a synchronous ffmpeg call blocks the
     whole event loop, starving every other request for the length of the remux/encode.
     stderr is captured into a small bounded buffer purely for the failure log. */
  function runGeneration({ srcPath, variantPath, rung }) {
    const tmpPath = `${variantPath}.tmp`
    const args = rung.args(srcPath, tmpPath)
    return new Promise((resolve, reject) => {
      const STDERR_CAP = 4096
      let stderr = ''
      let child
      try {
        child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      } catch (err) { reject(err); return }
      child.stderr.on('data', (chunk) => { if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8') })
      child.on('error', (err) => reject(err))   // e.g. ffmpeg missing from PATH
      child.on('close', (code) => {
        if (code !== 0) {
          try { fs.unlinkSync(tmpPath) } catch { /* nothing to clean up */ }
          reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, STDERR_CAP)}`))
          return
        }
        try { fs.renameSync(tmpPath, variantPath); resolve() }
        catch (err) { reject(err) }
      })
    })
  }

  /** Start (or JOIN — single-flight per id:file:level) the ffmpeg run behind one
   *  variant. The returned promise never REJECTS: a failure is logged and swallowed so a
   *  fire-and-forget caller (the prepare route responds 202 without awaiting) never
   *  produces an unhandled rejection. (The cacheDir is created by ensurePrepared before
   *  this is reached, so a mkdir failure surfaces as a 500 there, not a swallowed one.) */
  function ensureGeneration({ key, srcPath, variantPath, rung }) {
    const existing = inFlight.get(key)
    if (existing) return existing
    const promise = runGeneration({ srcPath, variantPath, rung })
      .catch((err) => { onError(`generation ${key}`, err) })
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, promise)
    return promise
  }

  /* ── prepare / prepared: the WRITE (generate) + a freshness-only probe ─────────────
     ensurePrepared is the one generation entry point — the prepare route calls it
     (wait:false, fire-and-forget) and an app-driven pre-generation sweep calls it
     (wait:true, sequential). prepared() only READS freshness (no generation) so a
     detail route can report whether a rung is ready. */
  async function ensurePrepared({ id, fileIndex, level, wait = false } = {}) {
    const rung = nonDirectRung(level)
    if (!rung) return { status: 'invalid' }                       // 0 / unknown → not a variant
    const src = resolveSource(id, fileIndex)
    if (!src) return { status: 'missing' }
    let srcStat
    try { srcStat = fs.statSync(src.filePath) } catch { return { status: 'missing' } }
    if (!srcStat.isFile()) return { status: 'missing' }
    const variantPath = variantPathFor(src.id, src.fileIndex, rung)
    if (isFresh(srcStat, variantPath)) return { status: 'ready' }
    try { fs.mkdirSync(path.dirname(variantPath), { recursive: true }) }
    catch (err) { onError('prepare-mkdir', err); return { status: 'error' } }
    const key = `${src.id}:${src.fileIndex}:${level}`
    const promise = ensureGeneration({ key, srcPath: src.filePath, variantPath, rung })
    if (wait) { await promise; return { status: isFresh(srcStat, variantPath) ? 'ready' : 'error' } }
    return { status: 'pending' }
  }

  function prepared({ id, fileIndex, level } = {}) {
    const rung = nonDirectRung(level)
    if (!rung) return false
    const src = resolveSource(id, fileIndex)
    if (!src) return false
    let srcStat
    try { srcStat = fs.statSync(src.filePath) } catch { return false }
    if (!srcStat.isFile()) return false
    return isFresh(srcStat, variantPathFor(src.id, src.fileIndex, rung))
  }

  /* ── route handlers (named so the text-scan gate can pin the read/write split) ──── */

  // /* handler:stream */  GET <routes.stream>/:id/:fileIndex  — the READ path. Range-aware
  // streaming of the source file, or (?compat=N) an ALREADY-GENERATED, still-fresh
  // variant. This branch NEVER generates: an unready rung 404s exactly like an unknown
  // file, so the player knows to keep polling prepare vs. play. (Generation lives only in
  // ensureGeneration, reached only from ensurePrepared / the prepare handler below.)
  function streamHandler(req, res) {
    const src = resolveSource(req.params.id, req.params.fileIndex)
    if (!src) return res.status(404).json({ error: 'Not found' })

    let stat
    try { stat = fs.statSync(src.filePath) } catch { return res.status(404).json({ error: 'Not found' }) }
    if (!stat.isFile()) return res.status(404).json({ error: 'Not found' })

    const compatRaw = req.query.compat
    if (compatRaw !== undefined) {
      const level = Number.parseInt(compatRaw, 10)
      if (!Number.isInteger(level) || String(level) !== String(compatRaw).trim()) {
        return res.status(400).json({ error: 'Invalid compat level' })
      }
      const decision = decidePlayback({ ladder, requestedLevel: level })
      if (!decision.rendition) return res.status(400).json({ error: 'Invalid compat level' })
      const variantPath = variantPathFor(src.id, src.fileIndex, decision.rendition)
      if (!isFresh(stat, variantPath)) return res.status(404).json({ error: 'Not found' })  // never generate here
      const variantStat = fs.statSync(variantPath)
      return rangeStream(res, variantPath, {
        range: req.headers.range, contentType: contentType(variantPath), stat: variantStat,
        onError: (err) => onError(`stream ${variantPath}`, err),
      })
    }

    return rangeStream(res, src.filePath, {
      range: req.headers.range, contentType: contentType(src.filePath), stat,
      onError: (err) => onError(`stream ${src.filePath}`, err),
    })
  }
  // /* end:stream */

  // /* handler:prepare */  POST <routes.stream>/:id/:fileIndex/prepare  — the WRITE path.
  // Kicks off (or JOINS) generation of one rung. Responds {ready:true} immediately for an
  // already-fresh variant (a no-op re-poll), else 202 {pending:true} WITHOUT awaiting —
  // the player polls this same route until it flips to {ready:true}.
  async function prepareHandler(req, res) {
    const src = resolveSource(req.params.id, req.params.fileIndex)     // source 404 precedes bad-level 400
    if (!src) return res.status(404).json({ error: 'Not found' })
    const levelRaw = req.body && req.body.level
    const level = typeof levelRaw === 'number' ? levelRaw : Number.parseInt(levelRaw, 10)
    let result
    try {
      result = await ensurePrepared({ id: src.id, fileIndex: src.fileIndex, level, wait: false })
    } catch (err) { onError('prepare', err); return res.status(500).json({ error: 'Server error' }) }
    switch (result.status) {
      case 'invalid': return res.status(400).json({ error: 'Invalid level' })
      case 'missing': return res.status(404).json({ error: 'Not found' })
      case 'ready':   return res.json({ ready: true })
      case 'error':   return res.status(500).json({ error: 'Server error' })
      default:        return res.status(202).json({ pending: true })   // 'pending'
    }
  }
  // /* end:prepare */

  // /* handler:cover */  GET <routes.cover>/:id  — cacheable cover-art read. `private`
  // (behind the identity gate like every /api route — a shared cache must not retain it)
  // + max-age lets the SAME browser skip refetching a cover it already has.
  function coverHandler(req, res) {
    if (!resolveCover) return res.status(404).json({ error: 'Not found' })
    const coverPath = resolveCover(req.params.id)
    if (!coverPath) return res.status(404).json({ error: 'Not found' })

    let stat
    try { stat = fs.statSync(coverPath) } catch { return res.status(404).json({ error: 'Not found' }) }
    if (!stat.isFile()) return res.status(404).json({ error: 'Not found' })

    res.set('Content-Type', coverContentType(coverPath))
    res.set('Cache-Control', coverCacheControl)
    res.set('Last-Modified', stat.mtime.toUTCString())
    res.set('Content-Length', String(stat.size))

    const stream = fs.createReadStream(coverPath)
    res.on('close', () => { stream.destroy() })
    stream.on('error', (err) => {
      onError(`cover ${coverPath}`, err)
      stream.destroy()
      if (!res.headersSent) res.status(500).end(); else res.end()
    })
    stream.pipe(res)
  }
  // /* end:cover */

  // /* handler:download */  GET <routes.download>/:id  — whole-item download (the route
  // an offline cache pulls from). 1 file → streamed direct, attachment-flagged; N files →
  // zipped ON THE FLY (store-only — audio/video is already compressed) straight into the
  // response, nothing written to disk. Every entry is resolved + stat'd BEFORE any
  // response byte, so a missing file 404s cleanly instead of surfacing mid-download as a
  // truncated zip on a response already committed to 200.
  function downloadHandler(req, res) {
    const desc = resolveFile(req.params.id)
    if (!desc || !Array.isArray(desc.files) || desc.files.length === 0) return res.status(404).json({ error: 'Not found' })

    const stem = sanitizeFilenameStem(desc.name != null ? desc.name : '') || 'download'

    if (desc.files.length === 1) {
      const file = desc.files[0]
      if (!file || !file.path) return res.status(404).json({ error: 'Not found' })
      let stat
      try { stat = fs.statSync(file.path) } catch { return res.status(404).json({ error: 'Not found' }) }
      if (!stat.isFile()) return res.status(404).json({ error: 'Not found' })

      res.set('Content-Type', contentType(file.path))
      res.set('Content-Length', String(stat.size))
      res.set('Content-Disposition', attachmentHeader(stem, path.extname(file.path)))

      const stream = fs.createReadStream(file.path)
      res.on('close', () => { stream.destroy() })
      stream.on('error', (err) => {
        onError(`download ${file.path}`, err)
        stream.destroy()
        if (!res.headersSent) res.status(500).end(); else res.end()
      })
      stream.pipe(res)
      return
    }

    // multi-file → zip. Resolve + stat EVERY entry first (any miss → 404 the whole thing).
    const ordered = desc.files.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const resolved = []
    for (const f of ordered) {
      if (!f || !f.path) return res.status(404).json({ error: 'Not found' })
      try {
        const st = fs.statSync(f.path)
        if (!st.isFile()) return res.status(404).json({ error: 'Not found' })
      } catch { return res.status(404).json({ error: 'Not found' }) }
      resolved.push({ filePath: f.path, index: f.index })
    }

    if (typeof archiverFactory !== 'function') {
      onError('download', new Error('multi-file download needs an archiver — pass spec.archiver = require(\'archiver\')'))
      return res.status(500).json({ error: 'Server error' })
    }

    res.set('Content-Type', 'application/zip')
    res.set('Content-Disposition', attachmentHeader(stem, '.zip'))
    // No Content-Length: the zip's size (even store-only builds a central directory from
    // the entries actually written) isn't known up front → Express falls back to chunked
    // transfer-encoding, which is right here.
    const archive = archiverFactory('zip', { zlib: { level: 0 } })   // store-only: audio/video is already compressed
    archive.on('warning', (err) => onError(`download-zip ${desc.id}`, err))
    archive.on('error', (err) => {
      onError(`download-zip ${desc.id}`, err)
      if (!res.headersSent) res.status(500).end(); else res.end()
    })
    res.on('close', () => { archive.abort() })   // client disconnect mid-zip → stop reading source files

    archive.pipe(res)
    const padWidth = String(resolved.length).length
    resolved.forEach((f, i) => {
      const label = Number.isInteger(f.index) ? f.index : i
      // Index-prefixed original filename so a naive zip-viewer's alphabetical sort matches
      // catalog/playback order even when the underlying filenames don't happen to.
      archive.file(f.filePath, { name: `${String(label).padStart(padWidth, '0')} - ${path.basename(f.filePath)}` })
    })
    archive.finalize()
  }
  // /* end:download */

  /* ── mount ────────────────────────────────────────────────────────────────────── */
  function mount(router) {
    router.get(`${routes.stream}/:id/:fileIndex`, streamHandler)
    if (hasLadder) router.post(`${routes.stream}/:id/:fileIndex/prepare`, prepareHandler)
    if (resolveCover) router.get(`${routes.cover}/:id`, coverHandler)
    router.get(`${routes.download}/:id`, downloadHandler)
  }

  return {
    mount,
    ensurePrepared,
    prepared,
    isPrepared: prepared,   // alias
    decide: (args = {}) => decidePlayback({ ladder, ...args }),
    ladder,
  }
}

module.exports = { defineMediaRoutes, decidePlayback, sanitizeFilenameStem, attachmentHeader }
