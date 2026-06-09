import type { CSSProperties } from 'react';

// ─── 7-segment digit ──────────────────────────────────────────────────────────

const SEG_MAP: Record<string, number[]> = {
  '0': [1,1,1,1,1,1,0],
  '1': [0,1,1,0,0,0,0],
  '2': [1,1,0,1,1,0,1],
  '3': [1,1,1,1,0,0,1],
  '4': [0,1,1,0,0,1,1],
  '5': [1,0,1,1,0,1,1],
  '6': [1,0,1,1,1,1,1],
  '7': [1,1,1,0,0,0,0],
  '8': [1,1,1,1,1,1,1],
  '9': [1,1,1,1,0,1,1],
  '-': [0,0,0,0,0,0,1],
  ' ': [0,0,0,0,0,0,0],
};

interface SegDigitProps {
  char?: string;
  size?: number;
  color?: string;
  dim?: string;
}

export function SegDigit({
  char = '0',
  size = 32,
  color = 'var(--hub-amber)',
  dim = 'var(--hub-amber-deep)',
}: SegDigitProps) {
  const w = size * 0.55;
  const h = size;
  const t = Math.max(2, size * 0.09);
  const m = Math.max(1, size * 0.04);
  const segs = SEG_MAP[char] ?? SEG_MAP[' '];

  function path(which: string): string {
    switch (which) {
      case 'a': return `M${m+t/2},${m} L${w-m-t/2},${m} L${w-m-t},${m+t/2} L${m+t},${m+t/2} Z`;
      case 'g': return `M${m+t/2},${h/2} L${m+t},${h/2-t/2} L${w-m-t},${h/2-t/2} L${w-m-t/2},${h/2} L${w-m-t},${h/2+t/2} L${m+t},${h/2+t/2} Z`;
      case 'd': return `M${m+t/2},${h-m} L${m+t},${h-m-t/2} L${w-m-t},${h-m-t/2} L${w-m-t/2},${h-m} Z`;
      case 'f': return `M${m},${m+t/2} L${m+t/2},${m+t} L${m+t/2},${h/2-t} L${m},${h/2-t/2} Z`;
      case 'b': return `M${w-m},${m+t/2} L${w-m-t/2},${m+t} L${w-m-t/2},${h/2-t} L${w-m},${h/2-t/2} Z`;
      case 'e': return `M${m},${h-m-t/2} L${m+t/2},${h-m-t} L${m+t/2},${h/2+t} L${m},${h/2+t/2} Z`;
      case 'c': return `M${w-m},${h-m-t/2} L${w-m-t/2},${h-m-t} L${w-m-t/2},${h/2+t} L${w-m},${h/2+t/2} Z`;
      default:  return '';
    }
  }

  const order = ['a','b','c','d','e','f','g'];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {order.map((s, i) => (
        <path
          key={s}
          d={path(s)}
          fill={segs[i] ? color : dim}
          style={segs[i] ? { filter: `drop-shadow(0 0 ${size * 0.12}px ${color}aa)` } : undefined}
        />
      ))}
    </svg>
  );
}

// ─── Seg Display ─────────────────────────────────────────────────────────────

interface SegDisplayProps {
  value: string | number;
  length?: number;
  size?: number;
  separator?: boolean;
  style?: CSSProperties;
}

export function SegDisplay({ value, length = 6, size = 32, separator, style }: SegDisplayProps) {
  const str = String(value).padStart(length, ' ').slice(-length);
  const chars = str.split('');
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: size * 0.08,
      padding: size * 0.18,
      background: 'var(--hub-bg-0)',
      border: '1px solid var(--hub-line)',
      boxShadow: 'inset 0 0 8px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.4)',
      ...style,
    }}>
      {chars.map((c, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <SegDigit char={c} size={size} />
          {separator && (i + 1) % 2 === 0 && i < chars.length - 1 && (
            <span style={{
              color: 'var(--hub-amber)',
              fontSize: size * 0.5,
              textShadow: '0 0 6px var(--hub-amber-glow)',
              transform: `translateY(-${size * 0.05}px)`,
              animation: 'blink 1s steps(2) infinite',
            }}>:</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── VU Meter ─────────────────────────────────────────────────────────────────

interface VuMeterProps {
  value?: number;
  label?: string;
  height?: number;
  width?: number;
  color?: string;
}

export function VuMeter({ value = 0, label, height = 90, width = 14, color = 'var(--hub-amber)' }: VuMeterProps) {
  const v = Math.max(0, Math.min(1, value));
  const bars = 12;
  const litCount = Math.round(v * bars);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        width,
        height,
        background: 'var(--hub-bg-0)',
        border: '1px solid var(--hub-line)',
        padding: 2,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 1,
        boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)',
      }}>
        {Array.from({ length: bars }).map((_, i) => {
          const isLit = i < litCount;
          const isWarn = i >= bars - 3;
          const c = isLit ? (isWarn ? 'var(--hub-red)' : color) : 'var(--hub-bg-2)';
          return (
            <div key={i} style={{
              flex: 1,
              background: c,
              boxShadow: isLit ? `0 0 3px ${isWarn ? 'var(--hub-red-glow)' : 'var(--hub-amber-glow)'}` : 'none',
            }} />
          );
        })}
      </div>
      {label && (
        <div style={{ fontSize: 8, color: 'var(--hub-cream-dim)', letterSpacing: '0.1em' }}>
          {label}
        </div>
      )}
    </div>
  );
}
