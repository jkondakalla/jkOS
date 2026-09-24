// session/remote.ts — the player, when the music is playing on ANOTHER device.
//
// Every surface (MiniPlayer, Now Playing, the Queue, the runes, the lock screen) reads
// one `PlayerApi`, and none of them should have to know where the audio is. So this
// hook builds that same `PlayerApi` out of the listening session instead of out of an
// engine: what is playing and where it has got to come from the output's last report
// (extrapolated on the SERVER's clock — session/clock.ts), and every verb becomes a
// command to the output (backend/src/session/routes.js), which applies it through its
// own player and reports back.
//
// A command's round trip is a few hundred milliseconds, and a play button that waits
// for it feels broken. So a toggle, a seek and a volume change show at once — an
// OPTIMISTIC overlay — and the overlay yields to the first session rev newer than the
// one it was made over, or after a few seconds if none comes (the output ignored it,
// or is gone): the display always ends up on what the output actually did.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, currentNav, navPoints, type RepeatMode } from '@jkos/player/core';
import type { SleepMode } from '@jkos/player/engine';
import type { PlayerApi } from '../player/usePlayerEngine';
import { compositionFor, decodeRef, unifiedBookmarks, unifiedItemLoader, type PlayableItem, type UnifiedBookmarkRow } from '../player/sources';
import { publishPosition } from '../player/controller';
import { serverNow, sendSessionCommand, type ListeningSession, type SessionDevice } from './client';
import { extrapolateMs, sleepRemainingMs } from './clock';

const REPEAT_ORDER: RepeatMode[] = ['off', 'all', 'one'];
/** How long an optimistic value stands without a newer rev to confirm or replace it. */
const OPTIMISTIC_MS = 3000;

interface Optimistic {
  rev: number;
  at: number;
  playing?: boolean;
  /** A seek: the position, and the SERVER time it was asked for (the new anchor). */
  position_ms?: number;
  anchor?: number;
  volume?: number;
  muted?: boolean;
}

/** The item behind a ref, for display — the same loader the engine uses, cached per
 *  tab so a remote does not refetch a book's chapters on every render. */
const itemCache = new Map<string, Promise<PlayableItem>>();
function resolveItem(ref: string): Promise<PlayableItem> {
  const { src, id } = decodeRef(ref);
  const key = `${src}:${id}`;
  let p = itemCache.get(key);
  if (!p) {
    p = unifiedItemLoader.load(key);
    p.catch(() => itemCache.delete(key));   // a failed load is retried next time, not cached
    itemCache.set(key, p);
  }
  return p;
}

