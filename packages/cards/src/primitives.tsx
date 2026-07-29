/**
 * primitives.tsx — small shared sub-components used inside the card kit's views.
 * Under Full Press these are thin wrappers over the suite classes so the kit
 * stops shipping pre-Full-Press copies: Checkbox → `.jk-check`, Eyebrow → the
 * serif `.jk-lab`, RecLamp → the `now-dot` + a `.jk-lab` label.
 */

import React, { useState } from 'react';

export function Checkbox({
  id,
  completed,
  onToggle,
  color,
  size = 15,
}: {
  id: number;
  completed?: boolean;
  onToggle?: (id: number, completed: boolean) => void;
  color?: string;
  size?: number;
}) {
  const [pop, setPop] = useState(false);
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!completed) {
      setPop(true);
      setTimeout(() => setPop(false), 260);
    }
    onToggle?.(id, !!completed);
  };
  return (
    <button
      role="checkbox"
      aria-checked={!!completed}
      onClick={handle}
      onMouseDown={(e) => e.stopPropagation()}
      className={`jk-check${pop ? ' check-pop' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.6),
        ...(color ? ({ ['--jk-tint' as string]: color } as React.CSSProperties) : null),
      }}
    >
      ✓
    </button>
  );
}

export function Eyebrow({
  children,
  color,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="jk-lab jk-lab-sm" style={{ ...(color ? { color } : null), ...style }}>
      {children}
    </div>
  );
}

export function RecLamp({ size = 8, label }: { size?: number; label?: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className="now-dot"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--color-accent)',
          boxShadow: `0 0 8px var(--color-accent-glow), 0 0 14px var(--color-accent-glow), inset 0 -1px 0 rgba(255,255,255,0.18)`,
        }}
      />
      {label && (
        <span className="jk-lab jk-lab-xs" style={{ color: 'var(--color-accent)' }}>
          {label}
        </span>
      )}
    </div>
  );
}
