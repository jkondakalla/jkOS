#!/usr/bin/env node
// cli.mjs — the one entry point.
//
//   node scripts/placeholder-music/cli.mjs build     write the library + the embedder index
//   node scripts/placeholder-music/cli.mjs serve     auth stub + backend + the built app, on :4173
//   node scripts/placeholder-music/cli.mjs dev       the same, but the app half is vite (HMR), still :4173
//   node scripts/placeholder-music/cli.mjs reindex   rebuild the vector space only (seconds, no re-encode)
//   node scripts/placeholder-music/cli.mjs seed      re-seed history/playlists only
//
// Flags: --lib DIR  --data DIR  --bitrate 32k  --concurrency N  --port N  --auth-port N
//
// One URL in both modes — http://localhost:4173 — because the app is served through
// a front door that reproduces the suite edge's `/api/kouros/` rewrite. See edge.mjs
// for why the app is an empty library without it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';
import { writeIndex } from './embedder.mjs';
import { seed } from './seed.mjs';
import { startAuthStub } from './auth-stub.mjs';
import { startEdge } from './edge.mjs';
import { buildCatalog } from './catalog.mjs';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
/** Outside the repo by default: ~250 MB of generated mp3 has no business in a
 *  working tree, gitignored or not. */
const HOME = path.join(path.dirname(REPO), 'kouros-placeholder-music');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'help';
// The library root's BASENAME is LIBRARY_ROOT_NAME — the segment KourOS and the
// embedder index agree on. Keep it `Music` unless you also pass --root-name.
const LIB = path.resolve(args.lib || path.join(HOME, 'Music'));
const DATA = path.resolve(args.data || path.join(HOME, 'data'));
const ROOT_NAME = args['root-name'] || path.basename(LIB);
const PORT = Number(args.port || 3011);
const AUTH_PORT = Number(args['auth-port'] || 3010);
const VITE_PORT = Number(args['vite-port'] || 5173);
const EDGE_PORT = Number(args['edge-port'] || 4173);

/** The manifest `reindex` needs, recovered from the SCANNED catalog when
 *  manifest.json is missing (an older build, or a hand-deleted data dir). The one
 *  field the database cannot supply is `sound` — the synthesis profile — so it is
 *  looked back up from catalog.mjs by album artist, which is where it came from. */
function manifestFromDb(dbPath) {
  const require = createRequire(path.join(REPO, 'apps', 'kouros', 'backend', 'package.json'));
  const Database = require('better-sqlite3');
  const soundOf = new Map(buildCatalog().map((a) => [`${a.albumartist}|${a.title}`, a.sound]));
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    `SELECT path, duration, album, albumartist FROM tracks ORDER BY path`).all();
  db.close();
  return rows.map((r) => ({
    ...r, sound: soundOf.get(`${r.albumartist}|${r.album}`) || 'indie',
  }));
}

const bytes = (n) => `${(n / 1024 / 1024).toFixed(0)} MB`;
const dirSize = (d) => {
  let total = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
};

/* ── build ─────────────────────────────────────────────────────────────────── */

async function build() {
  const t0 = Date.now();
  console.log(`library  ${LIB}`);
  console.log(`data     ${DATA}`);
  fs.rmSync(LIB, { recursive: true, force: true });

  let last = 0;
  const result = await generate({
    root: LIB,
    manifestPath: path.join(DATA, 'manifest.json'),
    concurrency: Number(args.concurrency || Math.min(12, os.cpus().length)),
    bitrate: args.bitrate || '32k',
    onProgress: (done, total) => {
      if (done - last >= 20 || done === total) {
        last = done;
        process.stdout.write(`\r  encoding ${done}/${total}`);
      }
    },
  });
  process.stdout.write('\n');

  const idx = writeIndex({ tracks: result.tracks, out: path.join(DATA, 'music-index.db') });

  console.log(
    `\n${result.albums} albums · ${result.tracks.length} tracks · ${bytes(dirSize(LIB))} · ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  ${result.excluded} tracks under "Old (Needs to be trimmed)" the scan must skip`);
  console.log(
    `  embedder index: ${idx.measured}/${idx.total} vectors ` +
    `(${((idx.measured / idx.total) * 100).toFixed(0)}% measured, 3 albums left uncovered)`);
  console.log(
    `  calibration fitted: strangers ${idx.strangerMean.toFixed(4)} ± ${idx.strangerSpread.toFixed(4)}`);
  console.log(`\nNext:  node scripts/placeholder-music/cli.mjs serve`);
}

/* ── the backend, with the placeholder library wired in ────────────────────── */

function backendEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    DB_PATH: path.join(DATA, 'kouros.db'),
    MUSIC_DIR: LIB,
    MUSIC_EXCLUDE_DIRS: 'Old (Needs to be trimmed)',
    VECTOR_DB_PATH: path.join(DATA, 'music-index.db'),
    LIBRARY_ROOT_NAME: ROOT_NAME,
    SHELL_URL: `http://localhost:${EDGE_PORT}`,
    ALLOWED_ORIGINS: `http://localhost:${EDGE_PORT},http://127.0.0.1:${EDGE_PORT}`,
    // Deliberately unset: with no key and NODE_ENV != production, weaveAuth injects
    // its stub user, which is what lets every route answer without a real token.
    JKOS_AUTH_PUBLIC_KEY: '',
    JKOS_AUTH_JWKS_URI: '',
    ...extra,
  };
}

