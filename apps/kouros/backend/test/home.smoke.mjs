// home.smoke.mjs — the Home rails that read a listener's OWN ledgers: "Recently played"
// (by CONTEXT — albums, playlists, artists, stations, books), "Continue listening"
// (unfinished audiobooks) and "Deep in". Boots the REAL server against the committed
// music fixture (2 albums, 3 tracks) AND the audiobook fixture (2 books), with a real
// RS256 keypair so two forged listeners prove the owner scoping.
//
// Why this exists: nothing asserted what /api/discover/home actually RETURNED for a
// listener with history, and so for as long as they existed "Deep in", the
// history-seeded Runs and the old track-level "Recently played" were EMPTY for every
// listener — `history.item_ref` is TEXT and the lookup Map is keyed by INTEGER track
// ids (src/discover/home.js's trackIndexOf). Proven: with that coercion removed, the
// "deep_in" assertions below fail.
//
// Asserts:
//   · recent — one tile per context, newest first, distinct; each kind resolves
//     (album title/artist, playlist NAME, station seed, artist, book); a listen with
//     NO context (search results) makes no tile; a book listen is its own tile.
//   · owner scoping — B naming A's playlist in a context gets no tile for it (a
//     label is never read off someone else's row); A's contexts never reach B.
//   · continue_books — A's unfinished book with a position, not the finished one;
//     B sees none.
//   · deep_in — non-empty, and led by the artist A played most.
//
//   node apps/kouros/backend/test/home.smoke.mjs

import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const MUSIC = join(__dirname, 'fixtures', 'library');
const BOOKS = join(__dirname, 'fixtures', 'books', 'library');

// Claimed in the suite-manifest port registry ('kouros:home.smoke') — the
// `port-registry` probe holds this literal to that claim.
const PORT = 3990;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVICE = 'kouros';
const ISSUER = 'jkos-auth';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// ffprobe is required to scan the fixtures; skip loudly without it, like library.smoke.
const hasFfprobe = await new Promise((r) => execFile('ffprobe', ['-version'], (err) => r(!err)));
if (!hasFfprobe) {
  console.warn('⚠ home.smoke SKIPPED — ffprobe not on PATH (install ffmpeg to run it)');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'kouros-home-'));
const DB_PATH = join(tmp, 'test.db');

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
  return `${input}.${b64url(cryptoSign('RSA-SHA256', Buffer.from(input), privateKey))}`;
}
const A = mkToken({ sub: 701, role: 'user', scope: ['kouros:write'] });
const B = mkToken({ sub: 702, role: 'user', scope: ['kouros:write'] });

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json };
}

