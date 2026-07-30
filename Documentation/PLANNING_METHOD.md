# jkOS — The Breakdown Method (BeigeBoard Workshop)

> How BeigeBoard turns a multi-month or multi-year goal ("Graduate") into something you can
> actually do this week and today — without handing the thinking to an assistant.

This is the method the **Workshop** view embodies. It is a planning *discipline* expressed
as data: a small vocabulary of item rows, ordered and nested, plus two derived rituals
(the current path and the weekly bench). When this doc disagrees with the code, the code
wins — update this.

**Where the code lives (revised 2026-07-30).** The Full Press rebuild (`f64c1ca`) replaced the
unlimited-depth drill-down with a two-pane forge, and BeigeBoard's `src/lib/plan.ts` helper
layer — `currentStep`/`currentLeaf`/`nodeCleared`/`carriedBench`/`paceOf` and friends — went
with it. It sat in the tree unimported for a while afterwards and has now been deleted; read
this doc as the **method**, not as a map of that module. What survives:

- **Tree walkers** — [`src/lib/seed.ts`](../apps/beigeboard/src/lib/seed.ts)
  (`getChildren`/`getAncestors`/`getDescendants`/`getProgress`), depth-N and cycle-guarded.
  [`WorkshopView`](../apps/beigeboard/src/views/workshop/WorkshopView.tsx) derives its rollups
  straight from these.
- **The day briefing** — `deriveDaySections` in
  [`packages/cards/src/sections.ts`](../packages/cards/src/sections.ts), with `activeGoals` /
  `isAdrift` / `nextUnscheduled` now a host-supplied `PlanResolvers` seam (defaults in
  [`theme.ts`](../packages/cards/src/theme.ts)) rather than BeigeBoard-local functions.
- **The read/write contract** — [`backend/discovery.js`](../apps/beigeboard/backend/discovery.js).

## The mission

Give a person a **sense of direction that works for them**. A year-scale goal is paralysing
because it names a destination but no next step. The Workshop's whole job is to shrink the
distance between "Graduate" and "read chapter 3 today" by repeatedly breaking the nearest
piece down until it is small enough to put on a day — and to make that shrinking feel like
progress, not bookkeeping.

