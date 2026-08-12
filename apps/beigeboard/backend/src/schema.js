'use strict';
// Item validation surface — column allowlist, reserved sources, value coercion,
// and the import/direct-write field cleaners. Every column-level table here is
// DERIVED from the single per-column list in ./item-fields (ARCH-1), so the items
// and import routes (and the AI sanitiser) enforce exactly what discovery.js's
// ITEM_SHAPE declares — one source, no drift (the class behind BUG-1/3/7).
const { coerceWeaveColumn } = require('@jkos/weave/server');
const { ITEM_FIELDS } = require('./item-fields');

const fieldByName = (n) => ITEM_FIELDS.find((f) => f.name === n);
const importEnumSet = (n) => new Set(fieldByName(n).importEnum);

/* ── Allowed column names for items table — every client-writable column. ── */
/*    (id/user_id/created_at/updated_at are `client:false` → server-managed.)  */
const ITEM_COLUMNS = new Set(ITEM_FIELDS.filter((f) => f.client).map((f) => f.name));

/* Sources owned by calendar sync — a client that writes one of these directly would
   have its row silently DELETEd by the next replaceCalendarSource (delete-all-then-
   reinsert per provider). Import warns-and-defaults these to 'bb'; the direct
   POST/PATCH routes hard-reject them (a raw API caller should learn, not lose data). */
const RESERVED_SOURCE = new Set(['google', 'outlook', 'icloud']);

/* Value coercion for item writes (booleans → 0/1, `tags` → a JSON-array string)
   is the shared weave column rule now — see @jkos/weave/server coerceWeaveColumn,
   which also fixes the malformed-`[…` tags passthrough that used to make toRow's
   JSON.parse throw and silently drop every tag. Aliased so the write builders
   read unchanged. */
const coerceColumn = coerceWeaveColumn;

/* ── /import limits + alias vocabulary ─────────────────────────────────── */
const MAX_IMPORT_ITEMS = 500;
const MAX_IMPORT_DEPTH  = 8;

// Friendly synonyms → canonical item columns (structural keys handled separately).
const IMPORT_ALIASES = {
  name: 'title', type: 'kind',
  date: 'due_date', deadline: 'due_date', when: 'due_date',
  time: 'scheduled_time', start_time: 'scheduled_time', start: 'scheduled_time',
  end_time: 'scheduled_end', endtime: 'scheduled_end',
  description: 'notes', desc: 'notes', note: 'notes', body: 'notes', details: 'notes',
  color: 'accent', colour: 'accent',
  definition_of_done: 'done_means', done: 'done_means', success_criteria: 'done_means',
};
const IMPORT_STRUCT_KEYS = new Set(['children', 'kids', 'subtasks', 'ref', 'parent', 'parent_id']);
// Derived from item-fields: date/time columns by `shape`, kind/scope/status enums by `importEnum`.
const IMPORT_DATE_COLS   = new Set(ITEM_FIELDS.filter((f) => f.shape === 'date').map((f) => f.name));
const IMPORT_TIME_COLS   = new Set(ITEM_FIELDS.filter((f) => f.shape === 'time').map((f) => f.name));
const IMPORT_KIND_ENUM   = importEnumSet('kind');

// Real calendar dates only. A bare `^\d{4}-\d{2}-\d{2}$` would accept impossible
// dates (2026-13-45, 2026-02-30); those become `Invalid Date` and poison every
// view that parses them — and crash the AI endpoint's toISOString() with a 500.
// Round-trip through Date so a day/month that doesn't actually exist is rejected.
const looksLikeDate = (v) => {
  if (typeof v !== 'string') return false;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;   // rejects e.g. Feb 30
};
// HH:MM with real hour/minute ranges (rejects 25:00 / 12:99, which would render and
// string-sort as garbage downstream).
const looksLikeTime = (v) => {
  if (typeof v !== 'string') return false;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  return !!m && +m[1] <= 23 && +m[2] <= 59;
};
/* A routine's `cadence_days` — CSV of day offsets from the week start, "0,2,4"
   (0=Mon … 6=Sun; see item-fields.js). Validated at the door because this string
   DRIVES A LOOP: routines.js turns each entry into addDays(weekStart, n) and mints
   a task there. An out-of-range entry would mint an occurrence outside the week it
   claims to belong to, and a repeated one would mint the same day twice, so both
   are rejected rather than normalised. Empty is legal — a routine with a target
   count but no committed days is the "3× a week, any days" case, all float. */
