// PlayerBar.tsx — the persistent playback bar (task 5.4; re-based onto the
// @jkos/player/ui kit in Wave 16.6). Mounted once in App.tsx below the routed view;
// renders nothing until the first play request lands on the controller seam. All
// <audio> state, position math, progress writes and bookmarks live in
// usePlayerEngine — this file is the transport UI over that engine.
//
// The bar's LAYOUT (desktop 3-column / mobile compact-row) and the stock controls
// (play/pause, ±30s, prev/next chapter, rate, sleep menu, scrubber, meta block) now
// come from @jkos/player/ui — markup/classes byte-identical to what this file
// rendered bespoke before the migration. What stays papyros-owned here: the
// bookmarks menu, the mobile More sheet (both audiobook-specific), the CoverThumb
// (the kit's CoverArt heals its 404-glyph on the next item — a behavior change this
// zero-change migration must not take), and the reserve-space body class.
import { useEffect, useState } from 'react';
import { useBreakpoint, cx } from '@jkos/ui';
import {
  PlayerBar as PlayerBarShell, Transport, PlayerScrim,
  PlayPauseButton, SkipButton, SegmentButton, RateButton, SleepMenu,
  Scrubber, NowPlaying, formatRate, IconClose,
} from '@jkos/player/ui';
import { coverUrl } from '../api';
import { usePlayerEngine, type SleepMode } from './usePlayerEngine';
import { fmtClock } from '@jkos/player/core';
import './player.css';

const SLEEP_OPTIONS: { mode: SleepMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: '15', label: '15 min' },
  { mode: '30', label: '30 min' },
  { mode: '45', label: '45 min' },
  { mode: '60', label: '60 min' },
  { mode: 'chapter', label: 'End of chapter' },
];

