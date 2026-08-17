'use strict';
/*
 * routine-spec.js — THE ROUTINE DOCUMENT, and the pure functions over it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Before it, a routine was a schedule with a title: `cadence_days` said WHEN and
 * `title` said what to call it, and the occurrences the engine minted were fourteen
 * identical tasks all named "Push Day". A routine had no CONTENT. You could not say
 * what the session actually consists of, and — the thing that makes a routine a
 * routine rather than a repeating task — you could not say how it gets HARDER.
 *
 * The structural idea, in one line:
 *
 *     THE ROUTINE HOLDS RULES · THE OCCURRENCE HOLDS A RENDERED SNAPSHOT ·
 *     THE OCCURRENCE ALSO HOLDS WHAT ACTUALLY HAPPENED
 *
 * A routine's `spec` is a document of STEPS, each carrying a progression RULE
 * ("+5 lb every time you top the rep range") rather than a number. At mint time the
 * cadence engine evaluates every rule at that occurrence's CYCLE INDEX and writes
 * the resulting concrete numbers into the occurrence's `prescription`. Later, the
 * user's actual sets go into `performed` on the same row.
 *
 * That split is the same doctrine routines.js already argues for itself — "rows are
 * FACTS, not a live view of the pattern". A rendered prescription is a fact: last
 * Tuesday says 95 lb because 95 lb is what you were told to lift, and it keeps
 * saying so after the rule has moved on. And it means "make week 6 harder" is an
 * edit to ONE RULE, not a rewrite of thirty rows — which was the whole ask.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SHAPED FOR A MEDIOCRE AUTHOR
 *
 * The other requirement is that a not-especially-good AI agent should be able to
 * write a decent routine. Every design choice below that looks over-permissive is
 * that requirement:
 *
 *   · ONE FLAT DOCUMENT, NO FOREIGN KEYS. Everything — cadence, steps, phases,
 *     progression — is one self-contained object. LLMs fill one template well and
 *     maintain invariants across joined tables badly.
 *   · EVERY FIELD OPTIONAL, EVERY DEFAULT DEFENSIBLE. Omit `progression` and you
 *     get `fixed`. Omit `unit` and it is inferred. A half-filled routine is still a
 *     working routine, so a weak author produces something PLAINER, not something
 *     BROKEN. This is the single highest-leverage rule in the file.
 *   · CLOSED VOCABULARIES, NEVER EXPRESSIONS. `progression.type` is one of six
 *     names with two or three numbers. There is deliberately no formula field: an
 *     agent will happily emit a syntactically valid expression that means nothing,
 *     and a formula cannot be rendered as a UI control.
 *   · NAMES, NOT IDS. Steps are keyed by slug and library entries referenced by
 *     slug. An agent cannot invent a valid integer primary key.
 *   · ERRORS ARE MACHINE-READABLE, AND THERE IS A LINT TIER BELOW THEM. A bad
 *     document comes back as {path, code, message, expected} so the next turn can
 *     fix itself. A valid-but-lazy document is ACCEPTED and warned about, because
 *     the common failure of an AI author is not invalid output, it is thin output.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURITY CONTRACT
 *
 * Zero dependencies, zero I/O, no Date, no randomness — exactly like item-fields.js,
 * and for the same reason plus one more. Same reason: offline tooling and the
 * prober must be able to require() it. One more: `renderCycle` is the function that
 * decides what a user is told to lift, so it has to be testable exhaustively
 * without a database, and it has to give the same answer on the server (at mint)
 * and in the browser (in the preview) — see the conformance gate `pnpm check:routine`,
 * which drives BOTH this file and its frontend mirror through the same matrix.
 */

/* Bumped when the rendered shape changes in a way a stored snapshot would need to
   be read differently. Stamped onto every occurrence's prescription, so a row
   rendered by an older engine is identifiable rather than silently misread. */
const SPEC_VERSION = 1;

/* ── The closed vocabularies ───────────────────────────────────────────────────
   Every one of these is a fixed list on purpose (see the header). They are exported
   so the editor's dropdowns, the validator's `expected` hints, and the library are
   populated from the same arrays — an option that exists in the UI but not in the
   validator is the drift this file is organised to prevent. */

/** What a step's `target` COUNTS. Closed because a free-text unit ("a few laps")
 *  cannot be summed, compared across sessions, or progressed. */
const UNITS = ['reps', 'sec', 'min', 'm', 'km', 'mi', 'pages', 'count', 'kcal', 'g', 'ml'];

/** What a step's `load` is MEASURED IN. `bw` is bodyweight (no number), `band` and
 *  `level` cover the machines and apps that only expose an ordinal. */
const LOAD_UNITS = ['lb', 'kg', 'bw', 'band', 'level', 'plate', '%'];

/** How a step gets harder. Six names, each with two or three numbers.
 *    fixed          never changes — the default, and what most routines are
 *    linear         +increment every `every` cycles, clamped at `cap`
 *    double         climb the rep range, then add load and reset — the workhorse
 *    ladder         an explicit per-cycle table, for a written program
 *    percent        a fraction of a stored max that creeps up
 *    autoregulated  advance only when the log says you earned it */
const PROGRESSIONS = ['fixed', 'linear', 'double', 'ladder', 'percent', 'autoregulated'];

/** Which rendered field a progression moves. `variant` moves UP THE LADDER of
 *  movements (knee push-up → push-up → decline) rather than up a number, which is
 *  the only way bodyweight work can get harder and the reason this is a field at
 *  all rather than load being assumed. */
const DRIVES = ['load', 'target', 'sets', 'variant'];

/** How a routine's cadence is expressed. `weekly` is the original and stays the
 *  default; everything else is opt-in through the `cadence_rule` column.
 *
 *    weekly         cadence_days (offsets from Monday) + cadence_count; the
 *                   surplus over the committed days FLOATS to the week bench
 *    every_n_days   a fixed interval from the routine's own start — "every third
 *                   day", which no weekly grid can express
 *    monthly        a day of the month (or `last`), for the things that are
 *                   genuinely monthly: a deep clean, a review, a bill
 *    rolling        N times per rolling 7 days, anchored on the routine's start
 *                   weekday rather than on Monday — for "3× a week" that shouldn't
 *                   reset its count every Monday morning
 *    rrule          a deliberately small subset of RFC 5545 (see parseCadence)
 *
 *  RRULE IS THE ESCAPE HATCH, NOT THE MODEL. It is here because some schedules
 *  genuinely are RFC 5545 shaped and importing one should not require rewriting it.
 *  It is not the default and is lint-warned, for two reasons that have not changed:
 *  it cannot be drawn as a weekly board row, and it is the one cadence form where an
 *  author (especially a machine one) can write something perfectly valid that means
 *  something entirely different from what they intended. */
const CADENCES = ['weekly', 'every_n_days', 'monthly', 'rolling', 'rrule'];

/** What advances the cycle counter.
 *    completion  a cycle is a session you DID (the default — a sick week must not
 *                silently advance your squat 15 lb)
 *    calendar    a cycle is a period that ELAPSED (for routines where the point is
 *                the date: a taper, a medication ramp, a course syllabus) */
const ADVANCE_ON = ['completion', 'calendar'];

/** What happens after the last phase. `loop` restarts the block cycle (a training
 *  block you repeat); `hold` stays in the final phase forever (a ramp to a plateau). */
const PHASE_REPEAT = ['loop', 'hold'];

/** Where a step sits in the session's arc. Flat tags rather than nested groups:
 *  nesting is the first thing a weak author gets wrong, and a tag sorts just as
 *  well. Rendering order is `blocks` order, then declaration order. */
const BLOCKS = ['warmup', 'main', 'accessory', 'cooldown'];

/** Library collections — the kinds of reusable sub-task a routine pulls steps
 *  from. `exercise` for training, `recipe` for cooking; the rest are the same
 *  mechanism for the other things people do on a cadence. */
const COLLECTIONS = ['exercise', 'recipe', 'practice', 'study', 'chore', 'custom'];

/* ── Limits ───────────────────────────────────────────────────────────────────
   Bounds, not preferences. Every one of these caps something that would otherwise
   let one bad document cost unbounded work: `steps` bounds the render loop, `spec`
   bounds the column, `variants`/`ladder` bound arrays the render indexes into. An
   AI author is exactly the caller that finds these, so they are enforced (400) at
   the write door rather than trusted. */
const LIMITS = {
  steps: 40,          // a session with 41 exercises is a bug, not a workout
  phases: 12,
  variants: 12,
  ladder: 52,         // one value a week for a year
  vars: 24,
  tags: 12,
  spec: 20000,        // characters of JSON in the `spec` column
  prescription: 20000,
  performed: 20000,
  sets: 40,           // per step, and per logged step
  title: 200,
  notes: 2000,
  key: 60,
};

/* ── Small pure helpers ───────────────────────────────────────────────────── */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A finite number or `fallback`. Accepts the numeric strings an AI emits ("3"),
 *  because rejecting those would fail documents that are correct in every way that
 *  matters. */
function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}
/** A finite integer in [lo, hi], or `fallback`. */
function int(v, fallback = null, lo = -1e9, hi = 1e9) {
  const n = num(v, null);
  if (n === null) return fallback;
  return clamp(Math.trunc(n), lo, hi);
}
/** Trimmed, capped string, or `fallback` for anything empty. */
function str(v, cap = LIMITS.title, fallback = null) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim().slice(0, cap);
  return s === '' ? fallback : s;
}
/** One of `list`, case-insensitively, or `fallback`. The whole enum discipline. */
function pick(v, list, fallback) {
  const s = v === null || v === undefined ? '' : String(v).trim().toLowerCase();
  return list.includes(s) ? s : fallback;
}

