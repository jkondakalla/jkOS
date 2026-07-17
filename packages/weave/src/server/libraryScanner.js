'use strict'
// weave/server/libraryScanner.js — the LIBRARY SCANNER primitive factory (ToDo §3 17.2).
//
// Lifted from PapyrOS `backend/src/library/{scan,probe}.js` (Wave 2): a folder of media
// files → a SQLite catalog, kept in sync on every rescan. The ladder is generic and
// lives here in full:
//   walk (a directory of "units", each a file or a folder of files) → ffprobe pool
//   (bounded concurrency, never Promise.all an unbounded list) → mtime-incremental skip
//   (a unit whose mtime hasn't moved since its last scan is left alone) → upsert
//   ON CONFLICT(path) (insert new units, update changed ones) → prune rows whose unit
//   vanished from disk.
// The ONE app-specific piece is `mapTags(ctx)` — turning a unit's probed tags into that
// app's own catalog columns (PapyrOS: title/author/narrator/series/year/genres; the
// music app: artist/album/albumartist/track/disc/year/genre — same ctx shape, a
// different mapTags, zero brick changes). `parseProbe` is kept pure (no I/O) and
// exported so it can be unit-tested against hand-authored ffprobe JSON with no process
// spawned at all; the impure half (`probeFile`) spawns ffprobe (spawn, never spawnSync)
// with a bounded output size and timeout.
//
// Table/DDL ownership stays with the calling app (unlike defineCollection): the scanner
// only INSERTs/UPDATEs/DELETEs rows in a table the app's own migration already created —
// see PLAYER_PARITY.md §4. `db`/`table`/`dataDir` are all supplied by the app at
// construction, exactly like createScanner() did before this brick existed.
//
// Two "unit" shapes, chosen per app via spec.unit:
//   'dir'  (default) — one row per immediate subdirectory of `dir`, recursively walked
//          for audio files underneath (per-disc subfolders round-trip); multiple files
//          aggregate into ONE row (files[] + summed duration; chapters trusted only from
//          a genuinely single-file unit). This is PapyrOS's book-folder model, verbatim.
//   'file' — one row per individual audio file anywhere under `dir` (flat recursive
//          walk, no grouping). The natural shape for a per-track catalog (Wave 18).
// Both share the exact same probe/upsert/prune ladder below — only unit *discovery*
// differs, and it costs nothing extra to keep both since the discovery step is a few
// lines each.
//
// Zero extra deps (fs/path/child_process only) so the lean subpath `@jkos/weave/libraryScanner`
// loads it without dragging in jsonwebtoken/express, exactly like `@jkos/weave/collection`
// and `@jkos/weave/connector`.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

/* ── pure helpers ─────────────────────────────────────────────────────────────── */

/** Lowercase every key of a tags object; ffprobe's tag casing varies by container/tagger. PURE. */
function normalizeTags(tags) {
  const out = {}
  if (!tags || typeof tags !== 'object') return out
  for (const [key, value] of Object.entries(tags)) out[String(key).toLowerCase()] = value
  return out
}

/**
 * PURE. Turn a raw ffprobe JSON payload (format/streams/chapters) into the shape the
 * scanner consumes: { tags, duration, chapters, codec }. No hardware/app literals — this
 * is the exact ffprobe-invocation the scanner runs (probeFile below), kept apart so it
 * can be driven with a hand-authored fixture and zero process spawning.
 */
function parseProbe(json) {
  const format = (json && json.format) || {}
  const streams = Array.isArray(json && json.streams) ? json.streams : []
  const rawChapters = Array.isArray(json && json.chapters) ? json.chapters : []

  const tags = normalizeTags(format.tags)
  const duration = format.duration != null ? Number(format.duration) : null
  const audioStream = streams.find((s) => s && s.codec_type === 'audio')
  const codec = (audioStream && audioStream.codec_name) || null

  const chapters = rawChapters.map((c) => {
    const chapterTags = normalizeTags(c && c.tags)
    return {
      start: c && c.start_time != null ? Number(c.start_time) : null,
      end: c && c.end_time != null ? Number(c.end_time) : null,
      title: chapterTags.title != null ? chapterTags.title : null,
    }
  })

  return { tags, duration: Number.isFinite(duration) ? duration : null, chapters, codec }
}

