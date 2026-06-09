import { useMemo } from 'react';
import { useWaveform } from '../../components/hardware';
import { Led } from '../../components/hardware';

function ScopeTrace({ points, color, offset = 0.5, amp = 0.5 }: {
  points: number[];
  color: string;
  offset?: number;
  amp?: number;
}) {
  const path = useMemo(() => {
    return points.map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = (1 - (p * amp + offset - amp / 2)) * 100;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [points, offset, amp]);

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100" preserveAspectRatio="none">
      <path
        d={path} fill="none" stroke={color} strokeWidth={0.5}
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}

export function ScopeWidget() {
  const data  = useWaveform(200, 90);
  const data2 = useWaveform(200, 120);

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
          SCOPE · CH1+CH2
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>5ms/div</span>
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>10mv</span>
        <Led color="amber" size="sm" />
      </div>
      <div style={{ flex: 1, position: 'relative', background: 'var(--hub-bg-0)', overflow: 'hidden' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <defs>
            <pattern id="scope-grid" width="32" height="24" patternUnits="userSpaceOnUse">
              <path d="M32,0 L0,0 0,24" fill="none" stroke="var(--hub-amber-deep)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#scope-grid)" />
          <line x1="50%" y1="0" x2="50%" y2="100%" stroke="var(--hub-amber-dim)" strokeWidth="0.6" strokeDasharray="2 3" />
          <line x1="0" y1="50%" x2="100%" y2="50%" stroke="var(--hub-amber-dim)" strokeWidth="0.6" strokeDasharray="2 3" />
        </svg>
        <ScopeTrace points={data}  color="var(--hub-amber)" offset={0.35} />
        <ScopeTrace points={data2} color="var(--hub-cyan)"  offset={0.65} amp={0.4} />
        <div style={{
          position: 'absolute', bottom: 4, left: 6, fontSize: 8,
          color: 'var(--hub-amber-dim)', letterSpacing: '0.18em',
        }}>TRIG: AUTO · DC</div>
      </div>
    </div>
  );
}
