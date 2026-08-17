# jkOS — The Routine Primitive

> Everything about BeigeBoard routines in one place. **If you are a fresh agent
> touching anything routine-shaped, read this file first.** When it disagrees with
> the code, the code wins — update this.

Related: [PLANNING_METHOD.md](PLANNING_METHOD.md) is the *method* (how routines sit
beside the goal-breakdown ladder). [ARCHITECTURE.md](ARCHITECTURE.md#routines--the-cadence-engine-and-the-routine-document)
is the *summary*. **This is the reference.**

---

## 1. The one idea

> **THE ROUTINE HOLDS RULES · THE OCCURRENCE HOLDS A RENDERED SNAPSHOT ·
> THE OCCURRENCE ALSO HOLDS WHAT ACTUALLY HAPPENED**

A step says *"+10 lb once you top 8 reps"*, never *"135 lb"*. At mint the engine
evaluates every rule at that occurrence's **cycle index** and writes concrete
numbers into `prescription`.

Two properties fall out, and both are load-bearing:

- **Rules render forward.** "Make week 6 harder" is one edit to one rule, not a
  rewrite of thirty rows. This is the reason the primitive exists.
- **Facts stay put.** Last Tuesday keeps saying 95 lb after the rule moved on to
  105 — otherwise the log of what you did is measured against a plan that no
  longer exists.

## 2. Where everything lives

| File | What it is |
|---|---|
| `apps/beigeboard/backend/src/routine-spec.js` | **THE spec.** Vocabularies, normalise, validate, render, cadence maths, analytics. Zero deps, pure, no I/O, no `Date`. The authority. |
| `apps/beigeboard/backend/src/routines.js` | **The engine.** The mint, the three rewrite rules, the cycle ladder, revisions, the deload override. Touches the DB. |
| `apps/beigeboard/backend/src/library.js` | The reusable sub-tasks + the starter set. |
| `apps/beigeboard/backend/src/routes/routines.js` | `/api/routines/*` + `/api/library/*` + the vocabulary endpoint. |
| `apps/beigeboard/src/lib/routine-spec.ts` | **The mirror** (browser). Normalise + render + cadence + analytics only — *not* validation. |
| `apps/beigeboard/src/views/workshop/RoutineForge.tsx` | The visual builder. |
| `apps/beigeboard/src/components/SessionCard.tsx` | The daily surface: prescription + log. |
| `apps/beigeboard/src/components/ProgressChart.tsx` | Prescribed vs performed. |
| `test/routine-spec.mjs` | **`pnpm check:routine`** — the conformance gate. |
| `apps/beigeboard/backend/test/routine-spec.smoke.mjs` | The HTTP smoke (86 assertions). |

**The mirror exists because the forge previews an UNSAVED spec** — there is nothing
on the server to ask about yet, and a round trip per keystroke is a delay, not a
design. The duplication is paid for by `pnpm check:routine`, which drives both
implementations through the same matrix of documents × cycles (~3150 renders) and
fails on the first disagreement. **Change one, change the other, run the gate.**

## 3. The columns

Migrations **9** (cadence), **10** (document), **11** (cadence rules, deload,
revisions). All additive and NULL-safe: a routine that predates any of them keeps
working unchanged.

| Column | On | Holds |
|---|---|---|
| `cadence_days`, `cadence_count` | routine | the weekly pattern — Monday offsets, plus a target count whose surplus *floats* to the week bench |
| `cadence_rule` | routine | cadence beyond weekly (§6). Empty = weekly. |
| `spec` | routine | **the document** — steps, progression rules, phases, ladders, `contributes` |
| `spec_version` | routine | the revision number, bumped on every spec write |
| `prescription` | occurrence | the document **rendered** at this session's cycle. Stamps `sv` = the revision it followed. |
| `cycle_index` | occurrence | which cycle produced it |
| `performed` | occurrence | what the user actually did — the only field the engine reads *back* |
| `deload_override` | occurrence | 1 = take this one easy · 0 = force normal · NULL = follow the programme |

Plus two tables: **`library`** (reusable sub-tasks) and **`routine_revisions`**
(append-only spec history).

### Why JSON columns and not tables

Rejected: `routine_steps` + `routine_progressions` + `routine_log`. It loses on all
three axes that matter. (1) The occurrence would stop being **one row**, and
"an occurrence is an ordinary task row" is the property everything downstream —
Today, Week, Calendar, the ORDECK widgets, the weave `items` dataset — depends on
for free. (2) A prescription is a *snapshot*: read whole, with its row, never joined
or aggregated in SQL. That is the shape a blob is for. (3) The document must
round-trip verbatim to and from an AI author; five tables need a serialiser that can
disagree with the parser.

**Accepted cost:** you cannot query *into* the document from SQL ("every routine with
a squat in it"). That is a scan in JS over a few dozen rows, not an index.

## 4. The four rules

**RULE 1 — never mint into the past.** A routine created on a Friday must not conjure
Monday's occurrence as already overdue.
> ⚠️ `created_at` is SQLite **UTC**; `today` is the caller's **local** date (the
> `X-BB-Today` header). They differ by up to a day, so the floor absorbs one day of
> slack. Remove that and everyone west of UTC silently loses their next day.

**RULE 2 — editing the pattern rewrites only the untouched future.** Completing an
occurrence, or moving it off its minted date, hands it to the user permanently
(`isEngineOwned`).

**RULE 3 — the future is a projection, the past is a record.** Future engine-owned
occurrences are re-rendered on *every* reconcile, because the ladder moves under them.
**Today is frozen** — the day is in progress and may be on screen.

**RULE 4 — you progress by doing, not by time passing.** A past occurrence that was
never ticked drops out of the cycle ladder entirely; the ones after it keep their
rung. `advance_on: 'calendar'` opts out (a taper, a medication ramp, a syllabus).

## 5. Progression

A step carries an **array** of rules. Rules apply in document order; the last writer
of a field wins (linted); `variant_shift` accumulates.

| type | fields | what it does |
|---|---|---|
| `linear` | `increment`, `every`, `cap`, `drives` | +increment every N cycles |
| `double` | `range: [lo,hi]`, `increment`, `cap` | climb the rep range, then add load and reset |
| `ladder` | `values[]`, `repeat: hold\|loop`, `drives` | an explicit per-cycle table |
| `percent` | `of` (a `vars` key), `start`, `increment`, `cap` | a creeping fraction of a stored max |
| `autoregulated` | `range`, `increment`, `cap` | same maths as `double`, on a clock of advances **earned** |
| *(absent)* | — | never gets harder — the default, and correct for most daily things |

`drives` is one of `load` · `target` · `sets` · `variant`.

### Two axes of difficulty

Numbers, **and the variant ladder** (`Knee Push-Up → Push-Up → Decline → Archer`) —
the only way bodyweight work can get harder. Two independent ways to climb it:

- `variant_every: N` — on a **clock**. Harder movement every N sessions.
- `promote_on_cap: true` — on an **achievement**. When a capped load rule tops out,
  the excess becomes ladder rungs and the load resets. Needs both a cap and a ladder.

### Scaling

`phases[]` (each scales the whole session by `intensity` / `sets_delta`),
`deload_every: N`, and the per-occurrence deload override. Render order is fixed:
**progression → phase → deload.** Scaling before progressing would compound — a
deload would permanently lower everything after it, which is the classic bug in every
spreadsheet version of this.

> ⚠️ **`earned` must be seeded to 0 for every step, never left sparse.**
> `ruleAt` reads a *missing* tally as "no history at all" and falls back to the plain
> cycle — silently turning `autoregulated` (the one type that holds you back) into
> one that never does. Zero has to be a value, not an absence.

## 6. Cadence

`cadence_rule` is a tiny positional string, `type:argument`. Empty = weekly.

| Rule | Means |
|---|---|
| *(empty)* | weekly via `cadence_days` + `cadence_count` |
| `every_n_days:3` | a fixed interval from the routine's own start |
| `monthly:15` / `monthly:last` | a day of the month (clamps into short months) |
| `rolling:3` | 3× per rolling 7 days, anchored on the **start weekday**, not Monday |
| `rrule:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH` | the RFC 5545 subset |

All of it expands through **one** pure function, `expandCadence`, which also emits
**floats** (undated, committed to a window — the week-bench shape). `rolling` needed
no new mint path because of that.

**RRULE supported:** `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY` (no ordinals),
`BYMONTHDAY`, `COUNT`, `UNTIL`.
**RRULE rejected — never half-honoured:** `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`,
`BYMONTH`, `EXDATE`, `RDATE`, `WKST`, ordinal `BYDAY`, `FREQ=YEARLY`.
> Rejecting is the point. A rule that silently drops `BYSETPOS` produces a schedule
> that looks right and is not. RRULE is also unrenderable on the weekly board — it is
> the escape hatch, not the model.

## 7. The library

`library` table, keyed `(user, collection, slug)`. A step writes `{ ref: 'back-squat' }`
and inherits the unit, load unit, rest interval, variant ladder and a sane default
progression — **anything the step states itself always wins.**

`collection` makes it domain-agnostic: `exercise`, `recipe`, `practice`, `study`,
`chore`, `custom`. A cooking routine pulling `ref: 'shakshuka'` uses the identical
code path a squat does.

**Not a sixth item kind**, deliberately: a library entry has no date, no parent and no
completion, and must never appear in a tree walk, a rollup or a calendar query.

The starter set (31 entries) is seeded lazily on first touch. It is also **the
few-shot prompt** — an agent that has read twenty real entries with their ladders
writes far better routines than one given a schema.

## 8. Authoring — the AI contract

The format is shaped around a *mediocre* author, human or machine:

1. **One flat document, no foreign keys.**
2. **Every field optional, every default defensible.** A half-filled routine is a
   working routine. Highest-leverage rule in the file.
3. **Closed vocabularies, never expressions.** No formula field, ever.
4. **Names, not ids.** Slugs everywhere.
5. **Errors vs lint.** Errors are `{path, code, message, expected}` → 400. Lint is
   *accepted and flagged* — because the real failure mode is a routine with five
   steps and no progression on any of them, which is valid and useless.
6. **Idempotent by slug.** A retry after a timeout updates; it never duplicates.
7. **Round-trip.** `GET /api/routines/:id` → `document` is exactly what
   `POST /api/routines/import` accepts.

### The endpoints

```
GET  /api/routines/vocabulary        every legal value + a worked example — READ FIRST
GET  /api/routines                   routines with their specs normalised
GET  /api/routines/:id               one, + `document` (the round-trip form)
GET  /api/routines/:id/preview?cycles=12&from=0
                                     the next N sessions as NUMBERS — the repair tool
GET  /api/routines/:id/metric        what it contributes to its goal
GET  /api/routines/:id/series?measure=load&step=<key>
                                     prescribed vs performed over time
GET  /api/routines/:id/revisions     which document each past session followed
POST /api/routines/import[?dryRun=1] one document → one routine, upsert by slug
POST /api/items/:id/deload           take one session easy (also re-ladders)
GET  /api/library[/export]           the vocabulary; export → a file
POST /api/library[/import]           teach it a new domain
```

> **Always preview before trusting a progression.** `+10 lb a session` is legal,
> plausible, and has you squatting 400 lb by November. Only rendered sessions show
> you that.

## 9. Goals

A routine never finishes, so it cannot contribute *percent complete* without
corrupting the goal's `done / total`. It contributes a **measurement**:

```json
"contributes": { "measure": "target", "step": "easy-run", "target": 100, "window": "month" }
```

`measure` ∈ `sessions` · `volume` · `target` · `load`. Actuals come from `performed`,
falling back to the prescription for a completed session with no per-step log — the
same "silence means you did what you were told" rule autoregulation uses.

## 10. Traps (read before editing)

1. **The UTC/local skew in RULE 1** — see §4.
2. **`GET /api/items` must re-read on `updated`, not just `minted || withdrawn`.**
   `propagate` rewrites rows *in place*; gating the re-read on insert/delete counts
   answers from pre-reconcile rows, so ticking a session leaves tomorrow stale for a
   round trip.
3. **Sparse `earned`** — see §5.
4. **Never pin a literal date in a routine test.** `routines.smoke.mjs` once pinned
   `TODAY = '2026-08-12'`; once the clock passed it, RULE 1's creation floor refused
   every expected occurrence. Both smokes now *derive* the pin as "Wednesday of next
   week" — always mid-week, always ahead of the run.
5. **`occurrencesOf`'s SELECT is an explicit column list.** Adding an occurrence
   column means adding it there too, or the engine reads `undefined` and the feature
   silently does nothing. (This bit during Wave 2 with `deload_override`.)
6. **The forge is a full pane, not a `.jk-panel` overlay.** That primitive has caused
   two silent "clicking does nothing" bugs in this app.
7. **Migrations are append-only.** Wave 2 is migration 11, not an edit to 10.

## 11. Verifying

```bash
pnpm check:routine                                   # engine ↔ mirror conformance + the rules
pnpm --filter @jkos/beigeboard-backend test          # 7 smokes incl. routines + routine-spec
pnpm --filter @jkos/beigeboard typecheck             # the mirror + the UI
pnpm test:contracts                                  # everything
```
