import { useEffect, useState } from 'react';

const LINES = [
  'ORDECK OS v2.0 // jkOS CONTROL SURFACE',
  'LOADING DESIGN TOKENS // @jkos/design/tokens.css',
  'APPLYING SUITE MODE  // data-mode: paper',
  'MOUNTING WIDGET RUNTIME',
  'SCANNING jkOS SUITE REGISTRY',
  'AUTH GATEWAY READY   // auth.jkos.net',
  'READY.',
];

export default function BootSequence({ onDone }: { onDone?: () => void }) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), LINES.length * 150 + 200);
    const t2 = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, LINES.length * 150 + 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--hub-bg-0)',
      zIndex: 9000,
      display: 'flex', flexDirection: 'column',
      alignItems: 'flex-start', justifyContent: 'center',
      padding: '60px',
      fontFamily: 'var(--hub-font-mono)',
      color: 'var(--hub-amber)',
      fontSize: '13px',
      lineHeight: '1.8',
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.6s ease',
      pointerEvents: 'none',
    }}>
      {LINES.map((line, i) => (
        <div
          key={i}
          style={{ opacity: 0, animation: `bootIn 0.05s ease ${i * 0.15}s forwards` }}
        >
          {line}
          <span style={{ color: 'var(--hub-green)', marginLeft: 12 }}>
            {line === 'READY.' ? '▮' : '[OK]'}
          </span>
        </div>
      ))}
      <style>{`@keyframes bootIn { to { opacity: 1; } }`}</style>
    </div>
  );
}
