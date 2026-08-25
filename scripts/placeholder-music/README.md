# Placeholder music for KourOS

A fictional 34-album library — audio, sleeves, tags, listening history, playlists and a
stand-in embedder index — so the glass can be looked at before the real library and the
real vectors are in place. Nothing here is real music and nothing here is anyone's
copyright: every sleeve is drawn by `sleeves.mjs` and every track is synthesised by
ffmpeg from an expression `audio.mjs` writes.

```
node scripts/placeholder-music/cli.mjs build     # ~4 min, ~280 MB, once
node scripts/placeholder-music/cli.mjs serve     # → http://localhost:4173
```

`serve` builds the app and serves it. `dev` runs vite instead, with HMR, at the same
URL — use it to iterate on `glass.css`.

Everything lands **outside the repo**, in `../kouros-placeholder-music/`:

```
Music/                          the library MUSIC_DIR points at
  <Artist> - <Album> (year) [MP3]/NN. <Artist> - <Title>.mp3
  Old (Needs to be trimmed)/    one album the scan must refuse to enter
data/
  kouros.db                     the app's own database (+ covers/)
  music-index.db                the stand-in for music/index.db
  manifest.json                 what `reindex` rebuilds the vector space from
```

Delete that one directory and nothing is left behind.

## Commands

| | |
|---|---|
| `build` | write the library and the vector index. `--bitrate`, `--concurrency`, `--lib`, `--data` |
| `serve` | auth stub + backend + the built app, one origin, on `:4173` |
| `dev` | the same with vite + HMR as the app half, still `:4173` |
| `reindex` | rebuild the vector space only — seconds, no re-encode. `--coverage`, `--album-spread`, `--track-spread` |
| `seed` | re-roll the listening history and playlists |

## What it covers, and why each piece is there

**The library has the shape of the real one, not a convenient one.** Album folders are
the flat `<Artist> - <Album> (year) [TAG]` form the re-download uses, because
`backend/src/discover/vectors.js` recovers an artist and title from that path shape, and
`Old (Needs to be trimmed)/` exists so `MUSIC_EXCLUDE_DIRS` has something to bite on. The
catalog deliberately includes the things that break layouts: a title that runs to three
lines, `Sølvregn` and `Café Électrique`, a two-disc set, a one-track single, a six-track
EP, a Various Artists compilation, and release dates from 1968 to 2025.

**The sleeves are the accent source.** `player/accent.ts` derives the Now Playing colour
scheme from the cover's dominant hue and its own header records what a hueless sleeve
does to it — a dead slate orb on every track. So every album is painted around one
committed hue in one of nine treatments, which is what makes the glass show its range as
you move between albums.

**The audio is real audio.** Each album has a key, tempo, chord progression and
instrumentation from its genre; each track varies within it and runs a genre-appropriate
1:30–8:30. The progress bar advances over a real duration, seeking lands somewhere, and
an ambient record does not sound like a punk one.

**The vector index is not noise.** Clusters are per genre — the same profile that drove
the synthesis — so the vibe map's regions are real regions and "if you like this" returns
things that sound alike. A corpus axis is added on purpose and then fitted and stored as
`calib_*` in `meta`, because that anisotropic cone is the thing
`backend/src/discover/vectors.js` exists to correct for; uniform random vectors would
leave that path untested. Coverage is 71%, with three albums left with no vectors at all,
so album propagation and the metadata-fallback badge both have something to do.

**History is shaped.** Two artists are a current obsession, two are fading, and a long
tail runs back 90 days — which is what Home's "Deep in" (10-day half-life) and "Picked up"
rails actually read. A fifth of plays are skips and partials.

## The two things it has to fake

**`auth-stub.mjs`** answers `/auth/me`, `/auth/profile`, `/auth/refresh` and
`/auth/logout`. The backend already degrades on its own — `weaveAuth` injects a stub user
when no key is configured outside production — but `AuthGuard` does not, and redirects to
`auth.jkos.net` on any answer that is not a user. The stub also serves the preferences
blob, so the settings drawer's mode toggle, accent pair and effect switches all work and
persist for the session. It authenticates nothing, binds to `127.0.0.1`, and refuses to
start under `NODE_ENV=production`.

**`edge.mjs`** is the one nginx rule the app cannot run without. Most calls go to bare
`/api/*`, but the `tracks` catalog goes through the weave dataset contract at
`/api/kouros/*`, which the suite edge rewrites back to `/api/*`. Without it `listTracks()`
404s, weaveClient returns `[]` as documented, and Browse / Search / Artist / Album render
as an empty library while Home is full of music.

## Known, and not a fixture bug

- **Runs tiles repeat a sleeve.** The 2×2 mosaic takes the run's first four tracks; over
  34 albums a run often opens on two of them. A real library hides it.
- **Vibe-map region labels can overlap** where clusters sit close. `reindex
  --album-spread 0.55` pushes them apart if you want to look at something else.
