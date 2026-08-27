// SegmentList.tsx — chapter/marker list with the current row highlighted and
// click-to-seek (git history: Wave 16 item 16.6). Row anatomy is papyros
// BookDetail's chapter-row generalized: an absolutely-positioned listened-fill wash
// (width from ./scrub's segmentFraction — chapterFraction promoted), then index /
// title / duration raised above it. Clicking a row seeks to the segment's start in
// GLOBAL seconds.
import type { ReactNode } from 'react';
import { cx } from '@jkos/ui';
import { fmtClock } from '../core/timeline';
import type { NavPoint } from '../core/timeline';
import { segmentFraction } from './scrub';

export interface SegmentListProps {
  /** Segment spans (core/navPoints output — gap-free, sorted). */
  points: readonly NavPoint[];
  /** Index of the segment currently playing (engine `currentIndex`); -1 for none. */
  currentIndex?: number;
  /** Live playhead in global seconds — drives the per-row listened fill. Omit to
   *  render rows without fills. */
  position?: number;
  onSeek?: (globalSec: number) => void;
  /** Row title override. Default: the point's title, else "Segment N". */
  labelOf?: (point: NavPoint, index: number) => ReactNode;
  formatTime?: (sec: number) => string;
}

export function SegmentList({
  points,
  currentIndex = -1,
  position,
  onSeek,
  labelOf,
  formatTime = fmtClock,
}: SegmentListProps) {
  return (
    <ol className="pb-seglist">
      {points.map((pt, i) => (
        <li key={i}>
          <button
            type="button"
            className={cx('pb-seg-row', i === currentIndex && 'is-current')}
            aria-current={i === currentIndex ? 'true' : undefined}
            onClick={() => onSeek?.(pt.start)}
          >
            {position != null && (
              <span
                className="pb-seg-fill"
                style={{ width: `${segmentFraction(pt.start, pt.end, position) * 100}%` }}
                aria-hidden="true"
              />
            )}
            <span className="pb-seg-index">{i + 1}</span>
            <span className="pb-seg-title">{labelOf ? labelOf(pt, i) : (pt.title || `Segment ${i + 1}`)}</span>
            <span className="pb-seg-time">{formatTime(pt.end - pt.start)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
