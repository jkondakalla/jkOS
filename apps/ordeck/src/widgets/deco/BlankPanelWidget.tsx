import { Screw, LabelTape } from '../../components/hardware';

export default function BlankPanelWidget() {
  return (
    <div className="perf" style={{
      height: '100%',
      position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Screw size={7} rot={20} style={{ position: 'absolute', top: 10, left: 10 }} />
      <Screw size={7} rot={-15} style={{ position: 'absolute', top: 10, right: 10 }} />
      <Screw size={7} rot={48} style={{ position: 'absolute', bottom: 10, left: 10 }} />
      <Screw size={7} rot={-32} style={{ position: 'absolute', bottom: 10, right: 10 }} />
      <div style={{
        padding: '14px 22px',
        background: 'var(--hub-bg-1)',
        border: '1px solid var(--hub-line-strong)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.6)',
      }}>
        <LabelTape style={{ fontSize: 10 }}>RESERVED · BLANK</LabelTape>
      </div>
    </div>
  );
}
