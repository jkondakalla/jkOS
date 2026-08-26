// playback.smoke.mjs (ToDo §3 18.2) — the playback + per-user-collection smoke: boots
// the REAL server (throwaway port + temp DB, the committed fixture library, a REAL
// RS256 keypair so forged per-user tokens exercise the actual verify path rather than
// the weave dev-stub — same pattern as apps/papyros/backend/test/playback.smoke.mjs)
// and asserts:
//
//   • unauthenticated media request → 401 (the media router sits behind the identity
//     gate same as everything else under /api).
//   • Range-aware audio streaming (GET /api/stream/:trackId/0) on a real scanned
//     fixture file: `Range: bytes=0-1023` → 206 with the correct Content-Range/
//     Content-Length/body-length trio (computed off the ACTUAL file size, never
//     hardcoded), a plain GET → 200 whole-file, and an out-of-bounds Range → 416 with
//     `Content-Range: bytes */<total>` (no ladder is configured for kouros — see
//     src/media.js's header — so there is no `?compat=` surface to test here, unlike
//     papyros).
//   • cover art (GET /api/cover/:trackId) → 200 once the scanner has picked up the
//     real folder-level cover.jpg on Album Two's track, and 404 for a track with none
//     (Album One's tracks are deliberately cover-less, mirroring papyros's fixture
//     asymmetry).
//   • `playlists` owner-scoped CRUD round-trip (18.2's defineCollection contract): A
//     creates a playlist with an ordered `track_refs` array, only A sees it; B's list
//     starts empty; a PATCH reorders `track_refs` and it round-trips as a real JS array
//     (the `list: true` JSON-array-TEXT convention — packages/weave/src/server/
//     columns.js's coerceWeaveColumn / collection.js's toRow()); cross-user
//     PATCH/DELETE → 404; DELETE removes it.
//   • `ratings` UNIQUE(user_id, track_ref) + upsert-on-conflict trigger (18.2's
//     day-one hardening, the papyros 17.5 lesson applied up front): a SECOND POST for
//     the same (user, track) does NOT 500 on a raw constraint violation and does NOT
//     duplicate — it replaces the existing rating in place (one row survives, carrying
//     the new value); a different user's rating on the SAME track is untouched by that
//     replacement (the trigger's WHERE is scoped to user_id, not just track_ref).
//
// Requires `ffprobe`/`ffmpeg` on PATH (ffprobe for the boot scan; ffmpeg only insofar
// as gen-fixtures.sh needed it to author the committed fixtures — no ffmpeg process
// runs during this smoke itself, kouros has no compat ladder). SKIPS cleanly (exit 0,
// loud warning) if ffprobe is absent — same gate as library.smoke.mjs.
//
//   node apps/kouros/backend/test/playback.smoke.mjs

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures', 'library');

