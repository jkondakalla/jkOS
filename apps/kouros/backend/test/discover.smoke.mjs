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
// It also covers the calibration (ALGORITHMS.md §4's anisotropic-cone trap): a stranger
// must score near 0 once the fitted corpus geometry is applied, not near +0.48.
//
// And the vibe space's basis (music/mapbasis.py → vectors.js `loadMapBasis`): the
// fixture carries a basis whose golden coordinates are computed HERE, independently,
// and the served packed coordinates must decode to exactly those numbers — then a
// stale, a disagreeing and a held basis must each be refused and say why.
//
// Requires `ffprobe` on PATH (the boot scan). SKIPS with exit 0 if absent.
//
//   node apps/kouros/backend/test/discover.smoke.mjs

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures', 'library');

// Claimed in the suite-manifest port registry ('kouros:discover.smoke') — the
// `port-registry` probe holds this literal to that claim.
//
// ⚠️ This smoke is the one that boots FIVE servers, and the registry can only see
// the literal above. The other four therefore sit in a band 100 above it, clear of
// the whole 398x/399x test range — they used to be PORT+1..PORT+3, and PORT+3 was
// 3986, which is BeigeBoard's delta.smoke claim. That is OPS-1 exactly: a second
// server on a claimed port, invisible to the table.
const PORT = 3983;
const BASE = `http://127.0.0.1:${PORT}`;
const SPARE_PORTS = [PORT + 100, PORT + 101, PORT + 102, PORT + 103];
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

/* ── the vibe space basis, computed independently of the code under test ────────
   The same arithmetic as `music/mapbasis.py` and `vectors.js`, spelled out: centre
   each vector by the calibration mean and re-normalise in float32 (loadArm's order),
   then c = (v − μ)·Bᵀ in float64. The basis is four coordinate axes of the fixture's
   16-d space, which is enough for every number below to be checkable by hand. */
const BASIS_DIMS = [0, 1, 3, 8];
const QUANTILES = 1001;

function quantiles(values, n) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const x = (j / (n - 1)) * (sorted.length - 1);
    const i = Math.min(sorted.length - 2, Math.floor(x));
    out[j] = sorted.length > 1 ? sorted[i] + (sorted[i + 1] - sorted[i]) * (x - i) : sorted[0];
  }
  return out;
}

function fitFixtureBasis(vectors, mean) {
  const centred = vectors.map((v) => {
    const c = new Float32Array(DIM);
    for (let d = 0; d < DIM; d++) c[d] = v[d] - mean[d];
    let s = 0;
    for (let d = 0; d < DIM; d++) s += c[d] * c[d];
    const n = Math.sqrt(s);
    for (let d = 0; d < DIM; d++) c[d] /= n;
    return c;
  });
  const mu = new Float32Array(DIM);
  for (let d = 0; d < DIM; d++) {
    let s = 0;
    for (const c of centred) s += c[d];
    mu[d] = s / centred.length;
  }
  const basis = new Float32Array(4 * DIM);
  BASIS_DIMS.forEach((dim, k) => { basis[k * DIM + dim] = 1; });
  const coords = centred.map((c) => BASIS_DIMS.map((_dim, k) => {
    let s = 0;
    for (let d = 0; d < DIM; d++) s += (c[d] - mu[d]) * basis[k * DIM + d];
    return s;
  }));
  const radius = Math.max(...coords.map((c) => Math.hypot(c[0], c[1], c[2])));
  const wq = quantiles(coords.map((c) => c[3]), QUANTILES);
  return { mu, basis, coords, radius, wq };
}

const b64f = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');

