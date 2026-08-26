// library.smoke.mjs (ToDo §3 18.2) — end-to-end smoke for the library service: boots
// the REAL server.js (throwaway port + temp DB, weave dev-stub auth — same house
// pattern as apps/papyros/backend/test/library.smoke.mjs), points MUSIC_DIR at the
// tiny fixture library committed alongside this test (fixtures/library/, regenerable
// via gen-fixtures.sh), and asserts the boot scan actually produces real `tracks` rows:
//
//   /health, /api/capabilities, /api/datasets      — basic discovery-doc shape.
//   the boot scan (non-blocking — server.js kicks it off in the listen() callback, not
//     awaited) — polled via GET /api/tracks until 3 rows appear or a bounded timeout.
//   `unit: 'file'` scanning: 3 TRACK rows from 3 files across 2 albums/artists (NOT
//     1 row per folder — the 17.2 brick's second unit shape, proven by the weave
//     hermetic test; this is the real-server end-to-end confirmation).
//   Album One's two tracks: title/artist/album/albumartist/track_no/disc_no/year/
//     genres all mapped from real ffprobe tags, each track's OWN duration (not summed
//     — unlike a papyros multi-file BOOK, these are independent catalog rows).
//   Album Two's one track: no `album_artist` tag in the fixture (gen-fixtures.sh) —
//     scan.js's mapTags falls back to the `artist` tag, proven end-to-end here.
//   GET /api/tracks?artist=<prefix> / ?album=<exact> / ?genre=<tag> / ?title=<prefix>
//     — the declared filters enforced, doubling as the artist→album→track hierarchy
//     browse contract (18.2's design constraint: derived at read time, no extra tables).
//
// Requires `ffprobe` on PATH. If ffprobe is missing this smoke SKIPS with exit 0 and a
// loud message — see the note in Documentation/TESTING.md.
//
//   node apps/kouros/backend/test/library.smoke.mjs

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

// Claimed in the suite-manifest port registry ('kouros:library.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3980;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'kouros';

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

const tmp = mkdtempSync(join(tmpdir(), 'kouros-library-'));
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

/** Poll GET /api/tracks until at least `count` rows appear (the boot scan is
 *  non-blocking) or the timeout elapses — returns whatever the last poll saw. */
