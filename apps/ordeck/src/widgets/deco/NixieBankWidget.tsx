import { useMemo } from 'react';
import { DymoTape, useTick } from '../../components/hardware';

function NixieDigit({ char }: { char: string }) {
  return (
    <div style={{
      width: 26, height: 38,
      background: 'radial-gradient(ellipse at center, #281a0d 0%, #110a04 80%)',
      border: '1px solid #2a1a0a',
      borderRadius: '4px 4px 2px 2px',
      display: 'grid', placeItems: 'center',
      position: 'relative',
      boxShadow: 'inset 0 -3px 6px rgba(255,140,40,0.08), inset 0 4px 8px rgba(0,0,0,0.7)',
    }}>
      <span style={{
        position: 'absolute',
        color: 'rgba(255,140,40,0.07)',
        fontFamily: 'var(--hub-font-seg)',
        fontSize: 26, fontWeight: 700, lineHeight: 1,
      }}>8</span>
      <span style={{
        color: '#ff8c28',
        fontFamily: 'var(--hub-font-seg)',
        fontSize: 26, fontWeight: 700, lineHeight: 1,
        textShadow: '0 0 6px #ff8c28, 0 0 12px #ff5a14aa, 0 0 18px #ff5a1466',
        position: 'relative',
      }}>{char}</span>
      <span style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '40%',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent)',
        borderRadius: '4px 4px 0 0',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

export default function NixieBankWidget() {
  const tick = useTick(160);
  const digits = useMemo(() => {
    const n = Math.floor(tick / 6);
    return String(n).padStart(6, '0').slice(-6);
  }, [tick]);

  return (
    <div style={{
      height: '100%', padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
      justifyContent: 'center', alignItems: 'center',
    }}>
      <DymoTape style={{ fontSize: 8 }}>NIXIE · BANK</DymoTape>
      <div style={{
        display: 'flex', gap: 4, padding: 14,
        background: 'radial-gradient(ellipse at center, #1a1410, #050402)',
        border: '1px solid var(--hub-line-strong)',
        boxShadow: 'inset 0 0 16px rgba(0,0,0,0.9)',
      }}>
        {digits.split('').map((d, i) => <NixieDigit key={i} char={d} />)}
      </div>
      <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em' }}>// COUNTER · OHM·SEC</div>
    </div>
  );
}
