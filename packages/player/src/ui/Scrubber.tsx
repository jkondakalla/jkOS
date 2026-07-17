// Scrubber.tsx — the segment-aware seek control (ToDo.md §3 Wave 16, item 16.6).
// Generalizes papyros PlayerBar's scrubber: BookDetail's chapterFraction math and
// the bar's chapter-window bracketing both live in ./scrub's segmentWindow, and
// this component is only the range input over whichever window that yields:
//   • mode 'segment' (default, papyros's behavior): the CURRENT segment's timeline —
//     min/max/value are segment-relative, crossing segments is prev/next's job.
//   • mode 'timeline': the whole [0, total] span, with the segment boundaries drawn
//     as ticks over the track (a music/video bar's shape).
// Either way the drag state is held here in GLOBAL seconds (seekTo's unit) and only
// committed on release — identical event set to the papyros original (pointer/mouse/
// touch/key up), so a keyboard nudge seeks exactly once, on keyup.
import { useState } from 'react';
import { Slider } from '@jkos/ui';
import { fmtClock } from '../core/timeline';
import type { NavPoint } from '../core/timeline';
import { segmentWindow } from './scrub';

export interface ScrubberProps {
  /** Live playhead in global seconds. */
  position: number;
  /** Whole-timeline length in seconds. */
  total: number;
  /** Segment spans (core/navPoints output). Omit for a plain whole-span scrubber. */
  points?: readonly NavPoint[];
  /** Index of the current segment (engine `currentIndex`); -1 → whole timeline. */
  currentIndex?: number;
  /** Called on release with the target in GLOBAL seconds. */
  onSeek: (globalSec: number) => void;
  /** 'segment' (default) scrubs within the current segment; 'timeline' scrubs the
   *  whole span with segment-boundary ticks. */
  mode?: 'segment' | 'timeline';
  disabled?: boolean;
  ariaLabel?: string;
  formatTime?: (sec: number) => string;
}

export function Scrubber({
  position,
  total,
  points = [],
  currentIndex = -1,
  onSeek,
  mode = 'segment',
  disabled,
  ariaLabel = 'Seek position',
  formatTime = fmtClock,
}: ScrubberProps) {
  // Uncommitted drag value, GLOBAL seconds — papyros's `scrub` state, moved inside.
  const [scrub, setScrub] = useState<number | null>(null);

  const displayPos = scrub != null ? scrub : Math.min(position, total || position);
  const win = mode === 'segment'
    ? segmentWindow(points, currentIndex, total, displayPos)
    : segmentWindow(points, -1, total, displayPos);
  const commit = () => {
    if (scrub != null) {
      onSeek(scrub);
      setScrub(null);
    }
  };

  const showTicks = mode === 'timeline' && points.length > 1 && total > 0;
  // The suite <Slider> owns the release-commit event set (pointer/mouse/touch/key
  // up) that this file used to wire by hand; `commit` reads the GLOBAL `scrub`
  // state, so the window-relative value it hands back is deliberately ignored.
  const range = (
    <Slider
      min={0}
      max={win.length || 1}
      step={1}
      value={win.pos}
      disabled={disabled ?? total === 0}
      aria-label={ariaLabel}
      onChange={(v) => setScrub(win.start + v)}
      onCommit={commit}
    />
  );

  return (
    <div className="pb-scrubber">
      <span className="pb-time" aria-hidden="true">{formatTime(win.pos)}</span>
      {showTicks ? (
        <div className="pb-range-wrap">
          {range}
          <div className="pb-scrub-ticks" aria-hidden="true">
            {points.slice(1).map((pt, i) => (
              <span key={i} className="pb-scrub-tick" style={{ left: `${(pt.start / total) * 100}%` }} />
            ))}
          </div>
        </div>
      ) : (
        range
      )}
      <span className="pb-time" aria-hidden="true">{formatTime(win.length)}</span>
    </div>
  );
}
