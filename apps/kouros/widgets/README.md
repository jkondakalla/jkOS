# KourOS's ORDECK widgets

Each `<id>.json` here is a widget; ORDECK compiles every app's `widgets/*.json` in at build
time (`apps/ordeck/src/hud/catalog.ts`), so they are on every HUD's shelf after a deploy —
no publishing step.

- **`kouros-now-playing.json` — Now playing.** One source, the `session` dataset (one
  document per user: the listening session, `now`, the devices), polled every 10 s. `now`
  is the session's current item resolved server-side — title, `subtitle` ("Artist — Album",
  or the author), `cover_url` (null when there is no art), `position_ms` extrapolated to the
  moment of the read, and `progress` as a fraction — so the card binds it straight into a
  `media` pattern. When nothing is loaded `now` is null and the card says so.
- **`kouros-recent.json` — Recently played.** The `recent` rail of `discoverHome` (albums,
  stations, playlists and books by the context they were played in, newest first) as a
  `feed`: a glyph by kind, the title, its subtitle, and how long ago.
- **`kouros-continue-books.json` — Continue listening.** The `continue_books` rail of
  `discoverHome` (audiobooks with a saved position that are not finished, newest first, at
  most 12) as `rows`: the title, the author, when it was last played, and a thin bar of
  `position` out of `duration` under each. Six are shown and the rest become "+N more"
  (the list scrolls within the card). The rail is a list inside one document, so an empty
  one is not an empty source — the pattern says its own empty line. Built by a cold agent
  from the new-widget skill alone (2026-09-29); its friction shaped per-row progress.

The fixtures beside each are what the preview draws; the gate holds them to what KourOS
declares (`backend/discovery.js`). Change one, then:

```
pnpm widget check kouros-now-playing   # both validation tiers
pnpm widget shot kouros-now-playing    # every tier × state, both faces
```

and look at the PNGs.