/** A URL-ish slug from any label — the key generator for a step whose author gave
 *  it a title and no key, and the fallback title for a `ref` that resolved to
 *  nothing. Deterministic (no counters, no randomness) so the same document
 *  normalises to the same keys every time, which is what makes re-import idempotent. */
function slugify(v, fallback = 'step') {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.key);
  return s || fallback;
}

/** "back-squat" → "Back Squat". Used when a step references a library entry that
 *  isn't there: the step still gets a readable title rather than a slug, which is
 *  the lossy-safe rule (a missing ref is a warning, never a broken routine). */
function humanize(slug) {
  return String(slug || '')
    .split(/[-_\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Step';
}

/** Round to a sensible increment — 2.5 lb plates, whole reps. `to` of 0 means
 *  don't round. Kept here rather than at each call site so the server's mint and
 *  the browser's preview round identically (they must, or the preview lies). */
function roundTo(n, to) {
  if (!to || to <= 0) return n;
  const r = Math.round(n / to) * to;
  // Guard the float dust 2.5-rounding produces (0.30000000000000004 and friends).
  return Math.round(r * 1000) / 1000;
}

/* ══════════════════════════════════════════════════════════════════════════════
   NORMALISATION

   Takes anything and returns a spec. This is where "every field optional" is
   actually implemented, so it never throws and never rejects — it fills, clamps,
   infers, and collects WARNINGS. Validation (below) is a separate pass that reads
   the RAW document and reports what a careful author would want to know; the two
   are split so that a document can be accepted-and-warned rather than facing the
   single all-or-nothing gate that makes an AI author's life impossible.
   ══════════════════════════════════════════════════════════════════════════════ */

/** The empty-but-valid spec. A routine with no document is not an error — it is a
 *  routine with no content yet, which is exactly what every routine created from
 *  the board's "+ New routine" button is for its first few seconds. */
function emptySpec() {
  return {
    v: SPEC_VERSION,
    intent: null,
    advance_on: 'completion',
    deload_every: 0,
    deload_factor: 0.6,
    round_load: 5,
    vars: {},
    phases: [],
    phase_repeat: 'loop',
    contributes: null,
    steps: [],
  };
}

/** What a routine contributes to the GOAL it hangs under. See normalizeContributes
 *  for why this is a metric and not a percentage. */
const MEASURES = ['sessions', 'volume', 'target', 'load'];
const WINDOWS = ['week', 'month', 'year', 'all'];

/**
 * A routine's contribution to its goal.
 *
 * THE PROBLEM IT SOLVES. A goal's progress is `done / total` over its descendant
 * tasks. A routine has no total — it never finishes — so its occurrences either
 * corrupt that fraction or have to be excluded from it, and both were tried. The
 * honest model is that a routine does not contribute PROGRESS, it contributes a
 * MEASUREMENT: "run 100 km this month", "300 sessions this year".
 *
 *   measure  sessions  count the sessions kept
 *            volume    sets × target, summed (the training-volume reading)
 *            target    the target alone, summed (distance, minutes, pages)
 *            load      load × sets × target, summed (tonnage)
 *   step     restrict to one step, or null for the whole session
 *   target   the number that counts as the goal met
 *   window   the period it resets over
 *
 * Actuals come from `performed` where it exists and fall back to the PRESCRIPTION
 * for a completed session with no per-step log — the same "silence means you did
 * what you were told" rule the autoregulation tally uses, and for the same reason.
 */
function normalizeContributes(raw, warnings) {
  if (!isObj(raw)) return null;
  const measure = pick(raw.measure ?? raw.metric, MEASURES, 'sessions');
  const target = num(raw.target ?? raw.goal, null);
  if (target === null || target <= 0) {
    warnings.push({
      path: 'contributes.target', code: 'NO_METRIC_TARGET',
      message: 'a contribution with no target measures nothing — dropped',
    });
    return null;
  }
  return {
    measure,
    step: raw.step ? slugify(raw.step, '') || null : null,
    target,
    window: pick(raw.window ?? raw.per, WINDOWS, 'month'),
    label: str(raw.label, LIMITS.title),
  };
}

/** Normalise one step. `resolve` is an optional (slug, collection) → library entry
 *  lookup; when a step carries a `ref` its library entry supplies defaults UNDER
 *  everything the step states explicitly. That precedence is the point of the
 *  library: an agent writes `{ ref: 'back-squat', sets: 5 }` and gets a complete,
 *  correctly-united step with its own set count honoured. */
function normalizeStep(raw, index, warnings, resolve) {
  const src = isObj(raw) ? raw : { title: String(raw ?? '') };

  const ref = str(src.ref ?? src.library ?? src.from, LIMITS.key);
  const collection = pick(src.collection, COLLECTIONS, null);
  let entry = null;
  if (ref && typeof resolve === 'function') {
    entry = resolve(slugify(ref), collection) || null;
    if (!entry) {
      warnings.push({
        path: `steps[${index}].ref`, code: 'REF_UNRESOLVED',
        message: `no library entry '${ref}' — the step keeps what it declared`,
      });
    }
  }
  const d = isObj(entry?.defaults) ? entry.defaults : {};

  const title = str(src.title ?? src.name ?? entry?.title, LIMITS.title)
    || (ref ? humanize(ref) : `Step ${index + 1}`);
  const key = slugify(src.key ?? src.id ?? ref ?? title, `step-${index + 1}`);

  /* The variant LADDER — ordered easiest → hardest. This is the second axis of
     difficulty and the only one bodyweight work has: numbers can't make a push-up
     harder, a decline push-up can. Comes from the step, else from the library
     entry, so an agent gets a real ladder for free by writing one `ref`. */
  const rawVariants = Array.isArray(src.variants) ? src.variants
    : Array.isArray(entry?.variants) ? entry.variants : [];
  const variants = rawVariants
    .map((v) => str(isObj(v) ? v.title ?? v.name : v, LIMITS.title))
    .filter(Boolean)
    .slice(0, LIMITS.variants);

  const unit = pick(src.unit ?? entry?.unit ?? d.unit, UNITS, 'reps');
  const loadRaw = num(src.load ?? d.load, null);
  const loadUnit = pick(src.load_unit ?? entry?.load_unit ?? d.load_unit, LOAD_UNITS,
    loadRaw !== null ? 'lb' : null);

  return {
    key,
    ref: ref ? slugify(ref) : null,
    collection: collection || pick(entry?.collection, COLLECTIONS, null),
    title,
    block: pick(src.block, BLOCKS, 'main'),
    /* Supersets, flat: two steps sharing a group letter are done together. A tag
       rather than a nested array for the same reason `block` is — an author who
       can't nest can still write "A". */
    group: str(src.group, 8),
    unit,
    sets: int(src.sets ?? d.sets, 1, 1, LIMITS.sets),
    target: num(src.target ?? src.reps ?? src.value ?? d.target ?? d.reps, null),
    load: loadRaw,
    load_unit: loadUnit,
    rest: int(src.rest ?? d.rest, null, 0, 3600),
    variants,
    /* Where on the ladder this step starts, and how often it climbs. A SEPARATE
       clock from `progression` on purpose: a step commonly progresses reps every
       session AND the movement every six weeks, and folding both into one rule
       would need either an array of rules (which an author gets wrong) or a
       special case in every progression type (which the render would carry
       forever). One number, one meaning. */
    variant_index: variants.length
      ? clamp(int(src.variant_index ?? d.variant_index, 0, 0, variants.length - 1), 0, variants.length - 1)
      : 0,
    variant_every: int(src.variant_every ?? d.variant_every, 0, 0, 999),
    /* PROMOTE ON CAP — the two axes of difficulty, coupled.
     *
     * `variant_every` climbs the ladder on a CLOCK ("harder movement every six
     * weeks"). This climbs it on an ACHIEVEMENT: when the load rule hits its cap,
     * the excess converts into ladder rungs and the load resets to where it
     * started. That is how bodyweight and machine work actually progresses — you
     * do not add weight to a push-up, you do a harder push-up, and you do so when
     * the current one stops being hard rather than when a calendar says so.
     *
     * Needs both a cap and a ladder to mean anything; the lint says so when one is
     * missing rather than the render silently doing nothing. */
    promote_on_cap: src.promote_on_cap === true || src.promote_on_cap === 1
      || d.promote_on_cap === true || d.promote_on_cap === 1,
    progression: normalizeProgressions(src.progression ?? src.progressions ?? d.progression, src, index, warnings),
    notes: str(src.notes ?? src.note ?? entry?.notes, LIMITS.notes),
  };
}

/**
 * Normalise a step's progression into an ARRAY OF RULES.
 *
 * WHY AN ARRAY. A step commonly gets harder in more than one way at once: reps
 * climb every session AND the movement gets harder every six weeks AND a fourth set
 * appears in the second month. The original single-rule model could express exactly
 * one of those, and the workaround — folding the second axis into every progression
 * type as a special case — is the thing that would have made this file unreadable
 * within a year.
 *
 * The normalised shape is ALWAYS an array, even for the overwhelmingly common
 * one-rule case, so nothing downstream has to branch on "is this one rule or
 * several". A bare object, a bare string, or nothing at all all normalise into it.
 *
 * RULES ARE APPLIED IN DOCUMENT ORDER and the last writer of a field wins (see
 * applyProgressions). Two rules driving the same field is almost always a mistake
 * rather than an intent, so it is linted — but it is not an error, because the
 * resolution is well-defined and refusing the document would be worse than
 * rendering it and saying so.
 *
 * @returns {Array} always an array; `[]` means "never gets harder"
 */
function normalizeProgressions(raw, step, index, warnings) {
  const list = Array.isArray(raw) ? raw : (raw === null || raw === undefined ? [] : [raw]);
  const out = [];
  for (const entry of list.slice(0, MAX_RULES)) {
    const rule = normalizeProgression(entry, step, index, warnings);
    if (rule.type !== 'fixed') out.push(rule);   // `fixed` IS the empty array
  }
  /* Two rules on the same field: defined, but almost certainly not what was meant. */
  const byField = new Map();
  for (const r of out) {
    if (byField.has(r.drives)) {
      warnings.push({
        path: `steps[${index}].progression`, code: 'RULES_COLLIDE',
        message: `two rules both move '${r.drives}' — the later one wins`,
      });
    }
    byField.set(r.drives, r);
  }
  return out;
}

/** At most this many rules on one step. A bound, not a preference: applyProgressions
 *  folds them per step per render, and the render runs on every unfiltered read. */
const MAX_RULES = 6;

/** Normalise ONE progression rule. An unknown or absent type becomes `fixed`, which
 *  is why a step that says nothing about getting harder simply never does — the
 *  lossy-safe default, and the correct one for most of what people do daily. */
function normalizeProgression(raw, step, index, warnings) {
  if (raw === null || raw === undefined) return { type: 'fixed' };

  /* A bare string is accepted — `"progression": "linear"` is what an agent writes
     about a third of the time, and refusing it would fail a document whose intent
     is unambiguous. */
  const src = isObj(raw) ? raw : { type: raw };
  const asked = str(src.type, 40);
  const type = pick(asked, PROGRESSIONS, 'fixed');
  if (asked && type !== pick(asked, PROGRESSIONS, null)) {
    warnings.push({
      path: `steps[${index}].progression.type`, code: 'UNKNOWN_PROGRESSION',
      message: `'${asked}' is not a progression type — treated as 'fixed'`,
      expected: PROGRESSIONS,
    });
  }
  if (type === 'fixed') return { type: 'fixed' };

  /* What the rule MOVES. Inferred rather than required: a rule on a step that
     carries a load moves the load; on a step that doesn't, it moves the count.
     That inference is right almost always and wrong harmlessly (the author sees
     the rendered preview and says so). */
  const inferredDrives = num(step?.load, null) !== null ? 'load' : 'target';
  const drives = pick(src.drives ?? src.field, DRIVES, inferredDrives);

  const range = Array.isArray(src.range) ? src.range : null;
  const lo = int(range?.[0] ?? src.min ?? src.from, null);
  const hi = int(range?.[1] ?? src.max ?? src.to, null);

  /* The default STEP SIZE depends on what is being moved, and getting this wrong
     is the difference between a routine that works out of the box and one that
     jumps five rungs up a variant ladder on session two. A percentage creeps by
     2.5 points; a ladder position or a set count moves by one; a load moves by the
     smallest plate pair. An explicit `increment` always wins. */
  const defaultIncrement = type === 'percent' ? 0.025
    : (drives === 'variant' || drives === 'sets') ? 1
    : 5;

  const out = {
    type,
    drives,
    increment: num(src.increment ?? src.step ?? src.by, defaultIncrement),
    every: int(src.every ?? src.per, 1, 1, 365),
    cap: num(src.cap ?? src.ceiling ?? src.limit, null),
    floor: num(src.floor ?? src.least, null),
  };

  if (type === 'double' || type === 'autoregulated') {
    /* The rep range IS the rule for these two, so a missing one is filled rather
       than fatal: 5–8 is the range most written programs use and the one a reader
       will recognise as a default rather than as a claim. */
    if (lo === null || hi === null || hi <= lo) {
      warnings.push({
        path: `steps[${index}].progression.range`, code: 'RANGE_DEFAULTED',
        message: 'no usable [low, high] range — defaulted to [5, 8]',
      });
      out.range = [5, 8];
    } else {
      out.range = [lo, clamp(hi, lo + 1, lo + 200)];
    }
    out.drives = 'target';     // by definition: reps climb, then load steps
  }

  if (type === 'ladder') {
    const values = (Array.isArray(src.values) ? src.values : [])
      .map((v) => num(v, null)).filter((v) => v !== null).slice(0, LIMITS.ladder);
    out.values = values;
    out.repeat = pick(src.repeat, PHASE_REPEAT, 'hold');
    if (!values.length) {
      warnings.push({
        path: `steps[${index}].progression.values`, code: 'LADDER_EMPTY',
        message: 'a ladder with no values never changes anything — treated as fixed',
      });
      return { type: 'fixed' };
    }
  }

  if (type === 'percent') {
    out.of = slugify(src.of ?? src.var ?? src.max ?? '', '');
    out.start = num(src.start ?? src.from, 0.6);
    if (out.cap === null) out.cap = 0.95;
    if (!out.of) {
      warnings.push({
        path: `steps[${index}].progression.of`, code: 'PERCENT_NO_VAR',
        message: 'percent progression names no variable — treated as fixed',
      });
      return { type: 'fixed' };
    }
  }

  return out;
}

/** One phase of a block program: a named stretch of cycles that scales the whole
 *  session. `intensity` multiplies every rendered load and `sets_delta` shifts
 *  every set count, so "Build is 10% heavier" is one number in one place rather
 *  than an edit to every step — which is the same "don't refactor the routine"
 *  property progression gives on the step axis, applied to the program axis. */
function normalizePhase(raw, index) {
  const src = isObj(raw) ? raw : { name: String(raw ?? '') };
  return {
    name: str(src.name ?? src.title, LIMITS.title) || `Phase ${index + 1}`,
    cycles: int(src.cycles ?? src.length ?? src.weeks, 4, 1, 520),
    intensity: clamp(num(src.intensity ?? src.factor, 1) ?? 1, 0.1, 3),
    sets_delta: int(src.sets_delta ?? src.sets_offset, 0, -20, 20),
    notes: str(src.notes, LIMITS.notes),
  };
}

/**
 * Normalise a whole document. NEVER THROWS — that is the contract. `raw` may be a
 * JSON string, an object, null, or nonsense; the result is always a spec plus the
 * list of things that were quietly fixed.
 *
 * @param {*} raw            the document, as an object or a JSON string
 * @param {object} [opts]
 * @param {function} [opts.resolve]  (slug, collection) → library entry
 * @returns {{spec: object, warnings: Array}}
 */
function normalizeSpec(raw, opts = {}) {
  const warnings = [];
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); }
    catch { warnings.push({ path: '', code: 'UNPARSEABLE', message: 'spec was not valid JSON — treated as empty' }); src = null; }
  }
  if (!isObj(src)) return { spec: emptySpec(), warnings };

  const spec = emptySpec();
  spec.intent = str(src.intent ?? src.goal ?? src.purpose, LIMITS.notes);
  spec.advance_on = pick(src.advance_on ?? src.advance, ADVANCE_ON, 'completion');
  spec.deload_every = int(src.deload_every ?? src.deload, 0, 0, 52);
  spec.deload_factor = clamp(num(src.deload_factor, 0.6) ?? 0.6, 0.1, 1);
  spec.round_load = clamp(num(src.round_load ?? src.rounding, 5) ?? 5, 0, 100);
  spec.phase_repeat = pick(src.phase_repeat, PHASE_REPEAT, 'loop');

  /* Named numbers the document can point at — a one-rep max, a target pace, a
     class size. They exist so `percent` progression has something to be a percent
     OF, and so the one number a whole routine turns on can be updated in one place
     instead of being copied into eight steps. */
  const vars = isObj(src.vars ?? src.variables) ? (src.vars ?? src.variables) : {};
  for (const [k, v] of Object.entries(vars).slice(0, LIMITS.vars)) {
    const n = num(v, null);
    if (n !== null) spec.vars[slugify(k, 'var')] = n;
  }

  const phases = Array.isArray(src.phases) ? src.phases : [];
  spec.phases = phases.slice(0, LIMITS.phases).map(normalizePhase);
  spec.contributes = normalizeContributes(src.contributes ?? src.metric, warnings);

  /* `steps` is the document. The aliases are the three names an author reaches for
     when they haven't read the schema, and accepting them costs one line each. */
  const steps = Array.isArray(src.steps) ? src.steps
    : Array.isArray(src.exercises) ? src.exercises
    : Array.isArray(src.items) ? src.items : [];
  if (steps.length > LIMITS.steps) {
    warnings.push({
      path: 'steps', code: 'TRUNCATED',
      message: `only the first ${LIMITS.steps} steps are kept (${steps.length} given)`,
    });
  }
  const seen = new Set();
  spec.steps = steps.slice(0, LIMITS.steps).map((s, i) => {
    const step = normalizeStep(s, i, warnings, opts.resolve);
    /* Keys must be unique — the prescription and the performed log are both keyed
       by them, so a duplicate would make one step's record silently overwrite
       another's. De-duplicated rather than rejected, because the collision is
       almost always two sets of the same movement and the author meant both. */
    if (seen.has(step.key)) {
      let n = 2;
      while (seen.has(`${step.key}-${n}`)) n++;
      step.key = `${step.key}-${n}`;
    }
    seen.add(step.key);
    return step;
  });

  return { spec, warnings };
}

