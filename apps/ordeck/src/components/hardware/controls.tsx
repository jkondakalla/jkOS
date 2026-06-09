import type { CSSProperties } from 'react';

// ─── Knob ─────────────────────────────────────────────────────────────────────

interface KnobProps {
  value?: number;
  size?: number;
  label?: string;
  color?: string;
}

export function Knob({ value = 0.4, size = 36, label, color = 'var(--hub-amber)' }: KnobProps) {
  const angle = -135 + value * 270;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 30% 30%, #4a4234, #1a1612 80%)',
        boxShadow: 'inset 0 -3px 6px rgba(0,0,0,0.7), inset 0 2px 2px rgba(255,220,160,0.06), 0 1px 2px rgba(0,0,0,0.6)',
        position: 'relative',
      }}>
        <span style={{
          position: 'absolute',
          top: 3,
          left: '50%',
          width: 2,
          height: size * 0.4,
          background: color,
          boxShadow: `0 0 4px ${color}`,
          transform: `translateX(-50%) rotate(${angle}deg)`,
          transformOrigin: `50% ${size * 0.5 - 3}px`,
        }} />
      </div>
      {label && (
        <div style={{ fontSize: 8, color: 'var(--hub-cream-dim)', letterSpacing: '0.12em' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Rocker Switch ────────────────────────────────────────────────────────────

interface RockerSwitchProps {
  on?: boolean;
  onToggle?: () => void;
  label?: string;
  width?: number;
}

export function RockerSwitch({ on = false, onToggle, label, width = 38 }: RockerSwitchProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <button onClick={onToggle} style={{
        width,
        height: 22,
        background: 'linear-gradient(180deg, #2c2820, #1a1612)',
        border: '1px solid #0a0907',
        boxShadow: 'inset 0 0 3px rgba(0,0,0,0.7)',
        position: 'relative',
        padding: 0,
        cursor: 'pointer',
      }}>
        <span style={{
          position: 'absolute',
          top: 2,
          bottom: 2,
          left: on ? width / 2 - 2 : 2,
          width: width / 2,
          background: on
            ? 'linear-gradient(180deg, #5a5040, #2a2620)'
            : 'linear-gradient(180deg, #3a342b, #1a1612)',
          borderTop: '1px solid rgba(255,220,160,0.1)',
          borderBottom: '1px solid rgba(0,0,0,0.6)',
          transition: 'left 0.12s ease',
        }} />
        <span style={{
          position: 'absolute',
          top: '50%',
          left: on ? width - 8 : 4,
          transform: 'translateY(-50%)',
          color: on ? 'var(--hub-amber)' : 'var(--hub-cream-faint)',
          fontSize: 8,
          fontWeight: 700,
          textShadow: on ? '0 0 4px var(--hub-amber-glow)' : 'none',
          transition: 'all 0.12s ease',
        }}>{on ? '|' : 'O'}</span>
      </button>
      {label && (
        <div style={{ fontSize: 8, color: 'var(--hub-cream-dim)', letterSpacing: '0.12em' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  area?: boolean;
}

export function Sparkline({ points, width = 80, height = 24, color = 'var(--hub-amber)', area = true }: SparklineProps) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const pathD = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - 2) - 1;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const areaD = area ? `${pathD} L${width},${height} L0,${height} Z` : null;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {area && areaD && <path d={areaD} fill={color} opacity={0.15} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.25}
        style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
    </svg>
  );
}

// ─── Corner Brackets ──────────────────────────────────────────────────────────

interface CornerBracketsProps {
  inset?: number;
  size?: number;
  color?: string;
  thickness?: number;
}

export function CornerBrackets({
  inset = 6,
  size = 10,
  color = 'var(--hub-amber-dim)',
  thickness = 1.5,
}: CornerBracketsProps) {
  const base: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: color,
    borderStyle: 'solid',
    pointerEvents: 'none',
  };
  return (
    <>
      <div style={{ ...base, top: inset, left: inset,    borderWidth: `${thickness}px 0 0 ${thickness}px` }} />
      <div style={{ ...base, top: inset, right: inset,   borderWidth: `${thickness}px ${thickness}px 0 0` }} />
      <div style={{ ...base, bottom: inset, left: inset, borderWidth: `0 0 ${thickness}px ${thickness}px` }} />
      <div style={{ ...base, bottom: inset, right: inset,borderWidth: `0 ${thickness}px ${thickness}px 0` }} />
    </>
  );
}
