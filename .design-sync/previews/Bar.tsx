import { Bar, Lab, Sub, Well } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400 };

/** The progress meter — a `.bar-track` well with a tint-deepened fill.
 *  `value` is 0–1 and clamps. */
export const Values = () => (
  <Faces height={260}>
    <div style={pad}>
      {[0, 0.25, 0.6, 1].map((v) => (
        <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Lab size="xs" style={{ width: 46 }}>
            {Math.round(v * 100)}%
          </Lab>
          <Bar value={v} style={{ flex: 1 }} />
        </div>
      ))}
    </div>
  </Faces>
);

/** `tint` deepens the gradient toward --bar-deepen-ink in an arbitrary hue —
 *  so a per-goal meter deepens exactly like the amber family does. */
export const PerGoal = () => (
  <Faces height={260}>
    <div style={{ ...pad, gap: 12 }}>
      <Lab size="xs">Goal progress</Lab>
      {[
        ['Suite consolidation', '#4ecdc4', 0.72],
        ['Full Press rollout', '#b8860b', 0.44],
        ['Infra hardening', '#8a2060', 0.9],
      ].map(([label, tint, v]) => (
        <Well as="div" key={String(label)} tint={String(tint)} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--hub-font-serif)', fontSize: 13 }}>{label}</span>
            <Sub>{Math.round(Number(v) * 100)}%</Sub>
          </div>
          <Bar value={Number(v)} tint={String(tint)} height={6} />
        </Well>
      ))}
    </div>
  </Faces>
);