/* ══════════════════════════════════════════════════════════════════════════════
   VALIDATION

   Two tiers, and the split is the whole point:

     ERRORS   the document cannot be honoured as written. Rejected 400 with a
              machine-readable list so the author's next turn can fix itself.
     WARNINGS the document is honoured but is probably not what was meant, or is
              thin. ACCEPTED, echoed back. This tier exists because the common
              failure of an AI author is not invalid output — it is a routine with
              five steps and no progression on any of them, which is valid and
              useless. Nothing else in the system would ever say so.
   ══════════════════════════════════════════════════════════════════════════════ */

const err = (path, code, message, expected) => (
  expected ? { path, code, message, expected } : { path, code, message }
);

/**
 * @returns {{ok: boolean, errors: Array, warnings: Array}} — `errors` empty ⇒ ok.
 */
function validateSpec(raw, opts = {}) {
  const errors = [];
  let src = raw;

  if (src === null || src === undefined || src === '') return { ok: true, errors: [], warnings: [] };
  if (typeof src === 'string') {
    if (src.length > LIMITS.spec) {
      errors.push(err('', 'TOO_LARGE', `spec exceeds ${LIMITS.spec} characters`));
      return { ok: false, errors, warnings: [] };
    }
    try { src = JSON.parse(src); }
    catch (e) { return { ok: false, errors: [err('', 'INVALID_JSON', `spec is not valid JSON: ${e.message}`)], warnings: [] }; }
  }
  if (!isObj(src)) {
    return { ok: false, errors: [err('', 'NOT_AN_OBJECT', 'spec must be a JSON object')], warnings: [] };
  }

  /* HARD ERRORS — only the things the normaliser genuinely cannot paper over. The
     list is short by design: every entry here is a document an author must resubmit
     for, so each one has to earn the round trip. */
  const rawSteps = Array.isArray(src.steps) ? src.steps
    : Array.isArray(src.exercises) ? src.exercises
    : Array.isArray(src.items) ? src.items : null;
  if (src.steps !== undefined && !Array.isArray(src.steps)) {
    errors.push(err('steps', 'NOT_AN_ARRAY', 'steps must be an array'));
  }
  if (src.phases !== undefined && !Array.isArray(src.phases)) {
    errors.push(err('phases', 'NOT_AN_ARRAY', 'phases must be an array'));
  }
  if (src.vars !== undefined && !isObj(src.vars)) {
    errors.push(err('vars', 'NOT_AN_OBJECT', 'vars must be an object of name → number'));
  }
  (rawSteps || []).forEach((s, i) => {
    if (!isObj(s) && typeof s !== 'string') {
      errors.push(err(`steps[${i}]`, 'NOT_AN_OBJECT', 'each step must be an object (or a bare title string)'));
    }
  });
  if (errors.length) return { ok: false, errors, warnings: [] };

  /* Normalising is itself half the lint: everything it had to fix is worth saying. */
  const { spec, warnings } = normalizeSpec(src, opts);
  const lint = [...warnings];

  /* THE LINT TIER. Each of these is a real routine that is worse than the author
     meant it to be, and each is silent everywhere else in the system. */
  if (!spec.steps.length) {
    lint.push(err('steps', 'NO_STEPS', 'this routine has no steps — its occurrences will just be a title'));
  }
  if (spec.steps.length && spec.steps.every((s) => !s.progression.length)) {
    lint.push(err('steps', 'NO_PROGRESSION',
      'no step ever gets harder — a routine that never progresses is a repeating task',
      PROGRESSIONS.filter((p) => p !== 'fixed')));
  }
  spec.steps.forEach((s, i) => {
    if (s.target === null && s.unit !== 'count') {
      lint.push(err(`steps[${i}].target`, 'NO_TARGET',
        `'${s.title}' has no target — there is nothing to hit or to log against`));
    }
    s.progression.forEach((p, j) => {
      const at = `steps[${i}].progression[${j}]`;
      if (p.type === 'percent' && !(p.of in spec.vars)) {
        lint.push(err(`${at}.of`, 'VAR_MISSING',
          `'${p.of}' is not in vars — the percentage has nothing to be a percentage of`,
          Object.keys(spec.vars)));
      }
      if (p.drives === 'variant' && s.variants.length < 2) {
        lint.push(err(`steps[${i}].variants`, 'NO_LADDER',
          `'${s.title}' progresses by variant but has no ladder to climb`));
      }
      if (p.drives === 'load' && s.load === null) {
        lint.push(err(`steps[${i}].load`, 'NO_START_LOAD',
          `'${s.title}' progresses its load but never says where it starts — assumed 0`));
      }
      if (p.cap !== null && p.floor !== null && p.cap < p.floor) {
        lint.push(err(at, 'CAP_BELOW_FLOOR', 'cap is below floor — the value will pin to the cap'));
      }
      /* An uncapped rule on a COUNT is the quiet way a generated routine goes
         insane: +5 s a session is a five-minute plank by next spring, and nothing
         else in the system will ever mention it. Loads are exempt — a barbell's
         ceiling is the person, not the document. */
      if (p.cap === null && p.drives !== 'load' && p.drives !== 'variant' && p.type !== 'ladder') {
        lint.push(err(`${at}.cap`, 'UNCAPPED',
          `'${s.title}' climbs its ${p.drives} forever — no cap means it never stops`));
      }
    });
    /* Promote-on-cap needs both halves: something to cap, and somewhere to go. */
    if (s.promote_on_cap) {
      if (s.variants.length < 2) {
        lint.push(err(`steps[${i}].variants`, 'PROMOTE_NO_LADDER',
          `'${s.title}' promotes at its cap but has no ladder to be promoted onto`));
      }
      /* WHICH RULES MOVE THE LOAD is not the same question as `drives === 'load'`.
         `double` and `autoregulated` normalise `drives` to 'target' because the
         REPS are what their clock counts — but they step the load too, by
         definition, and a cap on one of them is exactly the cap promote-on-cap is
         waiting for. Asking the narrow question told a correctly-configured
         bodyweight ladder it had no cap to reach. */
      const capsLoad = (p) => p.cap !== null
        && (p.drives === 'load' || p.type === 'double' || p.type === 'autoregulated');
      if (!s.progression.some(capsLoad)) {
        lint.push(err(`steps[${i}].promote_on_cap`, 'PROMOTE_NO_CAP',
          `'${s.title}' promotes at its cap but no rule has a load cap to reach`));
      }
    }
  });

  /* The goal contribution — a routine that claims to feed a goal it isn't under
     will render a meter nobody sees. */
  if (spec.contributes && spec.contributes.step
    && !spec.steps.some((s) => s.key === spec.contributes.step)) {
    lint.push(err('contributes.step', 'STEP_MISSING',
      `'${spec.contributes.step}' is not a step in this routine`,
      spec.steps.map((s) => s.key)));
  }
  if (spec.phases.length === 1) {
    lint.push(err('phases', 'ONE_PHASE', 'a single phase is the same as no phases'));
  }
  if (spec.advance_on === 'calendar' && spec.deload_every > 0 && spec.phases.length) {
    lint.push(err('deload_every', 'DELOAD_AND_PHASES',
      'phases and a deload cadence both scale intensity — check they compose the way you meant'));
  }

  return { ok: true, errors: [], warnings: lint };
}

