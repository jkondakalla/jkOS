# The jkOS Breakdown Method

How jkOS apps turn a big, distant ambition into something you actually do today.
This is the product methodology behind the BeigeBoard rewrite (2026-06) and the
planned SylibOS rewrite. The two apps share one engine idea applied to different
domains: **life goals** (BeigeBoard) and **learning goals** (SylibOS).

## Why the old model failed

The original workshop laddered goals through fixed calendar buckets:
*year goal → month goal → week theme → day task*. Three problems:

1. **Structure before action.** You had to invent a month theme and a week theme
   before you could write down a single concrete task. Most goals don't decompose
   along calendar lines, so the buckets were busywork.
2. **The ladder went stale.** A "June" milestone with "week of June 2" children is
   wrong by July. Nothing rolled forward; the tree silently rotted.
3. **No loop.** Once built, the tree just sat there. Nothing connected the tree to
   what you do *today*, and nothing pulled you back when you drifted.

A planning partner is not a tree editor. It is a loop that keeps a goal connected
to your calendar, week after week.

## The method: Define → Ladder → Commit → Review

### 1. Define the destination
A goal is unusable until it has a finish line. Capture three things:

- **Title** — what you're reaching for.
- **Done means…** — a verifiable outcome, not an activity. ("I can run 10k without
  stopping", not "run more".) If you can't say what done looks like, the app should
  help you find out — that's the first milestone.
- **Horizon** — a target date, even a rough one. Pace is meaningless without it.

### 2. Ladder it down — but only to the first bend
Break the outcome into **2–6 milestones**: checkpoints you could *prove* you passed,
in order. No calendar buckets — order matters, dates are optional.

Then break down **only the first milestone** into 1–5 **next actions**: concrete
tasks small enough to finish in a single sitting. Do not plan the whole route.
Plans made months out are fiction; the act of finishing milestone 1 teaches you
what milestone 2's actions really are. Just-in-time decomposition is the core
anti-bloat principle — it's also why the app stays simple.

### 3. Commit to days
**The invariant: an active goal always has at least one next action on the
calendar.** A goal with no scheduled action isn't a plan, it's a wish. The app
enforces this softly — goals that drift off the calendar are surfaced ("adrift")
on Today with a one-tap way to schedule the next step. Scheduling is the bridge
between the long-term view and the daily list; it's the single most important
interaction in the app.

### 4. Review and re-ladder
The loop closes through two cheap rituals the app drives:

- **The carry.** Tasks that slip past their day don't roll forward silently and
  don't rot in an "overdue" shame pile. They show up as *carried* with explicit
  choices: **today / tomorrow / pick a day / let go**. Rescheduling is a decision,
  not a default.
- **The re-ladder.** When the last action under a milestone is done, the app
  prompts: mark the checkpoint passed, then break down the next one — again only
  1–5 actions, again put the first on a day.

Progress rolls up (actions → milestone → goal) and is compared against the
horizon: elapsed-time fraction vs. completed fraction gives a simple
**on pace / behind** signal. No charts, no streaks, no gamification.

## Data model (BeigeBoard)

One `items` table, four kinds:

| kind        | parent       | dated by                | meaning                          |
|-------------|--------------|-------------------------|----------------------------------|
| `goal`      | none         | `target_date` (horizon) | outcome + `done_means` + `status` (active/parked/done) |
| `milestone` | goal         | `target_date` (optional)| ordered checkpoint (`position`)  |
| `task`      | milestone, goal, or task (subtask) | `due_date` (+ optional time) | a next action |
| `event`     | none         | `due_date`/`end_date`   | synced calendar item (read-only) |

Milestones are **flat** under a goal — depth is capped on purpose. Tasks may have
one level of subtasks. Everything else (calendar drag-scheduling, week time-grid,
external calendar sync) hangs off `due_date` unchanged.

## The same method, applied to SylibOS (planned)

| Method step | BeigeBoard            | SylibOS                                  |
|-------------|-----------------------|------------------------------------------|
| Define      | life goal + done means| "learn X" — course/skill + mastery check |
| Ladder      | milestones            | units/concept clusters (from concept tree)|
| Next actions| 1–5 concrete tasks    | lessons, exercises, readings              |
| Commit      | actions on calendar   | study sessions on calendar (can land on the *same* BeigeBoard calendar) |
| Review      | carry + re-ladder     | spaced review + advance to next unit      |

SylibOS already builds concept trees from courseware — that *is* the ladder,
machine-generated. The rewrite will wrap the same Commit/Review loop around it.

## AI assist (optional by construction)

LazurOS can draft a ladder (suggest milestones + first actions from the goal
definition), but the method works entirely without it. AI output is always
editable suggestion text, never auto-committed. All AI entry points respect the
suite-wide kill switch in jkAuth (`lazuros.enabled`) and the per-instance
`BB_AI_ENABLED` env.
