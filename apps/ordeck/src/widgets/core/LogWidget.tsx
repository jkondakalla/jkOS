import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ordeck-op-log';

export default function LogWidget({ widgetId }: { widgetId: number }) {
  const key = `${STORAGE_KEY}-${widgetId}`;
  const [text, setText] = useState(() => localStorage.getItem(key) || '');

  useEffect(() => {
    localStorage.setItem(key, text);
  }, [key, text]);

  return (
    <textarea
      value={text}
      onChange={e => setText(e.target.value)}
      placeholder="// operator notes // free text logging //"
      style={{
        width: '100%', height: '100%',
        background: 'var(--hub-bg-0)',
        border: '1px solid var(--hub-line)',
        color: 'var(--hub-cream)',
        fontFamily: 'var(--hub-font-mono)',
        fontSize: 11, padding: 8,
        resize: 'none', outline: 'none',
        lineHeight: 1.6,
        userSelect: 'text',
        touchAction: 'auto',
        transition: 'border-color 0.15s',
      }}
      onFocus={e => { e.target.style.borderColor = 'var(--hub-amber-dim)'; }}
      onBlur={e => { e.target.style.borderColor = 'var(--hub-line)'; }}
    />
  );
}
