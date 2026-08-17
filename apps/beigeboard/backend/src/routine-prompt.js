'use strict';
/*
 * routine-prompt.js — THE AUTHORING PROMPT, generated from the vocabulary it
 * describes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS CODE AND NOT A MARKDOWN FILE
 *
 * The prompt's whole job is to tell an agent what is legal. A prompt that has
 * drifted from the validator is worse than no prompt: it produces confident,
 * well-formed documents that come back 400, and the agent has no way to know which
 * half is wrong. So every closed list in the text below is INTERPOLATED from
 * routine-spec.js — the same constants validateSpec enforces. Add a progression
 * type and it appears here; rename a unit and it renames here. There is no copy to
 * forget.
 *
 * `pnpm check:routine` holds the line: it asserts every value of every vocabulary
 * appears in the generated text, and that the checked-in Documentation copy is
 * byte-identical to what this produces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE DOORS, ONE TEXT
 *
 *   · GET /api/routines/prompt          — personalised: your library index is
 *                                          spliced in, so the agent writes `ref`s
 *                                          that actually resolve.
 *   · The paste pane's "Copy prompt"    — the same call, onto the clipboard.
 *   · Documentation/ROUTINE_PROMPT.md   — the generic copy, checked in, generated
 *                                          by scripts/print-prompt.mjs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE PROMPT IS SHAPED AROUND
 *
 * The same author routine-spec.js is shaped around: a mediocre one. So it does the
 * four things that measurably move an LLM's output on this task:
 *
 *   1. It states the DELIVERABLE first and in one sentence — one JSON object, one
 *      fenced block, no prose. Format compliance is the single most common failure
 *      and it is the cheapest to fix.
 *   2. It gives the closed lists as lists, never as prose. An agent that can see
 *      the six progression types does not invent a seventh.
 *   3. It gives ONE complete worked example. A field table tells an agent what is
 *      allowed; an example tells it what is NORMAL — including which fields to
 *      leave out, which no schema can express.
 *   4. It ends with a checklist of the failure modes we actually see, each phrased
 *      as something to verify rather than something to avoid. "Check every count
 *      progression has a cap" beats "don't forget caps".
 */
const spec = require('./routine-spec');

/** `back-squat` → a one-line index entry an author can scan. Deliberately terse:
 *  the point is to make `ref` cheaper to write than a hand-rolled step, and a
 *  paragraph per entry would bury the slugs that are the actual payload. */
function libraryLine(e) {
  const bits = [e.unit || 'reps'];
  if (e.load_unit) bits.push(e.load_unit);
  if (Array.isArray(e.variants) && e.variants.length > 1) bits.push(`${e.variants.length}-rung ladder`);
  return `- \`${e.slug}\` — ${e.title} · ${bits.join(' · ')}`;
}

/** The library index, grouped by collection. Capped: the index is a convenience,
 *  and a 900-entry dump would crowd out the rules, which are the part that
 *  actually changes the output. */
function libraryIndex(entries, cap = 240) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [
      'This copy of the prompt carries no library index. Fetch one before you write:',
      '',
      '```',
      'GET /api/library            → { entries: [{ collection, slug, title, unit, variants, defaults }] }',
      '```',
      '',
      'Or ask for the personalised prompt — `GET /api/routines/prompt` — which splices',
      "the user's own library into this section.",
    ].join('\n');
  }
  const shown = entries.slice(0, cap);
  const byCollection = new Map();
  for (const e of shown) {
    if (!byCollection.has(e.collection)) byCollection.set(e.collection, []);
    byCollection.get(e.collection).push(e);
  }
  const out = [];
  for (const [collection, list] of byCollection) {
    out.push(`**${collection}**`, '');
    for (const e of list) out.push(libraryLine(e));
    out.push('');
  }
  if (entries.length > cap) out.push(`_…and ${entries.length - cap} more. \`GET /api/library?q=…\` to search._`, '');
  return out.join('\n').trimEnd();
}

/* The worked example. ONE routine and ONE new library entry in one bundle, because
   the pairing is the thing a schema cannot teach: an author who needs a movement
   the library lacks should TEACH IT once and then `ref` it, not inline the same
   ladder into four steps. Every field here is one an author should actually use;
   the fields left out are left out on purpose, and the prompt says so. */
