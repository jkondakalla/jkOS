import { Well, Lab, Sub, Bar } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 };

/** The inset accent-tinted region — debossed on paper, emissive on the tube.
 *  Defaults to a `<span>`; pass `as="div"` for a block region. */
export const Default = () => (
  <Faces height={200}>
    <div style={pad}>
      <Well as="div" style={{ padding: '14px 16px', maxWidth: 340 }}>
        <Lab size="xs">This week</Lab>
        <div style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 22, marginTop: 6 }}>16</div>
        <Sub>schedules across seven days</Sub>
      </Well>
    </div>
  </Faces>
);

/** Boxed tabs — the well used as the nav face, because the fill IS the face. */
export const AsTabs = () => (
  <Faces height={200}>
    <div style={pad}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['Today', 'Week', 'Calendar', 'Workshop'].map((t, i) => (
          <Well
            as="button"
            key={t}
            type="button"
            style={{
              padding: '7px 14px',
              fontFamily: 'var(--hub-font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity: i === 1 ? 1 : 0.62,
            }}
          >
            {t}
          </Well>
        ))}
      </div>
    </div>
  </Faces>
);
