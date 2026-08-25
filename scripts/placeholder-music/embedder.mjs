// embedder.mjs — a stand-in for `music/index.db`, the embedder's output.
//
// KourOS's discovery surfaces (Home's Runs and Time-of-day rails, similar-tracks,
// radio, and the whole vibe map) read vectors out of a SEPARATE SQLite file written
// by the Python pipeline in `music/`. Without it every one of them degrades to
// metadata affinity and says so — which is correct behaviour, and completely useless
// for judging what the vibe map LOOKS like. So this writes an index of the same
// schema over the placeholder library.
//
// Three things it deliberately gets right rather than filling with noise:
//
// 1. THE ANISOTROPIC CONE. Real CLAP vectors all share a strong common direction:
//    two strangers score +0.48, not 0.0. backend/src/discover/vectors.js exists
//    largely to correct for that, reading a fitted `calib_*` from the index's `meta`
//    table — a header there records that reading the cosine raw once reported the
//    WRONG WINNER at the gate. Uniform random vectors would be centred already, the
//    calibration path would never be exercised, and the one trap worth seeing on
//    screen would be invisible. So a corpus axis is added on purpose, and then
//    fitted and stored exactly as `music/query.py --fit` would.
//
// 2. STRUCTURE THAT MATCHES THE AUDIO. Cluster centres are per SOUND PROFILE and
//    albums sit near their genre, so the map's regions are real regions and
//    "similar tracks" returns things that actually sound alike — because the same
//    profile drove the synthesis in audio.mjs.
//
// 3. PARTIAL COVERAGE. Real backfill is a percentage, not a state. Three albums are
//    left with no vectors at all so the metadata-fallback badge has somewhere to
//    appear, and album propagation (a track inheriting its album's centroid, marked
//    INFERRED) has something to do.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash, rng } from './art.mjs';
import { profileOf, SOUND_NAMES } from './audio.mjs';

/** The sound-profile names, as an object so `genreManifold` can enumerate them. */
const PROFILE_TABLE = Object.fromEntries(SOUND_NAMES.map((n) => [n, true]));

const here = path.dirname(fileURLToPath(import.meta.url));
// better-sqlite3 is a native module and only the backends install it; borrow KourOS's
// rather than adding a dependency to a dev-only script.
const require = createRequire(path.join(here, '..', '..', 'apps', 'kouros', 'backend', 'package.json'));

const DIM = 512;
const DESC_DIM = 119;
/** music/descriptors.py's LAYOUT positions, as read by backend/src/discover/space.js. */
const D = { CENTROID: 104, FLATNESS: 107, LOGRMS: 109, TEMPO: 116, STRENGTH: 117, ONSET: 118 };

const unit = (rand) => {
  // Box-Muller into a Gaussian, then normalise: a vector of uniforms is not a
  // uniformly-distributed DIRECTION, and the difference shows up as structure the
  // PCA then finds and puts on an axis.
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i += 2) {
    const u1 = Math.max(1e-9, rand()), u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    v[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < DIM) v[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return norm(v);
};

function norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function mix(a, b, w) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - w) + b[i] * w;
  return norm(out);
}

const blob = (v) => {
  const b = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4);
  return b;
};

/* ── where the genres SIT relative to each other ────────────────────────────────
   The first cut gave every genre an independent random direction in 512-d, which
   makes all fourteen of them mutually near-orthogonal — and a 2-D PCA of fourteen
   orthogonal clusters can separate two or three of them and piles the rest on the
   origin. The vibe map then draws two outliers in the corners and a smudge in the
   middle: a picture of THIS FILE'S parameters, not of a library.

   Real genres are not orthogonal. They lie on a low-dimensional perceptual
   manifold — jazz sits nearer classical than techno does — and that manifold is
   what CLAP's leading components actually recover. So the centres are BUILT on
   four shared axes taken from the same synthesis profile that generated the audio
   and the readable descriptors: loudness, brightness, tempo and fuzz. Two genres
   that sound alike then genuinely sit near each other, PCA finds the axes rather
   than the outliers, and the map spreads out AND means something. */
const MANIFOLD_AXES = [
  ['energy',     (p) => p.drive * 0.42 + p.kick * 1.6],
  ['brightness', (p) => p.lowpass],
  ['tempo',      (p) => (p.bpm[0] + p.bpm[1]) / 2],
  ['fuzz',       (p) => p.noise * 9 + p.pluck * -0.4],
];

/** Gram-Schmidt: the four axes must be independent directions or the "manifold"
 *  is a line and every genre lands on it in the same order twice. */
