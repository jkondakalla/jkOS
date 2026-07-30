import { Checkbox, Eyebrow } from '@jkos/ui';
import { Faces } from './_faces';

/* The calendar kit's own checkbox — distinct from @jkos/ui's <Check>. It is
   keyed by item `id` (which it passes back to onToggle) and sized in px, because
   it has to sit inside chips as small as a calendar cell. */
const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 16 };

/** Open and struck off. */
export const States = () => (
  <Faces height={130}>
    <div style={pad}>
      <div style={row}>
        <Checkbox id={1} completed={false} />
        <Checkbox id={2} completed />
      </div>
    </div>
  </Faces>
);

/** `color` carries the item's own hue into the checked fill. */
export const Tinted = () => (
  <Faces height={130}>
    <div style={pad}>
      <div style={row}>
        {['#4ecdc4', '#b8860b', '#8a2060', '#2a7040', '#b42010'].map((c) => (
          <Checkbox key={c} id={1} completed color={c} />
        ))}
      </div>
    </div>
  </Faces>
);
