'use strict';
// DB-touching item helpers shared by the items + import routes: parent-link
// validation (ownership + cycle guard), the transactional cascade delete, and the
// lazy first-run demo seed.
const { db, run, all, get } = require('./db');
const { nextDay } = require('./util');

function cascadeDeleteInner(id, userId, seen) {
  if (seen.has(id)) return;   // cycle guard: a self/cyclic parent_id must not recurse forever
  seen.add(id);
  const children = all('SELECT id FROM items WHERE parent_id = ? AND user_id = ?', [id, userId]);
  for (const c of children) cascadeDeleteInner(c.id, userId, seen);
  /* D12: sweep this row's dependency EDGES, both directions. `item_deps` carries no
     foreign key — deliberately, because `items.parent_id` carries none either and
     one table whose deletes behave differently from every other is worse than none
     — so nothing else would remove them. A left-behind edge is not inert: it makes
     a live item permanently blocked by a row that no longer exists, which is
     indistinguishable from "still waiting" and impossible to clear from the UI. */
  run('DELETE FROM item_deps WHERE user_id = ? AND (item_id = ? OR depends_on = ?)', [userId, id, id]);
  run('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId]);
}
const cascadeDelete = db.transaction((id, userId) => cascadeDeleteInner(id, userId, new Set()));

/* A client-supplied parent_id must reference an item the SAME user owns, and must
   not be the item itself — an unvalidated/self/cyclic parent links across users and
   (with the cycle guard above as backstop) is the recursive-cascade DoS vector. */
function validParentId(parentId, userId, selfId = null) {
  if (parentId == null || parentId === '') return true;   // clearing / no parent
  const pid = parseInt(parentId, 10);
  if (isNaN(pid)) return false;
  if (selfId != null && pid === selfId) return false;
  if (!get('SELECT 1 FROM items WHERE id = ? AND user_id = ?', [pid, userId])) return false;
  // Reject an INDIRECT cycle: A→B then B→A each passes the direct self-check
  // above but loops the parent chain, which would hang the frontend tree walkers
  // (getDescendants/getAncestors). Walk up from the prospective parent — if we
  // reach selfId, this link closes a cycle. (selfId null = a brand-new item, not
  // in the tree yet, so no cycle is possible.) The hop cap is a backstop against
  // a pre-existing cyclic row so this check can't itself loop forever.
  if (selfId != null) {
    let cur = pid, hops = 0;
    while (cur != null) {
      if (cur === selfId) return false;
      if (++hops > 1000) return false;
      const row = get('SELECT parent_id FROM items WHERE id = ? AND user_id = ?', [cur, userId]);
      cur = row ? row.parent_id : null;
    }
  }
  return true;
}

/* ── Seed defaults (lazy, on first item load per user) ─────────────────── */
/* One example goal shaped by the Breakdown Method: a defined finish line,
   ordered checkpoints, and the first actions already committed to days.
 *
 * ⚠️ `today` is a REQUIRED argument, not a `new Date()` read (BB-10 / D5). This
 * used to compute the seed dates from `toISOString()` — the UTC day — so the very
 * first thing every user west of Greenwich saw, for the whole evening of their
 * first session, was a task dated tomorrow labelled "today". The caller passes
 * `callerDay(req)`; the year for the target date comes from that same string
 * rather than from `getFullYear()`, so all three dates agree on which day it is.
 *
 * @param {string} today the caller's local day, YYYY-MM-DD */
async function seedDefaults(userId, today) {
  const todayStr    = today;
  const tomorrowStr = nextDay(today);
  const targetStr   = `${today.slice(0, 4)}-12-31`;

  const ins = (data) => {
    const cols = Object.keys(data).join(', ');
    const phs  = Object.keys(data).map(() => '?').join(', ');
    const r = run(`INSERT INTO items (${cols}) VALUES (${phs})`, Object.values(data));
    return r.lastInsertRowid;
  };

  const g = ins({
    user_id: userId, kind: 'goal', scope: 'year', status: 'active',
    title: 'Build something meaningful',
    done_means: 'A working project I can show someone, live and usable',
    target_date: targetStr, accent: '#B85C3A', source: 'bb',
  });
  const m1 = ins({ user_id: userId, kind:'milestone', parent_id: g, position: 0, title: 'Decide what to build',     accent: '#B85C3A', source: 'bb' });
  ins({ user_id: userId, kind:'milestone', parent_id: g, position: 1, title: 'A rough working prototype', accent: '#B85C3A', source: 'bb' });
  ins({ user_id: userId, kind:'milestone', parent_id: g, position: 2, title: 'Polished and shared',       accent: '#B85C3A', source: 'bb' });
  ins({ user_id: userId, kind:'task', scope:'day', parent_id: m1, title: 'Write down three project ideas',           accent: '#B85C3A', due_date: todayStr,    source: 'bb' });
  ins({ user_id: userId, kind:'task', scope:'day', parent_id: m1, title: 'Pick one and sketch its single core feature', accent: '#B85C3A', due_date: tomorrowStr, source: 'bb' });
}

module.exports = { cascadeDelete, validParentId, seedDefaults };
