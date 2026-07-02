/**
 * workshop/Inspector.tsx — properties for whatever is selected on the canvas.
 *
 * Direct manipulation covers structure (add/move/resize); this panel covers the
 * rest — bindings (fixed vs live data), tones, variants, and the command wiring
 * on form/button nodes. Tap a node → its properties; tap the card background →
 * the widget's own identity/frame/sources/sizing. The workshop hosts it as a
 * side panel on desktop and a bottom sheet on touch tiers.
 *
 * Every edit lands as a patch on the ENode tree (onPatch/onPatchForm) — there is
 * no parallel editor model to drift.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSuiteApps, fetchCapabilities, type AppId, type CapabilityDoc } from '@jkos/weave';
import { HUD_SCHEMA, HUD_ITEM_FIELDS } from '../pages/hud/useHudData';
import type { Binding, CommandRef, Tone, ToneBinding, WidgetNode } from '../hud/types';
import { catalogEntry, type ENode } from './model';

/* ── binding edit model (lit vs data), shared by every field ────────────── */

type EB = { mode: 'lit' | 'data'; lit: string; src: string; path: string };
const eb = (lit = ''): EB => ({ mode: 'lit', lit, src: 'systems', path: '' });

function bindingToEb(b?: Binding): EB {
  if (b == null) return eb('');
  if (typeof b !== 'object') return eb(String(b));
  if ('lit' in b) return eb(b.lit == null ? '' : String(b.lit));
  return { mode: 'data', lit: '', src: b.src, path: b.path || '' };
}
function ebToBinding(b: EB): Binding {
  return b.mode === 'data' ? { src: b.src, ...(b.path ? { path: b.path } : {}) } : b.lit;
}

export const HUD_SOURCES = Object.keys(HUD_SCHEMA);
const KNOWN_SUGGEST = [...HUD_SOURCES, '$'];
export function pathSuggestions(src: string): string[] {
  if (src === '$') return HUD_ITEM_FIELDS;
  const s = HUD_SCHEMA[src];
  return s ? [...s.scalars, ...(s.arrays ?? [])] : [];
}

/* ── shared field styling (same vocabulary as the old workshop forms) ───── */

const field: CSSProperties = {
  background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', color: 'var(--hub-cream-bright)',
  fontFamily: 'var(--hub-font-mono)', fontSize: 12, padding: '5px 8px', borderRadius: 'var(--hub-radius-sm)', minWidth: 0,
};
const ghostBtn: CSSProperties = { ...field, cursor: 'pointer' };
const rowLine: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 };
const hintStyle: CSSProperties = { fontSize: 11, lineHeight: 1.5, color: 'var(--hub-cream-dim)', margin: '8px 0 0' };
const tag = (t: string) => (
  <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--hub-cream-dim)', width: 64, flex: 'none' }}>{t}</span>
);

function Line({ t, children }: { t: string; children: ReactNode }) {
  return <div style={rowLine}>{tag(t)}{children}</div>;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select style={{ ...field, flex: 'none' }} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n || lo));

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, color: 'var(--hub-cream-faint)' }}>{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(clampN(Number(e.target.value), min, max))} style={{ ...field, width: 48 }} />
    </span>
  );
}

/** One binding field: fixed value or live source+path. `optional` maps an empty
 *  literal back to "unset" so the prop is dropped from the spec. */
function BindField({ value, onChange, sources, optional }: {
  value: Binding | undefined;
  onChange: (b: Binding | undefined) => void;
  sources: string[];
  optional?: boolean;
}) {
  const b = bindingToEb(value);
  const emit = (next: EB) => {
    if (optional && next.mode === 'lit' && next.lit === '') onChange(undefined);
    else onChange(ebToBinding(next));
  };
  const known = KNOWN_SUGGEST.includes(b.src);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <Select value={b.mode} onChange={(m) => emit({ ...b, mode: m as EB['mode'] })} options={['lit', 'data']} />
      {b.mode === 'lit' ? (
        <input style={{ ...field, flex: 1 }} value={b.lit} placeholder="fixed value" onChange={(e) => emit({ ...b, lit: e.target.value })} />
      ) : (
        <>
          <Select value={b.src} onChange={(s) => emit({ ...b, src: s })} options={sources} />
          <input style={{ ...field, flex: 1 }} list={known ? `pl-${b.src}` : undefined} value={b.path}
            placeholder="field" onChange={(e) => emit({ ...b, path: e.target.value })} />
        </>
      )}
    </span>
  );
}

