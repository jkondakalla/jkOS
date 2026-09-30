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
import { useSuiteApps, fetchCapabilities, type AppId, type CapabilityDoc, normalizeBinding, isCondition } from '@jkos/weave';
import { HUD_SLICES, sliceFields, listItemFields } from '../hud/slices';
import type { Binding, CommandRef, DataSource, Tone, ToneBinding, WidgetNode } from '../hud/types';
import { catalogEntry, type ENode } from './model';
import { NODES, type PropSpec } from '@jkos/widgets';
import { Field, NumField, SelectField, Check } from '@jkos/ui';

/* ── binding edit model (lit vs data), shared by every field ────────────── */

/* `derived` carries what this editor cannot show — a data binding's fallback/map/fmt —
   through an edit of its source or path, and holds a CONDITION whole: the editor edits
   {src, path}, and rebuilding one from those two fields used to drop everything else. */
type EB = { mode: 'lit' | 'data' | 'cond'; lit: string; src: string; path: string; derived?: Record<string, unknown> };
const eb = (lit = ''): EB => ({ mode: 'lit', lit, src: 'systems', path: '' });

function bindingToEb(b?: Binding): EB {
  if (b == null) return eb('');
  if (typeof b !== 'object') return eb(String(b));
  if ('lit' in b) return eb(b.lit == null ? '' : String(b.lit));
  if (isCondition(b)) return { mode: 'cond', lit: '', src: '', path: '', derived: b as Record<string, unknown> };
  /* Normalised (D13): the editor speaks the canonical {src,path} form, so a spec
     carrying weave's `{from:'x'}` sugar opens in the inspector as `event.x` instead
     of showing an empty source. One binding model means one editor. */
  const n = normalizeBinding(b);
  const derived = Object.fromEntries(Object.entries({ fallback: n?.fallback, map: n?.map, fmt: n?.fmt }).filter(([, v]) => v !== undefined));
  return { mode: 'data', lit: '', src: n?.src ?? '', path: n?.path || '', derived };
}
function ebToBinding(b: EB): Binding {
  if (b.mode === 'cond') return b.derived as Binding;
  return b.mode === 'data' ? { src: b.src, ...(b.path ? { path: b.path } : {}), ...(b.derived ?? {}) } as Binding : b.lit;
}
/** What the editor carries but does not show, in one line (so it is not invisible). */
const derivedNote = (b: EB): string => (b.mode === 'cond'
  ? `condition ${JSON.stringify(b.derived)}`
  : Object.keys(b.derived ?? {}).map((k) => `${k} ${JSON.stringify(b.derived![k])}`).join(' · '));

/* The bindable surface is ORDECK's slice declaration (hud/slices.ts), typed against the
   slice interfaces — this used to be a hand-kept HUD_SCHEMA that had drifted from them. */
export const HUD_SOURCES = Object.keys(HUD_SLICES);
const KNOWN_SUGGEST = [...HUD_SOURCES, '$'];
export function pathSuggestions(src: string): string[] {
  return src === '$' ? listItemFields() : sliceFields(src);
}

/* ── shared field styling (same vocabulary as the old workshop forms) ───── */

// `field` used to be this file's private input skin. The inputs are <Field>/
// <NumField>/<SelectField> now; what is left is the LAYOUT the inspector rows
// want, which the primitives take as-is. ghostBtn is a button and still needs a
// face of its own, so it states one rather than borrowing an input's.
const field: CSSProperties = { minWidth: 0 };
const ghostBtn: CSSProperties = {
  background: 'var(--color-paper)', border: '1px solid var(--color-line)', color: 'var(--color-ink)',
  fontFamily: 'var(--jk-font-mono)', fontSize: 12, padding: '5px 8px',
  borderRadius: 'var(--jk-radius-sm)', minWidth: 0, cursor: 'pointer',
};
const rowLine: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 };
const hintStyle: CSSProperties = { fontSize: 11, lineHeight: 1.5, color: 'var(--color-faint)', margin: '8px 0 0' };
const tag = (t: string) => (
  <span style={{ fontFamily: 'var(--jk-font-mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--color-faint)', width: 64, flex: 'none' }}>{t}</span>
);

