# `@jkos/player` — the media primitive (design spec)

One player primitive with seams per app: a **video** player (Plex/Jellyfin class), a **music**
player (Plexamp floor, Spotify ceiling), and the **audiobook** player PapyrOS already has. One
shared backend, because it mostly does the same job.

**This document is the architecture.** The task program lives in
[ToDo.md § 3](ToDo.md) — waves, sizing, and ordering are *there*, not here, so the two can't drift.

**Written 2026-07-13.**

**Status — Wave 15 SHIPPED 2026-07-14 (committed `efcd32c`):** `packages/player` exists with
Layer 0 (`./core`: timeline math lifted verbatim from papyros `position.ts` + pure Queue
reducers with stable seeded shuffle), the `MediaBackend` seam (`./backend`:
`createHtmlMediaBackend`, one impl for `<audio>`/`<video>`, classified error vocabulary), and
Layer 1 (`./engine`: the generalized headless `usePlayerEngine`, all six load-bearing
invariants preserved with inline `[INVARIANT x]` tags). PapyrOS migrated: its
`usePlayerEngine.ts` is now a ~200-line adapter (756 before), `position.ts` deleted
(`fmtClock` imports from `@jkos/player/core`), `PlayerBar.tsx` and all other consumers
unchanged. 158 package assertions chained into `pnpm test:contracts`.

**Wave 16, item 16.7 SHIPPED 2026-07-15 (committed `efcd32c`):** `@jkos/player/factory`
(`packages/player/src/factory/`) — `createPlayer(spec)` + `audiobookPlayer()` / `musicPlayer()`
/ `videoPlayer()`. See §3 "Layer 3 — UI kit" below for the shape actually built. The rest of
Wave 16 (16.1–16.6) and Layers 2/3's remaining pieces track separately in ToDo.md §3.

---

## Decisions (Jag, 2026-07-13)

| Decision | Choice |
|---|---|
| Extraction order | **Extract first; PapyrOS proves it.** Build the primitive from PapyrOS's engine, migrate PapyrOS onto it with zero behavior change, then build music as consumer #2. Supersedes the "second consumer proves the seam" doctrine *for the player only* — the seam is already enumerated, and PapyrOS is the hardest case. |
| Topology | **Three apps, one primitive.** `papyros` (3010) + a music app + (later) a video app. Each keeps its own scope / edge / DB. |
| Video v1 | **Parked.** Build the seams so nothing blocks it; don't build a video app yet. |
| Backend sharing | **Shared bricks, separate DBs.** Each app keeps its own SQLite + schema; shared bricks generate them. |

---

## 1. The insight the whole thing rests on

Video, music, and audiobooks look like three domains. They are one — and PapyrOS already contains
most of it, hiding in plain sight.

`apps/papyros/src/player/position.ts` **does not model a book.** It models *N sources concatenated
into one global timeline, with a gap-free list of nav points over it* — `buildFileMap`, `locate`,
`toGlobal`, `navPoints`, `currentNav`. No React, no network, pure math. Rename two types
(`BookFile` → `MediaSource`, `BookChapter` → `Segment`) and it is the media core, unchanged.

Generalize the two nouns and the domains collapse:

- **Timeline** — an ordered list of `MediaSource`s, a derived duration, and `Segment`s over it.
- **Queue** — an ordered list of Timelines, plus a cursor and a policy (shuffle, repeat).

| Domain | Queue | Timeline | Segments |
|---|---|---|---|
| Audiobook | 1 item (the book) | N files concatenated | chapters |
| Music | N items (tracks) | 1 file each | *(none)* |
| Video — film | 1 item | 1 file (+ renditions) | chapter markers |
| Video — series | N items (episodes) | 1 file each | markers, skip-intro |

**PapyrOS already solves the hardest case** — multi-source single-timeline with segments and one
unified position. Music is the *easy* case. Video is music plus a `<video>` element and a much
heavier backend.

So this is not "add music and video to PapyrOS." It is: **extract what's there, add the queue
layer above it, abstract the media element below it.**

---

## 2. What PapyrOS actually has

Verified in code, not assumed.

