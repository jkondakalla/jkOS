// controls.tsx — the STOCK control library (ToDo.md §3 Wave 16, item 16.6): exactly
// the control vocabulary papyros's bar renders today, as individual kit parts. Each
// control consumes a PlayerApi-SHAPED prop — a minimal structural slice of
// engine/types' PlayerApi (playing/toggle, skip, prevSegment/nextSegment, rate/
// cycleRate, sleepMode/setSleep) — so the engine's returned surface satisfies every
// `api` prop directly, and an adapter with renamed methods (papyros's prevChapter)
// bridges with a one-line object literal. Markup + classes are byte-identical to the
// papyros originals: swapping one of these in IS the zero-visual-change migration.
//
// Deliberately NOT dependencies here: engine/** (these are shape-typed, so the
// concurrent engine work — e.g. volume/mute — can land without touching this file).
import { useState, type ReactNode } from 'react';
import { cx } from '@jkos/ui';
import { fmtClock } from '../core/timeline';
import { formatRate } from './scrub';
import { IconMoon, IconNext, IconPause, IconPlay, IconPrev, IconSkipArrow, IconSpinner } from './icons';

/* ── Layout wrappers ────────────────────────────────────────────────────────── */

/** The transport button cluster — papyros's `.pb-transport` div (`compact` is the
 *  mobile row's tighter spacing). */
export function Transport({ compact = false, children }: { compact?: boolean; children: ReactNode }) {
  return <div className={cx('pb-transport', compact && 'pb-transport-compact')}>{children}</div>;
}

/** The transparent full-viewport click-catcher behind an open popover. The BAR owns
 *  one of these across all its menus (opening one closes the others), so it stays a
 *  standalone part rather than living inside <SleepMenu>. */
export function PlayerScrim({ onDismiss }: { onDismiss: () => void }) {
  return <div className="pb-scrim" onClick={onDismiss} aria-hidden="true" />;
}

/* ── Play / pause ───────────────────────────────────────────────────────────── */

export interface PlayToggleApi {
  playing: boolean;
  buffering: boolean;
  toggle(): void;
}

/** The primary circular play/pause toggle, spinner while buffering-to-start. */
export function PlayPauseButton({ api, playLabel = 'Play', pauseLabel = 'Pause' }: {
  api: PlayToggleApi;
  playLabel?: string;
  pauseLabel?: string;
}) {
  const label = api.playing ? pauseLabel : playLabel;
  return (
    <button className="pb-btn pb-btn-primary" title={label} aria-label={label} onClick={api.toggle}>
      {api.buffering && !api.playing ? <IconSpinner /> : api.playing ? <IconPause /> : <IconPlay />}
    </button>
  );
}

/* ── Relative skip (±N seconds) ─────────────────────────────────────────────── */

export interface SkipApi {
  skip(deltaSec: number): void;
}

/** Skip ±`seconds` — negative is back. The glyph prints |seconds| in its bowl. */
export function SkipButton({ api, seconds, label }: {
  api: SkipApi;
  seconds: number;
  label?: string;
}) {
  const magnitude = Math.abs(seconds);
  const text = label ?? (seconds < 0 ? `Back ${magnitude} seconds` : `Forward ${magnitude} seconds`);
  return (
    <button className="pb-btn" title={text} aria-label={text} onClick={() => api.skip(seconds)}>
      <IconSkipArrow dir={seconds < 0 ? 'back' : 'fwd'} seconds={magnitude} />
    </button>
  );
}

/* ── Prev / next segment ────────────────────────────────────────────────────── */

export interface SegmentNavApi {
  prevSegment(): void;
  nextSegment(): void;
}

/** Previous/next segment (papyros labels it "chapter" via the `label` override). */
export function SegmentButton({ api, dir, label }: {
  api: SegmentNavApi;
  dir: 'prev' | 'next';
  label?: string;
}) {
  const text = label ?? (dir === 'prev' ? 'Previous segment' : 'Next segment');
  return (
    <button className="pb-btn" title={text} aria-label={text} onClick={dir === 'prev' ? api.prevSegment : api.nextSegment}>
      {dir === 'prev' ? <IconPrev /> : <IconNext />}
    </button>
  );
}

/* ── Playback rate ──────────────────────────────────────────────────────────── */

export interface RateApi {
  rate: number;
  cycleRate(): void;
}

/** Rate cycler — its face is the current rate ('1×' / '1.25×'). */
export function RateButton({ api, label = 'Playback speed' }: { api: RateApi; label?: string }) {
  return (
    <button className="pb-btn pb-btn-wide" title={label} aria-label={label} onClick={api.cycleRate}>
      {formatRate(api.rate)}
    </button>
  );
}

/* ── Sleep timer menu ───────────────────────────────────────────────────────── */

/** Generic over the app's mode vocabulary: the engine speaks 'segment', papyros's
 *  adapter relabels it 'chapter' — the menu never interprets a mode beyond
 *  `!== offMode` (armed) and equality (the active row). */
export interface SleepApi<M extends string = string> {
  sleepMode: M;
  sleepRemainingMs: number | null;
  setSleep(mode: M): void;
}

export interface SleepMenuProps<M extends string> {
  api: SleepApi<M>;
  options: ReadonlyArray<{ mode: M; label: string }>;
  /** The disarmed mode (no armed badge, no active-dot when closed). Default 'off'. */
  offMode?: M;
  /** Button tooltip/aria + popover heading. */
  label?: string;
  /** Armed badge text. Default reproduces papyros's sleepLabel: 'CH' for the
   *  end-of-segment mode, else the remaining time as a clock. */
  armedLabel?: (mode: M, remainingMs: number | null) => string;
  /** Controlled open state (the bar coordinates its menus); omit both to let the
   *  menu own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the popover as a full-width mobile sheet. */
  sheet?: boolean;
}

function defaultArmedLabel(mode: string, remainingMs: number | null): string {
  // papyros's sleepLabel verbatim, plus the engine's generalized mode name.
  if (mode === 'chapter' || mode === 'segment') return 'CH';
  if (remainingMs != null) return fmtClock(remainingMs / 1000);
  return '';
}

export function SleepMenu<M extends string>({
  api,
  options,
  offMode = 'off' as M,
  label = 'Sleep timer',
  armedLabel = defaultArmedLabel,
  open,
  onOpenChange,
  sheet = false,
}: SleepMenuProps<M>) {
  const [selfOpen, setSelfOpen] = useState(false);
  const isOpen = open ?? selfOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    if (open === undefined) setSelfOpen(next);
  };
  const armed = api.sleepMode !== offMode;
  return (
    <div className="pb-menu">
      <button
        className={cx('pb-btn', 'pb-btn-wide', armed && 'is-armed')}
        title={label}
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        <IconMoon />
        {armed && <span className="pb-armed">{armedLabel(api.sleepMode, api.sleepRemainingMs)}</span>}
      </button>
      {isOpen && (
        <div className={cx('pb-popover', sheet && 'is-sheet')} role="menu">
          <div className="pb-popover-head">{label}</div>
          {options.map((o) => (
            <button
              key={o.mode}
              className={cx('pb-popover-row', api.sleepMode === o.mode && 'is-active')}
              role="menuitemradio"
              aria-checked={api.sleepMode === o.mode}
              onClick={() => { api.setSleep(o.mode); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
