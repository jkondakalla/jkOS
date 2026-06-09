import { useMemo } from 'react';
import { useTick } from '../../components/hardware';

const RAIN_CHARS = '01アイウエオカキクABCDEF<>{}[]/*+';

export default function DataRainWidget() {
  const tick = useTick(120);
  const cols = 24;
  const rows = 22;

  const grid = useMemo(() => {
    const result: number[][] = [];
    for (let c = 0; c < cols; c++) {
      const offset = (c * 7) % rows;
      const speed = 1 + (c % 4);
      const col: number[] = [];
      for (let r = 0; r < rows; r++) {
        const pos = (tick * speed + offset + r) % (rows * 2);
        let intensity = 0;
        if (pos === 0) intensity = 1.0;
        else if (pos < 4) intensity = 0.7 - pos * 0.18;
        else if (pos < 9) intensity = 0.3 - (pos - 4) * 0.05;
        col.push(intensity);
      }
      result.push(col);
    }
    return result;
  }, [tick]);

  return (
    <div style={{
      height: '100%', overflow: 'hidden',
      background: 'var(--hub-bg-0)',
      padding: 4, position: 'relative',
    }}>
      <div style={{ display: 'flex', height: '100%', justifyContent: 'space-around', alignItems: 'stretch' }}>
        {grid.map((col, c) => (
          <div key={c} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
            {col.map((v, r) => (
              <span key={r} style={{
                fontFamily: 'var(--hub-font-mono)',
                fontSize: 11, lineHeight: 1, textAlign: 'center',
                color: v > 0.9
                  ? 'var(--hub-amber-bright)'
                  : v > 0.4
                    ? 'var(--hub-amber)'
                    : v > 0.1
                      ? 'var(--hub-amber-dim)'
                      : 'transparent',
                textShadow: v > 0.9 ? '0 0 6px var(--hub-amber)' : v > 0.4 ? '0 0 3px var(--hub-amber-glow)' : 'none',
                opacity: v,
              }}>
                {RAIN_CHARS[(c * 13 + r + Math.floor(tick / 2)) % RAIN_CHARS.length]}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div style={{
        position: 'absolute', bottom: 4, right: 6,
        fontSize: 7, color: 'var(--hub-cream-faint)',
        letterSpacing: '0.2em', pointerEvents: 'none',
      }}>// STREAM 0x{Math.floor(tick).toString(16).padStart(4, '0')}</div>
    </div>
  );
}
