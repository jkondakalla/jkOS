import { useEffect } from 'react';
import { albumHref, artistHref } from '../hooks/useHashRoute';
import { requestEnqueue, requestPlay } from '../player/controller';
import { IconAddQueue, IconPlayNext, IconRadio } from './icons';
import { IconPlay } from '@jkos/player/ui';

export interface ActionTarget {
  /** The tracks this action applies to — one row, or a whole album/run. */
  trackIds: number[];
  title: string;
  subtitle?: string | null;
  /** Enables the "Go to …" links when known. */
  artist?: string | null;
  album?: string | null;
  /** Seed for "Start a station". Defaults to the first track. */
  seedId?: number;
}

interface ActionSheetProps {
  target: ActionTarget | null;
  onClose(): void;
  /** Called when the user asks for a station — the host view owns navigation to
   *  the resulting queue, since only it knows whether to route or play in place. */
  onRadio?(seedId: number): void;
}

/**
 * The one action surface in the app: a bottom sheet on a phone, a centred card on
 * a desktop, opened from any track row, album header or run.
 *
 * ⚠️ "Play next" and "Add to queue" are two SEPARATE, EQUALLY VISIBLE rows, each
 * with its own glyph. The brief names this explicitly as something Plexamp gets
 * wrong, and it is easy to get wrong: the space-saving move is one "+" button
 * that appends, with "play next" hidden behind a long-press or a submenu. That
 * makes the more common intent the harder one to reach. They sit adjacent here,
 * same weight, different icons (IconPlayNext fills the TOP of a list, IconAddQueue
 * appends to the BOTTOM) so the difference is legible without reading the labels.
 */
export default function ActionSheet({ target, onClose, onRadio }: ActionSheetProps) {
  // Escape closes, and the body cannot scroll behind the sheet — otherwise a
  // phone scrolls the page under the user's finger while the sheet is open.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [target, onClose]);

  if (!target) return null;
  const { trackIds, title, subtitle, artist, album } = target;
  const seedId = target.seedId ?? trackIds[0];

  function act(fn: () => void) {
    fn();
    onClose();
  }

  return (
    <div className="kr-sheet-host" role="dialog" aria-modal="true" aria-label={`Actions for ${title}`}>
      <button type="button" className="kr-sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="kr-sheet kr-glass kr-glass-deep kr-gloss">
        <div className="kr-sheet-grab" aria-hidden="true" />
        <header className="kr-sheet-head">
          <p className="kr-sheet-title">{title}</p>
          {subtitle && <p className="kr-sheet-sub">{subtitle}</p>}
        </header>

        <div className="kr-sheet-actions">
          <button
            type="button"
            className="kr-action"
            onClick={() => act(() => requestPlay({ trackIds, startIndex: 0 }))}
          >
            <IconPlay />
            <span>Play now</span>
          </button>

          <button
            type="button"
            className="kr-action"
            onClick={() => act(() => requestEnqueue({ trackIds, where: 'next' }))}
          >
            <IconPlayNext />
            <span>Play next</span>
            <span className="kr-action-note">after this track</span>
          </button>

          <button
            type="button"
            className="kr-action"
            onClick={() => act(() => requestEnqueue({ trackIds, where: 'end' }))}
          >
            <IconAddQueue />
            <span>Add to queue</span>
            <span className="kr-action-note">at the end</span>
          </button>

          {onRadio && seedId != null && (
            <button type="button" className="kr-action" onClick={() => act(() => onRadio(seedId))}>
              <IconRadio />
              <span>Start a station</span>
              <span className="kr-action-note">similar tracks</span>
            </button>
          )}
        </div>

        {(artist || album) && (
          <div className="kr-sheet-links">
            {album && artist && (
              <a className="kr-sheet-link" href={albumHref(artist, album)} onClick={onClose}>
                Go to album
              </a>
            )}
            {artist && (
              <a className="kr-sheet-link" href={artistHref(artist)} onClick={onClose}>
                Go to artist
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
