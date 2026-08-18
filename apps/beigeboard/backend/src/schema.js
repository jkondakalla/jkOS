'use strict';
// Item validation surface — column allowlist, reserved sources, value coercion,
// and the import/direct-write field cleaners. Every column-level table here is
// DERIVED from the single per-column list in ./item-fields (ARCH-1), so the items
// and import routes (and the AI sanitiser) enforce exactly what discovery.js's
// ITEM_SHAPE declares — one source, no drift (the class behind BUG-1/3/7).
const { coerceWeaveColumn } = require('@jkos/weave/server');
const { ITEM_FIELDS } = require('./item-fields');
const routineSpec = require('./routine-spec');

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

/* The routine document columns (migration 10). Stored as TEXT, but a caller —
   especially an AI author, which is the caller these are FOR — naturally sends them
   as nested JSON rather than as a pre-stringified string. Both are accepted and
   both land as the same TEXT, because rejecting the object form would make the
   friendliest way to write the field the wrong one. */
const JSON_COLUMNS = new Set(['spec', 'prescription', 'performed']);

/* Value coercion for item writes (booleans → 0/1, `tags` → a JSON-array string)
   is the shared weave column rule now — see @jkos/weave/server coerceWeaveColumn,
   which also fixes the malformed-`[…` tags passthrough that used to make toRow's
   JSON.parse throw and silently drop every tag. Wrapped here only to serialise the
   JSON columns first: an object reaching better-sqlite3 unstringified throws
   ("can only bind numbers, strings, bigints, buffers, and null"), which would
   surface as a 500 on a request that is actually well-formed. */
function coerceColumn(k, v) {
  if (JSON_COLUMNS.has(k) && v !== null && v !== undefined && typeof v === 'object') {
    return JSON.stringify(v);
  }
  return coerceWeaveColumn(k, v);
}

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

/* The routine's SKIP LIST (migration 12) — a CSV of occurrence ref suffixes, each
   either a date (`2026-08-26`) or a float slot (`2026-08-24#0`). Validated at the
   door for the same reason cadence_days is: plannedOccurrences() filters the mint
   through this set, so a malformed entry is a silently un-honoured exception —
   the user strikes a session out, nothing happens, and there is nothing on screen
   to explain it. Entries are de-duplicated rather than rejected (unlike a repeated
   cadence day, a repeated skip means exactly what one means), and the count is
   capped: this rides on a routine that lives forever, and an unbounded list would
   be read and re-parsed on every unfiltered GET. */
const MAX_CADENCE_SKIPS = 200;
const SKIP_ENTRY_RE = /^\d{4}-\d{2}-\d{2}(#\d{1,2})?$/;
const looksLikeCadenceSkips = (v) => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s === '') return true;
  const parts = s.split(',');
  if (parts.length > MAX_CADENCE_SKIPS) return false;
  return parts.every((p) => SKIP_ENTRY_RE.test(p) && looksLikeDate(p.split('#')[0]));
};

/* `started_at` (migration 13) — a millisecond-ISO UTC instant, the same format the
   whole *_at family has used since migration 8. The ONLY client-writable timestamp
   in the schema, so it is the only one that can arrive malformed, and it is
   validated here for the same reason cadence_days is: it feeds a computation the
   user never sees the input to. A drift statistic built over 'yesterday evening' or
   a local-time string with no zone produces a number that is wrong in a way nothing
   downstream can detect — and a variance finding that is confidently wrong is worse
   than a missing one (ALGORITHMS.md §8.1). Empty clears. */
