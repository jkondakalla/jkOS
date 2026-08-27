// WV-7: this barrel is the package's PUBLIC surface, and it is deliberately
// smaller than the package. An export nothing imports is worse than a missing
// one for a fresh agent — it reads as supported API, so it gets built on, and
// then it has to keep working. Everything trimmed below is still present as a
// file and still used INTERNALLY (mostly by <Calendar>); what changed is that
// the package stops advertising it.
//
// `useCalendarSource` was deleted outright: it had no consumer anywhere, inside
// the package or out — its only surviving mentions were two comments describing
// how you would use it.
// @jkos/cards — shared calendar card kit (BeigeBoard tabs + ORDECK widgets).
export * from './types';
export * from './datetime';
export { cardSurface } from './surface';
export type { CardVariant, CardSurface, CardSurfaceOpts } from './surface';
export { FONT_HEAD, FONT_BODY, FONT_NUM, DEFAULT_RESOLVERS, mergeResolvers } from './theme';
export * from './constants';
export { TaskChip } from './TaskChip';
export type { TaskChipProps, ChipSize } from './TaskChip';
export { TimeBlock } from './TimeBlock';
export type { TimeBlockProps } from './TimeBlock';
export { CardFrame } from './CardFrame';
export type { CardFrameProps } from './CardFrame';
export { Checkbox, Eyebrow, RecLamp, ChromeBar, NowLine, HourLabel } from './primitives';
export { WeekView } from './WeekView';
export { CalendarView } from './CalendarView';
export { DayView } from './DayView';
export { Calendar } from './Calendar';
export { CalendarDragProvider, useCalendarDrag } from './CalendarDragProvider';
export type { CalendarDragProviderProps } from './CalendarDragProvider';
