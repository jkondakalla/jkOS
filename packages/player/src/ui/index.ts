// @jkos/player/ui — Layer 3, the kit of parts (ToDo.md §3 Wave 16, item 16.6; see
// Documentation/PLAYER_PARITY.md §3 "Layer 3 — UI kit"). A slotted <PlayerBar>
// shell + the stock control library + <Scrubber>/<QueuePanel>/<NowPlaying>/
// <SegmentList>, all pb-*-classed and token-driven. Item 16.7's createPlayer(spec)
// factory composes THESE parts into presets — this barrel is deliberately
// factory-free.
//
// The kit's stylesheet ships with the barrel (side-effect import, bundled by the
// consuming app's vite build — the same source-only packaging the rest of the
// suite's packages use).
import './player-ui.css';

export { PlayerBar } from './PlayerBar';
export type { PlayerBarProps } from './PlayerBar';
export {
  Transport, PlayerScrim,
  PlayPauseButton, SkipButton, SegmentButton, RateButton, SleepMenu,
} from './controls';
export type {
  PlayToggleApi, SkipApi, SegmentNavApi, RateApi, SleepApi, SleepMenuProps,
} from './controls';
export { Scrubber } from './Scrubber';
export type { ScrubberProps } from './Scrubber';
export { NowPlaying, CoverArt } from './NowPlaying';
export type { NowPlayingProps } from './NowPlaying';
export { QueuePanel } from './QueuePanel';
export type { QueuePanelProps } from './QueuePanel';
export { SegmentList } from './SegmentList';
export type { SegmentListProps } from './SegmentList';
export { segmentFraction, segmentWindow, formatRate, insertionSlot, reorderTarget } from './scrub';
export type { ScrubWindow, RowSpan } from './scrub';
export {
  IconPlay, IconPause, IconSpinner, IconSkipArrow, IconPrev, IconNext,
  IconMoon, IconClose, IconGrip, IconArtwork,
} from './icons';
