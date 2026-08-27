// PlayerBar.tsx — the SLOTTED SHELL (git history: Wave 16 item 16.6). This is the
// reusable LAYOUT lifted from papyros's bar — the control SET stays the app's:
//
//   desktop (3 columns)                 mobile (compact rows)
//   ┌───────────┬─────────────┬───────┐ ┌─────────────────────────────┐
//   │ meta      │ transport   │actions│ │ scrubber (full width)       │
//   │ (pb-left) │ scrubber    │(right)│ ├──────┬──────────────┬───────┤
//   │           │ (pb-center) │       │ │ meta │mobileTransprt│mobActs│
//   └───────────┴─────────────┴───────┘ └──────┴──────────────┴───────┘
//
// The five slots are exactly the clusters the real papyros markup already had (meta
// / transport / scrubber / right-side buttons, plus its distinct compact transport
// and More-menu on mobile) — nothing invented. Slot CONTENT renders verbatim where
// the original inlined it, so a migrated bar is markup-identical. The breakpoint
// comes from @jkos/ui's useBreakpoint (the suite's one 3-tier source); `is-mobile`
// + data-bp land on the section exactly as before.
//
// Visibility is the CALLER's: papyros returns null until the engine has an item.
// Same for its body-class side effect (reserving scroll space under the fixed bar)
// — that pads an app-owned element, so the shell can't own it.
import type { ReactNode } from 'react';
import { cx, useBreakpoint } from '@jkos/ui';

export interface PlayerBarProps {
  /** Now-playing meta (e.g. <NowPlaying/>). Desktop left column; mobile row start. */
  meta?: ReactNode;
  /** Transport cluster (e.g. <Transport>…stock buttons…</Transport>). */
  transport?: ReactNode;
  /** Seek control (e.g. <Scrubber/>). Desktop under the transport; mobile full-width top. */
  scrubber?: ReactNode;
  /** Right-side controls (rate/sleep/bookmarks…). Desktop right column. */
  actions?: ReactNode;
  /** Mobile transport override (papyros renders a tighter 3-button set). Falls back
   *  to `transport`. */
  mobileTransport?: ReactNode;
  /** Mobile actions override (papyros collapses actions into a More menu). Falls
   *  back to `actions`. */
  mobileActions?: ReactNode;
  /** Error strip above the bar (falsy → none), papyros's pb-error verbatim. */
  error?: ReactNode;
  /** aria-label for the bar region. */
  label?: string;
  className?: string;
}

export function PlayerBar({
  meta,
  transport,
  scrubber,
  actions,
  mobileTransport,
  mobileActions,
  error,
  label = 'Now playing',
  className,
}: PlayerBarProps) {
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  return (
    <section className={cx('player-bar', mobile && 'is-mobile', className)} data-bp={bp} aria-label={label}>
      {error ? <div className="pb-error" role="alert">{error}</div> : null}
      {mobile ? (
        <>
          {scrubber}
          <div className="pb-row">
            {meta}
            {mobileTransport ?? transport}
            {mobileActions ?? actions}
          </div>
        </>
      ) : (
        <>
          <div className="pb-left">{meta}</div>
          <div className="pb-center">
            {transport}
            {scrubber}
          </div>
          <div className="pb-right">{actions}</div>
        </>
      )}
    </section>
  );
}
