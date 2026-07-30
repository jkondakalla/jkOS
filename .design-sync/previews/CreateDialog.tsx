import { CreateDialog } from '@jkos/ui';
import { Faces } from './_faces';

/* The quick-add modal the grids raise after a user drags out a slot. It renders
   position: fixed with its own scrim, so the card needs a host that establishes
   a containing block — `transform` does that for fixed descendants, which
   `position: relative` alone does not. */
const host: React.CSSProperties = {
  position: 'relative',
  transform: 'translateZ(0)',
  overflow: 'hidden',
  height: 300,
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--hub-radius-widget)',
  background: 'var(--color-paper-2)',
};

const noop = () => {};

/** A timed slot — the eyebrow names the weekday and the span that was dragged. */
export const TimedSlot = () => (
  <Faces height={280} stacked>
    <div style={host}>
      <CreateDialog
        pending={{ startDay: '2026-07-30', scheduled_time: '13:00', scheduled_end: '14:00' }}
        onSubmit={noop}
        onCancel={noop}
      />
    </div>
  </Faces>
);

/** An all-day slot — `allDay` swaps the eyebrow to the day alone. */
export const AllDaySlot = () => (
  <Faces height={280} stacked>
    <div style={host}>
      <CreateDialog pending={{ startDay: '2026-07-30', allDay: true }} onSubmit={noop} onCancel={noop} />
    </div>
  </Faces>
);