function startBackend(extra) {
  fs.mkdirSync(DATA, { recursive: true });
  const child = spawn(process.execPath, [path.join(REPO, 'apps/kouros/backend/server.js')], {
    env: backendEnv(extra), stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => { if (code) console.error(`[backend] exited ${code}`); });
  return child;
}

/** Wait for the boot scan to settle: the count has to stop moving, not merely be
 *  non-zero — seeding halfway through a scan writes history for a third of a library. */
async function waitForScan(expected) {
  const url = `http://127.0.0.1:${PORT}/api/library/stats`;
  let stable = 0, previous = -1;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const { tracks } = await r.json();
      process.stdout.write(`\r  scanned ${tracks}${expected ? `/${expected}` : ''}`);
      if (tracks > 0 && tracks === previous) { if (++stable >= 3) { process.stdout.write('\n'); return tracks; } }
      else stable = 0;
      previous = tracks;
    } catch { /* not listening yet */ }
  }
  throw new Error('timed out waiting for the boot scan');
}

/* ── serve / dev ───────────────────────────────────────────────────────────── */

async function run({ vite }) {
  if (!fs.existsSync(LIB)) {
    console.error(`No library at ${LIB} — run \`build\` first.`);
    process.exit(1);
  }
  const authUrl = `http://localhost:${AUTH_PORT}`;
  const stub = await startAuthStub({
    port: AUTH_PORT,
    origins: [`http://localhost:${EDGE_PORT}`, `http://127.0.0.1:${EDGE_PORT}`],
  });
  console.log(`[auth-stub] ${authUrl} — not an authenticator, a shape`);

  const children = [];
  if (!vite) {
    // Built once and served by the backend itself, so the app and its API share an
    // origin and nothing depends on a proxy.
    console.log('[build] vite build (VITE_JKOS_AUTH_URL → the stub)…');
    await new Promise((resolve, reject) => {
      const b = spawn('pnpm', ['--filter', '@jkos/kouros', 'build'], {
        cwd: REPO, stdio: 'inherit',
        env: { ...process.env, VITE_JKOS_AUTH_URL: authUrl },
      });
      b.on('exit', (c) => (c ? reject(new Error(`vite build exited ${c}`)) : resolve()));
    });
  }

  const backend = startBackend({ STATIC_DIR: path.join(REPO, 'apps/kouros/dist') });
  children.push(backend);

  const tracks = await waitForScan();
  const counts = seed({ dbPath: path.join(DATA, 'kouros.db') });
  console.log(`[seed] ${counts.history} plays · ${counts.playlists} playlists over ${counts.tracks} tracks`);

  if (vite) {
    const v = spawn('pnpm', ['--filter', '@jkos/kouros', 'dev', '--', '--port', String(VITE_PORT), '--strictPort'], {
      cwd: REPO, stdio: 'inherit',
      env: { ...process.env, VITE_JKOS_AUTH_URL: authUrl },
    });
    children.push(v);
  }

  const edge = await startEdge({
    port: EDGE_PORT,
    apiPort: PORT,
    appPort: vite ? VITE_PORT : PORT,
    // The one rule from infra/nginx/weave-proxy.conf that this app cannot run without.
    rewrites: [{ prefix: '/api/kouros/', to: '/api/' }],
  });

  console.log(
    `\n  KourOS → http://localhost:${edge.port}/   ` +
    `(${tracks} tracks, ${vite ? 'vite dev + HMR' : 'built'})\n`);

  const shutdown = () => {
    for (const c of children) c.kill('SIGTERM');
    Promise.all([stub.close(), edge.close()]).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/* ── dispatch ──────────────────────────────────────────────────────────────── */

switch (cmd) {
  case 'build': await build(); break;
  case 'serve': await run({ vite: false }); break;
  case 'dev':   await run({ vite: true }); break;
  case 'reindex': {
    const manifestPath = path.join(DATA, 'manifest.json');
    const dbPath = path.join(DATA, 'kouros.db');
    let tracks;
    if (fs.existsSync(manifestPath)) tracks = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).tracks;
    else if (fs.existsSync(dbPath)) tracks = manifestFromDb(dbPath);
    else { console.error(`Nothing to reindex — no ${manifestPath} and no ${dbPath}. Run \`build\` first.`); process.exit(1); }
    const idx = writeIndex({
      tracks, out: path.join(DATA, 'music-index.db'),
      coverage: args.coverage ? Number(args.coverage) : undefined,
      albumSpread: args['album-spread'] ? Number(args['album-spread']) : undefined,
      trackSpread: args['track-spread'] ? Number(args['track-spread']) : undefined,
    });
    console.log(
      `${idx.measured}/${idx.total} vectors · strangers ` +
      `${idx.strangerMean.toFixed(4)} ± ${idx.strangerSpread.toFixed(4)}\n` +
      `restart the backend (the space is cached for 5 minutes) to see it`);
    break;
  }
  case 'seed': {
    const counts = seed({ dbPath: path.join(DATA, 'kouros.db') });
    console.log(`${counts.history} plays · ${counts.playlists} playlists over ${counts.tracks} tracks`);
    break;
  }
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
