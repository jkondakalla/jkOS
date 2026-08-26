// library.smoke.mjs (task 2.5) — end-to-end smoke for the library service: boots the
// REAL server.js (throwaway port + temp DB, weave dev-stub auth — same house pattern as
// apps/beigeboard/backend/test/import.smoke.mjs), points AUDIOBOOKS_DIR at the tiny
// fixture library committed alongside this test (fixtures/library/, regenerable via
// gen-fixtures.sh), and asserts the boot scan actually produces real `books` rows:
//
//   /health, /api/capabilities, /api/datasets      — basic discovery-doc shape (the
//     same {app, version, <list>[{id,...}]} envelope @jkos/weave's serveCapabilities/
//     serveDatasets already validate at boot — see packages/weave/src/shared/docShape.js
//     — asserted here structurally so a regression in the SERVED response, not just the
//     declared doc, fails loud).
//   the boot scan (non-blocking — server.js kicks it off in the listen() callback, not
//     awaited) — polled via GET /api/books until 2 rows appear or a bounded timeout.
//   Fixture Book A (single .m4b, embedded chapters + full tag set) — duration, tags,
//     and (queried straight off the sqlite file, since BOOK_SHAPE deliberately excludes
//     the `chapters`/`files` JSON blobs from the list row — see discovery.js) 2 chapters.
//   Fixture Book B (two .mp3 tracks, track=1/2 tags, no title tag) — duration SUMMED
//     across files, chapters NOT synthesized (scan.js only trusts a genuinely
//     single-file book's embedded chapter list), files aggregated in sequential
//     (track-tag) order.
//   GET /api/books?title=<prefix> — the declared `title` filter (prefix op) enforced.
//
// Requires `ffprobe` (and, only to regenerate the fixtures, `ffmpeg`) on PATH. If
// ffprobe is missing this smoke SKIPS with exit 0 and a loud message — see the note in
// Documentation/TESTING.md.
//
//   node apps/papyros/backend/test/library.smoke.mjs

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures', 'library');

