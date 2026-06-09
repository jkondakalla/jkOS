import { useState, CSSProperties } from 'react';
import { Led, Screw, Vent } from '../hardware';

export interface WidgetMeta {
  type: string;
  header?: 'classic' | 'band' | 'tab' | 'chip' | 'strip';
  label: string;
  title: string;
  subtitle?: string;
  code: string;
  glyph: string;
  color: string;
  led?: 'amber' | 'cyan' | 'green' | 'red';
}

export interface WidgetData {
  id: number;
}

interface HeaderProps {
  meta: WidgetMeta;
  data: WidgetData;
  onDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  onClose: () => void;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function WidgetHeader(props: HeaderProps) {
  switch (props.meta.header) {
    case 'band':  return <HeaderBand {...props} />;
    case 'tab':   return <HeaderTab {...props} />;
    case 'chip':  return <HeaderChip {...props} />;
    case 'strip': return <HeaderStrip {...props} />;
    default:      return <HeaderClassic {...props} />;
  }
}

// ─── Close button ─────────────────────────────────────────────────────────────

export function CloseBtn({ onClose, size = 18, style }: {
  onClose: () => void;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <button
      data-no-drag="true"
      title="Close"
      aria-label="Close widget"
      onClick={e => { e.stopPropagation(); onClose(); }}
      onMouseDown={e => e.stopPropagation()}
      onMouseEnter={e => {
        const el = e.currentTarget;
        el.style.borderColor = 'var(--hub-red)';
        el.style.color = 'var(--hub-red)';
        el.style.background = 'color-mix(in srgb, var(--hub-red) 12%, var(--hub-bg-0))';
        el.style.boxShadow = '0 0 6px var(--hub-red-glow)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.borderColor = 'var(--hub-line-strong)';
        el.style.color = 'var(--hub-cream-dim)';
        el.style.background = 'var(--hub-bg-0)';
        el.style.boxShadow = '';
      }}
      style={{
        width: size, height: size, minWidth: size, minHeight: size,
        border: '1px solid var(--hub-line-strong)',
        background: 'var(--hub-bg-0)',
        color: 'var(--hub-cream-dim)',
        display: 'inline-grid', placeItems: 'center',
        fontSize: Math.max(10, size - 6), lineHeight: 1,
        padding: 0, transition: 'all 0.1s', cursor: 'pointer',
        flexShrink: 0, fontFamily: 'var(--hub-font-mono)',
        ...style,
      }}
    >×</button>
  );
}

// ─── CLASSIC ──────────────────────────────────────────────────────────────────

function HeaderClassic({ meta, data, onDragStart, onClose }: HeaderProps) {
  const accent = meta.color || 'var(--hub-amber)';
  return (
    <div
      className="wf-title"
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      style={{
        height: 'var(--hub-title-h, 34px)',
        background: 'linear-gradient(180deg, var(--hub-bg-3) 0%, var(--hub-bg-1) 100%)',
        borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center',
        padding: '0 8px 0 0', gap: 8,
        cursor: 'grab', flexShrink: 0, position: 'relative',
      }}
    >
      <span style={{
        width: 3, height: '70%', background: accent, alignSelf: 'center',
        marginRight: 4, boxShadow: `0 0 6px ${accent}`,
      }} />
      <Screw size={7} rot={28} style={{ flexShrink: 0 }} />
      <Led color={meta.led || 'amber'} size="sm" />
      <span style={{
        flex: 1, fontSize: 10, letterSpacing: '0.16em',
        color: 'var(--hub-amber)', fontWeight: 600,
        textShadow: '0 0 4px var(--hub-amber-glow)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} className="wf-title-text">{meta.title}</span>
      <span style={{ fontSize: 8.5, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>
        {meta.code}·{String(data.id).padStart(3, '0')}
      </span>
      <Vent slats={2} width={20} style={{ padding: '2px 4px' }} />
      <CloseBtn onClose={onClose} />
      <Screw size={7} rot={-15} style={{ flexShrink: 0 }} />
    </div>
  );
}

// ─── BAND ─────────────────────────────────────────────────────────────────────

function HeaderBand({ meta, data, onDragStart, onClose }: HeaderProps) {
  const accent = meta.color || 'var(--hub-amber)';
  return (
    <div
      className="wf-title"
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      style={{
        height: 44,
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 24%, var(--hub-bg-2)) 0%, var(--hub-bg-1) 100%)`,
        borderBottom: `1px solid color-mix(in srgb, ${accent} 40%, var(--hub-line-strong))`,
        display: 'flex', alignItems: 'center',
        padding: '0 8px 0 14px', gap: 12,
        cursor: 'grab', flexShrink: 0, position: 'relative',
        boxShadow: `inset 0 -1px 0 ${accent}33, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <span style={{
        width: 28, height: 28, display: 'grid', placeItems: 'center',
        color: accent, fontSize: 16,
        border: `1px solid ${accent}66`,
        background: `radial-gradient(circle at 30% 25%, ${accent}22, transparent 70%)`,
        textShadow: `0 0 6px ${accent}aa`,
        flexShrink: 0,
      }}>{meta.glyph || '◈'}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.1, minWidth: 0 }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: accent, letterSpacing: '0.18em',
          fontFamily: 'var(--hub-font-seg)',
          textShadow: `0 0 6px ${accent}55`,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} className="wf-title-text">{meta.title}</span>
        <span style={{
          fontSize: 8, letterSpacing: '0.22em',
          color: 'var(--hub-cream-faint)', marginTop: 3,
        }}>{meta.code} · {String(data.id).padStart(3, '0')} · {(meta.subtitle || '').toUpperCase()}</span>
      </div>
      <Led color={meta.led || 'amber'} size="sm" />
      <CloseBtn onClose={onClose} />
    </div>
  );
}

// ─── TAB ──────────────────────────────────────────────────────────────────────

function HeaderTab({ meta, data, onDragStart, onClose }: HeaderProps) {
  const accent = meta.color || 'var(--hub-amber)';
  return (
    <div
      className="wf-title"
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      style={{
        height: 32,
        background: 'transparent',
        borderBottom: '1px solid var(--hub-line-strong)',
        display: 'flex', alignItems: 'stretch',
        cursor: 'grab', flexShrink: 0, position: 'relative',
      }}
    >
      <div style={{
        padding: '0 22px 0 12px',
        background: 'var(--hub-bg-3)',
        borderRight: '1px solid var(--hub-line-strong)',
        borderBottom: `2px solid ${accent}`,
        display: 'flex', alignItems: 'center', gap: 8,
        clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 100%, 0 100%)',
      }}>
        <span style={{ color: accent, fontSize: 12, textShadow: `0 0 6px ${accent}aa` }}>{meta.glyph || '◈'}</span>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: 'var(--hub-cream)', letterSpacing: '0.14em',
        }} className="wf-title-text">{meta.title}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 10 }}>
        <span style={{
          flex: 1, height: 1,
          background: `repeating-linear-gradient(90deg, var(--hub-line) 0, var(--hub-line) 4px, transparent 4px, transparent 8px)`,
        }} />
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.18em' }}>
          {meta.code}·{String(data.id).padStart(3, '0')}
        </span>
        <Led color={meta.led || 'amber'} size="sm" />
        <CloseBtn onClose={onClose} />
      </div>
    </div>
  );
}

