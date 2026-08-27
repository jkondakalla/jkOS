/**
 * weave/useResumeCursor.ts — useResumeCursor(collection, key) (git history, Wave 16,
 * item 16.4): the React face of createResumeCursor (./resumeCursor.ts), for any app
 * that wants a debounced find-or-create "resume position" over its OWN collection —
 * not just the player.
 *
 * Weave's frontend client (weaveClient / useWeaveList) reads/writes through
 * discovery — a bulk `list()` and a named-capability `command()` — neither of which
 * is the per-key find/create/update seam a resume cursor needs. Rather than bend
 * that client into a shape it isn't, this hook takes a minimal store adapter
 * (`ResumeCursorStore` — the same seam packages/player's `ProgressStore` already
 * satisfies) as its `collection` argument: a caller wires ~3 one-line functions
 * against whatever API client it already has (weaveClient.command, a REST client,
 * anything) instead of this module conjuring a new one.
 *
 * Beyond the core, this hook additionally:
 *  - resolves `collection.find(key)` on mount/key-change, so a caller gets its
 *    saved row (to resume FROM) with no separate effect of its own;
 *  - wires the two DOM-generic flush triggers (visibilitychange-hidden,
 *    beforeunload) automatically, since a hook (unlike the core) can assume a DOM.
 *    A caller-specific trigger (e.g. a media "pause" event) uses the returned
 *    `flush()` directly — mirrors usePlayerEngine.ts's onPause.
 */
import { useEffect, useRef, useState } from 'react';
import {
  createResumeCursor,
  type ResumeCursor, type ResumeCursorOptions, type ResumeCursorRowLike,
  type ResumeCursorSnapshot, type ResumeCursorStore,
} from './resumeCursor';

export interface UseResumeCursorApi<TRow> {
  /** The resolved row for the current key — null until the initial find() resolves,
   *  or if none exists yet. */
  row: TRow | null;
  /** True once the initial find() for the current key has settled (resolved OR
   *  failed) — a caller can gate its "resume from…" UI on this. */
  ready: boolean;
  /** Record the latest position (+ duration) and arm the debounce window if one
   *  isn't already running. Call on every position tick. */
  schedule(position: number, duration: number): void;
  /** Cancel any pending timer and write now — wire to a caller-specific trigger
   *  (e.g. a media "pause" event); visibilitychange/beforeunload are already
   *  wired below. `finished` defaults to false. */
  flush(finished?: boolean): void;
  /** Force the next write to persist even if position+finished still match the
   *  last write (the seek idiom). */
  invalidateLastWritten(): void;
}

export function useResumeCursor<TId, TRow extends ResumeCursorRowLike>(
  collection: ResumeCursorStore<TId, TRow>,
  key: TId | null | undefined,
  opts: ResumeCursorOptions = {},
): UseResumeCursorApi<TRow> {
  const [row, setRow] = useState<TRow | null>(null);
  const [ready, setReady] = useState(false);

  // Always-live refs the core's getSnapshot pulls from — never a value captured
  // once (see resumeCursor.ts's header on why the pull has to be live).
  const keyRef = useRef(key);
  keyRef.current = key;
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  const posRef = useRef(0);
  const durRef = useRef(0);

  const cursorRef = useRef<ResumeCursor<TRow> | null>(null);
  if (!cursorRef.current) {
    // Indirect through the refs so a caller passing a fresh `collection` object
    // every render doesn't force a new cursor instance (the core is built ONCE).
    const store: ResumeCursorStore<TId, TRow> = {
      find: (id) => collectionRef.current.find(id),
      create: (w) => collectionRef.current.create(w),
      update: (r, w) => collectionRef.current.update(r, w),
      itemIdOf: (r) => collectionRef.current.itemIdOf(r),
    };
    const getSnapshot = (): ResumeCursorSnapshot<TId> => {
      const id = keyRef.current;
      if (id == null) return null;
      return { itemId: id, position: posRef.current, duration: durRef.current };
    };
    cursorRef.current = createResumeCursor<TId, TRow>(store, getSnapshot, opts);
  }
  const cursor = cursorRef.current;

  // Key change → a NEW item: reset the tracked row/last-written synchronously,
  // then resolve its saved row (mirrors usePlayerEngine.ts's handleRequest
  // ordering: reset first, adopt the found row only if the lookup isn't stale).
  useEffect(() => {
    cursor.resetItem();
    setRow(null);
    setReady(false);
    if (key == null) { setReady(true); return; }
    let dead = false;
    collectionRef.current.find(key).then(
      (existing) => {
        if (dead) return;
        cursor.setRow(existing);
        setRow(existing);
        setReady(true);
      },
      () => { if (!dead) setReady(true); },
    );
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Flush on the two DOM-generic triggers every consumer wants for free.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') cursor.flush(); };
    const onUnload = () => cursor.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onUnload);
      cursor.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function schedule(position: number, duration: number): void {
    posRef.current = position;
    durRef.current = duration;
    cursor.schedule();
  }
  function flush(finished = false): void {
    cursor.flush(finished);
  }
  function invalidateLastWritten(): void {
    cursor.invalidateLastWritten();
  }

  return { row, ready, schedule, flush, invalidateLastWritten };
}
