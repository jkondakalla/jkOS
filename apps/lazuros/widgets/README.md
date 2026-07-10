# LazurOS ORDECK widgets (Phase 8)

Two WidgetSpec documents for ORDECK's `/widgets` Workshop, authored in ORDECK's
declarative spec dialect (`apps/ordeck/src/hud/types.ts` — `WidgetDef` /
`WidgetSpec` / `WidgetNode`). **No ORDECK code was changed.** These are pure
data; publishing them is a Workshop UI action only.

## Files

- `lazuros-query.json` — **Ask LazurOS**, a free-text box that fires the
  `query` capability (`POST /api/lazuros/query`) as an async job.
- `lazuros-jobs.json` — **LazurOS Jobs**, a polling list of the signed-in
  user's recent jobs (id/capability/status/timestamp, error line if failed).

Together they cover "publish WidgetSpec docs for `query` (assistant box) + a
job-status list" per ToDo.md §1.

## What each spec does

### `lazuros-query` — Ask LazurOS
A card with one `form` node: a text `input` (`field: "text"`) and a submit
button labelled ASK. Submitting runs `CommandRef{app:"lazuros",
capability:"query", body:{text: $form.text}}` through ORDECK's existing
command dispatcher (`useCommand`/`runCommand` in `hud/registry.tsx`), which
`POST`s `/api/lazuros/query` and shows an inline DONE / COULDN'T SAVE note.
The server responds `202 {job_id}` (see `apps/lazuros/backend/routes/
capability.js`) — the job runs async. A static sub-line under the form tells
the user to check the Jobs widget for the answer (see "Dialect gap" below for
why the result can't be shown inline).

### `lazuros-jobs` — LazurOS Jobs
A card with one `sources.jobs = {from:"fetch", url:"/api/lazuros/jobs",
poll:8}` — a same-origin, cookie-authenticated poll every 8s (ORDECK's
generic "no-deploy" fetch-source path; `useDataSources` in `hud/registry.tsx`
already refetches on tab-visibility too). The `jobs` dataset endpoint
(`apps/lazuros/backend/routes/jobs.js`) is owner-scoped server-side (a
non-admin only ever sees their own rows, newest 50), so no client-side
filtering by user is needed. The body is a `list` bound to that source
showing, per job: a status pill (text = the raw status string — see gap
below), the capability id, the created-at timestamp, and — only when
present — the error string.

Both specs were sized against the existing v5 catalog's density (weather/
systems footprints): `lazuros-query` 4×4 desktop / 2×4 mobile,
`lazuros-jobs` 4×6 desktop / 2×5 mobile.

## How they were validated

No live staging session was available, so validation ran the actual ORDECK
code against these documents (read-only, nothing under `apps/ordeck/` was
edited):

1. **Structural + healer idempotency** — ran the real gate script,
   `node apps/ordeck/scripts/check-hud-doc.mjs <synthetic-hud-doc.json>`,
   against a synthetic `HudState` doc embedding both widgets in a desktop
   layout. This transpiles and executes the actual `hud/types.ts` +
   `hud/engine.ts` + `hud/state.ts` graph (the same check wired into the
   suite gate as `pnpm check:hud`). Result: **structurally valid (v5, 2
   widgets)**, and `mergePublished` is idempotent for both the "own-defs
   published" and "empty published" cases — i.e. publishing these specs and
   re-publishing them is a stable fixed point, not a re-snap loop.
2. **Primitive vocabulary + CommandRef contract** — a throwaway scratchpad
   script (not committed) walked every `WidgetNode` in both bodies and
   checked `t` against ORDECK's real primitive set (cross-referenced from
   `registry.tsx`'s `Primitives` type, which TS enforces is exhaustive over
   `WidgetNode['t']`), and cross-checked the `form.cmd` `CommandRef` against
   the **live** `apps/lazuros/backend/docs.js` `CAPABILITIES_DOC` (not a
   hand-copy): confirmed `app:"lazuros"` is a valid `AppId`, `capability:
   "query"` exists (`POST /api/lazuros/query`), and `cmd.body.text` matches
   a declared body field on that capability.
3. **Lossless workshop round-trip** — the same script transpiled the real
   `apps/ordeck/src/workshop/model.ts` (pure TS, type-only imports) and ran
   `nodeToEn(spec.body)` → `enToNode(...)`, asserting byte-identical JSON
   both ways. This is the exact guarantee the canvas editor depends on
   ("what you edit is what ships") — both specs round-trip clean, so loading
   either through the Workshop (see publish steps) and republishing without
   touching anything will not mutate them.
4. **Backend regression** — `pnpm --filter @jkos/lazuros-backend test` (18 +
   30 + 11 + 12 = 71 assertions) still passes; nothing under `apps/lazuros/
   backend/` was touched.

All checks passed. No `pnpm test:contracts` run (out of scope — orchestrator's
job) and no new gate was added.

## Publish steps (manual — do this in the Workshop UI)

The Workshop (`apps/ordeck/src/pages/WidgetWorkshop.tsx`) has no JSON-import
box; it's a canvas editor. But it already has a lossless "edit this card"
handoff — the HUD's pencil affordance stashes a `WidgetDef` in
`localStorage['ordeck-widget-edit']` and navigates to `/widgets`, which loads
it straight into the editor on mount. That's the fastest, least error-prone
way to get one of these exact JSON documents into the Workshop by hand:

1. Log into staging as an **admin** and open the Workshop:
   `https://staging.jkos.net/widgets` (ORDECK is the staging root portal).