function Line({ t, children }: { t: string; children: ReactNode }) {
  return <div style={rowLine}>{tag(t)}{children}</div>;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <SelectField wrapperStyle={{ ...field, flex: 'none' }} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </SelectField>
  );
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n || lo));

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: 'var(--jk-font-mono)', fontSize: 10, color: 'var(--color-ghost)' }}>{label}</span>
      <NumField min={min} max={max} value={value} onChange={(e) => onChange(clampN(Number(e.target.value), min, max))} wrapperStyle={{ ...field, width: 48 }} />
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
  const note = derivedNote(b);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
      <Select value={b.mode} onChange={(m) => emit({ ...b, mode: m as EB['mode'], derived: m === b.mode ? b.derived : undefined })}
        options={b.mode === 'cond' ? ['cond', 'lit', 'data'] : ['lit', 'data']} />
      {b.mode === 'cond' ? null : b.mode === 'lit' ? (
        <Field style={{ ...field, flex: 1 }} value={b.lit} placeholder="fixed value" onChange={(e) => emit({ ...b, lit: e.target.value })} />
      ) : (
        <>
          <Select value={b.src} onChange={(s) => emit({ ...b, src: s })} options={sources} />
          <Field style={{ ...field, flex: 1 }} list={known ? `pl-${b.src}` : undefined} value={b.path}
            placeholder="field" onChange={(e) => emit({ ...b, path: e.target.value })} />
        </>
      )}
      {note && <span style={{ flexBasis: '100%', fontFamily: 'var(--jk-font-mono)', fontSize: 10, color: 'var(--color-ghost)', overflowWrap: 'anywhere' }}>{note}</span>}
    </span>
  );
}

const TONES: Tone[] = ['ok', 'warn', 'danger', 'accent', 'muted'];

