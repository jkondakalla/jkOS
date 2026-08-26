// discover.smoke.mjs — end-to-end smoke for the EMBEDDER SEAM: boots the real
// server.js against the fixture library plus a synthetic `music/index.db`, and
// asserts the vectors actually resolve onto this catalog.
//
// ⚠️ WHY THIS TEST EXISTS, AND WHY ITS FIXTURE LOOKS ODD.
// Both databases store absolute paths, and joining on them is the obvious move —
// it returned ZERO hits out of 163 the first time it was measured. The embedder
// walks the HOST (`/mnt/Luna/Plex/Music/…`); KourOS reads a read-only bind MOUNT
// (`/music/…`). Neither is wrong and they share no prefix, so the exact-path tier
// cannot hit in a container while working perfectly on a workstation where both
// processes see one filesystem. Green in dev, silently 0% in prod.
//
// A zero-coverage seam does not error. Every discovery surface keeps answering,
// falling back to metadata affinity, and the failure presents as "the embeddings
// aren't very good" rather than "the embeddings were never consulted". So this
// smoke deliberately builds its fixture index under a DIFFERENT ROOT from
// MUSIC_DIR — reproducing the production mismatch — and asserts that
//
//   * the exact-path tier resolves NOTHING (the mismatch is real), and
//   * the root-relative tier resolves EVERYTHING anyway, and
//   * a deliberately wrong LIBRARY_ROOT_NAME collapses coverage to zero,
//     which is what proves these assertions can actually fail.
//
// It also covers the calibration (ToDo §8.7's anisotropic-cone trap): a stranger
// must score near 0 once the fitted corpus geometry is applied, not near +0.48.
//
// Requires `ffprobe` on PATH (the boot scan). SKIPS with exit 0 if absent.
//
//   node apps/kouros/backend/test/discover.smoke.mjs

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

// Claimed in the suite-manifest port registry ('kouros:discover.smoke') — the
// `port-registry` probe holds this literal to that claim.
//
// ⚠️ This smoke is the one that boots FOUR servers, and the registry can only see
// the literal above. The other three therefore sit in a band 100 above it, clear of
// the whole 398x/399x test range — they used to be PORT+1..PORT+3, and PORT+3 was
// 3986, which is BeigeBoard's delta.smoke claim. That is OPS-1 exactly: a second
// server on a claimed port, invisible to the table.
const PORT = 3983;
const BASE = `http://127.0.0.1:${PORT}`;
const SPARE_PORTS = [PORT + 100, PORT + 101, PORT + 102];
// The /health payload must name THIS app. A bare 200 once passed eight
// assertions against a stray server from ANOTHER app on a shared port (OPS-1);
// the uniform health contract carries the app id precisely so a smoke can tell.
const SERVICE = 'kouros';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