const EXAMPLE = {
  kind: 'jkos.beigeboard.bundle',
  version: 1,
  library: [
    {
      collection: 'exercise',
      slug: 'nordic-curl',
      title: 'Nordic Curl',
      unit: 'reps',
      load_unit: 'bw',
      tags: ['hamstrings', 'posterior'],
      variants: ['Band-Assisted Nordic', 'Eccentric-Only Nordic', 'Nordic Curl'],
      defaults: { sets: 3, target: 5, rest: 120, variant_index: 1 },
      notes: 'Lower for a slow five count. Only add reps once the descent is controlled.',
    },
  ],
  routines: [
    {
      slug: 'lower-body',
      title: 'Lower Body',
      days: ['mon', 'thu'],
      time: '07:00',
      goal: 'Get stronger',
      spec: {
        intent: 'Build a squat and keep the hinge honest',
        advance_on: 'completion',
        deload_every: 5,
        vars: { squat_max: 225 },
        phases: [
          { name: 'Base', cycles: 6 },
          { name: 'Build', cycles: 6, intensity: 1.05 },
        ],
        steps: [
          { ref: 'mobility-flow', block: 'warmup', target: 6 },
          {
            ref: 'back-squat',
            sets: 3,
            load: 135,
            progression: [
              { type: 'double', range: [5, 8], increment: 10, cap: 225 },
              { type: 'linear', drives: 'sets', increment: 1, every: 8, cap: 5 },
            ],
          },
          { ref: 'deadlift', sets: 3, progression: { type: 'percent', of: 'squat_max', start: 0.7, increment: 0.02, cap: 0.9 } },
          { ref: 'nordic-curl', sets: 3, target: 5, progression: { type: 'linear', drives: 'target', increment: 1, cap: 8 } },
          { ref: 'plank', block: 'cooldown', sets: 2, target: 40, progression: { type: 'linear', drives: 'target', increment: 5, cap: 120 } },
        ],
        contributes: { measure: 'sessions', target: 8, window: 'month', label: 'eight sessions a month' },
      },
    },
  ],
};

/**
 * Build the prompt.
 *
 * @param {object}  opts
 * @param {Array}   opts.library  the user's library entries, for the index section
 * @param {string}  opts.origin   base URL to show in the endpoint examples
 * @returns {string} markdown
 */