export function useRemotePlayer(
  session: ListeningSession | null,
  output: SessionDevice | null,
  active: boolean,
  local: PlayerApi,
): PlayerApi {
  const ref = session?.item_ref ?? null;

  /* ── The item ── */
  const [item, setItem] = useState<PlayableItem | null>(null);
  useEffect(() => {
    if (!active || !ref) { setItem(null); return; }
    let cancelled = false;
    resolveItem(ref).then((it) => { if (!cancelled) setItem(it); }, () => { if (!cancelled) setItem(null); });
    return () => { cancelled = true; };
  }, [active, ref]);
  // Only an item that IS the session's current one — never last track's, mid-load.
  const shown = item && ref && decodeRef(ref).id === item.id && decodeRef(ref).src === item.src ? item : null;

  /* ── Bookmarks (a book's are per-listener rows — any device can read and add them) ── */
  const [bookmarks, setBookmarks] = useState<UnifiedBookmarkRow[]>([]);
  const refreshBookmarks = useCallback(() => {
    if (!shown || shown.kind !== 'book') { setBookmarks([]); return; }
    unifiedBookmarks.list(shown.ref).then(setBookmarks, () => setBookmarks([]));
  }, [shown?.ref, shown?.kind]);
  useEffect(() => { if (active) refreshBookmarks(); }, [active, refreshBookmarks]);

  /* ── The optimistic overlay ── */
  const [opt, setOpt] = useState<Optimistic | null>(null);
  useEffect(() => {
    if (!opt) return;
    if (session && session.rev > opt.rev) { setOpt(null); return; }
    const t = setTimeout(() => setOpt(null), Math.max(0, opt.at + OPTIMISTIC_MS - Date.now()));
    return () => clearTimeout(t);
  }, [opt, session?.rev]);

  const facts = useMemo(() => {
    if (!session) return null;
    if (!opt) return session;
    return {
      ...session,
      ...(opt.playing != null ? { playing: opt.playing } : {}),
      ...(opt.position_ms != null ? { position_ms: opt.position_ms, reported_at: new Date(opt.anchor!).toISOString() } : {}),
    };
  }, [session, opt]);

  const durationMs = (shown?.duration ?? 0) * 1000;
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const livePosition = useCallback(
    () => (factsRef.current ? extrapolateMs(factsRef.current, serverNow(), durationMs || undefined) / 1000 : 0),
    [durationMs],
  );

  /* ── The clock a remote scrubber moves on: 4 Hz while playing, like the engine's ── */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active || !facts?.playing) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active, facts?.playing, session?.rev]);
  const globalPos = active ? livePosition() : 0;

  // Library rows mark the playing track off the position broadcast; with the audio
  // elsewhere, nothing else would publish it.
  useEffect(() => {
    if (!active || !shown) return;
    publishPosition(shown.src === 'book'
      ? { trackId: null, bookId: shown.id, position: globalPos }
      : { trackId: shown.id, bookId: null, position: globalPos });
  });

  /* ── Chapters, off the item — the same nav points the engine would build ── */
  const points = useMemo(
    () => (shown ? navPoints(buildTimeline(unifiedItemLoader.sources(shown)), unifiedItemLoader.segments(shown)) : []),
    [shown],
  );
  const segmentIndex = points.length ? currentNav(points, globalPos) : 0;

  /* ── The verbs, as commands ── */
  const rev = session?.rev ?? 0;
  const send = useCallback((op: string, args: Record<string, unknown> = {}) => { void sendSessionCommand(op, args); }, []);
  const outputId = output?.id ?? null;

  const seekTo = useCallback((sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    setOpt({ rev, at: Date.now(), position_ms: ms, anchor: serverNow() });
    send('seek', { position_ms: ms });
  }, [rev, send]);

  const setVolume = useCallback((level: number) => {
    if (!outputId) return;
    const v = Math.min(1, Math.max(0, level));
    setOpt((o) => ({ ...(o ?? {}), rev, at: Date.now(), volume: v }));
    send('volume', { device: outputId, level: v });
  }, [outputId, rev, send]);

  const setMuted = useCallback((muted: boolean) => {
    if (!outputId) return;
    setOpt((o) => ({ ...(o ?? {}), rev, at: Date.now(), muted }));
    send('volume', { device: outputId, muted });
  }, [outputId, rev, send]);

  const volume = opt?.volume ?? output?.volume ?? 1;
  const muted = opt?.muted ?? output?.muted ?? false;
  const queue = session?.queue ?? local.queue;
  const repeat = queue.policy.repeat;
  const items = (ids: (number | string)[]) => ids.map(String);

  const outputName = output?.name ?? 'the other device';
  const sleepMode = (session?.sleep_mode ?? 'off') as SleepMode;

  return {
    visible: !!ref,
    item: shown,
    composition: compositionFor(ref),
    track: shown && shown.src === 'kouros' ? local.tracksById.get(shown.id) ?? null : null,
    playing: !!facts?.playing,
    buffering: false,
    // The one thing a remote cannot do for the output: press play inside a gesture
    // ON it. A browser that has not been touched refuses to start audio by itself.
    error: session?.error === 'autoplay-blocked' ? `Tap play on ${outputName} to start it there` : null,
    globalPos,
    livePosition,
    total: shown?.duration ?? 0,
    volume,
    muted,
    queue,
    context: session?.context ?? null,
    shuffle: queue.policy.shuffle,
    repeat,
    // Crossfade is THIS device's setting (Jag, 2026-09-23: per-device), not the output's.
    crossfadeSec: local.crossfadeSec,
    tracksById: local.tracksById,
    toggle: () => {
      const playing = !facts?.playing;
      setOpt((o) => ({ ...(o ?? {}), rev, at: Date.now(), playing }));
      send(playing ? 'play' : 'pause');
    },
    seekTo,
    trackPrev: () => send('prev'),
    trackNext: () => send('next'),
    setVolume,
    setMuted,
    toggleMute: () => setMuted(!muted),
    setShuffle: (on) => send('shuffle', { on }),
    cycleRepeat: () => send('repeat', { mode: REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeat) + 1) % REPEAT_ORDER.length] }),
    setRepeat: (mode) => send('repeat', { mode }),
    setCrossfade: local.setCrossfade,
    points,
    segmentIndex,
    segmentLabel: shown?.segments.length ? points[segmentIndex]?.title ?? null : null,
    prevSegment: () => send('segment', { dir: 'prev' }),
    nextSegment: () => send('segment', { dir: 'next' }),
    seekSegment: (i) => { const p = points[Math.min(Math.max(i, 0), points.length - 1)]; if (p) seekTo(p.start); },
    rate: session?.rate ?? 1,
    cycleRate: () => send('rate'),
    skip: (delta) => send('skip', { delta_ms: Math.round(delta * 1000) }),
    bookmarks,
    addBookmarkHere: () => {
      if (!shown || shown.kind !== 'book') return;
      const at = livePosition();
      unifiedBookmarks.create({ itemId: shown.ref, position: at, title: points[segmentIndex]?.title || null })
        .then(refreshBookmarks, refreshBookmarks);
    },
    jumpBookmark: (pos) => seekTo(pos),
    removeBookmark: (id) => { unifiedBookmarks.remove(id).then(refreshBookmarks, refreshBookmarks); },
    sleepMode,
    sleepRemainingMs: session ? sleepRemainingMs(session, serverNow()) : null,
    setSleep: (mode) => send('sleep', { mode }),
    playQueueItem: (index) => send('jump', { index }),
    removeQueueItem: (index) => send('remove', { index }),
    reorderQueue: (from, to) => send('reorder', { from, to }),
    playNext: (ids) => { if (ids.length) send('enqueue', { items: items(ids), where: 'next' }); },
    addToQueue: (ids) => { if (ids.length) send('enqueue', { items: items(ids), where: 'end' }); },
    playNow: (ids, startIndex = 0) => {
      if (ids.length) send('load', { items: items(ids), startIndex: Math.min(Math.max(0, startIndex), ids.length - 1) });
    },
  };
}