const TONES: Tone[] = ['ok', 'warn', 'danger', 'accent', 'muted'];
const SIZES = ['md', 'sm', 'xs'];
const VARIANTS = ['title', 'body', 'sub', 'mono'];
const JUSTIFY = ['flex-start', 'center', 'space-between', 'flex-end'];
const ALIGN = ['center', 'flex-start', 'flex-end', 'baseline', 'stretch'];
const ICON_NAMES = ['sun', 'moon', 'cloud', 'rain', 'bolt', 'check', 'book', 'clock', 'calendar', 'activity', 'star', 'alert', 'dot'];
const ITYPES = ['text', 'number', 'date', 'time'];

/** Tone that may be fixed OR data-bound (list rows colouring from $.tone). */
function ToneField({ value, onChange, sources }: {
  value: ToneBinding | undefined;
  onChange: (v: Tone | { src: string; path?: string } | undefined) => void;
  sources: string[];
}) {
  const isData = value != null && typeof value === 'object' && 'src' in value;
  const mode = isData ? 'data' : 'fixed';
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <Select value={mode} onChange={(m) => onChange(m === 'data' ? { src: '$', path: 'tone' } : 'ok')} options={['fixed', 'data']} />
      {isData ? (
        <>
          <Select value={(value as { src: string }).src} onChange={(s) => onChange({ src: s, path: (value as { path?: string }).path })} options={sources} />
          <input style={{ ...field, flex: 1 }} value={(value as { path?: string }).path || ''} placeholder="field"
            onChange={(e) => onChange({ src: (value as { src: string }).src, ...(e.target.value ? { path: e.target.value } : {}) })} />
        </>
      ) : (
        <Select value={typeof value === 'string' ? value : 'ok'} onChange={(v) => onChange(v as Tone)} options={TONES} />
      )}
    </span>
  );
}

/* ── command wiring (form / button) ─────────────────────────────────────── */

type CapDef = CapabilityDoc['capabilities'][number];
type CapField = NonNullable<CapDef['body']>[number];
type FMMode = 'input' | 'lit' | 'data' | 'skip';

const fmModeOf = (b: Binding | undefined): FMMode => {
  if (b === undefined) return 'skip';
  if (b !== null && typeof b === 'object' && 'src' in b) return b.src === '$form' ? 'input' : 'data';
  return 'lit';
};

/** The input/select/toggle controls a form needs for its $form-mapped fields —
 *  regenerated whenever the mapping changes (same shapes the old builder emitted). */
export function controlsFor(cap: CapDef | null, body: Record<string, Binding>): WidgetNode[] {
  const out: WidgetNode[] = [];
  for (const f of cap?.body ?? []) {
    const b = body[f.name];
    if (!(b && typeof b === 'object' && 'src' in b && b.src === '$form')) continue;
    if (f.type === 'enum') out.push({ t: 'select', field: f.name, options: { lit: f.enum ?? [] }, placeholder: f.label || f.name });
    else if (f.type === 'boolean') out.push({ t: 'toggle', field: f.name, label: f.label || f.name });
    else out.push({ t: 'input', field: f.name, placeholder: f.label || f.name, itype: f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'number' ? 'number' : 'text' });
  }
  return out;
}

