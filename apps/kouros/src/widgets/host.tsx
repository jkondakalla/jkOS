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

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { renderWidget, type HostActions, type WidgetDef, type WidgetHost } from '@jkos/widget-render';
import { pageFor, routeTable } from '@jkos/widgets';
import { AUTH_URL } from '@jkos/auth-client';
import { useBreakpoint } from '@jkos/ui';
import { usePlayer, usePlayerSession } from '../player/PlayerProvider';
import { requestPlay } from '../player/controller';
import { startStation } from '../player/station';
import { bookContext } from '../player/context';
import { encodeRef } from '../player/sources';
import type { ActionTarget } from '../components/ActionSheet';
import { KOUROS_ACTIONS, type PlayerSlice } from './declaration';

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

/* ── The player's slice ────────────────────────────────────────────────────
 * What is playing, from the ONE engine (PlayerProvider). Positions are whole seconds and
 * the object is memoised on its values, so the slice's reference — what the renderer's
 * per-card gate compares — moves at most once a second while playing, not at the
 * engine's ~4 Hz. */
function usePlayerSlice(): PlayerSlice {
  const p = usePlayer();
  const { mode, output } = usePlayerSession();
  const item = p.composition ? p.item : null;
  const book = p.composition?.spec.kind === 'audiobook';
  const position = Math.max(0, Math.floor(p.globalPos));
  const total = Math.max(0, Math.round(p.total));
  const where = mode === 'remote' && output ? ` ON ${output.name.toUpperCase()}` : '';
  const chapter = book ? p.segmentIndex : 0;
  const chapterLabel = book ? p.segmentLabel ?? `CH ${String(p.segmentIndex + 1).padStart(2, '0')}` : '';
  const chapters = book ? p.points.length : 1;
  return useMemo<PlayerSlice>(() => ({
    loaded: item != null,
    kind: item ? (book ? 'audiobook' : 'music') : null,
    playing: item != null && p.playing,
    status: item ? `${p.playing ? 'PLAYING' : 'PAUSED'}${where}` : '',
    title: item?.title ?? '',
    byline: item?.byline ?? '',
    cover_url: item?.coverUrl ?? null,
    track_id: item && item.src === 'kouros' ? item.id : null,
    book_id: item && item.src === 'book' ? item.id : null,
    position,
    total,
    progress: total > 0 ? Math.min(1, position / total) : 0,
    remaining: Math.max(0, total - position),
    chapter,
    chapters,
    chapter_label: chapterLabel,
  }), [item, book, p.playing, where, position, total, chapter, chapters, chapterLabel]);
}

/** Track ids from what a widget hands an action: rows carrying an `id`, or ids. */
function idsOf(tracks: unknown): number[] {
  if (!Array.isArray(tracks)) return [];
  return tracks
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
  const openSheet = useContext(SheetCtx);
  const bp = useBreakpoint();
  const now = useMinute();

  const actions = useMemo<HostActions<typeof KOUROS_ACTIONS>>(() => ({
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

  const slices = useMemo(() => ({ player }), [player]);
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
