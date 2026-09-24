import { useEffect, useMemo, useState } from 'react';
import { AsyncView, Lab, Pill, TButton } from '@jkos/ui';
import {
  coverUrl, getBook, listProgress,
  type BookDetail as BookDetailRow, type ProgressRow,
} from '../../books/api';
import DownloadButton from './DownloadButton';
import { OfflineBadge, OfflineButton } from '../../books/offline';
import { getLastPosition, onPosition, requestPlay, type PositionUpdate } from '../../player/controller';
import { encodeRef } from '../../player/sources';
import { bookContext } from '../../player/context';
import MatchPanel from './book-detail/MatchPanel';
import { formatClock, formatHM, plainDescription } from './book-detail/format';
import './book-detail.css';

// One audiobook: metadata, chapter/track list, resume, offline, and the "Fix metadata"
// match flow — PapyrOS's BookDetail (task 5.3), folded into KourOS 2026-09-23.
// Playback goes through player/controller.ts's requestPlay like every other view: a
// book is a ONE-ITEM queue (`book:<id>`), and this view never touches <audio>.

/** The listener's position for THIS book: live off controller.ts's position broadcast
 *  while it's the one playing (a view can't call usePlayerEngine() itself — that
 *  would spin up a second <audio>), else the saved progress row, else 0. Drives the
 *  chapter-row loading-bar fill below. */
function useListenerPosition(bookId: number, savedPosition: number): number {
  const [live, setLive] = useState<PositionUpdate | null>(() => getLastPosition());
  useEffect(() => {
    setLive(getLastPosition());   // this book may already be mid-playback on mount
    return onPosition(setLive);
  }, [bookId]);
  return live && live.bookId === bookId ? live.position : savedPosition;
}

/** Fraction [0, 1] of a [start, end) chapter/track already behind the listener's
 *  position — 0 ahead of it, 1 for chapters fully finished, fractional for the one
 *  they're inside. Chapter rows use this as their loading-bar fill width. */
function chapterFraction(start: number, end: number, position: number): number {
  if (position <= start) return 0;
  if (position >= end) return 1;
  return (position - start) / (end - start);
}

const SOURCE_LABELS: Record<BookDetailRow['metadata_source'], string> = {
  embedded: 'Source: embedded tags',
  itunes:   'Source: iTunes match',
  manual:   'Source: manual edit',
};

/** Plain book-outline glyph for covers with no artwork (cover_path is null, or the
 *  <img> itself 404s). currentColor, so the wrapper's `color` drives it. */
