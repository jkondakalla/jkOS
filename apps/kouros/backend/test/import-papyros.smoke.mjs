// import-papyros.smoke.mjs — scripts/import-papyros.js, end to end, against the two
// databases it actually meets in a deploy.
//
// The SOURCE is built from the frozen PapyrOS schema (fixtures/books/papyros-schema.sql
// — dumped from a database PapyrOS's own server.js migrated, not hand-typed). The
// TARGET is a real KourOS database: this boots the real server.js once so its own
// migrations create it, stops it, then plants what a KourOS boot scan leaves behind —
// the SAME books under DIFFERENT ids, in a different order. That is the case the whole
// script exists for: KourOS scans AUDIOBOOKS_DIR before anyone runs an import, so
// PapyrOS's book 1 is not KourOS's book 1, and a naive id copy would silently put a
// listener in the wrong book.
//
// Asserts: a dry run writes nothing; a live (-wal) source is refused with the VACUUM
// INTO recipe; --apply maps by PATH (matched books get enriched metadata + the chosen
// cover, an unmatched book is inserted — keeping its id when free, a fresh one when
// taken); per-user progress/bookmarks/history follow their book to its NEW id; a
// newer KourOS progress row is never rolled back by an older PapyrOS one; clubs are
// reported, not imported; a second --apply is a no-op.
//
//   node apps/kouros/backend/test/import-papyros.smoke.mjs

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const SCRIPT = join(BACKEND, 'scripts', 'import-papyros.js');
const SCHEMA = join(__dirname, 'fixtures', 'books', 'papyros-schema.sql');

// Claimed in the suite-manifest port registry ('kouros:import-papyros.smoke') — the
// `port-registry` probe holds this literal to that claim. The server only boots long
// enough to migrate the target database.
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVICE = 'kouros';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

const tmp = mkdtempSync(join(tmpdir(), 'kouros-import-'));
const TARGET = join(tmp, 'kouros', 'kouros.db');
const SOURCE_DIR = join(tmp, 'papyros-data');
const SOURCE = join(SOURCE_DIR, 'papyros.db');
mkdirSync(join(tmp, 'kouros'), { recursive: true });
mkdirSync(join(SOURCE_DIR, 'covers'), { recursive: true });

/* ── The source: a PapyrOS database with a little of everything ─────────────────── */
{
  const src = new Database(SOURCE);
  src.exec(readFileSync(SCHEMA, 'utf8'));
  const mig = src.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)');
  for (let i = 1; i <= 12; i++) mig.run(i, `m${i}`);
  const book = src.prepare(`INSERT INTO books (id, path, title, author, genres, duration, files, chapters,
      cover_path, metadata_source, ext_ref, description, updated_at)
    VALUES (@id, @path, @title, @author, @genres, 3600, '[]', '[]', @cover_path, @metadata_source, @ext_ref, @description, '2026-08-01T00:00:00.000Z')`);
  // 1: a person matched this one on iTunes — its metadata and cover are worth keeping.
  book.run({ id: 1, path: '/audiobooks/Alpha', title: 'Alpha', author: 'Real Author', genres: '["Fantasy"]',
    cover_path: 'covers/1.jpg', metadata_source: 'itunes', ext_ref: 'itunes:555', description: 'A blurb.' });
  // 2: plain embedded tags — KourOS's own scan already knows everything this does.
  book.run({ id: 2, path: '/audiobooks/Beta', title: 'Beta', author: 'Tag Author', genres: '[]',
    cover_path: null, metadata_source: 'embedded', ext_ref: null, description: null });
  // 3: a book KourOS has NOT scanned (and whose id KourOS has already used).
  book.run({ id: 3, path: '/audiobooks/Gamma', title: 'Gamma', author: 'G', genres: '[]',
    cover_path: 'covers/3.jpg', metadata_source: 'embedded', ext_ref: null, description: null });
  writeFileSync(join(SOURCE_DIR, 'covers', '1.jpg'), 'JPEG-ALPHA');
  writeFileSync(join(SOURCE_DIR, 'covers', '3.jpg'), 'JPEG-GAMMA');

  const progress = src.prepare(`INSERT INTO progress (user_id, book_ref, position, duration, finished, last_played, created_at, updated_at)
    VALUES (?, ?, ?, 3600, 0, ?, ?, ?)`);
  progress.run(7, '1', 100, '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  progress.run(7, '2', 50, '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  progress.run(8, '3', 10, '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z');
  src.prepare(`INSERT INTO bookmarks (user_id, book_ref, position, title, created_at, updated_at)
    VALUES (7, '1', 30, 'Chapter two', '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z')`).run();
  const hist = src.prepare(`INSERT INTO history (user_id, item_ref, started_at, ms_played, completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)`);
  hist.run(7, '1', '2026-08-30T10:00:00.000Z', 60000, '2026-08-30T10:01:00.000Z', '2026-08-30T10:01:00.000Z');
  hist.run(8, '3', '2026-08-31T10:00:00.000Z', 30000, '2026-08-31T10:01:00.000Z', '2026-08-31T10:01:00.000Z');
  src.prepare(`INSERT INTO clubs (user_id, name) VALUES (7, 'Never used')`).run();
  src.close();
}

