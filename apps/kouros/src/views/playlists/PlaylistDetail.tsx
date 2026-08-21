import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AsyncView, Lab, TButton, cx,
  usePointerDrag, DRAG_THRESHOLD_PX, HOLD_MS, HOLD_CANCEL_PX,
} from '@jkos/ui';
import { updatePlaylist, type Track } from '../../api';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useTracks } from '../../hooks/useTracks';
import { playlistsHref } from '../../hooks/useHashRoute';
import { requestPlay } from '../../player/controller';
import { formatDuration, formatSpan, trackArtist, trackAlbum } from '../library/format';
import { insertionSlot, reorderTarget, moveItem, type RowSpan } from './reorder';
import './playlists.css';

interface PlaylistDetailProps {
  playlistId: number;
}

/** One playlist's track list (18.6): resolved rows (`track_refs` → `tracks`, vanished
 *  refs skipped silently), Play (from index 0), per-row play-from-here, remove-row,
 *  and drag reorder via `usePointerDrag` — the house split QueuePanel already proved
 *  (packages/player/src/ui/QueuePanel.tsx): distance-threshold activation for mouse/
 *  pen, press-and-hold for touch. Reorder persists as a PATCH of the WHOLE `track_refs`
 *  array (the collection's only reorder primitive — see discovery.js's PLAYLISTS
 *  comment on why there's no join-table position column to update instead),
 *  optimistic — the dragged row snaps to its new slot immediately — reverted back to
 *  the pre-drag order if the PATCH fails. */