const looksLikeCadenceDays = (v) => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s === '') return true;
  if (!/^[0-6](,[0-6])*$/.test(s)) return false;
  const parts = s.split(',');
  return new Set(parts).size === parts.length;   // no repeated day
};

/* The weekly target. Capped so a fat-fingered value can't ask the materializer for
   an unbounded number of float occurrences per week (the mint is horizon-bounded in
   time, but not in count — this is the count bound). 21 = three a day. */
const MAX_CADENCE_COUNT = 21;

const importChildren = (raw) => {
  // A NON-EMPTY child array only: an explicit `children: []` (common from an AI that
  // didn't break a leaf down) must read as a leaf → 'task', not as an empty goal.
  for (const k of ['children', 'kids', 'subtasks']) if (Array.isArray(raw[k]) && raw[k].length) return raw[k];
  return null;
};

/* ── Input hardening for /import ─────────────────────────────────────────────
   Untrusted JSON (often AI-generated) is cleaned field-by-field BEFORE it reaches
   the DB: every value is type-normalised, length-bounded, and the constrained
   columns are validated. Column NAMES are already allowlisted to ITEM_COLUMNS
   (so `__proto__`/`constructor`/unknown keys are dropped, not written — no
   prototype pollution, no arbitrary columns) and every value is bound, not
   interpolated (no SQL injection). This adds the value-level guards. */
// per-column max length for text/date/time values (every field carrying a `cap`)
const IMPORT_STR_CAP = Object.fromEntries(
  ITEM_FIELDS.filter((f) => f.cap != null).map((f) => [f.name, f.cap]),
);
const IMPORT_NUM_COLS        = new Set(ITEM_FIELDS.filter((f) => f.num).map((f) => f.name));
const IMPORT_SCOPE_ENUM      = importEnumSet('scope');
const IMPORT_STATUS_ENUM     = importEnumSet('status');
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const MAX_TAG_COUNT = 30, MAX_TAG_LEN = 60;

/* Clean ONE allowlisted field value; returns the cleaned value, or undefined to
   drop the field (a dropped scope/status falls through to its default later). */
function cleanImportField(col, v, path, warnings) {
  if (col === 'completed') return v === true || v === 1 || v === '1' || v === 'true';
  if (IMPORT_NUM_COLS.has(col)) {                       // numeric → bounded integer
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) { warnings.push(`${path}.${col}: not a number — ignored`); return undefined; }
    let i = Math.trunc(n);
    if (col === 'month') i = Math.min(12, Math.max(1, i));
    else i = Math.max(0, i);
    return i;
  }
  if (col === 'tags') {                                  // → cleaned array (coerced to JSON at insert)
    const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
    return arr.map(t => String(t).trim().slice(0, MAX_TAG_LEN)).filter(Boolean).slice(0, MAX_TAG_COUNT);
  }
  // everything else is text: stringify, cap, trim
  let s = v == null ? '' : String(v);
  const cap = IMPORT_STR_CAP[col] ?? 500;
  if (s.length > cap) { s = s.slice(0, cap); warnings.push(`${path}.${col}: truncated to ${cap} chars`); }
  s = s.trim();
  if (s === '') return undefined;
  // Zero-pad lenient dates/times (an AI often emits 2026-7-1 / 9:05) into the
  // canonical YYYY-MM-DD / HH:MM the rest of the suite stores and string-sorts on.
  // Real-range validity is then enforced by the looksLikeDate/looksLikeTime pass in
  // planImport, which runs on this normalised output.
  if (IMPORT_DATE_COLS.has(col)) {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
  }
  if (IMPORT_TIME_COLS.has(col)) {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
  }
  if (col === 'kind') return s.toLowerCase();            // enum-checked by the caller
  if (col === 'accent') { if (!HEX_COLOR_RE.test(s)) { warnings.push(`${path}.accent: not a hex colour — ignored`); return undefined; } return s; }
  if (col === 'scope')  { const lc = s.toLowerCase(); if (!IMPORT_SCOPE_ENUM.has(lc))  { warnings.push(`${path}.scope: unknown '${s}' — defaulted`); return undefined; } return lc; }
  if (col === 'status') { const lc = s.toLowerCase(); if (!IMPORT_STATUS_ENUM.has(lc)) { warnings.push(`${path}.status: unknown '${s}' — ignored`);  return undefined; } return lc; }
  if (col === 'source') { if (RESERVED_SOURCE.has(s.toLowerCase())) { warnings.push(`${path}.source: '${s}' is reserved for connected calendars — defaulted to bb`); return undefined; } return s; }
  return s;
}

