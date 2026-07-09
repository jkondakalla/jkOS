import { useEffect, useState, type FormEvent } from 'react';
import { Lab, Sheet, TButton, cx } from '@jkos/ui';
import { matchBook, searchMetadata, type Candidate, type MatchResult } from '../../api';

// The "Fix metadata" match flow (task 5.3's brief): search term → candidates → pick →
// POST /api/match → the parent refreshes. This component owns the search box, the
// candidate list, and the apply call itself (loading/error/empty states throughout);
// it only tells BookDetail *that* a match landed via `onApplied` — refetching the book
// and cache-busting the cover img is BookDetail's job (it owns that state), not this
// panel's. Mounted/unmounted by the parent's `matchOpen` toggle, so the one-shot
// "search on open" effect below needs no guard against re-firing on re-render.

interface MatchPanelProps {
  bookId: number;
  /** Prefilled search term — book.title. */
  initialTerm: string;
  /** Fired after a successful POST /api/match (whether or not the cover download
   *  itself succeeded — that distinction is surfaced inline, not via this callback). */
  onApplied: (result: MatchResult) => void;
  onClose: () => void;
}

type SearchStatus = 'idle' | 'loading' | 'error';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

export default function MatchPanel({ bookId, initialTerm, onApplied, onClose }: MatchPanelProps) {
  const [term, setTerm] = useState(initialTerm);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ candidate: Candidate; result: MatchResult } | null>(null);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setStatus('loading');
    setApplyError(null);
    try {
      const rows = await searchMetadata(trimmed);
      setCandidates(rows);
      setStatus('idle');
    } catch {
      setCandidates(null);
      setStatus('error');
    }
  };

  // Search once on open, using the prefilled title — the brief's pipeline is
  // "search term → candidates", not an extra click to see the obvious first result.
  useEffect(() => {
    runSearch(initialTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(term);
  };

  const apply = async (candidate: Candidate) => {
    setApplyingId(candidate.id);
    setApplyError(null);
    try {
      const result = await matchBook(bookId, candidate);
      setApplied({ candidate, result });
      onApplied(result);
    } catch {
      setApplyError('Could not apply this match — try again.');
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <Sheet className="match-panel">
      <div className="match-panel-head">
        <Lab size="sm">Fix metadata</Lab>
        <TButton quiet onClick={onClose}>Close</TButton>
      </div>

      <form className="match-panel-search" onSubmit={onSubmit}>
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search title, author…"
          className="match-panel-input"
          aria-label="Metadata search term"
        />
        {/* Plain <button>, not <TButton> — TButton's prop type (this workspace's React
            types) doesn't carry `disabled`; same jk-tbtn class, so it's visually
            identical, it just supports the attribute the loading state needs. */}
        <button type="submit" className={cx('jk-tbtn')} disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {applied && (
        <p className={cx('muted', 'match-panel-msg')}>
          Applied "{applied.candidate.title}".
          {applied.result.cover === 'failed' && ' Metadata updated, but the cover art download failed.'}
        </p>
      )}
      {applyError && <p className="muted match-panel-msg">{applyError}</p>}
      {status === 'error' && <p className="muted match-panel-msg">Search failed — try again.</p>}
      {status === 'idle' && candidates && candidates.length === 0 && (
        <p className="muted match-panel-msg">No matches for "{term}".</p>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="match-candidates">
          {candidates.map((c) => (
            <li key={c.id} className="match-candidate">
              {c.cover ? (
                <img src={c.cover} alt="" className="match-candidate-cover" />
              ) : (
                <div className="match-candidate-cover match-candidate-cover-placeholder" aria-hidden="true" />
              )}
              <div className="match-candidate-info">
                <div className="match-candidate-title">{c.title}</div>
                <div className="muted match-candidate-meta">
                  {[c.author, c.year, c.genre].filter(Boolean).join(' · ') || '—'}
                </div>
                {c.description && (
                  <p className="match-candidate-desc">{truncate(c.description, 160)}</p>
                )}
              </div>
              <button
                type="button"
                className={cx('jk-tbtn', 'match-candidate-apply')}
                disabled={applyingId != null}
                onClick={() => apply(c)}
              >
                {applyingId === c.id ? 'Applying…' : 'Apply'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