/* ══════════════════════════════════════════════════════════════════════════════
   RENDER — a spec + a cycle index → the concrete prescription

   This is the function whose output a person acts on, so read it as the contract
   it is. It is total (no throws, no NaN out), deterministic, and pure. Every
   number it returns has been through the same three stages:

       1. the step's own PROGRESSION rule, at this cycle
       2. the PHASE's intensity / set offset, if the program has phases
       3. the DELOAD factor, if this cycle is a deload

   Stage order matters and is fixed: progression is what the program says you have
   earned, phases and deloads are scalings applied to it. Scaling first and then
   progressing would compound (a deload would permanently lower everything after it),
   which is the classic bug in every spreadsheet version of this.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Which phase covers `cycle`, and how far into it we are. Returns a neutral phase
 *  when the spec has none, so the render has no branch for the common case. */
function phaseAt(spec, cycle) {
  const phases = spec?.phases || [];
  const c = Math.max(0, int(cycle, 0));
  if (!phases.length) return { name: null, index: 0, cycle: c, intensity: 1, sets_delta: 0 };

  const total = phases.reduce((n, p) => n + p.cycles, 0);
  let at = c;
  if (at >= total) {
    // Past the end of the written program: LOOP back to the start (a training block
    // you repeat) or HOLD in the final phase (a ramp to a plateau you stay on).
    if (spec.phase_repeat === 'hold') {
      const last = phases[phases.length - 1];
      return { name: last.name, index: phases.length - 1, cycle: at - (total - last.cycles), intensity: last.intensity, sets_delta: last.sets_delta };
    }
    at = at % total;
  }
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    if (at < acc + phases[i].cycles) {
      return { name: phases[i].name, index: i, cycle: at - acc, intensity: phases[i].intensity, sets_delta: phases[i].sets_delta };
    }
    acc += phases[i].cycles;
  }
  const last = phases[phases.length - 1];
  return { name: last.name, index: phases.length - 1, cycle: 0, intensity: last.intensity, sets_delta: last.sets_delta };
}