export default function PlaylistDetail({ playlistId }: PlaylistDetailProps) {
  const { playlists, loading: loadingPlaylists, error: playlistsError } = usePlaylists();
  const { tracks: allTracks, loading: loadingTracks, error: tracksError } = useTracks();
  const playlist = playlists.find((p) => p.id === playlistId) ?? null;

  const byId = useMemo(() => new Map(allTracks.map((t) => [t.id, t] as const)), [allTracks]);

  // The working order — starts `null` (defer to the server's `track_refs`) and
  // becomes a real array once either (a) the server order first arrives, or (b) a
  // reorder/remove sets it optimistically. Once we've made our own optimistic edit
  // we stop re-adopting the server value (see the effect below) — our own PATCH
  // response already told us the truth, and re-fetching `playlists` isn't needed
  // just to keep displaying it (same "don't refetch what you already know" call as
  // avoiding a `reload()` after every optimistic write).
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const adoptedServerKey = useRef<string | null>(null);
  const committedOrder = playlist?.track_refs ?? null;

  useEffect(() => {
    if (!committedOrder) return;
    const key = committedOrder.join(',');
    if (key === adoptedServerKey.current) return;
    adoptedServerKey.current = key;
    setLocalOrder((prev) => (prev === null ? committedOrder : prev));
  }, [committedOrder]);

  // Vanished refs (a track the scanner later removed) are dropped from the
  // resolved list here — "skip vanished refs silently" (18.6's ask). Any
  // subsequent persist (reorder/remove) writes back only the still-valid ids,
  // which is also how a dead ref eventually falls out of `track_refs` for good.
  const resolvedIds = useMemo(
    () => (localOrder ?? committedOrder ?? []).filter((id) => byId.has(id)),
    [localOrder, committedOrder, byId],
  );
  const rows = useMemo(() => resolvedIds.map((id) => byId.get(id) as Track), [resolvedIds, byId]);

  const loading = loadingPlaylists || loadingTracks;
  const error = playlistsError || tracksError;
  const notFound = !loading && !error && !playlist;

  function playAll() {
    requestPlay({ trackIds: resolvedIds, startIndex: 0 });
  }
  function playFrom(index: number) {
    requestPlay({ trackIds: resolvedIds, startIndex: index });
  }

  const [saveError, setSaveError] = useState<string | null>(null);

  async function persistOrder(next: number[]) {
    const prev = resolvedIds;
    setLocalOrder(next);
    setSaveError(null);
    try {
      await updatePlaylist(playlistId, { track_refs: next });
    } catch {
      setLocalOrder(prev);
      setSaveError('Could not save the new order — reverted.');
    }
  }

  function removeAt(index: number) {
    persistOrder(resolvedIds.filter((_, i) => i !== index));
  }

  // ── Reorder gesture — usePointerDrag (@jkos/ui), the suite's ONE drag engine.
  const { begin } = usePointerDrag();
  const listRef = useRef<HTMLOListElement | null>(null);
  const spansRef = useRef<RowSpan[]>([]);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const measure = (): RowSpan[] => {
    const els = listRef.current?.querySelectorAll('.kr-reorder-row') ?? [];
    return Array.from(els, (el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
  };

  function beginRowDrag(e: ReactPointerEvent, from: number) {
    begin(e, {
      // The house split: touch must hold to lift (matches the calendar/QueuePanel
      // touch policy — a plain scroll shouldn't accidentally start a reorder);
      // mouse/pen lift on a few px of travel.
      activation: e.pointerType === 'touch'
        ? { kind: 'hold', delay: HOLD_MS, cancelDistance: HOLD_CANCEL_PX }
        : { kind: 'distance', threshold: DRAG_THRESHOLD_PX },
      onActivate: (ctx) => {
        spansRef.current = measure();
        setDrag({ from, to: reorderTarget(from, insertionSlot(spansRef.current, ctx.y)) });
      },
      onMove: (ctx) => {
        setDrag({ from, to: reorderTarget(from, insertionSlot(spansRef.current, ctx.y)) });
      },
      onEnd: (ctx, activated) => {
        setDrag(null);
        if (!activated) return;   // a plain tap on the grip — not a reorder
        const to = reorderTarget(from, insertionSlot(spansRef.current, ctx.y));
        if (to !== from) persistOrder(moveItem(resolvedIds, from, to));
      },
      onCancel: () => setDrag(null),
    });
  }

  return (
    <section className="view-detail view-playlist">
      <TButton as="a" href={playlistsHref()} quiet className="back-link">&larr; Playlists</TButton>

      <AsyncView
        loading={loading}
        error={error}
        errorText="Could not load this playlist. Try again shortly."
        empty={notFound}
        emptyText="This playlist could not be found."
      >
        {playlist && (
          <>
            <div className="detail-hero detail-hero-simple">
              <Lab size="sm">Playlist</Lab>
              <h2 className="detail-title">{playlist.name}</h2>
              {playlist.description && <p className="kr-playlist-desc">{playlist.description}</p>}
              <p className="detail-meta-row">
                <span>{rows.length} track{rows.length === 1 ? '' : 's'}</span>
                <span>{formatSpan(rows.reduce((s, t) => s + (t.duration || 0), 0))}</span>
              </p>
              <TButton className="play-button" onClick={playAll} disabled={rows.length === 0}>
                ▶ Play
              </TButton>
            </div>

            {saveError && <p className="kr-note kr-note-error">{saveError}</p>}

            {rows.length === 0 ? (
              <p className="kr-note">No tracks yet — add some from Search, an album, or Home (the "+" on any track row).</p>
            ) : (
              <ol className="kr-reorder-list" ref={listRef}>
                {rows.map((t, i) => (
                  <li
                    key={`${t.id}:${i}`}
                    className={cx(
                      'kr-reorder-row',
                      drag?.from === i && 'is-dragging',
                      drag != null && drag.to === i && drag.from !== i && 'is-drop-target',
                    )}
                  >
                    <button
                      type="button"
                      className="kr-reorder-grip"
                      title="Reorder"
                      aria-label="Reorder"
                      onPointerDown={(e) => beginRowDrag(e, i)}
                    >
                      <GripIcon />
                    </button>
                    <button type="button" className="kr-track-row kr-reorder-track" onClick={() => playFrom(i)}>
                      <span className="kr-track-pos">{i + 1}</span>
                      <span className="kr-track-info">
                        <span className="kr-track-title">{t.title}</span>
                        <span className="kr-track-context">{trackArtist(t)} — {trackAlbum(t)}</span>
                      </span>
                      <span className="kr-track-time">{formatDuration(t.duration)}</span>
                    </button>
                    <button
                      type="button"
                      className="kr-reorder-remove"
                      title="Remove from playlist"
                      aria-label="Remove from playlist"
                      onClick={() => removeAt(i)}
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </AsyncView>
    </section>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true">
      <circle cx="2" cy="2" r="1.4" fill="currentColor" />
      <circle cx="8" cy="2" r="1.4" fill="currentColor" />
      <circle cx="2" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="2" cy="14" r="1.4" fill="currentColor" />
      <circle cx="8" cy="14" r="1.4" fill="currentColor" />
    </svg>
  );
}
