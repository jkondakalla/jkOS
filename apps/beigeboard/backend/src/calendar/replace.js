'use strict';
// The shared calendar writer: atomically swap one provider's items for a user, with
// the empty-upstream wipe guard (BUG-2). All three provider fetchers build validated
// rows then hand them here.
const { db, run, all, get } = require('../db');
const { cascadeDelete } = require('../items-store');

/* ── Atomic calendar replace — swap one provider's items in a single transaction.
   Rows are built + validated BEFORE this runs, so a mid-sync throw or a concurrent
   sync can never leave the calendar half-deleted (better-sqlite3 rolls back on a
   thrown INSERT, restoring the just-deleted rows). ──────────────────────────── */
const INSERT_ITEM_SQL = `INSERT INTO items (user_id,kind,scope,title,notes,source,due_date,scheduled_time,scheduled_end,location,end_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
const replaceCalendarSourceTx = db.transaction((source, userId, rows) => {
  /* ⚠️ CASCADE, never a bare DELETE (BB-12 / D10). `items.parent_id` carries NO
     foreign key — only `user_id` does — so SQLite cascades nothing here and
     cascadeDelete is the only thing that walks children.
     ⚠️ And this is the path that mattered most, which the audit did not say: it
     named the DISCONNECT route's raw DELETE, but a disconnect happens once. THIS
     runs on EVERY SYNC. A note or a checklist a user nested under a synced calendar
     event was orphaned — parented to a row that no longer existed, reachable by no
     view — every single time their calendar refreshed.
     Nested inside the surrounding transaction: better-sqlite3 turns a transaction
     function called within another into a SAVEPOINT, so the all-or-nothing property
     above is unchanged. */
  const mine = all('SELECT id FROM items WHERE source=? AND user_id=?', [source, userId]);
  for (const row of mine) cascadeDelete(row.id, userId);
  for (const r of rows) run(INSERT_ITEM_SQL, r);
});

/** Remove every item a provider owns for one user, children and all — the
 *  disconnect path. Same cascade rule as the replace above, and exported so the
 *  three disconnect routes cannot each re-hand-roll the DELETE they used to. */
const purgeCalendarSource = db.transaction((source, userId) => {
  const mine = all('SELECT id FROM items WHERE source=? AND user_id=?', [source, userId]);
  for (const row of mine) cascadeDelete(row.id, userId);
  return mine.length;
});

/* Swap a provider's events for one user (delete-all-then-reinsert). Guards a
   data-loss class the audit found: an upstream 200 carrying ZERO events (a provider
   hiccup, or an OAuth scope quietly narrowed) would otherwise DELETE every locally
   stored event for that provider with no error and no undo. When the incoming set is
   empty but the user still has rows for the source, SKIP the replace and report it —
   unless `force` overrides (the genuine "my calendar really is empty now" case, which
   the sync routes expose as ?force=1). Returns { synced, skipped, reason? }. */
function replaceCalendarSource(source, userId, rows, { force = false } = {}) {
  if (rows.length === 0 && !force) {
    const existing = get('SELECT COUNT(*) AS n FROM items WHERE source=? AND user_id=?', [source, userId]);
    if (existing && existing.n > 0) {
      console.warn(`[bb] calendar sync: empty upstream for '${source}' (user ${userId}) with ${existing.n} local row(s) — replace skipped (pass ?force=1 to override)`);
      return { synced: 0, skipped: true, reason: 'empty-upstream' };
    }
  }
  replaceCalendarSourceTx(source, userId, rows);
  return { synced: rows.length, skipped: false };
}

// ?force=1 lets an operator override the empty-upstream guard (a real "calendar is
// now empty" case). The sync-route body surfaces skipped/reason so the client can
// tell "0 events synced" from "guard tripped — nothing changed".
const wantsForce = (req) => req.query.force === '1' || req.query.force === 'true';
const syncBody = (result) => ({ ok: true, synced: result.synced, skipped: !!result.skipped, ...(result.reason ? { reason: result.reason } : {}) });

module.exports = { INSERT_ITEM_SQL, replaceCalendarSource, purgeCalendarSource, wantsForce, syncBody };
