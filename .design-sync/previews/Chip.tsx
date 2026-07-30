import { Chip, Press, Lab } from '@jkos/ui';
import { Faces } from './_faces';

/* `.jk-chip` is a SURFACE, not a finished control: hub.css gives it the fill,
   radius and mode-gated shadow, and nothing else. Layout, padding and the type
   face come from the call site — exactly as `cardSurface()`'s docstring says
   ("Add layout (position / padding / size) and a pressed-type title at the call
   site"), and exactly as TaskChip / TimeBlock / AllDayBar do it.
 *
 * Rendering a bare <Chip> with no box makes it read as a highlighted run of
 * text rather than a chip, which is not the house look. `box()` below is the
 * kit's own recipe: IBM Plex Sans at the chip sizes, the kit's padding ladder,
 * single-line with an ellipsis. */
const FONT_BODY = 'var(--hub-font-sans)';

const box = (size: 'sm' | 'md' = 'md'): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: size === 'md' ? 6 : 5,
  padding: size === 'md' ? '5px 8px' : '2px 6px',
  fontFamily: FONT_BODY,
  fontSize: size === 'md' ? 11.5 : 10.5,
  maxWidth: 220,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const stack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 18px',
  alignItems: 'flex-start',
};

const TEAL = '#4ecdc4';
const AMBER = '#b8860b';
const PLUM = '#8a2060';

/** The two skins. `solid` (default) is the saturated tab and takes a cream
 *  knockout title (`<Press variant="rev">`); `solid={false}` is the faint raised
 *  base and takes a neutral-ink title (`<Press variant="ink">` at the same tint). */
export const Skins = () => (
  <Faces height={230}>
    <div style={stack}>
      <Lab size="xs">solid · the default</Lab>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Chip tint={TEAL} style={box()}>
          <Press variant="rev">Design sync</Press>
        </Chip>
        <Chip tint={PLUM} style={box()}>
          <Press variant="rev">Wave planning</Press>
        </Chip>
      </div>
      <Lab size="xs" style={{ marginTop: 4 }}>
        faint · the raised base
      </Lab>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Chip solid={false} tint={TEAL} style={box()}>
          <Press variant="ink" tint={TEAL}>
            Design sync
          </Press>
        </Chip>
        <Chip solid={false} tint={AMBER} style={box()}>
          <Press variant="ink" tint={AMBER}>
            Token parity
          </Press>
        </Chip>
      </div>
    </div>
  </Faces>
);

/** The clock-derived state ladder. Don't pick these per call site —
 *  `chipState(item, now)` decides, so a chip carries the same weight in every
 *  view that renders it. */
export const States = () => (
  <Faces height={230}>
    <div style={{ ...stack, gap: 10 }}>
      {[
        ['upcoming', {}],
        ['live', { live: true }],
        ['spent — ended, never struck off', { spent: true }],
        ['done', { done: true }],
      ].map(([label, props]) => (
        <div key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Lab size="xs" style={{ width: 200 }}>
            {label}
          </Lab>
          <Chip tint={TEAL} style={box()} {...(props as object)}>
            <Press variant="rev">Deploy window</Press>
          </Chip>
        </div>
      ))}
    </div>
  </Faces>
);
