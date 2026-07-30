import { useState } from 'react';
import { Slider, Lab, Sub, Press } from '@jkos/ui';
import { Faces } from './_faces';

const pad: React.CSSProperties = { padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 420 };

/** The house fader. Controlled: pass `value` + `onChange`. The elapsed fill is
 *  painted from the value via --jk-slider-fill. */
export const Levels = () => (
  <Faces height={230}>
    <div style={pad}>
      {[0, 35, 70, 100].map((v) => (
        <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Lab size="xs" style={{ width: 48 }}>
            {String(v).padStart(3, '0')}
          </Lab>
          <Slider value={v} style={{ flex: 1 }} />
        </div>
      ))}
    </div>
  </Faces>
);

/** A seek control — the split `onChange` (live) vs `onCommit` (on release)
 *  exists so a seek can preview without committing per pixel. */
export const Seek = () => {
  const [pos, setPos] = useState(38);
  const total = 74 * 60;
  const at = Math.round((pos / 100) * total);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <Faces height={230}>
      <div style={pad}>
        <Lab size="xs">Chapter 4 · The forge</Lab>
        <Slider value={pos} onChange={setPos} onCommit={setPos} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Press>{fmt(at)}</Press>
          <Sub>{fmt(total)}</Sub>
        </div>
      </div>
    </Faces>
  );
};