function orthonormalBasis(rand, k) {
  const basis = [];
  for (let i = 0; i < k; i++) {
    const v = unit(rand);
    for (const b of basis) {
      let dot = 0;
      for (let d = 0; d < DIM; d++) dot += v[d] * b[d];
      for (let d = 0; d < DIM; d++) v[d] -= dot * b[d];
    }
    basis.push(norm(v));
  }
  return basis;
}

function genreManifold(rand) {
  const sounds = Object.keys(PROFILE_TABLE);
  const basis = orthonormalBasis(rand, MANIFOLD_AXES.length);
  // z-score each axis across the genres so no axis dominates purely because its
  // units are Hz and its neighbour's are a 0-1 ratio.
  const coords = MANIFOLD_AXES.map(([, f]) => {
    const raw = sounds.map((s) => f(profileOf(s)));
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const sd = Math.sqrt(raw.reduce((a, b) => a + (b - mean) ** 2, 0) / raw.length) || 1;
    return raw.map((x) => (x - mean) / sd);
  });

  const out = new Map();
  sounds.forEach((s, i) => {
    const v = new Float32Array(DIM);
    for (let a = 0; a < basis.length; a++) {
      const w = coords[a][i];
      for (let d = 0; d < DIM; d++) v[d] += basis[a][d] * w;
    }
    // A small genre-private direction, so two genres with near-identical profiles
    // are still distinguishable rather than stacked on one point.
    out.set(s, mix(norm(v), unit(rng(hash(`sound:${s}`))), 0.18));
  });
  return out;
}

/** Physical descriptor values DERIVED FROM THE SYNTHESIS PROFILE, so the readable
 *  axes describe audio that really does sound that way: a punk track really is
 *  brighter, louder, faster and fuzzier than an ambient one in these files. */
function descriptorRow(sound, rand) {
  const p = profileOf(sound);
  const bpm = (p.bpm[0] + p.bpm[1]) / 2 * (0.94 + rand() * 0.12);
  const v = new Float32Array(DESC_DIM);
  // The MFCC/chroma bulk is not read by anything on this side of the wire; fill it
  // with small correlated values rather than zeros so the width check is the only
  // thing that ever depends on it.
  for (let i = 0; i < DESC_DIM; i++) v[i] = (rand() - 0.5) * 2;
  v[D.CENTROID] = p.lowpass * (0.36 + rand() * 0.12);              // Hz
  v[D.FLATNESS] = Math.min(0.95, p.noise * 9 + p.drive * 0.03 + rand() * 0.05);
  v[D.LOGRMS] = -7.4 + p.drive * 0.42 + p.kick * 1.6 + rand() * 0.3;
  v[D.TEMPO] = Math.log2(bpm);
  v[D.STRENGTH] = Math.min(0.98, p.kick * 1.7 + p.hat * 0.9 + rand() * 0.06);
  v[D.ONSET] = (bpm / 60) * (1 + p.hat * 6) * (0.8 + rand() * 0.4);
  return v;
}

/**
 * Write the index. `tracks` is generate()'s manifest.
 * @param {{ tracks: Array, out: string, coverage?: number, seed?: number }} opts
 */
