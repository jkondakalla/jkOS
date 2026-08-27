// createPlayer.ts — the Layer 3 factory (git history: Wave 16 item 16.7;
// git history: PLAYER_PARITY.md, retired — "Layer 3 — UI kit"). Mirrors
// @jkos/design's buildJkOSTheme(config) and @jkos/cards' cardSurface(opts):
// a plain spec object goes IN, a plain derived recipe comes OUT — no React, no
// DOM, no import of @jkos/player/ui's components. This file is deliberately
// self-contained (no runtime imports at all) so it transpiles standalone under
// the house test pattern (test/factory.test.mjs), exactly like core/queue.ts
// and core/timeline.ts do.
//
// What "composition out" means here: an app (papyros today via a hand-written
// bar, the music app in Wave 18) reads PlayerComposition.transportControls /
// .actionControls — ordered ControlId lists — and mounts the matching REAL
// parts from @jkos/player/ui (PlayPauseButton, SkipButton, SegmentButton,
// RateButton, SleepMenu, …) in that order. The factory decides WHICH controls
// a preset wants and in what order; it never renders them itself, so it never
// forces a consumer onto any particular JSX shape — papyros keeps its
// hand-assembled bar (git history: PLAYER_PARITY.md, retired: "zero behavior change")
// while a future consumer can drive its whole transport off this list.
//
// The Queue/Timeline split from git history: PLAYER_PARITY.md, retired is what `nav` encodes:
// audiobook prev/next walks SEGMENTS inside one Timeline (`'segment'`); music/
// video prev/next walks the QUEUE's items (`'track'`). They are mutually
// exclusive by construction — a spec asks for one pair or the other, never
// both — which is exactly the domain distinction the whole program rests on.

export type PlayerKind = 'audiobook' | 'music' | 'video';

/** Which prev/next pair a spec wants, or none. 'segment' walks the current
 *  Timeline's chapters/markers (@jkos/player/core's NavPoint list); 'track'
 *  walks the Queue (@jkos/player/core/queue's next/prev). */
export type NavCapability = 'segment' | 'track' | false;

/** Scrubber shape — see @jkos/player/ui's <Scrubber mode>. 'segment' brackets
 *  just the current chapter (papyros today); 'timeline' spans the whole item
 *  with segment-boundary ticks (a music/video bar's shape). */
export type ScrubberMode = 'segment' | 'timeline';

/** Mobile transport density. 'compact' collapses extras into a More sheet
 *  (papyros's audiobook bar today, app-owned); 'full' mirrors the desktop
 *  control set 1:1 (a music/video bar's shape — nothing left to collapse). */
export type MobileTransportMode = 'compact' | 'full';

/** Declarative capability toggles — the single source every derived control
 *  list reads. Every field here is a real, named thing a preset turns on or
 *  off; there is no "everything" flag, so a custom spec built by hand (not a
 *  preset) is just as legible as one of the three below. */
export interface PlayerCapabilities {
  /** ±seconds relative-skip buttons (audiobook's SkipButton pair). `false` →
   *  no skip buttons. */
  skipSeconds: number | false;
  /** Prev/next pair: which thing it walks, or none. */
  nav: NavCapability;
  /** Playback-rate cycler (RateButton). */
  rate: boolean;
  /** Sleep timer menu (SleepMenu). */
  sleep: boolean;
  /** Bookmarks menu. */
  bookmarks: boolean;
  /** Volume slider + mute. */
  volume: boolean;
  /** Shuffle toggle (@jkos/player/core/queue's shuffle()). Only meaningful
   *  alongside `nav: 'track'` — a single-item audiobook Timeline has nothing
   *  to shuffle. */
  shuffle: boolean;
  /** Repeat cycle off/all/one (@jkos/player/core/queue's repeat()). Same
   *  caveat as `shuffle`. */
  repeat: boolean;
  /** Up-next queue panel (<QueuePanel>). */
  queue: boolean;
  /** Art-derived accent — Plexamp's signature look. A DECLARATIVE flag only:
   *  the actual computation is the spec's optional `deriveAccent` hook (or
   *  the app's own call to @jkos/design's buildJkOSTheme with its result).
   *  This package never imports @jkos/design — see `deriveAccent` below. */
  accentFromArt: boolean;
}

/** The shape buildJkOSTheme's `accent` config already accepts (JkOSAccentDefault
 *  in packages/design/theme/buildTheme.ts) — mirrored structurally here, NOT
 *  imported, so @jkos/player has no dependency on @jkos/design. An app's
 *  `deriveAccent` implementation feeds cover art through its own color
 *  extraction and hands the result straight to buildJkOSTheme({ accent }). */
export interface DerivedAccent {
  primary?: string;
  secondary?: string;
}

/** The art-derived-accent seam (music preset). Takes a cover-art URL, returns
 *  (sync or async) the accent pair. Omit to leave `accentFromArt` purely
 *  descriptive — no computation wired. */
export type DeriveAccent = (coverUrl: string) => DerivedAccent | Promise<DerivedAccent>;

