// Declared column invariants — the schema's own promises, held against the schema
// (RESET Stage E item 3).
//
// WHY THIS EXISTS
//
// `item-fields.js` is the one source BeigeBoard's whole items schema derives from —
// the wire shape, the writable column set, the import cleaner tables, the enums. It
// could describe every column's TYPE and nothing about its RULES. Three properties
// the schema genuinely has lived nowhere a program could read them:
//
//   writeOnce      `started_at` is protected by a TRIGGER (migration 14) because the
//                  data is unrecoverable once overwritten — "when the session started"
//                  silently becoming "when it was last touched", with nothing
//                  downstream able to detect it. That rule lived in a migration body.
//   serverManaged  a column the server owns and refuses from a caller. Derived from
//                  `client: false`, which the field list already had — so the job here
//                  is to prove the derivation actually reaches the write door.
//   indexed        `parent_id` carries every tree walk and `ext_ref` carries routine
//                  identity. Both were full table scans until somebody measured, and
//                  nothing would have said so.
//
// ⚠️ A DECLARATION NOTHING CHECKS IS PROSE. So this does not read the migration files
// or grep for CREATE INDEX — it BOOTS THE REAL DATABASE, runs every migration, and
// interrogates `sqlite_master` and the live write path. A schema is what the engine
// ended up with, not what a migration meant to do.
//
// Run:  node test/columns.mjs      (wired as `pnpm check:columns`, folded into
//                                   `pnpm test:contracts`)
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(join(root, 'apps/beigeboard/backend/package.json'));

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const tmp = mkdtempSync(join(tmpdir(), 'jkos-columns-'));
process.env.DB_PATH = join(tmp, 'test.db');
process.env.NODE_ENV = '';

const { ITEM_FIELDS } = require(resolve(root, 'apps/beigeboard/backend/src/item-fields.js'));
const { db } = require(resolve(root, 'apps/beigeboard/backend/src/db.js'));
const { ITEM_COLUMNS } = require(resolve(root, 'apps/beigeboard/backend/src/schema.js'));

