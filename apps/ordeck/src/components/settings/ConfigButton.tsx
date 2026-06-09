import { useState } from 'react';

interface ConfigButtonProps {
  open: boolean;
  onClick: () => void;
}

export function ConfigButton({ open, onClick }: ConfigButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 32,
        padding: '0 12px',
        background: open ? 'var(--hub-amber-deep)' : 'var(--hub-bg-0)',
        border: `1px solid ${open || hover ? 'var(--hub-amber)' : 'var(--hub-line-strong)'}`,
        color: open || hover ? 'var(--hub-amber)' : 'var(--hub-cream)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--hub-font-mono)',
        fontSize: 10,
        letterSpacing: '0.16em',
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: open ? 'inset 0 0 6px var(--hub-amber-glow)' : 'inset 0 0 4px rgba(0,0,0,0.5)',
        transition: 'all 0.12s',
      }}
    >
      <span style={{
        width: 12,
        height: 12,
        border: '1.5px solid currentColor',
        borderRadius: '50%',
        position: 'relative',
        display: 'inline-block',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute',
          inset: 3,
          background: 'currentColor',
          borderRadius: '50%',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s ease',
        }} />
      </span>
      CONFIG
    </button>
  );
}