| | State |
|---|---|
| Play/pause, scrub, seek, ±30s | ✔ `usePlayerEngine.ts`, `PlayerBar.tsx` |
| Prev/next **chapter** (3s-restart idiom) | ✔ `PREV_RESTART_SEC` |
| Playback rate (7 presets, persisted) | ✔ |
| Sleep timer (15/30/45/60/end-of-chapter) | ✔ |
| Bookmarks | ✔ |
| Resume + debounced progress upsert | ✔ serialize-in-flight, skip-unchanged, flush on pause/hide/unload |
| **MediaSession** | ✔ **already wired** — `usePlayerEngine.ts:381-407`: metadata, play/pause, seek±, prev/next, `playbackState`. Only **`setPositionState` is missing** (the lock-screen scrubber is inaccurate without it). |
| Firefox compat ladder + auto-recovery | ✔ `?compat=<n>`, `reqSeq` guard, reentrancy guard |
| Offline download + SW serving | ✔ `src/offline/*`, `public/sw.js` |
| Chapter list with per-chapter progress fill | ✔ `BookDetail.tsx` `chapterFraction` |
| **Queue** | ✘ **none.** `onEnded` advances *within* a book only. Nothing to shuffle, repeat, or autoplay. |
| **Volume / mute** | ✘ not in `PlayerApi` at all |
| **Gapless / crossfade** | ✘ one `<audio>`, `src` swap per file — structurally can't |
| **Play history** | ✘ **no `history`/`plays`/`listens` table exists.** `progress.last_played` (one overwritten timestamp per user per book) is the entire extent of "when did I listen". Nothing computes stats. |

That is already most of a Plexamp-class *audiobook* player. The gap is everything that assumes a
queue, plus audio output and history.

---

## 3. Architecture

Four layers, matching the house pattern (`@jkos/cards`: pure logic → hook → factory → views).

### Layer 0 — contracts (pure, no DOM, no React)
`packages/player/core/`

Types (`MediaItem`, `MediaSource`, `Segment`, `Timeline`, `Queue`, `PlaybackState`), the timeline
math (**`position.ts` promoted almost verbatim**), and pure queue reducers — `next`, `prev`,
`shuffle` (stable seeded order, *not* re-roll-on-skip), `repeat` (off/all/one), `reorder`,
`insertNext`, `append`.

This layer *is* the abstraction. If it's right, everything above is mechanical.

### Layer 1 — engine (headless hook)
`packages/player/engine/`

`usePlayerEngine` generalized: it stops owning an `<audio>` element and instead drives a
**`MediaBackend`** — `load(source)`, `play`/`pause`/`seek`/`rate`/`volume`, plus an event stream.

- `htmlMedia` — wraps `HTMLMediaElement`. **One impl serves both `<audio>` and `<video>`** (the API
  is identical), which is why the video *player* costs almost nothing.
- `gaplessDual` — two elements, preload-and-swap. Buys gapless + crossfade for music.
- `hls` — adaptive video, later.

The Firefox compat ladder becomes a backend-level **recovery policy** (`onDecodeError → escalate
rung → reload`), not audiobook glue.

**Load-bearing details to preserve in the extraction** (each was a real bug once): stable-identity
element; refs-in-listeners (no stale closures); the `reqSeq` load guard; serialized single-flight
progress writes; the `recoveringRef` reentrancy guard; the `NotAllowedError` autoplay path.

### Layer 2 — services (built once, all three modes inherit)
`packages/player/services/`

MediaSession (+ the missing `setPositionState`) · progress/resume via a pluggable `ProgressStore` ·
sleep timer (`'chapter'` → `'segment'`) · keyboard map · offline cache seam · **offline write
queue** · **play-history emitter**.

### Layer 3 — UI kit (parts + factory)
`packages/player/ui/` (parts) + `packages/player/factory/` (item 16.7, shipped 2026-07-15)

Two separate export subpaths, deliberately not one module:

- **`@jkos/player/ui`** — the kit of parts (item 16.6, shipped): `<PlayerBar>` (slotted shell —
  the desktop 3-column / mobile compact-row *layout* is reusable; the audiobook control *set*
  isn't), the stock control library (`<Transport>`, `<PlayPauseButton>`, `<SkipButton>`,
  `<SegmentButton>`, `<RateButton>`, `<SleepMenu>`), `<Scrubber>` (segment-aware —
  `chapterFraction` generalizes directly), `<QueuePanel>` (reorder via the existing
  `usePointerDrag`), `<NowPlaying>`, `<SegmentList>`. This barrel is React/DOM-heavy and
  deliberately **factory-free** — see its header comment.
