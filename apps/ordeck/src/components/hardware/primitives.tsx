import type { CSSProperties } from 'react';

// ─── LED ──────────────────────────────────────────────────────────────────────

interface LedProps {
  color?: 'amber' | 'cyan' | 'red' | 'green';
  steady?: boolean;
  size?: 'sm' | 'md' | 'lg';
  off?: boolean;
  style?: CSSProperties;
}

export function Led({ color = 'amber', steady, size = 'md', off, style }: LedProps) {
  const cls = [
    'led',
    color,
    steady ? 'steady' : '',
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '',
    off ? 'off' : '',
  ].filter(Boolean).join(' ');
  return <span className={cls} style={style} />;
}