function buildIndex(dbPath, { calibrate = true, tracks = TRACKS, mapped = calibrate, tamper = null } = {}) {
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
    const meanText = Buffer.from(mean.buffer.slice(0)).toString('base64');
    const calib = createHash('sha256').update(meanText, 'ascii').digest('hex').slice(0, 16);
    const fit = fitFixtureBasis(vectors, mean);
    const golden = rows.map((rel, i) => ({ path: `${EMBEDDER_ROOT}/${rel}`, coords: [...fit.coords[i]] }));
    if (tamper === 'golden') golden[0].coords[3] += 1e-2;
    if (tamper === 'golden-within-tolerance') golden[0].coords[3] += 5e-5;
    if (mapped) {
      set.run('map_basis:local_vectors', b64f(fit.basis));
      set.run('map_mean:local_vectors', b64f(fit.mu));
      set.run('map_radius:local_vectors', String(fit.radius));
      set.run('map_wq:local_vectors', b64f(fit.wq));
      set.run('map_anchor:local_vectors', 'energy');
      set.run('map_stats:local_vectors', JSON.stringify({
        mode: 'primary', n_fit: rows.length, spearman_heldout: 0.9, fitted_at: '2026-09-16T00:00:00',
        axes: [{ feature: 'brightness', r: 0.5, low: 'dark', high: 'bright' }, null, null] }));
      set.run('map_calib:local_vectors', tamper === 'stale' ? 'deadbeefdeadbeef' : calib);
      set.run('map_golden:local_vectors', JSON.stringify(golden));
    }
    if (tamper === 'held' || tamper === 'held-old') {
      set.run('map_held:local_vectors', JSON.stringify({
        calib: tamper === 'held' ? calib : '0000000000000000', kind: 'gate',
        reason: 'G2 failed on both', at: '2026-09-16T00:00:00' }));
    }
    db.close();
    return { fit, golden };
  }
  db.close();
  return null;
}

/* ── the synthetic mesh store (ALGORITHMS.md §9) ───────────────────────────────
   Same shape as `music/mesh.py` writes: a separate file, keyed on the
   ROOT-RELATIVE lowercased path, never the absolute one. Rooted at the same
   nonexistent host path as the index above, so the production mismatch is
   reproduced here too — a store keyed absolutely would resolve nothing and read
   exactly like a fill that has not run. */
const MESH_ROWS = 5;
const MESH_BANDS = 128;

