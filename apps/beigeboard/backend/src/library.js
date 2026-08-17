'use strict';
/*
 * library.js — the organised set of sub-tasks routines are built out of.
 *
 * A routine's document (src/routine-spec.js) is a list of STEPS. Writing a good
 * step means knowing its unit, its load unit, a sane rest interval, a sane starting
 * dose, a sane progression, and — the hard one — the ordered ladder of harder
 * variations to climb when the numbers run out. That is a lot of tacit knowledge to
 * expect from an author, and the author we are designing for is explicitly a
 * mediocre one.
 *
 * So the library holds it instead. An author writes:
 *
 *     { "ref": "back-squat", "sets": 5 }
 *
 * and normalizeSpec resolves it into a complete step: title, unit `reps`, load unit
 * `lb`, 150s rest, a double-progression over 5–8, and the goblet → back → front →
 * pause ladder — with the explicit `sets: 5` kept, because a library entry supplies
 * DEFAULTS and never overrides what the document actually said.
 *
 * ONE MECHANISM, MANY DOMAINS. `collection` is the discriminator: `exercise` for
 * training, `recipe` for cooking, `practice` for an instrument, `study` for a
 * syllabus. Nothing about the resolution path is training-specific — a cooking
 * routine pulling `ref: 'shakshuka'` out of the recipe collection uses exactly the
 * code path a squat does. That generality is the reason this is a `library` table
 * with a `collection` column and not an `exercises` table.
 *
 * WHY IT IS NOT `kind:'library'` ROWS IN `items`. A library entry has no date, no
 * parent, no completion and no place in a plan. Giving it an item kind would put it
 * in front of every tree walk, rollup, calendar query and weave `items` read, each
 * of which would then need a filter to exclude it — the exact tax the
 * occurrences-are-just-tasks decision was made to avoid paying. See migration 10.
 */
const { db, run, all, get } = require('./db');
const { slugify, humanize, COLLECTIONS, UNITS, LOAD_UNITS, LIMITS } = require('./routine-spec');

/* ── Row ⇄ wire ───────────────────────────────────────────────────────────── */

const parseJson = (s, fallback) => {
  if (s === null || s === undefined || s === '') return fallback;
  try { const v = JSON.parse(s); return v === null ? fallback : v; } catch { return fallback; }
};

/** A stored row as the API returns it — the JSON columns parsed, so a consumer
 *  never has to know they were stored as text. */
function toEntry(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJson(row.tags, []),
    variants: parseJson(row.variants, []),
    defaults: parseJson(row.defaults, {}),
  };
}

/* ── Cleaning ─────────────────────────────────────────────────────────────────
   Same posture as the item import cleaner: this is untrusted, often AI-generated
   input, so every field is normalised and bounded rather than trusted, and nothing
   here throws. A library entry is far less dangerous than a spec (it supplies
   defaults, it does not drive a render on its own), so the cleaning is one pass
   with no separate validation tier. */

/** The keys a library entry may contribute as step defaults. Allowlisted so an
 *  entry cannot inject arbitrary keys into a step — the defaults object is spread
 *  into a step's field lookups, and an unbounded key set there would be a way to
 *  smuggle values past normalizeStep's own picks. */
const DEFAULT_KEYS = new Set([
  'sets', 'target', 'reps', 'load', 'load_unit', 'unit', 'rest',
  'progression', 'variant_index', 'variant_every',
]);

