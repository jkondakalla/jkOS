import { Screw, LabelTape } from '../../components/hardware';

export default function GrillePanelWidget() {
  return (
    <div style={{ height: '100%', padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
        <Screw size={7} rot={20} />
        <LabelTape style={{ fontSize: 8, flex: 1, textAlign: 'center' }}>MONITOR · 8&#937;</LabelTape>
        <Screw size={7} rot={-15} />
      </div>
      <div style={{
        flex: 1, width: '100%',
        background: 'radial-gradient(ellipse at 30% 20%, #1a1612, #050402)',
        border: '1px solid #1a1612',
        boxShadow: 'inset 0 0 12px rgba(0,0,0,0.8)',
        padding: 10,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 6px)',
        gridAutoRows: '6px',
        gap: 3,
        alignContent: 'center',
        justifyContent: 'center',
      }}>
        {Array.from({ length: 200 }).map((_, i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #0a0907 25%, #1a1612 100%)',
            boxShadow: 'inset 0 0 1px rgba(0,0,0,0.9)',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch' }}>
        <Screw size={7} rot={48} />
        <span style={{ flex: 1, textAlign: 'center', fontSize: 7, color: 'var(--hub-cream-faint)', letterSpacing: '0.18em' }}>
          ORDECK · AUDIO
        </span>
        <Screw size={7} rot={-22} />
      </div>
    </div>
  );
}