/** Tone that may be fixed OR data-bound (list rows colouring from $.tone). */
function ToneField({ value, onChange, sources }: {
  value: ToneBinding | undefined;
  onChange: (v: ToneBinding | undefined) => void;
  sources: string[];
}) {
  const isData = value != null && typeof value === 'object' && 'src' in value;
  const mode = isData ? 'data' : 'fixed';
  // Every other key (a status → tone `map`, its `fallback`) rides through an edit.
  const data = (isData ? value : {}) as { src: string; path?: string } & Record<string, unknown>;
  const { src: _s, path: _p, ...derived } = data;
  const note = Object.keys(derived).map((k) => `${k} ${JSON.stringify(derived[k])}`).join(' · ');
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
      <Select value={mode} onChange={(m) => onChange(m === 'data' ? { src: '$', path: 'tone' } : 'ok')} options={['fixed', 'data']} />
      {isData ? (
        <>
          <Select value={data.src} onChange={(s) => onChange({ ...data, src: s } as ToneBinding)} options={sources} />
          <Field style={{ ...field, flex: 1 }} value={data.path || ''} placeholder="field"
            onChange={(e) => { const { path: _old, ...rest } = data; onChange({ ...rest, ...(e.target.value ? { path: e.target.value } : {}) } as ToneBinding); }} />
          {note && <span style={{ flexBasis: '100%', fontFamily: 'var(--jk-font-mono)', fontSize: 10, color: 'var(--color-ghost)', overflowWrap: 'anywhere' }}>{note}</span>}
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
              <div key={f.name} style={{ borderTop: '1px solid var(--color-line)', marginTop: 8, paddingTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--jk-font-mono)', fontSize: 11, color: 'var(--color-muted)' }}>
                    {f.name}{f.required ? ' *' : ''} <span style={{ color: 'var(--color-ghost)' }}>· {f.type}</span>
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <Select value={mode} onChange={(m) => setField(f, m as FMMode)} options={modes} />
                  </span>
                </div>
                {mode === 'lit' && (
                  <div style={rowLine}>
                    <Field style={{ ...field, flex: 1 }} value={typeof b === 'object' ? '' : String(b ?? '')} placeholder="fixed value"
                      onChange={(e) => setField(f, 'lit', e.target.value)} />
                  </div>
                )}
                {mode === 'data' && b && typeof b === 'object' && 'src' in b && (
                  <div style={rowLine}>
                    <Select value={b.src} onChange={(s) => setField(f, 'data', { src: s, ...(b.path ? { path: b.path } : {}) })} options={sources.filter((s) => s !== '$form')} />
                    <Field style={{ ...field, flex: 1 }} list={KNOWN_SUGGEST.includes(b.src) ? `pl-${b.src}` : undefined} value={b.path || ''} placeholder="field"
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

/* ── the generic prop editor ────────────────────────────────────────────────
 * One editor per manifest PROP TYPE, not one per node kind: every node's panel is its
 * manifest entry's props, in order, each drawn by the editor for its type. A new node
 * kind or prop needs no Inspector code — it used to need a hand-written block (and the
 * patterns would have needed seven). */

/** A prop's label, with its manifest doc as the hover. */
function PropLine({ name, spec, children }: { name: string; spec: PropSpec; children: ReactNode }) {
  return (
    <div style={rowLine} title={spec.doc}>
      <span style={{ fontFamily: 'var(--jk-font-mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--color-faint)', width: 72, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}{spec.required ? ' *' : ''}
      </span>
      {children}
    </div>
  );
}

/** A `pairs` prop (a facts grid): label + value per row, add and remove. */
function PairsEditor({ value, onChange, sources }: {
  value: { label: Binding; value: Binding; tone?: ToneBinding }[] | undefined;
  onChange: (v: { label: Binding; value: Binding; tone?: ToneBinding }[]) => void;
  sources: string[];
}) {
  const rows = value ?? [];
  const set = (i: number, part: 'label' | 'value', b: Binding | undefined) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [part]: b ?? '' } : r)));
  return (
    <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <BindField value={r.label} onChange={(b) => set(i, 'label', b)} sources={sources} />
          <BindField value={r.value} onChange={(b) => set(i, 'value', b)} sources={sources} />
          <button style={ghostBtn} onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button style={{ ...ghostBtn, justifySelf: 'start' }} onClick={() => onChange([...rows, { label: 'Label', value: '' }])}>+ add</button>
    </div>
  );
}

function PropEditor({ name, spec, node, sources, onChange, onCmd }: {
  name: string;
  spec: PropSpec;
  node: WidgetNode;
  sources: string[];
  onChange: (v: unknown) => void;
  onCmd: (cmd: CommandRef, cap: CapDef | null) => void;
}) {
  const v = (node as unknown as Record<string, unknown>)[name];
  // A per-row prop reads `$` (a row of the node's `from`); an answer reads $result/$job.
  const scoped = spec.result ? [...sources.filter((s) => s !== '$'), '$result', '$job'] : sources;
  switch (spec.type) {
    case 'node':
    case 'nodes':
      return null;   // children are edited on the canvas
    case 'cmd':
      return <CommandEditor cmd={(v as CommandRef) ?? { app: '' as AppId, capability: '' }} sources={sources} allowInputs={node.t === 'form'} onChange={onCmd} />;
    case 'tone':
      return <PropLine name={name} spec={spec}><ToneField value={v as ToneBinding | undefined} onChange={onChange} sources={scoped} /></PropLine>;
    case 'number': {
      const n = typeof v === 'number' ? v : spec.default ?? spec.min ?? 0;
      return (
        <PropLine name={name} spec={spec}>
          <Num label="" value={n} min={spec.min ?? 0} max={spec.max ?? 999}
            onChange={(x) => onChange(spec.default !== undefined && x === spec.default ? undefined : x)} />
        </PropLine>
      );
    }
    case 'boolean':
      return <PropLine name={name} spec={spec}><Check checked={!!v} onChange={(next) => onChange(next || undefined)} /></PropLine>;
    case 'enum':
      return (
        <PropLine name={name} spec={spec}>
          <Select value={typeof v === 'string' ? v : ''} onChange={(x) => onChange(x || undefined)}
            options={[...(spec.required ? [] : ['']), ...(spec.values ?? [])]} />
        </PropLine>
      );
    case 'string':
    case 'field':
      return (
        <PropLine name={name} spec={spec}>
          <Field style={{ ...field, flex: 1 }} value={typeof v === 'string' ? v : ''} placeholder={spec.type === 'field' ? 'field name' : ''}
            onChange={(e) => onChange(e.target.value || (spec.required ? '' : undefined))} />
        </PropLine>
      );
    case 'pairs':
      return <PropLine name={name} spec={spec}><PairsEditor value={v as never} onChange={onChange} sources={sources} /></PropLine>;
    case 'binding':
      if (spec.list) {
        const lit = v && typeof v === 'object' && 'lit' in (v as object) && Array.isArray((v as { lit: unknown }).lit) ? (v as { lit: unknown[] }).lit : [];
        return (
          <PropLine name={name} spec={spec}>
            <Field style={{ ...field, flex: 1 }} placeholder="comma, separated" value={lit.join(',')}
              onChange={(e) => onChange({ lit: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </PropLine>
        );
      }
      return (
        <PropLine name={name} spec={spec}>
          <BindField value={v as Binding | undefined} onChange={(b) => onChange(b ?? (spec.required ? '' : undefined))} sources={scoped} optional={!spec.required} />
        </PropLine>
      );
    default:
      return null;
  }
}

/* ── the panel ──────────────────────────────────────────────────────────── */

export interface FetchRow { name: string; url: string; poll: string }
export interface IdentityState {
  id: string; label: string; eyebrow: string; source: string; refresh: string;
  fetches: FetchRow[];
  /** Dataset sources, carried through an edit whole. This panel edits external fetch
   *  rows only; dropping the rest on load is how a republish used to lose them. */
  declared: Record<string, DataSource>;
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
  /** The body is a lone calendar/weather/time molecule — it owns its own chrome
   *  (the clock renders raw), so the eyebrow/source captions are dropped on
   *  publish. Surface that instead of letting the edit vanish silently. */
  moleculeOnly?: boolean;
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
        <Line t="id"><Field style={{ ...field, flex: 1 }} value={idn.id} placeholder="e.g. btc-price" onChange={(e) => p.onIdentity({ id: e.target.value })} /></Line>
        <Line t="label"><Field style={{ ...field, flex: 1 }} value={idn.label} placeholder="Display name" onChange={(e) => p.onIdentity({ label: e.target.value })} /></Line>
        {p.moleculeOnly ? (
          <p style={hintStyle}>This is a self-contained calendar/weather/clock — it draws itself (the clock sits raw on the background), so eyebrow/source don't apply. Add another element beside it to get a framed card.</p>
        ) : (
          <>
            <Line t="eyebrow"><Field style={{ ...field, flex: 1 }} value={idn.eyebrow} placeholder="Card eyebrow (optional)" onChange={(e) => p.onIdentity({ eyebrow: e.target.value })} /></Line>
            <Line t="source"><Field style={{ ...field, flex: 1 }} value={idn.source} placeholder="Right-side label (optional)" onChange={(e) => p.onIdentity({ source: e.target.value })} /></Line>
          </>
        )}
        <Line t="size">
          <Num label="desk w" value={p.sizing.dw} min={1} max={12} onChange={(n) => p.onSizing({ dw: n })} />
          <Num label="h" value={p.sizing.dh} min={1} max={40} onChange={(n) => p.onSizing({ dh: n })} />
        </Line>
        <Line t="">
          <Num label="mob w" value={p.sizing.mw} min={1} max={2} onChange={(n) => p.onSizing({ mw: n })} />
          <Num label="h" value={p.sizing.mh} min={1} max={40} onChange={(n) => p.onSizing({ mh: n })} />
        </Line>
        <Line t="refresh">
          <SelectField wrapperStyle={{ ...field, flex: 1 }} value={idn.refresh} onChange={(e) => p.onIdentity({ refresh: e.target.value })}>
            {REFRESH_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {idn.refresh && !REFRESH_PRESETS.some(([v]) => v === idn.refresh) && <option value={idn.refresh}>{`Every ${idn.refresh}s`}</option>}
          </SelectField>
        </Line>
        <div style={{ marginTop: 14 }}>
          <span className="hud-eyebrow">DATA SOURCES</span>
          <p style={hintStyle}>HUD slices ({HUD_SOURCES.join(', ')}) are always available. Suite data is a dataset an app declares — <code>{'{ kind: "dataset", app, dataset }'}</code>. Below: an EXTERNAL public https endpoint (no cookies are sent; a suite URL is refused).</p>
          {Object.entries(idn.declared).map(([name, s]) => (
            <div key={name} style={{ ...rowLine, fontFamily: 'var(--jk-font-mono)', fontSize: 11, color: 'var(--color-faint)' }}>
              <span style={{ color: 'var(--color-muted)' }}>{name}</span>
              <span>{s.kind === 'dataset' ? `${s.app}.${s.dataset}${s.params ? ` ${JSON.stringify(s.params)}` : ''}` : s.kind}</span>
            </div>
          ))}
          <button style={{ ...ghostBtn, marginTop: 4 }} onClick={() => p.onIdentity({ fetches: [...idn.fetches, { name: '', url: '', poll: '' }] })}>+ add source</button>
          {idn.fetches.map((f, i) => (
            <div key={i} style={rowLine}>
              <Field style={{ ...field, width: 80 }} value={f.name} placeholder="name" onChange={(e) => p.onIdentity({ fetches: idn.fetches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Field style={{ ...field, flex: 1 }} value={f.url} placeholder="https://api…/data.json" onChange={(e) => p.onIdentity({ fetches: idn.fetches.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <Field style={{ ...field, width: 52 }} value={f.poll} placeholder="secs" onChange={(e) => p.onIdentity({ fetches: idn.fetches.map((x, j) => (j === i ? { ...x, poll: e.target.value } : x)) })} />
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
          <button style={{ ...ghostBtn, color: 'var(--color-danger)' }} onClick={() => p.onDelete(sel.id)}>delete</button>
        </span>
      </div>

      {NODES[n.t]?.kind === 'molecule' && (
        <p style={hintStyle}>Draws itself from {([] as string[]).concat(NODES[n.t].reads ?? []).map((r) => <code key={r}>{r} </code>)} — nothing to set.</p>
      )}
      {Object.entries(NODES[n.t]?.props ?? {}).map(([name, spec]) => (
        <PropEditor key={name} name={name} spec={spec} node={n} sources={sources}
          onChange={(v) => patch({ [name]: v })}
          onCmd={(cmd, cap) => (n.t === 'form' ? p.onPatchForm(sel.id, cmd, controlsFor(cap, cmd.body ?? {})) : patch({ cmd }))} />
      ))}
    </div>
  );
}
