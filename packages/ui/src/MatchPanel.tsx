import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Lab, Sheet, TButton, cx } from './primitives';

/* ─────────────────────────────────────────────────────────────────────────────
   @jkos/ui — <MatchPanel> (ToDo.md §3 Wave 20, item 20.4)

   PapyrOS's "Fix metadata" flow (task 5.3) hardcoded ONE search read
   (searchMetadata) + ONE write (matchBook) straight into a component — but the
   SHAPE underneath is exactly a connector read (candidates for a search term) +
   a write capability (apply one candidate), the same lego pair `defineConnector`
   (packages/weave/src/connector.ts) + a CapabilityDef already give the suite for
   free (17.6 even gave a connector an in-process `call()` surface). This is that
   shape generalized into a presentational primitive: search box → candidate list
   (cover/title/author/meta/description) → apply — fed by an INJECTED
   `{search, apply}` pair rather than a hardcoded API import, so @jkos/ui stays
   transport-agnostic (same decoupling rule <AppShell> established at 20.1 — this
   package never imports @jkos/weave or @jkos/auth-client; a caller wires its own
   fetch/weaveClient/whatever behind those two functions).

   `search`/`apply` are the WHOLE contract:
     - `search(term)` resolves the candidate rows to render (or should reject/
       throw on a genuine search failure — this panel distinguishes "search
       failed" from "search returned nothing" by whether the promise rejects).
     - `apply(candidate)` performs the write and resolves with whatever the
       caller's capability returns (or rejects/throws on failure). The result is
       handed to `onApplied`/`resultNote` so a caller can surface capability-
       specific outcomes (e.g. papyros's "cover art download failed" note)
       without this component knowing what a "cover" is.

   A thin weave-binding helper that turns a peer's declared read + capability
   into exactly this `{search, apply}` pair lives in `@jkos/weave` as
   `connectorPair()` (packages/weave/src/connectorPair.ts) — NOT here, same
   reasoning as AppShell's injected hooks. PapyrOS's own binding
   (apps/papyros/src/views/book-detail/MatchPanel.tsx) doesn't use it: its
   searchMetadata/matchBook calls are same-app, direct-fetch, THROW-on-failure
   functions already, and swapping them for weaveClient's silent-[]-on-miss
   contract would change behavior — see that file's header comment. `connectorPair`
   is for a genuinely cross-app consumer.
   ───────────────────────────────────────────────────────────────────────────── */

/** The generic candidate row shape this panel renders. Derived from what
 *  papyros's original panel actually rendered (META's `metadataSearch` item,
 *  discovery.js) — only `id`/`title` are load-bearing (key + apply target);
 *  everything else is optional so a leaner connector read still renders fine
 *  (no cover → the placeholder tile; no description → no blurb paragraph). */
export interface MatchCandidate {
  /** Stable identifier — the React key and what tracks "this row is applying". */
  id: string | number;
  title: string;
  author?: string | null;
  cover?: string | null;
  year?: string | number | null;
  genre?: string | null;
  description?: string | null;
}

type SearchStatus = 'idle' | 'loading' | 'error';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

export interface MatchPanelProps<C extends MatchCandidate = MatchCandidate, R = unknown> {
  /** Heading text/content, e.g. "Fix metadata" — rendered in a <Lab size="sm">.
   *  Required: the generic panel has no house opinion on what a "match" means. */
  title: ReactNode;
  /** Prefilled search term — searched once on mount. */
  initialTerm: string;
  /** Resolves the candidate rows for `term`. Rejecting/throwing puts the panel
   *  into its "search failed" state (distinct from an empty resolved array). */
  search: (term: string) => Promise<C[]>;
  /** Applies one chosen candidate. Resolving surfaces the result via `onApplied`/
   *  `resultNote`; rejecting/throwing shows `applyErrorText` inline. */
  apply: (candidate: C) => Promise<R>;
  /** Fired after a successful `apply()` — e.g. the parent refetching a detail
   *  view. Runs whether or not `resultNote` flags a partial failure. */
  onApplied?: (candidate: C, result: R) => void;
  onClose: () => void;
  /** Extra inline content appended to the "Applied "<title>"." message, derived
   *  from the apply result (e.g. papyros's cover-art-download-failed note).
   *  Return null/undefined for no extra note. */
  resultNote?: (result: R) => ReactNode;
  /** Truncates a candidate's description to this many characters. */
  descriptionMaxLength?: number;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  searchErrorText?: string;
  applyErrorText?: string;
  /** Overrides the "No matches for "<term>"." copy. */
  noResultsText?: (term: string) => ReactNode;
  /** Extra class(es) on the outer <Sheet>. */
  className?: string;
}