try {
  await execFileAsync('ffprobe', ['-version']);
} catch {
  console.warn('⚠ SKIPPED discover.smoke: `ffprobe` is not on PATH.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'kouros-discover-'));

/* ── the synthetic embedder index ──────────────────────────────────────────────
   Paths are rooted at a HOST path that does not exist and shares no prefix with
   MUSIC_DIR — exactly the production shape. The tail below the library root is
   identical to the fixture library's, which is the only thing the join may use. */
const EMBEDDER_ROOT = '/mnt/Luna/Plex/Music';
const TRACKS = [
  'Artist One/Album One/01 song one.mp3',
  'Artist One/Album One/02 song two.mp3',
  'Artist Two/Album Two/01 solo track.mp3',
];
const DIM = 16;

function buildIndex(dbPath, { calibrate = true, tracks = TRACKS } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tracks(
      id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, mtime REAL, size INTEGER,
      duration REAL, status TEXT NOT NULL DEFAULT 'ok', error TEXT,
      updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE local_vectors(
      track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      model TEXT NOT NULL, revision TEXT, dim INTEGER NOT NULL, vector BLOB NOT NULL,
      config_sig TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '');
  `);
  // Two tracks from one album deliberately point in nearly the same direction and
  // the third somewhere else, so "same album ranks above stranger" is a real claim.
  const directions = [0, 0, 1];
  const rows = tracks;
  const insTrack = db.prepare('INSERT INTO tracks(id, path, mtime, size, duration) VALUES(?,?,?,?,?)');
  const insVec = db.prepare('INSERT INTO local_vectors(track_id, model, dim, vector, config_sig) VALUES(?,?,?,?,?)');
  const vectors = [];
  rows.forEach((rel, i) => {
    const vec = new Float32Array(DIM);
    // A shared component in EVERY vector — an anisotropic cone, like CLAP's.
    for (let d = 0; d < DIM; d++) vec[d] = 0.6;
    vec[directions[i % directions.length]] += 1.0;
    vec[(i * 5 + 3) % DIM] += 0.15;
    insTrack.run(i + 1, `${EMBEDDER_ROOT}/${rel}`, 1, 100, 120);
    insVec.run(i + 1, 'test-clap', DIM, Buffer.from(vec.buffer.slice(0)), 'sigtest');
    vectors.push(vec);
  });
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('config_sig:local_vectors', 'sigtest');
  if (calibrate) {
    // The corpus mean — the cone's axis. Centring by it is what moves a stranger
    // from "+0.48 similar" to ~0.
    const mean = new Float32Array(DIM);
    for (const v of vectors) for (let d = 0; d < DIM; d++) mean[d] += v[d] / vectors.length;
    const set = db.prepare('INSERT INTO meta(key,value) VALUES(?,?)');
    set.run('calib_mean:local_vectors', Buffer.from(mean.buffer.slice(0)).toString('base64'));
    set.run('calib_stranger_mean:local_vectors', '0.0');
    set.run('calib_stranger_spread:local_vectors', '0.5');
    set.run('calib_n_fit:local_vectors', String(rows.length));
    set.run('calib_sig:local_vectors', 'sigtest');
  }
  db.close();
}

async function req(base, method, path) {
  const r = await fetch(base + path, { method });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

async function boot({ port, dbPath, vectorDbPath, libraryRootName }) {
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      NODE_ENV: '',
      PORT: String(port),
      DB_PATH: dbPath,
      MUSIC_DIR: FIXTURES_DIR,
      VECTOR_DB_PATH: vectorDbPath,
      LIBRARY_ROOT_NAME: libraryRootName,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  let exited = null; // fail fast: a child that dies pre-health must not be polled for
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (exited) break; // the child is gone — polling the port can only find a stranger
    try {
      const res = await fetch(base + '/health');
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.service === SERVICE) { healthy = true; break; }
        console.error(`  ✗ /health on ${port} answered 200 but service=${JSON.stringify(body.service)} — ` +
                      `expected '${SERVICE}'. Another server owns this port.`);
        break;
      }
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  const server = { child, base, port, log: () => log, healthy };
  servers.push(server);
  if (!healthy) {
    fail++;
    console.error(`  ✗ server on ${port} never became healthy`
      + (exited ? ` (exited code=${exited.code} signal=${exited.signal})` : ''));
    return server;
  }
  // The boot scan is non-blocking; wait for the catalog before asking about vectors.
  const tracksDeadline = Date.now() + 30000;
  while (Date.now() < tracksDeadline) {
    const r = await req(base, 'GET', '/api/tracks');
    if (Array.isArray(r.json) && r.json.length >= TRACKS.length) break;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return server;
}

const servers = [];
function done() {
  for (const s of servers) { try { s.child.kill('SIGKILL'); } catch { /* gone */ } }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  // The children's own words, on ANY failure — not only when health never came up.
  if (fail) {
    for (const s of servers) {
      const text = s.log();
      if (text) console.error(`\n── server log (${s.port}) ──\n` + text);
    }
  }
  console.log(`\ndiscover.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try {
  /* ── 1. the seam, wired the way production wires it ────────────────────────── */
  const goodIndex = join(tmp, 'music-index.db');
  buildIndex(goodIndex);
  const good = await boot({
    port: PORT, dbPath: join(tmp, 'good.db'), vectorDbPath: goodIndex, libraryRootName: 'Music',
  });
  if (!good.healthy) done(); // boot() already counted the failure; nothing below can mean anything

  const stats = (await req(good.base, 'GET', '/api/discover/stats')).json;
  ok(!!stats, 'stats: served');
  ok(stats?.tracks === TRACKS.length, `stats: ${TRACKS.length} catalog rows (got ${stats?.tracks})`);

  // The mismatch is REAL — this is the assertion that keeps the fixture honest.
  ok(stats?.byPath === 0,
    `stats: the exact-path tier resolves NOTHING across differing roots (got ${stats?.byPath})`);
  // …and the seam works anyway.
  ok(stats?.byRelPath === TRACKS.length,
    `stats: the root-relative tier resolves all ${TRACKS.length} (got ${stats?.byRelPath})`);
  ok(stats?.measured === TRACKS.length,
    `stats: every track is MEASURED, not inferred (got ${stats?.measured})`);
  ok(stats?.coverage === 1, `stats: coverage is 1 (got ${stats?.coverage})`);
  ok(stats?.calibrated === true, 'stats: the fitted corpus geometry was found and applied');

  /* ── 2. the surfaces actually report an embedding basis ────────────────────── */
  const tracks = (await req(good.base, 'GET', '/api/tracks')).json;
  const byTitle = new Map(tracks.map((t) => [t.title, t]));
  const seed = tracks.find((t) => /song one/i.test(t.title || '')) || tracks[0];
  const sim = (await req(good.base, 'GET', `/api/discover/similar/${seed.id}?k=5`)).json;
  ok(sim?.basis === 'embedding', `similar: basis is 'embedding' (got ${JSON.stringify(sim?.basis)})`);
  ok(sim?.calibrated === true, 'similar: reports that scores are calibrated');
  ok(Array.isArray(sim?.results) && sim.results.length > 0, 'similar: returns results');
  ok((sim?.results || []).every((r) => r.basis === 'measured'),
    'similar: every row is measured, none inferred');

  // Same album must outrank the stranger — the space is doing its job, not just loading.
  const ranked = (sim?.results || []).map((r) => r.title);
  ok(/song two/i.test(ranked[0] || ''),
    `similar: the same-album track ranks first (got ${JSON.stringify(ranked)})`);

  // ⚠️ ToDo §8.7's anisotropic-cone trap: read RAW, every one of these vectors
  // scores ~+0.9 against every other because they share a large component. After
  // centring by the fitted mean, an unrelated track must fall away from the
  // neighbour rather than crowding it.
  const scores = Object.fromEntries((sim?.results || []).map((r) => [r.title, r.score]));
  const near = scores[Object.keys(scores).find((t) => /song two/i.test(t))];
  const farKey = Object.keys(scores).find((t) => /solo/i.test(t));
  if (farKey !== undefined) {
    ok(near > scores[farKey] + 0.5,
      `similar: calibration separates album-mate from stranger (${near} vs ${scores[farKey]})`);
  } else {
    ok(false, 'similar: the stranger track was not returned at all');
  }

  const radio = (await req(good.base, 'GET', `/api/discover/radio?seed=${seed.id}&k=5`)).json;
  ok(radio?.basis === 'embedding', `radio: basis is 'embedding' (got ${JSON.stringify(radio?.basis)})`);

  const run = (await req(good.base, 'GET', `/api/discover/run?seed=${seed.id}&length=3`)).json;
  ok(Array.isArray(run?.results) && run.results.length > 1, 'run: sequences more than the seed');

  /* ── 3. the salvage tier, on its own ───────────────────────────────────────────
     Break the root-relative tier by pointing LIBRARY_ROOT_NAME at a segment that
     appears in neither path. Tier 2 must go to zero — and tier 3 must pick the
     whole library up, because the content key is read from the path's SHAPE
     (album folder, artist above it) and never from the root. That independence is
     the fix for the bug where the retired rip's move into `Old (Needs to be
     trimmed)/` made every one of its 1,511 vectors key to a nonexistent artist. */
  const bad = await boot({
    port: SPARE_PORTS[0], dbPath: join(tmp, 'bad.db'), vectorDbPath: goodIndex,
    libraryRootName: 'NotTheLibraryRoot',
  });
  const badStats = (await req(bad.base, 'GET', '/api/discover/stats')).json;
  ok(badStats?.byRelPath === 0,
    `salvage: a wrong LIBRARY_ROOT_NAME kills the relative tier (got ${badStats?.byRelPath})`);
  ok(badStats?.byContentKey === TRACKS.length,
    `salvage: the content key recovers all ${TRACKS.length} regardless of root (got ${badStats?.byContentKey})`);
  ok(badStats?.measured === TRACKS.length,
    `salvage: still fully measured (got ${badStats?.measured})`);

  /* ── 4. the negative control ───────────────────────────────────────────────────
     Everything above would also pass if coverage were hardcoded. An index holding
     vectors for a DIFFERENT library must resolve onto nothing — and the server
     must say so, because this is the one failure with no downstream symptom. */
  const alienIndex = join(tmp, 'music-index-alien.db');
  buildIndex(alienIndex, { tracks: [
    'Somebody Else/Another Record/01 unrelated song.mp3',
    'Third Party/Yet Another/02 nothing to do with it.mp3',
  ] });
  const alien = await boot({
    port: SPARE_PORTS[2], dbPath: join(tmp, 'alien.db'), vectorDbPath: alienIndex, libraryRootName: 'Music',
  });
  const alienStats = (await req(alien.base, 'GET', '/api/discover/stats')).json;
  ok(alienStats?.measured === 0,
    `negative control: an index for another library measures nothing (got ${alienStats?.measured})`);
  ok(alienStats?.coverage === 0,
    `negative control: coverage is 0 (got ${alienStats?.coverage})`);
  ok(/NOT ONE/.test(alien.log()),
    'negative control: the server SAYS a populated index resolved onto nothing');

  const alienSim = (await req(alien.base, 'GET', `/api/discover/similar/${seed.id}?k=5`)).json;
  ok(alienSim?.basis === 'metadata',
    `negative control: similarity degrades to metadata and SAYS so (got ${JSON.stringify(alienSim?.basis)})`);

  /* ── 5. an uncalibrated index still works, and says it is uncalibrated ─────── */
  const rawIndex = join(tmp, 'music-index-raw.db');
  buildIndex(rawIndex, { calibrate: false });
  const raw = await boot({
    port: SPARE_PORTS[1], dbPath: join(tmp, 'raw.db'), vectorDbPath: rawIndex, libraryRootName: 'Music',
  });
  const rawStats = (await req(raw.base, 'GET', '/api/discover/stats')).json;
  ok(rawStats?.measured === TRACKS.length,
    `uncalibrated: the join still resolves (got ${rawStats?.measured})`);
  ok(rawStats?.calibrated === false, 'uncalibrated: reported as uncalibrated, not assumed');
  const rawSim = (await req(raw.base, 'GET', `/api/discover/similar/${seed.id}?k=5`)).json;
  ok(rawSim?.basis === 'embedding', 'uncalibrated: still serves an embedding basis');
  ok(rawSim?.calibrated === false, 'uncalibrated: similar() says the scores are raw');
} catch (err) {
  fail++;
  console.error('  ✗ threw: ' + (err && err.stack || err));
}
done();
