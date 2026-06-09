import { Led, DymoTape, useTick } from '../../components/hardware';

export default function StatusLightsWidget() {
  const tick = useTick(400);
  const labels = ['PWR', 'CLK', 'NET', 'DSK', 'DMA', 'IRQ', 'BUS', 'I/O'];
  const colors: Array<'green' | 'amber' | 'cyan'> = ['green', 'amber', 'amber', 'cyan'];

  return (
    <div style={{ height: '100%', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <DymoTape style={{ fontSize: 8 }}>STATUS · BANK</DymoTape>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {labels.map((l, i) => {
          const on = (tick + i * 3) % (5 + (i % 3)) !== 0;
          const c = colors[i % colors.length];
          return (
            <div key={l} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px',
              background: 'var(--hub-bg-0)',
              border: '1px solid var(--hub-line)',
            }}>
              <Led color={on ? c : undefined} off={!on} size="md" steady={on} />
              <span style={{
                fontSize: 9, letterSpacing: '0.18em',
                color: on ? 'var(--hub-cream)' : 'var(--hub-cream-faint)',
              }}>{l}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>
        <span>BANK · 01</span>
        <span>// MONITOR ONLY</span>
      </div>
    </div>
  );
}