/** What a caller passes to `createPlayer` / the preset functions: only `kind`
 *  is required, everything else defaults (mirrors buildJkOSTheme's `config`
 *  input — set only what varies). */
export interface PlayerSpecInput {
  kind: PlayerKind;
  capabilities?: Partial<PlayerCapabilities>;
  scrubberMode?: ScrubberMode;
  mobileTransport?: MobileTransportMode;
  deriveAccent?: DeriveAccent;
  /** Declared-but-unbuilt marker (videoPlayer(), Wave 19 — git history: PLAYER_PARITY.md, retired
   *  lists what it still needs: fullscreen, PiP, subtitle/audio-track
   *  pickers, quality picker, hover-thumbnail scrub, skip-intro, next-episode
   *  card, idle-hide chrome — none of that is modeled by PlayerCapabilities
   *  yet). `createPlayer` refuses to compose a spec with this set; the spec
   *  itself stays fully inspectable. */
  unbuilt?: boolean;
}

/** A fully-resolved spec — every optional field of `PlayerSpecInput` filled
 *  with its default. What the presets return, and what `PlayerComposition`
 *  carries back to the caller. */
export interface PlayerSpec {
  kind: PlayerKind;
  capabilities: PlayerCapabilities;
  scrubberMode: ScrubberMode;
  mobileTransport: MobileTransportMode;
  deriveAccent?: DeriveAccent;
  unbuilt?: boolean;
}

/** The real @jkos/player/ui parts a control id names — the derived lists
 *  below are recipes over exactly this vocabulary, nothing else:
 *    shuffle/repeat     → a shuffle/repeat toggle (music/video)
 *    segmentPrev/Next   → <SegmentButton dir="prev"|"next"> (audiobook)
 *    trackPrev/Next     → the Queue-driven prev/next pair (music/video)
 *    skipBack/skipFwd   → <SkipButton seconds={-N|N}> (audiobook)
 *    playPause          → <PlayPauseButton>
 *    rate               → <RateButton>
 *    sleep              → <SleepMenu>
 *    bookmarks          → the bookmarks menu
 *    volume             → a volume slider/mute control
 *    queue              → <QueuePanel> (as an action-slot opener) */
export type ControlId =
  | 'shuffle' | 'segmentPrev' | 'trackPrev' | 'skipBack'
  | 'playPause'
  | 'skipFwd' | 'segmentNext' | 'trackNext' | 'repeat'
  | 'rate' | 'sleep' | 'bookmarks' | 'volume' | 'queue';

/** The factory's output: the resolved spec plus the two ordered control
 *  lists derived from it. `transportControls` is the <PlayerBar transport>
 *  center cluster (mirrors papyros's `.pb-transport` row); `actionControls`
 *  is the `actions` slot (papyros's rate/sleep/bookmarks cluster). Both are
 *  PURE data — an app renders the real parts, this only decides which ones
 *  and in what order. */
export interface PlayerComposition {
  spec: PlayerSpec;
  transportControls: ControlId[];
  actionControls: ControlId[];
}

const DEFAULT_CAPABILITIES: PlayerCapabilities = {
  skipSeconds: false,
  nav: false,
  rate: false,
  sleep: false,
  bookmarks: false,
  volume: false,
  shuffle: false,
  repeat: false,
  queue: false,
  accentFromArt: false,
};

/** Apply defaults to a caller's partial input. Exported so a spec built by
 *  hand (not through a preset) is just as introspectable as a preset's
 *  output — both are plain `PlayerSpec` objects. */
export function resolveSpec(input: PlayerSpecInput): PlayerSpec {
  return {
    kind: input.kind,
    capabilities: { ...DEFAULT_CAPABILITIES, ...input.capabilities },
    scrubberMode: input.scrubberMode ?? 'segment',
    mobileTransport: input.mobileTransport ?? 'full',
    deriveAccent: input.deriveAccent,
    unbuilt: input.unbuilt,
  };
}

/** The transport (center) cluster, capability-driven, not kind-driven — a
 *  hand-built spec with `nav: 'segment'` gets the same segment pair an
 *  audiobook preset would, no special-casing on `kind` anywhere in here.
 *  Order: shuffle, prev, skip-back, play/pause, skip-fwd, next, repeat —
 *  shuffle/repeat flank the pair they modulate (Plexamp/Spotify's shape);
 *  skip only ever appears alongside segment nav (audiobook's ±30s idiom). */
function deriveTransportControls(caps: PlayerCapabilities): ControlId[] {
  const out: ControlId[] = [];
  if (caps.shuffle) out.push('shuffle');
  if (caps.nav === 'segment') out.push('segmentPrev');
  if (caps.nav === 'track') out.push('trackPrev');
  if (typeof caps.skipSeconds === 'number') out.push('skipBack');
  out.push('playPause');
  if (typeof caps.skipSeconds === 'number') out.push('skipFwd');
  if (caps.nav === 'segment') out.push('segmentNext');
  if (caps.nav === 'track') out.push('trackNext');
  if (caps.repeat) out.push('repeat');
  return out;
}