- **`@jkos/player/factory`** — `createPlayer(spec)`, mirroring `cardSurface` / `buildJkOSTheme`
  in the literal sense (spec/opts **in**, plain derived **data** out — neither of those
  exemplars returns JSX either): zero runtime imports, no React, no `@jkos/design`. A spec
  declares which capabilities are on (`skipSeconds`, `nav: 'segment' | 'track' | false`, `rate`,
  `sleep`, `bookmarks`, `volume`, `shuffle`, `repeat`, `queue`, `accentFromArt`) plus layout hints
  (`scrubberMode`, `mobileTransport`); `createPlayer()` derives two ordered `ControlId[]` lists
  (`transportControls`, `actionControls`) capability-driven, not kind-driven. A consumer reads
  those ids and mounts the matching real `@jkos/player/ui` parts — the factory names *which*
  parts and in what order, an app still wires the JSX. This is what keeps PapyrOS's zero-change
  guarantee intact: nothing forces its hand-assembled bar onto the factory's output shape.

  Presets differ only in emphasis, not mechanism (all three are `resolveSpec()` calls with a
  different capability set, and take an optional partial-override argument):

  - `audiobookPlayer()` — ±30s skip, segment nav, rate, sleep, bookmarks. No volume/shuffle/
    repeat/queue. **= today's PlayerBar's exact capability set**, verified against
    `apps/papyros/src/player/PlayerBar.tsx`.
  - `musicPlayer()` — track nav, shuffle, repeat, queue, volume, `accentFromArt: true`. No skip/
    rate/sleep/bookmarks (audiobook-only concepts). The art-derived accent is a **seam, not a
    dependency**: `accentFromArt` is only a declarative flag; the spec's optional
    `deriveAccent(coverUrl) => { primary?, secondary? }` hook — supplied by the consuming app —
    does the actual pixel extraction, and its result is shaped to drop straight into
    `buildJkOSTheme({ accent })`. `@jkos/player` never imports `@jkos/design`.
  - `videoPlayer()` — returns a fully-inspectable spec flagged `unbuilt: true`; `createPlayer()`
    throws rather than compose it (message points at Wave 19), until a caller overrides the flag.
    The capability shape used today (`nav: 'track'`, `volume`, `queue`) is a placeholder — it does
    **not** yet model fullscreen, PiP, subtitle + audio-track pickers, quality picker,
    hover-thumbnail scrub, skip-intro, next-episode card, or idle-hide chrome. Wave 19 extends the
    capability vocabulary when it builds those.

