// meta.smoke.mjs (task 4.4) — Wave 4's metadata-enrichment smoke: boots the REAL server
// (throwaway port + temp DB, a REAL RS256 keypair so forged tokens can prove the
// matchAllMissing admin gate — same recipe as playback.smoke.mjs) against the committed
// fixture library, with globalThis.fetch replaced BEFORE server.js ever loads by
// fixtures/meta/fetch-mock-preload.cjs (via `NODE_OPTIONS=--require`) — so 4.1's META
// connector (discovery.js) and 4.2/4.3's matchBook/matchAllMissing (src/routes/match.js)
// hit a canned iTunes payload + fake artwork bytes instead of the real network. The
// preload throws loudly on any URL it doesn't recognize, so a real-network leak fails the
// request (and this smoke) hard rather than hanging or reaching the internet.
//
// Asserts:
//   1. Connector mapping (4.1): unauthenticated GET /api/metadataSearch → 401;
//      authenticated → 200 bare-array, exactly the 7 declared fields per row, every field
//      correctly mapped off the canned iTunes payload (collectionId→id numeric,
//      collectionName→title, artistName→author, artworkUrl100→cover, description→
//      description, releaseDate→year, primaryGenreName→genre) — then reads the upstream
//      URL the preload recorded and asserts it's exactly
//      https://itunes.apple.com/search?media=audiobook&entity=audiobook&limit=5&term=…
//   2. matchBook end-to-end (4.2), through the real server, on a scanner-produced fixture
//      book (boot scan — reuses playback.smoke's readiness-polling pattern): POST
//      /api/match with the CANDIDATE ROW straight off step 1's real metadataSearch
//      response (not a hand-typed lookalike) → 200 {updated:true, cover:'updated'}; the
//      book row now carries author/description/year/genres(merged)/
//      metadata_source:'itunes'/ext_ref:'itunes:<id>', title UNCHANGED (scanner wins),
//      cover_path set; the cover FILE on disk under the temp data dir has the fake JPEG's
//      exact bytes; the artwork request the preload saw was the 600x600 upsize of the
//      candidate's 100x100 URL.
//   3. A cheap 4.3 pin: non-admin POST /api/match/all → 403 (the deep batch semantics —
//      exact-match gate, throttle, review list — are covered by dev-time verification;
//      this just pins the admin gate through the real server, same house pattern as
//      routes/library.js's rescanLibrary admin check).
//
// Requires `ffprobe`/`ffmpeg` on PATH (same as library.smoke.mjs/playback.smoke.mjs) —
// SKIPS cleanly (exit 0, loud warning) if ffprobe is absent.
//
//   node apps/papyros/backend/test/meta.smoke.mjs

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures', 'library');
const PRELOAD_PATH = join(__dirname, 'fixtures', 'meta', 'fetch-mock-preload.cjs');
const { ITUNES_ITEM, FAKE_JPEG_MARKER } = require('./fixtures/meta/fetch-mock-data.cjs');

// Claimed in the suite-manifest port registry ('papyros:meta.smoke') — the
// `port-registry` probe holds this literal to that claim. It used to be 3992,
// shared with BeigeBoard's routine-spec.smoke — that overlap is exactly OPS-1.
const PORT = 3996;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'papyros';
const ISSUER = 'jkos-auth';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// ── ffprobe availability gate — SKIP (exit 0) rather than fail if it's missing ──────
try {
  await execFileAsync('ffprobe', ['-version']);
} catch {
  console.warn('⚠ SKIPPED meta.smoke: `ffprobe` is not on PATH.');
  console.warn('  Install ffmpeg (which provides ffprobe) to run this smoke — see Documentation/TESTING.md.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'papyros-meta-'));
const DB_PATH = join(tmp, 'test.db');           // DATA_DIR (server.js) === dirname(DB_PATH) === tmp
const FETCH_MOCK_LOG = join(tmp, 'fetch-log.ndjson');

// ── Forge suite tokens: RS256 over a throwaway keypair the server is told to trust —
//    same recipe as playback.smoke.mjs, needed here because the dev-stub auth only ever
//    injects ONE identity (role:'admin'), which can't exercise the matchAllMissing
//    non-admin 403 gate.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mkToken(claims) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: '1' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, ...claims }));
  const input = `${header}.${payload}`;
  const sig = b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey));
  return `${input}.${sig}`;
}
const ADMIN = mkToken({ sub: 401, role: 'admin', scope: ['papyros:admin', 'papyros:write'] });
const USER = mkToken({ sub: 402, role: 'user', scope: ['papyros:write'] });

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

