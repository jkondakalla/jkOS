/**
 * widgets/host.tsx — KourOS as a widget host.
 *
 * KourOS draws its screens as widgets (TODO §6, the rescope's pilot): a widget file in
 * apps/kouros/widgets/ with a `route` is a PAGE, and the router (App.tsx) draws the one
 * the location matches, with `renderWidget(def, host)`. What this file hands the
 * renderer is the host: the player's slice, the engine actions a widget may fire, a
 * router, the route's params, and every KourOS widget a `use` can draw. Each is
 * declared in ./declaration.ts (what the second tier checks a widget against) and
 * implemented here, typed by that declaration.
 *
 * A screen not yet converted is still a hand-built view; its route is in
 * KOUROS_LEGACY_ROUTES, so a page can already `go` to it.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { renderWidget, type HostActions, type WidgetDef, type WidgetHost } from '@jkos/widget-render';
import { fmtClock } from '@jkos/player/core';
import { formatRate } from '@jkos/player/ui';
import type { SleepMode } from '@jkos/player/engine';
import { pageFor, routeTable } from '@jkos/widgets';
import { AUTH_URL } from '@jkos/auth-client';
import { useBreakpoint } from '@jkos/ui';
import { usePlayer, usePlayerSession } from '../player/PlayerProvider';
import { requestPlay } from '../player/controller';
import { startStation } from '../player/station';
import { bookContext } from '../player/context';
import { encodeRef } from '../player/sources';
import type { ActionTarget } from '../components/ActionSheet';
import { openDevicePicker } from '../components/DevicePicker';
import { closeOverlay } from '../hooks/useHashRoute';
import { tracksNear } from '../api';
import { KINDS } from './kinds';
import { KOUROS_ACTIONS, type PlayerSlice, type PlayheadSlice } from './declaration';

const SLEEP_MODES: readonly SleepMode[] = ['off', '15', '30', '45', '60', 'segment'];

const files = import.meta.glob<WidgetDef>(
  ['../../widgets/*.json', '!../../widgets/*.fixtures.json'],
  { eager: true, import: 'default' },
);

/** Every KourOS widget file, by id — its pages, and the parts they `use`. */
export const WIDGETS: Readonly<Record<string, WidgetDef>> = Object.freeze(
  Object.fromEntries(Object.values(files).map((def) => [def.id, def])),
);

/** route → page id, derived from the files (the gate refuses two pages on one path). */
const ROUTES = routeTable(Object.values(WIDGETS)).routes;

/** The page a location path shows, or null (a screen still hand-built). */
export function pageAt(path: string): { def: WidgetDef; params: Record<string, string> } | null {
  const hit = pageFor(ROUTES, path);
  const def = hit ? WIDGETS[hit.id] : undefined;
  return hit && def ? { def, params: hit.params } : null;
}

/* ── The player's slices ───────────────────────────────────────────────────
 * What is playing, from the ONE engine (PlayerProvider). `player` carries positions in
 * whole seconds and keeps its reference while its VALUES hold (useStable), so it — what
 * the renderer's per-card gate compares — moves at most once a second while playing.
 * `playhead` is the one thing that moves faster: the media element's clock at ~4 Hz, for
 * a seek bar. */

/** The previous object while `next` is equal to it, value for value — a slice's
 *  reference moves only when its data does. */
function useStable<T>(next: T): T {
  const ref = useRef<{ key: string; value: T } | null>(null);
  const key = JSON.stringify(next);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value: next };
  return ref.current.value;
}

const SLEEP_LABEL = (mode: SleepMode, remainingMs: number | null): string =>
  mode === 'off' ? 'Sleep'
    : mode === 'segment' ? 'Sleep · end of chapter'
    : `Sleep · ${fmtClock(Math.max(0, (remainingMs ?? 0) / 1000))}`;

