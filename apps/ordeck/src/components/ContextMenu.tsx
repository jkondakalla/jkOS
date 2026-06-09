import { useState, useEffect, useRef } from 'react';
import { Led } from './hardware';
import { CloseBtn } from './canvas/WidgetHeaders';
import { WidgetInstance, WidgetOverrides } from '@jkos/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextMeta {
  type: string;
  title: string;
  code: string;
  glyph: string;
  color: string;
  header?: string;
  subtitle?: string;
  led?: string;
}

interface ContextWindow {
  id: string;
}

export interface ContextState {
  widgetId: number;
  anchor: { x: number; y: number };
  showPalette: boolean;
  windows: ContextWindow[];
  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const ACCENT_OPTIONS = [
  { id: 'inherit',  label: 'INHERIT', swatch: 'var(--hub-amber)' },
  { id: '#ffb000', label: 'AMBER',   swatch: '#ffb000' },
  { id: '#5cd66a', label: 'GREEN',   swatch: '#5cd66a' },
  { id: '#4ecdc4', label: 'CYAN',    swatch: '#4ecdc4' },
  { id: '#a8d8ff', label: 'ICE',     swatch: '#a8d8ff' },
  { id: '#c08aff', label: 'VIOLET',  swatch: '#c08aff' },
  { id: '#ff7a9a', label: 'ROSE',    swatch: '#ff7a9a' },
  { id: '#ff3aa1', label: 'HOTPINK', swatch: '#ff3aa1' },
  { id: '#ff7a3a', label: 'RUST',    swatch: '#ff7a3a' },
  { id: '#5affc1', label: 'MINT',    swatch: '#5affc1' },
  { id: '#aeff1e', label: 'LIME',    swatch: '#aeff1e' },
  { id: '#ff944a', label: 'SUNSET',  swatch: '#ff944a' },
];

const HEADER_OPTIONS = [
  { id: 'classic', label: 'CLASSIC', desc: 'screws + LED + title + code' },
  { id: 'band',    label: 'BAND',    desc: 'fat colored header + big glyph' },
  { id: 'tab',     label: 'TAB',     desc: 'folder tab + dashed horizon' },
  { id: 'chip',    label: 'CHIP',    desc: 'minimal grip strip + corner code' },
  { id: 'strip',   label: 'STRIP',   desc: 'vertical title spine left edge' },
];

const TEXT_SCALES = [
  { id: 0.85, label: 'XS' },
  { id: 0.95, label: 'SM' },
  { id: 1.0,  label: 'MD' },
  { id: 1.15, label: 'LG' },
  { id: 1.3,  label: 'XL' },
];

const SHAPE_OPTIONS = [
  { id: 0,  label: 'SHARP' },
  { id: 4,  label: 'SOFT' },
  { id: 10, label: 'ROUND' },
  { id: 18, label: 'PILL' },
];

const BORDER_OPTIONS = [
  { id: 'solid',  label: 'SOLID' },
  { id: 'dashed', label: 'DASHED' },
  { id: 'dotted', label: 'DOTTED' },
  { id: 'double', label: 'DOUBLE' },
  { id: 'none',   label: 'NONE' },
];

const SIZE_PRESETS: Record<string, { w: number; h: number }> = {
  S: { w: 5, h: 4 }, M: { w: 8, h: 6 }, L: { w: 12, h: 8 }, XL: { w: 16, h: 10 },
};

// ─── Position helpers ─────────────────────────────────────────────────────────

function clampLeft(x: number, w: number) {
  return Math.max(8, Math.min(window.innerWidth - w - 8, x));
}
function clampTop(y: number, h: number) {
  return Math.max(8, Math.min(window.innerHeight - h - 8, y));
}

// ─── Context System ───────────────────────────────────────────────────────────

interface ContextSystemProps {
  state: ContextState | null;
  widgets: WidgetInstance[];
  registry: Record<string, ContextMeta>;
  onUpdate: (id: number, patch: Partial<WidgetInstance>) => void;
  onAction: (id: number, act: string) => void;
  onClose: () => void;
}

export function ContextSystem({ state, widgets, registry, onUpdate, onAction, onClose }: ContextSystemProps) {
  return (
    <>
      {state && (
        <div
          onClick={onClose}
          onContextMenu={e => { e.preventDefault(); onClose(); }}
          style={{ position: 'fixed', inset: 0, zIndex: 215, background: 'transparent' }}
        />
      )}
      {state && (() => {
        const widget = widgets.find(w => w.id === state.widgetId);
        if (!widget) return null;
        const meta = registry[widget.type];
        if (!meta) return null;
        return (
          <>
            {state.showPalette && (
              <ContextPalette
                anchor={state.anchor}
                widget={widget}
                meta={meta}
                onPick={cat => state.openWindow(cat)}
                onClose={onClose}
              />
            )}
            {state.windows.map((w, i) => (
              <ContextWindowPanel
                key={w.id}
                id={w.id}
                stack={i}
                anchor={state.anchor}
                widget={widget}
                meta={meta}
                onUpdate={patch => onUpdate(widget.id, patch)}
                onAction={act => onAction(widget.id, act)}
                onClose={() => state.closeWindow(w.id)}
              />
            ))}
          </>
        );
      })()}
    </>
  );
}

// ─── Main Palette ─────────────────────────────────────────────────────────────

const PALETTE_CATS = [
  { id: 'header',  label: 'HEADER',  glyph: '▤', desc: 'TITLE BAR STYLE' },
  { id: 'accent',  label: 'ACCENT',  glyph: '◉', desc: 'COLOR' },
  { id: 'text',    label: 'TEXT',    glyph: 'A',  desc: 'SIZE · TITLE' },
  { id: 'shape',   label: 'SHAPE',   glyph: '◯', desc: 'CORNERS · BORDER' },
  { id: 'size',    label: 'SIZE',    glyph: '⊞', desc: 'PRESETS' },
  { id: 'actions', label: 'ACTIONS', glyph: '⌘', desc: 'COPY · RESET' },
];

interface ContextPaletteProps {
  anchor: { x: number; y: number };
  widget: WidgetInstance;
  meta: ContextMeta;
  onPick: (cat: string) => void;
  onClose: () => void;
}

function ContextPalette({ anchor, widget, meta, onPick, onClose }: ContextPaletteProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed',
        left: clampLeft(anchor.x, 240),
        top: clampTop(anchor.y, 280),
        width: 240, zIndex: 220,
        background: 'linear-gradient(180deg, var(--hub-bg-2), var(--hub-bg-1))',
        border: '1px solid var(--hub-line-strong)',
        boxShadow: '0 14px 32px rgba(0,0,0,0.7)',
        fontFamily: 'var(--hub-font-mono)',
      }}
    >
      <div style={{
        padding: '8px 10px 6px',
        background: 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))',
        borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: meta.color || 'var(--hub-amber)', fontSize: 12 }}>{meta.glyph}</span>
        <span style={{
          flex: 1, fontSize: 10, letterSpacing: '0.15em',
          color: 'var(--hub-amber)', fontWeight: 600,
        }} className="glow-dim">{meta.title}</span>
        <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em' }}>
          {meta.code}·{String(widget.id).padStart(3, '0')}
        </span>
      </div>
      <div style={{ padding: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {PALETTE_CATS.map(c => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            onMouseEnter={e => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--hub-amber-dim)';
              el.style.background = 'var(--hub-bg-3)';
              el.style.color = 'var(--hub-amber)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--hub-line)';
              el.style.background = 'var(--hub-bg-2)';
              el.style.color = 'var(--hub-cream)';
            }}
            style={{
              display: 'grid', gridTemplateColumns: '20px 1fr',
              gap: 8, alignItems: 'center',
              padding: '8px 8px',
              background: 'var(--hub-bg-2)',
              border: '1px solid var(--hub-line)',
              color: 'var(--hub-cream)',
              cursor: 'pointer', textAlign: 'left',
              fontFamily: 'var(--hub-font-mono)', transition: 'all 0.1s',
            }}
          >
            <span style={{ fontFamily: 'var(--hub-font-seg)', fontSize: 14, fontWeight: 700, textAlign: 'center' }}>{c.glyph}</span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, gap: 2 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 600 }}>{c.label}</span>
              <span style={{ fontSize: 7, letterSpacing: '0.12em', color: 'var(--hub-cream-faint)' }}>{c.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <div style={{
        padding: '6px 10px',
        background: 'var(--hub-bg-0)', borderTop: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 7.5, letterSpacing: '0.18em', color: 'var(--hub-cream-faint)',
      }}>
        <span>RIGHT-CLICK · WIDGET</span>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none',
          color: 'var(--hub-cream-dim)', fontSize: 10,
          cursor: 'pointer', letterSpacing: '0.15em',
        }}>ESC ⌫</button>
      </div>
    </div>
  );
}

