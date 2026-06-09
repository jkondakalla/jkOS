import { useState, useEffect } from 'react';
import type { WidgetProps } from '@jkos/types';

export default function LabelStripWidget({ widgetId }: WidgetProps) {
  const key = `ordeck-label-${widgetId}`;
  const [text, setText] = useState(() => localStorage.getItem(key) || 'OPERATOR · DECK');
  useEffect(() => { localStorage.setItem(key, text); }, [key, text]);

  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      padding: 14, gap: 12,
      background: 'repeating-linear-gradient(45deg, var(--hub-bg-1) 0px, var(--hub-bg-1) 8px, var(--hub-bg-2) 8px, var(--hub-bg-2) 16px)',
    }}>
      <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em' }}>
        // EDITABLE LABEL //
      </div>
      <div style={{
        position: 'relative',
        background: '#1f1c16',
        padding: '12px 24px',
        border: '1px solid #0a0907',
        boxShadow: 'inset 0 1px 0 rgba(255,220,160,0.06), 0 2px 4px rgba(0,0,0,0.5)',
        minWidth: 200, maxWidth: '90%',
      }}>
        <span style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: 6,
          background: 'radial-gradient(circle at center, #11100d 1.2px, transparent 1.5px)',
          backgroundSize: '6px 6px',
        }} />
        <span style={{
          position: 'absolute', top: 0, bottom: 0, right: 0, width: 6,
          background: 'radial-gradient(circle at center, #11100d 1.2px, transparent 1.5px)',
          backgroundSize: '6px 6px',
        }} />
        <input
          value={text}
          onChange={e => setText(e.target.value.toUpperCase().slice(0, 24))}
          style={{
            background: 'transparent',
            border: 'none', outline: 'none',
            color: 'var(--hub-cream-bright)',
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 16, letterSpacing: '0.25em', fontWeight: 600,
            textAlign: 'center', width: '100%',
            textShadow: '0 -1px 0 rgba(0,0,0,0.8)',
          }}
        />
      </div>
      <div style={{ fontSize: 7, color: 'var(--hub-cream-faint)', letterSpacing: '0.2em', textAlign: 'center' }}>
        DYMO · M-1011 · 24CHR MAX
      </div>
    </div>
  );
}
