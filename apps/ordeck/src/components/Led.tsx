import type { CSSProperties } from 'react';

// The one hardware primitive the auth/login chrome still uses. The richer deck pieces
// (screws, vents, gauges, seg displays, knobs, tapes, panels) went out with the legacy
// canvas and the 2026-07-17 v0.1 chrome cull; bring one back from git history only when a
// view has a job for it.

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
