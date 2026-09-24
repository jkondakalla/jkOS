import { useEffect, useState } from 'react';
import {
  IconClose, IconNext, IconPause, IconPlay, IconPrev, IconSkipArrow, IconSpinner,
  PlayerScrim, RateButton, Scrubber, SleepMenu,
} from '@jkos/player/ui';
import { fmtClock } from '@jkos/player/core';
import type { SleepMode } from '@jkos/player/engine';
import { useBreakpoint } from '@jkos/ui';
import Cover from '../components/Cover';
import { IconChevronDown } from '../components/icons';
import { bookHref, closeOverlay } from '../hooks/useHashRoute';
import { usePlayer, nowPlayingArt, usePlayerSession } from '../player/PlayerProvider';
import PlayingOn, { DevicesButton } from '../player/PlayingOn';
import { BOOK_SKIP_SEC } from '../player/usePlayerEngine';
import './books/now-book.css';

/** The sleep options, in the engine's vocabulary ('segment' = end of chapter). */
const SLEEP_OPTIONS: { mode: SleepMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: '15', label: '15 min' },
  { mode: '30', label: '30 min' },
  { mode: '45', label: '45 min' },
  { mode: '60', label: '60 min' },
  { mode: 'segment', label: 'End of chapter' },
];

/**
 * Now Playing, for an audiobook.
 *
 * The same glass screen as a track's (views/NowPlaying.tsx) — the jacket is the one
 * opaque thing over a blurred copy of itself — with the controls a BOOK is actually
 * steered by, which are not a music player's:
 *
 *   · the scrubber is the CURRENT CHAPTER's window, not the whole book: a 19-hour
 *     timeline under a thumb moves a minute per pixel (Jag 2026-07-09);
 *   · the transport is chapter ⇤ · −30 s · play · +30 s · chapter ⇥ — the ±30 s is
 *     the audiobook gesture ("what did they just say?"), not a track skip;
 *   · rate, the sleep timer (incl. "end of chapter") and bookmarks live here.
 *
 * Every control reads the ONE player (usePlayer); the rate is the book's own and
 * never reaches music (sources.ts's rateAppliesTo).
 */
export default function NowPlayingBook() {
  const p = usePlayer();
  const remote = usePlayerSession().mode === 'remote';   // the audio is on another device
  const mobile = useBreakpoint() === 'mobile';
  const [menu, setMenu] = useState<'sleep' | 'bookmarks' | null>(null);
  const item = p.item;

  // A different book resets which popover makes sense.
  useEffect(() => { setMenu(null); }, [item?.ref]);

  if (!item) return null;
  const art = nowPlayingArt(p);
  const chapters = p.points.length;
  const remain = Math.max(0, p.total - p.globalPos);

  return (
    <section className="kr-now kr-now-book">
      <div
        className="kr-ambient kr-now-ambient"
        style={art ? { ['--kr-art' as string]: `url("${art}")` } : undefined}
      />

      <header className="kr-now-head">
        <button type="button" className="kr-ghost" onClick={closeOverlay} aria-label="Close now playing">
          <IconChevronDown />
        </button>
        {remote ? <PlayingOn className="kr-now-on" /> : (
          <p className="kr-now-eyebrow">
            {chapters > 1 && p.segmentIndex >= 0 ? `Chapter ${p.segmentIndex + 1} of ${chapters}` : 'Audiobook'}
          </p>
        )}
        <a className="kr-ghost" href={bookHref(item.id)} aria-label="Open this book">
          <span className="kr-now-queue-label">Book</span>
        </a>
      </header>

      <div className="kr-now-stage">
        <div className="kr-now-art kr-now-art-book">
          <Cover src={item.coverUrl} alt={`${item.title} cover`} name={item.title} eager />
        </div>
      </div>

      <div className="kr-now-meta">
        <h1 className="kr-now-title">{item.title}</h1>
        <p className="kr-now-artist">{item.byline}</p>
        {p.segmentLabel && <p className="kr-book-chapter kr-mono">{p.segmentLabel}</p>}
      </div>

      <div className="kr-now-scrub">
        <Scrubber
          position={p.globalPos}
          total={Math.max(0, p.total)}
          points={p.points}
          currentIndex={p.segmentIndex}
          onSeek={p.seekTo}
          mode="segment"
          ariaLabel="Seek position in chapter"
        />
        <p className="kr-book-left kr-mono">{fmtClock(remain)} left in the book</p>
      </div>

      <div className="kr-now-transport">
        <button type="button" className="kr-ghost kr-now-skip" onClick={p.prevSegment} aria-label="Previous chapter">
          <IconPrev />
        </button>
        <button type="button" className="kr-ghost" onClick={() => p.skip(-BOOK_SKIP_SEC)} aria-label={`Back ${BOOK_SKIP_SEC} seconds`}>
          <IconSkipArrow dir="back" seconds={BOOK_SKIP_SEC} />
        </button>
        <button
          type="button"
          className="kr-orb kr-orb-lg"
          onClick={p.toggle}
          aria-label={p.playing ? 'Pause' : 'Play'}
        >
          {p.buffering ? <IconSpinner /> : p.playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="kr-ghost" onClick={() => p.skip(BOOK_SKIP_SEC)} aria-label={`Forward ${BOOK_SKIP_SEC} seconds`}>
          <IconSkipArrow dir="fwd" seconds={BOOK_SKIP_SEC} />
        </button>
        <button type="button" className="kr-ghost kr-now-skip" onClick={p.nextSegment} aria-label="Next chapter">
          <IconNext />
        </button>
      </div>

      {menu && <PlayerScrim onDismiss={() => setMenu(null)} />}
      <div className="kr-book-extras">
        <DevicesButton />
        <RateButton api={p} />
        <SleepMenu
          api={p}
          options={SLEEP_OPTIONS}
          open={menu === 'sleep'}
          onOpenChange={(open) => setMenu(open ? 'sleep' : null)}
          sheet={mobile}
        />
        <div className="kr-book-marks">
          <button
            type="button"
            className="kr-ghost kr-book-marks-btn"
            aria-expanded={menu === 'bookmarks'}
            onClick={() => setMenu((m) => (m === 'bookmarks' ? null : 'bookmarks'))}
          >
            Bookmarks{p.bookmarks.length > 0 ? ` · ${p.bookmarks.length}` : ''}
          </button>
          {menu === 'bookmarks' && (
            <div className={`kr-book-marks-panel kr-glass${mobile ? ' is-sheet' : ''}`} role="menu">
              <button type="button" className="kr-book-marks-add" onClick={() => p.addBookmarkHere()}>
                + Add at {fmtClock(p.globalPos)}
              </button>
              {p.bookmarks.length === 0 ? (
                <p className="kr-book-marks-empty">No bookmarks yet.</p>
              ) : (
                <ul className="kr-book-marks-list">
                  {p.bookmarks.map((bm) => (
                    <li key={String(bm.id)} className="kr-book-marks-row">
                      <button
                        type="button"
                        className="kr-book-marks-jump"
                        onClick={() => { p.jumpBookmark(bm.position); setMenu(null); }}
                      >
                        <span className="kr-mono">{fmtClock(bm.position)}</span>
                        <span>{bm.title || 'Bookmark'}</span>
                      </button>
                      <button
                        type="button"
                        className="kr-ghost"
                        aria-label="Delete bookmark"
                        onClick={() => p.removeBookmark(bm.id)}
                      >
                        <IconClose />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
