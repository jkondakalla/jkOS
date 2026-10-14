# KourOS's widgets

Each `<id>.json` here is a widget. Three kinds live here:

- **Cards** (a `sizing`): ORDECK compiles every app's `widgets/*.json` in at build time
  (`apps/ordeck/src/hud/catalog.ts`), so they are on every HUD's shelf after a deploy —
  no publishing step.
- **Pages** (a `route`): KourOS's own screens, drawn by KourOS's host
  (`src/widgets/host.tsx`) when the location matches — never on the HUD.
- **Parts** (neither): drawn inside another widget by a `use`.

## Pages

- **`kouros-home.json` — Home (`/`).** One source, `discoverHome` (the rails in one
  request, polled every 5 min). A greeting by the hour's slot, the library's size, the
  now-playing card (when something is loaded), then the rails — continue listening,
  recently played, runs, the hour's picks, deep in, new in the library — each a `rail` of
  `tile`s, and each ABSENT rather than empty (a `when` on the list). The coverage line
  closes it. Taps fire the player's host actions (`player.book`, `context.open`,
  `player.play`, `sheet.open`) or `go` to an artist, an album, Browse or the Vibe Map.
  The empty fixture is an empty library.

- **`kouros-now.json` — Now Playing (`/now`).** No source: it binds the host's `player`
  slice, and `playhead` only in its seek bar. A track's face and a book's, chosen by
  `player.kind`, each a `screen` stack — one screen high, the `fill` cover taking what the
  rest leaves, so it never scrolls and the rune layer (App.tsx wraps it) keeps its
  gestures. A track: the queue place, the cover and its room light, artist · album
  (each a `go`), the `pulsarmap`, the scrubber, shuffle · previous · play · next ·
  repeat, the device picker, a station, and the next track. A book: the chapter, the
  jacket, the chapter's scrubber, time left, chapter ⇤ −30 s · play · +30 s chapter ⇥,
  rate, the sleep timer and bookmarks (two menus held in `$state.menu`). The fixtures'
  ready state is a track and empty a book.

## Parts

- **`kouros-now-card.json` — what is playing, at the top of Home.** Binds the host's
  `player` slice: its kind as the eyebrow, its status ("PAUSED ON KITCHEN") as the source,
  the art, title and byline as a `media` (a tap goes to Now Playing), and under it the
  item's own unit — a book's chapters as `steps` with the time left, a track's position
  as a `meter` between its clock times. The page draws it only while `player.loaded`.

## Cards

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