function buildMeshStore(dbPath, { tracks = TRACKS.slice(0, 2), root = EMBEDDER_ROOT,
                                  failed = [] } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE meshes(
      rel_key TEXT PRIMARY KEY, n_rows INTEGER NOT NULL, n_mels INTEGER NOT NULL,
      row_secs REAL NOT NULL, value_lo REAL NOT NULL, value_hi REAL NOT NULL,
      reduction TEXT NOT NULL, config_sig TEXT NOT NULL, duration REAL,
      rows BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE failures(
      rel_key TEXT PRIMARY KEY, error TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '');
  `);
  // Everything below the LAST segment named like the library root — the same
  // rule both sides of the join run, spelled out here rather than imported so the
  // fixture cannot be made to pass by a bug in the code under test.
  const rootName = root.split('/').filter(Boolean).pop().toLowerCase();
  const relKey = (rel) => {
    const parts = `${root}/${rel}`.split('/').filter(Boolean);
    const i = parts.map((x) => x.toLowerCase()).lastIndexOf(rootName);
    return parts.slice(i + 1).join('/').toLowerCase();
  };
  const ins = db.prepare(
    'INSERT INTO meshes(rel_key, n_rows, n_mels, row_secs, value_lo, value_hi, reduction, ' +
    'config_sig, duration, rows) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const rel of tracks) {
    const bytes = Buffer.alloc(MESH_ROWS * MESH_BANDS);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    ins.run(relKey(rel), MESH_ROWS, MESH_BANDS, 1.996916, -8, 10, 'p75', 'sigtest', 10, bytes);
  }
  const insFail = db.prepare('INSERT INTO failures(rel_key, error) VALUES(?,?)');
  for (const rel of failed) insFail.run(relKey(rel), 'DecodeError: zero-length file');
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(
    'mesh_recipe', 'config=sigtest;mels=128;reduction=p75;row_secs=1.996916;range=-8.0000..10.0000');
  db.close();
}

async function req(base, method, path) {
  const r = await fetch(base + path, { method });
  let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

async function boot({ port, dbPath, vectorDbPath, meshDbPath, libraryRootName,
                      musicDir = FIXTURES_DIR, expectTracks = TRACKS.length, env = {} }) {
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      ...env,
      NODE_ENV: '',
      PORT: String(port),
      DB_PATH: dbPath,
      MUSIC_DIR: musicDir,
      VECTOR_DB_PATH: vectorDbPath,
      // Absent by default, so a server that is not given one exercises the
      // "there is no store" branch rather than accidentally finding a sibling's.
      MESH_DB_PATH: meshDbPath || join(tmp, 'no-such-mesh-store.db'),
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
    if (Array.isArray(r.json) && r.json.length >= expectTracks) break;
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
  // Meshes for the first two tracks only, and a recorded failure for the third:
  // "filled", "tried and could not" and "not reached yet" are three states, and
  // the surface has to keep them apart.
  const goodMeshes = join(tmp, 'meshes-good.db');
  buildMeshStore(goodMeshes, { tracks: TRACKS.slice(0, 1), failed: TRACKS.slice(1, 2) });
  const good = await boot({
    port: PORT, dbPath: join(tmp, 'good.db'), vectorDbPath: goodIndex,
    meshDbPath: goodMeshes, libraryRootName: 'Music',
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

  // ⚠️ ALGORITHMS.md §4's anisotropic-cone trap: read RAW, every one of these vectors
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

  /* ── 2b. the vibe space — the served coordinates ARE the fitted ones ─────────── */
  ok(stats?.map?.available === true,
    `vibe space: the basis was verified against its golden tracks (got ${JSON.stringify(stats?.map)})`);
  const vmap = (await req(good.base, 'GET', '/api/discover/map')).json;
  ok(vmap?.available === true, `vibe space: served (got ${JSON.stringify(vmap?.reason)})`);
  ok(vmap?.anchor?.feature === 'energy' && vmap?.anchor?.low === 'calm' && vmap?.anchor?.high === 'intense',
    `vibe space: the rail is named calm → intense (got ${JSON.stringify(vmap?.anchor)})`);
  ok(JSON.stringify(vmap?.stops) === JSON.stringify([0.1, 0.3, 0.5, 0.7, 0.9]),
    'vibe space: the snap stops are the equal-population percentiles');
  ok(vmap?.packed?.n === TRACKS.length, `vibe space: packs every covered track (got ${vmap?.packed?.n})`);
  const unpack = (b64) => Buffer.from(String(b64 || ''), 'base64');
  const pIds = unpack(vmap?.packed?.ids);
  const pXyz = unpack(vmap?.packed?.xyz);
  const pW = unpack(vmap?.packed?.w);
  const pFlags = unpack(vmap?.packed?.flags);
  const packedIds = Array.from({ length: pIds.length / 4 }, (_, r) => pIds.readInt32LE(r * 4));
  ok(packedIds.length === TRACKS.length && packedIds.every((id, r) => r === 0 || id > packedIds[r - 1]),
    `vibe space: ids are sorted ascending (got ${JSON.stringify(packedIds)})`);
  // Expected display coordinates, from the fixture's own fit.
  const goodFit = buildIndex(join(tmp, 'scratch-expected.db'));
  const expected = new Map(TRACKS.map((rel, i) => [rel, goodFit.fit.coords[i]]));
  const pctOf = (w) => {
    const wq = goodFit.fit.wq;
    if (!(w > wq[0])) return 0;
    if (!(w < wq[QUANTILES - 1])) return 1;
    let lo = 0; while (lo < QUANTILES - 2 && wq[lo + 1] <= w) lo++;
    const span = wq[lo + 1] - wq[lo];
    return (lo + (span > 0 ? (w - wq[lo]) / span : 0)) / (QUANTILES - 1);
  };
  let worst = 0;
  for (const t of tracks) {
    const r = packedIds.indexOf(t.id);
    const rel = TRACKS.find((p) => p.toLowerCase().includes(String(t.title).toLowerCase()));
    const c = rel && expected.get(rel);
    if (r < 0 || !c) { worst = Infinity; continue; }
    for (let k = 0; k < 3; k++) {
      const want = Math.max(-1, Math.min(1, c[k] / goodFit.fit.radius));
      worst = Math.max(worst, Math.abs(pXyz.readInt16LE(r * 6 + k * 2) / 32767 - want));
    }
    worst = Math.max(worst, Math.abs(pW.readUInt16LE(r * 2) / 65535 - pctOf(c[3])));
  }
  ok(worst <= 2 / 32767,
    `vibe space: every packed coordinate decodes to the independently computed projection (worst ${worst})`);
  ok([...pFlags].every((f) => (f & 1) === 0), 'vibe space: every row is flagged measured, none inferred');
  ok(Array.isArray(vmap?.regions) && vmap.regions.length > 0 &&
     vmap.regions.every((g) => [g.x, g.y, g.z].every((v) => v >= -1 && v <= 1) && g.w >= 0 && g.w <= 1),
    `vibe space: regions sit inside the cube and on the rail (got ${JSON.stringify(vmap?.regions)})`);

  // Near: the point where "song one" sits must answer "song one" first.
  const one = tracks.find((t) => /song one/i.test(t.title || ''));
  const r1 = packedIds.indexOf(one.id);
  const q = `x=${pXyz.readInt16LE(r1 * 6) / 32767}&y=${pXyz.readInt16LE(r1 * 6 + 2) / 32767}` +
            `&z=${pXyz.readInt16LE(r1 * 6 + 4) / 32767}&w=${pW.readUInt16LE(r1 * 2) / 65535}`;
  const nearRes = (await req(good.base, 'GET', `/api/discover/near?${q}&k=3`)).json;
  ok(nearRes?.results?.[0]?.id === one.id && nearRes.results[0].distance < 0.01,
    `near: the point a track sits at answers that track first (got ${JSON.stringify(nearRes?.results?.[0])})`);
  const noW = await req(good.base, 'GET', '/api/discover/near?x=0&y=0&z=0');
  ok(noW.status === 400, `near: a point with no energy is refused, not guessed (got ${noW.status})`);

  /* ── 2c. a basis this side cannot reproduce is REFUSED, and says why ─────────
     Read straight through vectors.js on tampered copies — booting a server per
     case would test the same function five seconds at a time. */
  const { openVectorSpace } = require(join(BACKEND, 'src', 'discover', 'vectors.js'));
  const mapOf = (tamper, opts = {}) => {
    const p = join(tmp, `map-${tamper}.db`);
    buildIndex(p, { tamper, ...opts });
    return openVectorSpace({ vectorDbPath: p, libraryRootName: 'Music' }).map;
  };
  const stale = mapOf('stale');
  ok(stale?.available === false && /different calibration/.test(stale?.reason || ''),
    `refused: a basis from another calibration (got ${JSON.stringify(stale)})`);
  const disagree = mapOf('golden');
  ok(disagree?.available === false && /golden coordinates disagree/.test(disagree?.reason || ''),
    `refused: golden coordinates this side does not reproduce (got ${JSON.stringify(disagree?.reason)})`);
  const within = mapOf('golden-within-tolerance');
  ok(within?.available === true,
    `accepted: a golden difference inside 1e-4 — the tolerance is real, not zero (got ${JSON.stringify(within?.reason)})`);
  const heldMap = mapOf('held', { mapped: false });
  ok(heldMap?.available === false && heldMap?.held === true && /G2 failed on both/.test(heldMap?.reason || ''),
    `held: a recorded hold for this calibration is reported as held (got ${JSON.stringify(heldMap)})`);
  const oldHold = mapOf('held-old', { mapped: false });
  ok(oldHold?.available === false && !oldHold?.held,
    `held: a hold from an older calibration is not a hold (got ${JSON.stringify(oldHold)})`);

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
  const rawMap = (await req(raw.base, 'GET', '/api/discover/map')).json;
  ok(rawMap?.available === false && typeof rawMap?.reason === 'string' && rawMap.reason.length > 0,
    `uncalibrated: the vibe space is unavailable and says why (got ${JSON.stringify(rawMap)})`);

  /* ── 6. the pulsarmap (ALGORITHMS.md §9) ──────────────────────────────────────
     The mesh store joins on the SAME root-relative key as the vectors, so it
     inherits the same trap: keyed absolutely it resolves nothing and reads as a
     fill that never ran. Every assertion below is about a state being reported
     rather than inferred from an empty response. */
  ok(stats?.meshes?.available === true,
    `mesh: stats reports the store is open (got ${JSON.stringify(stats?.meshes?.available)})`);
  ok(stats?.meshes?.meshes === 1,
    `mesh: stats counts the stored meshes (got ${stats?.meshes?.meshes})`);
  ok(stats?.meshes?.failed === 1,
    `mesh: stats counts the recorded failures separately (got ${stats?.meshes?.failed})`);

  const filled = byTitle.get('song one') || tracks.find((t) => /song one/i.test(t.title || ''));
  const meshOk = (await req(good.base, 'GET', `/api/discover/mesh/${filled.id}`)).json;
  ok(meshOk?.state === 'ok', `mesh: a filled track answers ok (got ${JSON.stringify(meshOk?.state)})`);
  ok(meshOk?.rows === MESH_ROWS && meshOk?.bands === MESH_BANDS,
    `mesh: ${MESH_ROWS}x${MESH_BANDS} (got ${meshOk?.rows}x${meshOk?.bands})`);
  ok(Buffer.from(String(meshOk?.data || ''), 'base64').length === MESH_ROWS * MESH_BANDS,
    'mesh: the base64 body decodes to exactly rows x bands bytes');
  // ⚠️ The scale is on the wire so the client can dequantise — NOT so it can be
  // per track. Every mesh in one store carries the same pair; that is what makes
  // two pictures comparable, and it is the single thing that would silently make
  // the pulsarmap meaningless.
  ok(Array.isArray(meshOk?.value_range) && meshOk.value_range[0] === -8 && meshOk.value_range[1] === 10,
    `mesh: carries the shared value range (got ${JSON.stringify(meshOk?.value_range)})`);
  ok(meshOk?.reduction === 'p75',
    `mesh: says which reduction built it (got ${JSON.stringify(meshOk?.reduction)})`);
  ok(typeof meshOk?.row_seconds === 'number' && meshOk.row_seconds > 1.9 && meshOk.row_seconds < 2.1,
    `mesh: carries the row duration the reveal is driven by (got ${meshOk?.row_seconds})`);

  const meshFailed = tracks.find((t) => /song two/i.test(t.title || ''));
  const failedBody = (await req(good.base, 'GET', `/api/discover/mesh/${meshFailed.id}`)).json;
  ok(failedBody?.state === 'failed',
    `mesh: a track the fill could not build says so (got ${JSON.stringify(failedBody?.state)})`);

  const meshPending = tracks.find((t) => /solo/i.test(t.title || ''));
  const pendingRes = await req(good.base, 'GET', `/api/discover/mesh/${meshPending.id}`);
  ok(pendingRes.status === 200 && pendingRes.json?.state === 'pending',
    `mesh: a track not reached yet is 200 pending, NOT 404 (got ${pendingRes.status} ` +
    `${JSON.stringify(pendingRes.json?.state)})`);

  const missing = await req(good.base, 'GET', '/api/discover/mesh/999999');
  ok(missing.status === 404,
    `mesh: 404 is reserved for a track that does not exist (got ${missing.status})`);

  // The negative control: a server with no store must say 'unavailable', not
  // 'pending'. A client that cannot tell those apart shows "coming soon" forever
  // for a store that will never appear.
  const noStore = (await req(raw.base, 'GET', `/api/discover/mesh/${filled.id}`)).json;
  ok(noStore?.state === 'unavailable',
    `mesh: no store reads as unavailable, not pending (got ${JSON.stringify(noStore?.state)})`);
  const rawMeshStats = (await req(raw.base, 'GET', '/api/discover/stats')).json;
  ok(rawMeshStats?.meshes?.available === false,
    'mesh: stats reports the missing store rather than omitting it');

  // And the join is real: point the root name somewhere else and the same store
  // resolves nothing. Without this, every assertion above would also pass on a
  // store that was being matched by luck.
  const badMesh = (await req(bad.base, 'GET', `/api/discover/mesh/${filled.id}`)).json;
  ok(badMesh?.state !== 'ok',
    `mesh: a wrong LIBRARY_ROOT_NAME breaks the join (got ${JSON.stringify(badMesh?.state)})`);

  /* ── 7. a delivery, picked up by a running server ──────────────────────────────
     What `music/analyze.py --watch` does to a live KourOS: a new album lands on the
     shelf, the workstation analyses it, and rsync REPLACES both analysis files
     (write a temp file, rename over). Three things must then happen with no restart,
     and before this section none of them did:
       · the mesh store is reopened — a handle held open forever reads the unlinked
         inode and serves the old store for the life of the process;
       · the vector space is rebuilt from the new index;
       · the catalog is rescanned, because nothing else in KourOS walks MUSIC_DIR —
         the upload's vectors would arrive and its TRACK would not. */
  const TTL = 400;
  const liveLib = join(tmp, 'live-library');
  const uploaded = TRACKS[2];
  for (const rel of TRACKS.slice(0, 2)) {
    mkdirSync(dirname(join(liveLib, rel)), { recursive: true });
    cpSync(join(FIXTURES_DIR, rel), join(liveLib, rel));
  }
  const liveIndex = join(tmp, 'live-index.db');
  const liveMeshes = join(tmp, 'live-meshes.db');
  buildIndex(liveIndex, { tracks: TRACKS.slice(0, 2) });
  buildMeshStore(liveMeshes, { tracks: TRACKS.slice(0, 1) });
  const live = await boot({
    port: SPARE_PORTS[3], dbPath: join(tmp, 'live.db'), vectorDbPath: liveIndex,
    meshDbPath: liveMeshes, libraryRootName: 'Music', musicDir: liveLib, expectTracks: 2,
    env: { DISCOVER_TTL_MS: String(TTL) },
  });
  const before = (await req(live.base, 'GET', '/api/discover/stats')).json;
  ok(before?.tracks === 2 && before?.measured === 2 && before?.meshes?.meshes === 1,
    `delivery: starts at 2 tracks, 2 measured, 1 mesh (got ${before?.tracks}/${before?.measured}/${before?.meshes?.meshes})`);

  // An idle TTL is a stat, not a rebuild.
  const builds = () => (live.log().match(/space built in/g) || []).length;
  const buildsBefore = builds();
  await new Promise((r) => setTimeout(r, TTL * 2));
  await req(live.base, 'GET', '/api/discover/stats');
  await req(live.base, 'GET', '/api/discover/stats');
  ok(builds() === buildsBefore,
    `delivery: a lapsed TTL over an unchanged index does not rebuild (${buildsBefore} → ${builds()})`);

  // The upload, then the delivery — each file built beside its target and renamed over it.
  mkdirSync(dirname(join(liveLib, uploaded)), { recursive: true });
  cpSync(join(FIXTURES_DIR, uploaded), join(liveLib, uploaded));
  buildIndex(`${liveIndex}.next`, { tracks: TRACKS });
  buildMeshStore(`${liveMeshes}.next`, { tracks: TRACKS });
  renameSync(`${liveIndex}.next`, liveIndex);
  renameSync(`${liveMeshes}.next`, liveMeshes);
  await new Promise((r) => setTimeout(r, TTL * 2));

  let after = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    after = (await req(live.base, 'GET', '/api/discover/stats')).json;
    if (after?.tracks === 3 && after?.measured === 3 && after?.meshes?.meshes === 3) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  ok(after?.meshes?.meshes === 3,
    `delivery: the replaced mesh store is reopened, not read through the old inode (got ${after?.meshes?.meshes})`);
  ok(after?.tracks === 3,
    `delivery: the replaced analysis triggers a rescan that catalogs the upload (got ${after?.tracks} tracks)`);
  ok(after?.measured === 3,
    `delivery: the upload is MEASURED from the new index, not inferred (got ${after?.measured})`);
  ok(/rescanning for the music it describes/.test(live.log()),
    'delivery: the server says why it rescanned');
  const liveTracks = (await req(live.base, 'GET', '/api/tracks')).json || [];
  const solo = liveTracks.find((t) => /solo/i.test(t.title || ''));
  const soloMesh = solo && (await req(live.base, 'GET', `/api/discover/mesh/${solo.id}`)).json;
  ok(soloMesh?.state === 'ok',
    `delivery: the upload's pulsarmap is served (got ${JSON.stringify(soloMesh?.state)})`);
} catch (err) {
  fail++;
  console.error('  ✗ threw: ' + (err && err.stack || err));
}
done();
