#!/usr/bin/env node
'use strict';
// scripts/import-papyros.js — carry a user's audiobook life from PapyrOS into KourOS.
//
// PapyrOS folded into KourOS on 2026-09-23 (Jag: "The split was arbitrary"). KourOS now
// scans the same audiobook folder and serves the same books, but the PER-USER state —
// where each person is in each book, their bookmarks, their listening ledger — lives in
// papyros.db, and so does metadata a person chose by hand (a `matchBook` pick). This
// script copies that across, once, and is safe to run again.
//
//   node scripts/import-papyros.js --from <papyros.db snapshot> [--covers <dir>] \
//        [--db <kouros.db>] [--apply]
//
// Without --apply it is a DRY RUN: it reads both databases, prints exactly what it
// would do, and writes nothing. Run it dry, read it, then run it again with --apply.
//
// ⚠️ BOOKS ARE MATCHED BY FOLDER PATH, NOT BY ID. KourOS scans AUDIOBOOKS_DIR at boot, so
// by the time anyone runs this it has usually minted its OWN ids for the same books, in
// its own order — PapyrOS's book 12 is very likely not KourOS's book 12, and copying
// `progress.book_ref = 12` straight across would put a listener in the wrong book with
// no error anywhere. Both apps mount the library at the same container path
// (/audiobooks), so `books.path` is the identity the two catalogs share. A PapyrOS book
// KourOS has not scanned (an unmounted library, a scan still running) is inserted with
// its PapyrOS id when that id is free; the next scan then updates it in place, or
// prunes it if the folder is really gone.
//
// ⚠️ THE SOURCE MUST BE A SNAPSHOT, not the live file. A WAL database's newest writes
// live in its -wal sidecar (TRAPS.md: copy -wal/-shm together, or use VACUUM INTO), so
// reading papyros.db alone can silently miss the last minutes of listening. This
// refuses a source with a non-empty -wal beside it. Make one with:
//   sqlite3 /data/papyros.db "VACUUM INTO '/data/import/papyros.db'"
//
// Idempotent by construction — a second --apply changes nothing:
//   · books      matched by path; enriched metadata re-applied only where it differs.
//   · progress   one row per (user, book) — the NEWER of the two copies wins, so a
//                listen in KourOS after the deploy is never rolled back by an old one.
//   · bookmarks  skipped when an identical (user, book, position, title) exists.
//   · history    → `book_history`, skipped when (user, book, started_at) exists.
//   · covers     copied into <kouros data>/books/covers/ (overwrite-same is harmless).
// PapyrOS's `clubs`/`club_members` are NOT imported — no screen ever used them — and
// are counted in the report so their absence is visible, not silent. papyros.db itself
// is only ever opened read-only; nothing here deletes anything.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

/* ── argv ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--from' || a === '--covers' || a === '--db') {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

const USAGE = `usage: node scripts/import-papyros.js --from <papyros.db snapshot> [--covers <dir>] [--db <kouros.db>] [--apply]
  --from    a VACUUM INTO snapshot of PapyrOS's database (never the live file)
  --covers  PapyrOS's covers directory (default: <dir of --from>/covers)
  --db      KourOS's database (default: $DB_PATH, else ./kouros.db) — already migrated
  --apply   write; without it this is a dry run that changes nothing`;

/* ── checks ───────────────────────────────────────────────────────────────── */

const SOURCE_TABLES = ['books', 'progress', 'bookmarks', 'history'];
const TARGET_TABLES = ['books', 'progress', 'bookmarks', 'book_history'];
/** KourOS's migration that creates the last table this writes. */
const TARGET_MIGRATION = 11;

function tablesOf(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
}