/** The right-side actions cluster, in a fixed canonical order — only the
 *  enabled capabilities appear. */
function deriveActionControls(caps: PlayerCapabilities): ControlId[] {
  const out: ControlId[] = [];
  if (caps.rate) out.push('rate');
  if (caps.sleep) out.push('sleep');
  if (caps.bookmarks) out.push('bookmarks');
  if (caps.volume) out.push('volume');
  if (caps.queue) out.push('queue');
  return out;
}

/** The factory. Spec in, composition out — see the file header. Throws for a
 *  spec flagged `unbuilt` (videoPlayer() today): the spec stays inspectable,
 *  but there is nothing yet to compose (git history: PLAYER_PARITY.md, retired, Wave 19). */
export function createPlayer(input: PlayerSpecInput): PlayerComposition {
  const spec = resolveSpec(input);
  if (spec.unbuilt) {
    throw new Error(
      `createPlayer: the '${spec.kind}' preset is declared but unbuilt (git history: Wave 19; ` +
      'git history: PLAYER_PARITY.md, retired — "videoPlayer()"). Its spec is still fully inspectable ' +
      '(e.g. videoPlayer() returns it directly) — createPlayer() only refuses to compose one.',
    );
  }
  return {
    spec,
    transportControls: deriveTransportControls(spec.capabilities),
    actionControls: deriveActionControls(spec.capabilities),
  };
}

// ── Presets ──────────────────────────────────────────────────────────────
// "Presets differ only in emphasis, not mechanism" (git history: PLAYER_PARITY.md, retired):
// each is just resolveSpec() called with a different capability set. Every
// preset takes an optional partial override so a consumer can start from the
// house shape and tune one field (e.g. musicPlayer({ capabilities: { queue:
// false } }) for a queue-less mini player) without hand-rolling the rest.

/** = today's papyros PlayerBar (git history: PLAYER_PARITY.md, retired): ±30s skip, chapter
 *  prev/next, rate cycling, sleep timer, bookmarks. No volume/shuffle/
 *  repeat/queue — PapyrOS's audiobook bar renders none of those (§2: "No
 *  queue", "No volume control" was true before Wave 16.2 added the engine
 *  surface; the audiobook BAR still doesn't render a volume control by
 *  design — git history: PLAYER_PARITY.md, retired — "musicPlayer()" is where volume belongs). */
export function audiobookPlayer(overrides: Partial<PlayerSpecInput> = {}): PlayerSpec {
  return resolveSpec({
    kind: 'audiobook',
    scrubberMode: 'segment',
    mobileTransport: 'compact',
    ...overrides,
    capabilities: {
      skipSeconds: 30,
      nav: 'segment',
      rate: true,
      sleep: true,
      bookmarks: true,
      volume: false,
      shuffle: false,
      repeat: false,
      queue: false,
      accentFromArt: false,
      ...overrides.capabilities,
    },
  });
}

/** Prev/next track, shuffle, repeat, queue, volume, art-derived accent —
 *  Plexamp floor / Spotify ceiling (git history: PLAYER_PARITY.md, retired). No skip (music
 *  tracks are short; no ±30s idiom), no rate/sleep/bookmarks (audiobook-only
 *  concepts — a track has no "chapters" to sleep-until or bookmark). */
export function musicPlayer(overrides: Partial<PlayerSpecInput> = {}): PlayerSpec {
  return resolveSpec({
    kind: 'music',
    scrubberMode: 'timeline',
    mobileTransport: 'full',
    ...overrides,
    capabilities: {
      skipSeconds: false,
      nav: 'track',
      rate: false,
      sleep: false,
      bookmarks: false,
      volume: true,
      shuffle: true,
      repeat: true,
      queue: true,
      accentFromArt: true,
      ...overrides.capabilities,
    },
  });
}

/** Declared, unbuilt (Wave 19 — git history: PLAYER_PARITY.md, retired). The capability set
 *  below is a reasonable starting shape (queue-driven episodic playback,
 *  volume) but does NOT model video's real cost: fullscreen, PiP, subtitle +
 *  audio-track pickers, quality picker, hover-thumbnail scrub, skip-intro,
 *  next-episode card, idle-hide chrome — none of those exist as capabilities
 *  yet. `unbuilt: true` makes `createPlayer()` refuse to compose this spec
 *  until Wave 19 lands (pass `{ unbuilt: false }` once it does). */
export function videoPlayer(overrides: Partial<PlayerSpecInput> = {}): PlayerSpec {
  return resolveSpec({
    kind: 'video',
    scrubberMode: 'timeline',
    mobileTransport: 'full',
    unbuilt: true,
    ...overrides,
    capabilities: {
      skipSeconds: false,
      nav: 'track',
      rate: false,
      sleep: false,
      bookmarks: false,
      volume: true,
      shuffle: false,
      repeat: false,
      queue: true,
      accentFromArt: false,
      ...overrides.capabilities,
    },
  });
}
