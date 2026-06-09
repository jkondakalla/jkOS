import { DymoTape, useTick } from '../../components/hardware';

function AnalogGauge({ label, v }: { label: string; v: number }) {
  const angle = -120 + Math.max(0, Math.min(1, v)) * 240;
  return (
    <div style={{
      background: 'radial-gradient(ellipse at 40% 30%, var(--hub-bg-2), var(--hub-bg-0))',
      border: '1px solid var(--hub-line)',
      borderRadius: '6px 6px 4px 4px',
      padding: 6,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <svg viewBox="0 0 100 64" style={{ width: '100%' }}>
        <path d="M10,60 A 40,40 0 0 1 90,60" fill="none" stroke="var(--hub-line-strong)" strokeWidth="2" />
        {Array.from({ length: 9 }).map((_, i) => {
          const a = (-120 + (i / 8) * 240) * Math.PI / 180;
          const x1 = 50 + Math.cos(a) * 36;
          const y1 = 60 + Math.sin(a) * 36;
          const x2 = 50 + Math.cos(a) * (i % 4 === 0 ? 28 : 32);
          const y2 = 60 + Math.sin(a) * (i % 4 === 0 ? 28 : 32);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hub-amber-dim)" strokeWidth={i % 4 === 0 ? 1.2 : 0.6} />;
        })}
        <path d="M65,28 A 40,40 0 0 1 90,60" fill="none" stroke="var(--hub-red-dim)" strokeWidth="2" />
        <g transform={`translate(50,60) rotate(${angle - 90})`} style={{ transition: 'transform 0.4s ease' }}>
          <line x1="0" y1="0" x2="0" y2="-32" stroke="var(--hub-amber)" strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0 0 3px var(--hub-amber))' }} />
        </g>
        <circle cx="50" cy="60" r="2" fill="var(--hub-amber)" />
      </svg>
      <span style={{
        fontSize: 10, letterSpacing: '0.2em',
        color: 'var(--hub-amber)', fontWeight: 600,
        fontFamily: 'var(--hub-font-seg)',
      }} className="glow-dim">{label}</span>
    </div>
  );
}

export default function GaugeBankWidget() {
  const tick = useTick(900);
  const gauges = [
    { label: 'V', v: 0.6 + 0.3 * Math.sin(tick * 0.4) },
    { label: 'A', v: 0.5 + 0.4 * Math.sin(tick * 0.55 + 1) },
    { label: 'Ω', v: 0.7 + 0.2 * Math.sin(tick * 0.3 + 2) },
  ];

  return (
    <div style={{ height: '100%', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <DymoTape style={{ fontSize: 8 }}>GAUGE · TRIO</DymoTape>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {gauges.map(g => <AnalogGauge key={g.label} {...g} />)}
      </div>
    </div>
  );
}