/** Poll GET /api/books (authenticated) until at least `count` rows appear (the boot scan
 *  is non-blocking) or the timeout elapses — same pattern as playback.smoke.mjs. */
async function waitForBooks(token, count, ms = 30000) {
  const deadline = Date.now() + ms;
  let rows = [];
  while (Date.now() < deadline) {
    const r = await req('GET', '/api/books', undefined, token);
    if (Array.isArray(r.json)) rows = r.json;
    if (rows.length >= count) return rows;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return rows;
}

/** Read every fetch call fetch-mock-preload.cjs has recorded so far (each is one JSON
 *  line — see that file). The server process appends synchronously (fs.appendFileSync)
 *  before its own fetch resolves, so by the time an awaited request that TRIGGERS an
 *  upstream call has returned to us, its log line is already on disk. */
function readFetchLog() {
  try {
    return readFileSync(FETCH_MOCK_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: '',
    PORT: String(PORT),
    DB_PATH,
    AUDIOBOOKS_DIR: FIXTURES_DIR,
    JKOS_AUTH_PUBLIC_KEY: publicKey,
    JKOS_AUTH_ISSUER: ISSUER,
    FETCH_MOCK_LOG,
    // Quoted so a space anywhere in PRELOAD_PATH's absolute path (this repo checkout
    // lives under a directory with a space in its name) doesn't get whitespace-split by
    // Node's own NODE_OPTIONS parser — confirmed this quoting survives child_process.spawn
    // (no shell involved: the string reaches the child's env verbatim, then the CHILD
    // node binary parses it, respecting the quotes) before relying on it here.
    NODE_OPTIONS: `--require "${PRELOAD_PATH}"`,
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
  console.log(`\nmeta.smoke: ${pass} passed, ${fail} failed`);
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
  ok(serverLog.includes('[fetch-mock-preload] globalThis.fetch replaced'),
    'preload: fetch-mock-preload.cjs ran before server.js booted (its startup line is in the server log)');

  const books = await waitForBooks(ADMIN, 2);
  ok(books.length === 2, `scan: exactly 2 book rows produced (got ${books.length}: ${JSON.stringify(books.map((r) => r.title))})`);
  const bookA = books.find((r) => r.title === 'Fixture Book A');
  ok(!!bookA, `scan: Fixture Book A row present (titles seen: ${JSON.stringify(books.map((r) => r.title))})`);

  // =====================================================================================
  // 1. Connector mapping (4.1): GET /api/metadataSearch
  // =====================================================================================
  const term = 'canned chronicles';
  const anonSearch = await fetch(BASE + `/api/metadataSearch?term=${encodeURIComponent(term)}`);
  ok(anonSearch.status === 401, `metadataSearch: unauthenticated → 401 (got ${anonSearch.status})`);

  const searchRes = await req('GET', `/api/metadataSearch?term=${encodeURIComponent(term)}`, undefined, ADMIN);
  ok(searchRes.status === 200, `metadataSearch: authenticated → 200 (got ${searchRes.status} ${JSON.stringify(searchRes.json)})`);
  ok(Array.isArray(searchRes.json), `metadataSearch: response is a bare array (got ${JSON.stringify(searchRes.json)})`);

  const candidate = Array.isArray(searchRes.json) ? searchRes.json[0] : undefined;
  ok(!!candidate, `metadataSearch: at least one row came back (got ${JSON.stringify(searchRes.json)})`);

  const EXPECTED_FIELDS = ['id', 'title', 'author', 'cover', 'description', 'year', 'genre'];
  if (candidate) {
    const keys = Object.keys(candidate).sort();
    ok(keys.length === EXPECTED_FIELDS.length && EXPECTED_FIELDS.slice().sort().every((f, i) => keys[i] === f),
      `metadataSearch: row has exactly the 7 declared typed fields (got ${JSON.stringify(keys)}, expected ${JSON.stringify(EXPECTED_FIELDS.slice().sort())})`);

    ok(candidate.id === ITUNES_ITEM.collectionId && typeof candidate.id === 'number',
      `metadataSearch: collectionId→id, numeric (got ${JSON.stringify(candidate.id)} typeof ${typeof candidate.id}, expected ${ITUNES_ITEM.collectionId})`);
    ok(candidate.title === ITUNES_ITEM.collectionName,
      `metadataSearch: collectionName→title (got ${JSON.stringify(candidate.title)}, expected ${JSON.stringify(ITUNES_ITEM.collectionName)})`);
    ok(candidate.author === ITUNES_ITEM.artistName,
      `metadataSearch: artistName→author (got ${JSON.stringify(candidate.author)}, expected ${JSON.stringify(ITUNES_ITEM.artistName)})`);
    ok(candidate.cover === ITUNES_ITEM.artworkUrl100,
      `metadataSearch: artworkUrl100→cover (got ${JSON.stringify(candidate.cover)}, expected ${JSON.stringify(ITUNES_ITEM.artworkUrl100)})`);
    ok(candidate.description === ITUNES_ITEM.description,
      `metadataSearch: description→description (got ${JSON.stringify(candidate.description)}, expected ${JSON.stringify(ITUNES_ITEM.description)})`);
    ok(candidate.year === ITUNES_ITEM.releaseDate,
      `metadataSearch: releaseDate→year, untouched ISO string (got ${JSON.stringify(candidate.year)}, expected ${JSON.stringify(ITUNES_ITEM.releaseDate)})`);
    ok(candidate.genre === ITUNES_ITEM.primaryGenreName,
      `metadataSearch: primaryGenreName→genre (got ${JSON.stringify(candidate.genre)}, expected ${JSON.stringify(ITUNES_ITEM.primaryGenreName)})`);
  }

  // The preload recorded the actual upstream URL — assert it's the exact contract 4.1's
  // discovery.js declares (media/entity/limit fixed, term passed through untouched).
  const searchCall = readFetchLog().find((c) => c.url.includes('itunes.apple.com/search'));
  ok(!!searchCall, `metadataSearch: preload recorded an upstream iTunes search call (log: ${JSON.stringify(readFetchLog())})`);
  if (searchCall) {
    const u = new URL(searchCall.url);
    ok(u.origin + u.pathname === 'https://itunes.apple.com/search',
      `metadataSearch: upstream URL is https://itunes.apple.com/search (got ${u.origin + u.pathname})`);
    ok(u.searchParams.get('media') === 'audiobook', `metadataSearch: upstream query media=audiobook (got ${u.searchParams.get('media')})`);
    ok(u.searchParams.get('entity') === 'audiobook', `metadataSearch: upstream query entity=audiobook (got ${u.searchParams.get('entity')})`);
    ok(u.searchParams.get('limit') === '5', `metadataSearch: upstream query limit=5 (got ${u.searchParams.get('limit')})`);
    ok(u.searchParams.get('term') === term, `metadataSearch: upstream query term passed through untouched (got ${u.searchParams.get('term')}, expected ${term})`);
  }

  // =====================================================================================
  // 2. matchBook end-to-end (4.2): POST /api/match with step 1's REAL candidate row
  // =====================================================================================
  if (bookA && candidate) {
    const before = await req('GET', `/api/book/${bookA.id}`, undefined, ADMIN);
    ok(before.json?.metadata_source === 'embedded', `match: bookA starts metadata_source='embedded' (got ${before.json?.metadata_source})`);
    ok(!before.json?.cover_path, `match: bookA starts with no cover_path (got ${JSON.stringify(before.json?.cover_path)})`);
    ok(before.json?.description == null, `match: bookA starts with no description (got ${JSON.stringify(before.json?.description)})`);
    const genresBefore = Array.isArray(before.json?.genres) ? before.json.genres : [];

    // A regular (non-admin) user can call matchBook — it carries no admin gate (4.2's
    // discovery.js comment: scopes:['papyros:write'], not ['papyros:admin']).
    const matchRes = await req('POST', '/api/match', { bookId: bookA.id, candidate }, USER);
    ok(matchRes.status === 200, `match: POST /api/match → 200 (got ${matchRes.status} ${JSON.stringify(matchRes.json)})`);
    ok(matchRes.json?.updated === true, `match: response updated:true (got ${JSON.stringify(matchRes.json)})`);
    ok(matchRes.json?.cover === 'updated', `match: response cover:'updated' (got ${JSON.stringify(matchRes.json)})`);

    const after = await req('GET', `/api/book/${bookA.id}`, undefined, ADMIN);
    ok(after.json?.title === 'Fixture Book A', `match: title UNCHANGED — scanner title wins (got ${JSON.stringify(after.json?.title)})`);
    ok(after.json?.author === candidate.author, `match: author written from candidate (got ${JSON.stringify(after.json?.author)}, expected ${JSON.stringify(candidate.author)})`);
    ok(after.json?.description === candidate.description, `match: description written from candidate (got ${JSON.stringify(after.json?.description)}, expected ${JSON.stringify(candidate.description)})`);
    ok(after.json?.year === 2019, `match: year extracted from candidate's ISO releaseDate via extractYear (got ${JSON.stringify(after.json?.year)}, expected 2019)`);
    ok(Array.isArray(after.json?.genres) && after.json.genres.includes(candidate.genre)
      && genresBefore.every((g) => after.json.genres.includes(g)),
      `match: genres MERGED — existing genres kept, candidate.genre appended (before ${JSON.stringify(genresBefore)}, after ${JSON.stringify(after.json?.genres)})`);
    ok(after.json?.metadata_source === 'itunes', `match: metadata_source='itunes' (got ${JSON.stringify(after.json?.metadata_source)})`);
    ok(after.json?.ext_ref === `itunes:${candidate.id}`, `match: ext_ref='itunes:<id>' (got ${JSON.stringify(after.json?.ext_ref)}, expected itunes:${candidate.id})`);
    ok(!!after.json?.cover_path, `match: cover_path now set (got ${JSON.stringify(after.json?.cover_path)})`);

    // The cover FILE actually landed on disk under the temp data dir, with the fake
    // JPEG's exact bytes (proves the write path, not just the DB column).
    if (after.json?.cover_path) {
      const coverAbsPath = join(tmp, after.json.cover_path);   // DATA_DIR === tmp (dirname(DB_PATH))
      let coverBytes = null;
      try { coverBytes = readFileSync(coverAbsPath); } catch { /* asserted below */ }
      ok(!!coverBytes, `match: cover file exists on disk at ${coverAbsPath}`);
      ok(!!coverBytes && coverBytes.equals(Buffer.from(FAKE_JPEG_MARKER, 'utf8')),
        `match: cover file bytes are EXACTLY the fake JPEG the preload served (got ${coverBytes ? coverBytes.length : 0} bytes)`);
    }

    // The artwork request the preload saw was the 600x600 upsize of the candidate's
    // 100x100 URL (src/routes/match.js's upsizeArtwork()).
    const artworkCall = readFetchLog().slice().reverse().find((c) => c.url.includes('mzstatic.com'));
    ok(!!artworkCall, `match: preload recorded an artwork download call (log: ${JSON.stringify(readFetchLog())})`);
    if (artworkCall) {
      const expectedUpsized = candidate.cover.replace('100x100', '600x600');
      ok(artworkCall.url === expectedUpsized,
        `match: artwork request was the 600x600 upsize (got ${artworkCall.url}, expected ${expectedUpsized})`);
    }
  }

  // =====================================================================================
  // 3. 4.3 pin: matchAllMissing's admin gate, through the real server
  // =====================================================================================
  const matchAllRes = await req('POST', '/api/match/all', {}, USER);
  ok(matchAllRes.status === 403, `match/all: non-admin → 403 (got ${matchAllRes.status} ${JSON.stringify(matchAllRes.json)})`);
} catch (e) {
  console.error('meta.smoke crashed:', e);
  fail++;
} finally {
  done();
}