export function MatchPanel<C extends MatchCandidate = MatchCandidate, R = unknown>({
  title,
  initialTerm,
  search,
  apply,
  onApplied,
  onClose,
  resultNote,
  descriptionMaxLength = 160,
  searchPlaceholder = 'Search title, author…',
  searchAriaLabel = 'Search term',
  searchErrorText = 'Search failed — try again.',
  applyErrorText = 'Could not apply this match — try again.',
  noResultsText,
  className,
}: MatchPanelProps<C, R>) {
  const [term, setTerm] = useState(initialTerm);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [candidates, setCandidates] = useState<C[] | null>(null);
  const [applyingId, setApplyingId] = useState<MatchCandidate['id'] | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ candidate: C; result: R } | null>(null);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setStatus('loading');
    setApplyError(null);
    try {
      const rows = await search(trimmed);
      setCandidates(rows);
      setStatus('idle');
    } catch {
      setCandidates(null);
      setStatus('error');
    }
  };

  // Search once on open, using the prefilled term — mirrors the original
  // (papyros 5.3) "search term → candidates" pipeline, not an extra click to
  // see the obvious first result. Mounted/unmounted by the CALLER's own toggle
  // (papyros's matchOpen), so this one-shot effect needs no re-fire guard.
  useEffect(() => {
    runSearch(initialTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(term);
  };

  const applyCandidate = async (candidate: C) => {
    setApplyingId(candidate.id);
    setApplyError(null);
    try {
      const result = await apply(candidate);
      setApplied({ candidate, result });
      onApplied?.(candidate, result);
    } catch {
      setApplyError(applyErrorText);
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <Sheet className={cx('jk-match-panel', className)}>
      <div className="jk-match-head">
        <Lab size="sm">{title}</Lab>
        <TButton quiet onClick={onClose}>Close</TButton>
      </div>

      <form className="jk-match-search" onSubmit={onSubmit}>
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={searchPlaceholder}
          className="jk-match-input"
          aria-label={searchAriaLabel}
        />
        <TButton type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </TButton>
      </form>

      {applied && (
        <p className={cx('muted', 'jk-match-msg')}>
          Applied "{applied.candidate.title}".
          {resultNote?.(applied.result)}
        </p>
      )}
      {applyError && <p className="muted jk-match-msg">{applyError}</p>}
      {status === 'error' && <p className="muted jk-match-msg">{searchErrorText}</p>}
      {status === 'idle' && candidates && candidates.length === 0 && (
        <p className="muted jk-match-msg">
          {noResultsText ? noResultsText(term) : `No matches for "${term}".`}
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="jk-match-candidates">
          {candidates.map((c) => (
            <li key={c.id} className="jk-match-candidate">
              {c.cover ? (
                <img src={c.cover} alt="" className="jk-match-candidate-cover" />
              ) : (
                <div className="jk-match-candidate-cover jk-match-candidate-cover-placeholder" aria-hidden="true" />
              )}
              <div className="jk-match-candidate-info">
                <div className="jk-match-candidate-title">{c.title}</div>
                <div className="muted jk-match-candidate-meta">
                  {[c.author, c.year, c.genre].filter(Boolean).join(' · ') || '—'}
                </div>
                {c.description && (
                  <p className="jk-match-candidate-desc">{truncate(c.description, descriptionMaxLength)}</p>
                )}
              </div>
              <TButton
                className="jk-match-candidate-apply"
                disabled={applyingId != null}
                onClick={() => applyCandidate(c)}
              >
                {applyingId === c.id ? 'Applying…' : 'Apply'}
              </TButton>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
