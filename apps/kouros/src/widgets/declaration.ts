/**
 * widgets/declaration.ts — KourOS as a widget host: what it DECLARES.
 *
 * A widget drawn in KourOS can read what KourOS's engines publish (its slices), fire
 * what they do (its actions) and go to its pages. Each is declared here, as data, in the
 * field vocabulary a dataset uses — the second tier (`@jkos/widgets/semantic`) checks a
 * KourOS widget against it, as it checks an ORDECK card against hud/slices.ts — and
 * implemented in ./host.tsx, typed by this file so neither can drift from the other:
 * `Fields<PlayerSlice>` must name every key of the slice, and `HostActions<typeof
 * KOUROS_ACTIONS>` every action.
 *
 * Pure data with type-only imports, so a Node tool can transpile and read it
 * (scripts/widget/catalog.mjs hosts()).
 */
import type { FieldType } from '@jkos/weave';
import type { HostActionDecl } from '@jkos/widget-render';

/** One declared field (the slice of weave's BodyField a reader binds against). */
export interface SliceField {
  type: FieldType;
  label?: string;
  enum?: readonly string[];
  of?: FieldType;
  item?: Readonly<Record<string, SliceField>>;
  /** A ref's target, '<app>.<dataset>'. */
  ref?: string;
}
type Fields<T> = { readonly [K in keyof Required<T>]: SliceField };

/**
 * What is playing, as the player engine publishes it to a widget (./host.tsx
 * usePlayerSlice). Positions are WHOLE seconds, so the slice moves at most once a
 * second while playing — every widget binding it re-renders when it moves.
 */
export interface PlayerSlice {
  loaded: boolean;
  kind: 'music' | 'audiobook' | null;
  playing: boolean;
  buffering: boolean;
  status: string;
  /** Where the sound is, when it is another device's ("KITCHEN"), else null. */
  on_device: string | null;
  /** More than one device: the picker has something to choose between. */
  devices: boolean;
  /** "3 of 12" in a queue, "Chapter 4 of 31" in a book. */
  place: string;
  title: string;
  byline: string;
  artist: string;
  /** The artist an album is filed under — what its page is named by. */
  album_artist: string;
  album: string | null;
  cover_url: string | null;
  track_id: number | null;
  book_id: number | null;
  position: number;
  total: number;
  progress: number;
  remaining: number;
  chapter: number;
  chapters: number;
  chapter_label: string;
  points: { start: number; end: number }[];
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  /** The next track in the queue (null: the queue ends here). */
  next: { id: number; title: string; artist: string | null } | null;
  rate_label: string;
  sleep_on: boolean;
  sleep_label: string;
  bookmarks: { id: string; position: number; title: string }[];
}

/** The playhead at the engine's own rate (~4 Hz) — only what moves that fast. A widget that
 *  binds it re-renders with it, so only a seek bar should. */
export interface PlayheadSlice {
  position: number;
  total: number;
}

const s = (label?: string): SliceField => ({ type: 'string', ...(label ? { label } : {}) });
const n = (label?: string): SliceField => ({ type: 'number', ...(label ? { label } : {}) });
const b = (label?: string): SliceField => ({ type: 'boolean', ...(label ? { label } : {}) });

const PLAYER: Fields<PlayerSlice> = {
  loaded: b('Something is loaded'),
  kind: { type: 'enum', enum: ['music', 'audiobook'], label: 'Which language it plays in (null: nothing)' },
  playing: b(),
  buffering: b('Waiting on the network'),
  status: s('"PLAYING" | "PAUSED" | "PLAYING ON KITCHEN"'),
  on_device: s('Where the sound is, when it is another device ("KITCHEN"); null here'),
  devices: b('More than one device — the picker has a choice to offer'),
  place: s('"3 of 12" in a queue, "Chapter 4 of 31" in a book'),
  title: s(),
  byline: s('The artist, or the author'),
  artist: s('A track\'s artist ("Unknown artist" when it has none)'),
  album_artist: s('The artist an album is filed under — its page\'s name'),
  album: s('A track\'s album (null: none, or a book)'),
  cover_url: s('The art (null: none)'),
  track_id: { type: 'ref', label: 'The catalog track playing (null: a book, or nothing)' },
  book_id: { type: 'ref', label: 'The audiobook playing (null: a track, or nothing)' },
  position: n('Seconds in, whole'),
  total: n('Seconds, over the whole item'),
  progress: n('position / total, 0..1'),
  remaining: n('Seconds left'),
  chapter: n("The book's current chapter, 0-based (a track: 0)"),
  chapters: n('How many (a track: 1)'),
  chapter_label: s('"CH 03", or the chapter\'s own title'),
  points: { type: 'json', label: 'The segments, in seconds — a book\'s chapters', item: { start: n(), end: n() } },
  shuffle: b(),
  repeat: { type: 'enum', enum: ['off', 'all', 'one'] },
  next: { type: 'json', label: 'The next track in the queue (null: it ends here)', item: { id: { type: 'ref', ref: 'kouros.tracks' }, title: s(), artist: s() } },
  rate_label: s('"1×", "1.5×" — a book\'s listening rate'),
  sleep_on: b('A sleep timer is armed'),
  sleep_label: s('"Sleep", "Sleep · 14:59", "Sleep · end of chapter"'),
  bookmarks: { type: 'json', label: "This book's bookmarks", item: { id: s(), position: n('Seconds'), title: s() } },
};

