import { Lab, Sheet, Rule } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };

/** The three rungs of the label ladder — uppercase mono, tracked out. */
export const Sizes = () => (
  <Faces height={180}>
    <div style={pad}>
      <Lab>Section heading</Lab>
      <Lab size="sm">Panel label</Lab>
      <Lab size="xs">Field label</Lab>
    </div>
  </Faces>
);

/** How a label actually sits above the content it names. */
export const InContext = () => (
  <Faces height={180}>
    <div style={{ padding: '18px 20px' }}>
      <Sheet style={{ padding: '16px 18px', maxWidth: 380 }}>
        <Lab size="sm">This week</Lab>
        <Rule />
        <p
          style={{
            fontFamily: 'var(--hub-font-serif)',
            fontSize: 14,
            lineHeight: 1.6,
            margin: '10px 0 0',
            color: 'var(--color-ink)',
          }}
        >
          Sixteen schedules across seven days. Six of them are still on the bench.
        </p>
      </Sheet>
    </div>
  </Faces>
);
