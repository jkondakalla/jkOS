import { Rule, Lab, Sub } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '18px 24px', maxWidth: 420 };

/** The rules ladder — hairline for rows, strong for chapter heads, double for
 *  the contents block and the colophon. */
export const Weights = () => (
  <Faces height={240}>
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Lab size="xs">hairline · rows, exhibits</Lab>
      <Rule />
      <Lab size="xs" style={{ marginTop: 14 }}>
        strong · chapter heads
      </Lab>
      <Rule weight="strong" />
      <Lab size="xs" style={{ marginTop: 14 }}>
        double · contents, colophon
      </Lab>
      <Rule weight="double" />
    </div>
  </Faces>
);

/** How the ladder actually structures a sheet — the reason there are three. */
export const InSheet = () => (
  <Faces height={240}>
    <div style={pad}>
      <Lab size="sm">Week 31</Lab>
      <Rule weight="strong" />
      <div style={{ margin: '12px 0' }}>
        {['Draft the rollout dossier', 'Review the token parity gate', 'Cut the staging release'].map(
          (t, i, a) => (
            <div key={t}>
              <div style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 14, padding: '8px 0' }}>{t}</div>
              {i < a.length - 1 && <Rule />}
            </div>
          ),
        )}
      </div>
      <Rule weight="double" />
      <Sub>3 of 16 · the rest are on the bench</Sub>
    </div>
  </Faces>
);