/** Is `cycle` a deload? Every Nth cycle counting from the first, so `deload_every:4`
 *  makes cycles 3, 7, 11 … the easy ones — the fourth session of each block, which
 *  is how every written program numbers them. */
function isDeload(spec, cycle) {
  const n = spec?.deload_every || 0;
  if (!n) return false;
  return (Math.max(0, int(cycle, 0)) + 1) % n === 0;
}

/**
 * The value a step's progression has reached at `cycle`.
 *
 * `earned` is the autoregulation input: how many times the user actually hit the
 * top of the range. It is only read by `autoregulated`, and it defaults to `cycle`
 * so that a step with no history behaves exactly like `double` rather than freezing
 * at its start — a routine must be usable on day one, before there is anything to
 * autoregulate against.
 *
 * @returns {{sets:?number, target:?number, load:?number, variant_shift:number}}
 *          Only the fields the rule MOVES are non-null; the caller keeps its own
 *          values for the rest.
 */
function progressionAt(step, cycle, earned) {
  return applyProgressions(step, cycle, earned);
}

/**
 * Fold every rule on a step into one movement.
 *
 * Rules are independent and are applied in DOCUMENT ORDER; the last writer of a
 * field wins (normalizeProgressions lints the collision). `variant_shift`
 * ACCUMULATES rather than overwriting — a step can be promoted by its cap AND
 * climbed by a `drives: 'variant'` rule, and both are real movements up the same
 * ladder, so adding them is the only reading that isn't arbitrary.
 */
function applyProgressions(step, cycle, earned) {
  const rules = Array.isArray(step.progression) ? step.progression : [];
  const out = { sets: null, target: null, load: null, variant_shift: 0 };
  for (const rule of rules) {
    const moved = ruleAt(step, rule, cycle, earned);
    if (moved.sets !== null) out.sets = moved.sets;
    if (moved.target !== null) out.target = moved.target;
    if (moved.load !== null) out.load = moved.load;
    if (moved.__fraction) out.__fraction = true;
    out.variant_shift += moved.variant_shift || 0;
  }
  return out;
}

/**
 * PROMOTE ON CAP — how many ladder rungs a capped load rule has bought, and where
 * the load sits inside the current rung.
 *
 * Without promotion a capped rule simply pins: you reach 155 lb and stay there
 * forever. With it, the tiers that WOULD have taken you past the cap are spent on
 * the movement instead — cap reached, climb the ladder, reset the load, start again.
 *
 * @param {number} base   the load the step starts at
 * @param {number} inc    the load added per tier
 * @param {?number} cap
 * @param {number} tier   how many tiers the rule has earned
 * @returns {{tier:number, shift:number}} the tier WITHIN the current rung, and the
 *          rungs climbed. Degenerate inputs (no cap, no increment, a cap at or below
 *          the base) return the tier untouched and no shift, so a nonsensical
 *          configuration pins exactly as it did before rather than dividing by zero.
 */
function promoteAtCap(base, inc, cap, tier) {
  if (cap === null || cap === undefined || !inc || inc <= 0) return { tier, shift: 0 };
  const perRung = Math.floor((cap - base) / inc) + 1;   // tiers that fit under the cap
  if (perRung <= 0) return { tier, shift: 0 };
  return { tier: tier % perRung, shift: Math.floor(tier / perRung) };
}

/** One rule, at one cycle. The maths of each progression type lives here and
 *  nowhere else. */
function ruleAt(step, rule, cycle, earned) {
  const p = rule || { type: 'fixed' };
  const c = Math.max(0, int(cycle, 0));
  const none = { sets: null, target: null, load: null, variant_shift: 0 };
  if (p.type === 'fixed') return none;

  /* The base the rule counts UP FROM is whichever field it drives. A rule that
     drives `load` on a step with no load starts from 0 — which the lint tier
     flags, because it is almost always an author who forgot to say. */
  const baseOf = (field) => {
    if (field === 'load') return num(step.load, 0) ?? 0;
    if (field === 'target') return num(step.target, 0) ?? 0;
    if (field === 'sets') return num(step.sets, 1) ?? 1;
    return 0;
  };
  const bound = (v) => {
    let out = v;
    if (p.floor !== null && p.floor !== undefined) out = Math.max(p.floor, out);
    if (p.cap !== null && p.cap !== undefined) out = Math.min(p.cap, out);
    return out;
  };
  const emit = (field, value) => {
    if (field === 'variant') return { ...none, variant_shift: Math.trunc(value) };
    return { ...none, [field]: value };
  };

  if (p.type === 'linear') {
    let n = Math.floor(c / (p.every || 1));
    /* A capped LOAD rule on a promote-on-cap step spends its overflow on the
       ladder instead of pinning. Only load: promoting because you hit a REP cap
       would mean a harder movement for the same reps, which is a different (and
       rarer) intent than the one this flag names. */
    if (step.promote_on_cap && p.drives === 'load') {
      const base = baseOf('load');
      const { tier, shift } = promoteAtCap(base, p.increment, p.cap, n);
      if (shift) return { ...none, load: base + p.increment * tier, variant_shift: shift };
      n = tier;
    }
    return emit(p.drives, bound(baseOf(p.drives) + p.increment * n));
  }

  if (p.type === 'ladder') {
    const vals = p.values || [];
    if (!vals.length) return none;
    const i = p.repeat === 'loop' ? c % vals.length : Math.min(c, vals.length - 1);
    return emit(p.drives, bound(vals[i]));
  }

  if (p.type === 'percent') {
    /* The fraction creeps and the max stays put, so "80% of my squat max" becomes a
       real number that follows the max when it is updated in ONE place. */
    const frac = Math.min(p.cap ?? 0.95, (p.start ?? 0.6) + p.increment * Math.floor(c / (p.every || 1)));
    return { ...none, load: frac, target: null, sets: null, __fraction: true };
  }

  if (p.type === 'double' || p.type === 'autoregulated') {
    /* DOUBLE PROGRESSION. Reps climb through the range one cycle at a time; when
       the range is topped the load steps up and the reps drop back to the bottom.
       Two numbers moving on one clock, which is why the type exists rather than
       being two rules an author has to keep in sync.
       AUTOREGULATED is the same maths on a different clock — advances counted, not
       cycles elapsed — so missing the top of the range holds you where you are
       instead of marching the load up past what you can lift. */
    const clock = p.type === 'autoregulated'
      ? Math.max(0, int(earned === null || earned === undefined ? c : earned, 0))
      : c;
    const [lo, hi] = p.range || [5, 8];
    const span = Math.max(1, hi - lo + 1);
    const rung = clock % span;
    let tier = Math.floor(clock / span);
    let shift = 0;
    const base = num(step.load, null);
    /* Promote on cap: the load tiers past the cap become ladder rungs. This is the
       case the flag exists for — "double progression until you can't add weight,
       then a harder variation" is how every bodyweight programme is actually
       written, and before this it needed two routines. */
    if (step.promote_on_cap && base !== null) {
      const p2 = promoteAtCap(base, p.increment, p.cap, tier);
      tier = p2.tier; shift = p2.shift;
    }
    let load = base;
    if (load !== null) {
      load = load + p.increment * tier;
      if (!shift && p.cap !== null && p.cap !== undefined) load = Math.min(p.cap, load);
      if (p.floor !== null && p.floor !== undefined) load = Math.max(p.floor, load);
    }
    return { sets: null, target: lo + rung, load, variant_shift: shift };
  }

  return none;
}

/** One step, rendered at one cycle. Exported because the preview renders a single
 *  step across many cycles (the ladder view) and re-rendering the whole session
 *  each time would be wasteful and would fight the phase lookup. */
function renderStep(spec, step, cycle, ctx = {}) {
  const ph = ctx.phase || phaseAt(spec, cycle);
  const deload = ctx.deload === undefined ? isDeload(spec, cycle) : ctx.deload;
  const earned = ctx.earned === undefined ? undefined : ctx.earned;

  const moved = progressionAt(step, cycle, earned);

  let sets = moved.sets !== null ? moved.sets : step.sets;
  let target = moved.target !== null ? moved.target : step.target;
  let load = moved.load !== null ? moved.load : step.load;

  /* `percent` returns a FRACTION, resolved here against the spec's vars — kept out
     of progressionAt so that function needs no access to the document and stays
     testable as a rule in isolation. */
  if (moved.__fraction) {
    /* `percent` returns a FRACTION, resolved here against the spec's vars — kept out
       of the rule maths so that stays testable without a document. The rule that
       produced it is found by type, because with several rules on a step the
       fraction can have come from any of them. */
    const pct = step.progression.find((p) => p.type === 'percent');
    const max = pct ? spec.vars?.[pct.of] : undefined;
    load = max === undefined ? null : max * moved.load;
  }

  /* Stage 2 — the phase, then stage 3 — the deload. Both scale; neither is fed
     back into the progression (see the header note on compounding). */
  const scale = (ph.intensity || 1) * (deload ? (spec.deload_factor ?? 0.6) : 1);
  if (load !== null && scale !== 1) load = load * scale;
  /* Sets are a COUNT — a rule that drives them can arrive here fractional (a linear
     +0.5), and "2.5 sets" is not a thing anyone can do. Rounded once, here, so no
     surface has to decide. */
  if (sets !== null) sets = Math.max(1, Math.round(sets) + (ph.sets_delta || 0));
  /* A deload drops the volume too — an easier week that keeps every set is not an
     easier week. Targets are left alone: the movement pattern shouldn't change. */
  if (deload && sets !== null) sets = Math.max(1, Math.round(sets * (spec.deload_factor ?? 0.6)));

  if (load !== null) load = Math.max(0, roundTo(load, spec.round_load ?? 5));
  if (target !== null) target = Math.max(0, Math.round(target * 100) / 100);

  /* The variant ladder — its own clock (see normalizeStep), plus any shift a
     `drives:'variant'` rule contributed. Clamped, never wrapped: topping out the
     ladder means you stay on the hardest variation, not that you cycle back to the
     easiest one. */
  const vi = step.variants.length
    ? clamp(
      step.variant_index
        + (step.variant_every > 0 ? Math.floor(cycle / step.variant_every) : 0)
        + (moved.variant_shift || 0),
      0, step.variants.length - 1,
    )
    : 0;

  const out = {
    key: step.key,
    title: step.variants.length ? step.variants[vi] : step.title,
    base_title: step.title,
    block: step.block,
    group: step.group,
    variant: step.variants.length ? step.variants[vi] : null,
    variant_index: step.variants.length ? vi : null,
    sets,
    target,
    unit: step.unit,
    load,
    load_unit: step.load_unit,
    rest: step.rest,
    notes: step.notes,
  };
  out.line = stepLine(out);
  return out;
}