// Claimed in the suite-manifest port registry ('kouros:playback.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3981;
const BASE = `http://127.0.0.1:${PORT}`;
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'kouros';
const ISSUER = 'jkos-auth';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// ── ffprobe availability gate — SKIP (exit 0) rather than fail if it's missing ──────
try {
  await execFileAsync('ffprobe', ['-version']);
} catch {
  console.warn('⚠ SKIPPED playback.smoke: `ffprobe` is not on PATH.');
  console.warn('  Install ffmpeg (which provides ffprobe) to run this smoke — see Documentation/TESTING.md.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'kouros-playback-'));
const DB_PATH = join(tmp, 'test.db');

// ── Forge suite tokens: RS256 over a throwaway keypair the server is told to trust —
//    same recipe as papyros's playback.smoke.mjs, needed here because the dev-stub
//    auth only ever injects ONE identity (sub:1), which can't exercise cross-user
//    scoping.
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
const A = mkToken({ sub: 501, role: 'admin', scope: ['kouros:write'] });
const B = mkToken({ sub: 502, role: 'admin', scope: ['kouros:write'] });

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
const listPlaylists = async (token) => (await req('GET', '/api/playlists', undefined, token)).json || [];
const listRatings = async (token) => (await req('GET', '/api/ratings', undefined, token)).json || [];

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

/** Poll GET /api/tracks (authenticated, gated same as everything under /api) until at
 *  least `count` rows appear (the boot scan is non-blocking) or the timeout elapses. */
async function waitForTracks(token, count, ms = 30000) {
  const deadline = Date.now() + ms;
  let rows = [];
  while (Date.now() < deadline) {
    const r = await req('GET', '/api/tracks', undefined, token);
    if (Array.isArray(r.json)) rows = r.json;
    if (rows.length >= count) return rows;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return rows;
}

/** Poll GET /api/tracks?album=<Album Two> until cover_path lands — extractCover() runs
 *  AFTER a track's row is upserted, so a track can briefly be visible with cover_path
 *  still null (same window papyros's waitForCover guards). */
async function waitForCover(token, ms = 15000) {
  const deadline = Date.now() + ms;
  let row = null;
  while (Date.now() < deadline) {
    const r = await req('GET', '/api/tracks?album=' + encodeURIComponent('Album Two'), undefined, token);
    row = Array.isArray(r.json) ? r.json[0] : null;
    if (row?.cover_path) return row;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return row;
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: '',
    PORT: String(PORT),
    DB_PATH,
    MUSIC_DIR: FIXTURES_DIR,
    JKOS_AUTH_PUBLIC_KEY: publicKey,
    JKOS_AUTH_ISSUER: ISSUER,
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
  console.log(`\nplayback.smoke: ${pass} passed, ${fail} failed`);
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

  // ── unauthenticated media request → 401 ─────────────────────────────────────────
  const anonStream = await fetch(BASE + '/api/stream/1/0');
  ok(anonStream.status === 401, `auth: unauthenticated GET /api/stream → 401 (got ${anonStream.status})`);
  const anonCover = await fetch(BASE + '/api/cover/1');
  ok(anonCover.status === 401, `auth: unauthenticated GET /api/cover → 401 (got ${anonCover.status})`);

  // ── boot scan: poll /api/tracks (authed) until the 3-track fixture library lands ──
  const tracks = await waitForTracks(A, 3);
  ok(tracks.length === 3, `scan: exactly 3 track rows produced (got ${tracks.length}: ${JSON.stringify(tracks.map((r) => r.title))})`);
  const song1 = tracks.find((r) => r.title === 'Song One');
  const solo = tracks.find((r) => r.title === 'Solo Track');
  ok(!!song1, `scan: Song One row present (titles seen: ${JSON.stringify(tracks.map((r) => r.title))})`);
  ok(!!solo, `scan: Solo Track row present (titles seen: ${JSON.stringify(tracks.map((r) => r.title))})`);

  // =====================================================================================
  // 1. Range streaming: GET /api/stream/:trackId/0
  // =====================================================================================
  if (song1) {
    const fixtureFilePath = join(FIXTURES_DIR, 'Artist One', 'Album One', '01 song one.mp3');
    const totalSize = statSync(fixtureFilePath).size; // never hardcoded
    ok(totalSize > 1024, `stream: fixture file is large enough for a satisfiable 0-1023 range (got ${totalSize} bytes)`);

    const rangeRes = await fetch(BASE + `/api/stream/${song1.id}/0`, {
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
    ok(rangeRes.headers.get('content-type') === 'audio/mpeg', `stream: Content-Type audio/mpeg for .mp3 (got ${rangeRes.headers.get('content-type')})`);

    // Plain (no Range header) GET on the same file — the whole-file 200 path.
    const wholeRes = await fetch(BASE + `/api/stream/${song1.id}/0`, { headers: { Authorization: `Bearer ${A}` } });
    const wholeBody = await wholeRes.arrayBuffer();
    ok(wholeRes.status === 200, `stream: no-Range GET → 200 (got ${wholeRes.status})`);
    ok(wholeBody.byteLength === totalSize, `stream: no-Range GET returns the whole file (got ${wholeBody.byteLength}, expected ${totalSize})`);

    // An out-of-bounds Range → 416, with Content-Range: bytes */total.
    const outOfBoundsRes = await fetch(BASE + `/api/stream/${song1.id}/0`, {
      headers: { Authorization: `Bearer ${A}`, Range: `bytes=${totalSize + 1000}-${totalSize + 2000}` },
    });
    ok(outOfBoundsRes.status === 416, `stream: out-of-bounds Range → 416 (got ${outOfBoundsRes.status})`);
    ok(outOfBoundsRes.headers.get('content-range') === `bytes */${totalSize}`,
      `stream: 416 Content-Range is bytes */${totalSize} (got ${outOfBoundsRes.headers.get('content-range')})`);

    // A cheap 404 regression: a trackId that doesn't exist.
    const missing = await fetch(BASE + '/api/stream/999999/0', { headers: { Authorization: `Bearer ${A}` } });
    ok(missing.status === 404, `stream: unknown trackId → 404 (got ${missing.status})`);
  }

  // =====================================================================================
  // 2. Cover art: GET /api/cover/:trackId (Album Two's track carries a real folder cover)
  // =====================================================================================
  if (solo) {
    const soloWithCover = await waitForCover(A);
    ok(!!soloWithCover?.cover_path, `cover: scan extracted a cover_path for the solo track (got ${JSON.stringify(soloWithCover?.cover_path)})`);

    const coverRes = await fetch(BASE + `/api/cover/${soloWithCover.id}`, { headers: { Authorization: `Bearer ${A}` } });
    const coverBody = await coverRes.arrayBuffer();
    ok(coverRes.status === 200, `cover: GET /api/cover/:trackId → 200 (got ${coverRes.status})`);
    ok(/^image\//.test(coverRes.headers.get('content-type') || ''),
      `cover: Content-Type is an image/* type (got ${coverRes.headers.get('content-type')})`);
    ok(coverRes.headers.get('cache-control') === 'private, max-age=86400',
      `cover: Cache-Control is private+86400 (got ${coverRes.headers.get('cache-control')})`);
    ok(coverBody.byteLength > 0, `cover: body is non-empty (got ${coverBody.byteLength} bytes)`);

    // A track with no cover (Album One's tracks never got one) → 404.
    if (song1) {
      const noCoverRes = await fetch(BASE + `/api/cover/${song1.id}`, { headers: { Authorization: `Bearer ${A}` } });
      ok(noCoverRes.status === 404, `cover: a track with no cover_path → 404 (got ${noCoverRes.status})`);
    }
  }

  // =====================================================================================
  // 3. `playlists` owner-scoped CRUD round-trip
  // =====================================================================================
  if (song1 && solo) {
    const createA = await req('POST', '/api/playlists',
      { name: 'My Mix', description: 'A test playlist', track_refs: [song1.id, solo.id] }, A);
    ok(createA.status === 201, `playlists: A creates a playlist → 201 (got ${createA.status} ${JSON.stringify(createA.json)})`);
    ok(Array.isArray(createA.json?.track_refs) && createA.json.track_refs.length === 2,
      `playlists: track_refs round-trips as a real array (got ${JSON.stringify(createA.json?.track_refs)})`);
    ok(createA.json.track_refs[0] === song1.id && createA.json.track_refs[1] === solo.id,
      `playlists: track_refs preserves order (got ${JSON.stringify(createA.json?.track_refs)})`);

    const aList1 = await listPlaylists(A);
    ok(aList1.length === 1 && aList1[0]?.id === createA.json?.id, 'playlists: A sees exactly their own playlist');

    const bList1 = await listPlaylists(B);
    ok(bList1.length === 0, `playlists: B's list is empty — A's playlist does not leak (got ${bList1.length})`);

    // Reorder via PATCH — the whole array round-trips in its new order.
    const reorder = await req('PATCH', `/api/playlists/${createA.json.id}`, { track_refs: [solo.id, song1.id] }, A);
    ok(reorder.status === 200, `playlists: A reorders track_refs → 200 (got ${reorder.status})`);
    ok(Array.isArray(reorder.json?.track_refs) && reorder.json.track_refs[0] === solo.id && reorder.json.track_refs[1] === song1.id,
      `playlists: reordered track_refs round-trips (got ${JSON.stringify(reorder.json?.track_refs)})`);

    // Cross-user PATCH/DELETE → 404, same owner-scoping contract as papyros's progress.
    const bPatchA = await req('PATCH', `/api/playlists/${createA.json.id}`, { name: 'Hijacked' }, B);
    ok(bPatchA.status === 404, `playlists: B PATCH of A's playlist → 404 (got ${bPatchA.status})`);
    const bDeleteA = await req('DELETE', `/api/playlists/${createA.json.id}`, undefined, B);
    ok(bDeleteA.status === 404, `playlists: B DELETE of A's playlist → 404 (got ${bDeleteA.status})`);

    // A's own DELETE succeeds and actually removes the row.
    const aDelete = await req('DELETE', `/api/playlists/${createA.json.id}`, undefined, A);
    ok(aDelete.status === 200 && aDelete.json?.ok === true, `playlists: A deletes their own playlist → 200 {ok:true} (got ${aDelete.status} ${JSON.stringify(aDelete.json)})`);
    const aListAfterDelete = await listPlaylists(A);
    ok(aListAfterDelete.length === 0, 'playlists: A\'s list is empty after deleting their only playlist');
  }

  // =====================================================================================
  // 4. `ratings` UNIQUE(user_id, track_ref) + upsert-on-conflict trigger
  // =====================================================================================
  if (song1) {
    const firstRate = await req('POST', '/api/ratings', { track_ref: song1.id, rating: 3 }, A);
    ok(firstRate.status === 201, `ratings: A's first rating → 201 (got ${firstRate.status} ${JSON.stringify(firstRate.json)})`);
    ok(firstRate.json?.rating === 3, `ratings: rating round-trips (got ${firstRate.json?.rating})`);

    // A rates the SAME track again — must NOT 500 (a raw SQLITE_CONSTRAINT_UNIQUE
    // would map to a bare 500 without the upsert-on-conflict trigger) and must NOT
    // create a second row.
    const secondRate = await req('POST', '/api/ratings', { track_ref: song1.id, rating: 5 }, A);
    ok(secondRate.status === 201, `ratings: A's second rating on the SAME track → 201, not a 500 (got ${secondRate.status} ${JSON.stringify(secondRate.json)})`);
    ok(secondRate.json?.rating === 5, `ratings: the replacement rating value round-trips (got ${secondRate.json?.rating})`);
    ok(secondRate.json?.id !== firstRate.json?.id,
      'ratings: the upsert-on-conflict trigger deletes-then-inserts, so the surviving row has a NEW id (not an UPDATE of the old row)');

    const aRatings = await listRatings(A);
    ok(aRatings.length === 1 && aRatings[0]?.rating === 5,
      `ratings: exactly ONE row survives for A on this track, carrying the latest value (got ${JSON.stringify(aRatings)})`);

    // B rates the SAME track — the trigger's WHERE is scoped to user_id, so this must
    // NOT touch A's row (the composite index is (user_id, track_ref), not track_ref alone).
    const bRate = await req('POST', '/api/ratings', { track_ref: song1.id, rating: 1 }, B);
    ok(bRate.status === 201, `ratings: B rates the same track → 201 (got ${bRate.status})`);
    const aRatingsAfterB = await listRatings(A);
    ok(aRatingsAfterB.length === 1 && aRatingsAfterB[0]?.rating === 5,
      `ratings: A's rating is UNCHANGED by B's rating on the same track (got ${JSON.stringify(aRatingsAfterB)})`);
    const bRatings = await listRatings(B);
    ok(bRatings.length === 1 && bRatings[0]?.rating === 1, `ratings: B sees exactly their own rating (got ${JSON.stringify(bRatings)})`);
  }
} catch (e) {
  console.error('playback.smoke crashed:', e);
  fail++;
} finally {
  done();
}
