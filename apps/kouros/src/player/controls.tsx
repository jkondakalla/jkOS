// player/controls.tsx — the music-only stock controls @jkos/player/ui doesn't ship
// (ToDo.md §3 Wave 18, item 18.4). musicPlayer()'s factory composition
// (@jkos/player/factory) derives ControlIds 'shuffle' | 'trackPrev' | 'trackNext' |
// 'repeat' | 'volume' | 'queue' — but @jkos/player/ui's controls.tsx only stocks the
// audiobook vocabulary (SegmentButton/SkipButton/RateButton/SleepMenu). Per this
// wave's ownership rule (packages/player is under papyros's zero-behavior-change
// contract — no edits), every one of those six control ids gets its REAL part built
// here, in app code, reusing the kit's `pb-*` CSS classes (player-ui.css ships with
// @jkos/player/ui, already imported by PlayerBar.tsx) so they read as first-class
// siblings of PlayPauseButton, not bolted-on. See this wave's report for the verdict
// on why these six didn't already exist.
import { cx } from '@jkos/ui';
import type { Queue, RepeatMode } from '@jkos/player/core';
import { QueuePanel, IconPrev, IconNext } from '@jkos/player/ui';
import type { Track } from './api';
import { IconQueue, IconRepeat, IconRepeatOne, IconShuffle, IconVolume, IconVolumeMute } from './icons';

/* ── Shuffle toggle ────────────────────────────────────────────────────────────── */

export function ShuffleButton({ active, onToggle }: { active: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      className={cx('pb-btn', active && 'is-armed')}
      title={active ? 'Shuffle on' : 'Shuffle off'}
      aria-label="Shuffle"
      aria-pressed={active}
      onClick={() => onToggle(!active)}
    >
      <IconShuffle />
    </button>
  );
}

/* ── Repeat cycle (off → all → one → off) ─────────────────────────────────────── */

export function RepeatButton({ mode, onCycle }: { mode: RepeatMode; onCycle: () => void }) {
  const label = mode === 'one' ? 'Repeat one' : mode === 'all' ? 'Repeat all' : 'Repeat off';
  return (
    <button
      className={cx('pb-btn', mode !== 'off' && 'is-armed')}
      title={label}
      aria-label={label}
      aria-pressed={mode !== 'off'}
      onClick={onCycle}
    >
      {mode === 'one' ? <IconRepeatOne /> : <IconRepeat />}
    </button>
  );
}

/* ── Prev/next TRACK (queue nav — walks the Queue, not a Timeline's segments) ──── */

export function TrackNavButton({ dir, onClick, disabled }: { dir: 'prev' | 'next'; onClick: () => void; disabled?: boolean }) {
  const label = dir === 'prev' ? 'Previous track' : 'Next track';
  return (
    <button className="pb-btn" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {dir === 'prev' ? <IconPrev /> : <IconNext />}
    </button>
  );
}

/* ── Volume + mute ─────────────────────────────────────────────────────────────── */

export function VolumeControl({
  volume, muted, onChange, onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onChange: (level: number) => void;
  onToggleMute: () => void;
}) {
  const silent = muted || volume <= 0;
  return (
    <div className="pb-volume">
      <button
        className="pb-btn"
        title={silent ? 'Unmute' : 'Mute'}
        aria-label={silent ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        onClick={onToggleMute}
      >
        {silent ? <IconVolumeMute /> : <IconVolume />}
      </button>
      <input
        className="pb-range pb-volume-range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        aria-label="Volume"
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}

/* ── Crossfade knob (18.5) — lives inside the queue popover (the bar's "more" area
   for queue-shaped settings). 0 = gapless; 1–12 s = crossfade. Drives the adapter's
   setCrossfade, which clamps + persists (queuePrefs) + applies to the gaplessDual
   backend live. ────────────────────────────────────────────────────────────────── */

export function CrossfadeControl({ seconds, onChange }: { seconds: number; onChange: (sec: number) => void }) {
  return (
    <label className="pb-crossfade">
      <span className="pb-crossfade-label">Crossfade</span>
      <input
        className="pb-range pb-crossfade-range"
        type="range"
        min={0}
        max={12}
        step={1}
        value={seconds}
        aria-label="Crossfade seconds (0 is gapless)"
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <span className="pb-crossfade-value">{seconds === 0 ? 'Off' : `${seconds}s`}</span>
    </label>
  );
}

/* ── Queue opener + panel (wraps the kit's <QueuePanel> in the pb-menu/pb-popover
   framework, same shape as papyros PlayerBar's bookmarksBtn) ──────────────────── */

export function QueueMenu({
  queue, tracksById, open, onOpenChange, onPlayItem, onRemove, onReorder, mobile,
  crossfadeSec, onCrossfadeChange,
}: {
  queue: Queue;
  tracksById: ReadonlyMap<number, Track>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlayItem: (index: number) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  mobile: boolean;
  crossfadeSec: number;
  onCrossfadeChange: (sec: number) => void;
}) {
  return (
    <div className="pb-menu">
      <button
        className="pb-btn pb-btn-wide"
        title="Up next"
        aria-label="Up next"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <IconQueue />
        {queue.items.length > 0 && <span className="pb-count">{queue.items.length}</span>}
      </button>
      {open && (
        <div className={cx('pb-popover', 'pb-popover-wide', mobile && 'is-sheet')} role="menu">
          <div className="pb-popover-head">Up next</div>
          <QueuePanel
            queue={queue}
            labelOf={(id) => {
              const t = tracksById.get(Number(id));
              return t ? `${t.title} — ${t.artist || 'Unknown artist'}` : `Track ${id}`;
            }}
            onPlayItem={(i) => onPlayItem(i)}
            onRemove={(i) => onRemove(i)}
            onReorder={onReorder}
          />
          <CrossfadeControl seconds={crossfadeSec} onChange={onCrossfadeChange} />
        </div>
      )}
    </div>
  );
}