/** Pull the leading integer out of a track-style tag ("3/12", "03", "3") — or null. PURE. */
function parseTrackNumber(trackTag) {
  if (trackTag == null) return null
  const m = String(trackTag).match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Filename comparator that sorts "track2" before "track10" (numeric-aware). PURE. */
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/* ── the one impure execution helper (spawn, never spawnSync) ────────────────── */

/** Run `bin args` via spawn, collect stdout, reject on a non-zero exit / spawn error /
 *  timeout / output over maxBytes. Never blocks the event loop (unlike a *Sync call) —
 *  every child this brick starts (ffprobe, and ffmpeg for cover extraction) goes
 *  through this one path. */
function runChild(bin, args, { timeoutMs, maxBytes = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args)
    } catch (err) {
      reject(err)
      return
    }
    const chunks = []
    let size = 0
    let errText = ''
    let settled = false
    let timer = null
    const finish = (fn, val) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(val)
    }
    if (timeoutMs) {
      timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        finish(reject, new Error(`${bin} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }
    child.stdout && child.stdout.on('data', (d) => {
      size += d.length
      if (size > maxBytes) {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        finish(reject, new Error(`${bin} output exceeded ${maxBytes} bytes`))
        return
      }
      chunks.push(d)
    })
    child.stderr && child.stderr.on('data', (d) => { errText += d })
    child.on('error', (err) => finish(reject, err))
    child.on('close', (code) => {
      if (code === 0) finish(resolve, Buffer.concat(chunks).toString('utf8'))
      else finish(reject, new Error(`${bin} exited ${code}: ${errText.trim()}`))
    })
  })
}

/**
 * Run the standard probe command and parse its output. Returns parseProbe()'s shape.
 * The binary defaults to 'ffprobe' — never a hardware/app literal, always overridable
 * via opts.ffprobeBin (a spec option, see defineLibraryScanner).
 */
async function probeFile(filePath, opts = {}) {
  const ffprobeBin = opts.ffprobeBin || 'ffprobe'
  const stdout = await runChild(
    ffprobeBin,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', filePath],
    { timeoutMs: opts.timeoutMs || 20000 },
  )
  return parseProbe(JSON.parse(stdout))
}

/* ── walking ──────────────────────────────────────────────────────────────────── */

/** Recursively collect every matching file under `baseDir`. Returns [{ abs, rel }]
 *  where `rel` is POSIX-slashed and relative to `baseDir` (so a per-disc rip like
 *  "Disc 1/track01.mp3" round-trips). Tolerates an unreadable subdirectory (warns,
 *  skips that subtree — one bad folder doesn't abort the whole scan). */
function collectFilesRecursive(baseDir, matchesExt) {
  const out = []
  function walk(dir, relParts) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      console.warn(`[libraryScanner] cannot read "${dir}": ${err.message}`)
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...relParts, entry.name])
      } else if (entry.isFile() && matchesExt(entry.name)) {
        out.push({ abs: path.join(dir, entry.name), rel: [...relParts, entry.name].join('/') })
      }
    }
  }
  walk(baseDir, [])
  return out
}

/** unit: 'dir' — one unit per immediate subdirectory of `dir`, files collected
 *  recursively underneath it. Returns null (hard failure, caller aborts the pass) if
 *  `dir` itself can't be read. */
function collectDirUnits(dir, matchesExt) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch (err) {
    console.error(`[libraryScanner] cannot read dir "${dir}": ${err.message}`)
    return null
  }
  return entries.map((e) => {
    const unitPath = path.join(dir, e.name)
    return { unitPath, unitName: e.name, files: collectFilesRecursive(unitPath, matchesExt) }
  })
}

/** unit: 'file' — one unit per individual audio file anywhere under `dir` (flat
 *  recursive walk, no grouping). Returns null if `dir` can't be read at all. */
function collectFileUnits(dir, matchesExt) {
  let stat
  try {
    stat = fs.statSync(dir)
  } catch (err) {
    console.error(`[libraryScanner] cannot read dir "${dir}": ${err.message}`)
    return null
  }
  if (!stat.isDirectory()) {
    console.error(`[libraryScanner] "${dir}" is not a directory`)
    return null
  }
  const files = collectFilesRecursive(dir, matchesExt)
  return files.map((f) => ({
    unitPath: f.abs,
    unitName: path.basename(f.abs, path.extname(f.abs)),
    files: [{ abs: f.abs, rel: path.basename(f.abs) }],
  }))
}

/** Bounded-concurrency map. `worker` is expected to catch its own per-item errors and
 *  return null on failure — a genuine bug (an unexpected throw) still propagates so it
 *  doesn't get silently swallowed alongside expected probe failures. */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => lane())
  await Promise.all(lanes)
  return results
}

/* ── cover extraction (generic embedded-art + folder-image ladder) ──────────────── */

function ensureCoversDir(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'covers'), { recursive: true })
}

/** Extract a cover image for a unit into <dataDir>/covers/<id>.<ext>. Tries the first
 *  audio file's embedded art first (ffmpeg -an -c:v copy), then a folder-level
 *  cover.(jpg|jpeg|png|webp) beside it. Returns a path RELATIVE to dataDir, or null if
 *  neither source produced anything — both paths tolerate failure (most media files
 *  carry no embedded art; that's not an error). */
async function defaultExtractCover({ firstFileAbsPath, folderDir, dataDir, id, ffmpegBin, coverExtensions }) {
  const coversDir = path.join(dataDir, 'covers')
  const embeddedDest = path.join(coversDir, `${id}.jpg`)
  try {
    await runChild(ffmpegBin, ['-y', '-i', firstFileAbsPath, '-an', '-c:v', 'copy', embeddedDest], { timeoutMs: 15000 })
    const st = fs.statSync(embeddedDest)
    if (st.size > 0) return path.relative(dataDir, embeddedDest)
  } catch {
    // No embedded art (or the audio file has no attached-pic stream) — expected, fall through.
  }
  try { fs.unlinkSync(embeddedDest) } catch { /* nothing to clean up */ }

  let entries
  try {
    entries = fs.readdirSync(folderDir, { withFileTypes: true })
  } catch {
    entries = []
  }
  const coverEntry = entries.find(
    (e) => e.isFile() && /^cover\./i.test(e.name) && coverExtensions.has(path.extname(e.name).toLowerCase()),
  )
  if (coverEntry) {
    const ext = path.extname(coverEntry.name).toLowerCase()
    const folderDest = path.join(coversDir, `${id}${ext}`)
    try {
      fs.copyFileSync(path.join(folderDir, coverEntry.name), folderDest)
      return path.relative(dataDir, folderDest)
    } catch (err) {
      console.warn(`[libraryScanner] failed to copy folder cover for "${folderDir}": ${err.message}`)
    }
  }
  return null
}

/* ── the per-unit row builder ─────────────────────────────────────────────────── */

/** Probe every file in a unit, order them, and aggregate the row it upserts as. Returns
 *  null when the unit has no probeable audio (nothing to catalog — the caller skips it
 *  rather than writing an empty row). `mapTags` receives the SORTED, fully-probed file
 *  list (tags/duration/chapters/codec per file) so an app can compute its columns from
 *  whichever file(s) it needs — not just the first. */
async function buildUnitRow({ unitPath, unitName, files, mtime, concurrency, ffprobeBin, mapTags, pathColumn, filesColumn, durationColumn, chaptersColumn, mtimeColumn }) {
  if (!files.length) return null

  const probed = await mapPool(files, concurrency, async (f) => {
    try {
      const result = await probeFile(f.abs, { ffprobeBin })
      return { ...f, ...result }
    } catch (err) {
      console.warn(`[libraryScanner] probe failed for "${f.abs}": ${err.message}`)
      return null
    }
  })
  const usable = probed.filter(Boolean)
  if (!usable.length) return null

  usable.sort((a, b) => {
    const ta = parseTrackNumber(a.tags.track)
    const tb = parseTrackNumber(b.tags.track)
    if (ta != null && tb != null && ta !== tb) return ta - tb
    if (ta != null && tb == null) return -1
    if (ta == null && tb != null) return 1
    return naturalCompare(a.rel, b.rel)
  })

  const filesJson = usable.map((f, index) => ({ index, path: f.rel, duration: f.duration, codec: f.codec }))
  const duration = filesJson.reduce((sum, f) => sum + (f.duration || 0), 0)

  // Chapters are only trusted from a genuinely single-file unit's embedded chapter
  // list. Synthesizing chapters from multi-file boundaries is a PLAYER concern, not a
  // scanner one — a multi-file unit's chapters stay empty here, not fabricated.
  const chapters = usable.length === 1 && usable[0].chapters.length ? usable[0].chapters : []

  const cols = mapTags({ unitPath, unitName, files: usable })

  return {
    [pathColumn]: unitPath,
    [filesColumn]: JSON.stringify(filesJson),
    [durationColumn]: duration,
    [chaptersColumn]: JSON.stringify(chapters),
    [mtimeColumn]: mtime,
    ...cols,
    firstFileAbsPath: usable[0].abs,
  }
}

/* ── one full scan pass ───────────────────────────────────────────────────────── */

/** One full pass: upsert every unit whose mtime changed (or is new), delete rows whose
 *  unit vanished, skip the rest. Returns { scanned, upserted, removed, skipped } —
 *  `scanned` counts every unit examined this pass. */
async function scanLibraryOnce(cfg) {
  const {
    db, dir, dataDir, table, columns, mapTags, concurrency, ffprobeBin, ffmpegBin, unit,
    extractCover, coverExtensions, matchesExt,
    pathColumn, filesColumn, durationColumn, chaptersColumn, mtimeColumn, coverColumn,
  } = cfg
  const counts = { scanned: 0, upserted: 0, removed: 0, skipped: 0 }
  if (extractCover) ensureCoversDir(dataDir)

  const units = unit === 'file' ? collectFileUnits(dir, matchesExt) : collectDirUnits(dir, matchesExt)
  if (units === null) return counts

  const existingRows = db.prepare(`SELECT id, ${pathColumn} AS path, ${mtimeColumn} AS mtime FROM ${table}`).all()
  const existingByPath = new Map(existingRows.map((r) => [r.path, r]))
  const seenPaths = new Set()

  const upsertCols = [pathColumn, filesColumn, durationColumn, chaptersColumn, mtimeColumn, ...columns]
  const upsertStmt = db.prepare(`
    INSERT INTO ${table} (${upsertCols.join(', ')})
    VALUES (${upsertCols.map((c) => '@' + c).join(', ')})
    ON CONFLICT(${pathColumn}) DO UPDATE SET
      ${upsertCols.filter((c) => c !== pathColumn).map((c) => `${c} = excluded.${c}`).join(', ')}
    RETURNING id
  `)
  const setCoverStmt = extractCover ? db.prepare(`UPDATE ${table} SET ${coverColumn} = ? WHERE id = ?`) : null
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`)

  for (const u of units) {
    seenPaths.add(u.unitPath)
    counts.scanned++

    let stat
    try {
      stat = fs.statSync(u.unitPath)
    } catch (err) {
      console.warn(`[libraryScanner] cannot stat "${u.unitPath}": ${err.message}`)
      continue
    }
    const mtime = Math.floor(stat.mtimeMs / 1000)
    const existing = existingByPath.get(u.unitPath)
    if (existing && existing.mtime === mtime) {
      counts.skipped++
      continue
    }

    const row = await buildUnitRow({
      unitPath: u.unitPath, unitName: u.unitName, files: u.files, mtime, concurrency, ffprobeBin, mapTags,
      pathColumn, filesColumn, durationColumn, chaptersColumn, mtimeColumn,
    })
    if (!row) {
      console.warn(`[libraryScanner] "${u.unitPath}" has no probeable audio files — skipping`)
      continue
    }
    const { firstFileAbsPath, ...unitRow } = row
    const { id } = upsertStmt.get(unitRow)

    if (extractCover) {
      let coverPath = null
      try {
        const folderDir = unit === 'file' ? path.dirname(u.unitPath) : u.unitPath
        coverPath = typeof extractCover === 'function'
          ? await extractCover({ firstFileAbsPath, folderDir, dataDir, id, unitPath: u.unitPath, unitName: u.unitName })
          : await defaultExtractCover({ firstFileAbsPath, folderDir, dataDir, id, ffmpegBin, coverExtensions })
      } catch (err) {
        console.warn(`[libraryScanner] cover extraction failed for "${u.unitPath}": ${err.message}`)
      }
      if (coverPath) setCoverStmt.run(coverPath, id)
    }

    counts.upserted++
  }

  for (const existing of existingRows) {
    if (!seenPaths.has(existing.path)) {
      deleteStmt.run(existing.id)
      counts.removed++
    }
  }

  return counts
}

/* ── the factory ──────────────────────────────────────────────────────────────── */

/**
 * Build a library scanner bound to one db/table/dir/dataDir. Safe to construct before
 * the table's migration has run — statements are prepared inside scanLibrary(), not here.
 *
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   table: string,
 *   dir: string,
 *   dataDir?: string,
 *   extensions: Set<string>|string[],
 *   columns: string[],
 *   mapTags: (ctx: { unitPath: string, unitName: string, files: Array<{abs:string, rel:string, tags:object, duration:number|null, chapters:Array, codec:string|null}> }) => Record<string, unknown>,
 *   unit?: 'dir'|'file',
 *   concurrency?: number,
 *   ffprobeBin?: string,
 *   ffmpegBin?: string,
 *   extractCover?: boolean|((ctx: {firstFileAbsPath:string, folderDir:string, dataDir:string, id:number, unitPath:string, unitName:string}) => Promise<string|null>),
 *   coverExtensions?: Set<string>|string[],
 *   pathColumn?: string, filesColumn?: string, durationColumn?: string, chaptersColumn?: string, mtimeColumn?: string, coverColumn?: string,
 *   onScanComplete?: (counts: {scanned:number, upserted:number, removed:number, skipped:number}) => void,
 * }} spec
 * @returns {{ scanLibrary: () => Promise<object>, isScanning: () => boolean }}
 */
function defineLibraryScanner(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('defineLibraryScanner: a spec object is required')
  const { db, dir, table, mapTags } = spec
  if (!db) throw new Error('defineLibraryScanner: spec.db is required')
  if (!dir) throw new Error('defineLibraryScanner: spec.dir is required')
  if (!table || typeof table !== 'string') throw new Error('defineLibraryScanner: spec.table is required')
  if (typeof mapTags !== 'function') throw new Error(`defineLibraryScanner('${table}'): spec.mapTags(ctx) is required`)

  const columns = Array.isArray(spec.columns) ? spec.columns : []
  if (!columns.length) throw new Error(`defineLibraryScanner('${table}'): spec.columns (the tag-derived column names mapTags returns) must be a non-empty array`)

  const extList = Array.from(spec.extensions || [])
  if (!extList.length) throw new Error(`defineLibraryScanner('${table}'): spec.extensions (audio file extensions) must be a non-empty Set/array`)
  const extSet = new Set(extList.map((e) => String(e).toLowerCase()))
  const matchesExt = (name) => extSet.has(path.extname(name).toLowerCase())

  const unit = spec.unit === 'file' ? 'file' : 'dir'
  const concurrency = spec.concurrency || 4
  const ffprobeBin = spec.ffprobeBin || 'ffprobe'
  const ffmpegBin = spec.ffmpegBin || 'ffmpeg'
  const extractCover = spec.extractCover === undefined ? true : spec.extractCover
  const coverExtensions = new Set(Array.from(spec.coverExtensions || DEFAULT_COVER_EXTENSIONS).map((e) => String(e).toLowerCase()))
  const dataDir = spec.dataDir
  if (extractCover && !dataDir) throw new Error(`defineLibraryScanner('${table}'): spec.dataDir is required when extractCover is enabled`)

  const pathColumn = spec.pathColumn || 'path'
  const filesColumn = spec.filesColumn || 'files'
  const durationColumn = spec.durationColumn || 'duration'
  const chaptersColumn = spec.chaptersColumn || 'chapters'
  const mtimeColumn = spec.mtimeColumn || 'mtime'
  const coverColumn = spec.coverColumn || 'cover_path'

  // A scan already in flight is JOINED, not duplicated — a second scanLibrary() call
  // (boot scan still running + an admin hits rescan, or a double-click) awaits the same
  // promise instead of starting a concurrent second pass over the same folders.
  let inFlight = null

  function scanLibrary() {
    if (inFlight) return inFlight
    inFlight = scanLibraryOnce({
      db, dir, dataDir, table, columns, mapTags, concurrency, ffprobeBin, ffmpegBin, unit,
      extractCover, coverExtensions, matchesExt,
      pathColumn, filesColumn, durationColumn, chaptersColumn, mtimeColumn, coverColumn,
    }).then((counts) => {
      // Post-scan hook (an app wires auto-enrichment + compat pre-generation here).
      // Fired for both the boot scan and admin rescans; never allowed to fail the scan.
      if (spec.onScanComplete) {
        try { spec.onScanComplete(counts) } catch (err) { console.warn(`[libraryScanner:${table}] onScanComplete failed: ${err.message}`) }
      }
      return counts
    }).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return { scanLibrary, isScanning: () => inFlight !== null }
}

module.exports = {
  defineLibraryScanner,
  parseProbe,
  probeFile,
  normalizeTags,
  parseTrackNumber,
  naturalCompare,
}