const child = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: {
    ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH,
    MUSIC_DIR: MUSIC, AUDIOBOOKS_DIR: BOOKS,
    JKOS_AUTH_PUBLIC_KEY: publicKey, JKOS_AUTH_ISSUER: ISSUER,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let exited = null;
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
child.on('exit', (code) => { exited = code; });

async function waitFor(fn, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (exited !== null) return false;
    try { if (await fn()) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function done() {
  child.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
  if (fail) console.error(`\n── server log ──\n${serverLog}`);
  console.log(`\nhome.smoke: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

try {
  const up = await waitFor(async () => {
    const r = await fetch(BASE + '/health');
    if (!r.ok) return false;
    const body = await r.json();
    if (body.service !== SERVICE) throw new Error(`port ${PORT} answered as ${body.service}`);
    return true;
  });
  if (!up) throw new Error('server never became healthy');

  // Both boot scans are non-blocking — wait for all 3 tracks and both books.
  let tracks = [], books = [];
  ok(await waitFor(async () => {
    tracks = (await req('GET', '/api/tracks', undefined, A)).json || [];
    books = (await req('GET', '/api/books', undefined, A)).json || [];
    return tracks.length === 3 && books.length === 2;
  }), `fixtures scanned (tracks ${tracks.length}/3, books ${books.length}/2)`);

  const t = (title) => tracks.find((x) => x.title === title)?.id;
  const songOne = t('Song One'), songTwo = t('Song Two'), solo = t('Solo Track');
  const bookA = books.find((b) => b.title === 'Fixture Book A')?.id;
  const bookB = books.find((b) => b.title === 'Fixture Book B')?.id;

  const playlist = (await req('POST', '/api/playlists', { name: 'Road', track_refs: [solo, songOne] }, A)).json;
  const listen = (tok, item_ref, at, context) =>
    req('POST', '/api/history', { item_ref, started_at: at, ms_played: 60000, completed: false, ...(context ? { context } : {}) }, tok);

  const albumOne = `album/${encodeURIComponent('Artist One')}/${encodeURIComponent('Album One')}`;
  // A, oldest → newest. Two listens share one album context: one tile.
  await listen(A, songOne, '2026-09-20T10:00:00.000Z', albumOne);
  await listen(A, songTwo, '2026-09-20T10:05:00.000Z', albumOne);
  await listen(A, solo, '2026-09-20T10:10:00.000Z', `playlist/${playlist.id}`);
  await listen(A, songOne, '2026-09-20T10:15:00.000Z', `station/${solo}`);
  await listen(A, songTwo, '2026-09-20T10:20:00.000Z', null);   // search results — no place
  await listen(A, solo, '2026-09-20T10:25:00.000Z', `artist/${encodeURIComponent('Artist Two')}`);
  await req('POST', '/api/book_history', { item_ref: bookA, started_at: '2026-09-20T10:30:00.000Z', ms_played: 1000, completed: false }, A);
  await req('POST', '/api/progress', { book_ref: bookA, position: 1, duration: 2, finished: false, last_played: '2026-09-20T10:30:00.000Z' }, A);
  await req('POST', '/api/progress', { book_ref: bookB, position: 2, duration: 2, finished: true, last_played: '2026-09-20T09:00:00.000Z' }, A);

  // B names A's playlist: it must NOT resolve to A's name for B.
  await listen(B, solo, '2026-09-20T11:00:00.000Z', `album/${encodeURIComponent('Artist Two')}/${encodeURIComponent('Album Two')}`);
  await listen(B, songOne, '2026-09-20T11:05:00.000Z', `playlist/${playlist.id}`);

  // ── A's home ───────────────────────────────────────────────────────────────
  const homeA = (await req('GET', '/api/discover/home?hour=9', undefined, A)).json;
  const recentA = homeA?.recent || [];
  ok(JSON.stringify(recentA.map((r) => r.kind)) === JSON.stringify(['book', 'artist', 'station', 'playlist', 'album']),
    `recent: one tile per context, newest first (got ${JSON.stringify(recentA.map((r) => r.kind))})`);
  const byKind = Object.fromEntries(recentA.map((r) => [r.kind, r]));
  ok(byKind.album?.title === 'Album One' && byKind.album?.subtitle === 'Artist One' && byKind.album?.route === albumOne,
    `recent: the album tile names the record and routes to its page (got ${JSON.stringify(byKind.album)})`);
  ok(byKind.playlist?.title === 'Road' && byKind.playlist?.route === `playlist/${playlist.id}`,
    `recent: the playlist tile carries the playlist's NAME (got ${JSON.stringify(byKind.playlist)})`);
  ok(byKind.station?.seed === solo && byKind.station?.title === 'Solo Track',
    `recent: the station tile names its seed, for a one-tap replay (got ${JSON.stringify(byKind.station)})`);
  ok(byKind.artist?.title === 'Artist Two', `recent: the artist tile (got ${JSON.stringify(byKind.artist)})`);
  ok(byKind.book?.title === 'Fixture Book A' && byKind.book?.route === `book/${bookA}` && byKind.book?.cover?.kind !== 'track',
    `recent: a book listen is its own tile, routed to the book (got ${JSON.stringify(byKind.book)})`);
  ok(recentA.every((r) => typeof r.played_at === 'string'), 'recent: every tile says when');
  ok(byKind.album?.played_at === '2026-09-20T10:05:00.000Z',
    `recent: a context is as recent as its NEWEST listen (got ${byKind.album?.played_at})`);

  const cont = homeA?.continue_books || [];
  ok(cont.length === 1 && cont[0].id === bookA && cont[0].position === 1,
    `continue_books: the unfinished book with a position, not the finished one (got ${JSON.stringify(cont)})`);

  const deep = homeA?.deep_in || [];
  ok(deep.length > 0, `deep_in: NOT empty for a listener with history — the item_ref lookup holds (got ${JSON.stringify(deep)})`);
  ok(deep[0]?.artist === 'Artist One', `deep_in: led by the artist A played most (got ${deep[0]?.artist})`);

  // ── B's home ───────────────────────────────────────────────────────────────
  const homeB = (await req('GET', '/api/discover/home?hour=9', undefined, B)).json;
  const recentB = homeB?.recent || [];
  ok(JSON.stringify(recentB.map((r) => r.kind)) === JSON.stringify(['album']),
    `owner scoping: B's playlist/<A's id> context resolves to NOTHING, and none of A's tiles appear (got ${JSON.stringify(recentB)})`);
  ok(!recentB.some((r) => r.title === 'Road'), "owner scoping: A's playlist name never reaches B");
  ok((homeB?.continue_books || []).length === 0, 'continue_books: B has none');
} catch (e) {
  console.error('home.smoke crashed:', e);
  fail++;
} finally {
  done();
}