function CommandEditor({ cmd, sources, allowInputs, onChange }: {
  cmd: CommandRef;
  sources: string[];
  /** Forms map fields to user inputs; standalone buttons can't (no $form). */
  allowInputs: boolean;
  onChange: (cmd: CommandRef, cap: CapDef | null) => void;
}) {
  const suite = useSuiteApps();
  const cmdApps = useMemo(() => Object.values(suite).filter((a) => a.capabilitiesPath), [suite]);
  const [capDoc, setCapDoc] = useState<CapabilityDoc | null>(null);

  useEffect(() => {
    if (!cmd.app) { setCapDoc(null); return; }
    let dead = false;
    fetchCapabilities(cmd.app).then((d) => { if (!dead) setCapDoc(d); });
    return () => { dead = true; };
  }, [cmd.app]);

  const cap = capDoc?.capabilities.find((c) => c.id === cmd.capability) ?? null;
  const body = cmd.body ?? {};

  /** Picking a capability seeds the mapping: required → input (lit for buttons),
   *  has-default → that literal, else skip — same defaults the old workshop used. */
  const pickCapability = (capId: string) => {
    const nextCap = capDoc?.capabilities.find((c) => c.id === capId) ?? null;
    const seeded: Record<string, Binding> = {};
    for (const f of nextCap?.body ?? []) {
      if (f.default !== undefined) seeded[f.name] = String(f.default);
      else if (f.required) seeded[f.name] = allowInputs ? { src: '$form', path: f.name } : '';
    }
    onChange({ ...cmd, capability: capId, body: seeded }, nextCap);
  };

  const setField = (f: CapField, mode: FMMode, value?: Binding) => {
    const next = { ...body };
    if (mode === 'skip') delete next[f.name];
    else if (mode === 'input') next[f.name] = { src: '$form', path: f.name };
    else if (mode === 'lit') next[f.name] = value ?? '';
    else next[f.name] = value ?? { src: 'clock', path: 'iso' };
    onChange({ ...cmd, body: next }, cap);
  };

  const modes: FMMode[] = allowInputs ? ['input', 'lit', 'data', 'skip'] : ['lit', 'data', 'skip'];

  return (
    <>
      {cmdApps.length === 0 ? (
        <p style={hintStyle}>No suite app exposes capabilities yet.</p>
      ) : (
        <Line t="app">
          <Select value={cmd.app} onChange={(v) => onChange({ app: v as AppId, capability: '', body: {} }, null)} options={['', ...cmdApps.map((a) => a.id)]} />
        </Line>
      )}
      {capDoc && (
        <Line t="action">
          <Select value={cmd.capability} onChange={pickCapability} options={['', ...capDoc.capabilities.map((c) => c.id)]} />
        </Line>
      )}
      {cap && (
        <>
          <p style={hintStyle}>
            Map each field — {allowInputs && <><b>input</b> (user fills it), </>}<b>lit</b> (fixed), <b>data</b> (live slice), or <b>skip</b>.
          </p>
          {(cap.body ?? []).map((f) => {
            const b = body[f.name];
            const mode = fmModeOf(b);
            return (
              <div key={f.name} style={{ borderTop: '1px solid var(--hub-line)', marginTop: 8, paddingTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' }}>
                    {f.name}{f.required ? ' *' : ''} <span style={{ color: 'var(--hub-cream-faint)' }}>· {f.type}</span>
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <Select value={mode} onChange={(m) => setField(f, m as FMMode)} options={modes} />
                  </span>
                </div>
                {mode === 'lit' && (
                  <div style={rowLine}>
                    <input style={{ ...field, flex: 1 }} value={typeof b === 'object' ? '' : String(b ?? '')} placeholder="fixed value"
                      onChange={(e) => setField(f, 'lit', e.target.value)} />
                  </div>
                )}
                {mode === 'data' && b && typeof b === 'object' && 'src' in b && (
                  <div style={rowLine}>
                    <Select value={b.src} onChange={(s) => setField(f, 'data', { src: s, ...(b.path ? { path: b.path } : {}) })} options={sources.filter((s) => s !== '$form')} />
                    <input style={{ ...field, flex: 1 }} list={KNOWN_SUGGEST.includes(b.src) ? `pl-${b.src}` : undefined} value={b.path || ''} placeholder="field"
                      onChange={(e) => setField(f, 'data', { src: b.src, ...(e.target.value ? { path: e.target.value } : {}) })} />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────── */

export interface FetchRow { name: string; url: string; poll: string }
export interface IdentityState {
  id: string; label: string; eyebrow: string; source: string; refresh: string;
  fetches: FetchRow[];
}
export interface SizingState { dw: number; dh: number; mw: number; mh: number }

/** [seconds, label] for the per-card refresh override; '' = auto (data-driven). */
const REFRESH_PRESETS: [string, string][] = [
  ['', 'Auto — only when data changes'],
  ['1', 'Every 1 second'], ['5', 'Every 5 seconds'], ['30', 'Every 30 seconds'],
  ['60', 'Every minute'], ['300', 'Every 5 minutes'], ['900', 'Every 15 minutes'],
];

export interface InspectorProps {
  /** The selected node, or null when the widget root (card) is selected. */
  sel: ENode | null;
  sources: string[];
  identity: IdentityState;
  onIdentity: (patch: Partial<IdentityState>) => void;
  sizing: SizingState;
  onSizing: (patch: Partial<SizingState>) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  /** Form command changed → set cmd and regenerate the control children. */
  onPatchForm: (id: string, cmd: CommandRef, controls: WidgetNode[]) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function Inspector(p: InspectorProps) {
  const { sel, sources } = p;

  /* path-suggestion datalists for every known source (referenced by BindFields) */
  const datalists = KNOWN_SUGGEST.map((s) => (
    <datalist key={s} id={`pl-${s}`}>{pathSuggestions(s).map((f) => <option key={f} value={f} />)}</datalist>
  ));

  if (!sel) {
    const idn = p.identity;
    return (
      <div className="wc-inspector">
        {datalists}
        <div className="wc-insp-head">
          <span className="hud-eyebrow">WIDGET</span>
          <span className="wc-insp-hint">tap any element to edit it</span>
        </div>
        <Line t="id"><input style={{ ...field, flex: 1 }} value={idn.id} placeholder="e.g. btc-price" onChange={(e) => p.onIdentity({ id: e.target.value })} /></Line>
        <Line t="label"><input style={{ ...field, flex: 1 }} value={idn.label} placeholder="Display name" onChange={(e) => p.onIdentity({ label: e.target.value })} /></Line>
        <Line t="eyebrow"><input style={{ ...field, flex: 1 }} value={idn.eyebrow} placeholder="Card eyebrow (optional)" onChange={(e) => p.onIdentity({ eyebrow: e.target.value })} /></Line>
        <Line t="source"><input style={{ ...field, flex: 1 }} value={idn.source} placeholder="Right-side label (optional)" onChange={(e) => p.onIdentity({ source: e.target.value })} /></Line>
        <Line t="size">
          <Num label="desk w" value={p.sizing.dw} min={1} max={12} onChange={(n) => p.onSizing({ dw: n })} />
          <Num label="h" value={p.sizing.dh} min={1} max={40} onChange={(n) => p.onSizing({ dh: n })} />
        </Line>
        <Line t="">
          <Num label="mob w" value={p.sizing.mw} min={1} max={2} onChange={(n) => p.onSizing({ mw: n })} />
          <Num label="h" value={p.sizing.mh} min={1} max={40} onChange={(n) => p.onSizing({ mh: n })} />
        </Line>
        <Line t="refresh">
          <select style={{ ...field, flex: 1 }} value={idn.refresh} onChange={(e) => p.onIdentity({ refresh: e.target.value })}>
            {REFRESH_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {idn.refresh && !REFRESH_PRESETS.some(([v]) => v === idn.refresh) && <option value={idn.refresh}>{`Every ${idn.refresh}s`}</option>}
          </select>
        </Line>
        <div style={{ marginTop: 14 }}>
          <span className="hud-eyebrow">DATA SOURCES</span>
          <p style={hintStyle}>HUD slices ({HUD_SOURCES.join(', ')}) are always available. Add any JSON endpoint here, then bind fields to it (data → name → path).</p>
          <button style={{ ...ghostBtn, marginTop: 4 }} onClick={() => p.onIdentity({ fetches: [...idn.fetches, { name: '', url: '', poll: '' }] })}>+ add source</button>
          {idn.fetches.map((f, i) => (
            <div key={i} style={rowLine}>
              <input style={{ ...field, width: 80 }} value={f.name} placeholder="name" onChange={(e) => p.onIdentity({ fetches: idn.fetches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input style={{ ...field, flex: 1 }} value={f.url} placeholder="https://api…/data.json" onChange={(e) => p.onIdentity({ fetches: idn.fetches.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <input style={{ ...field, width: 52 }} value={f.poll} placeholder="secs" onChange={(e) => p.onIdentity({ fetches: idn.fetches.map((x, j) => (j === i ? { ...x, poll: e.target.value } : x)) })} />
              <button style={ghostBtn} onClick={() => p.onIdentity({ fetches: idn.fetches.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const n = sel.node;
  const patch = (obj: Record<string, unknown>) => p.onPatch(sel.id, obj);
  const entry = catalogEntry(n.t);

  return (
    <div className="wc-inspector">
      {datalists}
      <div className="wc-insp-head">
        <span className="hud-eyebrow">{entry.label.toUpperCase()}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button style={ghostBtn} onClick={() => p.onDuplicate(sel.id)}>duplicate</button>
          <button style={{ ...ghostBtn, color: 'var(--hub-red)' }} onClick={() => p.onDelete(sel.id)}>delete</button>
        </span>
      </div>

      {(n.t === 'label' || n.t === 'text' || n.t === 'pill' || n.t === 'link') && (
        <Line t="text"><BindField value={n.text} onChange={(b) => patch({ text: b ?? '' })} sources={sources} /></Line>
      )}
      {n.t === 'label' && <Line t="size"><Select value={n.size || 'md'} onChange={(v) => patch({ size: v })} options={SIZES} /></Line>}
      {n.t === 'text' && (
        <>
          <Line t="style"><Select value={n.variant || 'body'} onChange={(v) => patch({ variant: v })} options={VARIANTS} /></Line>
          <Line t="grow"><input type="checkbox" checked={!!n.grow} onChange={(e) => patch({ grow: e.target.checked || undefined })} /></Line>
        </>
      )}
      {(n.t === 'metric' || n.t === 'bar' || n.t === 'gauge') && (
        <Line t="value"><BindField value={n.value} onChange={(b) => patch({ value: b ?? '' })} sources={sources} /></Line>
      )}
      {n.t === 'metric' && (
        <>
          <Line t="unit"><BindField value={n.unit} onChange={(b) => patch({ unit: b })} sources={sources} optional /></Line>
          <Line t="sub"><BindField value={n.sub} onChange={(b) => patch({ sub: b })} sources={sources} optional /></Line>
        </>
      )}
      {(n.t === 'bar' || n.t === 'gauge') && (
        <Line t="max"><BindField value={n.max} onChange={(b) => patch({ max: b })} sources={sources} optional /></Line>
      )}
      {n.t === 'gauge' && <Line t="caption"><BindField value={n.label} onChange={(b) => patch({ label: b })} sources={sources} optional /></Line>}
      {(n.t === 'pill' || n.t === 'dot' || n.t === 'keyval' || n.t === 'icon' || n.t === 'button') && (
        <Line t="tone"><ToneField value={n.tone} onChange={(v) => patch({ tone: v })} sources={sources} /></Line>
      )}
      {n.t === 'dot' && <Line t="pulse"><input type="checkbox" checked={!!n.pulse} onChange={(e) => patch({ pulse: e.target.checked || undefined })} /></Line>}
      {n.t === 'keyval' && (
        <>
          <Line t="label"><BindField value={n.label} onChange={(b) => patch({ label: b ?? '' })} sources={sources} /></Line>
          <Line t="value"><BindField value={n.value} onChange={(b) => patch({ value: b ?? '' })} sources={sources} /></Line>
        </>
      )}
      {n.t === 'divider' && <Line t="caption"><BindField value={n.label} onChange={(b) => patch({ label: b })} sources={sources} optional /></Line>}
      {n.t === 'link' && <Line t="url"><BindField value={n.href} onChange={(b) => patch({ href: b ?? '' })} sources={sources} /></Line>}
      {n.t === 'icon' && (
        <>
          <Line t="glyph"><Select value={typeof n.name === 'string' ? n.name : 'sun'} onChange={(v) => patch({ name: v })} options={ICON_NAMES} /></Line>
          <Line t="size"><Num label="px" value={n.size ?? 24} min={12} max={64} onChange={(v) => patch({ size: v })} /></Line>
        </>
      )}
      {n.t === 'time' && (
        <>
          <Line t="time"><BindField value={n.value} onChange={(b) => patch({ value: b ?? '' })} sources={sources} /></Line>
          <Line t="seconds"><BindField value={n.seconds} onChange={(b) => patch({ seconds: b })} sources={sources} optional /></Line>
          <Line t="line 1"><BindField value={n.sub} onChange={(b) => patch({ sub: b })} sources={sources} optional /></Line>
          <Line t="line 2"><BindField value={n.sub2} onChange={(b) => patch({ sub2: b })} sources={sources} optional /></Line>
        </>
      )}
      {(n.t === 'calendar' || n.t === 'weather') && (
        <p style={hintStyle}>Self-contained card — renders from its <code>{n.t === 'calendar' ? 'cal' : 'weather'}</code> slice, no fields to set.</p>
      )}
      {n.t === 'list' && (
        <>
          <Line t="from []"><BindField value={n.from} onChange={(b) => patch({ from: b ?? '' })} sources={sources} /></Line>
          <Line t="empty"><BindField value={n.empty} onChange={(b) => patch({ empty: b })} sources={sources} optional /></Line>
          <Line t="direction"><Select value={n.dir || 'col'} onChange={(v) => patch({ dir: v === 'row' ? 'row' : undefined })} options={['col', 'row']} /></Line>
          <p style={hintStyle}>The row template is on the canvas (EACH ITEM) — tap into it to edit; item fields bind via the <code>$</code> source.</p>
        </>
      )}
      {n.t === 'when' && (
        <>
          <Line t="show if"><BindField value={n.cond} onChange={(b) => patch({ cond: b ?? '' })} sources={sources} /></Line>
          <p style={hintStyle}>THEN/ELSE branches are edited on the canvas; the live branch is highlighted.</p>
        </>
      )}
      {(n.t === 'stack' || n.t === 'row') && (
        <>
          <Line t="gap"><Num label="px" value={n.gap ?? 8} min={0} max={40} onChange={(v) => patch({ gap: v })} /></Line>
          {n.t === 'row' && (
            <>
              <Line t="justify"><Select value={n.justify || 'flex-start'} onChange={(v) => patch({ justify: v })} options={JUSTIFY} /></Line>
              <Line t="align"><Select value={n.align || 'center'} onChange={(v) => patch({ align: v })} options={ALIGN} /></Line>
            </>
          )}
          <Line t="grow"><input type="checkbox" checked={!!n.grow} onChange={(e) => patch({ grow: e.target.checked || undefined })} /></Line>
        </>
      )}
      {n.t === 'input' && (
        <>
          <Line t="field"><input style={{ ...field, flex: 1 }} value={n.field} onChange={(e) => patch({ field: e.target.value })} /></Line>
          <Line t="placeholder"><BindField value={n.placeholder} onChange={(b) => patch({ placeholder: b })} sources={sources} optional /></Line>
          <Line t="type"><Select value={n.itype || 'text'} onChange={(v) => patch({ itype: v })} options={ITYPES} /></Line>
        </>
      )}
      {n.t === 'select' && (
        <>
          <Line t="field"><input style={{ ...field, flex: 1 }} value={n.field} onChange={(e) => patch({ field: e.target.value })} /></Line>
          <Line t="options">
            <input style={{ ...field, flex: 1 }} placeholder="comma,separated"
              value={n.options && typeof n.options === 'object' && 'lit' in n.options && Array.isArray(n.options.lit) ? (n.options.lit as unknown[]).join(',') : ''}
              onChange={(e) => patch({ options: { lit: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
          </Line>
          <Line t="placeholder"><BindField value={n.placeholder} onChange={(b) => patch({ placeholder: b })} sources={sources} optional /></Line>
        </>
      )}
      {n.t === 'toggle' && (
        <>
          <Line t="field"><input style={{ ...field, flex: 1 }} value={n.field} onChange={(e) => patch({ field: e.target.value })} /></Line>
          <Line t="label"><BindField value={n.label} onChange={(b) => patch({ label: b })} sources={sources} optional /></Line>
        </>
      )}
      {n.t === 'form' && (
        <>
          <Line t="submit"><BindField value={n.submit} onChange={(b) => patch({ submit: b ?? 'SUBMIT' })} sources={sources} /></Line>
          <CommandEditor cmd={n.cmd} sources={sources} allowInputs
            onChange={(cmd, cap) => p.onPatchForm(sel.id, cmd, controlsFor(cap, cmd.body ?? {}))} />
        </>
      )}
      {n.t === 'button' && (
        <>
          <Line t="text"><BindField value={n.text} onChange={(b) => patch({ text: b ?? '' })} sources={sources} /></Line>
          <CommandEditor cmd={n.cmd} sources={sources} allowInputs={false}
            onChange={(cmd) => patch({ cmd })} />
        </>
      )}
    </div>
  );
}
