/**
 * Calendar — the headless primitive entry point.
 *
 * `<Calendar view='day'|'week'|'month'|'year' … />` renders the active view BODY
 * and nothing else: no title, no prev/next, no view switcher. The host owns that
 * chrome and the data/drag wiring (pass `items` + onAdd/onUpdate/onToggle, plus an
 * optional `drag` adapter and `resolvers`). This is the single seam an app snaps a
 * calendar onto — typically `<Calendar {...useCalendarSource(app)} drag={…} />`.
 */

import type { CalendarProps } from './types';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { CalendarView } from './CalendarView';
import { YearView } from './YearView';

export function Calendar({ view, dayMode, ...props }: CalendarProps) {
  switch (view) {
    case 'day':
      return <DayView mode={dayMode} {...props} />;
    case 'month':
      return <CalendarView {...props} />;
    case 'year':
      return <YearView {...props} />;
    case 'week':
    default:
      return <WeekView {...props} />;
  }
}
