import type { CSSProperties, ReactNode } from 'react';

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

// ─── Grille (dot-grid speaker grille) ────────────────────────────────────────

interface GrilleProps {
  cols?: number;
  rows?: number;
  dotSize?: number;
  gap?: number;
  style?: CSSProperties;
}

export function Grille({ cols = 8, rows = 5, dotSize = 2, gap = 3, style }: GrilleProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`,
      gridAutoRows: `${dotSize}px`,
      gap,
      padding: 6,
      background: 'var(--hub-bg-0)',
      border: '1px solid var(--hub-line)',
      boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)',
      ...style,
    }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <span key={i} style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #0a0907 30%, #1a1612 100%)',
        }} />
      ))}
    </div>
  );
}

// ─── Tape labels ──────────────────────────────────────────────────────────────

interface TapeProps {
  children?: ReactNode;
  style?: CSSProperties;
}

export function LabelTape({ children, style }: TapeProps) {
  return <span className="label-tape" style={style}>{children}</span>;
}

export function DymoTape({ children, style }: TapeProps) {
  return <span className="dymo-tape" style={style}>{children}</span>;
}

// ─── Panel (corner-screwed surface) ──────────────────────────────────────────

interface PanelProps {
  children?: ReactNode;
  screws?: boolean;
  screwSize?: number;
  style?: CSSProperties;
}

export function Panel({ children, screws = true, screwSize = 7, style }: PanelProps) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--hub-bg-1)',
      border: '1px solid var(--hub-line-strong)',
      ...style,
    }}>
      {screws && (
        <>
          <Screw size={screwSize} rot={15}  style={{ position: 'absolute', top: 4, left: 4 }} />
          <Screw size={screwSize} rot={-22} style={{ position: 'absolute', top: 4, right: 4 }} />
          <Screw size={screwSize} rot={62}  style={{ position: 'absolute', bottom: 4, left: 4 }} />
          <Screw size={screwSize} rot={-48} style={{ position: 'absolute', bottom: 4, right: 4 }} />
        </>
      )}
      {children}
    </div>
  );
}