// ─── Floating Context Window ──────────────────────────────────────────────────

interface ContextWindowPanelProps {
  id: string;
  stack: number;
  anchor: { x: number; y: number };
  widget: WidgetInstance;
  meta: ContextMeta;
  onUpdate: (patch: Partial<WidgetInstance>) => void;
  onAction: (act: string) => void;
  onClose: () => void;
}

function ContextWindowPanel({ id, stack, anchor, widget, meta, onUpdate, onAction, onClose }: ContextWindowPanelProps) {
  const dragHandle = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => ({
    left: clampLeft(anchor.x, 280) + 12 + stack * 18,
    top: clampTop(anchor.y, 240) + 12 + stack * 18,
  }));

  useEffect(() => {
    const h = dragHandle.current;
    if (!h) return;
    let s0: { x: number; y: number; l: number; t: number } | null = null;
    const md = (e: MouseEvent) => {
      if ((e.target as Element)?.closest('[data-no-drag]')) return;
      s0 = { x: e.clientX, y: e.clientY, l: pos.left, t: pos.top };
      const mm = (ev: MouseEvent) => {
        if (!s0) return;
        setPos({ left: Math.max(0, s0.l + ev.clientX - s0.x), top: Math.max(0, s0.t + ev.clientY - s0.y) });
      };
      const mu = () => {
        s0 = null;
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    };
    h.addEventListener('mousedown', md);
    return () => h.removeEventListener('mousedown', md);
  }, [pos]);

  const sectionDef = SECTION_DEFS[id];
  if (!sectionDef) return null;
  const { title, render } = sectionDef;

  return (
    <div
      onClick={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed', left: pos.left, top: pos.top,
        width: 280, zIndex: 230 + stack,
        background: 'linear-gradient(180deg, var(--hub-bg-2), var(--hub-bg-1))',
        border: '1px solid var(--hub-line-strong)',
        boxShadow: '0 14px 36px rgba(0,0,0,0.7)',
        fontFamily: 'var(--hub-font-mono)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div ref={dragHandle} style={{
        padding: '7px 8px 7px 10px',
        background: 'linear-gradient(180deg, var(--hub-bg-3), var(--hub-bg-2))',
        borderBottom: '1px solid var(--hub-line)',
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'grab', flexShrink: 0,
      }}>
        <Led color="amber" size="sm" />
        <span style={{
          fontSize: 9, letterSpacing: '0.18em',
          color: 'var(--hub-amber)', fontWeight: 600,
        }} className="glow-dim">{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 7, letterSpacing: '0.15em', color: 'var(--hub-cream-faint)' }}>
          #{String(widget.id).padStart(3, '0')}
        </span>
        <CloseBtn onClose={onClose} size={16} />
      </div>
      <div data-no-drag="true" style={{ padding: 10 }}>
        {render({ widget, meta, onUpdate, onAction })}
      </div>
    </div>
  );
}

