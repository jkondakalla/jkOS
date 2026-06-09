import { Led, Vent, DymoTape } from '../../components/hardware';

function Reel({ speed = 4, reverse = false }: { speed?: number; reverse?: boolean }) {
  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <div style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 30% 30%, #3a342b, #1a1612 70%, #050402 100%)',
        border: '1px solid var(--hub-line-strong)',
        boxShadow: 'inset 0 0 8px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)',
      }} />
      <svg viewBox="0 0 100 100" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        animation: `reel-spin ${speed}s linear infinite${reverse ? ' reverse' : ''}`,
      }}>
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i * 60) * Math.PI / 180;
          const x1 = 50 + Math.cos(a) * 18;
          const y1 = 50 + Math.sin(a) * 18;
          const x2 = 50 + Math.cos(a) * 40;
          const y2 = 50 + Math.sin(a) * 40;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hub-cream-faint)" strokeWidth="2.5" strokeLinecap="round" />;
        })}
        <circle cx="50" cy="50" r="6" fill="var(--hub-bg-0)" stroke="var(--hub-amber-dim)" strokeWidth="1" />
        <circle cx="50" cy="50" r="2" fill="var(--hub-amber)" style={{ filter: 'drop-shadow(0 0 4px var(--hub-amber-glow))' }} />
      </svg>
    </div>
  );
}

export default function SpinningReelWidget() {
  return (
    <div style={{ height: '100%', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <DymoTape style={{ fontSize: 8 }}>TAPE · A</DymoTape>
        <Led color="amber" size="sm" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', flex: 1 }}>
        <Reel speed={4} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Vent slats={4} width={36} />
          <div style={{ fontSize: 9, color: 'var(--hub-amber)', letterSpacing: '0.15em' }} className="glow-dim">&#9654; PLAY</div>
        </div>
        <Reel speed={4} reverse />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>
        <span>0000</span>
        <span>00:00:00</span>
        <span>9999</span>
      </div>
    </div>
  );
}