// Claimed in the suite-manifest port registry ('papyros:library.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3990;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'papyros';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// ── ffprobe availability gate — SKIP (exit 0) rather than fail if it's missing ──────
try {
  await execFileAsync('ffprobe', ['-version']);
} catch {
  console.warn('⚠ SKIPPED library.smoke: `ffprobe` is not on PATH.');
  console.warn('  Install ffmpeg (which provides ffprobe) to run this smoke — see Documentation/TESTING.md.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'papyros-library-'));
const DB_PATH = join(tmp, 'test.db');

async function req(method, path) {
  const r = await fetch(BASE + path, { method });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

async function waitForHealth(ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited) return false; // the child is gone — polling the port can only find a stranger
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.service === SERVICE) return true;
        console.error(`  ✗ /health answered 200 but service=${JSON.stringify(body.service)} — ` +
                      `expected '${SERVICE}'. Another server owns this port.`);
        return false;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Poll GET /api/books until at least `count` rows appear (the boot scan is
 *  non-blocking) or the timeout elapses — returns whatever the last poll saw. */
async function waitForBooks(count, ms = 30000) {
  const deadline = Date.now() + ms;
  let rows = [];
  while (Date.now() < deadline) {
    const r = await req('GET', '/api/books');
    if (Array.isArray(r.json)) rows = r.json;
    if (rows.length >= count) return rows;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return rows;
}

/** Minimal structural check mirroring @jkos/weave's docShape rule (checkDocShape):
 *  {app:string, version:number, <listKey>:[{id:string, ...}]}. */
function assertDocShape(doc, listKey, label) {
  ok(!!doc && typeof doc === 'object', `${label}: response is an object`);
  ok(typeof doc?.app === 'string' && doc.app.length > 0, `${label}: doc.app is a non-empty string (got ${JSON.stringify(doc?.app)})`);
  ok(typeof doc?.version === 'number', `${label}: doc.version is a number (got ${JSON.stringify(doc?.version)})`);
  ok(Array.isArray(doc?.[listKey]), `${label}: doc.${listKey} is an array`);
  const entries = Array.isArray(doc?.[listKey]) ? doc[listKey] : [];
  ok(entries.length > 0, `${label}: doc.${listKey} is non-empty`);
  ok(entries.every((e) => typeof e?.id === 'string' && e.id.length > 0), `${label}: every ${listKey} entry has a string id`);
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: '',
    PORT: String(PORT),
    DB_PATH,
    AUDIOBOOKS_DIR: FIXTURES_DIR,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let exited = null; // fail fast: a child that dies pre-health must not be polled for
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
child.on('exit', (code, signal) => { exited = { code, signal }; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  // The child's own words, on ANY failure — not only when health never came up.
  if (fail && serverLog) console.error('\n── server log ──\n' + serverLog);
  console.log(`\nlibrary.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) {
    fail++;
    console.error('server never became healthy'
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : '')
      + ':\n' + serverLog);
    done();
  }

  // ── /health ──────────────────────────────────────────────────────────────────
  const health = await req('GET', '/health');
  ok(health.status === 200, `health: 200 (got ${health.status})`);
  ok(health.json?.status === 'ok', `health: status ok (got ${JSON.stringify(health.json)})`);
  ok(health.json?.service === 'papyros', `health: service is papyros (got ${health.json?.service})`);

  // ── /api/capabilities + /api/datasets ───────────────────────────────────────
  const caps = await req('GET', '/api/capabilities');
  ok(caps.status === 200, `capabilities: 200 (got ${caps.status})`);
  assertDocShape(caps.json, 'capabilities', 'capabilities');
  const rescanCap = caps.json?.capabilities?.find((c) => c.id === 'rescanLibrary');
  ok(!!rescanCap, 'capabilities: declares rescanLibrary');

  const datasets = await req('GET', '/api/datasets');
  ok(datasets.status === 200, `datasets: 200 (got ${datasets.status})`);
  assertDocShape(datasets.json, 'datasets', 'datasets');
  const booksDs = datasets.json?.datasets?.find((d) => d.id === 'books');
  ok(!!booksDs && Array.isArray(booksDs.item), 'datasets: declares a `books` dataset with a row shape');
  ok(Array.isArray(booksDs?.filters) && booksDs.filters.some((f) => f.name === 'title'),
    'datasets: `books` declares a `title` filter');
  ok(Array.isArray(booksDs?.filters) && booksDs.filters.some((f) => f.name === 'genre' && f.column === 'genres' && f.op === 'tags'),
    'datasets: `books` declares a `genre` filter (JSON-array membership, the `tags` op)');

  // ── boot scan: poll /api/books until the 2-book fixture library lands ──────
  const rows = await waitForBooks(2);
  ok(rows.length === 2, `scan: exactly 2 book rows produced (got ${rows.length}: ${JSON.stringify(rows.map((r) => r.title))})`);

  const bookA = rows.find((r) => r.title === 'Fixture Book A');
  const bookB = rows.find((r) => r.title === 'Fixture Book B');
  ok(!!bookA, `scan: Fixture Book A row present (titles seen: ${JSON.stringify(rows.map((r) => r.title))})`);
  ok(!!bookB, `scan: Fixture Book B row present (titles seen: ${JSON.stringify(rows.map((r) => r.title))})`);

  // ── Book A: single-file .m4b, embedded tags + chapters ──────────────────────
  if (bookA) {
    ok(typeof bookA.duration === 'number' && bookA.duration > 1.9 && bookA.duration < 2.2,
      `A: duration ~2s (got ${bookA.duration})`);
    ok(bookA.author === 'Fixture Author A', `A: author from embedded artist tag (got ${bookA.author})`);
    ok(bookA.series === 'Fixture Series One', `A: series from embedded album tag (got ${bookA.series})`);
    ok(bookA.year === 2024, `A: year from embedded date tag (got ${bookA.year})`);
    ok(bookA.metadata_source === 'embedded', `A: metadata_source embedded (got ${bookA.metadata_source})`);
    ok(Array.isArray(bookA.genres) && bookA.genres.join(',') === 'Fantasy,Adventure',
      `A: genres split from the embedded genre tag (got ${JSON.stringify(bookA.genres)})`);
  }

  // ── Book B: two .mp3 files, track=1/2 tags, no title tag (folder-name fallback) ──
  if (bookB) {
    ok(typeof bookB.duration === 'number' && bookB.duration > 3.9 && bookB.duration < 4.3,
      `B: duration is the SUM of both ~2.04s tracks (got ${bookB.duration})`);
    ok(bookB.author === 'Fixture Author B', `B: author from embedded artist tag (got ${bookB.author})`);
    ok(bookB.series === null, `B: album == title (standalone rip) maps to NO series — the junk-pill fix (got ${bookB.series})`);
    ok(bookB.year === 2023, `B: year from embedded date tag (got ${bookB.year})`);
    ok(bookB.metadata_source === 'embedded', `B: metadata_source embedded (got ${bookB.metadata_source})`);
  }

  // ── chapters/files: not on the list row (BOOK_SHAPE excludes them) — read the
  //    sqlite file directly, a second (read-only) connection alongside the server's ──
  if (bookA && bookB) {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    try {
      const rawA = db.prepare('SELECT files, chapters FROM books WHERE id = ?').get(bookA.id);
      const filesA = JSON.parse(rawA.files);
      const chaptersA = JSON.parse(rawA.chapters);
      ok(filesA.length === 1, `A: single-file aggregation (files.length got ${filesA.length})`);
      ok(chaptersA.length === 2, `A: 2 embedded chapters carried through (got ${chaptersA.length})`);
      ok(chaptersA[0]?.title === 'Chapter One' && chaptersA[1]?.title === 'Chapter Two',
        `A: chapter titles in order (got ${JSON.stringify(chaptersA.map((c) => c.title))})`);
      ok(chaptersA[0]?.start === 0 && chaptersA[0]?.end === 1 && chaptersA[1]?.start === 1 && chaptersA[1]?.end === 2,
        `A: chapter start/end seconds (got ${JSON.stringify(chaptersA)})`);

      const rawB = db.prepare('SELECT files, chapters FROM books WHERE id = ?').get(bookB.id);
      const filesB = JSON.parse(rawB.files);
      const chaptersB = JSON.parse(rawB.chapters);
      ok(filesB.length === 2, `B: two files aggregated (got ${filesB.length})`);
      ok(chaptersB.length === 0, `B: multi-file book gets NO synthesized chapters (got ${chaptersB.length})`);
      ok(filesB[0]?.index === 0 && filesB[1]?.index === 1, 'B: files indexed 0, 1');
      ok(filesB[0]?.path === '01 track one.mp3' && filesB[1]?.path === '02 track two.mp3',
        `B: files ordered sequentially by track tag (got ${JSON.stringify(filesB.map((f) => f.path))})`);
    } finally {
      db.close();
    }
  }

  // ── GET /api/books?title=<prefix> — the declared prefix filter is enforced ──
  const bothPrefix = await req('GET', '/api/books?title=Fixture');
  ok(Array.isArray(bothPrefix.json) && bothPrefix.json.length === 2,
    `filter: title=Fixture (common prefix) matches both books (got ${bothPrefix.json?.length})`);

  const onePrefix = await req('GET', '/api/books?title=' + encodeURIComponent('Fixture Book A'));
  ok(Array.isArray(onePrefix.json) && onePrefix.json.length === 1 && onePrefix.json[0]?.title === 'Fixture Book A',
    `filter: title=Fixture Book A matches only Book A (got ${JSON.stringify(onePrefix.json?.map((r) => r.title))})`);

  const noMatch = await req('GET', '/api/books?title=Nonexistent');
  ok(Array.isArray(noMatch.json) && noMatch.json.length === 0,
    `filter: title=Nonexistent matches nothing (got ${noMatch.json?.length})`);

  // ── GET /api/books?genre=<value> — the declared `genre` filter (tags op, JSON-array
  //    membership) is enforced. Book A carries genres ["Fantasy","Adventure"] (fixture
  //    tag "Fantasy;Adventure"), Book B carries ["Sci-Fi"] — see gen-fixtures.sh. ──
  const genreFantasy = await req('GET', '/api/books?genre=Fantasy');
  ok(Array.isArray(genreFantasy.json) && genreFantasy.json.length === 1 && genreFantasy.json[0]?.title === 'Fixture Book A',
    `filter: genre=Fantasy matches only Book A (got ${JSON.stringify(genreFantasy.json?.map((r) => r.title))})`);

  const genreSciFi = await req('GET', '/api/books?genre=' + encodeURIComponent('Sci-Fi'));
  ok(Array.isArray(genreSciFi.json) && genreSciFi.json.length === 1 && genreSciFi.json[0]?.title === 'Fixture Book B',
    `filter: genre=Sci-Fi matches only Book B (got ${JSON.stringify(genreSciFi.json?.map((r) => r.title))})`);

  const genreNoMatch = await req('GET', '/api/books?genre=Nonexistent');
  ok(Array.isArray(genreNoMatch.json) && genreNoMatch.json.length === 0,
    `filter: genre=Nonexistent matches nothing (got ${genreNoMatch.json?.length})`);

  // A genre that's a PREFIX of a real tag must NOT match (membership, not substring) —
  // "Fantas" is a strict prefix of Book A's "Fantasy" tag.
  const genrePrefixOnly = await req('GET', '/api/books?genre=Fantas');
  ok(Array.isArray(genrePrefixOnly.json) && genrePrefixOnly.json.length === 0,
    `filter: genre=Fantas (strict prefix, not a full tag) matches nothing (got ${genrePrefixOnly.json?.length})`);
} catch (e) {
  console.error('library.smoke crashed:', e);
  fail++;
} finally {
  done();
}
