import { useState, useEffect } from 'react';
import { Led, DymoTape } from '../../components/hardware';
import type { WidgetProps } from '@jkos/types';

export default function TickerWidget({ widgetId }: WidgetProps) {
  const key = `ordeck-ticker-${widgetId}`;
  const [text, setText] = useState(
    () => localStorage.getItem(key) || 'ORDECK · CONTROL SURFACE · ALL SYSTEMS NOMINAL · CONNECTION POOL HEALTHY · BACKUP COMPLETE 03:47:12Z · NEXT MAINT WINDOW T-04:12:00'
  );
  const [editing, setEditing] = useState(false);
  useEffect(() => { localStorage.setItem(key, text); }, [key, text]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '6px 12px',
        background: 'var(--hub-bg-2)',
        borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Led color="amber" size="sm" />
        <DymoTape style={{ fontSize: 7 }}>NEWSWIRE</DymoTape>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setEditing(e => !e)}
          style={{
            fontSize: 8, padding: '2px 6px', letterSpacing: '0.15em',
            background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)',
            color: 'var(--hub-cream-dim)', cursor: 'pointer',
          }}
        >{editing ? 'DONE' : 'EDIT'}</button>
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--hub-bg-0)',
            border: 'none', outline: 'none',
            color: 'var(--hub-amber)',
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 12, padding: 10, resize: 'none', letterSpacing: '0.05em',
          }}
        />
      ) : (
        <div style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          background: 'var(--hub-bg-0)',
          display: 'flex', alignItems: 'center',
        }}>
          <div style={{
            whiteSpace: 'nowrap',
            color: 'var(--hub-amber)',
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 14, letterSpacing: '0.18em', fontWeight: 500,
            textShadow: '0 0 6px var(--hub-amber-glow)',
            paddingLeft: '100%',
            animation: `ticker-scroll ${Math.max(20, text.length * 0.3)}s linear infinite`,
          }}>
            {text} · {text}
          </div>
        </div>
      )}
    </div>
  );
}
