// @jkos/weave libraryScanner tests — the LIBRARY SCANNER primitive (git history: item 17.2).
//
// Proves the brick (`defineLibraryScanner`, packages/weave/src/server/libraryScanner.js)
// reproduces PapyrOS's pre-brick scan.js/probe.js ladder exactly — walk → ffprobe pool →
// mtime-incremental skip → upsert ON CONFLICT(path) → prune vanished rows, single-flight
// — AND that the spec shape genuinely supports a SECOND consumer with a different tag
// vocabulary and a different unit shape (the music app, git history: item 18.2) with zero brick
// changes: only `mapTags`/`columns`/`unit` differ between the two suites below.
//
// No real ffprobe/ffmpeg process: `spec.ffprobeBin` points at
// test/fixtures/fake-ffprobe.cjs, a stub that echoes the "audio file"'s own contents
// (a hand-authored ffprobe-JSON text fixture) back to stdout — the REAL, unmodified
// probeFile()/parseProbe() parse that exactly as they would genuine ffprobe output. This
// is what PapyrOS's real end-to-end coverage already is (apps/papyros/backend/test/
// library.smoke.mjs, which boots the real server against real ffprobe/ffmpeg and a real
// fixture library) — this suite instead drives the brick in isolation, hermetically, so
// it runs with no external binary and covers the parts papyros's zero-behavior-change
// refactor doesn't exercise (a second tag vocabulary, 'file' unit mode, a custom
// extractCover hook, single-flight, prune).
//
// Run: node test/libraryScanner.mjs   (chained after lego.mjs by `pnpm --filter @jkos/weave test`)

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const FAKE_FFPROBE = join(HERE, 'fixtures', 'fake-ffprobe.cjs')

let pass = 0
const ok = (label, cond, detail = '') => { assert.ok(cond, `${label} ${detail}`); pass++; console.log(`  ✓ ${label}`) }
const section = (t) => console.log(`\n${t}`)

const {
  defineLibraryScanner, parseProbe, probeFile, normalizeTags, parseTrackNumber, naturalCompare,
} = require('../src/server/libraryScanner.js')

// better-sqlite3 lives in the backends' node_modules (not weave's — it's a backend
// concern, same as lego.mjs's D1 route test). Skip the live-DB sections if it isn't
// installed (CI/deploy always has it).
function loadSqlite() {
  for (const base of ['apps/beigeboard/backend', 'apps/jkauth']) {
    try { return createRequire(join(HERE, '..', '..', '..', base, 'x.js'))('better-sqlite3') } catch { /* next */ }
  }
  return null
}
const Database = loadSqlite()

/* ═══ 1 · pure helpers (parseProbe / parseTrackNumber / naturalCompare) ═══════════ */
section('1 · pure helpers')