// ─── Section renderers ────────────────────────────────────────────────────────

interface SectionRenderProps {
  widget: WidgetInstance;
  meta: ContextMeta;
  onUpdate: (patch: Partial<WidgetInstance>) => void;
  onAction: (act: string) => void;
}

const SECTION_DEFS: Record<string, { title: string; render: (p: SectionRenderProps) => React.ReactNode }> = {
  header: {
    title: 'HEADER · STYLE',
    render: ({ widget, meta, onUpdate }) => (
      <RadioStack
        options={HEADER_OPTIONS}
        value={(widget.overrides?.header ?? meta.header ?? 'classic') as string}
        onChange={v => onUpdate({ overrides: { ...widget.overrides, header: v as WidgetOverrides['header'] } })}
      />
    ),
  },
  accent: {
    title: 'ACCENT · COLOR',
    render: ({ widget, onUpdate }) => (
      <SwatchPick
        options={ACCENT_OPTIONS}
        value={widget.overrides?.color ?? 'inherit'}
        onChange={v => onUpdate({ overrides: { ...widget.overrides, color: v === 'inherit' ? undefined : v } })}
      />
    ),
  },
  text: {
    title: 'TEXT · SIZE & TITLE',
    render: ({ widget, meta, onUpdate }) => {
      const scale = widget.overrides?.textScale ?? 1;
      const title = widget.overrides?.title ?? meta.title;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <FieldRow label="SIZE">
            <Segmented
              options={TEXT_SCALES}
              value={scale}
              onChange={v => onUpdate({ overrides: { ...widget.overrides, textScale: v as number } })}
            />
          </FieldRow>
          <FieldRow label="TITLE">
            <input
              value={title}
              onChange={e => onUpdate({ overrides: { ...widget.overrides, title: e.target.value } })}
              spellCheck={false}
              style={{
                width: '100%', background: 'var(--hub-bg-0)',
                border: '1px solid var(--hub-line-strong)',
                color: 'var(--hub-amber)', fontFamily: 'var(--hub-font-mono)',
                fontSize: 11, padding: '5px 7px', letterSpacing: '0.08em', outline: 'none',
              }}
            />
          </FieldRow>
          <button
            onClick={() => onUpdate({ overrides: { ...widget.overrides, title: undefined, textScale: undefined } })}
            style={{ background: 'transparent', border: 'none', color: 'var(--hub-amber-dim)', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--hub-font-mono)', padding: 0 }}
          >· reset title & size</button>
        </div>
      );
    },
  },
  shape: {
    title: 'SHAPE · CORNERS',
    render: ({ widget, onUpdate }) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FieldRow label="CORNERS">
          <Segmented
            options={SHAPE_OPTIONS}
            value={widget.overrides?.radius ?? 0}
            onChange={v => onUpdate({ overrides: { ...widget.overrides, radius: v as number } })}
          />
        </FieldRow>
        <FieldRow label="BORDER">
          <Segmented
            options={BORDER_OPTIONS}
            value={widget.overrides?.borderStyle ?? 'solid'}
            onChange={v => onUpdate({ overrides: { ...widget.overrides, borderStyle: v as WidgetOverrides['borderStyle'] } })}
          />
        </FieldRow>
        <FieldRow label="OPACITY">
          <input type="range" min={0.4} max={1} step={0.05}
            value={widget.overrides?.opacity ?? 1}
            onChange={e => onUpdate({ overrides: { ...widget.overrides, opacity: parseFloat(e.target.value) } })}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: 9, color: 'var(--hub-amber)', minWidth: 36, textAlign: 'right', fontFamily: 'var(--hub-font-seg)' }} className="glow-dim">
            {Math.round((widget.overrides?.opacity ?? 1) * 100)}%
          </span>
        </FieldRow>
      </div>
    ),
  },
  size: {
    title: 'SIZE · PRESETS',
    render: ({ onUpdate }) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {Object.entries(SIZE_PRESETS).map(([k, p]) => (
            <button key={k} onClick={() => onUpdate({ w: p.w, h: p.h })}
              onMouseEnter={e => { Object.assign(e.currentTarget.style, { background: 'var(--hub-bg-3)', borderColor: 'var(--hub-amber-dim)', color: 'var(--hub-amber)' }); }}
              onMouseLeave={e => { Object.assign(e.currentTarget.style, { background: 'var(--hub-bg-2)', borderColor: 'var(--hub-line)', color: 'var(--hub-cream)' }); }}
              style={{ padding: '8px 4px', background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line)', color: 'var(--hub-cream)', fontFamily: 'var(--hub-font-mono)', cursor: 'pointer', transition: 'all 0.1s' }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{k}</div>
              <div style={{ fontSize: 7, color: 'var(--hub-cream-faint)', letterSpacing: '0.12em' }}>{p.w}×{p.h}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.15em', textAlign: 'center' }}>
          // ALSO RESIZABLE FROM CORNER //
        </div>
      </div>
    ),
  },
  actions: {
    title: 'ACTIONS',
    render: ({ onUpdate, onAction }) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <ActionRow label="BRING TO FRONT" code="z+"  onClick={() => onAction('front')} />
        <ActionRow label="DUPLICATE"       code="⌘D" onClick={() => onAction('duplicate')} />
        <ActionRow label="RESET OVERRIDES" code="↻"  onClick={() => onUpdate({ overrides: {} })} />
        <div style={{ height: 1, background: 'var(--hub-line)', margin: '4px 0' }} />
        <ActionRow label="CLOSE WIDGET"    code="×"  onClick={() => onAction('close')} danger />
      </div>
    ),
  },
};

// ─── Shared sub-widgets ───────────────────────────────────────────────────────

function RadioStack({ options, value, onChange }: {
  options: { id: string; label: string; desc: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            display: 'grid', gridTemplateColumns: '12px 1fr',
            alignItems: 'center', gap: 8, padding: '7px 8px', textAlign: 'left',
            background: active ? 'var(--hub-bg-0)' : 'var(--hub-bg-2)',
            border: `1px solid ${active ? 'var(--hub-amber)' : 'var(--hub-line)'}`,
            boxShadow: active ? 'inset 0 0 6px var(--hub-amber-glow)' : 'none',
            color: active ? 'var(--hub-amber)' : 'var(--hub-cream)',
            cursor: 'pointer', fontFamily: 'var(--hub-font-mono)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              border: '1px solid currentColor',
              background: active ? 'currentColor' : 'transparent',
              boxShadow: active ? '0 0 4px currentColor' : 'none',
            }} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 600 }}>{o.label}</span>
              <span style={{ fontSize: 7.5, color: active ? 'var(--hub-amber-dim)' : 'var(--hub-cream-faint)', letterSpacing: '0.1em' }}>{o.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SwatchPick({ options, value, onChange }: {
  options: { id: string; label: string; swatch: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} title={o.label} style={{
            padding: '6px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: active ? 'var(--hub-bg-0)' : 'var(--hub-bg-2)',
            border: `1px solid ${active ? o.swatch : 'var(--hub-line)'}`,
            boxShadow: active ? `inset 0 0 8px ${o.swatch}44` : 'none',
            cursor: 'pointer',
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%',
              background: o.swatch,
              boxShadow: active ? `0 0 8px ${o.swatch}` : `0 0 3px ${o.swatch}55`,
              border: '1px solid rgba(0,0,0,0.4)', position: 'relative',
              display: 'grid', placeItems: 'center',
            }}>
              {o.id === 'inherit' && <span style={{ fontSize: 9, color: 'var(--hub-bg-0)', fontWeight: 700 }}>=</span>}
            </span>
            <span style={{ fontSize: 6.5, letterSpacing: '0.1em', color: active ? 'var(--hub-amber)' : 'var(--hub-cream-dim)' }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Segmented({ options, value, onChange }: {
  options: { id: number | string; label: string }[];
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line-strong)',
    }}>
      {options.map((o, i) => {
        const active = value === o.id;
        return (
          <button key={String(o.id)} onClick={() => onChange(o.id)} style={{
            padding: '6px 4px',
            background: active ? 'var(--hub-amber-deep)' : 'transparent',
            color: active ? 'var(--hub-amber)' : 'var(--hub-cream-dim)',
            borderLeft: i > 0 ? '1px solid var(--hub-line)' : 'none',
            fontSize: 9, letterSpacing: '0.12em', fontWeight: 600,
            cursor: 'pointer',
            boxShadow: active ? 'inset 0 0 6px var(--hub-amber-glow)' : 'none',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--hub-cream-faint)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function ActionRow({ label, code, onClick, danger }: {
  label: string; code: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = danger ? 'var(--hub-red)' : 'var(--hub-amber-dim)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--hub-line)'; }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 8px', background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line)',
        color: danger ? 'var(--hub-red)' : 'var(--hub-cream)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--hub-font-mono)',
        fontSize: 10, letterSpacing: '0.12em',
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 8, color: 'var(--hub-cream-faint)', letterSpacing: '0.18em' }}>{code}</span>
    </button>
  );
}
