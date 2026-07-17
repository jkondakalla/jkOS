/**
 * primitives.tsx — small shared sub-components used inside the card kit's views.
 * Self-contained ports of BeigeBoard's Checkbox / Eyebrow / RecLamp so the kit
 * needs no app imports.
 */

import React, { useState } from 'react';
import { withAlpha } from '@jkos/design';
import { FONT_BODY } from './theme';

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
  const accent = color || 'var(--color-accent)';
  return (
    <button
      onClick={handle}
      onMouseDown={(e) => e.stopPropagation()}
      className={pop ? 'check-pop' : ''}
      style={{
        width: size,
        height: size,
        border: `1px solid ${completed ? accent : 'var(--color-line)'}`,
        borderRadius: 'var(--hub-radius-xs)',
        background: completed ? accent : 'transparent',
        cursor: 'pointer',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-paper)',
        fontSize: Math.round(size * 0.6),
        lineHeight: 1,
        transition: 'background 0.15s, border-color 0.15s',
        padding: 0,
        boxShadow: completed ? `0 0 8px ${withAlpha(accent, 0.4)}` : 'none',
      }}
    >
      {completed ? '✓' : ''}
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
    <div
      style={{
        fontFamily: FONT_BODY,
        fontSize: 'var(--hub-fs-lab)',
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: color || 'var(--color-muted)',
        ...style,
      }}
    >
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
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--color-accent)',
            textShadow: 'var(--accent-halo-text)',
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