function usePlayerSlice(): PlayerSlice {
  const p = usePlayer();
  const { mode, output } = usePlayerSession();
  const item = p.composition ? p.item : null;
  const book = p.composition?.spec.kind === 'audiobook';
  const position = Math.max(0, Math.floor(p.globalPos));
  const total = Math.max(0, Math.round(p.total));
  const remote = mode === 'remote' && output ? output.name.toUpperCase() : null;
  const track = p.track;
  const artist = track ? track.artist || track.albumartist || 'Unknown artist' : '';
  const nextId = p.queue.cursor + 1 < p.queue.items.length ? Number(p.queue.items[p.queue.cursor + 1]) : null;
  const nextTrack = nextId != null ? p.tracksById.get(nextId) : undefined;
  const chapters = book ? p.points.length : 1;
  return useStable<PlayerSlice>({
    loaded: item != null,
    kind: item ? (book ? 'audiobook' : 'music') : null,
    playing: item != null && p.playing,
    buffering: p.buffering,
    status: item ? `${p.playing ? 'PLAYING' : 'PAUSED'}${remote ? ` ON ${remote}` : ''}` : '',
    on_device: remote,
    devices: mode !== 'solo',
    place: book
      ? (chapters > 1 && p.segmentIndex >= 0 ? `Chapter ${p.segmentIndex + 1} of ${chapters}` : 'Audiobook')
      : (p.queue.items.length > 1 ? `${p.queue.cursor + 1} of ${p.queue.items.length}` : 'Now playing'),
    title: item?.title ?? '',
    byline: item?.byline ?? '',
    artist,
    album_artist: track ? track.albumartist || artist : '',
    album: track?.album ?? null,
    cover_url: item?.coverUrl ?? null,
    track_id: item && item.src === 'kouros' ? item.id : null,
    book_id: item && item.src === 'book' ? item.id : null,
    position,
    total,
    progress: total > 0 ? Math.min(1, position / total) : 0,
    remaining: Math.max(0, total - position),
    chapter: book ? p.segmentIndex : 0,
    chapters,
    chapter_label: book ? p.segmentLabel ?? `CH ${String(p.segmentIndex + 1).padStart(2, '0')}` : '',
    points: book ? p.points.map((pt) => ({ start: pt.start, end: pt.end })) : [],
    shuffle: p.shuffle,
    repeat: p.repeat,
    next: nextId != null ? { id: nextId, title: nextTrack?.title ?? '…', artist: nextTrack?.artist ?? null } : null,
    rate_label: formatRate(p.rate),
    sleep_on: p.sleepMode !== 'off',
    sleep_label: SLEEP_LABEL(p.sleepMode, p.sleepRemainingMs),
    bookmarks: p.bookmarks.map((bm) => ({ id: String(bm.id), position: bm.position, title: bm.title || 'Bookmark' })),
  });
}

function usePlayheadSlice(): PlayheadSlice {
  const p = usePlayer();
  return useMemo(() => ({ position: Math.max(0, p.globalPos), total: Math.max(0, p.total) }), [p.globalPos, p.total]);
}

