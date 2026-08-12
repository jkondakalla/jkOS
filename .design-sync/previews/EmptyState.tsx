import { EmptyState, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px' };

/** The print idiom for nothing-here: an italic Fraunces line over a mono sub.
 *  The component owns the TREATMENT; the copy is a prop, so each view still
 *  speaks in its own voice.
 *
 *  NOT for the calendar bodies. Day/Week/Month used to float one of these over
 *  an empty grid ("A clean week…", "Nothing set for this day.") and it read as
 *  debris on top of a surface that was already saying the same thing by being
 *  empty. Removed 2026-08-12. Reach for this where there is no drawn structure
 *  to carry the message — a list pane, a results panel — not over a grid. */
export const Default = () => (
  <Faces height={230}>
    <div style={pad}>
      <EmptyState
        line="No results for that search."
        sub="Try a shorter term"
      />
    </div>
  </Faces>
);

/** Each view supplies its own words — the same treatment, three voices. */
export const Voices = () => (
  <Faces height={230}>
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <EmptyState line="No sources connected." sub="Add one to start pulling items" />
      <Rule />
      <EmptyState line="No goals adrift." sub="Every active goal has a next action" />
      <Rule />
      <EmptyState line="Nothing on the bench." sub="Workshop · this week" />
    </div>
  </Faces>
);
