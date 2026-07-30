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

/**
 * ChromeBar — the 46px view header every timeline view opens with.
 *
 * Week, Today and Calendar each used to grow their own masthead (a 28–30px serif
 * <h1>), which cost ~40px of timeline for no information and gave three chances
 * to drift. This is the one bar: a pressed serif title, a mono stat line, and the
 * nav trio pushed right. `title` is a node so Calendar can pass roman month +
 * italic year.
 */
export function ChromeBar({
  title,
  stats,
  nav,
  className,
  style,
}: {
  title: React.ReactNode;
  stats?: React.ReactNode;
  nav?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        height: 46,
        flex: 'none',
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        padding: '0 28px',
        borderBottom: '1px solid var(--hub-line)',
        ...style,
      }}
    >
      <span
        className="jk-press"
        style={{
          fontFamily: 'var(--hub-font-serif)',
          fontWeight: 700,
          fontSize: '1.15rem',
          letterSpacing: '-0.015em',
          alignSelf: 'center',
        }}
      >
        {title}
      </span>
      {stats != null && <span className="mono-eyebrow" style={{ alignSelf: 'center' }}>{stats}</span>}
      {nav != null && (
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'center' }}>
          {nav}
        </span>
      )}
    </div>
  );
}

/**
 * NowLine — the accent rule across a timeline at the current minute.
 *
 * Week and Today implemented this twice, differing only by the label. The label
 * is a Today affordance: it names the LIVE event and counts down, which is the
 * whole point — a static "NOW" is worse than none, so the label is omitted
 * rather than faked when nothing is running.
 */
export function NowLine({ label, dot = 8 }: { label?: string; dot?: number }) {
  return (
    <>
      <span
        className="now-dot"
        style={{
          width: dot,
          height: dot,
          borderRadius: '50%',
          background: 'var(--color-accent)',
          boxShadow: 'var(--accent-halo)',
          marginLeft: -(dot / 2),
          flex: 'none',
        }}
      />
      <span style={{ flex: 1, height: 2, background: 'var(--color-accent)', opacity: label ? 0.7 : 0.75 }} />
      {label && (
        <span
          className="jk-press"
          style={{
            fontFamily: 'var(--hub-font-mono)',
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '0.2em',
            padding: '0 8px',
            flex: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      )}
    </>
  );
}

/**
 * HourLabel — the gutter annotation.
 *
 * Mono, not `.seg`: the gutter is the MACHINE annotating the grid, not a readout
 * (DESIGN.md §13.12). `.seg` stays on the now-time badge, which genuinely is one.
 */
export function HourLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--hub-font-mono)',
        fontSize: 9,
        letterSpacing: '0.06em',
        color: 'var(--color-faint)',
      }}
    >
      {children}
    </span>
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
