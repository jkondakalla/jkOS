import { ReactNode, useRef, useCallback, CSSProperties } from 'react';
import { WidgetInstance } from '@jkos/types';
import { WidgetHeader, WidgetMeta } from './WidgetHeaders';

const GRID = 40;
const MIN_W = 200;
const MIN_H = 120;

type PointerLike = MouseEvent | TouchEvent;

function getPoint(e: PointerLike): { x: number; y: number } {
  if ('touches' in e && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if ('changedTouches' in e && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  const m = e as MouseEvent;
  return { x: m.clientX, y: m.clientY };
}

interface WidgetFrameProps {
  data: WidgetInstance;
  meta: WidgetMeta;
  onUpdate: (patch: Partial<WidgetInstance>) => void;
  onClose: () => void;
  onFocus?: () => void;
  onContext?: (x: number, y: number) => void;
  children?: ReactNode;
}

export default function Widget({ data, meta, onUpdate, onClose, onFocus, onContext, children }: WidgetFrameProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const ov = data.overrides ?? {};

  // Merge overrides into effective meta
  const effectiveMeta: WidgetMeta = {
    ...meta,
    header:   (ov.header   ?? meta.header)  as WidgetMeta['header'],
    title:    ov.title     ?? meta.title,
    color:    ov.color     ?? meta.color,
  };

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as Element).closest('[data-no-drag]')) return;
    const el = elRef.current;
    if (!el) return;
    onFocus?.();
    const canvas = el.parentElement!;
    const pt0 = getPoint(e.nativeEvent as PointerLike);
    const startLeft = parseFloat(el.style.left);
    const startTop = parseFloat(el.style.top);

    el.style.zIndex = '50';
    el.style.boxShadow = `0 0 0 1px var(--hub-amber), 0 8px 32px rgba(0,0,0,0.5)`;
    el.style.transition = 'none';

    const onMove = (ev: PointerLike) => {
      const pt = getPoint(ev);
      const maxL = canvas.clientWidth - el.offsetWidth;
      const maxT = canvas.clientHeight - el.offsetHeight;
      el.style.left = Math.max(0, Math.min(maxL, startLeft + pt.x - pt0.x)) + 'px';
      el.style.top  = Math.max(0, Math.min(maxT, startTop + pt.y - pt0.y)) + 'px';
      if ((ev as TouchEvent).cancelable) ev.preventDefault();
    };

    const onEnd = () => {
      const sx = Math.round(parseFloat(el.style.left) / GRID);
      const sy = Math.round(parseFloat(el.style.top) / GRID);
      el.style.left = sx * GRID + 'px';
      el.style.top  = sy * GRID + 'px';
      el.style.zIndex = '2';
      el.style.boxShadow = '';
      el.style.transition = '';
      onUpdate({ x: sx, y: sy });
      document.removeEventListener('mousemove', onMove as EventListener);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove as EventListener);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove as EventListener);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove as EventListener, { passive: false });
    document.addEventListener('touchend', onEnd);
    if ((e as React.TouchEvent).touches) e.preventDefault();
  }, [onUpdate, onFocus]);

  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const el = elRef.current;
    if (!el) return;
    const canvas = el.parentElement!;
    const pt0 = getPoint(e.nativeEvent as PointerLike);
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;

    el.style.zIndex = '50';
    el.style.transition = 'none';

    const onMove = (ev: PointerLike) => {
      const pt = getPoint(ev);
      const left = parseFloat(el.style.left);
      const top  = parseFloat(el.style.top);
      const nw = Math.max(MIN_W, Math.min(canvas.clientWidth - left, startW + pt.x - pt0.x));
      const nh = Math.max(MIN_H, Math.min(canvas.clientHeight - top, startH + pt.y - pt0.y));
      el.style.width  = nw + 'px';
      el.style.height = nh + 'px';
      if ((ev as TouchEvent).cancelable) ev.preventDefault();
    };

    const onEnd = () => {
      const sw = Math.max(5, Math.round(parseFloat(el.style.width) / GRID));
      const sh = Math.max(3, Math.round(parseFloat(el.style.height) / GRID));
      el.style.width  = sw * GRID + 'px';
      el.style.height = sh * GRID + 'px';
      el.style.zIndex = '2';
      el.style.transition = '';
      onUpdate({ w: sw, h: sh });
      document.removeEventListener('mousemove', onMove as EventListener);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove as EventListener);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove as EventListener);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove as EventListener, { passive: false });
    document.addEventListener('touchend', onEnd);
    if ((e as React.TouchEvent).touches) e.preventDefault();
  }, [onUpdate]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onContext?.(e.clientX, e.clientY);
  }, [onContext]);

  const handleMouseDown = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  const isStrip = effectiveMeta.header === 'strip';
  const radius  = ov.radius ?? 0;
  const opacity = ov.opacity ?? 1;
  const borderStyle = (ov.borderStyle ?? 'solid') as CSSProperties['borderStyle'];
  const textScale = ov.textScale ?? 1;

  return (
    <div
      ref={elRef}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onMouseEnter={e => { if (!e.currentTarget.style.boxShadow) e.currentTarget.style.boxShadow = '0 0 0 1px var(--hub-amber-dim)'; }}
      onMouseLeave={e => { if (e.currentTarget.style.zIndex !== '50') e.currentTarget.style.boxShadow = ''; }}
      style={{
        position: 'absolute',
        left: data.x * GRID,
        top: data.y * GRID,
        width: data.w * GRID,
        height: data.h * GRID,
        background: 'var(--hub-bg-1)',
        border: `1px ${borderStyle} var(--hub-line-strong)`,
        borderRadius: radius,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2,
        transition: 'box-shadow 0.15s ease',
        minWidth: MIN_W,
        minHeight: MIN_H,
        opacity,
        overflow: 'hidden',
        clipPath: 'var(--hub-clip-widget, none)',
        backdropFilter: 'var(--hub-widget-blur, none)',
      }}
    >
      <WidgetHeader
        meta={effectiveMeta}
        data={{ id: data.id }}
        onDragStart={handleDragStart}
        onClose={onClose}
      />

      <div style={{
        flex: 1, overflow: 'auto',
        padding: `var(--hub-widget-pad, 12px)`,
        paddingLeft: isStrip ? `calc(var(--hub-widget-pad, 12px) + 18px)` : undefined,
        fontSize: `${textScale}em`,
        lineHeight: 1.5, color: 'var(--hub-cream)',
        position: 'relative',
      }}>
        {children}
      </div>

      {/* Resize handle */}
      <div
        style={{
          position: 'absolute', right: 0, bottom: 0,
          width: 18, height: 18,
          cursor: 'nwse-resize', zIndex: 5, touchAction: 'none',
        }}
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
      >
        <div style={{
          position: 'absolute', right: 3, bottom: 3,
          width: 10, height: 10,
          borderRight: '2px solid var(--hub-amber-dim)',
          borderBottom: '2px solid var(--hub-amber-dim)',
        }} />
      </div>
    </div>
  );
}