/** Track ids from what a widget hands an action: rows carrying an `id`, or ids. */
function idsOf(tracks: unknown): number[] {
  const list = Array.isArray(tracks) ? tracks : tracks != null ? [tracks] : [];
  return list
    .map((t) => (t != null && typeof t === 'object' ? (t as { id?: unknown }).id : t))
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

const num = (v: unknown): number | undefined => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** Go to a KourOS path — the hash router's (App.tsx useHashRoute). */
function go(path: string) {
  window.location.hash = path;
}

/* ── The host ──────────────────────────────────────────────────────────────── */

/** The action sheet a widget's `sheet.open` raises — WidgetHostProvider's. */
export const SheetCtx = createContext<((t: ActionTarget) => void) | null>(null);

/** A minute-resolution clock — `$now`, what `fmt: "ago"` measures against. No KourOS
 *  widget draws seconds, so nothing re-renders faster for it. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** KourOS's WidgetHost, for a page drawn with `route` params. */
function useKourosHost(route: Record<string, string>): WidgetHost {
  const player = usePlayerSlice();
  const playhead = usePlayheadSlice();
  const p = usePlayer();
  // The actions read the engine at the moment they fire, not the one they were made with —
  // so the action table (and every card behind the gate) need not move when it does.
  const engine = useRef(p);
  engine.current = p;
  const openSheet = useContext(SheetCtx);
  const bp = useBreakpoint();
  const now = useMinute();

  const actions = useMemo<HostActions<typeof KOUROS_ACTIONS>>(() => ({
    'player.toggle': () => engine.current.toggle(),
    'player.next': () => engine.current.trackNext(),
    'player.prev': () => engine.current.trackPrev(),
    'player.seek': ({ to }) => { const t = num(to); if (t != null) engine.current.seekTo(t); },
    'player.skip': ({ by }) => { const d = num(by); if (d != null) engine.current.skip(d); },
    'player.shuffle': () => engine.current.setShuffle(!engine.current.shuffle),
    'player.repeat': () => engine.current.cycleRepeat(),
    'player.chapter': ({ step }) => { if ((num(step) ?? 0) < 0) engine.current.prevSegment(); else engine.current.nextSegment(); },
    'player.rate': () => engine.current.cycleRate(),
    'player.sleep': ({ mode }) => {
      if (!SLEEP_MODES.includes(mode as SleepMode)) throw new Error(`no sleep mode ${String(mode)}`);
      engine.current.setSleep(mode as SleepMode);
    },
    'bookmark.add': () => engine.current.addBookmarkHere(),
    'bookmark.jump': ({ position }) => { const t = num(position); if (t != null) engine.current.jumpBookmark(t); },
    'bookmark.remove': ({ id }) => {
      const bm = engine.current.bookmarks.find((b) => String(b.id) === String(id));
      if (bm) engine.current.removeBookmark(bm.id);
    },
    'player.near': async ({ x, y, z, w }) => {
      const pt = { x: num(x), y: num(y), z: num(z), w: num(w) };
      if (pt.x == null || pt.y == null || pt.z == null || pt.w == null) throw new Error('nothing is pinned');
      const ids = (await tracksNear(pt as { x: number; y: number; z: number; w: number }, 40)).results.map((t) => t.id);
      if (!ids.length) throw new Error('nothing sits there');
      requestPlay({ trackIds: ids, startIndex: 0 });
    },
    'devices.open': () => openDevicePicker(),
    'overlay.close': () => closeOverlay(),
    'player.play': ({ tracks, from, context }) => {
      const ids = idsOf(tracks);
      if (!ids.length) throw new Error('nothing to play');
      const start = num(from) != null ? Math.max(0, ids.indexOf(num(from)!)) : 0;
      requestPlay({ trackIds: ids, startIndex: start, ...(typeof context === 'string' && context ? { context } : {}) });
    },
    'player.book': ({ id, position }) => {
      const book = num(id);
      if (book == null) throw new Error('no book to play');
      requestPlay({ trackIds: [encodeRef('book', book)], startIndex: 0, position: num(position) ?? 0, context: bookContext(book) });
    },
    'player.station': async ({ seed }) => {
      const s = num(seed);
      if (s == null || !(await startStation(s))) throw new Error('could not start a station');
    },
    // A context is also its route ("album/<artist>/<album>"), except a station, which
    // has no page: reopening one plays it again.
    'context.open': async ({ context }) => {
      const c = String(context ?? '');
      const station = c.match(/^station\/(\d+)$/);
      if (station) {
        if (!(await startStation(Number(station[1])))) throw new Error('could not start a station');
      } else if (c) go(`/${c}`);
    },
    'sheet.open': ({ tracks, title, subtitle, seed }) => {
      const ids = idsOf(tracks);
      if (!ids.length || !openSheet) throw new Error('nothing to act on');
      openSheet({
        trackIds: ids, title: String(title ?? ''),
        ...(typeof subtitle === 'string' && subtitle ? { subtitle } : {}),
        ...(num(seed) != null ? { seedId: num(seed) } : {}),
      });
    },
  }), [openSheet]);

  const slices = useMemo(() => ({ player, playhead }), [player, playhead]);
  return useMemo<WidgetHost>(() => ({
    slices,
    authUrl: AUTH_URL,
    // No KourOS screen reaches an AI app, so the LazurOS kill switch is held CLOSED here
    // rather than read: a widget that ever did would draw "AI is off" until this host
    // reads the profile's switch, never run unasked.
    aiEnabled: false,
    now,
    actions,
    navigate: go,
    route,
    widgets: WIDGETS,
    kinds: KINDS,
    tier: bp,
  }), [slices, now, actions, route, bp]);
}

/** One page, drawn by the renderer in KourOS's host. */
export function WidgetPage({ def, params }: { def: WidgetDef; params: Record<string, string> }) {
  // The params object is rebuilt on every location parse; key it on its values so the
  // host (and every card behind the renderer's gate) only moves when they do.
  const key = JSON.stringify(params);
  const route = useMemo(() => params, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const host = useKourosHost(route);
  return renderWidget(def, host);
}
