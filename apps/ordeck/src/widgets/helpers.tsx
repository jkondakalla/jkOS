import { CSSProperties } from 'react';

export function MiniLabel({ children, color, style }: { children: React.ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: 8, letterSpacing: '0.2em', color: color || 'var(--hub-cream-faint)', ...style }}>
      {children}
    </span>
  );
}

export function ToolButton({ children, onClick, color, secondary, disabled }: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const baseBg = secondary ? 'var(--hub-bg-1)' : 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 6px',
      background: baseBg,
      border: `1px solid ${color ? color + '88' : 'var(--hub-line-strong)'}`,
      color: disabled ? 'var(--hub-cream-faint)' : (color || 'var(--hub-cream)'),
      fontFamily: 'var(--hub-font-mono)',
      fontSize: 10, letterSpacing: '0.1em', fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'all 0.08s',
      boxShadow: 'inset 0 1px 0 rgba(255,220,160,0.06), 0 1px 0 rgba(0,0,0,0.6)',
    }}>{children}</button>
  );
}