try {
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name='items'").all();
  const indexSql = objects.filter((o) => o.type === 'index' && o.sql).map((o) => o.sql);
  const triggerSql = objects.filter((o) => o.type === 'trigger' && o.sql).map((o) => o.sql);
  const columns = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);

  // ── 0. the declaration and the table agree on what columns exist ───────────
  {
    const declared = ITEM_FIELDS.map((f) => f.name);
    const missing = declared.filter((n) => !columns.includes(n));
    const undeclared = columns.filter((n) => !declared.includes(n));
    check(!missing.length, `every declared field is a real column${missing.length ? ` — MISSING: ${missing.join(', ')}` : ` (${declared.length})`}`);
    /* An undeclared column is invisible to ITEM_SHAPE, so a peer reading the dataset
       never learns it exists — the same class as an undeclared route. */
    check(!undeclared.length, `every real column is declared${undeclared.length ? ` — UNDECLARED: ${undeclared.join(', ')}` : ''}`);
  }

  // ── 1. indexed ⇒ an index actually exists ──────────────────────────────────
  {
    const want = ITEM_FIELDS.filter((f) => f.indexed).map((f) => f.name);
    const missing = want.filter((name) => !indexSql.some((sql) => new RegExp(`\\(\\s*${name}\\b|,\\s*${name}\\b`).test(sql)));
    if (missing.length) {
      fail(`declared \`indexed\` with no index in the database: ${missing.join(', ')}`);
      console.error(`      indexes present: ${indexSql.length}`);
    } else {
      ok(`every \`indexed\` column has a real index (${want.join(', ')})`);
    }
  }

  // ── 2. writeOnce ⇒ a TRIGGER enforces it, and it actually holds ────────────
  {
    for (const f of ITEM_FIELDS.filter((x) => x.writeOnce)) {
      /* ⚠️ Matched on "an UPDATE trigger that names this column", not on a
         particular TIMING. The live guard is AFTER UPDATE + a restoring write rather
         than BEFORE UPDATE + a rejection — both are correct, and asserting the shape
         I assumed would have failed against a schema that was working. What matters
         is that the rule lives at the TABLE, which the behavioural check below
         proves outright by writing through the raw database, past every route. */
      const guarded = triggerSql.some((sql) => new RegExp(`\\b${f.name}\\b`).test(sql) && /\bUPDATE\s+ON\b/i.test(sql));
      check(guarded, `\`writeOnce\` ${f.name} is guarded by a trigger, not by a route (an import path would walk past a route check)`);

      /* ⚠️ AND IT IS EXERCISED, not merely present. A trigger that exists but whose
         WHEN clause never matches looks identical from sqlite_master, and that is
         precisely the failure a declaration is supposed to make impossible. */
      const id = db.prepare("INSERT INTO items (user_id, kind, title) VALUES (9911, 'task', 'writeonce probe')").run().lastInsertRowid;
      db.prepare(`UPDATE items SET ${f.name} = ? WHERE id = ?`).run('2026-08-26T10:00:00.000Z', id);
      db.prepare(`UPDATE items SET ${f.name} = ?, title = ? WHERE id = ?`).run('2026-08-26T23:59:00.000Z', 'renamed', id);
      const row = db.prepare(`SELECT ${f.name} AS v, title FROM items WHERE id = ?`).get(id);
      check(row.v === '2026-08-26T10:00:00.000Z',
        `…and it HOLDS: a second write to ${f.name} is refused (got ${row.v})`);
      check(row.title === 'renamed',
        '…while the rest of that same UPDATE still applies (the guard is on the column, not the statement)');
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
    }
  }

  // ── 3. serverManaged ⇒ refused at the write door ───────────────────────────
  {
    /* Derived from `client: false` rather than declared twice — two flags that must
       agree are two flags that can disagree. What is worth proving is that the
       derivation reaches the door: ITEM_COLUMNS is what POST/PATCH will accept. */
    const server = ITEM_FIELDS.filter((f) => !f.client).map((f) => f.name);
    const leaked = server.filter((n) => ITEM_COLUMNS.has(n));
    if (leaked.length) {
      fail(`server-managed column(s) a client can write: ${leaked.join(', ')} — a caller could date its own history`);
    } else {
      ok(`every server-managed column is refused at the write door (${server.join(', ')})`);
    }
    const clientCols = ITEM_FIELDS.filter((f) => f.client).map((f) => f.name);
    const absent = clientCols.filter((n) => !ITEM_COLUMNS.has(n));
    check(!absent.length, `every client-writable column is actually accepted${absent.length ? ` — MISSING: ${absent.join(', ')}` : ` (${clientCols.length})`}`);
  }

  // ── 4. the edge table's invariants (D12) ───────────────────────────────────
  {
    const deps = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name='item_deps'").all();
    const idx = deps.filter((o) => o.type === 'index');
    /* Both directions are read — "what blocks this" and "what does finishing this
       unblock" — so both need an index, and a UNIQUE constraint is what stops the
       same edge being asserted twice. */
    check(idx.some((o) => /item_id/.test(o.sql || '') || /item_id/.test(o.name)),
      'item_deps is indexed for "what blocks this"');
    check(idx.some((o) => /depends_on/.test(o.sql || '') || /depends_on/.test(o.name)),
      'item_deps is indexed for "what does finishing this unblock"');
    const create = deps.find((o) => o.type === 'table')?.sql || '';
    check(/UNIQUE\s*\(\s*user_id\s*,\s*item_id\s*,\s*depends_on\s*\)/i.test(create),
      'item_deps refuses a duplicate edge at the table (UNIQUE), not merely at the route');
  }
} catch (e) {
  console.error('columns check crashed:', e);
  failed++;
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failed) {
  console.error(`\n✗ column invariants: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ column invariants: what item-fields declares, the database enforces');
