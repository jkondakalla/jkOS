/**
 * workshop/ContextMenu.tsx — the canvas's floating "add / edit here" menu.
 *
 * One generic grouped menu: right-click (mouse) or long-hold-without-move
 * (touch) opens it anywhere on the canvas; the workshop assembles the groups
 * (compatible primitives to ADD at that spot, plus node ops). Hovering/focusing
 * an ADD entry drives the translucent ghost preview via onHover. Styling reuses
 * the .ww-menu vocabulary (hud.css), which grows tap-sized rows on coarse
 * pointers.
 */

import { useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  danger?: boolean;
  onPick: () => void;
  /** Entered/left this entry — the workshop uses it for the add-ghost preview. */
  onHover?: (on: boolean) => void;
}

export interface MenuGroup { head: string; items: MenuItem[] }

export function ContextMenu({ x, y, groups, onClose }: {
  x: number; y: number;               // stage-relative anchor
  groups: MenuGroup[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp inside the stage so a menu opened near an edge stays reachable.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) { setPos({ x, y }); return; }
    setPos({
      x: Math.max(0, Math.min(x, host.clientWidth - el.offsetWidth - 4)),
      y: Math.max(0, Math.min(y, host.clientHeight - el.offsetHeight - 4)),
    });
  }, [x, y]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="ww-menu-scrim"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div ref={ref} className="ww-menu" style={{ left: pos.x, top: pos.y }}>
        {groups.map((g) => (
          <div key={g.head}>
            <div className="ww-menu-head">{g.head}</div>
            {g.items.map((it) => (
              <button
                key={it.key}
                className={`ww-menu-item${it.danger ? ' is-danger' : ''}`}
                onMouseEnter={() => it.onHover?.(true)}
                onMouseLeave={() => it.onHover?.(false)}
                onFocus={() => it.onHover?.(true)}
                onBlur={() => it.onHover?.(false)}
                onClick={it.onPick}
              >
                <span className="ww-menu-label">{it.label}</span>
                {it.hint && <span className="ww-menu-hint">{it.hint}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
