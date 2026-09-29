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
job-status list" per git history.

## What each spec does

### `lazuros-query` — Ask LazurOS
The body is one `ask` pattern: `{ t: "ask", cmd: { app: "lazuros", capability: "query" } }`.
It sends the question as the capability's `text`; `query` is async (it declares
`resolves: [{ response }]`), so the call answers `202 { job_id }` and the pattern FOLLOWS the
job through the jobs dataset until it ends, then draws `$result.response` under the
question — or the error, if it failed or was not followed to an end.

### `lazuros-jobs` — LazurOS Jobs
One source, `jobs = { kind: "dataset", app: "lazuros", dataset: "jobs", poll: 8 }`: the
jobs dataset LazurOS DECLARES (`backend/docs.js`), found through its DatasetDoc and
refreshed whenever a capability invalidates `lazuros.jobs`. It is owner-scoped server-side
(a non-admin only ever sees their own rows, newest 50). The body is one `rows` pattern: a
dot whose tone is the status mapped onto tones, the status as a word in the lead column,
the capability as the title, the error (only on a row that has one) under it, and how
long ago it was created. The frame draws loading, offline, signed-out, and — through
`frame.empty` — the empty state. `lazuros-jobs.fixtures.json` is what the preview draws,
and the gate holds it to the dataset's declared row.

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

**1. ~~A capability's response body cannot be captured into scope.~~ CLOSED (2026-09-29).**
A form or a button may carry a `result` slot, drawn once its command answers, with
`$result` (what it produced) and `$job` (`{ phase, status, error }`) in scope. An async
command — one whose capability declares `resolves` — is FOLLOWED through its app's
common-shape jobs dataset (weave `followJob`) until it ends, so `$result` is the answer
itself, never a job id. `lazuros-query` shows the reply inline this way.

**2. ~~No per-row derived tone / equality primitive.~~ CLOSED (2026-09-29).** A binding
can map a value (`{ src, path, map: { DONE: "ok" }, fallback: "muted" }`), format it
(`fmt`), and compare (`{ eq }`, `{ in }`, `{ not }`) — @jkos/weave's one binding model;
`lazuros-jobs` colours its rows with it.

**3. ~~`jobs` dataset has no `capability` filter~~ FIXED (git history (item 1.3)).**
`docs.js` `DATASETS_DOC.jobs.filters` now also declares `capability` (exact
match, `column: 'capability', op: 'eq'`) and `since` (delta cursor,
`column: 'updated_at', op: 'gt'`, exclusive — the same convention BeigeBoard's
`items` and KourOS's `books` use), both enforced in `routes/jobs.js` via
`@jkos/weave/server`'s `buildItemFilters`/`filterSpec` (declared == enforced,
no drift). `lazuros-jobs` as shipped still lists all of the user's recent
jobs (its spec's `sources.jobs.url` is a fixed `/api/lazuros/jobs` literal,
not a templated query string), but a capability-scoped feed is now one query
param away (`/api/lazuros/jobs?capability=query`) for whichever consumer
wants it — including a future `lazuros-jobs` variant. *(Backend change only;
nothing under `apps/ordeck/` or these WidgetSpec JSON files was touched.)*

None of the above blocks Phase 8 — both specs are valid, round-trip losslessly,
and render/poll against the real backend using only already-existing ORDECK
mechanisms (`fetch` data sources, the `form`/`button` command family).