// ─── CHIP ─────────────────────────────────────────────────────────────────────

function HeaderChip({ meta, data, onDragStart, onClose }: HeaderProps) {
  const accent = meta.color || 'var(--hub-amber)';
  const [hover, setHover] = useState(false);
  return (
    <div
      className="wf-title"
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 22, cursor: 'grab', flexShrink: 0, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '0 3px',
        borderBottom: hover ? `1px solid ${accent}55` : '1px solid transparent',
        transition: 'border 0.15s, background 0.15s',
        background: hover ? `linear-gradient(180deg, ${accent}11, transparent)` : 'transparent',
      }}
    >
      {/* grip dots */}
      <span style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex', gap: 3,
        opacity: hover ? 1 : 0.5, transition: 'opacity 0.15s',
        pointerEvents: 'none',
      }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} style={{ width: 2, height: 2, background: 'var(--hub-cream-faint)' }} />
        ))}
      </span>
      {/* floating code chip */}
      <span style={{
        position: 'absolute', top: 22, left: 0,
        padding: '2px 8px',
        background: 'var(--hub-bg-2)',
        border: `1px solid ${accent}44`,
        borderTop: 'none', borderLeft: 'none',
        fontSize: 7.5, letterSpacing: '0.2em',
        color: accent, textShadow: `0 0 4px ${accent}aa`,
        zIndex: 3, pointerEvents: 'none',
      }}>{meta.code}·{String(data.id).padStart(3, '0')}</span>
      <CloseBtn onClose={onClose} size={16} style={{ opacity: hover ? 1 : 0.4, transition: 'opacity 0.15s' }} />
    </div>
  );
}

// ─── STRIP ────────────────────────────────────────────────────────────────────

function HeaderStrip({ meta, data, onDragStart, onClose }: HeaderProps) {
  const accent = meta.color || 'var(--hub-amber)';
  return (
    <>
      <div
        className="wf-title"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        style={{
          height: 22, flexShrink: 0,
          background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, var(--hub-bg-2)), var(--hub-bg-2))`,
          borderBottom: `1px solid ${accent}44`,
          display: 'flex', alignItems: 'center',
          padding: '0 4px 0 10px', gap: 8,
          cursor: 'grab',
          fontSize: 8, letterSpacing: '0.22em',
          color: accent, fontWeight: 600,
        }}
      >
        <Led color={meta.led || 'amber'} size="sm" />
        <span style={{
          flex: 1, textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} className="wf-title-text">
          {meta.code}·{String(data.id).padStart(3, '0')}
        </span>
        <CloseBtn onClose={onClose} size={16} />
      </div>
      {/* vertical spine */}
      <div style={{
        position: 'absolute', left: 0, top: 22, bottom: 0,
        width: 18, background: 'var(--hub-bg-2)',
        borderRight: `1px solid ${accent}44`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 3, pointerEvents: 'none',
      }}>
        <span style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          fontSize: 9, fontWeight: 600,
          color: accent, letterSpacing: '0.3em',
          textShadow: `0 0 4px ${accent}66`,
          fontFamily: 'var(--hub-font-mono)',
          whiteSpace: 'nowrap',
        }} className="wf-title-text">{meta.title}</span>
      </div>
    </>
  );
}
