'use strict';
// deps.js — the dependency graph over `items` (D12).
//
// ⭐ THE ONE PLACE A COLUMN WOULD NOT DO. This schema could already express
// DECOMPOSITION (`parent_id` — B is part of A) and ORDERING (`position` — B comes
// after A on a list). It could not express BLOCKING — "B cannot start until A ships"
// — which is the question a planner exists to answer, and the difference is not
// cosmetic: decomposition is a tree, blocking is a DAG, and a row can be blocked by
// several things in different branches at once. Many-to-many between rows of the
// same table is an edge table and could never have been a column.
//
// Kept out of routes/items.js because it is a graph with graph rules — a cycle
// guard, a reachability walk — and none of that belongs in a CRUD handler.

const { db, run, all, get } = require('./db');

/** Would adding `item depends_on dep` close a cycle?
 *
 *  ⚠️ A dependency cycle is not a cosmetic problem: "what is ready to start" is a
 *  walk over these edges, and a cycle makes it either loop forever or, worse,
 *  quietly report that nothing in the ring can ever start — a deadlock the user
 *  cannot see because each individual edge looks sensible. Refused at the door,
 *  which is the only place it can be refused cheaply.
 *
 *  Walks FORWARD from `dep`: if `item` is reachable from it, the new edge closes a
 *  ring. Bounded by a visited set, so a cycle already in the table (a hand-edited
 *  row) cannot hang this. */
function wouldCycle(userId, itemId, dependsOn) {
  if (itemId === dependsOn) return true;
  const seen = new Set();
  const stack = [dependsOn];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === itemId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const row of all('SELECT depends_on FROM item_deps WHERE user_id = ? AND item_id = ?', [userId, cur])) {
      stack.push(row.depends_on);
    }
  }
  return false;
}

const owns = (userId, id) => !!get('SELECT 1 FROM items WHERE id = ? AND user_id = ?', [id, userId]);

/** Add one edge. Returns `{ ok }` or `{ ok:false, error, code }`. */
const addDep = db.transaction((userId, itemId, dependsOn) => {
  if (!Number.isInteger(itemId) || !Number.isInteger(dependsOn)) {
    return { ok: false, code: 'VALIDATION', error: 'item_id and depends_on must be integers' };
  }
  if (itemId === dependsOn) return { ok: false, code: 'CYCLE', error: 'an item cannot depend on itself' };
  // Ownership on BOTH ends, checked here rather than trusted: an edge is the one
  // shape in this schema that names a second row, and an unchecked one would let a
  // caller assert a relationship against someone else's item.
  if (!owns(userId, itemId) || !owns(userId, dependsOn)) {
    return { ok: false, code: 'NOT_FOUND', error: 'both items must exist and belong to you' };
  }
  if (wouldCycle(userId, itemId, dependsOn)) {
    return { ok: false, code: 'CYCLE', error: 'that would make a dependency loop — nothing in the ring could ever start' };
  }
  run('INSERT OR IGNORE INTO item_deps (user_id, item_id, depends_on) VALUES (?, ?, ?)', [userId, itemId, dependsOn]);
  return { ok: true };
});

function removeDep(userId, itemId, dependsOn) {
  const r = run('DELETE FROM item_deps WHERE user_id = ? AND item_id = ? AND depends_on = ?', [userId, itemId, dependsOn]);
  return { ok: true, removed: r.changes };
}

/** What blocks this item, and what finishing it unblocks. Both directions, because
 *  both are questions a person actually asks — "why can't I start this" and "what
 *  does doing this free up", the second being the reason to do it first. */
function depsOf(userId, itemId) {
  const blockedBy = all(
    `SELECT i.id, i.title, i.kind, i.completed, i.due_date
       FROM item_deps d JOIN items i ON i.id = d.depends_on AND i.user_id = d.user_id
      WHERE d.user_id = ? AND d.item_id = ?
      ORDER BY i.id ASC`,
    [userId, itemId],
  );
  const blocks = all(
    `SELECT i.id, i.title, i.kind, i.completed, i.due_date
       FROM item_deps d JOIN items i ON i.id = d.item_id AND i.user_id = d.user_id
      WHERE d.user_id = ? AND d.depends_on = ?
      ORDER BY i.id ASC`,
    [userId, itemId],
  );
  return {
    blocked_by: blockedBy.map((r) => ({ ...r, completed: r.completed === 1 })),
    blocks: blocks.map((r) => ({ ...r, completed: r.completed === 1 })),
    /* The whole point, in one boolean: an item is BLOCKED while any of its
       dependencies is unfinished. Derived rather than stored — a stored flag would
       have to be maintained by every write path that can complete an item, and
       would be wrong the moment one of them forgot. */
    blocked: blockedBy.some((r) => r.completed !== 1),
  };
}

module.exports = { addDep, removeDep, depsOf, wouldCycle };