/**
 * The whole session, rendered at one cycle. THIS IS WHAT GETS SNAPSHOTTED onto an
 * occurrence, and what every surface reads instead of re-deriving anything.
 *
 * @param {object} spec    a NORMALISED spec (call normalizeSpec first)
 * @param {number} cycle   0-based; see routines.js for how it is derived
 * @param {object} [ctx]   { earned: {stepKey: n} } for autoregulated steps
 */
function renderCycle(spec, cycle, ctx = {}) {
  const s = spec && Array.isArray(spec.steps) ? spec : emptySpec();
  const c = Math.max(0, int(cycle, 0));
  const ph = phaseAt(s, c);
  /* DELOAD ON DEMAND. `ctx.deload` forces this one session light regardless of the
     programme's own deload cadence — the "take this one easy" the routine model
     could not express, and by far the commonest real-world need. It is a per-
     OCCURRENCE override (the `deload_override` column), not a spec edit, because it
     is a decision about today and not a change to the plan. The engine also gives
     such a session NO RUNG on the cycle ladder (routines.js), so taking it easy
     does not spend a session's worth of progress. */
  const deload = ctx.deload === true ? true : (ctx.deload === false ? false : isDeload(s, c));
  const earned = isObj(ctx.earned) ? ctx.earned : {};

  const order = new Map(BLOCKS.map((b, i) => [b, i]));
  const steps = s.steps
    .map((step, i) => ({ step, i }))
    .sort((a, b) => (order.get(a.step.block) ?? 99) - (order.get(b.step.block) ?? 99) || a.i - b.i)
    .map(({ step }) => renderStep(s, step, c, { phase: ph, deload, earned: earned[step.key] }));

  const out = {
    v: SPEC_VERSION,
    /* WHICH REVISION of the document produced this. `v` is the format version (how
       to READ the snapshot); `sv` is the routine's own revision number (WHAT was
       being followed). Stamped so "why was I doing 5 × 5 in March" is answerable
       against routine_revisions rather than being lost the moment the spec changes —
       which is precisely the question a frozen snapshot exists to make askable. */
    sv: int(ctx.spec_version, null, 0, 1e9),
    cycle: c,
    phase: ph.name,
    phase_cycle: ph.cycle,
    deload,
    /* True when this session is light because the USER asked, not because the
       programme said so — so the card can say "you took this one easy" rather than
       implying the plan called for it. */
    deload_forced: ctx.deload === true && !isDeload(s, c),
    steps,
  };
  out.line = sessionLine(out);
  return out;
}

/* ── Display strings ──────────────────────────────────────────────────────────
   Rendered HERE, once, and carried in the snapshot as `line`. Not because the UI
   couldn't format them, but because there are now several surfaces that need the
   same sentence — the board, the day card, the detail panel, an export, and any
   peer app reading the row through the weave — and "3 × 6 @ 100 lb" formatted five
   ways is the drift this whole file is organised against. A dumb consumer can print
   `line` and be correct. */

/** "3 × 6 @ 100 lb" · "45 sec" · "5 × 5 @ bw". */
function stepLine(r) {
  const parts = [];
  const count = r.target !== null && r.target !== undefined;
  const showUnit = r.unit && r.unit !== 'reps' && r.unit !== 'count';

  if (r.sets > 1 && count) parts.push(`${r.sets} × ${r.target}${showUnit ? ` ${r.unit}` : ''}`);
  else if (count) parts.push(`${r.target}${showUnit ? ` ${r.unit}` : ''}`);
  else if (r.sets > 1) parts.push(`${r.sets} sets`);

  if (r.load !== null && r.load !== undefined && r.load_unit !== 'bw') {
    parts.push(`@ ${r.load}${r.load_unit ? ` ${r.load_unit}` : ''}`);
  } else if (r.load_unit === 'bw') {
    parts.push('@ bodyweight');
  }
  return parts.join(' ') || '—';
}