export function writeIndex({ tracks, out, coverage = 0.78, seed = 0x9e3779b9, albumSpread = 0.44, trackSpread = 0.22 }) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(out + suffix, { force: true });

  const db = new Database(out);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, mtime REAL, size INTEGER,
      duration REAL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, updated_at TEXT NOT NULL );
    CREATE INDEX tracks_status ON tracks(status);
    CREATE TABLE local_vectors (
      track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      model TEXT NOT NULL, revision TEXT, dim INTEGER NOT NULL, vector BLOB NOT NULL,
      config_sig TEXT NOT NULL, created_at TEXT NOT NULL );
    CREATE TABLE descriptors (
      track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL,
      config_sig TEXT NOT NULL, created_at TEXT NOT NULL );
  `);

  const rand = rng(seed);
  const corpusAxis = unit(rand);                       // the direction every vector shares
  const soundCentre = genreManifold(rand);
  const albumCentre = new Map();

  // The three albums the backfill has "not reached" — chosen by hash so the choice
  // is stable across runs rather than moving every regeneration.
  const albumKeys = [...new Set(tracks.map((t) => `${t.albumartist}|${t.album}`))];
  const uncovered = new Set([...albumKeys].sort((a, b) => hash(a) - hash(b)).slice(0, 3));

  const now = new Date().toISOString();
  const insTrack = db.prepare(
    `INSERT INTO tracks (path, mtime, size, duration, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const insVec = db.prepare(
    `INSERT INTO local_vectors (track_id, model, revision, dim, vector, config_sig, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insDesc = db.prepare(
    `INSERT INTO descriptors (track_id, version, dim, vector, config_sig, created_at) VALUES (?, ?, ?, ?, ?, ?)`);

  const vectors = [];
  db.transaction(() => {
    for (const t of tracks) {
      const st = fs.existsSync(t.path) ? fs.statSync(t.path) : { mtimeMs: Date.now(), size: 0 };
      const key = `${t.albumartist}|${t.album}`;
      const skip = uncovered.has(key) || rand() > coverage;
      const id = insTrack.run(
        t.path, st.mtimeMs / 1000, st.size, t.duration,
        skip ? 'pending' : 'done', now,
      ).lastInsertRowid;
      if (skip) continue;

      if (!albumCentre.has(key)) {
        const genre = soundCentre.get(t.sound) || soundCentre.get('indie');
        albumCentre.set(key, mix(genre, unit(rng(hash(`album:${key}`))), albumSpread));
      }
      // Track ≈ album ≈ genre, then pushed onto the shared corpus axis. ToDo §8.7
      // measured same-album cosine at +0.43 over the real library, which is the
      // number these two spreads are set against. They are also what the VIBE MAP
      // reads: cluster too tightly and the PCA projects fourteen genres into one
      // corner with the rest of the map empty, which is a picture of this file's
      // parameters rather than of a library.
      let v = mix(albumCentre.get(key), unit(rand), trackSpread);
      for (let i = 0; i < DIM; i++) v[i] += corpusAxis[i] * 0.95;
      v = norm(v);

      insVec.run(id, 'placeholder/kouros-design-fixture', 'v1', DIM, blob(v), 'f0f0placeholder', now);
      insDesc.run(id, 1, DESC_DIM, blob(descriptorRow(t.sound, rand)), 'd0d0placeholder', now);
      vectors.push(v);
    }
  })();

  /* ── the fit, exactly as vectors.js expects to read it ─────────────────────── */
  const mean = new Float32Array(DIM);
  for (const v of vectors) for (let i = 0; i < DIM; i++) mean[i] += v[i];
  for (let i = 0; i < DIM; i++) mean[i] /= vectors.length || 1;

  // Stranger statistics are measured on the CENTRED, re-normalised vectors — the
  // same order loadArm() applies them in. Measuring before centring would fit a
  // zero point for a space nothing ever reads.
  const centred = vectors.map((v) => {
    const c = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) c[i] = v[i] - mean[i];
    return norm(c);
  });
  const pairRand = rng(0x5bd1e995);
  const cos = [];
  for (let k = 0; k < 60000 && centred.length > 1; k++) {
    const a = centred[Math.floor(pairRand() * centred.length)];
    const b = centred[Math.floor(pairRand() * centred.length)];
    if (a === b) continue;
    let s = 0;
    for (let i = 0; i < DIM; i++) s += a[i] * b[i];
    cos.push(s);
  }
  const cMean = cos.reduce((s, x) => s + x, 0) / (cos.length || 1);
  const cSpread = Math.sqrt(cos.reduce((s, x) => s + (x - cMean) ** 2, 0) / (cos.length || 1));

  const meta = db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`);
  db.transaction(() => {
    meta.run('schema_version', '1');
    meta.run('config_sig:local_vectors', 'f0f0placeholder');
    meta.run('recipe:local_vectors', 'placeholder/kouros-design-fixture@v1/genre-clustered');
    meta.run('config_sig:descriptors', 'd0d0placeholder');
    meta.run('descriptor_version', '1');
    meta.run('calib_mean:local_vectors', blob(mean).toString('base64'));
    meta.run('calib_stranger_mean:local_vectors', String(cMean));
    meta.run('calib_stranger_spread:local_vectors', String(cSpread));
    meta.run('calib_n_fit:local_vectors', String(vectors.length));
    meta.run('calib_pairs:local_vectors', String(cos.length));
    meta.run('calib_sig:local_vectors', 'f0f0placeholder');
  })();

  // Checkpoint and drop the WAL: a copy of the .db alone must be complete. The
  // real index is read mid-backfill and its -wal has to travel with it, which is
  // exactly the trap this file should not reproduce for a fixture.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  return {
    out,
    total: tracks.length,
    measured: vectors.length,
    uncoveredAlbums: [...uncovered],
    strangerMean: cMean,
    strangerSpread: cSpread,
  };
}
