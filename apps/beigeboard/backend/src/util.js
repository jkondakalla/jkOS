'use strict';
// Small pure helpers shared across route modules (no DB, no env side effects).

/* Safe JSON for embedding in a <script> tag (the OAuth popup postMessage payload). */
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\//g, '\\u002f');
}

/* Local-timezone date/time formatting for calendar event normalization. */
function isoDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmt24(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* Generic 500 responder — log the detail, return a generic message so internal
   errors (SQLite text, stack hints) don't leak to clients. */
function fail(res, e, msg = 'Internal error') {
  console.error('[bb]', e?.stack || e?.message || e);
  return res.status(500).json({ error: msg });
}

/* Normalise a stored `items` row for the wire: completed → boolean, tags → array. */
function toRow(raw) {
  if (!raw) return null;
  let tags = [];
  if (raw.tags) { try { tags = JSON.parse(raw.tags); } catch { tags = []; } }
  return { ...raw, completed: raw.completed === 1, tags };
}

module.exports = { safeJson, isoDateStr, fmt24, fail, toRow };
