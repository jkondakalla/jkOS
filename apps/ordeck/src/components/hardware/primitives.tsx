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

// ─── Screw ────────────────────────────────────────────────────────────────────

interface ScrewProps {
  rot?: number;
  size?: number;
  style?: CSSProperties;
}

export function Screw({ rot = 25, size = 10, style }: ScrewProps) {
  return (
    <span
      className={`screw${size === 7 ? ' sm' : ''}`}
      style={{ '--screw-rot': `${rot}deg`, ...style } as CSSProperties}
    />
  );
}

// ─── Vent (horizontal slats) ──────────────────────────────────────────────────

interface VentProps {
  slats?: number;
  width?: number | string;
  style?: CSSProperties;
}

export function Vent({ slats = 3, width = 60, style }: VentProps) {
  return (
    <div className="vent" style={{ width, ...style }}>
      {Array.from({ length: slats }).map((_, i) => <i key={i} />)}
    </div>
  );
}
