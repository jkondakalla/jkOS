import { useMemo } from 'react';
import { useTick } from '../../components/hardware';

export function MemMapWidget() {
  const tick = useTick(700);
  const cells = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 256; i++) {
      arr.push((Math.sin((i + tick * 4) * 0.07) + 1) / 2);
    }
    return arr;
  }, [tick]);

  const activeCount = cells.filter(c => c > 0.5).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '0 10px',
        height: 'var(--hub-bus-h, 28px)',
        background: 'var(--hub-bg-2)',
        borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: 'var(--hub-amber)', letterSpacing: '0.15em', fontWeight: 600, fontSize: 10 }} className="glow-dim">
          MEM-MAP · 0x0000
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>{activeCount}/256</span>
      </div>
      <div style={{
        flex: 1, padding: 10, background: 'var(--hub-bg-0)',
        display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)',
        gap: 2, gridAutoRows: '1fr',
        alignContent: 'stretch',
      }}>
        {cells.map((v, i) => (
          <div key={i} style={{
            background: v > 0.85
              ? 'var(--hub-amber)'
              : v > 0.55
                ? 'var(--hub-amber-dim)'
                : v > 0.25
                  ? 'var(--hub-amber-deep)'
                  : '#1a1612',
            boxShadow: v > 0.85 ? '0 0 4px var(--hub-amber-glow)' : 'none',
          }} />
        ))}
      </div>
      <div style={{
        padding: '4px 10px',
        borderTop: '1px solid var(--hub-line)',
        fontSize: 8, color: 'var(--hub-cream-faint)',
        letterSpacing: '0.15em',
        display: 'flex', justifyContent: 'space-between',
        background: 'var(--hub-bg-2)',
      }}>
        <span>0x0000</span>
        <span>EACH &#9633; = 64KB</span>
        <span>0x4000</span>
      </div>
    </div>
  );
}
