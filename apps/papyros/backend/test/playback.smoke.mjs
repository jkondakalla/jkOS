// playback.smoke.mjs (task 3.5) — the playback backend smoke: boots the REAL server
// (throwaway port + temp DB, the committed fixture library, a REAL RS256 keypair so
// forged per-user tokens exercise the actual verify path rather than the weave
// dev-stub — same pattern as apps/beigeboard/backend/test/items.smoke.mjs) and asserts:
//
//   • unauthenticated media request → 401 (a cheap regression pin for 3.4's mount-
//     ordering fix — the media router sits behind the identity gate same as everything
//     else under /api).
//   • owner-scoped `progress` round-trip as two mock users (3.1's defineCollection
//     scoping contract): A creates a row, only A sees it; B creates its own, only B
//     sees that one; cross-user PATCH/DELETE 404 instead of leaking/mutating; a real
//     position-bump update; the `finished` boolean filter.
//   • Range-aware audio streaming (GET /api/stream/:bookId/:fileIndex) on a real
//     scanned fixture file — `Range: bytes=0-1023` → 206 with the correct
//     Content-Range/Content-Length/body-length trio, computed off the ACTUAL file size
//     on disk (never hardcoded — gen-fixtures.sh's header notes encoder-version drift
//     can nudge file sizes across ffmpeg versions).
//   • cover art (GET /api/cover/:bookId) → 200 once the scanner has picked up a real
//     folder-level cover.jpg (added by this task to Fixture Book B — see
//     fixtures/library/gen-fixtures.sh's header for why B and not A).
//
// ── Two packages/weave bugs, FIXED (were pinned here, now regression-asserted) ──────
//
// (a) A `type: 'ref'` field (book_ref/club_ref/current_pick) gets a TEXT-affinity
// column (collection.js's sqlType() only special-cases number/boolean); coerce() now
// stringifies a numeric ref value (String(v)) before it's bound, so it stores/returns
// its canonical form ("1", not the REAL→TEXT-mangled "1.0" better-sqlite3 used to
// produce for a plain JS number). See collection.js's `coerceRef()`.
//
// (b) The PROGRESS collection's `finished` field is `type: 'boolean', filter: 'eq'`, and
// discovery.js's own doc comment advertises `GET /api/progress?finished=true|false` as
// the wire contract. filters.js's `buildItemFilters` now type-coerces a bound filter
// value to match its column's affinity (`coerceFilterValue()` — boolean 'true'/'1' → 1,
// 'false'/'0' → 0), so both the word form and the numeral form match correctly.
//
// Requires `ffprobe`/`ffmpeg` on PATH (same as library.smoke.mjs) — SKIPS cleanly
// (exit 0, loud warning) if ffprobe is absent.
//
//   node apps/papyros/backend/test/playback.smoke.mjs

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures', 'library');

const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = 'jkos-auth';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// ── ffprobe/ffmpeg availability gate — SKIP (exit 0) rather than fail if either is
//    missing. ffprobe drives the scanner; ffmpeg drives §4's real compat-pipeline
//    generation (src/media.js's ?compat=N remux/encode) below — both ship in the same
//    OS package on every dev box and the runtime image, so this is one gate, not two.
try {
  await execFileAsync('ffprobe', ['-version']);
  await execFileAsync('ffmpeg', ['-version']);
} catch {
  console.warn('⚠ SKIPPED playback.smoke: `ffprobe`/`ffmpeg` is not on PATH.');
  console.warn('  Install ffmpeg (which provides both) to run this smoke — see Documentation/TESTING.md.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'papyros-playback-'));
const DB_PATH = join(tmp, 'test.db');

// ── Forge suite tokens: RS256 over a throwaway keypair the server is told to trust —
//    same recipe as items.smoke.mjs, needed here because the dev-stub auth only ever
//    injects ONE identity (sub:1), which can't exercise cross-user scoping.
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
const A = mkToken({ sub: 301, role: 'admin', scope: ['papyros:write'] });
const B = mkToken({ sub: 302, role: 'admin', scope: ['papyros:write'] });

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json, headers: r.headers };
}
const listProgress = async (token, qs = '') => (await req('GET', '/api/progress' + qs, undefined, token)).json || [];