2. Open the browser devtools console on that page.
3. Paste the contents of `lazuros-query.json` into this one-liner (replace
   `<PASTE JSON HERE>` with the file's exact contents) and run it:
   ```js
   localStorage.setItem('ordeck-widget-edit', JSON.stringify(<PASTE JSON HERE>));
   ```
4. Reload the page. The Workshop loads the def into the canvas and shows
   `Editing "lazuros-query" — change anything and re-publish to update it
   everywhere.` Switch the top-right toggle to **LIVE** to sanity-check it
   renders (the form + hint line) against the real HUD context.
5. Click **Publish** (top toolbar, amber button). On success the page shows
   `Published "lazuros-query" — it's on every HUD's add strip now.` — that
   `POST /auth/widgets` call is admin-gated server-side (`apps/jkauth/src/
   routes/weave.js`), so a non-admin session will get a 403 here instead.
6. Repeat steps 2–5 for `lazuros-jobs.json`.
7. Confirm both now appear under the Workshop's PUBLISHED list, then open
   any HUD's "add widget" tray/shelf and place them to smoke-test live data
   (submit a query, watch it appear in the Jobs list within ~8s).

**Fallback (no devtools / prefer clicking):** both trees are shallow enough
to build by hand from the Workshop's right-click "ADD ELEMENT" menu — for
`lazuros-query`: root stack → add **Action form** (set its App/Capability in
the Inspector to `lazuros` / `query`, add a body row `text` → `$form.text`)
→ inside the form add **Form input** (`field: text`, placeholder "Ask
LazurOS…") → back at the root add a **Text** sibling with the hint line. For
`lazuros-jobs`: set identity's one **Fetch source** (Inspector → Data tab) to
name `jobs`, url `/api/lazuros/jobs`, poll `8` → root **List** bound to
`jobs` → item = **Stack** containing a **Row** (Status pill bound to
`$.status`, Text bound to `$.capability`, Text bound to `$.created_at`) and a
**Condition** (`$.error`) wrapping a **Text** bound to `$.error`. This path is
tedious (~15+ clicks) and worth it only if the console trick is unavailable.

## Dialect gaps (precise — nothing here was worked around by touching ORDECK)

**1. A capability's response body cannot be captured into scope.**
`form`/`button` dispatch through `useCommand.run()` in `hud/registry.tsx`,
which calls `runCommand()` (returns `{ok, status, data, error}` — `data`
*does* carry the `{job_id}` the server returns) but the hook only keeps
`res.ok` for its inline DONE/RETRY note; `res.data` is discarded. There is no
way for a spec to bind a sibling node — or a `sources.fetch` URL — to the
`job_id` a submit just created. That is why `lazuros-query` cannot filter
`lazuros-jobs`'s list down to "the job I just fired" or show its result
inline; the closest full-fidelity spec is the two independent widgets
shipped here (submit box + all-jobs list), which is a real but incomplete
approximation of "input → command → poll that job".
&nbsp;&nbsp;*Smallest enabling ORDECK change:* extend the form's local state
to expose the last command's `res.data` as a bindable source (e.g. `$result`,
alongside the existing `$form`), and let a `sources.fetch` `DataSource.url`
accept a `Binding` (or a `{tmpl}` string with `{$result.job_id}`
interpolation) instead of a fixed literal string, so a sibling/child node
could poll `/api/lazuros/jobs?job_id={$result.job_id}`.

**2. No per-row derived tone / equality primitive.**
`ToneBinding` only resolves an *exact* match against the fixed `Tone` enum
(`ok|warn|danger|muted|accent`) — `{src:'$', path:'status'}` on a raw job row
resolves to `"PENDING"`/`"DONE"`/`"FAILED"`/etc., none of which are `Tone`
values, so it would silently fall back to the tone's default rather than
color-coding by status. `lazuros-jobs` sidesteps this by using a `pill` with
an explicit `tone:"muted"` and relying on the **status text itself** (still
fully legible, just not color-coded) rather than shipping a widget that
falsely tints every row the same fallback color. `Binding`/`cond` also has no
equality operator, so a status→tone mapping can't be built from nested
`when` branches either (`when.cond` is bare truthiness, not `a === b`).
&nbsp;&nbsp;*Smallest enabling ORDECK change:* either (a) add an `{eq:[Binding,
Binding]}` (or `{oneOf:[Binding, val[]]}`) `cond`/`Binding` form so a chain of
`when`s can derive a tone, or (b) — matching how BeigeBoard-backed hud slices
already pre-derive a `.tone` field client-side in `useHudData.ts` — give the
lazuros `jobs` dataset (or a client-side selector) a derived `tone` column so
`ToneBinding` has something to bind to directly.

**3. `jobs` dataset has no `capability` filter (flagged in the task
brief).** `docs.js` `DATASETS_DOC.jobs.filters` is `job_id`/`status`/
`user_id` only — no `capability` and no `since` cursor. `lazuros-jobs`
therefore lists **all** of the user's recent jobs (any capability), not just
`query` jobs; this is functionally fine (owner-scoped, 50-row cap, still
useful) but not a capability-scoped feed. *(Backend change, not ORDECK —
noted per the task's own heads-up, not implemented here.)*

None of the above blocks Phase 8 — both specs are valid, round-trip losslessly,
and render/poll against the real backend using only already-existing ORDECK
mechanisms (`fetch` data sources, the `form`/`button` command family).
