---
name: new-widget
description: Build an ORDECK HUD widget (a card) for a jkOS app — one JSON file bound to the app's declared data, validated, drawn in every state, looked at, and committed. Use when asked to add, make or change a widget / card / HUD tile for any app (KourOS, BeigeBoard, LazurOS, ORDECK), or when a feature should surface on the HUD.
---

# jkOS new-widget

A widget is **a file**, `apps/<app>/widgets/<id>.json`, bound to what `<app>` already
declares. ORDECK compiles every app's widget files in at build time — you never edit ORDECK
to add one. The reference is [Documentation/agents/WIDGETS.md](../../../Documentation/agents/WIDGETS.md);
this is the procedure.

Repo root: `/media/jag/The Forge/jkOS` (path has a space — quote it). Branch `staging`.
Run every `pnpm` command from the repo root.

## 1 · Find the data it shows

The card can only bind what the app declares. Look in the app's declaration:
`apps/<app>/backend/discovery.js` (LazurOS: `backend/docs.js`) — its `DATASETS` (what can be
read, each with `cardinality` and the `item` fields) and `CAPABILITIES` (what can be done).

- The fields you need are declared → go on.
- They are served but not declared, or the dataset has no `item` → **declare them first**, in
  the app, as their own commit. The app's smoke sweeps each declared dataset against its real
  answer (`checkDeclaredDatasets`), so run that app's backend tests after. See WEAVE.md.
- The data does not exist at all → that is an app feature, not a widget. Build it (and
  declare it) first.

## 2 · Draft it

```
pnpm widget new <app> <app>-<thing> --dataset <dataset> [--pattern P] [--from <field>] [--params k=v]
pnpm widget new <app> <app>-<thing> --ask <capability>
```

- A list dataset → `rows` (default) or `feed` (things that happened, with a time).
- One document → `facts` (default), `stat` (one number), `meter` (a fraction), `media` (art +
  title + progress). A list *inside* the document → `--from <field>` with `rows`/`feed`; its `empty` line sits on
  the list, not the frame (the document is not empty when the list is).
- A path parameter or required filter → `--params id=3`. It tells you if one is missing.

It writes the widget and a fixtures file that pass both validation tiers. If it refuses, the
message says why — usually a declaration gap (step 1). `pnpm widget vocab <kind>` prints any
node's props; `pnpm widget list` shows what already exists (don't build a duplicate).

## 3 · Make it good

The draft is a guess; now judge it:

- **Fields.** Keep the two or three that answer the card's question. Map a status onto a tone
  (`"map": { "DONE": "ok" }, "fallback": "muted"`) instead of adding a derived field to the app;
  format with `fmt` (`ago`, `date`, `time`, `percent`, `duration`, `number`).
- **Frame.** `eyebrow` = what the card is, upper case (`NOW PLAYING`); `source` = the app
  (`KOUROS`); `href: { "src": "origins", "path": "<app>" }` to link back. `empty` = one plain
  sentence ("Nothing played yet."). Never draw loading/offline/signed-out yourself.
- **Refresh.** A dataset that declares `invalidates` re-reads itself when written through a
  capability; add `poll` (seconds) only for changes nothing announces (a worker, playback).
- **Size.** Desktop is 12 columns, mobile 2. `min` is the smallest size at which it still reads.
- **Fixtures.** Replace the sample values with realistic ones — they are what a reviewer sees.
  `ready` and usually `empty`; the gate holds each to the declaration.

## 4 · Check it and LOOK at it

```
pnpm widget check <id>     # both tiers: structure, then every binding against the declarations
pnpm widget shot <id>      # every tier × state, paper and dark → PNG paths
```

**Open both PNGs with the Read tool and look.** Every row (desktop, mobile, smallest) in every
state: is the text cut off, does the card say something sensible when empty, does it read in
the dark face? `shot` prints what it measured (overflow, unellipsised text, a fault tile) —
fix every finding; the gate fails a new one. Iterate until nothing is measured and it looks
right.

## 5 · Commit

```
pnpm test:contracts        # the whole gate must be green (check:widgets, check:widget-render)
```

Commit the widget and its fixtures as one commit on `staging` (a declaration change in the app
is its own, earlier commit). If the app has a `widgets/README.md`, add a line for the new card.
Do not push or deploy — that is Jag's.

## Don'ts

- Don't edit `apps/ordeck/src` to make a widget work. If the vocabulary can't express it,
  that is a change to `packages/widgets` (the manifest) and `packages/widget-render` (the
  renderer) — say so and stop, or do it as its own piece of work (WIDGETS.md § 7).
- Don't put `allowed_roles` in a file (the gate refuses it — nothing could enforce it). Who
  may see data is the dataset's scopes.
- Don't point a `fetch` source at a suite app — suite data is a `dataset` source.
- Don't invent fields in fixtures — the gate compares them to the declaration.