Because the point is *your* sense of direction, **the planning is manual**. AI is kept
extremely limited here on purpose: if an assistant does the breaking-down, the plan stops
being yours and the direction stops meaning anything. The machine seams still exist (see
[AI stance](#ai-stance)) so LazurOS can plug in later through the Weave if that trade ever
looks worth it — but nothing in the default flow drafts your plan for you.

## The loop

```
   destination ──▶ ladder ──▶ weekly bench ──▶ day ──▶ review
        │            │             │            │         │
   done_means    milestones    1–3 next     due_date   checkpoint
   target_date   at any depth  actions or   on a day     cleared
                 (current       "parked"                → break down
                  path only)                              what's next
```

1. **Name the destination.** A goal carries a *definition of done* (`done_means`) and a
   *horizon* (`target_date`). Not "Graduate" alone but "Graduate — all degree requirements
   met, by 2028-05." The done-definition is what you check the ladder against.

2. **Break down the current path — only the current path.** A goal is a ladder of ordered
   **milestones** (checkpoints). You break down *only the nearest un-cleared checkpoint*,
   not the whole tree — planning month 14 in detail today is wasted effort. When a
   checkpoint is itself months long ("finish coursework"), it gets *its own* ladder of
   sub-checkpoints, to **any depth**. The Workshop shows one node and its children at a
   time; you drill in along the current path and the breadcrumb trail is your zoom level.

3. **Stock the weekly bench.** Every active goal contributes **1–3 next actions** to *this
   week*, or is consciously **parked** for the week. The bench is the ritual that connects
   the breakdown to real time: an action on the bench is committed to the week but not yet
   to a day. A goal with nothing on the bench and nothing parked is **adrift** — the one
   state the Workshop actively flags.

4. **Commit to a day.** A benched action gets a `due_date` when you're ready to actually do
   it. Now it appears in Today and on the calendar. Promotion and demotion between week and
   day are reversible and cheap (see [data mapping](#data-mapping)).

5. **Review on a cleared checkpoint.** When every action under a checkpoint is done, the
   checkpoint is *cleared* — the Workshop surfaces it and invites you to break down the next
   one. That is the loop closing: clearing a checkpoint is the trigger to plan the next
   stretch, so you are never planning further ahead than you need to.

## Taxonomy

Three item **kinds**, discriminated by the `kind` column on the single `items` table. Nesting
is `parent_id` (self-referential, unlimited depth, cycle-guarded by the tree walkers).

| kind | role | parent | schedulable? | notes |
|------|------|--------|-------------|-------|
| `goal` | the destination | none (root only, `parent_id IS NULL`) | no | carries `done_means`, `target_date`, `status`, `accent`, pace |
| `milestone` | a checkpoint at any depth | a goal **or another milestone** | no | position-ordered; `done_means` editable here too |
| `task` | the only doable leaf | a milestone (or a task, one inline level) | **yes** | carries `due_date`, `week_start`, `scheduled_time`, `completed` |

**Why milestone-under-milestone instead of a fourth kind:** the database and the server's
`validParentId` already permit a milestone to parent a milestone — the old depth-2 cap
(goal → milestone → task + one subtask) was pure *UI convention*, not a schema rule. Reviving
arbitrary depth needs **no migration**: existing shallow trees are just shallow trees and
render unchanged.

**Why `task` stays the only schedulable leaf:** TodayView, the calendar, the `@jkos/cards`
week/day views, and the public Weave contract all filter on `kind === 'task'` (the declared
`ITEM_SHAPE` kind enum covers all four kinds, but the schedulable surfaces select tasks).
Keeping `task` as the single doable leaf means
none of those surfaces change. A task that turns out to be checkpoint-sized is promoted in
place with **"make it a checkpoint"** → `PATCH { kind: 'milestone' }` (already legal via
`ITEM_COLUMNS`); it keeps its id, parent, and children.

> `event` is a fourth kind the table also carries (calendar entries), orthogonal to the
> breakdown ladder. The Workshop deals in goal/milestone/task; events live on the calendar.

## The current path

You should only ever be looking at the piece you're working on. The **current path** is the
chain of first-incomplete checkpoints from the goal down:

- `currentStep(node)` = the first milestone child of `node` that isn't complete.
- Following `currentStep` recursively from the goal gives the current path; the Workshop's
  glyphs mark each node **done / current / later** so a level reads at a glance.
- Everything off the current path is still there — you can drill into any checkpoint — but
  the view's emphasis (the Sheet card, the "break this down" prompt) follows the current
  step, because that's the only checkpoint worth breaking down right now.

## The weekly bench

The bench is a **derived, live** view of the current week — there is no batch job and no
"roll over the week" button.

- **Benched for week W** = a `task` with `week_start = W` and `due_date = NULL`. It's
  committed to the week, not a day. `W` is an **ISO-Monday `YYYY-MM-DD`** string; the single
  source of week math is `weekStart()` in
  [`packages/cards/src/datetime.ts`](../packages/cards/src/datetime.ts) (re-exported through
  BeigeBoard's `lib/theme`).
- **A goal's contribution this week** = its open tasks that are either benched to *this*
  week or `due_date`-scheduled within this week. The bench nudges toward **1–3** per goal —
  a soft copy nudge, never a hard cap.
- **Adrift** — an active goal is adrift when it has **neither** an open day-scheduled task
  **nor** an open task benched to the *current* week: an active goal should always have a next
  action somewhere in reach. **Not currently surfaced in BeigeBoard.** The Full Press rebuild
  removed the carried/adrift/next strips from Today on purpose (see the note at
  [TodayView.tsx:11](../apps/beigeboard/src/views/TodayView.tsx#L11)), and the concept now
  lives in `@jkos/cards` as the `isAdrift` **`PlanResolvers` seam** — whose default is
  `() => false`, so a host that supplies no resolver simply gets no adrift section. Reviving it
  means passing real resolvers, not rewriting the rule.
- **Carried bench** — an open, undated task whose `week_start` is *before* this week's Monday.
  The week-based carry ritual (re-bench / pick a day / let go / park) was **retired with the
  bench sidebar** and its helper is gone. Do not confuse it with the kit's surviving `carried`
  slice in [`sections.ts`](../packages/cards/src/sections.ts), which is a different rule:
  tasks whose **`due_date`** slipped past today. Nothing rolls over silently either way.

## Data mapping

Every state above is a plain column edit — no new tables, no new entities, one dormant column
(`week_start`) revived.

| Concept | Columns | Transition |
|---------|---------|-----------|
| Goal | `kind='goal'`, `parent_id=NULL`, `done_means`, `target_date`, `status`, `accent` | create from the Workshop's goals rail |
| Checkpoint | `kind='milestone'`, `parent_id=<goal or milestone>`, `position` | add under any node; reorder = `position` |
| Sub-checkpoint | same, `parent_id=<milestone>` | drill in, add checkpoint |
| Next action | `kind='task'`, `parent_id=<milestone>` | add under a checkpoint |
| Bench to week W | `week_start=W`, `due_date=NULL` | "→ this wk" |
| Commit to a day | `due_date=<day>`, `week_start=weekStart(day)` | "today / tmrw / pick" |
| Demote day→week | `due_date=NULL`, keep/set `week_start`, **clear `scheduled_time`/`scheduled_end`** | "back to week" |
| Promote task→checkpoint | `kind='milestone'` | "make it a checkpoint" |
| Cleared checkpoint | all descendant tasks `completed` | derived from `getProgress` → review prompt |
| Park a goal for the week | (no write; the bench simply shows "quiet this week") | conscious skip |
| Retire a goal | `status` ≠ `'active'` | park/done on the goal header |

**Promotion normalises the week.** When a task gets a `due_date`, the same patch sets
`week_start = weekStart(due_date)`, so a day-scheduled task always agrees with the week it
falls in. Demotion clears the time fields — a task with no day can't hold a start time.

The backend needs **zero route changes** for any of this: `week_start` is already in
`ITEM_COLUMNS`, `IMPORT_DATE_COLS`, and the length caps, and POST/PATCH/`/import` accept any
`ITEM_COLUMNS` field. The only contract edit is making `week_start` *discoverable* — added to
`ITEM_SHAPE`, the `items` dataset filters, and the `createItem`/`updateItem` bodies in
`discovery.js` (purely additive; the suite-prober and `pnpm test:contracts` stay green).

## AI stance

Manual-first, by design (see [the mission](#the-mission)). The Workshop UI has **no**
"draft it" affordances — you break your own goals down. But the machine seams remain, declared
in `discovery.js` so a Weave peer (eventually LazurOS) can reach them without any UI change:

- **`breakdownGoal`** (`POST /ai/breakdown`) — drafts milestones + first actions for a goal;
  **does not write**. A caller feeds the result into `importItems`.
- **`parseTask`** (`POST /ai/parse-task`) — one free-text line → structured task fields;
  **does not write**.
- **`importItems`** (`POST /import`) — one JSON document → a whole goal→milestone→task tree in
  one transaction (`?dryRun=1` previews). Depth limit `MAX_IMPORT_DEPTH = 8`, comfortably
  above the goal → milestone → task trees the Workshop creates (new creation caps at three
  levels; deeper *existing* nodes still render, surfacing as clickable leaves).

Keeping these as declared-but-unbuttoned seams means turning AI assistance on later is a
front-end decision, not a re-architecture.

## Follow-up

- **Mobile drill-down + bench.** Note this item predates the Full Press rebuild, which
  **retired the desktop drill-down and the bench sidebar** it was written against — so scope it
  against the current two-pane forge, not the old `ShopFloor`/`NodePage`/`Bench` surface.
  `MobileTasksView` reads the same trees generically (deeper trees render, just without a
  drill-in/breadcrumb affordance or a bench rail). Whether mobile should grow affordances the
  desktop no longer has is an open design question, not a settled follow-up.
