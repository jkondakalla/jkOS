import { EmptyState, Sheet, Lab, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px' };

/** The print idiom for nothing-here: an italic Fraunces line over a mono sub.
 *  The component owns the TREATMENT; the copy is a prop, so each view still
 *  speaks in its own voice. */
export const Default = () => (
  <Faces height={230}>
    <div style={pad}>
      <EmptyState
        line="A clean week. Nothing set in type yet."
        sub="Week 31 · Jul 27 – Aug 2"
      />
    </div>
  </Faces>
);

/** Each view supplies its own words — the same treatment, three voices. */
export const Voices = () => (
  <Faces height={230}>
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <EmptyState line="The day is open." sub="Nothing scheduled · nothing carried" />
      <Rule />
      <EmptyState line="No goals adrift." sub="Every active goal has a next action" />
      <Rule />
      <EmptyState line="Nothing on the bench." sub="Workshop · this week" />
    </div>
  </Faces>
);