/* Direct POST/PATCH item writes must obey the SAME field rules the import cleaner
   enforces — but where import warns-and-truncates untrusted (often AI) JSON, a direct
   API caller gets a HARD 400 so it learns instead of silently losing data (BUG-3).
   One source for the caps + date rules: the IMPORT_STR_CAP table and looksLike* above,
   both derived from ./item-fields (ARCH-1) — the same list discovery.js's ITEM_SHAPE
   comes from. Only the keys PRESENT in `raw` are checked (PATCH sends a subset);
   returns an error string on the first violation, else null. */
function validateItemWrite(raw) {
  if (!raw || typeof raw !== 'object') return 'invalid body';
  for (const [k, v] of Object.entries(raw)) {
    if (!ITEM_COLUMNS.has(k) || v == null) continue;   // unknown keys are dropped by the writer; null clears
    // Sources owned by calendar sync — a direct write would be wiped by the next sync (BUG-1).
    if (k === 'source' && RESERVED_SOURCE.has(String(v).toLowerCase())) {
      return `source '${v}' is reserved for connected calendars`;
    }
    // String length caps (shared with import — one title cap of 500, etc.).
    const cap = IMPORT_STR_CAP[k];
    if (cap != null && typeof v !== 'object' && String(v).length > cap) {
      return `${k} exceeds the ${cap}-character limit`;
    }
    // Real calendar dates / times only — an impossible date poisons every view that
    // parses it (and 500s the AI endpoint's toISOString), so reject at the door.
    if (IMPORT_DATE_COLS.has(k) && v !== '' && !looksLikeDate(String(v))) {
      return `${k} must be a valid YYYY-MM-DD date`;
    }
    if (IMPORT_TIME_COLS.has(k) && v !== '' && !looksLikeTime(String(v))) {
      return `${k} must be a valid HH:MM time`;
    }
    // The routine cadence — see looksLikeCadenceDays for why these are rejected
    // rather than clamped.
    if (k === 'cadence_days' && !looksLikeCadenceDays(String(v))) {
      return 'cadence_days must be comma-separated day offsets 0-6 with no repeats';
    }
    if (k === 'cadence_count') {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 0 || n > MAX_CADENCE_COUNT) {
        return `cadence_count must be between 0 and ${MAX_CADENCE_COUNT}`;
      }
    }
  }
  return null;
}

module.exports = {
  ITEM_COLUMNS, RESERVED_SOURCE, coerceColumn,
  MAX_IMPORT_ITEMS, MAX_IMPORT_DEPTH,
  IMPORT_ALIASES, IMPORT_STRUCT_KEYS, IMPORT_DATE_COLS, IMPORT_TIME_COLS, IMPORT_KIND_ENUM,
  IMPORT_STR_CAP, IMPORT_NUM_COLS, IMPORT_SCOPE_ENUM, IMPORT_STATUS_ENUM,
  HEX_COLOR_RE, MAX_TAG_COUNT, MAX_TAG_LEN, MAX_CADENCE_COUNT,
  looksLikeDate, looksLikeTime, looksLikeCadenceDays, importChildren,
  cleanImportField, validateItemWrite,
};