const fullProbe = parseProbe({
  format: { duration: '123.5', tags: { Title: 'T', ARTIST: 'A', Genre: 'Rock;Pop', DATE: '2019-03-01' } },
  streams: [
    { codec_type: 'video', codec_name: 'mjpeg' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  chapters: [
    { start_time: '0', end_time: '10', tags: { title: 'One' } },
    { start_time: '10', end_time: '20.5', tags: {} },
  ],
})
ok('parseProbe: duration coerced to a number', fullProbe.duration === 123.5)
ok('parseProbe: codec picked from the AUDIO stream, not the cover-art video stream', fullProbe.codec === 'aac')
ok('parseProbe: tags normalized to lowercase keys', fullProbe.tags.title === 'T' && fullProbe.tags.artist === 'A')
ok('parseProbe: chapters mapped with numeric start/end + title (null when absent)',
  fullProbe.chapters.length === 2 && fullProbe.chapters[0].title === 'One' && fullProbe.chapters[1].title === null
  && fullProbe.chapters[1].end === 20.5)

const emptyProbe = parseProbe({})
ok('parseProbe: a bare {} input never throws — empty tags/chapters, null duration/codec',
  emptyProbe.duration === null && emptyProbe.codec === null
  && Object.keys(emptyProbe.tags).length === 0 && emptyProbe.chapters.length === 0)

ok('normalizeTags: missing/non-object input → {}', Object.keys(normalizeTags(undefined)).length === 0 && Object.keys(normalizeTags(null)).length === 0)

ok('parseTrackNumber: pulls the leading int out of "3/12"', parseTrackNumber('3/12') === 3)
ok('parseTrackNumber: plain "03" → 3', parseTrackNumber('03') === 3)
ok('parseTrackNumber: null tag → null', parseTrackNumber(null) === null)
ok('parseTrackNumber: no digits → null', parseTrackNumber('side A') === null)

ok('naturalCompare: numeric-aware ("track2" before "track10")',
  ['track10', 'track2', 'track1'].sort(naturalCompare).join(',') === 'track1,track2,track10')

ok('probeFile is exported as the impure spawn-based wrapper (not invoked in this suite)',
  typeof probeFile === 'function' && probeFile.constructor.name === 'AsyncFunction')

/* ═══ 2 · defineLibraryScanner — validation ═══════════════════════════════════════ */
section('2 · defineLibraryScanner spec validation')

const dummyDb = { prepare: () => ({ all: () => [], get: () => ({ id: 1 }), run: () => {} }) }
const baseSpec = { db: dummyDb, dir: '/nonexistent', table: 't', mapTags: () => ({}), columns: ['x'], extensions: ['.mp3'] }

assert.throws(() => defineLibraryScanner({ ...baseSpec, db: undefined }), /spec\.db/)
ok('throws without db', true)
assert.throws(() => defineLibraryScanner({ ...baseSpec, dir: undefined }), /spec\.dir/)
ok('throws without dir', true)
assert.throws(() => defineLibraryScanner({ ...baseSpec, table: undefined }), /spec\.table/)
ok('throws without table', true)
assert.throws(() => defineLibraryScanner({ ...baseSpec, mapTags: undefined }), /mapTags/)
ok('throws without mapTags', true)
assert.throws(() => defineLibraryScanner({ ...baseSpec, columns: [] }), /spec\.columns/)
ok('throws with an empty columns list', true)
assert.throws(() => defineLibraryScanner({ ...baseSpec, extensions: [] }), /spec\.extensions/)
ok('throws with an empty extensions list', true)
assert.throws(() => defineLibraryScanner({ ...baseSpec, extractCover: true, dataDir: undefined }), /dataDir/)
ok('throws when extractCover is enabled without dataDir', true)
ok('does NOT throw when extractCover:false and dataDir is omitted',
  !!defineLibraryScanner({ ...baseSpec, extractCover: false }))

/* ═══ 3 · 'dir' unit mode — the PapyrOS shape, a different tag vocabulary ═════════ */
if (!Database) {
  console.log('\n⚠ SKIPPING 3/4 (better-sqlite3 not resolvable from a backend workspace)')
} else {
  section("3 · unit: 'dir' — walk / probe pool / mtime skip / upsert / prune / single-flight")

  const tmp = mkdtempSync(join(tmpdir(), 'weave-libscan-'))
  const libDir = join(tmp, 'library')
  const dataDir = join(tmp, 'data')
  mkdirSync(libDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  // Unit A: one file, full tags + 1 embedded chapter — a "single-file unit trusts its
  // own chapters" fixture. Unit B: two files, track=1/2, NO title tag — exercises
  // track-ordered aggregation + the folder-name title fallback + "no synthesized
  // chapters for a multi-file unit".
  mkdirSync(join(libDir, 'Unit A'), { recursive: true })
  writeFileSync(join(libDir, 'Unit A', 'only.mp3'), JSON.stringify({
    format: { duration: '100', tags: { title: 'Alpha', artist: 'Auth A', genre: 'Fantasy' } },
    streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    chapters: [{ start_time: '0', end_time: '100', tags: { title: 'Ch1' } }],
  }))

  mkdirSync(join(libDir, 'Unit B'), { recursive: true })
  writeFileSync(join(libDir, 'Unit B', '02 second.mp3'), JSON.stringify({
    format: { duration: '60', tags: { track: '2', artist: 'Auth B' } },
    streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    chapters: [],
  }))
  writeFileSync(join(libDir, 'Unit B', '01 first.mp3'), JSON.stringify({
    format: { duration: '50', tags: { track: '1', artist: 'Auth B' } },
    streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    chapters: [],
  }))

  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      files TEXT, duration REAL, chapters TEXT, mtime INTEGER, cover_path TEXT,
      label TEXT, tag_year INTEGER
    )
  `)

  // A DELIBERATELY different tag vocabulary/column set than PapyrOS's `books`
  // (title/author/narrator/series/year/genres) — proves mapTags/columns is the only
  // app-specific surface, exactly as 17.2 requires.
  let mapTagsCalls = 0
  function mapTags({ unitName, files }) {
    mapTagsCalls++
    const primary = files[0]
    return {
      label: primary.tags.title || unitName,
      tag_year: primary.tags.artist === 'Auth A' ? 2019 : null,
    }
  }

  const scanner = defineLibraryScanner({
    db, table: 'units', dir: libDir, dataDir,
    extensions: ['.mp3'], columns: ['label', 'tag_year'], mapTags,
    ffprobeBin: FAKE_FFPROBE, extractCover: false,
  })

  const c1 = scanner.scanLibrary()
  const c2 = scanner.scanLibrary()
  ok('scanLibrary is single-flight: two synchronous calls return the SAME promise (joined, not duplicated)', c1 === c2)
  const counts1 = await c1
  ok('first pass: 2 units scanned, 2 upserted, 0 skipped/removed',
    counts1.scanned === 2 && counts1.upserted === 2 && counts1.skipped === 0 && counts1.removed === 0,
    JSON.stringify(counts1))
  ok('single-flight actually ran ONE pass (mapTags called once per unit, not twice)', mapTagsCalls === 2)
  ok('a fresh scanLibrary() call after settling starts a NEW promise', scanner.scanLibrary() !== c1)
  await scanner.scanLibrary()

  const rows = db.prepare('SELECT * FROM units ORDER BY path').all()
  const unitA = rows.find((r) => r.path.endsWith('Unit A'))
  const unitB = rows.find((r) => r.path.endsWith('Unit B'))
  ok('Unit A + Unit B rows both present', !!unitA && !!unitB)

  const filesA = JSON.parse(unitA.files)
  const chaptersA = JSON.parse(unitA.chapters)
  ok('Unit A: single-file aggregation (files.length === 1)', filesA.length === 1)
  ok('Unit A: embedded chapter trusted (single-file unit)', chaptersA.length === 1 && chaptersA[0].title === 'Ch1')
  ok('Unit A: mapTags-derived columns landed (label/tag_year — a non-books vocabulary)',
    unitA.label === 'Alpha' && unitA.tag_year === 2019)

  const filesB = JSON.parse(unitB.files)
  const chaptersB = JSON.parse(unitB.chapters)
  ok('Unit B: two files aggregated, ordered by track tag (01 before 02 despite readdir order)',
    filesB.length === 2 && filesB[0].path === '01 first.mp3' && filesB[1].path === '02 second.mp3')
  ok('Unit B: duration is the SUM of both files (50 + 60 = 110)', unitB.duration === 110)
  ok('Unit B: multi-file unit gets NO synthesized chapters', chaptersB.length === 0)
  ok('Unit B: no title tag → label falls back to the folder name ("Unit B")', unitB.label === 'Unit B')

  // ── mtime-incremental skip ──────────────────────────────────────────────────────
  const before = await scanner.scanLibrary()
  ok('an unchanged library is fully skipped on the next pass (mtime match)',
    before.scanned === 2 && before.skipped === 2 && before.upserted === 0)

  // ── upsert ON CONFLICT(path): touching a unit re-scans it and UPDATEs the SAME row ──
  const idBefore = db.prepare('SELECT id FROM units WHERE path = ?').get(unitA.path).id
  writeFileSync(join(libDir, 'Unit A', 'only.mp3'), JSON.stringify({
    format: { duration: '100', tags: { title: 'Alpha Revised', artist: 'Auth A', genre: 'Fantasy' } },
    streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    chapters: [{ start_time: '0', end_time: '100', tags: { title: 'Ch1' } }],
  }))
  const future = new Date(Date.now() + 5000)
  utimesSync(join(libDir, 'Unit A'), future, future)
  const rescan = await scanner.scanLibrary()
  ok('a touched unit is re-scanned (not skipped) and the rest stay skipped',
    rescan.upserted === 1 && rescan.skipped === 1)
  const idAfter = db.prepare('SELECT id, label FROM units WHERE path = ?').get(unitA.path)
  ok('ON CONFLICT(path) UPDATEs the SAME row (same id) rather than inserting a duplicate',
    idAfter.id === idBefore)
  ok('the updated row carries the new tag value', idAfter.label === 'Alpha Revised')
  ok('exactly one row still exists at that path (no duplicate from the upsert)',
    db.prepare('SELECT COUNT(*) AS n FROM units WHERE path = ?').get(unitA.path).n === 1)

  // ── prune vanished rows ──────────────────────────────────────────────────────────
  rmSync(join(libDir, 'Unit B'), { recursive: true, force: true })
  const pruneCounts = await scanner.scanLibrary()
  ok('removing a unit folder prunes its row on the next pass', pruneCounts.removed === 1 && pruneCounts.scanned === 1)
  ok('the pruned unit is actually gone from the table',
    db.prepare('SELECT COUNT(*) AS n FROM units WHERE path = ?').get(unitB.path).n === 0)
  ok('the surviving unit is untouched', db.prepare('SELECT COUNT(*) AS n FROM units').get().n === 1)

  db.close()
  rmSync(tmp, { recursive: true, force: true })
}

/* ═══ 4 · 'file' unit mode + custom extractCover — the shape 18.2 needs ══════════ */
if (Database) {
  section("4 · unit: 'file' (flat, one row per track) + a custom extractCover hook — proves the spec shape supports the music app's tag vocabulary with ZERO brick changes")

  const tmp = mkdtempSync(join(tmpdir(), 'weave-libscan-file-'))
  const libDir = join(tmp, 'library')
  const dataDir = join(tmp, 'data')
  mkdirSync(join(libDir, 'Artist', 'Album'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  // Music-shaped tags, per the Wave 18.2 line in git history: artist/album/albumartist/
  // track/disc/year/genre — a completely different vocabulary than PapyrOS's
  // title/author/narrator/series/genres, and 'file' unit mode (one row per track, not
  // one row per folder aggregating a multi-file rip).
  writeFileSync(join(libDir, 'Artist', 'Album', '01 song.mp3'), JSON.stringify({
    format: {
      duration: '210.4',
      tags: { artist: 'The Artist', album: 'The Album', albumartist: 'The Artist', track: '1/10', disc: '1', date: '2021', genre: 'Rock;Indie' },
    },
    streams: [{ codec_type: 'audio', codec_name: 'flac' }],
    chapters: [],
  }))
  writeFileSync(join(libDir, 'Artist', 'Album', '02 song.mp3'), JSON.stringify({
    format: {
      duration: '180.1',
      tags: { artist: 'The Artist', album: 'The Album', albumartist: 'The Artist', track: '2/10', disc: '1', date: '2021', genre: 'Rock;Indie' },
    },
    streams: [{ codec_type: 'audio', codec_name: 'flac' }],
    chapters: [],
  }))

  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      files TEXT, duration REAL, chapters TEXT, mtime INTEGER, art_path TEXT,
      artist TEXT, album TEXT, album_artist TEXT, track_no INTEGER, disc_no INTEGER, year INTEGER, genres TEXT
    )
  `)

  function mapMusicTags({ files }) {
    const t = files[0].tags
    return {
      artist: t.artist || null,
      album: t.album || null,
      album_artist: t.albumartist || null,
      track_no: parseTrackNumber(t.track),
      disc_no: parseTrackNumber(t.disc),
      year: t.date ? Number(String(t.date).slice(0, 4)) : null,
      genres: JSON.stringify(t.genre ? t.genre.split(';') : []),
    }
  }

  const coverCtxSeen = []
  const scanner = defineLibraryScanner({
    db, table: 'tracks', dir: libDir, dataDir,
    extensions: ['.mp3'], unit: 'file',
    columns: ['artist', 'album', 'album_artist', 'track_no', 'disc_no', 'year', 'genres'],
    mapTags: mapMusicTags,
    ffprobeBin: FAKE_FFPROBE,
    coverColumn: 'art_path',
    extractCover: (ctx) => { coverCtxSeen.push(ctx); return Promise.resolve(`covers/${ctx.id}.jpg`) },
  })

  const counts = await scanner.scanLibrary()
  ok("unit:'file' produces ONE row per track, not one per folder", counts.scanned === 2 && counts.upserted === 2)

  const tracks = db.prepare('SELECT * FROM tracks ORDER BY track_no').all()
  ok('two track rows, each keyed by its own file path (not the album folder)',
    tracks.length === 2 && tracks.every((t) => t.path.endsWith('.mp3')))
  ok('music tag vocabulary (artist/album/album_artist/track_no/disc_no/year/genres) mapped with NO brick changes',
    tracks[0].artist === 'The Artist' && tracks[0].album === 'The Album' && tracks[0].album_artist === 'The Artist'
    && tracks[0].track_no === 1 && tracks[1].track_no === 2 && tracks[0].disc_no === 1 && tracks[0].year === 2021
    && JSON.parse(tracks[0].genres).join(',') === 'Rock,Indie')
  ok('each track carries its OWN duration (not summed across the album)',
    Math.abs(tracks[0].duration - 210.4) < 1e-9 && Math.abs(tracks[1].duration - 180.1) < 1e-9)

  ok('a custom extractCover hook is invoked per unit with firstFileAbsPath/folderDir/dataDir/id/unitPath/unitName',
    coverCtxSeen.length === 2 && coverCtxSeen.every((c) => c.firstFileAbsPath && c.folderDir && c.dataDir === dataDir && typeof c.id === 'number' && c.unitPath && c.unitName))
  ok("a 'file'-unit's folderDir is its PARENT directory, not the file itself",
    coverCtxSeen[0].folderDir === join(libDir, 'Artist', 'Album'))
  ok("the custom extractCover's return value lands in the configured coverColumn (art_path)",
    tracks.every((t) => /^covers\/\d+\.jpg$/.test(t.art_path)))

  db.close()
  rmSync(tmp, { recursive: true, force: true })
}

/* ═══ 5 · excludeDirs — re-scoping a library without moving files ════════════════ */
if (Database) {
  section('5 · excludeDirs — folder NAMES the walk refuses to enter, at any depth')

  const tmp = mkdtempSync(join(tmpdir(), 'weave-libscan-excl-'))
  const libDir = join(tmp, 'library')
  const dataDir = join(tmp, 'data')
  mkdirSync(dataDir, { recursive: true })

  const probe = JSON.stringify({
    format: { duration: '100', tags: { artist: 'A', album: 'B' } },
    streams: [{ codec_type: 'audio', codec_name: 'flac' }],
    chapters: [],
  })
  const track = (...parts) => {
    const full = join(libDir, ...parts)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, probe)
    return full
  }
  track('Keep', '01.mp3')
  track('Retired', 'Artist', '02.mp3')
  track('Nested', 'Retired', '03.mp3')       // the name must match at ANY depth
  track('Retired Plus', '04.mp3')            // a PREFIX, not the name — must survive

  const mkDb = () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
      files TEXT, duration REAL, chapters TEXT, mtime INTEGER, cover_path TEXT, artist TEXT)`)
    return db
  }
  const scanner = (db, excludeDirs) => defineLibraryScanner({
    db, table: 'tracks', dir: libDir, dataDir, extensions: ['.mp3'], unit: 'file',
    columns: ['artist'], mapTags: ({ files }) => ({ artist: files[0].tags.artist || null }),
    ffprobeBin: FAKE_FFPROBE, extractCover: false, excludeDirs,
  })

  // The control: no exclusion at all sees every file. Without this the assertions
  // below would also pass on a walk that had simply stopped finding anything.
  const dbAll = mkDb()
  await scanner(dbAll, undefined).scanLibrary()
  ok('no excludeDirs walks the whole tree (the control)',
    dbAll.prepare('SELECT COUNT(*) n FROM tracks').get().n === 4)
  dbAll.close()

  const db = mkDb()
  await scanner(db, ['Retired']).scanLibrary()
  const paths = db.prepare('SELECT path FROM tracks ORDER BY path').all().map((r) => r.path)

  ok('an excluded directory is not walked',
    !paths.some((p) => p.includes(join('Retired', 'Artist'))))
  ok('the name matches at ANY depth, not only at the root',
    !paths.some((p) => p.includes(join('Nested', 'Retired'))))
  ok('the match is an exact NAME, not a prefix — "Retired Plus" survives',
    paths.some((p) => p.includes('Retired Plus')))
  ok('nothing else is lost', paths.some((p) => p.includes('Keep')))
  ok('exactly the two in-scope files remain', paths.length === 2, `got ${paths.length}`)

  db.close()
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nPASS: ${pass} passed, 0 failed`)