/** "Build · session 7 · 5 steps" — the one-line header for an occurrence. */
function sessionLine(p) {
  const bits = [];
  if (p.phase) bits.push(p.phase);
  bits.push(`session ${p.cycle + 1}`);
  if (p.deload) bits.push('deload');
  bits.push(`${p.steps.length} step${p.steps.length === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/** A routine's document in one line, for a board row that has no space for more. */
function summarize(spec) {
  if (!spec || !spec.steps?.length) return null;
  const bits = [`${spec.steps.length} step${spec.steps.length === 1 ? '' : 's'}`];
  const kinds = [...new Set(spec.steps.flatMap((s) => s.progression.map((p) => p.type)))];
  if (kinds.length) bits.push(kinds.join('/'));
  if (spec.phases.length) bits.push(spec.phases.map((p) => p.name).join(' → '));
  if (spec.deload_every) bits.push(`deload every ${spec.deload_every}`);
  return bits.join(' · ');
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE CADENCE — when a routine fires

   Lives HERE rather than in routines.js because it must be pure and mirrored: the
   forge previews an unsaved cadence, and `pnpm check:routine` drives this and the
   browser's copy through the same dates. routines.js keeps the MINT (the database
   half); this is the date maths it mints from.

   Every mode returns the same shape — a list of `{date, week}` — so the engine has
   exactly one code path regardless of how the schedule was written down.
   ══════════════════════════════════════════════════════════════════════════════ */

const isoOf = (d) => d.toISOString().slice(0, 10);
const parseISO = (s) => new Date(`${s}T00:00:00Z`);
const shiftDays = (s, n) => { const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
/** The Monday on or before `s`. The suite's week starts Monday everywhere. */
function isoWeekStart(s) {
  const d = parseISO(s);
  const dow = d.getUTCDay();               // 0=Sun … 6=Sat
  return shiftDays(s, -(dow === 0 ? 6 : dow - 1));
}
const daysBetween = (a, b) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);

/**
 * Parse a `cadence_rule` string into a mode. Empty/absent → `weekly`, which is what
 * every routine written before this existed is, and therefore what nothing has to
 * be migrated away from.
 *
 * The grammar is deliberately tiny and positional — `type:argument` — because it is
 * a value in a TEXT column that both an author and a validator have to read, and a
 * nested object in a second column would be a second document to keep in sync with
 * the first.
 *
 *   ''                       weekly (the default)
 *   'every_n_days:3'         every third day from the routine's start
 *   'monthly:15'             the 15th of each month
 *   'monthly:last'           the last day of each month
 *   'rolling:3'              3 times per rolling 7 days, anchored on the start
 *   'rrule:FREQ=WEEKLY;...'  the RFC 5545 subset below
 *
 * Never throws; an unparseable rule falls back to weekly and says so, because a
 * cadence that fails to parse must not stop a routine existing.
 */
function parseCadence(rule) {
  const raw = String(rule || '').trim();
  if (!raw) return { type: 'weekly' };
  const i = raw.indexOf(':');
  const type = pick(i < 0 ? raw : raw.slice(0, i), CADENCES, null);
  const arg = i < 0 ? '' : raw.slice(i + 1).trim();
  if (!type || type === 'weekly') return { type: 'weekly' };

  if (type === 'every_n_days') return { type, n: clamp(int(arg, 2, 1, 365), 1, 365) };
  if (type === 'rolling') return { type, n: clamp(int(arg, 1, 1, 21), 1, 21) };
  if (type === 'monthly') {
    if (arg.toLowerCase() === 'last') return { type, day: 'last' };
    return { type, day: clamp(int(arg, 1, 1, 31), 1, 31) };
  }
  if (type === 'rrule') return parseRRule(arg);
  return { type: 'weekly' };
}

/** Serialise a parsed cadence back to its string. The round trip the forge needs,
 *  and the reason the grammar is small enough to have one. */
function formatCadence(c) {
  if (!c || !c.type || c.type === 'weekly') return '';
  if (c.type === 'every_n_days') return `every_n_days:${c.n}`;
  if (c.type === 'rolling') return `rolling:${c.n}`;
  if (c.type === 'monthly') return `monthly:${c.day}`;
  if (c.type === 'rrule') return `rrule:${c.rrule}`;
  return '';
}

/* RFC 5545, the part of it that can be drawn and checked.
 *
 * SUPPORTED: FREQ (DAILY|WEEKLY|MONTHLY), INTERVAL, BYDAY (weekday names, no
 * ordinal prefixes), BYMONTHDAY, COUNT, UNTIL.
 * NOT SUPPORTED, and rejected rather than half-honoured: BYSETPOS, BYWEEKNO,
 * BYYEARDAY, ordinal BYDAY (`2MO`), FREQ=YEARLY/HOURLY, EXDATE, RDATE, timezones.
 *
 * Rejected rather than ignored is the whole point. A rule that silently drops
 * BYSETPOS produces a schedule that looks right and is not, and that is exactly the
 * failure this format spends its whole design avoiding. An unsupported part
 * degrades the rule to weekly and is reported. */
const RRULE_DAYS = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const RRULE_UNSUPPORTED = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYMONTH', 'EXDATE', 'RDATE', 'WKST'];

function parseRRule(text) {
  const src = String(text || '').replace(/^RRULE:/i, '').trim();
  const parts = new Map();
  for (const chunk of src.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    parts.set(chunk.slice(0, eq).trim().toUpperCase(), chunk.slice(eq + 1).trim());
  }
  const unsupported = RRULE_UNSUPPORTED.filter((k) => parts.has(k));
  const freq = String(parts.get('FREQ') || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq) || unsupported.length) {
    return { type: 'weekly', rrule_error: unsupported.length
      ? `unsupported: ${unsupported.join(', ')}`
      : `unsupported FREQ '${freq || '(none)'}'` };
  }
  const byday = String(parts.get('BYDAY') || '').split(',')
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
  if (byday.some((d) => !(d in RRULE_DAYS))) {
    return { type: 'weekly', rrule_error: 'ordinal BYDAY (e.g. 2MO) is not supported' };
  }
  const untilRaw = String(parts.get('UNTIL') || '').trim();
  const until = /^\d{8}/.test(untilRaw)
    ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`
    : (/^\d{4}-\d{2}-\d{2}$/.test(untilRaw) ? untilRaw : null);

  return {
    type: 'rrule',
    rrule: src,
    freq,
    interval: clamp(int(parts.get('INTERVAL'), 1, 1, 365), 1, 365),
    byday: byday.map((d) => RRULE_DAYS[d]),
    bymonthday: String(parts.get('BYMONTHDAY') || '').split(',')
      .map((v) => int(v, null, 1, 31)).filter((v) => v !== null),
    count: int(parts.get('COUNT'), null, 1, 1000),
    until,
  };
}

/**
 * Expand a cadence into the dates it fires on, within `[from, to]` inclusive.
 *
 * PURE and BOUNDED — the window is the caller's horizon, and every mode steps
 * forward by at least a day, so the loop is bounded by the window regardless of how
 * strange the rule is. That property is why this can be handed untrusted input.
 *
 * FLOATS ARE EMITTED HERE TOO, not bolted on afterwards. A float is an occurrence
 * committed to a WINDOW but not to a day ("three times this week, whenever") — it
 * carries a `week` and no `date`, which is exactly the shape the week bench already
 * renders and accepts drops onto. Producing them in the same pass as dated
 * occurrences is what lets the engine have one loop instead of two, and is why
 * `rolling` needed no new mint path at all.
 *
 * @param {object} cadence  parseCadence() output
 * @param {object} opts     { from, to, anchor, days, floats } — `anchor` is the
 *                          routine's start date (what interval modes count from),
 *                          `days` the weekly mode's Monday offsets, `floats` how
 *                          many undated occurrences each week carries
 * @returns {Array<{date:?string, week:string, float?:boolean, index?:number}>}
 */
function expandCadence(cadence, { from, to, anchor, days = [], floats = 0 }) {
  const c = cadence || { type: 'weekly' };
  const out = [];
  const push = (date) => { if (date >= from && date <= to) out.push({ date, week: isoWeekStart(date) }); };
  /* A float belongs to its window, so it is kept while any part of that window is
     still in range — a week that has started is a week you can still do it in. */
  const pushFloat = (week, index) => {
    if (shiftDays(week, 6) < from || week > to) return;
    out.push({ date: null, week, float: true, index });
  };
  const start = anchor && anchor <= from ? anchor : from;

  if (c.type === 'weekly') {
    for (let wk = isoWeekStart(from); wk <= to; wk = shiftDays(wk, 7)) {
      for (const off of days) push(shiftDays(wk, off));
      for (let i = 0; i < floats; i++) pushFloat(wk, i);
    }
    return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }

  if (c.type === 'every_n_days') {
    /* Counted from the ANCHOR, not from the window — otherwise the phase of the
       interval would shift every time the horizon rolled forward, and "every third
       day" would drift into "every third day, sometimes". */
    const n = c.n;
    const gap = daysBetween(anchor || from, from);
    let cursor = shiftDays(anchor || from, Math.max(0, Math.ceil(gap / n)) * n);
    while (cursor <= to) { push(cursor); cursor = shiftDays(cursor, n); }
    return out;
  }

  if (c.type === 'monthly') {
    const d0 = parseISO(from);
    for (let m = 0; m <= 14; m++) {
      const probe = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1));
      const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate();
      // A 31st in a 30-day month lands on the 30th rather than spilling into the
      // next month, which is what every calendar app does and what people expect.
      const day = c.day === 'last' ? lastDay : Math.min(c.day, lastDay);
      const date = isoOf(new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), day)));
      if (date > to) break;
      push(date);
    }
    return out;
  }

  if (c.type === 'rolling') {
    /* N per rolling 7 days, anchored on the routine's own START WEEKDAY rather than
       on Monday — which is the entire difference from weekly floats. "Three times a
       week" written on a Thursday should count Thursday-to-Thursday; resetting the
       count every Monday morning is an artefact of the grid, not of the commitment.
       Every occurrence is a float: the mode says how OFTEN, never which day. */
    let cursor = anchor && anchor <= to ? anchor : start;
    while (cursor <= to) {
      for (let i = 0; i < c.n; i++) pushFloat(cursor, i);
      cursor = shiftDays(cursor, 7);
    }
    return out;
  }

  if (c.type === 'rrule') {
    let emitted = 0;
    const limit = c.until && c.until < to ? c.until : to;
    if (c.freq === 'DAILY') {
      const gap = daysBetween(anchor || from, from);
      let cursor = shiftDays(anchor || from, Math.max(0, Math.ceil(gap / c.interval)) * c.interval);
      while (cursor <= limit && (c.count === null || emitted < c.count)) {
        push(cursor); emitted++;
        cursor = shiftDays(cursor, c.interval);
      }
    } else if (c.freq === 'WEEKLY') {
      const offsets = c.byday.length ? c.byday : [((parseISO(anchor || from).getUTCDay() + 6) % 7)];
      const anchorWeek = isoWeekStart(anchor || from);
      for (let wk = isoWeekStart(from); wk <= limit; wk = shiftDays(wk, 7)) {
        // INTERVAL counts WEEKS FROM THE ANCHOR's week, so "every other week" keeps
        // its parity as the horizon advances.
        if (Math.round(daysBetween(anchorWeek, wk) / 7) % c.interval !== 0) continue;
        for (const off of offsets) {
          if (c.count !== null && emitted >= c.count) break;
          const date = shiftDays(wk, off);
          if (date < from || date > limit) continue;
          push(date); emitted++;
        }
      }
    } else if (c.freq === 'MONTHLY') {
      const d0 = parseISO(from);
      const daysOfMonth = c.bymonthday.length ? c.bymonthday : [parseISO(anchor || from).getUTCDate()];
      for (let m = 0; m <= 14 && (c.count === null || emitted < c.count); m++) {
        const probe = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1));
        if (m % c.interval !== 0) continue;
        const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate();
        for (const dd of daysOfMonth) {
          const date = isoOf(new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth(), Math.min(dd, lastDay))));
          if (date < from || date > limit) continue;
          if (c.count !== null && emitted >= c.count) break;
          push(date); emitted++;
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  return out;
}

/** One line describing a cadence, for a board row that has no space for a rule. */
function describeCadence(cadence, days = []) {
  const c = cadence || { type: 'weekly' };
  const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (c.type === 'weekly') return days.length ? days.map((d) => NAMES[d]).join(' · ') : 'any day';
  if (c.type === 'every_n_days') return c.n === 1 ? 'every day' : `every ${c.n} days`;
  if (c.type === 'rolling') return `${c.n}× per rolling 7 days`;
  if (c.type === 'monthly') return c.day === 'last' ? 'last day of the month' : `the ${c.day}${ordinal(c.day)} of the month`;
  if (c.type === 'rrule') return `RRULE · ${c.rrule}`;
  return 'any day';
}
const ordinal = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

/* ══════════════════════════════════════════════════════════════════════════════
   ANALYTICS — what a run of occurrences ADDS UP TO

   Pure functions over `[occurrence]`, so the same numbers appear on the board, in
   the forge, on the goal, and through the API without four implementations. Each
   reads `performed` where it exists and falls back to `prescription` for a
   completed session with no per-step log — the same "silence means you did what
   you were told" rule the autoregulation tally uses.
   ══════════════════════════════════════════════════════════════════════════════ */