export default function PlayerBar() {
  const p = usePlayerEngine();
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const [menu, setMenu] = useState<'sleep' | 'bookmarks' | 'more' | null>(null);

  // Reserve bottom space so the fixed bar never covers the last of the scrolling
  // content. Toggling a body class (consumed by a rule this file owns in player.css)
  // keeps the padding out of app.css entirely.
  useEffect(() => {
    document.body.classList.toggle('papyros-player-open', p.visible);
    return () => document.body.classList.remove('papyros-player-open');
  }, [p.visible]);

  // A different book resets which popover makes sense; close on book change.
  useEffect(() => { setMenu(null); }, [p.book?.id]);

  if (!p.visible || !p.book) return null;
  const book = p.book;

  const total = Math.max(0, p.total);

  // The adapter speaks papyros's chapter vocabulary; the kit's segment controls
  // bridge with this one literal (labels stay "chapter" via each control's prop).
  const segApi = { prevSegment: p.prevChapter, nextSegment: p.nextChapter };

  // The scrubber is the CURRENT CHAPTER's timeline, not the whole book (Jag,
  // 2026-07-09) — the kit Scrubber's 'segment' mode, which is this file's original
  // chapter-window math promoted verbatim (see @jkos/player/ui's segmentWindow).
  // Scrub state lives inside the kit control now; it still commits seekTo in
  // GLOBAL seconds on release, exactly as before.
  const scrubber = (
    <Scrubber
      position={p.globalPos}
      total={total}
      points={p.points}
      currentIndex={p.currentIndex}
      onSeek={p.seekTo}
      ariaLabel="Seek position in chapter"
    />
  );

  const transport = (
    <Transport>
      <SegmentButton api={segApi} dir="prev" label="Previous chapter" />
      <SkipButton api={p} seconds={-30} />
      <PlayPauseButton api={p} />
      <SkipButton api={p} seconds={30} />
      <SegmentButton api={segApi} dir="next" label="Next chapter" />
    </Transport>
  );

  const bookmarksBtn = (
    <div className="pb-menu">
      <button
        className="pb-btn pb-btn-wide"
        title="Bookmarks"
        aria-label="Bookmarks"
        aria-expanded={menu === 'bookmarks'}
        onClick={() => setMenu((m) => (m === 'bookmarks' ? null : 'bookmarks'))}
      >
        <IconBookmark />
        {p.bookmarks.length > 0 && <span className="pb-count">{p.bookmarks.length}</span>}
      </button>
      {menu === 'bookmarks' && (
        <div className={cx('pb-popover', 'pb-popover-wide', mobile && 'is-sheet')} role="menu">
          <div className="pb-popover-head">Bookmarks</div>
          <button className="pb-popover-add" onClick={() => p.addBookmarkHere()}>
            + Add at {fmtClock(p.globalPos)}
          </button>
          {p.bookmarks.length === 0 ? (
            <div className="pb-popover-empty">No bookmarks yet.</div>
          ) : (
            <ul className="pb-bm-list">
              {p.bookmarks.map((bm) => (
                <li key={bm.id} className="pb-bm-row">
                  <button
                    className="pb-bm-jump"
                    onClick={() => { p.jumpBookmark(bm.position); setMenu(null); }}
                    title={`Jump to ${fmtClock(bm.position)}`}
                  >
                    <span className="pb-bm-time">{fmtClock(bm.position)}</span>
                    <span className="pb-bm-title">{bm.title || 'Bookmark'}</span>
                  </button>
                  <button
                    className="pb-bm-del"
                    aria-label="Delete bookmark"
                    title="Delete bookmark"
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
  );

  const meta = (
    <NowPlaying
      art={<CoverThumb bookId={book.id} hasCover={!!book.cover_path} title={book.title} />}
      title={book.title}
      titleHref={`#/book/${book.id}`}
      subtitle={`${book.author || 'Unknown author'}${p.chapterLabel ? ` · ${p.chapterLabel}` : ''}`}
    />
  );

  // Mobile collapses the full control set into a More sheet — papyros's own
  // audiobook overflow design, so it stays bespoke here (the sleep/bookmark rows
  // inside it are sheet content, not the standalone menu controls).
  const moreMenu = (
    <div className="pb-menu">
      <button
        className="pb-btn"
        title="More controls"
        aria-label="More controls"
        aria-expanded={menu === 'more'}
        onClick={() => setMenu((m) => (m === 'more' ? null : 'more'))}
      >
        <IconMore />
      </button>
      {menu === 'more' && (
        <div className="pb-popover is-sheet pb-popover-more" role="menu">
          <div className="pb-more-cluster">
            <button className="pb-btn pb-btn-wide" onClick={p.cycleRate}>{formatRate(p.rate)}</button>
            <SegmentButton api={segApi} dir="prev" label="Previous chapter" />
            <SegmentButton api={segApi} dir="next" label="Next chapter" />
          </div>
          <div className="pb-popover-head">Sleep timer</div>
          {SLEEP_OPTIONS.map((o) => (
            <button
              key={o.mode}
              className={cx('pb-popover-row', p.sleepMode === o.mode && 'is-active')}
              onClick={() => { p.setSleep(o.mode); setMenu(null); }}
            >
              {o.label}
            </button>
          ))}
          <div className="pb-popover-head">Bookmarks</div>
          <button className="pb-popover-add" onClick={() => p.addBookmarkHere()}>
            + Add at {fmtClock(p.globalPos)}
          </button>
          {p.bookmarks.length === 0 ? (
            <div className="pb-popover-empty">No bookmarks yet.</div>
          ) : (
            <ul className="pb-bm-list">
              {p.bookmarks.map((bm) => (
                <li key={bm.id} className="pb-bm-row">
                  <button className="pb-bm-jump" onClick={() => { p.jumpBookmark(bm.position); setMenu(null); }}>
                    <span className="pb-bm-time">{fmtClock(bm.position)}</span>
                    <span className="pb-bm-title">{bm.title || 'Bookmark'}</span>
                  </button>
                  <button className="pb-bm-del" aria-label="Delete bookmark" onClick={() => p.removeBookmark(bm.id)}>
                    <IconClose />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {menu && <PlayerScrim onDismiss={() => setMenu(null)} />}
      <PlayerBarShell
        error={p.error}
        meta={meta}
        transport={transport}
        scrubber={scrubber}
        actions={
          <>
            <RateButton api={p} />
            <SleepMenu
              api={p}
              options={SLEEP_OPTIONS}
              open={menu === 'sleep'}
              onOpenChange={(open) => setMenu(open ? 'sleep' : null)}
              sheet={mobile}
            />
            {bookmarksBtn}
          </>
        }
        mobileTransport={
          <Transport compact>
            <SkipButton api={p} seconds={-30} />
            <PlayPauseButton api={p} />
            <SkipButton api={p} seconds={30} />
          </Transport>
        }
        mobileActions={moreMenu}
      />
    </>
  );
}

// ─── Cover thumbnail (guards the coverUrl 404 → glyph fallback) ──────────────
// Stays papyros-bespoke (not the kit's CoverArt): its `failed` flag deliberately
// never resets on book change, matching pre-migration behavior exactly.
function CoverThumb({ bookId, hasCover, title }: { bookId: number; hasCover: boolean; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!hasCover || failed) {
    return <div className="pb-cover pb-cover-empty" aria-hidden="true"><IconBook /></div>;
  }
  return (
    <img
      className="pb-cover"
      src={coverUrl(bookId)}
      alt={`Cover of ${title}`}
      onError={() => setFailed(true)}
    />
  );
}

// ─── Inline glyphs for the bespoke controls (currentColor; the button's `color`
//     drives them). The stock controls' glyphs ship with @jkos/player/ui. ────────
function IconBookmark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}
function IconMore() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" /></svg>;
}
function IconBook() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="9" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2" opacity="0.6" /></svg>;
}