function assertSnapshot(file) {
  const wal = `${file}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    throw new Error(
      `${file} has a non-empty -wal beside it — its newest writes are not in the file itself.\n`
      + `Snapshot it first:  sqlite3 <live papyros.db> "VACUUM INTO '${file}.snapshot'"  and pass that.`,
    );
  }
}

/* ── the plan ─────────────────────────────────────────────────────────────── */

/** Metadata a PERSON chose (matchBook, the enrichment sweep) — worth carrying over a
 *  fresh KourOS scan, which only knows the embedded tags. Title/series stay the
 *  scanner's: matchBook never wrote them either. */
const ENRICHED = new Set(['itunes', 'manual']);
const ENRICHED_COLUMNS = ['author', 'description', 'year', 'genres', 'metadata_source', 'ext_ref'];

function plan({ src, dst, coversFrom }) {
  const report = {
    books: { matched: 0, inserted: 0, enriched: 0 },
    covers: { copy: 0, missing: 0 },
    progress: { insert: 0, keptNewer: 0, unmapped: 0 },
    bookmarks: { insert: 0, duplicate: 0, unmapped: 0 },
    history: { insert: 0, duplicate: 0, unmapped: 0 },
    notImported: {},
  };
  const ops = { bookInserts: [], bookUpdates: [], covers: [], progress: [], bookmarks: [], history: [] };

  /* Books: source id → target id. */
  const idMap = new Map();
  const dstByPath = new Map(dst.prepare('SELECT * FROM books').all().map((b) => [b.path, b]));
  const dstIds = new Set([...dstByPath.values()].map((b) => b.id));
  const srcBooks = src.prepare('SELECT * FROM books ORDER BY id').all();
  for (const b of srcBooks) {
    const hit = dstByPath.get(b.path);
    if (hit) {
      idMap.set(b.id, hit.id);
      report.books.matched++;
      if (ENRICHED.has(b.metadata_source)) {
        const differs = ENRICHED_COLUMNS.some((c) => (b[c] ?? null) !== (hit[c] ?? null));
        if (differs) {
          report.books.enriched++;
          ops.bookUpdates.push({ id: hit.id, ...Object.fromEntries(ENRICHED_COLUMNS.map((c) => [c, b[c] ?? null])) });
        }
      }
      if (b.cover_path && (!hit.cover_path || ENRICHED.has(b.metadata_source))) ops.covers.push({ from: b.cover_path, to: hit.id });
    } else {
      // Keep PapyrOS's id when KourOS has not used it — then every ref stays literally
      // equal and a reader of either database sees the same number for the same book.
      const id = dstIds.has(b.id) ? null : b.id;
      if (id != null) dstIds.add(id);
      ops.bookInserts.push({ srcId: b.id, id, row: b });
      report.books.inserted++;
      if (b.cover_path) ops.covers.push({ from: b.cover_path, to: null, srcId: b.id });
    }
  }

  for (const c of ops.covers) {
    const abs = path.join(coversFrom, path.basename(c.from));
    if (fs.existsSync(abs)) { c.abs = abs; report.covers.copy++; } else { c.abs = null; report.covers.missing++; }
  }
  ops.covers = ops.covers.filter((c) => c.abs);

  /* Per-user rows reference a SOURCE book id; they are resolved to target ids at apply
     time (an inserted book's id may only exist then). `mapped()` answers whether a
     source book will have a target at all — every source book does, by the loop above. */
  const known = new Set(srcBooks.map((b) => b.id));
  const mapped = (ref) => known.has(Number(ref));

  const dstProgress = new Map(dst.prepare('SELECT user_id, book_ref, updated_at FROM progress').all()
    .map((r) => [`${r.user_id}|${r.book_ref}`, r]));
  for (const r of src.prepare('SELECT * FROM progress ORDER BY id').all()) {
    if (!mapped(r.book_ref)) { report.progress.unmapped++; continue; }
    const tgt = idMap.get(Number(r.book_ref));
    const existing = tgt != null ? dstProgress.get(`${r.user_id}|${tgt}`) : null;
    // String compare is correct here: both columns are canonical millisecond ISO.
    if (existing && String(existing.updated_at || '') >= String(r.updated_at || '')) { report.progress.keptNewer++; continue; }
    ops.progress.push(r);
    report.progress.insert++;
  }

  const bmKey = (u, b, pos, title) => `${u}|${b}|${pos}|${title ?? ''}`;
  const dstBookmarks = new Set(dst.prepare('SELECT user_id, book_ref, position, title FROM bookmarks').all()
    .map((r) => bmKey(r.user_id, r.book_ref, r.position, r.title)));
  for (const r of src.prepare('SELECT * FROM bookmarks ORDER BY id').all()) {
    if (!mapped(r.book_ref)) { report.bookmarks.unmapped++; continue; }
    const tgt = idMap.get(Number(r.book_ref));
    if (tgt != null && dstBookmarks.has(bmKey(r.user_id, String(tgt), r.position, r.title))) { report.bookmarks.duplicate++; continue; }
    ops.bookmarks.push(r);
    report.bookmarks.insert++;
  }

  const hKey = (u, b, at) => `${u}|${b}|${at}`;
  const dstHistory = new Set(dst.prepare('SELECT user_id, item_ref, started_at FROM book_history').all()
    .map((r) => hKey(r.user_id, r.item_ref, r.started_at)));
  for (const r of src.prepare('SELECT * FROM history ORDER BY id').all()) {
    if (!mapped(r.item_ref)) { report.history.unmapped++; continue; }
    const tgt = idMap.get(Number(r.item_ref));
    if (tgt != null && dstHistory.has(hKey(r.user_id, String(tgt), r.started_at))) { report.history.duplicate++; continue; }
    ops.history.push(r);
    report.history.insert++;
  }

  const srcTables = tablesOf(src);
  for (const t of ['clubs', 'club_members']) {
    if (srcTables.has(t)) report.notImported[t] = src.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  }

  return { report, ops, idMap };
}

/* ── apply ────────────────────────────────────────────────────────────────── */

const BOOK_COLUMNS = ['path', 'title', 'subtitle', 'author', 'narrator', 'series', 'series_seq', 'year', 'genres',
  'duration', 'files', 'chapters', 'cover_path', 'metadata_source', 'ext_ref', 'description', 'mtime', 'added_at', 'updated_at'];

function apply({ dst, ops, idMap, booksDataDir }) {
  const coversTo = path.join(booksDataDir, 'covers');
  fs.mkdirSync(coversTo, { recursive: true });

  const insertBook = dst.prepare(
    `INSERT INTO books (id, ${BOOK_COLUMNS.join(', ')}) VALUES (@id, ${BOOK_COLUMNS.map((c) => '@' + c).join(', ')})`,
  );
  const updateBook = dst.prepare(
    `UPDATE books SET ${ENRICHED_COLUMNS.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`,
  );
  const setCover = dst.prepare('UPDATE books SET cover_path = ? WHERE id = ?');
  // Explicit timestamps: the collections' stamp triggers only fill a NULL, so the
  // imported rows keep the moments they actually happened.
  const insertProgress = dst.prepare(`INSERT INTO progress (user_id, book_ref, position, duration, finished, last_played, created_at, updated_at)
    VALUES (@user_id, @book_ref, @position, @duration, @finished, @last_played, @created_at, @updated_at)`);
  const insertBookmark = dst.prepare(`INSERT INTO bookmarks (user_id, book_ref, position, title, note, created_at, updated_at)
    VALUES (@user_id, @book_ref, @position, @title, @note, @created_at, @updated_at)`);
  const insertHistory = dst.prepare(`INSERT INTO book_history (user_id, item_ref, started_at, ms_played, completed, created_at, updated_at)
    VALUES (@user_id, @item_ref, @started_at, @ms_played, @completed, @created_at, @updated_at)`);

  const run = dst.transaction(() => {
    for (const b of ops.bookInserts) {
      const row = Object.fromEntries(BOOK_COLUMNS.map((c) => [c, b.row[c] ?? null]));
      // cover_path is rewritten below once the file is in place; a PapyrOS path
      // points into PapyrOS's data dir, which KourOS does not mount.
      row.cover_path = null;
      const info = insertBook.run({ id: b.id, ...row });
      idMap.set(b.srcId, Number(info.lastInsertRowid));
    }
    for (const u of ops.bookUpdates) updateBook.run(u);

    for (const c of ops.covers) {
      const tgt = c.to != null ? c.to : idMap.get(c.srcId);
      const name = `${tgt}${path.extname(c.abs) || '.jpg'}`;
      fs.copyFileSync(c.abs, path.join(coversTo, name));
      setCover.run(`covers/${name}`, tgt);
    }

    const ref = (srcId) => String(idMap.get(Number(srcId)));
    for (const r of ops.progress) insertProgress.run({ ...pick(r, ['user_id', 'position', 'duration', 'finished', 'last_played', 'created_at', 'updated_at']), book_ref: ref(r.book_ref) });
    for (const r of ops.bookmarks) insertBookmark.run({ ...pick(r, ['user_id', 'position', 'title', 'note', 'created_at', 'updated_at']), book_ref: ref(r.book_ref) });
    for (const r of ops.history) insertHistory.run({ ...pick(r, ['user_id', 'started_at', 'ms_played', 'completed', 'created_at', 'updated_at']), item_ref: ref(r.item_ref) });
  });
  run();
}

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
}

/* ── main ─────────────────────────────────────────────────────────────────── */

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.from) {
    console.log(USAGE);
    return args.help ? 0 : 2;
  }
  const from = path.resolve(args.from);
  const dbPath = path.resolve(args.db || process.env.DB_PATH || path.join(__dirname, '..', 'kouros.db'));
  const coversFrom = path.resolve(args.covers || path.join(path.dirname(from), 'covers'));
  const booksDataDir = path.join(path.dirname(dbPath), 'books');   // server.js's BOOKS_DATA_DIR
  if (from === dbPath) throw new Error('--from and --db are the same file');
  if (!fs.existsSync(from)) throw new Error(`no such file: ${from}`);
  if (!fs.existsSync(dbPath)) throw new Error(`no such file: ${dbPath} — boot KourOS once so it creates and migrates its database`);
  assertSnapshot(from);

  const src = new Database(from, { readonly: true, fileMustExist: true });
  const dst = new Database(dbPath, { fileMustExist: true });
  dst.pragma('busy_timeout = 5000');   // the live server may hold the write lock briefly
  try {
    const st = tablesOf(src);
    const missingSrc = SOURCE_TABLES.filter((t) => !st.has(t));
    if (missingSrc.length) throw new Error(`${from} is not a PapyrOS database (missing ${missingSrc.join(', ')})`);
    const dt = tablesOf(dst);
    const missingDst = TARGET_TABLES.filter((t) => !dt.has(t));
    const migrated = dt.has('migrations') && dst.prepare('SELECT 1 FROM migrations WHERE id = ?').get(TARGET_MIGRATION);
    if (missingDst.length || !migrated) {
      throw new Error(`${dbPath} predates the audiobook fold (missing ${missingDst.join(', ') || `migration ${TARGET_MIGRATION}`}) — boot this KourOS build once first`);
    }

    const { report, ops, idMap } = plan({ src, dst, coversFrom });
    console.log(`${args.apply ? 'APPLYING' : 'DRY RUN (nothing written — pass --apply)'}: ${from} → ${dbPath}`);
    console.log(JSON.stringify(report, null, 2));
    if (args.apply) {
      apply({ dst, ops, idMap, booksDataDir });
      console.log('applied.');
    }
    return 0;
  } finally {
    src.close();
    dst.close();
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`import-papyros: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