async function waitForTracks(count, ms = 30000) {
  const deadline = Date.now() + ms;
  let rows = [];
  while (Date.now() < deadline) {
    const r = await req('GET', '/api/tracks');
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
    MUSIC_DIR: FIXTURES_DIR,
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
  ok(health.json?.service === 'kouros', `health: service is kouros (got ${health.json?.service})`);

  // ── /api/capabilities + /api/datasets ───────────────────────────────────────
  const caps = await req('GET', '/api/capabilities');
  ok(caps.status === 200, `capabilities: 200 (got ${caps.status})`);
  assertDocShape(caps.json, 'capabilities', 'capabilities');
  const rescanCap = caps.json?.capabilities?.find((c) => c.id === 'rescanLibrary');
  ok(!!rescanCap, 'capabilities: declares rescanLibrary');
  ok(JSON.stringify(rescanCap?.scopes) === JSON.stringify(['kouros:admin']),
    `capabilities: rescanLibrary is admin-scoped (got ${JSON.stringify(rescanCap?.scopes)})`);

  const datasets = await req('GET', '/api/datasets');
  ok(datasets.status === 200, `datasets: 200 (got ${datasets.status})`);
  assertDocShape(datasets.json, 'datasets', 'datasets');
  const tracksDs = datasets.json?.datasets?.find((d) => d.id === 'tracks');
  ok(!!tracksDs && Array.isArray(tracksDs.item), 'datasets: declares a `tracks` dataset with a row shape');
  ok(Array.isArray(tracksDs?.filters) && tracksDs.filters.some((f) => f.name === 'artist' && f.op === 'prefix'),
    'datasets: `tracks` declares an `artist` prefix filter');
  ok(Array.isArray(tracksDs?.filters) && tracksDs.filters.some((f) => f.name === 'album' && f.op === 'eq'),
    'datasets: `tracks` declares an exact `album` filter');
  ok(Array.isArray(tracksDs?.filters) && tracksDs.filters.some((f) => f.name === 'genre' && f.column === 'genres' && f.op === 'tags'),
    'datasets: `tracks` declares a `genre` filter (JSON-array membership, the `tags` op)');
  ['playlists', 'history', 'ratings'].forEach((id) => {
    ok(!!datasets.json?.datasets?.find((d) => d.id === id), `datasets: declares a \`${id}\` dataset`);
  });

  // ── boot scan: poll /api/tracks until the 3-track fixture library lands ──────
  const rows = await waitForTracks(3);
  ok(rows.length === 3, `scan: exactly 3 track rows produced (got ${rows.length}: ${JSON.stringify(rows.map((r) => r.title))})`);

  const song1 = rows.find((r) => r.title === 'Song One');
  const song2 = rows.find((r) => r.title === 'Song Two');
  const solo = rows.find((r) => r.title === 'Solo Track');
  ok(!!song1 && !!song2 && !!solo, `scan: all 3 fixture tracks present (titles seen: ${JSON.stringify(rows.map((r) => r.title))})`);

  // ── Album One's two tracks: full tag set, INDEPENDENT rows (not aggregated) ──
  if (song1 && song2) {
    ok(typeof song1.duration === 'number' && song1.duration > 1.9 && song1.duration < 2.2,
      `song1: OWN duration ~2s, not summed with song2 (got ${song1.duration})`);
    ok(song1.artist === 'Artist One', `song1: artist tag (got ${song1.artist})`);
    ok(song1.album === 'Album One', `song1: album tag (got ${song1.album})`);
    ok(song1.albumartist === 'Artist One', `song1: albumartist from the album_artist tag (got ${song1.albumartist})`);
    ok(song1.track_no === 1 && song2.track_no === 2, `song1/song2: track_no parsed from "N/2" (got ${song1.track_no}, ${song2.track_no})`);
    ok(song1.disc_no === 1, `song1: disc_no parsed (got ${song1.disc_no})`);
    ok(song1.year === 2021, `song1: year from the date tag (got ${song1.year})`);
    ok(Array.isArray(song1.genres) && song1.genres.join(',') === 'Rock,Indie',
      `song1: genres split from the embedded genre tag (got ${JSON.stringify(song1.genres)})`);
    ok(song1.id !== song2.id, 'song1/song2: DISTINCT rows — unit:\'file\' does not aggregate an album into one row');
  }

  // ── Album Two's one track: NO album_artist tag → falls back to artist ────────
  if (solo) {
    ok(solo.artist === 'Artist Two', `solo: artist tag (got ${solo.artist})`);
    ok(solo.albumartist === 'Artist Two',
      `solo: albumartist falls back to artist when no album_artist tag is present (got ${solo.albumartist})`);
    ok(solo.year === 2022, `solo: year from the date tag (got ${solo.year})`);
    ok(Array.isArray(solo.genres) && solo.genres.join(',') === 'Jazz', `solo: single genre (got ${JSON.stringify(solo.genres)})`);
  }

  // ── GET /api/tracks?artist=<prefix> — the declared prefix filter is enforced ──
  const artistFilter = await req('GET', '/api/tracks?artist=' + encodeURIComponent('Artist One'));
  ok(Array.isArray(artistFilter.json) && artistFilter.json.length === 2,
    `filter: artist=Artist One matches both Album One tracks (got ${artistFilter.json?.length})`);

  const artistPrefix = await req('GET', '/api/tracks?artist=Artist');
  ok(Array.isArray(artistPrefix.json) && artistPrefix.json.length === 3,
    `filter: artist=Artist (common prefix) matches all 3 tracks (got ${artistPrefix.json?.length})`);

  // ── GET /api/tracks?album=<exact> — hierarchy browse: all tracks in one album ──
  const albumExact = await req('GET', '/api/tracks?album=' + encodeURIComponent('Album One'));
  ok(Array.isArray(albumExact.json) && albumExact.json.length === 2
    && albumExact.json.every((r) => r.album === 'Album One'),
    `filter: album=Album One (exact) matches only Album One's 2 tracks (got ${JSON.stringify(albumExact.json?.map((r) => r.title))})`);

  const albumPrefixOnly = await req('GET', '/api/tracks?album=' + encodeURIComponent('Album O'));
  ok(Array.isArray(albumPrefixOnly.json) && albumPrefixOnly.json.length === 0,
    `filter: album is EXACT, not prefix — "Album O" matches nothing (got ${albumPrefixOnly.json?.length})`);

  // ── GET /api/tracks?title=<prefix> — search-ish prefix over title ────────────
  const titlePrefix = await req('GET', '/api/tracks?title=Song');
  ok(Array.isArray(titlePrefix.json) && titlePrefix.json.length === 2,
    `filter: title=Song (prefix) matches Song One + Song Two (got ${titlePrefix.json?.length})`);

  // ── GET /api/tracks?genre=<value> — JSON-array membership, not substring ─────
  const genreRock = await req('GET', '/api/tracks?genre=Rock');
  ok(Array.isArray(genreRock.json) && genreRock.json.length === 2,
    `filter: genre=Rock matches both Album One tracks (got ${genreRock.json?.length})`);
  const genreJazz = await req('GET', '/api/tracks?genre=Jazz');
  ok(Array.isArray(genreJazz.json) && genreJazz.json.length === 1 && genreJazz.json[0]?.title === 'Solo Track',
    `filter: genre=Jazz matches only the solo track (got ${JSON.stringify(genreJazz.json?.map((r) => r.title))})`);
  const genrePrefixOnly = await req('GET', '/api/tracks?genre=Roc');
  ok(Array.isArray(genrePrefixOnly.json) && genrePrefixOnly.json.length === 0,
    `filter: genre=Roc (strict prefix, not a full tag) matches nothing (got ${genrePrefixOnly.json?.length})`);

  // ── `files`/`chapters`/`path` are NOT on the list row (TRACK_SHAPE excludes them) ──
  ok(song1 && !('path' in song1) && !('files' in song1) && !('chapters' in song1),
    'scan: tracks list row excludes path/files/chapters (internal-only columns)');
} catch (e) {
  console.error('library.smoke crashed:', e);
  fail++;
} finally {
  done();
}