function CoverGlyph() {
  return (
    <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="7" y="5" width="26" height="30" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="7" y1="11" x2="33" y2="11" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <line x1="13" y1="18" x2="27" y2="18" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <line x1="13" y1="23" x2="27" y2="23" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

export default function BookDetail({ bookId }: { bookId: number }) {
  const [book, setBook]         = useState<BookDetailRow | null>(null);
  const [error, setError]       = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [matchOpen, setMatchOpen]     = useState(false);
  const [coverBust, setCoverBust]     = useState(0);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setBook(null);
    setError(false);
    setProgress([]);
    setMatchOpen(false);
    setCoverBust(0);
    setCoverFailed(false);

    getBook(bookId).then(
      (b) => { if (alive) setBook(b); },
      () => { if (alive) setError(true); },
    );
    // Owner-scoped progress list — non-fatal if it fails, Play still works, it just
    // starts from 0 instead of offering Resume.
    listProgress().then(
      (rows) => { if (alive) setProgress(rows); },
      () => {},
    );
    return () => { alive = false; };
  }, [bookId]);

  const row = progress.find((p) => p.book_ref === bookId) ?? null;
  const canResume = !!row && !row.finished;
  const listenerPos = useListenerPosition(bookId, row?.position ?? 0);

  const sortedFiles = useMemo(
    () => (book ? [...book.files].sort((a, b) => a.index - b.index) : []),
    [book],
  );
  const fileOffsets = useMemo(() => {
    let acc = 0;
    return sortedFiles.map((f) => { const start = acc; acc += f.duration; return start; });
  }, [sortedFiles]);

  /** A book plays as a one-item queue. `position` is explicit either way: the engine
   *  would find the progress row itself, but a FINISHED book must start over rather
   *  than resume at its last second. */
  const playAt = (position: number) => {
    requestPlay({ trackIds: [encodeRef('book', bookId)], startIndex: 0, position, context: bookContext(bookId) });
  };
  const handlePlay = () => playAt(canResume && row ? row.position : 0);

  // A match landed — refetch the book (title's own edits don't apply here, but
  // author/description/year/genres/cover may all have changed) and cache-bust the
  // cover <img> since matchBook can silently replace cover_path in place.
  const handleApplied = () => {
    getBook(bookId).then((b) => setBook(b), () => {});
    setCoverBust(Date.now());
    setCoverFailed(false);
  };

  const showCoverImg = !!book?.cover_path && !coverFailed;

  return (
    <section className="view-book-detail">
      <TButton as="a" href="#/books" quiet className="back-link">&larr; Audiobooks</TButton>

      <AsyncView
        loading={!error && !book}
        error={error}
        errorText="Could not load this book. Try again shortly."
      >
        {book && (
        <>
          <div className="book-hero">
            {showCoverImg ? (
              <img
                className="book-cover"
                src={`${coverUrl(book.id)}${coverBust ? `?v=${coverBust}` : ''}`}
                alt={`Cover of ${book.title}`}
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <div className="book-cover book-cover-placeholder"><CoverGlyph /></div>
            )}

            <div className="book-hero-info">
              <div className="book-hero-eyebrow">
                <Lab size="sm">Audiobook</Lab>
                <OfflineBadge bookId={book.id} label />
              </div>
              <h2 className="book-title">{book.title}</h2>
              {book.subtitle && <p className="book-subtitle">{book.subtitle}</p>}
              <div className="book-byline">
                {book.author && <span>{book.author}</span>}
                {book.narrator && <span className="book-narrator"> · narrated by {book.narrator}</span>}
              </div>
              {book.series && (
                <p className="book-series">
                  {book.series}{book.series_seq != null ? ` #${book.series_seq}` : ''}
                </p>
              )}
              <div className="book-meta-row">
                {book.year != null && <span>{book.year}</span>}
                <span>{formatHM(book.duration)}</span>
              </div>
              {book.genres.length > 0 && (
                <div className="book-genres">
                  {book.genres.map((g) => (
                    <Pill key={g} className="genre-pill">{g}</Pill>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="book-actions">
            <TButton className="play-button" onClick={handlePlay}>
              {canResume && row ? `▶ Resume · ${formatClock(row.position)}` : '▶ Play'}
            </TButton>
            <OfflineButton book={book} />
            <DownloadButton book={book} />
          </div>
          {row && row.duration > 0 && (
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((row.position / row.duration) * 100)}
            >
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (row.position / row.duration) * 100)}%` }}
              />
            </div>
          )}

          {/* Flattened, never injected — the blurb is third-party HTML (format.ts). */}
          {plainDescription(book.description) && (
            <p className="book-description">{plainDescription(book.description)}</p>
          )}

          <div className="book-provenance">
            <Lab size="xs" sans style={{ opacity: 0.6 }}>{SOURCE_LABELS[book.metadata_source]}</Lab>
            <TButton quiet onClick={() => setMatchOpen((o) => !o)}>
              {matchOpen ? 'Close' : 'Fix metadata'}
            </TButton>
          </div>
          {matchOpen && (
            <MatchPanel
              bookId={bookId}
              initialTerm={book.title}
              onApplied={handleApplied}
              onClose={() => setMatchOpen(false)}
            />
          )}

          <div className="book-chapters">
            <Lab size="sm">{book.chapters.length > 0 ? 'Chapters' : 'Tracks'}</Lab>
            <ol className="chapter-list">
              {book.chapters.length > 0
                ? book.chapters.map((ch, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="chapter-row"
                        onClick={() => playAt(ch.start)}
                      >
                        <span
                          className="chapter-row-fill"
                          style={{ width: `${chapterFraction(ch.start, ch.end, listenerPos) * 100}%` }}
                          aria-hidden="true"
                        />
                        <span className="chapter-index">{i + 1}</span>
                        <span className="chapter-title">{ch.title || `Chapter ${i + 1}`}</span>
                        <span className="chapter-time">{formatClock(ch.end - ch.start)}</span>
                      </button>
                    </li>
                  ))
                : sortedFiles.map((f, i) => (
                    <li key={f.index}>
                      <button
                        type="button"
                        className="chapter-row"
                        onClick={() => playAt(fileOffsets[i]!)}
                      >
                        <span
                          className="chapter-row-fill"
                          style={{
                            width: `${chapterFraction(fileOffsets[i], fileOffsets[i] + f.duration, listenerPos) * 100}%`,
                          }}
                          aria-hidden="true"
                        />
                        <span className="chapter-index">{i + 1}</span>
                        <span className="chapter-title">
                          Track {f.index + 1}{f.codec ? ` · ${f.codec.toUpperCase()}` : ''}
                        </span>
                        <span className="chapter-time">{formatClock(f.duration)}</span>
                      </button>
                    </li>
                  ))}
            </ol>
          </div>
        </>
        )}
      </AsyncView>
    </section>
  );
}
