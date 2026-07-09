// PlayerBar.tsx — the persistent playback bar (task 5.4). Mounted once in App.tsx
// below the routed view; renders nothing until the first play request lands on the
// controller seam. All <audio> state, position math, progress writes and bookmarks
// live in usePlayerEngine — this file is purely the transport UI over that engine.
import { useEffect, useState } from 'react';
import { useBreakpoint, cx } from '@jkos/ui';
import { coverUrl } from '../api';
import { usePlayerEngine, type SleepMode } from './usePlayerEngine';
import { fmtClock } from './position';
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
  const [scrub, setScrub] = useState<number | null>(null);

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
  const displayPos = scrub != null ? scrub : Math.min(p.globalPos, total || p.globalPos);
  const commitScrub = () => { if (scrub != null) { p.seekTo(scrub); setScrub(null); } };

  const scrubber = (
    <div className="pb-scrubber">
      <span className="pb-time" aria-hidden="true">{fmtClock(displayPos)}</span>
      <input
        className="pb-range"
        type="range"
        min={0}
        max={total || 1}
        step={1}
        value={Math.max(0, Math.min(displayPos, total || 1))}
        disabled={total === 0}
        aria-label="Seek position"
        onChange={(e) => setScrub(Number(e.currentTarget.value))}
        onPointerUp={commitScrub}
        onMouseUp={commitScrub}
        onTouchEnd={commitScrub}
        onKeyUp={commitScrub}
      />
      <span className="pb-time" aria-hidden="true">{fmtClock(total)}</span>
    </div>
  );

  const transport = (
    <div className="pb-transport">
      <button className="pb-btn" title="Previous chapter" aria-label="Previous chapter" onClick={p.prevChapter}>
        <IconPrev />
      </button>
      <button className="pb-btn" title="Back 30 seconds" aria-label="Back 30 seconds" onClick={() => p.skip(-30)}>
        <IconSkip dir="back" />
      </button>
      <button
        className="pb-btn pb-btn-primary"
        title={p.playing ? 'Pause' : 'Play'}
        aria-label={p.playing ? 'Pause' : 'Play'}
        onClick={p.toggle}
      >
        {p.buffering && !p.playing ? <IconSpinner /> : p.playing ? <IconPause /> : <IconPlay />}
      </button>
      <button className="pb-btn" title="Forward 30 seconds" aria-label="Forward 30 seconds" onClick={() => p.skip(30)}>
        <IconSkip dir="fwd" />
      </button>
      <button className="pb-btn" title="Next chapter" aria-label="Next chapter" onClick={p.nextChapter}>
        <IconNext />
      </button>
    </div>
  );

  const speedBtn = (
    <button className="pb-btn pb-btn-wide" title="Playback speed" aria-label="Playback speed" onClick={p.cycleRate}>
      {formatRate(p.rate)}
    </button>
  );

  const sleepBtn = (
    <div className="pb-menu">
      <button
        className={cx('pb-btn', 'pb-btn-wide', p.sleepMode !== 'off' && 'is-armed')}
        title="Sleep timer"
        aria-label="Sleep timer"
        aria-expanded={menu === 'sleep'}
        onClick={() => setMenu((m) => (m === 'sleep' ? null : 'sleep'))}
      >
        <IconMoon />
        {p.sleepMode !== 'off' && <span className="pb-armed">{sleepLabel(p.sleepMode, p.sleepRemainingMs)}</span>}
      </button>
      {menu === 'sleep' && (
        <div className={cx('pb-popover', mobile && 'is-sheet')} role="menu">
          <div className="pb-popover-head">Sleep timer</div>
          {SLEEP_OPTIONS.map((o) => (
            <button
              key={o.mode}
              className={cx('pb-popover-row', p.sleepMode === o.mode && 'is-active')}
              role="menuitemradio"
              aria-checked={p.sleepMode === o.mode}
              onClick={() => { p.setSleep(o.mode); setMenu(null); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
    <div className="pb-meta">
      <CoverThumb bookId={book.id} hasCover={!!book.cover_path} title={book.title} />
      <div className="pb-meta-text">
        <a className="pb-title" href={`#/book/${book.id}`} title={book.title}>{book.title}</a>
        <span className="pb-sub">
          {book.author || 'Unknown author'}
          {p.chapterLabel ? ` · ${p.chapterLabel}` : ''}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {menu && <div className="pb-scrim" onClick={() => setMenu(null)} aria-hidden="true" />}
      <section className={cx('player-bar', mobile && 'is-mobile')} data-bp={bp} aria-label="Now playing">
        {mobile ? (
          <>
            {scrubber}
            <div className="pb-row">
              {meta}
              <div className="pb-transport pb-transport-compact">
                <button className="pb-btn" title="Back 30 seconds" aria-label="Back 30 seconds" onClick={() => p.skip(-30)}>
                  <IconSkip dir="back" />
                </button>
                <button
                  className="pb-btn pb-btn-primary"
                  title={p.playing ? 'Pause' : 'Play'}
                  aria-label={p.playing ? 'Pause' : 'Play'}
                  onClick={p.toggle}
                >
                  {p.buffering && !p.playing ? <IconSpinner /> : p.playing ? <IconPause /> : <IconPlay />}
                </button>
                <button className="pb-btn" title="Forward 30 seconds" aria-label="Forward 30 seconds" onClick={() => p.skip(30)}>
                  <IconSkip dir="fwd" />
                </button>
              </div>
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
                      <button className="pb-btn" title="Previous chapter" aria-label="Previous chapter" onClick={p.prevChapter}><IconPrev /></button>
                      <button className="pb-btn" title="Next chapter" aria-label="Next chapter" onClick={p.nextChapter}><IconNext /></button>
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
            </div>
          </>
        ) : (
          <>
            <div className="pb-left">{meta}</div>
            <div className="pb-center">
              {transport}
              {scrubber}
            </div>
            <div className="pb-right">
              {speedBtn}
              {sleepBtn}
              {bookmarksBtn}
            </div>
          </>
        )}
      </section>
    </>
  );
}

// ─── Cover thumbnail (guards the coverUrl 404 → glyph fallback) ──────────────
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

function formatRate(r: number): string {
  return `${Number.isInteger(r) ? r : r.toString()}×`;
}
function sleepLabel(mode: SleepMode, remainingMs: number | null): string {
  if (mode === 'chapter') return 'CH';
  if (remainingMs != null) return fmtClock(remainingMs / 1000);
  return '';
}

// ─── Inline glyphs (currentColor; the button's `color` drives them) ─────────
function IconPlay() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>;
}
function IconPause() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>;
}
function IconSpinner() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="pb-spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function IconSkip({ dir }: { dir: 'back' | 'fwd' }) {
  // A circular arrow with "30" — mirrored for back vs forward.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={dir === 'fwd' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M12 6V3L7 7l5 4V8a5 5 0 1 1-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12.5" y="16.5" textAnchor="middle" fontSize="7" fontFamily="var(--hub-font-mono)" fill="currentColor" style={dir === 'fwd' ? { transform: 'scaleX(-1)', transformOrigin: '12.5px 14px' } : undefined}>30</text>
    </svg>
  );
}
function IconPrev() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M19 6l-9 6 9 6z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
function IconNext() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M5 6l9 6-9 6z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
function IconMoon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}
function IconBookmark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}
function IconMore() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" /></svg>;
}
function IconClose() {
  return <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function IconBook() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="9" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2" opacity="0.6" /></svg>;
}