function buildPrompt({ library = [], origin = '' } = {}) {
  const base = origin ? String(origin).replace(/\/+$/, '') : '';
  const url = (p) => `${base}${p}`;
  const list = (arr) => arr.map((v) => `\`${v}\``).join(' · ');

  return `# BeigeBoard — Routine Authoring Prompt

> Spec version ${spec.SPEC_VERSION}. Everything below is generated from the validator itself,
> so what this says is legal is exactly what is accepted.

You are authoring a **routine** for BeigeBoard: a commitment to a rhythm that gets
harder over time. Not a repeating task — the difference is that a routine carries
**rules**, and the app renders those rules into concrete numbers for every session
it schedules.

---

## 1. What you must return

**One JSON object, in one fenced \`json\` block, and nothing else after it.** No
commentary between fields, no trailing explanation, no second block. If you want to
explain a choice, put it in the routine's \`notes\` or a step's \`notes\` where the
user will actually see it.

That object is a **bundle**. It may carry library entries, routines, or both:

\`\`\`json
{
  "kind": "jkos.beigeboard.bundle",
  "version": 1,
  "library": [ /* reusable sub-tasks — optional */ ],
  "routines": [ /* the routines themselves — optional */ ]
}
\`\`\`

Library entries are imported **first**, so a routine in the same bundle may \`ref\`
an entry the same bundle teaches. That is the intended way to introduce a movement,
a recipe or a piece the library does not have yet: teach it once, reference it
everywhere.

Both arrays are **idempotent by slug**. Sending the same bundle twice updates; it
never duplicates. Write a stable slug and you can revise a routine by re-sending it.

---

## 2. A routine

| Field | Type | Notes |
|---|---|---|
| \`slug\` | string | **The identity.** Stable, kebab-case. Re-sending the same slug edits that routine. |
| \`title\` | string | Human name. Defaults from the slug. |
| \`notes\` | string | Free text for the person, not the parser. |
| \`days\` | array | Weekdays it fires: \`["mon","thu"]\`. Also accepts \`[0,3]\` — **0 is Monday**. |
| \`cadence_count\` | int | Times per week. Above the number of committed \`days\`, the surplus **floats** — undated, committed to the week, done whenever. |
| \`cadence\` | string | Anything that is not weekly — see §5. Omit for weekly. |
| \`time\`, \`end_time\` | \`"HH:MM"\` | When in the day. |
| \`goal\` | string | The **title** of an existing goal to file this under. Unresolved names are reported as a warning, not an error. |
| \`accent\` | string | \`#rrggbb\`. |
| \`status\` | enum | \`active\` (default) · \`parked\` · \`done\` |
| \`spec\` | object | **The document.** Everything below. |

### The spec

| Field | Type | Notes |
|---|---|---|
| \`intent\` | string | One line: what this routine is *for*. Write it — it is what the user reads in six weeks when deciding whether to keep going. |
| \`steps\` | array | The session. See §3. |
| \`advance_on\` | enum | ${list(spec.ADVANCE_ON)} — \`completion\` (default) means a cycle is a session you **did**; missing a week does not advance you. \`calendar\` means a cycle is a week that elapsed — correct for a taper, a medication ramp or a syllabus, wrong for everything else. |
| \`deload_every\` | int | Every Nth session is lighter and shorter. \`0\` = never. |
| \`phases\` | array | \`{ name, cycles, intensity?, sets_delta?, notes? }\` — each scales the whole session. \`phase_repeat\`: ${list(spec.PHASE_REPEAT)}. |
| \`vars\` | object | Named numbers a \`percent\` progression is a percent **of**: \`{ "squat_max": 225 }\`. |
| \`round_load\` | number | Round every rendered load to this. \`5\` for a barbell, \`2.5\` for dumbbells. |
| \`contributes\` | object | What this feeds its goal — see §7. |

---

## 3. A step

Every field is optional. A step that says only \`{ "ref": "back-squat" }\` is a
working step — it inherits unit, load unit, rest, ladder and a sane progression from
the library.

| Field | Type | Notes |
|---|---|---|
| \`ref\` | slug | A library entry. **Prefer this over declaring a step from scratch** (§6). |
| \`title\` | string | Needed only when there is no \`ref\`. |
| \`key\` | slug | Stable identity within the routine. Defaults from \`ref\`/\`title\`. Matters if the step is named by \`contributes.step\`. |
| \`block\` | enum | ${list(spec.BLOCKS)} — defaults to \`main\`. |
| \`group\` | string | A letter. Two steps sharing one are a superset — done together. |
| \`sets\` | int | Defaults to 1. |
| \`target\` | number | Per set: reps, seconds, metres, pages. |
| \`unit\` | enum | ${list(spec.UNITS)} |
| \`load\` | number | Starting load. Omit for bodyweight. |
| \`load_unit\` | enum | ${list(spec.LOAD_UNITS)} — \`bw\` is bodyweight. |
| \`rest\` | int | Seconds between sets. |
| \`variants\` | array | **The ladder**, ordered easiest → hardest: \`["Knee Push-Up","Push-Up","Decline Push-Up","Archer Push-Up"]\`. |
| \`variant_index\` | int | Which rung to start on. |
| \`variant_every\` | int | Climb one rung every N sessions. \`0\` = never on a clock. |
| \`promote_on_cap\` | bool | Climb the ladder when a **capped load rule tops out**, and reset the load. Needs both a cap and a ladder. |
| \`progression\` | object or array | §4. Omit and the step never gets harder — which is correct for most daily things. |
| \`notes\` | string | Cues, form, the thing you would say out loud. |

---

## 4. Progression — the only thing that makes this a routine

A step may carry **one rule or an array of up to ${spec.MAX_RULES}**. Rules apply in document
order, the last writer of a field wins, and variant shifts accumulate. Use an array
when a step gets harder on two different clocks — reps every session, a fourth set
in the second month.

Each rule may name what it moves with \`drives\`: ${list(spec.DRIVES)}.

| \`type\` | Fields | What it does |
|---|---|---|
| \`fixed\` | — | Never changes. The default; you can simply omit \`progression\`. |
| \`linear\` | \`increment\`, \`every?\`, \`cap?\`, \`drives?\` | Add \`increment\` every \`every\` cycles. |
| \`double\` | \`range: [lo,hi]\`, \`increment\`, \`cap?\` | Climb the rep range, then add load and reset to \`lo\`. The default for barbell work. |
| \`ladder\` | \`values: []\`, \`repeat?: ${spec.PHASE_REPEAT.join('\\|')}\`, \`drives?\` | An explicit per-cycle table. Use when the plan is a written schedule, not a formula. |
| \`percent\` | \`of\` (a \`vars\` key), \`start\`, \`increment\`, \`cap?\` | A creeping fraction of a stored max. \`start: 0.7\` = 70%. |
| \`autoregulated\` | \`range: [lo,hi]\`, \`increment\`, \`cap?\` | Same maths as \`double\`, but the clock only ticks on sessions the log says were **met**. The one type that holds you back. |

**Two axes of difficulty.** Numbers are one. The variant ladder is the other, and it
is the only way bodyweight work can progress — you do not add weight to a push-up,
you do a harder push-up. A bodyweight step with no \`variants\` will plateau forever,
so give it a ladder or \`ref\` an entry that has one.

---

## 5. Cadence — when it fires

Omit \`cadence\` and use \`days\`. That is the weekly default and it is what almost
every routine should be — it is also the only mode the weekly board can draw.

Anything else is one string, \`type:argument\`, where type is one of
${list(spec.CADENCES)}:

| \`cadence\` | Means |
|---|---|
| *(omitted)* | Weekly, via \`days\` + \`cadence_count\`. |
| \`"every_n_days:3"\` | A fixed interval from the routine's own start. |
| \`"monthly:15"\` / \`"monthly:last"\` | A day of the month; clamps into short months. |
| \`"rolling:3"\` | 3× per rolling 7 days, anchored on the start weekday. |
| \`"rrule:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH"\` | The RFC 5545 subset below. |

**RRULE supported:** \`FREQ=DAILY|WEEKLY|MONTHLY\`, \`INTERVAL\`, \`BYDAY\` (no ordinals),
\`BYMONTHDAY\`, \`COUNT\`, \`UNTIL\`.
**RRULE rejected outright:** \`BYSETPOS\`, \`BYWEEKNO\`, \`BYYEARDAY\`, \`BYMONTH\`, \`EXDATE\`,
\`RDATE\`, \`WKST\`, ordinal \`BYDAY\` (\`2MO\`), \`FREQ=YEARLY\`. They are never
half-honoured — a rule that silently drops \`BYSETPOS\` produces a schedule that
looks right and is not. RRULE is the escape hatch; reach for a named mode first.

---

## 6. The library — reuse before you invent

A library entry is a reusable sub-task: an exercise, a recipe, a piece to practise,
a chapter to read. Referencing one with \`ref\` supplies the unit, load unit, rest
interval, variant ladder and a default progression — **and anything the step states
itself still wins.** One \`ref\` is worth six hand-written fields.

Write a library entry when the thing will recur across routines or weeks. Inline a
step when it genuinely is one-off.

| Field | Notes |
|---|---|
| \`collection\` | ${list(spec.COLLECTIONS)} — the domain. |
| \`slug\` | Identity. Stable, kebab-case. |
| \`title\` | Human name. |
| \`unit\`, \`load_unit\` | As §3. |
| \`tags\` | For search: muscle group, meal, grade. Up to ${spec.LIMITS.tags}. |
| \`variants\` | The ladder, easiest → hardest. This is the most valuable field in an entry and the one most often got wrong — order it carefully. |
| \`defaults\` | \`{ sets, target, load, rest, unit, load_unit, progression, variant_index, variant_every }\` — what a step gets for free. |
| \`notes\` | Form cues, the method, the thing worth remembering. |

### The library available to you

${libraryIndex(library)}

---

## 7. What it feeds a goal

A routine never finishes, so it cannot contribute *percent complete* — that would
leave any goal above it stuck below 100% forever. It contributes a **measurement**:

\`\`\`json
"contributes": { "measure": "target", "step": "easy-run", "target": 100, "window": "month", "label": "100 km a month" }
\`\`\`

\`measure\`: ${list(spec.MEASURES)} — \`sessions\` counts sessions kept, \`volume\` is
sets × target, \`target\` sums the target alone (distance, minutes, pages), \`load\`
is tonnage. \`step\` names one step's \`key\`, or omit it for the whole session.
\`window\`: ${list(spec.WINDOWS)}.

---

## 8. The rules that matter

1. **Every field is optional and every default is defensible.** A half-filled
   routine is a working routine. Prefer omitting a field to guessing at it — a
   plainer routine is a better outcome than a wrong one.
2. **Never invent a vocabulary value.** Every enum above is closed. If what you want
   is not in a list, express it with what is.
3. **Cap anything that counts.** \`+5 seconds a session\` with no \`cap\` is a
   five-minute plank by next spring, and it is legal. Loads may stay uncapped — a
   barbell's ceiling is the person — but reps, seconds, metres and pages need one.
4. **Slugs, never ids.** You cannot know a database id. Name goals by title.
5. **Progressions are per step, not per routine.** A warm-up and a mobility flow
   should usually have none at all.
6. **A routine with no progression anywhere is accepted and warned about.** It is
   also, usually, a repeating task wearing a routine's coat. If nothing in the
   session ever gets harder, say why in \`intent\`.
7. **Write the intent.** One line. It is the field the user reads when deciding
   whether this is still working.

---

## 9. Worked example

A bundle that teaches one new movement and then uses it:

\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`

Note what is **absent**: no \`unit\` on most steps (inherited), no \`progression\` on
the warm-up (it should not get harder), no \`key\` anywhere (derived from \`ref\`), no
\`load\` on the deadlift (the \`percent\` rule computes it from \`squat_max\`).

---

## 10. Before you answer

- [ ] Exactly one fenced \`json\` block, nothing after it.
- [ ] Every \`slug\` is stable and kebab-case.
- [ ] Every \`type\`, \`unit\`, \`load_unit\`, \`block\`, \`measure\`, \`window\` and
      \`collection\` appears in a list above — no invented values.
- [ ] Every progression that moves a **count** has a \`cap\`.
- [ ] Every bodyweight step that is meant to get harder has \`variants\`, or a \`ref\`
      to an entry that does.
- [ ] Every \`ref\` names an entry that exists — in the library index above, or in
      this bundle's own \`library\` array.
- [ ] Every \`percent\` rule's \`of\` names a key that exists in \`vars\`.
- [ ] \`days\` uses weekday names, or offsets where **0 is Monday**.
- [ ] The routine has an \`intent\`.

---

## 11. What happens to what you write

Paste it into BeigeBoard → **Workshop → Routines → Paste**, which validates and
previews before it writes anything. Or send it:

\`\`\`
POST ${url('/api/routines/bundle')}?dryRun=1     validate + render, write nothing
POST ${url('/api/routines/bundle')}              import for real
GET  ${url('/api/routines/vocabulary')}          every legal value, machine-readable
GET  ${url('/api/library')}                      the library index
\`\`\`

You get back three things and all three are worth reading:

- **\`errors\`** — \`{ path, code, message, expected }\`, with a 400. The document was
  not written. Fix the named path and resend.
- **\`warnings\`** — the lint tier. The document **was** accepted. This is where "no
  step in this routine ever gets harder" and "this count has no cap" show up, and
  it is the feedback most worth acting on, because thin output — not invalid
  output — is the usual failure.
- **\`sessions\`** — your rules **rendered as numbers**, session by session. Read
  them. A progression that is legal, plausible and insane looks exactly like a
  correct one in the document, and looks obviously wrong by session twelve.
`;
}

module.exports = { buildPrompt, EXAMPLE };