async function waitForHealth(ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE + '/health')).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Poll GET /api/books (authenticated, gated same as everything under /api) until at
 *  least `count` rows appear (the boot scan is non-blocking) or the timeout elapses. */
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

/** Poll POST .../prepare (the "client polls" contract — src/media.js's compat
 *  pipeline) until it reports {ready:true} or the timeout elapses. Returns the last
 *  {status,json} pair either way so a caller can assert on either outcome. Fixture
 *  audio is a 2s sine tone at 32kb/s — a real ffmpeg remux/encode of it is near-
 *  instant, so the default timeout is generous, not load-bearing. */
async function waitForCompatReady(token, bookId, fileIndex, level, ms = 20000) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = await req('POST', `/api/stream/${bookId}/${fileIndex}/prepare`, { level }, token);
    if (last.json?.ready) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

/** Poll GET /api/book/:id until cover_path lands — extractCover() runs AFTER a book's
 *  row is upserted (see scan.js: upsert, then extractCover, then a separate
 *  setCoverStmt.run), so a book can briefly be visible via /api/books with
 *  cover_path still null. Guards that window rather than trusting the first poll. */
async function waitForCover(token, bookId, ms = 15000) {
  const deadline = Date.now() + ms;
  let detail = null;
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/book/${bookId}`, undefined, token);
    detail = r.json;
    if (detail?.cover_path) return detail;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return detail;
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
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

function done() {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\nplayback.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  if (!(await waitForHealth())) { console.error('server never became healthy:\n' + serverLog); done(); }

  // ── 4. unauthenticated media request → 401 (3.4 mount-ordering regression pin) ────
  const anonStream = await fetch(BASE + '/api/stream/1/0');
  ok(anonStream.status === 401, `auth: unauthenticated GET /api/stream → 401 (got ${anonStream.status})`);
  const anonCover = await fetch(BASE + '/api/cover/1');
  ok(anonCover.status === 401, `auth: unauthenticated GET /api/cover → 401 (got ${anonCover.status})`);

  // ── boot scan: poll /api/books (authed) until the 2-book fixture library lands ────
  const books = await waitForBooks(A, 2);
  ok(books.length === 2, `scan: exactly 2 book rows produced (got ${books.length}: ${JSON.stringify(books.map((r) => r.title))})`);
  const bookA = books.find((r) => r.title === 'Fixture Book A');
  const bookB = books.find((r) => r.title === 'Fixture Book B');
  ok(!!bookA, `scan: Fixture Book A row present (titles seen: ${JSON.stringify(books.map((r) => r.title))})`);
  ok(!!bookB, `scan: Fixture Book B row present (titles seen: ${JSON.stringify(books.map((r) => r.title))})`);

  // =====================================================================================
  // 1. Owner-scoped `progress` round-trip, two mock users (A sub:301, B sub:302)
  // =====================================================================================
  if (bookA && bookB) {
    // A creates a row.
    const createA = await req('POST', '/api/progress',
      { book_ref: bookA.id, position: 5, duration: 120, finished: false }, A);
    ok(createA.status === 201, `progress: A creates a row → 201 (got ${createA.status} ${JSON.stringify(createA.json)})`);
    ok(Number(createA.json?.book_ref) === bookA.id,
      `progress: A's row carries book_ref pointing at bookA (got ${JSON.stringify(createA.json?.book_ref)}, expected numeric ${bookA.id})`);
    ok(String(createA.json?.book_ref) === `${bookA.id}`,
      `progress: ref-typed book_ref is stored/returned as its canonical string "${bookA.id}" `
      + `(packages/weave/src/server/collection.js's coerceRef() — see file header) (got ${JSON.stringify(createA.json?.book_ref)})`);
    ok(createA.json?.finished === false, `progress: A's row starts finished=false (got ${createA.json?.finished})`);

    // A sees only their own row.
    const aList1 = await listProgress(A);
    ok(aList1.length === 1 && aList1[0]?.id === createA.json?.id,
      `progress: A sees exactly their own row (got ${JSON.stringify(aList1.map((r) => r.id))})`);

    // B's list is empty — B cannot see A's row (the core owner-scoping contract).
    const bList1 = await listProgress(B);
    ok(bList1.length === 0, `progress: B's list is empty before B creates anything (got ${bList1.length})`);

    // B creates their own row.
    const createB = await req('POST', '/api/progress',
      { book_ref: bookB.id, position: 1, duration: 60, finished: false }, B);
    ok(createB.status === 201, `progress: B creates a row → 201 (got ${createB.status} ${JSON.stringify(createB.json)})`);

    // B now sees only their own row (not A's).
    const bList2 = await listProgress(B);
    ok(bList2.length === 1 && bList2[0]?.id === createB.json?.id,
      `progress: B sees exactly their own row (got ${JSON.stringify(bList2.map((r) => r.id))})`);
    ok(!bList2.some((r) => r.id === createA.json?.id), 'progress: B\'s list does NOT include A\'s row');

    // A still sees only their own row (not B's) — the round trip holds both directions.
    const aList2 = await listProgress(A);
    ok(aList2.length === 1 && aList2[0]?.id === createA.json?.id,
      `progress: A still sees exactly their own row after B created one (got ${JSON.stringify(aList2.map((r) => r.id))})`);
    ok(!aList2.some((r) => r.id === createB.json?.id), 'progress: A\'s list does NOT include B\'s row');

    // Cross-user PATCH/DELETE 404 instead of leaking or mutating (same contract as
    // BeigeBoard's items.smoke.mjs §F, over the generic defineCollection mount() this
    // time rather than a hand-rolled route).
    const bPatchA = await req('PATCH', `/api/progress/${createA.json.id}`, { position: 999 }, B);
    ok(bPatchA.status === 404, `progress: B PATCH of A's row → 404 (got ${bPatchA.status})`);
    const bDeleteA = await req('DELETE', `/api/progress/${createA.json.id}`, undefined, B);
    ok(bDeleteA.status === 404, `progress: B DELETE of A's row → 404 (got ${bDeleteA.status})`);
    const aStill = (await listProgress(A)).find((r) => r.id === createA.json.id);
    ok(aStill?.position === 5, 'progress: A\'s row survived B\'s tampering attempts (position unchanged)');

    // A real position-bump update, as A, on A's own row.
    const bump = await req('PATCH', `/api/progress/${createA.json.id}`, { position: 42 }, A);
    ok(bump.status === 200 && bump.json?.position === 42,
      `progress: A's own PATCH bumps position (got ${bump.status} ${JSON.stringify(bump.json)})`);

    // finished=false → finished=true, then filter.
    const finishA = await req('PATCH', `/api/progress/${createA.json.id}`, { finished: true }, A);
    ok(finishA.status === 200 && finishA.json?.finished === true,
      `progress: finished false→true PATCH lands (got ${finishA.status} finished=${finishA.json?.finished})`);

    // Numeral-form filter (1/0) — see file header: this is the form that actually
    // round-trips through packages/weave/src/server/filters.js's raw string bind
    // against the INTEGER-affinity `finished` column.
    const numTrue = await req('GET', '/api/progress?finished=1', undefined, A);
    ok(Array.isArray(numTrue.json) && numTrue.json.some((r) => r.id === createA.json.id),
      `progress: ?finished=1 includes the now-finished row (got ${JSON.stringify(numTrue.json?.map((r) => r.id))})`);
    const numFalse = await req('GET', '/api/progress?finished=0', undefined, A);
    ok(Array.isArray(numFalse.json) && !numFalse.json.some((r) => r.id === createA.json.id),
      `progress: ?finished=0 excludes the now-finished row (got ${JSON.stringify(numFalse.json?.map((r) => r.id))})`);

    // Word-form filter ('true'/'false') — the contract discovery.js's own comment
    // documents (GET /api/progress?finished=true|false). packages/weave/src/server/
    // filters.js's coerceFilterValue() now binds an actual 0/1 for a boolean 'eq'
    // filter, so the word form matches the same rows the numeral form does above.
    const wordTrue = await req('GET', '/api/progress?finished=true', undefined, A);
    ok(Array.isArray(wordTrue.json) && wordTrue.json.some((r) => r.id === createA.json.id),
      `progress: ?finished=true includes the now-finished row (got ${JSON.stringify(wordTrue.json?.map((r) => r.id))})`);
    const wordFalse = await req('GET', '/api/progress?finished=false', undefined, A);
    ok(Array.isArray(wordFalse.json) && !wordFalse.json.some((r) => r.id === createA.json.id),
      `progress: ?finished=false excludes the now-finished row (got ${JSON.stringify(wordFalse.json?.map((r) => r.id))})`);
  }

  // =====================================================================================
  // 2. Range streaming: GET /api/stream/:bookId/0 with Range: bytes=0-1023 → 206
  // =====================================================================================
  if (bookA) {
    const fixtureFilePath = join(FIXTURES_DIR, 'Fixture Book A', 'book.m4b');
    const totalSize = statSync(fixtureFilePath).size; // never hardcoded — see file header
    ok(totalSize > 1024, `stream: fixture file is large enough for a satisfiable 0-1023 range (got ${totalSize} bytes)`);

    const rangeRes = await fetch(BASE + `/api/stream/${bookA.id}/0`, {
      headers: { Authorization: `Bearer ${A}`, Range: 'bytes=0-1023' },
    });
    const rangeBody = await rangeRes.arrayBuffer();
    ok(rangeRes.status === 206, `stream: Range request → 206 (got ${rangeRes.status})`);
    ok(rangeRes.headers.get('content-range') === `bytes 0-1023/${totalSize}`,
      `stream: Content-Range is correct (got ${rangeRes.headers.get('content-range')}, expected bytes 0-1023/${totalSize})`);
    ok(rangeRes.headers.get('content-length') === '1024',
      `stream: Content-Length is 1024 (got ${rangeRes.headers.get('content-length')})`);
    ok(rangeBody.byteLength === 1024, `stream: body is exactly 1024 bytes (got ${rangeBody.byteLength})`);
    ok(rangeRes.headers.get('accept-ranges') === 'bytes', 'stream: Accept-Ranges: bytes present');
    ok(rangeRes.headers.get('content-type') === 'audio/mp4', `stream: Content-Type audio/mp4 for .m4b (got ${rangeRes.headers.get('content-type')})`);

    // Plain (no Range header) GET on the same file — the whole-file 200 path, so the
    // 206 assertions above are checked against a real contrast rather than in isolation.
    const wholeRes = await fetch(BASE + `/api/stream/${bookA.id}/0`, { headers: { Authorization: `Bearer ${A}` } });
    const wholeBody = await wholeRes.arrayBuffer();
    ok(wholeRes.status === 200, `stream: no-Range GET → 200 (got ${wholeRes.status})`);
    ok(wholeBody.byteLength === totalSize, `stream: no-Range GET returns the whole file (got ${wholeBody.byteLength}, expected ${totalSize})`);

    // A cheap 404 regression: a bookId/fileIndex that doesn't exist.
    const missing = await fetch(BASE + '/api/stream/999999/0', { headers: { Authorization: `Bearer ${A}` } });
    ok(missing.status === 404, `stream: unknown bookId → 404 (got ${missing.status})`);
  }

  // =====================================================================================
  // 3. Cover route → 200 (Fixture Book B carries a real folder-level cover.jpg, task 3.5)
  // =====================================================================================
  if (bookB) {
    const bDetail = await waitForCover(A, bookB.id);
    ok(!!bDetail?.cover_path, `cover: scan extracted a cover_path for Fixture Book B (got ${JSON.stringify(bDetail?.cover_path)})`);

    const coverRes = await fetch(BASE + `/api/cover/${bookB.id}`, { headers: { Authorization: `Bearer ${A}` } });
    const coverBody = await coverRes.arrayBuffer();
    ok(coverRes.status === 200, `cover: GET /api/cover/:bookId → 200 (got ${coverRes.status})`);
    ok(/^image\//.test(coverRes.headers.get('content-type') || ''),
      `cover: Content-Type is an image/* type (got ${coverRes.headers.get('content-type')})`);
    ok(coverRes.headers.get('cache-control') === 'private, max-age=86400',
      `cover: Cache-Control is private+86400 (got ${coverRes.headers.get('cache-control')})`);
    ok(!!coverRes.headers.get('last-modified'), 'cover: Last-Modified header present');
    ok(coverBody.byteLength > 0, `cover: body is non-empty (got ${coverBody.byteLength} bytes)`);

    // A book with no cover (Fixture Book A never got one — see gen-fixtures.sh) → 404,
    // proving GET /api/cover/:bookId isn't unconditionally 200.
    if (bookA) {
      const noCoverRes = await fetch(BASE + `/api/cover/${bookA.id}`, { headers: { Authorization: `Bearer ${A}` } });
      ok(noCoverRes.status === 404, `cover: a book with no cover_path → 404 (got ${noCoverRes.status})`);
    }
  }

  // =====================================================================================
  // 4. Compat pipeline (the NS_ERROR_DOM_MEDIA_METADATA_ERR fix) — POST .../prepare
  //    (level whitelist, single-flight, prepare→poll→ready), GET ?compat=1 serving the
  //    generated variant through the SAME sendFileRange the plain path uses (206/
  //    Content-Range off the VARIANT's own on-disk size, never the source's), and
  //    mtime-based regeneration when the source file changes underneath a cached
  //    variant. DATA_DIR mirrors server.js's own `path.dirname(DB_PATH)` — DB_PATH is
  //    `<tmp>/test.db`, so compat variants land under `<tmp>/compat/`.
  // =====================================================================================
  if (bookA) {
    const fixtureFilePath = join(FIXTURES_DIR, 'Fixture Book A', 'book.m4b');
    const DATA_DIR = tmp;
    const variantPath = join(DATA_DIR, 'compat', `${bookA.id}-0.c1.m4a`);

    // A bogus level is rejected on both the write side (prepare) and the read side
    // (?compat=N) — never silently ignored or coerced to a real rung.
    const badPrepare = await req('POST', `/api/stream/${bookA.id}/0/prepare`, { level: 3 }, A);
    ok(badPrepare.status >= 400 && badPrepare.status < 500,
      `compat: prepare with an out-of-whitelist level → 4xx (got ${badPrepare.status})`);
    const badCompatGet = await fetch(BASE + `/api/stream/${bookA.id}/0?compat=3`, { headers: { Authorization: `Bearer ${A}` } });
    ok(badCompatGet.status >= 400 && badCompatGet.status < 500,
      `compat: GET ?compat=3 (out of whitelist) → 4xx (got ${badCompatGet.status})`);

    // Before anything has been prepared, the variant plainly isn't ready — 404, not a
    // silent fallback to the source file (the player relies on this to know when to
    // keep polling vs. play).
    const notYet = await fetch(BASE + `/api/stream/${bookA.id}/0?compat=1`, { headers: { Authorization: `Bearer ${A}` } });
    ok(notYet.status === 404, `compat: ?compat=1 before any prepare call → 404 (got ${notYet.status})`);

    // prepare → poll → ready.
    const firstPrepare = await req('POST', `/api/stream/${bookA.id}/0/prepare`, { level: 1 }, A);
    ok(firstPrepare.status === 202 && firstPrepare.json?.pending === true,
      `compat: first prepare call starts generation → 202 {pending:true} (got ${firstPrepare.status} ${JSON.stringify(firstPrepare.json)})`);

    const readyResult = await waitForCompatReady(A, bookA.id, 0, 1);
    ok(readyResult?.json?.ready === true,
      `compat: polling prepare eventually reports {ready:true} (got ${JSON.stringify(readyResult?.json)})`);

    // Once ready, re-polling prepare is a cheap no-op (still 200 {ready:true}, not a
    // fresh 202 — it must not re-spawn ffmpeg for an already-fresh variant).
    const rePrepare = await req('POST', `/api/stream/${bookA.id}/0/prepare`, { level: 1 }, A);
    ok(rePrepare.status === 200 && rePrepare.json?.ready === true,
      `compat: prepare after ready stays {ready:true} (got ${rePrepare.status} ${JSON.stringify(rePrepare.json)})`);

    const variantSize = statSync(variantPath).size;
    ok(variantSize > 0, `compat: level-1 variant landed on disk with nonzero size (got ${variantSize} bytes)`);

    // ?compat=1 now serves the VARIANT — sizes/ranges computed off the variant's own
    // stat, never the (larger, original-container) source file's.
    const compatWhole = await fetch(BASE + `/api/stream/${bookA.id}/0?compat=1`, { headers: { Authorization: `Bearer ${A}` } });
    const compatWholeBody = await compatWhole.arrayBuffer();
    ok(compatWhole.status === 200, `compat: ?compat=1 no-Range GET → 200 (got ${compatWhole.status})`);
    ok(compatWholeBody.byteLength === variantSize,
      `compat: ?compat=1 whole-file body length matches the variant's on-disk size (got ${compatWholeBody.byteLength}, expected ${variantSize})`);
    ok(compatWhole.headers.get('content-type') === 'audio/mp4',
      `compat: ?compat=1 Content-Type audio/mp4 (got ${compatWhole.headers.get('content-type')})`);

    const compatRange = await fetch(BASE + `/api/stream/${bookA.id}/0?compat=1`, {
      headers: { Authorization: `Bearer ${A}`, Range: 'bytes=0-511' },
    });
    const compatRangeBody = await compatRange.arrayBuffer();
    ok(compatRange.status === 206, `compat: ?compat=1 Range request → 206 (got ${compatRange.status})`);
    ok(compatRange.headers.get('content-range') === `bytes 0-511/${variantSize}`,
      `compat: ?compat=1 Content-Range is correct off the variant's size (got ${compatRange.headers.get('content-range')}, expected bytes 0-511/${variantSize})`);
    ok(compatRangeBody.byteLength === 512, `compat: ?compat=1 range body is exactly 512 bytes (got ${compatRangeBody.byteLength})`);

    // Regeneration: bump the SOURCE file's mtime past the cached variant's — the
    // variant must stop being servable (stale, per the mtime-compare rule) until a
    // fresh prepare rebuilds it.
    utimesSync(fixtureFilePath, new Date(), new Date());
    const staleGet = await fetch(BASE + `/api/stream/${bookA.id}/0?compat=1`, { headers: { Authorization: `Bearer ${A}` } });
    ok(staleGet.status === 404,
      `compat: after the source mtime bumps past the variant's, ?compat=1 → 404 until regenerated (got ${staleGet.status})`);

    const regenReady = await waitForCompatReady(A, bookA.id, 0, 1);
    ok(regenReady?.json?.ready === true,
      `compat: re-prepare after a source mtime bump regenerates and reports ready again (got ${JSON.stringify(regenReady?.json)})`);
    const regenGet = await fetch(BASE + `/api/stream/${bookA.id}/0?compat=1`, { headers: { Authorization: `Bearer ${A}` } });
    ok(regenGet.status === 200, `compat: ?compat=1 serves again once regenerated → 200 (got ${regenGet.status})`);
  }
} catch (e) {
  console.error('playback.smoke crashed:', e);
  fail++;
} finally {
  done();
}