const looksLikeStamp = (v) => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s === '') return true;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/);
  return !!m && looksLikeDate(m[1]) && +m[2] <= 23 && +m[3] <= 59 && +m[4] <= 60;
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
  /* The routine document columns — serialised, not stringified. Without this they
     fall into the text branch below and an object becomes the literal string
     "[object Object]", which parses back to nothing and silently discards the whole
     document. `spec` additionally goes through the routine validator, so an import
     carrying a broken routine warns like every other import problem instead of
     writing a document the engine will later ignore. */
  if (JSON_COLUMNS.has(col)) {
    let text;
    if (typeof v === 'string') text = v;
    else { try { text = JSON.stringify(v); } catch { warnings.push(`${path}.${col}: not serialisable — ignored`); return undefined; } }
    if (text.length > (IMPORT_STR_CAP[col] ?? routineSpec.LIMITS.spec)) {
      warnings.push(`${path}.${col}: exceeds ${IMPORT_STR_CAP[col]} characters — ignored`);
      return undefined;
    }
    if (col === 'spec') {
      const v2 = routineSpec.validateSpec(text);
      if (!v2.ok) {
        warnings.push(`${path}.spec: ${v2.errors.map((e) => `${e.path || 'spec'} ${e.code}`).join(', ')} — ignored`);
        return undefined;
      }
      for (const w of v2.warnings) warnings.push(`${path}.spec${w.path ? `.${w.path}` : ''}: ${w.message}`);
    }
    return text;
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
   returns an error string on the first violation, else null.

   `details` is an OUT parameter: pass an object and a rejected `spec` fills in
   `details.errors` with the routine validator's machine-readable list, and
   `details.warnings` with the lint tier of an ACCEPTED one. The routes hand both
   straight back to the caller, because the whole point of the routine document is
   that a mediocre author gets told precisely what to fix rather than "400". */
function validateItemWrite(raw, details = null) {
  if (!raw || typeof raw !== 'object') return 'invalid body';
  for (const [k, v] of Object.entries(raw)) {
    if (!ITEM_COLUMNS.has(k) || v == null) continue;   // unknown keys are dropped by the writer; null clears
    /* The routine document. Validated HERE rather than trusted, because it is the
       one column that DRIVES A RENDER the user then acts on — a malformed spec
       would put wrong numbers in front of someone lifting a barbell. Checked before
       the generic caps below since the object form has no meaningful String()
       length. */
    if (JSON_COLUMNS.has(k)) {
      const text = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return null; } })();
      if (text === null) return `${k} must be JSON`;
      if (text.length > (IMPORT_STR_CAP[k] ?? routineSpec.LIMITS.spec)) {
        return `${k} exceeds the ${IMPORT_STR_CAP[k]}-character limit`;
      }
      if (k === 'spec') {
        const r = routineSpec.validateSpec(text);
        if (details) { details.errors = r.errors; details.warnings = r.warnings; }
        if (!r.ok) return r.errors[0] ? `spec: ${r.errors[0].message}` : 'spec is invalid';
      } else if (text.trim() !== '') {
        try { JSON.parse(text); } catch { return `${k} must be valid JSON`; }
      }
      continue;
    }
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
    if (k === 'cadence_skips' && !looksLikeCadenceSkips(String(v))) {
      return `cadence_skips must be up to ${MAX_CADENCE_SKIPS} comma-separated occurrence refs (YYYY-MM-DD or YYYY-MM-DD#n)`;
    }
    if (k === 'cadence_count') {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 0 || n > MAX_CADENCE_COUNT) {
        return `cadence_count must be between 0 and ${MAX_CADENCE_COUNT}`;
      }
    }
    /* The cadence RULE (migration 11). Checked at the door for the same reason
       cadence_days is: it drives the mint loop. An unparseable rule silently falls
       back to weekly inside parseCadence — safe, but silent — and a direct API
       caller should be told rather than get a schedule they did not ask for.
       Round-tripping through parse→format is the check: anything that does not
       survive it was not understood. */
    if (k === 'cadence_rule' && String(v).trim() !== '') {
      const parsed = routineSpec.parseCadence(String(v));
      if (parsed.rrule_error) return `cadence_rule: ${parsed.rrule_error}`;
      if (routineSpec.formatCadence(parsed) === '') {
        return `cadence_rule must be one of ${routineSpec.CADENCES.join(' / ')} (e.g. 'every_n_days:3')`;
      }
    }
    if (k === 'started_at' && !looksLikeStamp(String(v))) {
      return 'started_at must be a millisecond-ISO UTC instant (YYYY-MM-DDTHH:MM:SS.sssZ)';
    }
    if (k === 'deload_override') {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 0 || n > 1) return 'deload_override must be 0 or 1';
    }
  }
  return null;
}

module.exports = {
  ITEM_COLUMNS, RESERVED_SOURCE, coerceColumn, JSON_COLUMNS,
  MAX_IMPORT_ITEMS, MAX_IMPORT_DEPTH,
  IMPORT_ALIASES, IMPORT_STRUCT_KEYS, IMPORT_DATE_COLS, IMPORT_TIME_COLS, IMPORT_KIND_ENUM,
  IMPORT_STR_CAP, IMPORT_NUM_COLS, IMPORT_SCOPE_ENUM, IMPORT_STATUS_ENUM,
  HEX_COLOR_RE, MAX_TAG_COUNT, MAX_TAG_LEN, MAX_CADENCE_COUNT, MAX_CADENCE_SKIPS,
  looksLikeDate, looksLikeTime, looksLikeStamp, looksLikeCadenceDays, looksLikeCadenceSkips, importChildren,
  cleanImportField, validateItemWrite,
};
