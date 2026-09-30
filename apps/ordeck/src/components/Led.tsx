import type { CSSProperties } from 'react';

// The one hardware primitive the auth/login chrome still uses. The richer deck pieces
// (screws, vents, gauges, seg displays, knobs, tapes, panels) went out with the legacy
// canvas and the 2026-07-17 v0.1 chrome cull; bring one back from git history only when a
// view has a job for it.

interface LedProps {
  /** The status role, as hub.css's `.jk-led` modifiers name it — never a pigment. */
  tone?: 'accent' | 'secondary' | 'danger' | 'ok';
  steady?: boolean;
  size?: 'sm' | 'md' | 'lg';
  off?: boolean;
  style?: CSSProperties;
}

export function Led({ tone = 'accent', steady, size = 'md', off, style }: LedProps) {
  const cls = [
    'jk-led',
    tone,
    steady ? 'steady' : '',
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '',
    off ? 'off' : '',
  ].filter(Boolean).join(' ');
  return <span className={cls} style={style} />;
}
