/**
 * CardFrame — optional card chrome (eyebrow top-left, source top-right, bordered
 * surface) matching ORDECK's WidgetFrame look. The Week/Calendar views render
 * bare in BeigeBoard (they own the page chrome) but can be wrapped in a frame
 * when embedded as an ORDECK widget. Built on @jkos/ui's Lab primitive so the
 * captions inherit the responsive mono-label scale.
 */

import React from 'react';
import { Lab } from '@jkos/ui';

export interface CardFrameProps {
  eyebrow?: React.ReactNode;
  source?: React.ReactNode;
  /** Bordered card surface (default true). */
  chrome?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function CardFrame({ eyebrow, source, chrome = true, children, style }: CardFrameProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        background: chrome ? 'var(--color-paper-2)' : 'transparent',
        border: chrome ? '1px solid var(--color-line)' : 'none',
        borderRadius: chrome ? 'var(--hub-radius-widget)' : 0,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(eyebrow || source) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--hub-widget-pad) var(--hub-widget-pad) 0',
            gap: 8,
          }}
        >
          {eyebrow ? <Lab>{eyebrow}</Lab> : <span />}
          {source ? (
            <Lab size="sm" className="jk-glow">
              {source}
            </Lab>
          ) : null}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}
