import type { ReactNode } from 'react';
import { cx } from './primitives';

/* ─────────────────────────────────────────────────────────────────────────────
   @jkos/ui — <AsyncView> (git history: Wave 20 item 20.3)

   The loading/error/empty triad, hand-rolled three different ways in PapyrOS:
     - Library.tsx     — a 3-way ternary (loading ? … : error ? … : sorted.length
                          === 0 ? … : <the real grid>), ALL through a local
                          `.muted` paragraph class.
     - BookDetail.tsx  — two independent `&&` guards (`error && …`, `!error &&
                          !book && …`) ahead of the `book && (…)` ready block,
                          same `.muted` class, terser copy ("Loading…" vs
                          "Loading books…", no "try again" on the error line).
     - OfflineSettings.tsx — only ever hits the EMPTY leg (no fetch of its own,
                          so no loading/error), through its own `.offline-empty`
                          class rather than `.muted`.

   Same shape, three copy conventions, two different CSS classes. This unifies
   both: one component, one `.jk-async-note` class (hub.css), and a single
   priority order — loading, then error, then empty, then `children` — derived
   from what Library.tsx's ternary already encoded. BookDetail's two `&&`
   guards fold into the same order with no behaviour change: its `loading`
   value (`!error && !book`) already implies "not error", so checking loading
   before error is equivalent to BookDetail's original error-before-loading
   order for every reachable state.

   Copy is a prop, not a hardcoded string — each call site keeps its own
   contextual noun ("the library" / "this book" / downloads), because THAT
   part of the copy carries real information and shouldn't be flattened. Only
   the generic filler (the bare loading word, and the "try again" error
   suffix) gets unified; see the wave report for the exact deltas.

   No retry/reload affordance here: none of the three call sites has one tied
   to the error branch specifically (Library's Rescan button is an always-
   visible admin action, not an error-state retry) — scope stays at the triad
   itself, per the item's ask. */

export interface AsyncViewProps {
  /** True while the underlying fetch is in flight. Takes priority over
   *  `error`/`empty` — a re-fetch (e.g. Library's `reloadKey` bump) should
   *  show the loading state even while a previous request is still errored
   *  or came back empty. */
  loading?: boolean;
  /** True when the fetch failed. Checked after `loading`. */
  error?: boolean;
  /** True when the fetch succeeded but produced nothing to show. Checked
   *  last, so a plain `list.length === 0` can be passed unguarded. */
  empty?: boolean;
  /** Loading copy. Defaults to the house-generic "Loading…". */
  loadingText?: ReactNode;
  /** Error copy. Defaults to a generic fallback — every current call site
   *  overrides this with its own contextual noun ("Could not load the
   *  library.", "Could not load this book."). */
  errorText?: ReactNode;
  /** Empty-state copy. Defaults to a generic fallback — every current call
   *  site overrides this; it is the one piece of copy that SHOULD differ per
   *  view (there is no useful generic "nothing here" message). */
  emptyText?: ReactNode;
  /** Extra class(es) on the rendered state `<p>` (ignored once `children`
   *  renders — the ready state is the caller's own markup). */
  className?: string;
  /** The ready-state content, rendered once none of loading/error/empty apply. */
  children: ReactNode;
}

export function AsyncView({
  loading,
  error,
  empty,
  loadingText = 'Loading…',
  errorText = 'Something went wrong. Try again shortly.',
  emptyText = 'Nothing to show yet.',
  className,
  children,
}: AsyncViewProps) {
  if (loading) {
    return <p className={cx('jk-async-note', className)}>{loadingText}</p>;
  }
  if (error) {
    return <p className={cx('jk-async-note', 'jk-async-error', className)}>{errorText}</p>;
  }
  if (empty) {
    return <p className={cx('jk-async-note', className)}>{emptyText}</p>;
  }
  return <>{children}</>;
}