const rxOf = (o) => {
  const raw = o?.prescription;
  if (!raw) return null;
  try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw; return p && Array.isArray(p.steps) ? p : null; }
  catch { return null; }
};

/** What one step of one occurrence actually amounted to, in the measure asked for.
 *  Logged sets win; otherwise the prescription is taken at face value. */
function amountOf(rendered, logged, measure) {
  const sets = Array.isArray(logged?.sets) ? logged.sets.filter((s) => s.value !== null) : [];
  if (measure === 'sessions') return 1;
  if (sets.length) {
    if (measure === 'target') return sets.reduce((n, s) => n + (s.value || 0), 0);
    if (measure === 'volume') return sets.length * (sets.reduce((n, s) => n + (s.value || 0), 0) / sets.length || 0);
    if (measure === 'load') return sets.reduce((n, s) => n + (s.value || 0) * (s.load ?? rendered?.load ?? 0), 0);
  }
  const t = rendered?.target ?? 0;
  const st = rendered?.sets ?? 1;
  if (measure === 'target') return t * st;
  if (measure === 'volume') return t * st;
  if (measure === 'load') return t * st * (rendered?.load ?? 0);
  return 0;
}

/** The start of the window `date` falls in. `all` returns the empty string, which
 *  sorts before every ISO date — so "everything counts" needs no special case. */
function windowStart(windowName, date) {
  if (windowName === 'all') return '';
  if (windowName === 'week') return isoWeekStart(date);
  if (windowName === 'year') return `${date.slice(0, 4)}-01-01`;
  return `${date.slice(0, 7)}-01`;   // month
}

/**
 * A routine's contribution to its goal, as a number and a fraction.
 * @returns {?{measure, unit, target, value, pct, window, from, label}}
 */
function metricOf(spec, occurrences, today) {
  const c = spec?.contributes;
  if (!c) return null;
  const from = windowStart(c.window, today);
  const step = c.step ? spec.steps.find((s) => s.key === c.step) : null;

  let value = 0;
  for (const o of occurrences || []) {
    if (!o.completed) continue;
    const when = o.due_date || o.week_start || '';
    if (when < from) continue;
    if (c.measure === 'sessions') { value += 1; continue; }
    const rx = rxOf(o);
    const perf = normalizePerformed(o.performed);
    const rows = rx ? rx.steps.filter((s) => !c.step || s.key === c.step) : [];
    for (const r of rows) value += amountOf(r, perf?.steps?.[r.key], c.measure);
  }
  value = Math.round(value * 100) / 100;
  return {
    measure: c.measure,
    step: c.step,
    unit: c.measure === 'sessions' ? 'sessions'
      : c.measure === 'load' ? (step?.load_unit || 'load')
      : (step?.unit || 'reps'),
    label: c.label,
    target: c.target,
    value,
    pct: c.target > 0 ? Math.min(100, Math.round((value / c.target) * 100)) : 0,
    window: c.window,
    from,
  };
}

/**
 * PRESCRIBED vs PERFORMED over time, for one step — the series a progression chart
 * draws.
 *
 * The two lines answer different questions and both matter: prescribed is whether
 * the PROGRAMME is climbing, performed is whether YOU are. A gap that opens between
 * them is the single most useful signal a training log carries, and it is invisible
 * in either line alone.
 *
 * @returns {Array<{cycle, date, completed, deload, prescribed, performed, met}>}
 */
function seriesFor(spec, occurrences, stepKey, measure = 'load') {
  const out = [];
  for (const o of occurrences || []) {
    const rx = rxOf(o);
    if (!rx) continue;
    const r = rx.steps.find((s) => s.key === stepKey);
    if (!r) continue;
    const perf = normalizePerformed(o.performed);
    const logged = perf?.steps?.[stepKey];
    const sets = Array.isArray(logged?.sets) ? logged.sets.filter((s) => s.value !== null) : [];

    const prescribed = measure === 'load' ? r.load
      : measure === 'target' ? r.target
      : measure === 'sets' ? r.sets
      : amountOf(r, null, measure);
    let performed = null;
    if (o.completed) {
      if (sets.length) {
        performed = measure === 'load' ? (sets.reduce((n, s) => n + (s.load ?? r.load ?? 0), 0) / sets.length)
          : measure === 'target' ? (sets.reduce((n, s) => n + (s.value || 0), 0) / sets.length)
          : measure === 'sets' ? sets.length
          : amountOf(r, logged, measure);
      } else if (logged?.done !== false) {
        performed = prescribed;    // completed with no detail — you did what it said
      }
    }
    out.push({
      cycle: rx.cycle,
      date: o.due_date || o.week_start || null,
      completed: !!o.completed,
      deload: !!rx.deload,
      prescribed: prescribed === null || prescribed === undefined ? null : Math.round(prescribed * 100) / 100,
      performed: performed === null || performed === undefined ? null : Math.round(performed * 100) / 100,
      met: logged ? stepWasMet(perf, stepKey) : null,
    });
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.cycle - b.cycle);
}

/* ── The performed log ────────────────────────────────────────────────────────
   What actually happened, stored on the occurrence next to what was prescribed.
   One row per session, a JSON column rather than a table: a session's log is small,
   it belongs to exactly one occurrence, and keeping it on the row preserves the
   property the whole routine design rests on — an occurrence is ONE ROW that every
   existing surface already reads.

   `met` is the only field the ENGINE reads back: it is what `autoregulated`
   progression counts. Its default is the important part — a completed occurrence
   with no per-step detail counts as MET. Logging every set is a thing people do for
   a week and then stop, and a progression that silently stalls the moment you stop
   logging would be worse than no autoregulation at all. */

function normalizePerformed(raw) {
  let src = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src); } catch { return null; } }
  if (!isObj(src)) return null;

  const steps = {};
  const rawSteps = isObj(src.steps) ? src.steps : {};
  for (const [k, v] of Object.entries(rawSteps).slice(0, LIMITS.steps)) {
    const key = slugify(k, 'step');
    const e = isObj(v) ? v : { done: !!v };
    const sets = (Array.isArray(e.sets) ? e.sets : []).slice(0, LIMITS.sets).map((s) => {
      const o = isObj(s) ? s : { value: s };
      return {
        value: num(o.value ?? o.reps ?? o.count, null),
        load: num(o.load ?? o.weight, null),
      };
    });
    steps[key] = {
      done: e.done === undefined ? sets.length > 0 : !!e.done,
      met: e.met === undefined ? null : !!e.met,   // null = "not said" → counts as met
      sets,
      note: str(e.note ?? e.notes, LIMITS.notes),
    };
  }
  return {
    v: SPEC_VERSION,
    at: str(src.at, 40),
    note: str(src.note ?? src.notes, LIMITS.notes),
    feel: int(src.feel ?? src.rpe, null, 0, 10),   // a 0–10 read on the whole session
    steps,
  };
}

/** Did this completed occurrence earn `stepKey` an advance? See the note above on
 *  why silence means yes. */
function stepWasMet(performed, stepKey) {
  const e = performed?.steps?.[stepKey];
  if (!e) return true;                 // nothing logged for it → the session counted
  if (e.met !== null && e.met !== undefined) return !!e.met;
  if (e.done === false) return false;  // explicitly skipped
  return true;
}

/**
 * PER-SET LOGGING — did these sets meet what was prescribed?
 *
 * Derived rather than asked, because a person who has just typed six real numbers
 * should not then be asked a seventh question they have already answered. The rule
 * is deliberately generous: EVERY logged set must reach the target, but a set that
 * was not logged at all is not held against you — a half-filled log is the normal
 * state of a log, and treating a blank row as a failure would make people stop
 * filling any of them in.
 *
 * Returns null when there is nothing to judge, which the caller must keep distinct
 * from `false`: "no sets logged" is not "you fell short".
 */
function metFromSets(rendered, sets) {
  const rows = (Array.isArray(sets) ? sets : []).filter((s) => s && s.value !== null && s.value !== undefined);
  if (!rows.length) return null;
  const target = rendered?.target;
  if (target === null || target === undefined) return true;   // nothing to fall short of
  return rows.every((s) => Number(s.value) >= Number(target));
}

/** A blank set sheet for a rendered step — the rows the card draws before anything
 *  is typed, pre-filled with the prescription so logging "as prescribed" is a tap
 *  rather than transcription. */
function blankSets(rendered) {
  const n = clamp(int(rendered?.sets, 1, 1, LIMITS.sets), 1, LIMITS.sets);
  return Array.from({ length: n }, () => ({
    value: rendered?.target ?? null,
    load: rendered?.load ?? null,
  }));
}

module.exports = {
  SPEC_VERSION, LIMITS, MAX_RULES,
  UNITS, LOAD_UNITS, PROGRESSIONS, DRIVES, ADVANCE_ON, PHASE_REPEAT, BLOCKS, COLLECTIONS,
  CADENCES, MEASURES, WINDOWS,
  emptySpec, normalizeSpec, validateSpec,
  phaseAt, isDeload, progressionAt, applyProgressions, promoteAtCap, renderStep, renderCycle,
  parseCadence, formatCadence, expandCadence, describeCadence,
  metricOf, seriesFor, amountOf, windowStart,
  stepLine, sessionLine, summarize,
  normalizePerformed, stepWasMet, metFromSets, blankSets,
  slugify, humanize, roundTo,
  isoWeekStart, shiftDays, daysBetween,
};