**Status — Wave 18.4 SHIPPED 2026-07-15 (committed `efcd32c`): the queue-composition verdict.**
KourOS (`apps/kouros/src/player/`) is consumer #2. The engine drives exactly ONE Timeline (a
music track is a single-file Timeline, per the table in §1) — the Queue layer above it is composed
entirely in APP code over `@jkos/player/core`'s pure reducers, never inside the engine. Two real
gaps surfaced, both worked around in app code (packages/player untouched, gate stayed green):
(1) the engine has no "the item ended and there's nothing more to load" callback — `onEnded`
either advances within the current item's sources or goes silent — so queue auto-advance has to
watch the PUBLIC `playing`/`globalPos`/`total` surface for the `true→false` edge with
`globalPos>=total` (onEnded snaps position to `total` before flipping `playing`, which is what
disambiguates a natural end from a user pause); (2) `core/queue` has no removal reducer even
though `@jkos/player/ui`'s `<QueuePanel>` takes an `onRemove` prop — the app supplies one
(`apps/kouros/src/player/queuePrefs.ts`'s `removeAt`) mirroring `reorder`'s cursor-preservation
shape, built only on the PUBLIC `shuffle()` reducer. Separately, `@jkos/player/ui`'s stock control
library (item 16.6) only ever stocked the AUDIOBOOK control vocabulary — none of `musicPlayer()`'s
six factory-derived control ids (`shuffle`/`trackPrev`/`trackNext`/`repeat`/`volume`/`queue`) have
a shipped `@jkos/player/ui` part, so the app builds all six locally against the kit's `pb-*` CSS
classes (`apps/kouros/src/player/controls.tsx` + `icons.tsx`) — the same "app builds what the kit
doesn't stock" precedent papyros's bespoke bookmarks menu already set. `accentFromArt` confirmed
workable exactly as specced: the app's `deriveAccent`-shaped hook (`accent.ts`) does canvas pixel
sampling and applies the result as `--accent`/`--accent-secondary` inline-style overrides on the
bar's own wrapper element — every kit rule already keyed on `var(--accent)` recolors for free via
CSS custom-property inheritance, zero `@jkos/player` changes needed. Record:
ARCHITECTURE.md § KourOS.

**Status — Wave 18.5 SHIPPED 2026-07-16 (committed `efcd32c`): `gaplessDual` exists.**
`createGaplessDualBackend` (`packages/player/src/backend/gaplessDual.ts`) is the second
`MediaBackend` impl — two elements, the standby preloads the `prepareNext(url)` ~15 s out, swap at
the boundary (crossfade 0 = at the exact 'ended'; 0–12 s = linear cross-ramp under the user-volume
ceiling). The gapless surface is an additive optional extension (`GaplessBackend`, feature-detected
via `isGaplessBackend`) — `createHtmlMediaBackend`, the engine, and PapyrOS are byte-untouched.
The engine/queue handshake, in two sentences: a swap reads to the engine as an instant
`loadedmetadata`+`play` of the next source (never an 'ended', so the adapter's playing-edge
auto-advance cannot double-fire), while the backend's `onSwap` side-channel hands the KourOS
adapter the consumed url — the adapter verifies it against the queue's expected next via
`urls.stream(...)` equality and advances the cursor through the ordinary `requestPlay` round-trip.
The engine's resulting `backend.load(sameUrl)` is recognized by the backend as a one-shot
acknowledgment — the already-playing element is adopted, never reloaded, so no double-load can
reintroduce the gap. Full design + edge-case semantics: gaplessDual.ts's header and the SWAP
HANDSHAKE comment in `apps/kouros/src/player/usePlayerEngine.ts`. Record:
ARCHITECTURE.md § KourOS.

One KNOWN micro-race, noted not fixed (2026-07-16 integration review): the adapter's
defensive stale-swap branch (queue reordered/removed inside the milliseconds between the
backend committing a boundary swap and the prepare effect re-preparing) reasserts the queue
with an ordinary `requestPlay` — but if the reassert target happens to share the id of the
engine's CURRENT item (only possible with duplicate track ids in one queue), the engine's
same-item fast path answers with a seek instead of the hard-cut `backend.load()`, leaving the
audible element and the UI briefly disagreeing until the next boundary or user action. Needs
an ms-scale race AND the id coincidence; self-heals; deliberately not worth surgery on the
green 91-assertion backend.

---

## 4. Backend — shared bricks, separate DBs

Each app keeps its own SQLite and its own schema; the bricks generate them.

- **`@jkos/files`** — `rangeStream` + `containPath`, lifted from PapyrOS's `media.js`.
- **`defineLibraryScanner`** — walk → ffprobe pool → mtime-incremental skip → upsert → prune. The
  ladder is generic; only the tag→column map is app-specific.
- **`defineMediaRoutes`** — stream (Range) + cover + download + the compat ladder **generalized into
  a playback decision engine**.

**The generalization worth calling out:** PapyrOS's Firefox compat ladder is already a
direct-play → remux → re-encode decision engine wearing an audiobook disguise. That is *precisely*
what Jellyfin calls direct play → direct stream → transcode. Promote it (client capabilities in, a
rendition + strategy out) and video inherits it.

Metadata enrichment becomes **pluggable providers per kind** — which is what `defineConnector`
already is. Don't build a second enrichment framework.

**What video genuinely adds — the real cost:** HLS segmenting + ABR ladder + seek-during-transcode;
subtitle extraction (embedded + external, forced/SDH); multiple audio tracks; VAAPI/NVENC hardware
accel; thumbnail/BIF sprites. This is where "the backend is mostly the same" stops being true.
Budget for it separately.

---

## 5. Reuse — do not rebuild

- `apps/papyros/src/player/position.ts` — **is** the timeline core. Promote, don't rewrite.
- `usePointerDrag` (`@jkos/ui`) — queue and playlist reordering.
- `defineCollection` / `defineConnector` (`@jkos/weave/server`) — playlists, history, ratings,
  per-kind metadata providers.
- `buildJkOSTheme` (`@jkos/design`) — art-derived accent on the now-playing surface.
- The compat ladder in `apps/papyros/backend/src/media.js` — becomes the playback decision engine.
- LazurOS embedding + STT providers — recommendations, transcript search, lyric timing. Do **not**
  grow a second AI stack.
