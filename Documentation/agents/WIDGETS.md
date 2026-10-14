# jkOS — Widgets

**How an app puts a card on ORDECK's HUD.** One JSON file, bound to what the app already
declares, checked twice, drawn in every state, looked at, committed.

The code is the source of truth: the vocabulary is `packages/widgets/src/manifest.js`
(print it with `pnpm widget vocab`), the checks are `validate.js` and `semantic.js` beside
it, the renderer is `@jkos/widget-render` (`packages/widget-render/src/render.tsx`). Where
this file disagrees with them, this file is wrong — fix it.

**The renderer is not ORDECK's.** An app draws a widget with `renderWidget(def, host)`, where
the host is what that app hands it: its declared slices (a binding's `src` may name them
beside the widget's own sources), where to sign in, the AI kill switch, this instant, and
the kinds only it can draw (the manifest's molecules, `HostKind`). ORDECK is one host —
`apps/ordeck/src/hud/host.tsx`, with its slices declared in `hud/slices.ts` and its four
molecules (calendar, weather, focus, week). A host kind may be `React.lazy`; it draws under
Suspense, so a heavy one is downloaded only when placed.

---

## 1 · The loop

```
pnpm widget new kouros kouros-recent --dataset discoverHome --from recent --pattern feed
#   → apps/kouros/widgets/kouros-recent.json + kouros-recent.fixtures.json, both tiers passing
#   edit: pick the fields that matter, write the empty line, size it, make the fixtures real
pnpm widget check kouros-recent      # both validation tiers
pnpm widget shot kouros-recent       # every tier × state, paper and dark → PNGs
#   LOOK at both PNGs. Then pnpm test:contracts, and commit.
```

`pnpm widget new` reads the draft off the app's declarations — the source, a pattern that
fits, bindings to real field names, fixtures shaped like the declared row. It refuses (and
says why) when there is nothing honest to draft: a dataset with no `item`, path parameters
you did not pass (`--params id=3`), a capability an `ask` cannot drive. Its forms:

```
pnpm widget new <app> <id> --dataset <name> [--from <field>] [--pattern P] [--params k=v,…]
pnpm widget new <app> <id> --ask <capability>
```

A widget is not done until someone has looked at the PNGs in both faces. The measurements
`shot` prints (a card taller than its footprint, text cut without an ellipsis, a fault
tile) catch the mechanical failures, not the ugly ones.

## 2 · Where it lives, and what reaches production

`apps/<app>/widgets/<id>.json`, fixtures beside it in `<id>.fixtures.json`. The file is
named for its `id`; ids are unique across the suite and, outside ORDECK's own cards,
prefixed with the app (`kouros-now-playing`). ORDECK compiles every app's `widgets/*.json`
in at build time (`hud/catalog.ts`, a Vite glob) — **there is no publish step**: a
committed file is on every HUD's shelf after the next deploy. A saved HUD references a
catalog widget by id, so an edit to the file reaches every placed copy.

Nothing about a widget lives in ORDECK's source. If a card needs something ORDECK does not
have, that is a vocabulary change (§7), not a special case.

## 3 · The file

```json
{
  "id": "kouros-now-playing",
  "label": "Now playing",                       // the shelf's name for it
  "sizing": {
    "desktop": { "w": 4, "h": 3 },               // grid units: desktop 12 columns,
    "mobile":  { "w": 2, "h": 3 },               //   tablet 6 (optional), mobile 2
    "min":     { "w": 3, "h": 3 }                // the smallest it can be resized to
  },
  "spec": {
    "frame":   { "eyebrow": "NOW PLAYING", "source": "KOUROS", "href": { "src": "origins", "path": "kouros" } },
    "sources": { "session": { "kind": "dataset", "app": "kouros", "dataset": "session", "poll": 10 } },
    "body":    { "t": "media", "title": { "src": "session", "path": "now.title" }, … }
  }
}
```

**`sizing` is what makes it a HUD card.** A widget with no `sizing` is a screen or a part
(drawn by its own app, or `use`d by another widget) and never reaches the HUD's shelf —
`hud/catalog.ts` admits only placeable files, and jkAuth refuses an unsized publish.

Optional at the top: `refreshMs`. **Not** `allowed_roles`: it is honoured only on a def
published through jkAuth (`GET /auth/widgets` filters by role), and a file is compiled into
ORDECK's bundle, where nothing could hide it — `check:widgets` refuses it in a file. Who
may see the data is the dataset's business (its `scopes`); the card shows what its sources
return for whoever is signed in.

**The frame is the house chrome.** `eyebrow` names what the card *is* (`PINNED`, `JOBS`);
`source` says where it comes from (`BEIGEBOARD`, `LAZUROS`) or carries a live summary;
`href` makes the card a link back to its app. The frame draws loading, offline,
signed-out and forbidden itself, from the sources' states — never draw those in the body.
`empty` is what it says when every source answered nothing: a sentence, sentence case.

**One widget per screen, responsive by container.** Where the phone UI genuinely differs
(BeigeBoard's agenda week), a widget carries a second body, `spec.mobile`, which a host
on the `mobile` tier draws instead of `spec.body` (`WidgetHost.tier`; ORDECK passes the
tier its grid shows). Same sources, state and frame; both tiers check it as a body, and
whatever it can do (a command, a part) counts for the AI kill switch like the body's.

**`min` is a promise.** `shot` draws the card at `min`, and a card taller than its
footprint there is a gate finding. Pick the size where it still reads, not the smallest
the grid allows.

## 4 · Sources — the data a card reads

Every source is named in `spec.sources`, and a binding's `src` is that name.

| `kind` | What it reads | Notes |
|---|---|---|
| `dataset` | `{ app, dataset, params?, poll?, debounce? }` — a dataset the app **declares** (its DatasetDoc) | Read through the declaration (`readDataset`), with a state the frame draws. `params` fill the path's `:x` and the declared filters (literals or bindings). The dataset's `invalidates` keys re-read it when a capability writes; `poll` (seconds) is for changes no capability announces. `debounce` (ms) holds a re-read until a bound param stops changing — a search box; it needs a bound param to wait on, and holds up only its own source. |
| `fetch` | `{ url, poll? }` — an **external** public https endpoint | A relative URL, `http:`, or any suite host is refused by the validator, jkAuth and the renderer: suite data is a `dataset`. |

ORDECK's own slices are in scope too, by name — `clock`, `weather`, `systems`, `today`,
`cal`, `items`, `notifications`, `focus`, `pinned`, `origins` (each app's origin on this
deployment), `authUrl`, `aiEnabled`. Their fields are declared in `hud/slices.ts`
(`HUD_SLICES`); the second tier checks a binding into one exactly as into a dataset.

Reserved names in scope: `$` (the row, inside a list pattern), `$sources.<name>.state`
(`ready`/`empty`/`idle`/`signed-out`/`forbidden`/`offline`/`unavailable`), `$now` (the
clock's instant — what `fmt: "ago"` measures against), `$state` (the widget's own
variables, §6b), `$in` (a part's inputs, §6b′), `$route` (a page's route params, §6c), and in a command's result slot
(or after a `run` or a `do`) `$result` and `$job`.

**Declare first.** A widget can only bind what its app declares, so a card that needs a
field the dataset does not declare is a Weave change in that app (`discovery.js` /
`docs.js`, and its smoke sweep holds the real answer to it — WEAVE.md). A dataset with
no `item` cannot be bound at all; that is a defect in the app, not in the widget.

## 5 · Bindings

One model for the whole suite (`@jkos/weave/binding`, shared with triggers):

| Form | Means |
|---|---|
| `"text"`, `3`, `true` | a literal |
| `{ "lit": … }` | a literal that might look like a binding |
| `{ "src": "session", "path": "now.title", "fallback": "—" }` | read a value; `fallback` when it is missing |
| `… "map": { "DONE": "ok", "FAILED": "danger" }` | a lookup; a value not in it passes through, or becomes `fallback` if given |
| `… "fmt": "ago"` | one of `upper` `lower` `number` `percent` `time` `date` `ago` `duration`, applied after `map` |
| `{ "eq": [a, b] }` `{ "in": [a, [x, y]] }` `{ "not": a }` | conditions, for `when.cond` or any boolean |

`percent` reads a fraction (`0.42` → `42%`); `duration` reads seconds; `ago` reads an
instant. A tone slot takes a tone (`ok` `warn` `danger` `muted` `accent`) — map a status
onto one rather than computing it in the app.

## 6 · Bodies — start from a pattern

A pattern is a finished card body: the type scale, spacing, accent, and what happens when
narrow are already right. **Reach for one before composing primitives.**

| Pattern | For | Binds |
|---|---|---|
| `stat` | one headline number | `value`, `label`, `unit`, `delta`, `sub`, `trend` |
| `meter` | how far along | `value` (a fraction, or with `max`), `label`, `detail` |
| `rows` | a dense list | `from` (the rows), per row: `title`, `lead`, `mark`/`icon`, `detail`, `sub`, `href`, `progress` (out of `total`) |
| `feed` | what happened, newest first | `from`, per event: `text`, `at`, `icon`, `tone`, `detail` |
| `facts` | a grid of named values | `items: [{ label, value, tone? }]`, `cols` |
| `media` | art, a title, where it is | `image`, `title`, `subtitle`, `meta`, `progress`, `href` |
| `ask` | one question, the answer under it | `cmd`, `field`, `placeholder`, `answer` |

Inside a list pattern, per-row props bind into `$`: `{ "src": "$", "path": "title" }`.
`when` (`cond`, `then`, `else`) switches between bodies — e.g. a session with nothing
loaded. The rest of the vocabulary (primitives, layout, the molecules, form controls) and
every prop's type: `pnpm widget vocab [kind]`, or the Workshop's Guide tab.

**Commands.** `form` (with `input`/`select`/`toggle` inside), `button` and `ask` run a
capability the app declares: `cmd: { app, capability, body? }`, `body` mapping its fields
to bindings (a form's inputs fill the fields they name). The second tier checks that every
required field is bound. If the capability declares `resolves`, it is async: the call
answers `202 { job_id }` and the renderer follows the job through the app's jobs dataset
(the common shape, WEAVE.md) until it ends, so `result` / `answer` draw what it resolved
to — `$result` — and `$job` is `{ phase, status, error }`.

## 6b · State and events

**State** is a widget's own variables — a search query, whether a panel is open, a sort
order. Declare each in `spec.state` (`{ "q": { "type": "string", "default": "" } }`;
types `string` `number` `boolean` `json`), read it as `{ "src": "$state", "path": "q" }`.
Every instance has its own: two placed copies of one widget never share a value.

Two things write it. A control outside a form takes `state` instead of `field` — an
`input`, `select` or `toggle` with `"state": "q"` is a search box, a sort picker, a
switch (inside a form a control still writes `$form` with `field`; exactly one of the
two). And a `set` action, below.

**Events.** A node that can be pressed says what happens in `on` — `button` (`press`),
`rows` (`select`: a tapped row, read as `$`), `media` (`press`), `form` (`done`: its
command succeeded, read as `$result`). Each event runs one action or an ordered list:

| Action | Does |
|---|---|
| `{ "run": { app, capability, body? } }` | a capability its app declares — an async one is followed to its end. A failure stops the rest; the actions after it read what it produced as `$result` |
| `{ "go": "/books/:id", "params": { "id": … } }` | navigate to a page of this app (§6c) — the route exactly as the page declares it, a value for each `:param` |
| `{ "do": "focus.clear", "with"?: { … } }` | an action its **host** declares — an engine the app runs in the page (the player, focus). What it returns is `$result` after it |
| `{ "set": "q", "to": <binding> }` | write a state variable — `{ "not": { "src": "$state", "path": "open" } }` flips a flag |

A button takes `cmd` or `on.press`, exactly one (`cmd` keeps its `result` slot). A row or
a media card is a link (`href`) or an action (`on`), never both. Event bindings resolve
when the event fires, so they never re-render a card. The second tier checks every
action as it checks a node: a `set` names a declared variable, a `run` binds its
capability's required fields, and `$result` after a `run` is what that capability
declares it returns (or resolves to).

**Host actions are declared, then implemented.** A host declares each action as data —
`{ label, args?: [{ name, type, required? }], returns?: […] }`, ORDECK's in
`hud/slices.ts` `HUD_ACTIONS` beside its slices — and implements it in its
`WidgetHost.actions`, typed `HostActions<typeof DECL>`, so tsc refuses one declared and
not implemented or the reverse. The second tier checks a `do` against the declaration:
it exists, takes the arguments given, gets each one it requires. A `do` its host does
not implement fails the chain with "<name> is not available here". A published widget
fires none — a host action is one host's engine, not a server contract.

## 6b′ · Parts — inputs and `use`

A widget can be drawn **inside** another: `{ "t": "use", "widget": "kouros-cover",
"with": { "title": { "src": "$", "path": "title" } } }`. The part declares what it is
handed in `spec.inputs` (`{ "title": { "type": "string", "required": true }, "size":
{ "type": "number", "default": 48 } }`) and reads it as `$in.title`. It keeps its own
sources, state and frame — two uses of one part never share state — and sees only the
host's slices, its inputs and its own sources, never its caller's `$` or `$state`.

A part has no `sizing` (it is not placed on the HUD): ORDECK compiles every file in
(`hud/catalog.ts` `WIDGETS`, what a `use` resolves against) but its shelf (`CATALOG`)
admits only files with a footprint. The second tier checks a `use` against the part:
it exists, is handed only inputs it declares, gets every required one, a literal fits its
type, and the parts never come back round (a cycle; a diamond is fine). What a part
reaches counts for its card: `appsOf` follows `use`, so a LazurOS part makes its card
AI-backed, and a card re-renders when a slice its part binds changes. A use of a widget
its host lacks draws a not-here tile; the renderer stops at `MAX_USE_DEPTH`. A
published widget neither uses a part nor declares inputs.

## 6c · Pages and routes

A widget with a top-level `"route": "/books/:id"` is a **page**: the app it belongs to
draws it when the location matches, and its params are in scope as `$route`
(`{ "src": "$route", "path": "id" }`). A page is a screen, so it has no `sizing` (never
both), and it is never published. Route syntax: `/`, or `/`-separated lowercase
literals and `:params`, no trailing `/`.

An app's route table is **derived from its files** — each page says its own route
(`@jkos/widgets` `routeTable`; the gate refuses two pages that answer the same paths).
`matchRoute`, `fillRoute` and `pageFor` (the most literal route wins: `/books/new` over
`/books/:id`) are the one way a path meets a route, for the renderer and a host's router
alike. A host that routes passes `navigate` and the matched `route` params on its
`WidgetHost`; in one that does not, a `go` stops its chain with "navigation is not
available here". The second tier checks a `go` against the app's pages and the route's
own `:params` — every one filled, nothing else.

**Portability is derived, like AI.** What a widget needs from its host is read off what
it binds (`needsOf`): the host slices it reads, the molecules it draws, the actions it
fires, whether it navigates — through its parts. A widget that needs nothing is
**portable**: any host can draw it. `drawableIn(def, host)` says what a host lacks;
ORDECK's shelf admits only cards ORDECK can draw (`ORDECK_HOST`), the gate requires every
file to have a home among the declared hosts (`scripts/widget/catalog.mjs` `hosts()`),
and `pnpm widget check` prints where each one can live.

**AI.** A widget that reaches an app declared `ai` (LazurOS) is AI-backed: the suite's kill
switch hides it from the shelf and turns a placed one into an "AI is off" tile. That is
derived from what it binds — its sources, its commands and every event's `run` — not
declared; there is nothing to set.

## 7 · What checks it

| Check | Where | What it refuses |
|---|---|---|
| Tier 1 — structure | `validateWidget` (`@jkos/widgets`); jkAuth runs it on every publish | unknown kinds and props (with the likely one), missing required props, controls outside a form, unsafe hrefs, footprints off the grid, suite hosts in a `fetch`, a def over the size limit |
| Tier 1 — published | `validateWidget(def, { published: true })` — jkAuth's publish and the Workshop | anything but **declared server contracts**: a binding to a host's slice, a molecule, a missing `sizing`. A published widget reaches every user's HUD and binds only its own datasets and capabilities, which their apps scope-check; a slice-bound card is a file in its app |
| Tier 2 — meaning | `checkBindings` (`@jkos/widgets/semantic`) | a binding to a field the source does not declare, a source naming an undeclared dataset or param, a missing path param or required filter, a command with an unbound required field, a `map` onto a closed vocabulary (a tone, an icon) with a value outside it, a list read from inside a one-document dataset with no `empty` of its own (the document is not empty when the list is, so the card would draw blank) |
| `check:widgets` | `test/widgets.mjs` | every shipped file through both tiers, named for its id, no `allowed_roles`, and its fixtures shaped as the dataset declares |
| `check:widget-render` | `test/widget-render.mjs` | every shipped widget drawn in every tier × state through the real renderer; a new layout finding fails the gate (`test/widget-render.baseline.json` only ratchets down) |

Fixtures are what `shot` and the gate draw: `{ "<state>": { "<source>": <answer> } }`
for the states `ready` and `empty` (loading, offline and signed-out are synthesised). A
source missing from a state answers `[]` (or `null` for a one-document dataset). Make
them real-looking — they are what a reviewer sees.

**Changing the vocabulary** (a new pattern, a prop, a format) is a change to
`packages/widgets` — the manifest drives the generated `WidgetNode` union
(`pnpm widgets:gen`; `check:widgets` fails while it is stale), the Workshop and `vocab` — plus its renderer in
`packages/widget-render/src/render.tsx` and `widgets.css` (or, for a molecule, the host's kind). After adding a file under `packages/`, run
`pnpm install --offline` (TRAPS.md: injected workspace copies).