function cleanEntry(raw, { partial = false } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};

  const title = src.title ?? src.name;
  const slug = src.slug ?? src.key ?? src.id ?? title;
  if (slug !== undefined || !partial) out.slug = slugify(slug, '');
  if (title !== undefined || !partial) out.title = String(title ?? humanize(out.slug || '')).trim().slice(0, LIMITS.title);
  if (src.collection !== undefined || !partial) {
    const c = String(src.collection ?? 'exercise').trim().toLowerCase();
    out.collection = COLLECTIONS.includes(c) ? c : 'custom';
  }
  if (src.notes !== undefined) out.notes = src.notes == null ? null : String(src.notes).trim().slice(0, LIMITS.notes) || null;
  if (src.unit !== undefined) {
    const u = String(src.unit ?? '').trim().toLowerCase();
    out.unit = UNITS.includes(u) ? u : null;
  }
  if (src.load_unit !== undefined) {
    const u = String(src.load_unit ?? '').trim().toLowerCase();
    out.load_unit = LOAD_UNITS.includes(u) ? u : null;
  }
  if (src.tags !== undefined) {
    const arr = Array.isArray(src.tags) ? src.tags : String(src.tags ?? '').split(',');
    out.tags = JSON.stringify(arr.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, LIMITS.tags));
  }
  if (src.variants !== undefined) {
    const arr = Array.isArray(src.variants) ? src.variants : [];
    out.variants = JSON.stringify(
      arr.map((v) => String(v && typeof v === 'object' ? (v.title ?? v.name ?? '') : v).trim().slice(0, LIMITS.title))
        .filter(Boolean).slice(0, LIMITS.variants),
    );
  }
  if (src.defaults !== undefined) {
    const d = src.defaults && typeof src.defaults === 'object' ? src.defaults : {};
    const kept = {};
    for (const [k, v] of Object.entries(d)) if (DEFAULT_KEYS.has(k)) kept[k] = v;
    const text = JSON.stringify(kept);
    out.defaults = text.length > LIMITS.spec ? '{}' : text;
  }
  if (src.source !== undefined) out.source = String(src.source ?? 'bb').trim().slice(0, 40) || 'bb';
  return out;
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

function listEntries(userId, { collection = null, q = null, limit = 500 } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (collection) { where.push('collection = ?'); params.push(String(collection)); }
  if (q) {
    // Title OR tags, so "push" finds both `Push-Up` and everything tagged push.
    where.push('(title LIKE ? OR slug LIKE ? OR tags LIKE ?)');
    const like = `%${String(q).slice(0, 60)}%`;
    params.push(like, like, like);
  }
  const rows = all(
    `SELECT * FROM library WHERE ${where.join(' AND ')} ORDER BY collection ASC, title ASC LIMIT ?`,
    [...params, Math.min(2000, Math.max(1, parseInt(limit, 10) || 500))],
  );
  return rows.map(toEntry);
}

const getEntry = (id, userId) => toEntry(get('SELECT * FROM library WHERE id = ? AND user_id = ?', [id, userId]));

/**
 * The resolver normalizeSpec takes. Loads the user's whole library once and closes
 * over it, so normalising a 40-step document is one query rather than forty — this
 * runs inside the mint, which runs on every unfiltered read.
 *
 * Collection-agnostic when the step doesn't name one: a step that says
 * `ref: 'shakshuka'` gets the recipe without having to know it is a recipe, which
 * is one less thing an author can get wrong. A collision across collections
 * resolves to the first by collection order, and the author can disambiguate by
 * saying `collection` explicitly.
 */