/* ── The target: a KourOS database its own server migrated ─────────────────────── */
async function migrateTarget() {
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env, NODE_ENV: '', PORT: String(PORT), DB_PATH: TARGET,
      MUSIC_DIR: join(tmp, 'no-music'), AUDIOBOOKS_DIR: join(tmp, 'no-books'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  let exited = false;
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  child.on('exit', () => { exited = true; });
  const deadline = Date.now() + 15000;
  let up = false;
  while (!up && !exited && Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.service !== SERVICE) throw new Error(`/health on :${PORT} is ${JSON.stringify(body.service)}, not ${SERVICE} — another server owns this port`);
        up = true;
      }
    } catch (e) { if (String(e.message).includes('another server')) throw e; }
    if (!up) await new Promise((r) => setTimeout(r, 150));
  }
  child.kill('SIGTERM');
  await new Promise((r) => (exited ? r() : child.on('exit', r)));
  if (!up) throw new Error(`KourOS never became healthy:\n${log}`);
}

const run = (...args) => spawnSync('node', [SCRIPT, ...args], { cwd: BACKEND, encoding: 'utf8' });
const reportOf = (out) => JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
const count = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

try {
  await migrateTarget();

  // What a KourOS boot scan leaves: Beta and Alpha, SWAPPED relative to PapyrOS, and a
  // book of KourOS's own sitting on id 3 — PapyrOS's Gamma cannot keep its id.
  {
    const dst = new Database(TARGET);
    const b = dst.prepare(`INSERT INTO books (id, path, title, author, genres, duration, files, chapters, metadata_source)
      VALUES (?, ?, ?, ?, '[]', 3600, '[]', '[]', 'embedded')`);
    b.run(1, '/audiobooks/Beta', 'Beta', 'Tag Author');
    b.run(2, '/audiobooks/Alpha', 'Alpha', 'Tag Author');
    b.run(3, '/audiobooks/Delta', 'Delta', 'D');
    // A listen in KourOS AFTER the switch — newer than PapyrOS's copy, so it must win.
    dst.prepare(`INSERT INTO progress (user_id, book_ref, position, finished, created_at, updated_at)
      VALUES (7, '1', 999, 0, '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:00.000Z')`).run();
    dst.close();
  }

  // ── 1. a live source is refused ─────────────────────────────────────────────────
  {
    const live = join(tmp, 'live.db');
    copyFileSync(SOURCE, live);
    writeFileSync(`${live}-wal`, 'not empty');
    const r = run('--from', live, '--db', TARGET);
    ok(r.status === 1, `live source: exit 1 (got ${r.status})`);
    ok(/VACUUM INTO/.test(r.stderr), `live source: the refusal carries the snapshot recipe (got ${JSON.stringify(r.stderr.trim())})`);
  }

  // ── 2. a dry run reads everything and writes nothing ────────────────────────────
  {
    const before = new Database(TARGET, { readonly: true });
    const snap = ['books', 'progress', 'bookmarks', 'book_history'].map((t) => count(before, t));
    before.close();
    const r = run('--from', SOURCE, '--db', TARGET);
    ok(r.status === 0, `dry run: exit 0 (got ${r.status}: ${r.stderr})`);
    ok(/DRY RUN/.test(r.stdout), 'dry run: says it is one');
    const rep = reportOf(r.stdout);
    ok(rep.books.matched === 2 && rep.books.inserted === 1, `dry run: 2 matched by path, 1 to insert (got ${JSON.stringify(rep.books)})`);
    ok(rep.progress.insert === 2 && rep.progress.keptNewer === 1, `dry run: 2 progress rows to import, 1 newer KourOS row kept (got ${JSON.stringify(rep.progress)})`);
    ok(rep.notImported.clubs === 1, `dry run: the club is reported as not imported (got ${JSON.stringify(rep.notImported)})`);
    const after = new Database(TARGET, { readonly: true });
    const snap2 = ['books', 'progress', 'bookmarks', 'book_history'].map((t) => count(after, t));
    after.close();
    ok(JSON.stringify(snap) === JSON.stringify(snap2), `dry run: no row counts changed (${snap} → ${snap2})`);
    ok(!existsSync(join(tmp, 'kouros', 'books', 'covers', '2.jpg')), 'dry run: no cover copied');
  }

  // ── 3. --apply ──────────────────────────────────────────────────────────────────
  {
    const r = run('--from', SOURCE, '--db', TARGET, '--apply');
    ok(r.status === 0, `apply: exit 0 (got ${r.status}: ${r.stderr})`);
    const dst = new Database(TARGET, { readonly: true });
    const byPath = (p) => dst.prepare('SELECT * FROM books WHERE path = ?').get(p);

    const alpha = byPath('/audiobooks/Alpha');
    ok(alpha.id === 2, `Alpha keeps KourOS's id 2 (got ${alpha.id})`);
    ok(alpha.author === 'Real Author' && alpha.metadata_source === 'itunes' && alpha.ext_ref === 'itunes:555'
      && alpha.description === 'A blurb.', `Alpha: the iTunes match a person chose came across (got ${alpha.author}/${alpha.metadata_source}/${alpha.ext_ref})`);
    ok(alpha.title === 'Alpha', 'Alpha: the title stays the scanner\'s');
    ok(alpha.cover_path === 'covers/2.jpg', `Alpha: cover renamed to KourOS's id (got ${alpha.cover_path})`);
    const alphaCover = join(tmp, 'kouros', 'books', 'covers', '2.jpg');
    ok(existsSync(alphaCover) && readFileSync(alphaCover, 'utf8') === 'JPEG-ALPHA', 'Alpha: the cover bytes landed in <data>/books/covers/');

    const beta = byPath('/audiobooks/Beta');
    ok(beta.id === 1 && beta.author === 'Tag Author' && beta.metadata_source === 'embedded',
      `Beta: embedded-only, left exactly as KourOS scanned it (got ${beta.id}/${beta.author}/${beta.metadata_source})`);

    const gamma = byPath('/audiobooks/Gamma');
    ok(!!gamma && gamma.id !== 3, `Gamma: inserted, and NOT onto id 3, which KourOS already used (got ${gamma?.id})`);
    ok(gamma?.cover_path === `covers/${gamma?.id}.jpg`, `Gamma: cover follows its new id (got ${gamma?.cover_path})`);
    ok(byPath('/audiobooks/Delta').title === 'Delta', 'Delta: KourOS\'s own book untouched');

    const prog = (u, b) => dst.prepare('SELECT * FROM progress WHERE user_id = ? AND book_ref = ?').get(u, String(b));
    ok(prog(7, alpha.id)?.position === 100, `progress follows Alpha to its NEW id ${alpha.id} (got ${JSON.stringify(prog(7, alpha.id))})`);
    ok(prog(7, beta.id)?.position === 999, `progress: KourOS's newer Beta row is NOT rolled back to PapyrOS's 50 (got ${prog(7, beta.id)?.position})`);
    ok(prog(8, gamma.id)?.position === 10, 'progress follows Gamma to its fresh id');
    ok(prog(7, alpha.id)?.updated_at === '2026-09-01T10:00:00.000Z', 'progress keeps the moment it was written, not the import time');
    ok(count(dst, 'progress') === 3, `progress: exactly one row per (user, book) (got ${count(dst, 'progress')})`);

    const bm = dst.prepare('SELECT * FROM bookmarks').all();
    ok(bm.length === 1 && bm[0].book_ref === String(alpha.id) && bm[0].position === 30 && bm[0].title === 'Chapter two',
      `bookmarks follow their book (got ${JSON.stringify(bm)})`);

    const bh = dst.prepare('SELECT * FROM book_history ORDER BY started_at').all();
    ok(bh.length === 2 && bh[0].item_ref === String(alpha.id) && bh[1].item_ref === String(gamma.id),
      `history → book_history, refs remapped (got ${JSON.stringify(bh.map((h) => h.item_ref))})`);
    ok(bh[0].started_at === '2026-08-30T10:00:00.000Z' && bh[0].ms_played === 60000, 'history: the listen keeps its own start and length');
    ok(!dst.prepare("SELECT 1 FROM sqlite_master WHERE name = 'clubs'").get(), 'clubs: no table appears in KourOS');
    dst.close();

    const srcCheck = new Database(SOURCE, { readonly: true });
    ok(count(srcCheck, 'progress') === 3 && count(srcCheck, 'books') === 3, 'the PapyrOS source is untouched');
    srcCheck.close();
  }

  // ── 4. a second --apply changes nothing ─────────────────────────────────────────
  {
    const snap = () => {
      const d = new Database(TARGET, { readonly: true });
      const s = ['books', 'progress', 'bookmarks', 'book_history'].map((t) => count(d, t)).join(',');
      d.close();
      return s;
    };
    const before = snap();
    const r = run('--from', SOURCE, '--db', TARGET, '--apply');
    ok(r.status === 0, `re-apply: exit 0 (got ${r.status})`);
    const rep = reportOf(r.stdout);
    ok(rep.books.inserted === 0 && rep.books.enriched === 0, `re-apply: no book work left (got ${JSON.stringify(rep.books)})`);
    ok(rep.progress.insert === 0 && rep.bookmarks.insert === 0 && rep.history.insert === 0,
      `re-apply: no per-user rows left to import (got ${JSON.stringify({ p: rep.progress, b: rep.bookmarks, h: rep.history })})`);
    ok(snap() === before, `re-apply: row counts identical (${before} → ${snap()})`);
  }
} catch (e) {
  console.error('import-papyros.smoke crashed:', e);
  fail++;
} finally {
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\nimport-papyros.smoke: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