const PLAYHEAD: Fields<PlayheadSlice> = {
  position: n('Seconds in, fractional — the media element\'s own clock, never a timer'),
  total: n('Seconds'),
};

/** Every slice in a KourOS widget's scope, by the name a binding's `src` uses. */
export const KOUROS_SLICES = {
  player: { type: 'json', label: 'What is playing, wherever it plays (the listening session); moves at most once a second', item: PLAYER },
  playhead: { type: 'json', label: 'The playhead at the engine\'s rate — for a seek bar only', item: PLAYHEAD },
} as const satisfies Readonly<Record<string, SliceField>>;

/** Every action KourOS's engines take that a widget may fire (`{ "do": "<name>" }`). */
export const KOUROS_ACTIONS = {
  'player.play': {
    label: 'Play a list of tracks, from one of them — on the current output',
    args: [
      { name: 'tracks', type: 'json', required: true, label: 'Tracks (rows with an id, or ids), in order' },
      { name: 'from', type: 'number', label: 'The id to start at (default: the first)' },
      { name: 'context', type: 'string', label: 'Where it is played from (a KourOS route)' },
    ],
  },
  'player.book': {
    label: 'Resume an audiobook where it was left',
    args: [
      { name: 'id', type: 'number', required: true },
      { name: 'position', type: 'number', label: 'Seconds in (default: the start)' },
    ],
  },
  'player.station': {
    label: 'Start a station from a track',
    args: [{ name: 'seed', type: 'number', required: true }],
  },
  'player.toggle': { label: 'Play, or pause' },
  'player.next': { label: 'The next track' },
  'player.prev': { label: 'The previous track (or back to the start of this one)' },
  'player.seek': { label: 'Seek to a second', args: [{ name: 'to', type: 'number', required: true, label: 'Seconds over the whole item' }] },
  'player.skip': { label: 'Jump by seconds — a book\'s ±30', args: [{ name: 'by', type: 'number', required: true }] },
  'player.shuffle': { label: 'Shuffle on, or off' },
  'player.repeat': { label: 'Repeat: off → all → one' },
  'player.chapter': { label: 'The next or previous chapter', args: [{ name: 'step', type: 'number', required: true, label: '+1 or −1' }] },
  'player.rate': { label: 'The next listening rate (a book\'s)' },
  'player.sleep': {
    label: 'Arm the sleep timer, or disarm it',
    args: [{ name: 'mode', type: 'enum', enum: ['off', '15', '30', '45', '60', 'segment'], required: true, label: "Minutes, 'segment' (the end of the chapter), or 'off'" }],
  },
  'bookmark.add': { label: 'Bookmark where the book is now' },
  'bookmark.jump': { label: 'Go to a bookmark', args: [{ name: 'position', type: 'number', required: true }] },
  'bookmark.remove': { label: 'Delete a bookmark', args: [{ name: 'id', type: 'string', required: true }] },
  'devices.open': { label: 'The device picker — where the sound comes out' },
  'overlay.close': { label: 'Close a full-screen route (Now Playing, the queue) — back where it was opened from' },
  'context.open': {
    label: 'Reopen a context something was played from — its page, or (a station) play it again',
    args: [{ name: 'context', type: 'string', required: true, label: 'The play context ("album/<artist>/<album>", "station/<id>")' }],
  },
  'sheet.open': {
    label: 'The action sheet over a set of tracks (play next, add to a playlist, a station…)',
    args: [
      { name: 'tracks', type: 'json', required: true, label: 'Tracks (rows with an id, or ids)' },
      { name: 'title', type: 'string', required: true },
      { name: 'subtitle', type: 'string' },
      { name: 'seed', type: 'number', label: 'The station seed (default: the first track)' },
    ],
  },
} as const satisfies Readonly<Record<string, HostActionDecl>>;

/**
 * KourOS's screens that are NOT widget pages yet — still hand-built views, routed by
 * App.tsx. A `go` may name one (the second tier checks it against these and the page
 * files together), so a widget can link to the album it shows before the album is a
 * widget. **This list only shrinks**: when a screen becomes a page, its route moves to
 * the page's file, and the gate refuses a route both here and in a file. Every one is a
 * path the hash router answers (check:widgets parses each).
 */
export const KOUROS_LEGACY_ROUTES = [
  '/album/:artist/:album',
  '/artist/:artist',
  '/artists',
  '/book/:id',
  '/books',
  '/browse',
  '/map',
  '/playlist/:id',
  '/playlists',
  '/queue',
  '/search',
] as const;