function resolverFor(userId) {
  let cache = null;
  return (slug, collection) => {
    if (!slug) return null;
    if (cache === null) {
      cache = new Map();
      for (const e of listEntries(userId, { limit: 2000 })) {
        cache.set(`${e.collection}:${e.slug}`, e);
        if (!cache.has(e.slug)) cache.set(e.slug, e);   // collection-agnostic alias
      }
    }
    return (collection ? cache.get(`${collection}:${slug}`) : null) || cache.get(slug) || null;
  };
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

/** Insert or update by (user, collection, slug). UPSERT rather than insert because
 *  the import below has to be safe to retry — an agent that times out and resends
 *  must not double the library. */
function upsertEntry(userId, raw) {
  const e = cleanEntry(raw);
  if (!e.slug) return { ok: false, error: 'slug or title is required' };
  const existing = get(
    'SELECT id FROM library WHERE user_id = ? AND collection = ? AND slug = ?',
    [userId, e.collection, e.slug],
  );
  if (existing) {
    const keys = Object.keys(e).filter((k) => k !== 'slug' && k !== 'collection');
    if (keys.length) {
      run(`UPDATE library SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
        [...keys.map((k) => e[k]), existing.id, userId]);
    }
    return { ok: true, created: false, entry: getEntry(existing.id, userId) };
  }
  const d = { user_id: userId, ...e };
  const keys = Object.keys(d);
  const r = run(
    `INSERT INTO library (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    keys.map((k) => d[k]),
  );
  return { ok: true, created: true, entry: getEntry(r.lastInsertRowid, userId) };
}

function patchEntry(id, userId, raw) {
  const e = cleanEntry(raw, { partial: true });
  const keys = Object.keys(e);
  if (!keys.length) return { ok: false, error: 'no valid fields to update' };
  run(`UPDATE library SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
    [...keys.map((k) => e[k]), id, userId]);
  const entry = getEntry(id, userId);
  return entry ? { ok: true, entry } : { ok: false, error: 'not found' };
}

const deleteEntry = (id, userId) => run('DELETE FROM library WHERE id = ? AND user_id = ?', [id, userId]).changes > 0;

/** Bulk upsert, one transaction. The import an agent uses to teach the app a new
 *  domain in one call. */
const importEntries = db.transaction((userId, entries) => {
  let created = 0, updated = 0;
  const failed = [];
  for (const [i, raw] of entries.entries()) {
    const r = upsertEntry(userId, raw);
    if (!r.ok) { failed.push({ index: i, error: r.error }); continue; }
    if (r.created) created++; else updated++;
  }
  return { created, updated, failed };
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE STARTER LIBRARY

   Seeded lazily on the first library read, the same bargain the items seed and the
   routine mint already make (see routes/items.js). It exists for two reasons and
   the second is the important one:

     1. A library that starts empty is a feature nobody discovers.
     2. IT IS THE FEW-SHOT PROMPT. An agent asked to write a training routine will
        do far better having first read twenty real entries — with their units,
        their rest intervals, their ladders — than from any schema description. The
        ladders in particular are the knowledge an LLM most often gets subtly wrong
        (ordering regressions and progressions), and here they are written down.

   Kept deliberately small and unopinionated: enough vocabulary to build a real
   programme out of, not a training encyclopaedia. Everything here is user-owned
   from the moment it lands, so it is a starting point to edit, not a fixture.
   ══════════════════════════════════════════════════════════════════════════════ */

const dbl = (lo, hi, increment = 5) => ({ type: 'double', range: [lo, hi], increment });
/* A count that climbs must say where it stops. `linear` with no cap is legal and is
   the single most common way a generated routine goes quietly insane — +5s a session
   is a five-minute plank by next spring. Load progressions are deliberately left
   uncapped (a barbell's ceiling is the person, not the library); anything counting
   seconds, metres or reps gets one here. */
const lin = (increment, cap, every = 1) => ({ type: 'linear', increment, cap, every });

const STARTER = [
  /* ── Exercise: the six patterns, each with a real ladder ─────────────────── */
  { collection: 'exercise', slug: 'back-squat', title: 'Back Squat', unit: 'reps', load_unit: 'lb',
    tags: ['legs', 'squat', 'barbell'],
    variants: ['Goblet Squat', 'Front Squat', 'Back Squat', 'Pause Back Squat'],
    defaults: { sets: 3, target: 5, load: 95, rest: 150, variant_index: 2, progression: dbl(5, 8, 10) },
    notes: 'Brace before you unrack. Depth before load.' },
  { collection: 'exercise', slug: 'deadlift', title: 'Deadlift', unit: 'reps', load_unit: 'lb',
    tags: ['hinge', 'back', 'barbell'],
    variants: ['Romanian Deadlift', 'Trap Bar Deadlift', 'Conventional Deadlift', 'Deficit Deadlift'],
    defaults: { sets: 3, target: 5, load: 135, rest: 180, variant_index: 2, progression: dbl(3, 5, 10) } },
  { collection: 'exercise', slug: 'bench-press', title: 'Bench Press', unit: 'reps', load_unit: 'lb',
    tags: ['push', 'chest', 'barbell'],
    variants: ['Dumbbell Bench Press', 'Bench Press', 'Close-Grip Bench Press', 'Pause Bench Press'],
    defaults: { sets: 3, target: 5, load: 95, rest: 150, variant_index: 1, progression: dbl(5, 8, 5) } },
  { collection: 'exercise', slug: 'overhead-press', title: 'Overhead Press', unit: 'reps', load_unit: 'lb',
    tags: ['push', 'shoulders', 'barbell'],
    variants: ['Seated Dumbbell Press', 'Overhead Press', 'Push Press', 'Z Press'],
    defaults: { sets: 3, target: 5, load: 65, rest: 150, variant_index: 1, progression: dbl(5, 8, 5) } },
  { collection: 'exercise', slug: 'pull-up', title: 'Pull-Up', unit: 'reps', load_unit: 'bw',
    tags: ['pull', 'back', 'bodyweight'],
    variants: ['Band-Assisted Pull-Up', 'Negative Pull-Up', 'Pull-Up', 'Weighted Pull-Up', 'Archer Pull-Up'],
    defaults: { sets: 3, target: 5, rest: 120, variant_index: 2, progression: { type: 'linear', drives: 'target', increment: 1, cap: 12 }, variant_every: 12 },
    notes: 'When the rep cap is comfortable, the ladder moves — not the reps.' },
  { collection: 'exercise', slug: 'push-up', title: 'Push-Up', unit: 'reps', load_unit: 'bw',
    tags: ['push', 'chest', 'bodyweight'],
    variants: ['Incline Push-Up', 'Knee Push-Up', 'Push-Up', 'Decline Push-Up', 'Archer Push-Up', 'One-Arm Push-Up'],
    defaults: { sets: 3, target: 8, rest: 90, variant_index: 2, progression: { type: 'linear', drives: 'target', increment: 1, cap: 20 }, variant_every: 10 } },
  { collection: 'exercise', slug: 'row', title: 'Barbell Row', unit: 'reps', load_unit: 'lb',
    tags: ['pull', 'back'],
    variants: ['Seated Cable Row', 'Dumbbell Row', 'Barbell Row', 'Pendlay Row'],
    defaults: { sets: 3, target: 8, load: 65, rest: 120, variant_index: 2, progression: dbl(8, 12, 5) } },
  { collection: 'exercise', slug: 'lunge', title: 'Lunge', unit: 'reps', load_unit: 'lb',
    tags: ['legs', 'unilateral'],
    variants: ['Split Squat', 'Walking Lunge', 'Reverse Lunge', 'Bulgarian Split Squat'],
    defaults: { sets: 3, target: 10, rest: 90, variant_index: 1, progression: dbl(8, 12, 5) } },
  { collection: 'exercise', slug: 'hip-thrust', title: 'Hip Thrust', unit: 'reps', load_unit: 'lb',
    tags: ['hinge', 'glutes'],
    variants: ['Glute Bridge', 'Single-Leg Glute Bridge', 'Hip Thrust'],
    defaults: { sets: 3, target: 10, load: 95, rest: 120, variant_index: 2, progression: dbl(8, 12, 10) } },
  { collection: 'exercise', slug: 'dip', title: 'Dip', unit: 'reps', load_unit: 'bw',
    tags: ['push', 'triceps', 'bodyweight'],
    variants: ['Bench Dip', 'Band-Assisted Dip', 'Dip', 'Weighted Dip'],
    defaults: { sets: 3, target: 6, rest: 120, variant_index: 2, progression: { type: 'linear', drives: 'target', increment: 1, cap: 12 } } },
  { collection: 'exercise', slug: 'plank', title: 'Plank', unit: 'sec', load_unit: 'bw',
    tags: ['core', 'bodyweight'],
    variants: ['Knee Plank', 'Plank', 'Long-Lever Plank', 'RKC Plank'],
    defaults: { sets: 3, target: 30, rest: 60, variant_index: 1, progression: lin(5, 120), variant_every: 12 },
    notes: 'Time, not reps — the progression adds five seconds a session.' },
  { collection: 'exercise', slug: 'hanging-leg-raise', title: 'Hanging Leg Raise', unit: 'reps', load_unit: 'bw',
    tags: ['core'],
    variants: ['Lying Leg Raise', 'Hanging Knee Raise', 'Hanging Leg Raise', 'Toes to Bar'],
    defaults: { sets: 3, target: 8, rest: 90, variant_index: 1, progression: { type: 'linear', drives: 'target', increment: 1, cap: 15 } } },
  { collection: 'exercise', slug: 'farmer-carry', title: 'Farmer Carry', unit: 'm', load_unit: 'lb',
    tags: ['carry', 'grip'],
    defaults: { sets: 3, target: 30, load: 50, rest: 90, progression: lin(5, 100) } },
  { collection: 'exercise', slug: 'kettlebell-swing', title: 'Kettlebell Swing', unit: 'reps', load_unit: 'lb',
    tags: ['hinge', 'conditioning'],
    variants: ['Kettlebell Deadlift', 'Russian Swing', 'American Swing'],
    defaults: { sets: 4, target: 15, load: 35, rest: 60, variant_index: 1, progression: dbl(10, 20, 9) } },
  { collection: 'exercise', slug: 'easy-run', title: 'Easy Run', unit: 'km', load_unit: null,
    tags: ['cardio', 'run'],
    defaults: { sets: 1, target: 3, rest: 0, progression: { type: 'linear', drives: 'target', increment: 0.5, cap: 12 } },
    notes: 'Conversational pace. The progression adds 500 m a run; hold a week whenever it stops being easy.' },
  { collection: 'exercise', slug: 'intervals', title: 'Intervals', unit: 'm', load_unit: null,
    tags: ['cardio', 'run'],
    defaults: { sets: 6, target: 400, rest: 120, progression: { type: 'linear', drives: 'sets', increment: 1, cap: 12 } } },
  { collection: 'exercise', slug: 'mobility-flow', title: 'Mobility Flow', unit: 'min', load_unit: 'bw',
    tags: ['mobility', 'warmup'],
    defaults: { sets: 1, target: 8, rest: 0, progression: { type: 'fixed' } } },
  { collection: 'exercise', slug: 'couch-stretch', title: 'Couch Stretch', unit: 'sec', load_unit: 'bw',
    tags: ['mobility', 'hips'],
    defaults: { sets: 2, target: 45, rest: 15, progression: lin(5, 90) } },
  { collection: 'exercise', slug: 'dead-hang', title: 'Dead Hang', unit: 'sec', load_unit: 'bw',
    tags: ['grip', 'shoulders'],
    variants: ['Assisted Hang', 'Dead Hang', 'One-Arm-Assisted Hang'],
    defaults: { sets: 3, target: 20, rest: 60, variant_index: 1, progression: lin(5, 90) } },
  { collection: 'exercise', slug: 'face-pull', title: 'Face Pull', unit: 'reps', load_unit: 'lb',
    tags: ['pull', 'shoulders', 'accessory'],
    defaults: { sets: 3, target: 15, load: 25, rest: 60, progression: dbl(12, 20, 5) } },
  { collection: 'exercise', slug: 'calf-raise', title: 'Calf Raise', unit: 'reps', load_unit: 'lb',
    tags: ['legs', 'accessory'],
    variants: ['Bodyweight Calf Raise', 'Dumbbell Calf Raise', 'Single-Leg Calf Raise'],
    defaults: { sets: 3, target: 12, rest: 60, variant_index: 1, progression: dbl(10, 15, 10) } },
  { collection: 'exercise', slug: 'curl', title: 'Biceps Curl', unit: 'reps', load_unit: 'lb',
    tags: ['pull', 'arms', 'accessory'],
    defaults: { sets: 3, target: 10, load: 20, rest: 60, progression: dbl(8, 12, 5) } },

  /* ── Recipe: the same mechanism, a different domain ───────────────────────
     A recipe's "sets/target" is servings, and its variants are the ladder of
     ambition rather than of difficulty — which is exactly the point: nothing in
     the resolution path is training-shaped. */
  { collection: 'recipe', slug: 'shakshuka', title: 'Shakshuka', unit: 'count', load_unit: null,
    tags: ['dinner', 'vegetarian', '30-min'],
    variants: ['Shakshuka (jarred sauce)', 'Shakshuka', 'Shakshuka with harissa & feta'],
    defaults: { sets: 1, target: 2, variant_index: 1, progression: { type: 'fixed' } },
    notes: 'Onion, pepper, garlic, tomato, cumin, paprika. Wells for the eggs, lid on, 8 min.' },
  { collection: 'recipe', slug: 'roast-chicken', title: 'Roast Chicken', unit: 'count', load_unit: null,
    tags: ['dinner', 'batch'],
    defaults: { sets: 1, target: 4, progression: { type: 'fixed' } },
    notes: 'Dry-brine overnight. 220 °C for 20 min, then 180 °C to 74 °C internal. Rest 15.' },
  { collection: 'recipe', slug: 'overnight-oats', title: 'Overnight Oats', unit: 'count', load_unit: null,
    tags: ['breakfast', 'prep'],
    defaults: { sets: 1, target: 1, progression: { type: 'fixed' } } },
  { collection: 'recipe', slug: 'lentil-soup', title: 'Lentil Soup', unit: 'count', load_unit: null,
    tags: ['dinner', 'batch', 'vegetarian'],
    defaults: { sets: 1, target: 4, progression: { type: 'fixed' } } },

  /* ── Practice / study: the ladder as difficulty of material ──────────────── */
  { collection: 'practice', slug: 'scales', title: 'Scales', unit: 'min', load_unit: 'level',
    tags: ['music', 'technique'],
    variants: ['Major, one octave', 'Major, two octaves', 'Major + natural minor', 'All three minors', 'Modes'],
    defaults: { sets: 1, target: 10, rest: 0, variant_index: 0, variant_every: 14, progression: lin(1, 30) } },
  { collection: 'practice', slug: 'sight-reading', title: 'Sight Reading', unit: 'min', load_unit: 'level',
    tags: ['music'],
    variants: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'],
    defaults: { sets: 1, target: 10, variant_index: 0, variant_every: 30, progression: { type: 'fixed' } } },
  { collection: 'study', slug: 'spaced-review', title: 'Spaced Review', unit: 'count', load_unit: null,
    tags: ['recall'],
    defaults: { sets: 1, target: 20, progression: { type: 'linear', drives: 'target', increment: 5, cap: 60 } } },
  { collection: 'study', slug: 'deep-reading', title: 'Deep Reading', unit: 'pages', load_unit: null,
    tags: ['reading'],
    defaults: { sets: 1, target: 10, progression: { type: 'linear', drives: 'target', increment: 2, every: 3, cap: 40 } } },
  { collection: 'chore', slug: 'kitchen-reset', title: 'Kitchen Reset', unit: 'min', load_unit: null,
    tags: ['home'],
    defaults: { sets: 1, target: 15, progression: { type: 'fixed' } } },
];

/** Seed the starter library for a user who has none. Idempotent by construction —
 *  it upserts, and it only runs when the user's library is empty, so a user who
 *  deleted an entry never has it conjured back. */
const seedLibrary = db.transaction((userId) => {
  const n = get('SELECT COUNT(*) AS n FROM library WHERE user_id = ?', [userId]);
  if (n && n.n > 0) return 0;
  for (const e of STARTER) upsertEntry(userId, { ...e, source: 'starter' });
  return STARTER.length;
});

module.exports = {
  toEntry, cleanEntry, listEntries, getEntry, resolverFor,
  upsertEntry, patchEntry, deleteEntry, importEntries,
  seedLibrary, STARTER,
};
