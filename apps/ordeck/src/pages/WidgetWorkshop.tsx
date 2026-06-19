/**
 * pages/WidgetWorkshop.tsx — the admin "/widgets" workshop.
 *
 * A guided GUI for composing a declarative widget (the WidgetSpec the HUD factory
 * renders) with a live preview, then publishing it server-wide via jkAuth
 * (`POST /auth/widgets`). Admin-only. No code, no redeploy.
 *
 * Two tabs: BUILD (the editor) and GUIDE (what every field does). The editor hides
 * the spec JSON behind friendly controls — fixed-vs-live fields, source pickers
 * with field suggestions, tone/size dropdowns, and per-breakpoint size steppers.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AUTH_URL, useJkOSPreferences } from '../hooks/useJkOSPreferences';
import { useSuiteApps, fetchCapabilities, type CapabilityDoc } from '@jkos/weave';
import { useHudContext } from './hud/useHudContext';
import { HUD_SCHEMA, HUD_ITEM_FIELDS } from './hud/useHudData';
import { renderWidget } from '../hud/registry';
import type { Binding, Tone, WidgetDef, WidgetNode } from '../hud/types';
import { WIDGET_EDIT_KEY } from '../hud/state';

/* ── Binding editor model ───────────────────────────────────────────────── */

type EB = { mode: 'lit' | 'data'; lit: string; src: string; path: string };
const eb = (lit = ''): EB => ({ mode: 'lit', lit, src: 'systems', path: '' });
const dataEb = (src: string, path: string): EB => ({ mode: 'data', lit: '', src, path });

const toBinding = (b: EB): Binding =>
  b.mode === 'data' ? { src: b.src, ...(b.path ? { path: b.path } : {}) } : b.lit;
const optBinding = (b?: EB): Binding | undefined =>
  !b || (b.mode === 'lit' && b.lit === '') ? undefined : toBinding(b);

/* ── Command field-mapper model ─────────────────────────────────────────────
 * How each capability body field is filled when the widget is an ACTION (form):
 *   input → a form control the user fills; cmd.body[field] = { src:'$form', ... }
 *   lit   → a fixed value baked into the command
 *   data  → a live slice value (e.g. clock.iso for "today")
 *   skip  → not sent (optional fields) */
type FMMode = 'input' | 'lit' | 'data' | 'skip';
interface FMEntry { mode: FMMode; lit: string; src: string; path: string }
const FM_MODES: FMMode[] = ['input', 'lit', 'data', 'skip'];

/* ── Primitive catalog ──────────────────────────────────────────────────── */

type PrimType =
  | 'label' | 'text' | 'metric' | 'bar' | 'gauge' | 'pill' | 'dot'
  | 'keyval' | 'divider' | 'link' | 'list'
  | 'time' | 'icon' | 'calendar' | 'weather';

type ItemStyle = 'keyval' | 'status' | 'task';

interface Row {
  type: PrimType;
  text?: EB; value?: EB; unit?: EB; sub?: EB; sub2?: EB; seconds?: EB; max?: EB; label?: EB; href?: EB; name?: EB;
  from?: EB; empty?: EB; itemLabel?: EB; itemValue?: EB;
  /** "Show if" — when set, the element only renders when this resolves truthy. */
  cond?: EB;
  size?: string; variant?: string; tone?: Tone; pulse?: boolean;
  itemStyle?: ItemStyle; dir?: string;
}

const PRIMS: { type: PrimType; label: string; hint: string }[] = [
  { type: 'metric', label: 'Metric', hint: 'big number + unit' },
  { type: 'gauge', label: 'Gauge', hint: 'circular % ring' },
  { type: 'bar', label: 'Progress bar', hint: 'value vs max' },
  { type: 'keyval', label: 'Key / value', hint: 'name on the left, value on the right' },
  { type: 'list', label: 'List', hint: 'repeat a row over an array (key/value, status, or task)' },
  { type: 'pill', label: 'Status pill', hint: 'small coloured badge' },
  { type: 'dot', label: 'Status dot', hint: 'coloured indicator' },
  { type: 'text', label: 'Text', hint: 'heading or body line' },
  { type: 'label', label: 'Eyebrow label', hint: 'small uppercase caption' },
  { type: 'icon', label: 'Icon', hint: 'a line glyph (sun, check, book…)' },
  { type: 'divider', label: 'Divider', hint: 'rule, optional caption' },
  { type: 'link', label: 'Link button', hint: 'opens a URL' },
  { type: 'time', label: 'Big clock', hint: 'large time + meta lines' },
  { type: 'calendar', label: 'Calendar', hint: 'month grid (uses the cal slice)' },
  { type: 'weather', label: 'Weather', hint: 'full weather card (uses the weather slice)' },
];

const TONES: Tone[] = ['ok', 'warn', 'danger', 'accent', 'muted'];
const SIZES = ['md', 'sm', 'xs'];
const VARIANTS = ['title', 'body', 'sub', 'mono'];
const ITEM_STYLES: ItemStyle[] = ['keyval', 'status', 'task'];
const DIRS = ['col', 'row'];
const ICON_NAMES = ['sun', 'moon', 'cloud', 'rain', 'bolt', 'check', 'book', 'clock', 'calendar', 'activity', 'star', 'alert', 'dot'];

/* ── Data-source field suggestions (driven by the slice schema) ──────────── */
// HUD_SCHEMA + HUD_ITEM_FIELDS live with the slice definitions (useHudData), so a
// new field is one edit there and appears here automatically — no parallel list.

const HUD_SOURCES = Object.keys(HUD_SCHEMA);
const KNOWN_SUGGEST = [...HUD_SOURCES, '$'];
function pathSuggestions(src: string): string[] {
  if (src === '$') return HUD_ITEM_FIELDS;
  const s = HUD_SCHEMA[src];
  return s ? [...s.scalars, ...(s.arrays ?? [])] : [];
}

function newRow(type: PrimType): Row {
  switch (type) {
    case 'label': return { type, text: eb('LABEL'), size: 'md' };
    case 'text': return { type, text: eb('Heading'), variant: 'title' };
    case 'metric': return { type, value: dataEb('systems', 'up'), unit: eb(''), sub: eb('') };
    case 'bar': return { type, value: dataEb('systems', 'up'), max: dataEb('systems', 'total') };
    case 'gauge': return { type, value: dataEb('systems', 'up'), max: dataEb('systems', 'total'), text: eb('') };
    case 'pill': return { type, text: eb('OK'), tone: 'ok' };
    case 'dot': return { type, tone: 'ok', pulse: false };
    case 'keyval': return { type, label: eb('Name'), value: eb('Value'), tone: 'muted' };
    case 'divider': return { type, text: eb('') };
    case 'link': return { type, text: eb('Open'), href: eb('https://') };
    case 'icon': return { type, name: eb('sun'), tone: 'accent' };
    case 'time': return { type, value: dataEb('clock', 'hm'), seconds: dataEb('clock', 'ss'), sub: dataEb('clock', 'dateLine'), sub2: dataEb('clock', 'utcLine') } as Row;
    case 'calendar': return { type };
    case 'weather': return { type };
    case 'list': return { type, from: dataEb('systems', 'rows'), empty: eb('NOTHING'), itemStyle: 'keyval', dir: 'col', itemLabel: dataEb('$', 'name'), itemValue: dataEb('$', 'detail') };
  }
}

/** The repeated row for a list, by preset. `status`/`task` assume the array's
 *  items expose `$.tone` (and `$.timeLabel` for task) — the hud slices do. */
function listItem(style: ItemStyle | undefined, label: EB, value: EB): WidgetNode {
  if (style === 'status') {
    return { t: 'row', gap: 8, children: [
      { t: 'dot', tone: { src: '$', path: 'tone' } },
      { t: 'text', text: toBinding(label), variant: 'mono', grow: true },
      { t: 'text', text: toBinding(value), variant: 'sub' },
    ] };
  }
  if (style === 'task') {
    return { t: 'row', gap: 8, justify: 'space-between', children: [
      { t: 'text', text: { src: '$', path: 'timeLabel' }, variant: 'sub' },
      { t: 'text', text: toBinding(label), variant: 'mono', grow: true },
      { t: 'pill', text: toBinding(value), tone: { src: '$', path: 'tone' } },
    ] };
  }
  return { t: 'keyval', label: toBinding(label), value: toBinding(value) };
}

function baseNode(r: Row): WidgetNode {
  switch (r.type) {
    case 'label': return { t: 'label', text: toBinding(r.text!), size: (r.size as 'md') || undefined };
    case 'text': return { t: 'text', text: toBinding(r.text!), variant: (r.variant as 'title') || undefined };
    case 'metric': return { t: 'metric', value: toBinding(r.value!), unit: optBinding(r.unit), sub: optBinding(r.sub) };
    case 'bar': return { t: 'bar', value: toBinding(r.value!), max: optBinding(r.max) };
    case 'gauge': return { t: 'gauge', value: toBinding(r.value!), max: optBinding(r.max), label: optBinding(r.text) };
    case 'pill': return { t: 'pill', text: toBinding(r.text!), tone: r.tone };
    case 'dot': return { t: 'dot', tone: r.tone, pulse: r.pulse || undefined };
    case 'keyval': return { t: 'keyval', label: toBinding(r.label!), value: toBinding(r.value!), tone: r.tone };
    case 'divider': return { t: 'divider', label: optBinding(r.text) };
    case 'link': return { t: 'link', text: toBinding(r.text!), href: toBinding(r.href!) };
    case 'icon': return { t: 'icon', name: toBinding(r.name!), tone: r.tone };
    case 'time': return { t: 'time', value: toBinding(r.value!), seconds: optBinding(r.seconds), sub: optBinding(r.sub), sub2: optBinding(r.sub2) };
    case 'calendar': return { t: 'calendar' };
    case 'weather': return { t: 'weather' };
    case 'list': return { t: 'list', from: toBinding(r.from!), empty: optBinding(r.empty), dir: r.dir === 'row' ? 'row' : undefined, item: listItem(r.itemStyle, r.itemLabel!, r.itemValue!) };
  }
}

/** True when a "show if" condition is actually set (a data path, or a typed literal). */
const condActive = (c?: EB): boolean => !!c && (c.mode === 'data' ? !!c.src : c.lit !== '');

function toNode(r: Row): WidgetNode {
  const node = baseNode(r);
  return condActive(r.cond) ? { t: 'when', cond: toBinding(r.cond!), then: node } : node;
}

/* Reverse of toBinding/toNode — loads an existing widget back into the editor. */
function bindingToEb(b?: Binding): EB {
  if (b == null) return eb('');
  if (typeof b !== 'object') return eb(String(b));
  if ('lit' in b) return eb(b.lit == null ? '' : String(b.lit));
  return dataEb(b.src, b.path || '');
}

const asTone = (t?: Binding): Tone | undefined => (typeof t === 'string' ? (t as Tone) : undefined);

/** Detect which list preset an item node came from, for round-trip editing. */
function listStyleOf(item: WidgetNode): { style: ItemStyle; label: EB; value: EB } {
  if (item.t === 'keyval') return { style: 'keyval', label: bindingToEb(item.label), value: bindingToEb(item.value) };
  if (item.t === 'row') {
    const kids = item.children;
    const hasPill = kids.some((k) => k.t === 'pill');
    const texts = kids.filter((k): k is Extract<WidgetNode, { t: 'text' }> => k.t === 'text');
    const grow = texts.find((k) => k.grow) ?? texts[0];
    const tail = texts.filter((k) => k !== grow).pop() ?? kids.find((k) => k.t === 'pill');
    const label = grow ? bindingToEb(grow.text) : dataEb('$', 'name');
    const value = tail && (tail.t === 'text' || tail.t === 'pill') ? bindingToEb(tail.text) : dataEb('$', 'detail');
    return { style: hasPill ? 'task' : 'status', label, value };
  }
  return { style: 'keyval', label: dataEb('$', 'name'), value: dataEb('$', 'detail') };
}

function baseRow(n: WidgetNode): Row | null {
  switch (n.t) {
    case 'label': return { type: 'label', text: bindingToEb(n.text), size: n.size || 'md' };
    case 'text': return { type: 'text', text: bindingToEb(n.text), variant: n.variant || 'title' };
    case 'metric': return { type: 'metric', value: bindingToEb(n.value), unit: bindingToEb(n.unit), sub: bindingToEb(n.sub) };
    case 'bar': return { type: 'bar', value: bindingToEb(n.value), max: bindingToEb(n.max) };
    case 'gauge': return { type: 'gauge', value: bindingToEb(n.value), max: bindingToEb(n.max), text: bindingToEb(n.label) };
    case 'pill': return { type: 'pill', text: bindingToEb(n.text), tone: asTone(n.tone) || 'ok' };
    case 'dot': return { type: 'dot', tone: asTone(n.tone) || 'ok', pulse: !!n.pulse };
    case 'keyval': return { type: 'keyval', label: bindingToEb(n.label), value: bindingToEb(n.value), tone: asTone(n.tone) || 'muted' };
    case 'divider': return { type: 'divider', text: bindingToEb(n.label) };
    case 'link': return { type: 'link', text: bindingToEb(n.text), href: bindingToEb(n.href) };
    case 'icon': return { type: 'icon', name: bindingToEb(n.name), tone: asTone(n.tone) || 'accent' };
    case 'time': return { type: 'time', value: bindingToEb(n.value), seconds: bindingToEb(n.seconds), sub: bindingToEb(n.sub), sub2: bindingToEb(n.sub2) } as Row;
    case 'calendar': return { type: 'calendar' };
    case 'weather': return { type: 'weather' };
    case 'list': {
      const { style, label, value } = listStyleOf(n.item);
      return { type: 'list', from: bindingToEb(n.from), empty: bindingToEb(n.empty), itemStyle: style, dir: n.dir || 'col', itemLabel: label, itemValue: value };
    }
    default: return null;   // stack / row — not representable in the flat editor
  }
}

function nodeToRow(n: WidgetNode): Row | null {
  // A "show if"-wrapped element round-trips when its branch is a single
  // representable node (nested stacks/rows can't flatten — they drop out).
  if (n.t === 'when') {
    const row = baseRow(n.then);
    if (!row) return null;
    return { ...row, cond: bindingToEb(n.cond) };
  }
  return baseRow(n);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n || lo));

/* ── Reusable inputs ────────────────────────────────────────────────────── */

const field: CSSProperties = {
  background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', color: 'var(--hub-cream-bright)',
  fontFamily: 'var(--hub-font-mono)', fontSize: 12, padding: '5px 8px', borderRadius: 'var(--hub-radius-sm)', minWidth: 0,
};
const ghostBtn: CSSProperties = { ...field, cursor: 'pointer' };
const rowLine: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 };
const tag = (t: string) => <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--hub-cream-dim)', width: 64, flex: 'none' }}>{t}</span>;

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return <select style={{ ...field, flex: 'none' }} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
}

function BindingInput({ value, onChange, sources }: { value: EB; onChange: (v: EB) => void; sources: string[] }) {
  const known = KNOWN_SUGGEST.includes(value.src);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <Select value={value.mode} onChange={(m) => onChange({ ...value, mode: m as EB['mode'] })} options={['lit', 'data']} />
      {value.mode === 'lit' ? (
        <input style={{ ...field, flex: 1 }} value={value.lit} placeholder="fixed value" onChange={(e) => onChange({ ...value, lit: e.target.value })} />
      ) : (
        <>
          <Select value={value.src} onChange={(s) => onChange({ ...value, src: s })} options={sources} />
          <input style={{ ...field, flex: 1 }} list={known ? `pl-${value.src}` : undefined} value={value.path}
            placeholder="field" onChange={(e) => onChange({ ...value, path: e.target.value })} />
        </>
      )}
    </span>
  );
}

/* ── Workshop ───────────────────────────────────────────────────────────── */

export default function WidgetWorkshop() {
  const { user } = useJkOSPreferences();

  // Live preview context — the real HUD context, so previews show real values.
  const ctx = useHudContext(true);

  const [tab, setTab] = useState<'build' | 'guide'>('build');
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [eyebrow, setEyebrow] = useState('');
  const [source, setSource] = useState('');
  const [dw, setDw] = useState(3); const [dh, setDh] = useState(5);
  const [mw, setMw] = useState(2); const [mh, setMh] = useState(4);
  const [rows, setRows] = useState<Row[]>([newRow('metric')]);
  const [fetches, setFetches] = useState<{ name: string; url: string; poll: string }[]>([]);
  const [published, setPublished] = useState<WidgetDef[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Action (command) authoring ──
  const suite = useSuiteApps();
  const cmdApps = useMemo(() => Object.values(suite).filter((a) => a.capabilitiesPath), [suite]);
  const [actionOn, setActionOn] = useState(false);
  const [cmdApp, setCmdApp] = useState('');
  const [cmdCap, setCmdCap] = useState('');
  const [capDoc, setCapDoc] = useState<CapabilityDoc | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, FMEntry>>({});
  const [submitLabel, setSubmitLabel] = useState('ADD');

  // Discover the chosen app's capabilities.
  useEffect(() => {
    if (!cmdApp) { setCapDoc(null); return; }
    let dead = false;
    fetchCapabilities(cmdApp).then((d) => { if (!dead) setCapDoc(d); });
    return () => { dead = true; };
  }, [cmdApp]);

  const cap = capDoc?.capabilities.find((c) => c.id === cmdCap) ?? null;

  // Seed sensible defaults for any field not already mapped (so a loaded/edited
  // mapping survives, but a freshly-picked capability auto-fills): required →
  // input, has-default → that literal, else → skip.
  useEffect(() => {
    if (!cap) return;
    setFieldMap((prev) => {
      const fm = { ...prev };
      for (const f of cap.body ?? []) {
        if (fm[f.name]) continue;
        if (f.default !== undefined) fm[f.name] = { mode: 'lit', lit: String(f.default), src: '', path: '' };
        else if (f.required) fm[f.name] = { mode: 'input', lit: '', src: '', path: '' };
        else fm[f.name] = { mode: 'skip', lit: '', src: '', path: '' };
      }
      return fm;
    });
  }, [cap]);

  const FM_DEFAULT: FMEntry = { mode: 'skip', lit: '', src: '', path: '' };
  const setFM = (name: string, patch: Partial<FMEntry>) =>
    setFieldMap((m) => ({ ...m, [name]: { ...(m[name] ?? FM_DEFAULT), ...patch } }));

  const isAdmin = user?.role === 'admin';

  const loadPublished = () => {
    fetch(`${AUTH_URL}/auth/widgets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { widgets: [] }))
      .then((d) => setPublished(Array.isArray(d.widgets) ? d.widgets : []))
      .catch(() => {});
  };
  useEffect(loadPublished, []);

  // If the HUD handed us a card to edit (pencil affordance), load it once.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(WIDGET_EDIT_KEY);
      if (raw) localStorage.removeItem(WIDGET_EDIT_KEY);
    } catch { return; }
    if (!raw) return;
    let def: WidgetDef;
    try { def = JSON.parse(raw); } catch { return; }
    if (!def?.spec) return;
    // Frame captions are Bindings; only a plain string (or a {lit} string) maps
    // back into the text inputs — a data-bound caption loads blank.
    const frameText = (b: unknown): string =>
      typeof b === 'string' ? b
        : b && typeof b === 'object' && 'lit' in b && typeof (b as { lit: unknown }).lit === 'string' ? (b as { lit: string }).lit
          : '';
    setId(def.id || '');
    setLabel(def.label || '');
    setEyebrow(frameText(def.spec.frame?.eyebrow));
    setSource(frameText(def.spec.frame?.source));
    setDw(def.sizing?.desktop?.w ?? 3); setDh(def.sizing?.desktop?.h ?? 5);
    setMw(def.sizing?.mobile?.w ?? 2); setMh(def.sizing?.mobile?.h ?? 4);
    const fs: { name: string; url: string; poll: string }[] = [];
    for (const [name, s] of Object.entries(def.spec.sources || {})) {
      if (s?.from === 'fetch') fs.push({ name, url: s.url, poll: s.poll != null ? String(s.poll) : '' });
    }
    setFetches(fs);
    const body = def.spec.body;
    if (body?.t === 'form') {
      // An ACTION widget — reconstruct the command + field mapping + display rows.
      setActionOn(true);
      setCmdApp(body.cmd.app);
      setCmdCap(body.cmd.capability);
      setSubmitLabel(typeof body.submit === 'string' ? body.submit : 'ADD');
      const fm: Record<string, FMEntry> = {};
      for (const [k, b] of Object.entries(body.cmd.body ?? {})) {
        if (b && typeof b === 'object' && 'src' in b) {
          const src = (b as { src: string }).src;
          fm[k] = src === '$form'
            ? { mode: 'input', lit: '', src: '', path: '' }
            : { mode: 'data', lit: '', src, path: (b as { path?: string }).path || '' };
        } else fm[k] = { mode: 'lit', lit: b == null ? '' : String(b), src: '', path: '' };
      }
      setFieldMap(fm);
      const disp = body.children.filter((c) => c.t !== 'input' && c.t !== 'select' && c.t !== 'toggle');
      setRows(disp.map(nodeToRow).filter((r): r is Row => r != null));
    } else {
      const kids = body?.t === 'stack' ? body.children : body ? [body] : [];
      const rs = kids.map(nodeToRow).filter((r): r is Row => r != null);
      setRows(rs.length ? rs : [newRow('metric')]);
    }
    setMsg(`Editing "${def.id}" — change anything and re-publish to update it everywhere.`);
  }, []);

  const sources = useMemo(() => [...HUD_SOURCES, ...fetches.map((f) => f.name).filter(Boolean), '$'], [fetches]);

  // Stable sources object so editing the body doesn't refetch live endpoints.
  const sourcesObj = useMemo(() => {
    const m: Record<string, { from: 'fetch'; url: string; poll?: number }> = {};
    for (const f of fetches) if (f.name && f.url) m[f.name] = { from: 'fetch', url: f.url, poll: f.poll ? Number(f.poll) : undefined };
    return Object.keys(m).length ? m : undefined;
  }, [fetches]);

  const def = useMemo<WidgetDef>(() => {
    // A lone molecule (calendar/weather) is its own card — emit it frameless so
    // it isn't double-wrapped. Everything else gets the standard card chrome.
    // An ACTION widget is never a molecule (it's a form).
    const onlyMolecule = !actionOn && rows.length === 1 && (rows[0].type === 'calendar' || rows[0].type === 'weather');

    let body: WidgetNode = onlyMolecule ? toNode(rows[0]) : { t: 'stack', gap: 10, children: rows.map(toNode) };

    // Action → wrap the body in a form bound to the chosen capability: display
    // rows on top, then one control per field mapped to `input`, then the submit.
    if (actionOn && cmdApp && cmdCap) {
      const cmdBody: Record<string, Binding> = {};
      const controls: WidgetNode[] = [];
      for (const f of cap?.body ?? []) {
        const e = fieldMap[f.name];
        if (!e || e.mode === 'skip') continue;
        if (e.mode === 'lit') { if (e.lit !== '') cmdBody[f.name] = e.lit; continue; }
        if (e.mode === 'data') { if (e.src) cmdBody[f.name] = { src: e.src, ...(e.path ? { path: e.path } : {}) }; continue; }
        cmdBody[f.name] = { src: '$form', path: f.name };       // input → form control
        if (f.type === 'enum') controls.push({ t: 'select', field: f.name, options: { lit: f.enum ?? [] }, placeholder: f.label || f.name });
        else if (f.type === 'boolean') controls.push({ t: 'toggle', field: f.name, label: f.label || f.name });
        else controls.push({ t: 'input', field: f.name, placeholder: f.label || f.name, itype: f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'number' ? 'number' : 'text' });
      }
      body = {
        t: 'form',
        cmd: { app: cmdApp, capability: cmdCap, body: cmdBody },
        submit: submitLabel || 'SUBMIT',
        children: [...rows.map(toNode), ...controls],
      };
    }

    return {
      id: id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      label: label || id || 'Untitled',
      sizing: { desktop: { w: clamp(dw, 1, 12), h: clamp(dh, 1, 40) }, mobile: { w: clamp(mw, 1, 2), h: clamp(mh, 1, 40) } },
      spec: {
        frame: onlyMolecule ? undefined : { eyebrow: eyebrow || undefined, source: source || undefined },
        sources: sourcesObj,
        body,
      },
    };
  }, [id, label, eyebrow, source, dw, dh, mw, mh, rows, sourcesObj, actionOn, cmdApp, cmdCap, cap, fieldMap, submitLabel]);

  async function publish() {
    if (!def.id) { setMsg('Give the widget an id first.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${AUTH_URL}/auth/widgets`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(def),
      });
      if (r.ok) { setMsg(`Published "${def.id}" — it's on every HUD's add strip now.`); loadPublished(); }
      else if (r.status === 403) setMsg('Admin access required to publish.');
      else setMsg(`Publish failed (${r.status}).`);
    } catch { setMsg('Network error while publishing.'); }
    setBusy(false);
  }

  async function unpublish(wid: string) {
    await fetch(`${AUTH_URL}/auth/widgets/${encodeURIComponent(wid)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    loadPublished();
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bind = (i: number, key: keyof Row) => (v: EB) => setRow(i, { [key]: v } as Partial<Row>);

  if (user && !isAdmin) {
    return <Shell tab={tab} setTab={setTab}><p style={{ color: 'var(--hub-cream-dim)', fontFamily: 'var(--hub-font-mono)' }}>The widget workshop is admin-only.</p></Shell>;
  }

  return (
    <Shell tab={tab} setTab={setTab}>
      {/* path-suggestion datalists, rendered once */}
      {KNOWN_SUGGEST.map((s) => <datalist key={s} id={`pl-${s}`}>{pathSuggestions(s).map((f) => <option key={f} value={f} />)}</datalist>)}

      {tab === 'guide' ? <Guide /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24, alignItems: 'start' }}>
          {/* ── Builder ── */}
          <div>
            <Card title="IDENTITY & SIZE">
              <div style={rowLine}>{tag('id')}<input style={{ ...field, flex: 1 }} value={id} placeholder="e.g. btc-price" onChange={(e) => setId(e.target.value)} /></div>
              <div style={rowLine}>{tag('label')}<input style={{ ...field, flex: 1 }} value={label} placeholder="Display name" onChange={(e) => setLabel(e.target.value)} /></div>
              <div style={rowLine}>{tag('eyebrow')}<input style={{ ...field, flex: 1 }} value={eyebrow} placeholder="Card eyebrow (optional)" onChange={(e) => setEyebrow(e.target.value)} /></div>
              <div style={rowLine}>{tag('source')}<input style={{ ...field, flex: 1 }} value={source} placeholder="Right-side label (optional)" onChange={(e) => setSource(e.target.value)} /></div>
              <div style={rowLine}>
                {tag('size')}
                <Num label="desktop w" value={dw} min={1} max={12} onChange={setDw} />
                <Num label="h" value={dh} min={1} max={40} onChange={setDh} />
                <span style={{ width: 10 }} />
                <Num label="mobile w" value={mw} min={1} max={2} onChange={setMw} />
                <Num label="h" value={mh} min={1} max={40} onChange={setMh} />
              </div>
              <p style={hintStyle}>Sizes are in grid cells — desktop is a 12-column grid, mobile is 2. A row is ~44px tall.</p>
            </Card>

            <Card title="DATA SOURCES (JSON)">
              <p style={hintStyle}>
                HUD slices ({HUD_SOURCES.join(', ')}) are always available. To pull from any JSON endpoint, add a source below,
                then on a field choose <b>data</b> → your source → the <b>path</b> to the value.
                Paths are dot-walked: <code>price</code> reads <code>{'{ price: 42 }'}</code>; <code>data.v</code> reads
                <code>{' { data: { v: 9 } }'}</code>; <code>items.0.name</code> reads the first array element. The endpoint must allow
                browser (CORS) access. Refresh is in seconds.
              </p>
              <button style={{ ...ghostBtn, marginTop: 4 }} onClick={() => setFetches((f) => [...f, { name: '', url: '', poll: '' }])}>+ add source</button>
              {fetches.map((f, i) => (
                <div key={i} style={rowLine}>
                  <input style={{ ...field, width: 90 }} value={f.name} placeholder="name" onChange={(e) => setFetches((fs) => fs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input style={{ ...field, flex: 1 }} value={f.url} placeholder="https://api…/data.json" onChange={(e) => setFetches((fs) => fs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                  <input style={{ ...field, width: 58 }} value={f.poll} placeholder="secs" onChange={(e) => setFetches((fs) => fs.map((x, j) => (j === i ? { ...x, poll: e.target.value } : x)))} />
                  <button style={ghostBtn} onClick={() => setFetches((fs) => fs.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </Card>

            <Card title="BODY">
              <select style={{ ...ghostBtn, marginBottom: 4 }} value="" onChange={(e) => { if (e.target.value) setRows((rs) => [...rs, newRow(e.target.value as PrimType)]); }}>
                <option value="">+ add element…</option>
                {PRIMS.map((p) => <option key={p.type} value={p.type}>{p.label} — {p.hint}</option>)}
              </select>
              {rows.map((r, i) => (
                <div key={i} style={{ borderTop: '1px solid var(--hub-line)', marginTop: 10, paddingTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-amber)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{r.type}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <button style={ghostBtn} disabled={i === 0} onClick={() => setRows((rs) => swap(rs, i, i - 1))}>↑</button>
                      <button style={ghostBtn} disabled={i === rows.length - 1} onClick={() => setRows((rs) => swap(rs, i, i + 1))}>↓</button>
                      <button style={ghostBtn} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>remove</button>
                    </span>
                  </div>
                  {(r.type === 'label' || r.type === 'text' || r.type === 'pill') && <Line t="text"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line>}
                  {r.type === 'label' && <Line t="size"><Select value={r.size!} onChange={(v) => setRow(i, { size: v })} options={SIZES} /></Line>}
                  {r.type === 'text' && <Line t="style"><Select value={r.variant!} onChange={(v) => setRow(i, { variant: v })} options={VARIANTS} /></Line>}
                  {(r.type === 'pill' || r.type === 'dot' || r.type === 'keyval' || r.type === 'icon') && <Line t="tone"><Select value={r.tone!} onChange={(v) => setRow(i, { tone: v as Tone })} options={TONES} /></Line>}
                  {r.type === 'dot' && <Line t="pulse"><input type="checkbox" checked={!!r.pulse} onChange={(e) => setRow(i, { pulse: e.target.checked })} /></Line>}
                  {r.type === 'icon' && <Line t="glyph"><span style={{ display: 'inline-flex', gap: 4, flex: 1 }}><Select value={r.name?.lit || 'sun'} onChange={(v) => setRow(i, { name: eb(v) })} options={ICON_NAMES} /></span></Line>}
                  {r.type === 'time' && <>
                    <Line t="time"><BindingInput value={r.value!} sources={sources} onChange={bind(i, 'value')} /></Line>
                    <Line t="seconds"><BindingInput value={r.seconds!} sources={sources} onChange={bind(i, 'seconds')} /></Line>
                    <Line t="line 1"><BindingInput value={r.sub!} sources={sources} onChange={bind(i, 'sub')} /></Line>
                    <Line t="line 2"><BindingInput value={r.sub2!} sources={sources} onChange={bind(i, 'sub2')} /></Line>
                  </>}
                  {(r.type === 'calendar' || r.type === 'weather') && <p style={hintStyle}>No fields — this card renders from its <code>{r.type === 'calendar' ? 'cal' : 'weather'}</code> slice. Use “show if” below to gate it.</p>}
                  {(r.type === 'metric' || r.type === 'bar' || r.type === 'gauge') && <Line t="value"><BindingInput value={r.value!} sources={sources} onChange={bind(i, 'value')} /></Line>}
                  {r.type === 'metric' && <><Line t="unit"><BindingInput value={r.unit!} sources={sources} onChange={bind(i, 'unit')} /></Line><Line t="sub"><BindingInput value={r.sub!} sources={sources} onChange={bind(i, 'sub')} /></Line></>}
                  {(r.type === 'bar' || r.type === 'gauge') && <Line t="max"><BindingInput value={r.max!} sources={sources} onChange={bind(i, 'max')} /></Line>}
                  {r.type === 'gauge' && <Line t="caption"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line>}
                  {r.type === 'keyval' && <><Line t="label"><BindingInput value={r.label!} sources={sources} onChange={bind(i, 'label')} /></Line><Line t="value"><BindingInput value={r.value!} sources={sources} onChange={bind(i, 'value')} /></Line></>}
                  {r.type === 'divider' && <Line t="caption"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line>}
                  {r.type === 'link' && <><Line t="text"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line><Line t="url"><BindingInput value={r.href!} sources={sources} onChange={bind(i, 'href')} /></Line></>}
                  {r.type === 'list' && <>
                    <Line t="from []"><BindingInput value={r.from!} sources={sources} onChange={bind(i, 'from')} /></Line>
                    <Line t="row style"><Select value={r.itemStyle || 'keyval'} onChange={(v) => setRow(i, { itemStyle: v as ItemStyle })} options={ITEM_STYLES} /><Select value={r.dir || 'col'} onChange={(v) => setRow(i, { dir: v })} options={DIRS} /></Line>
                    <Line t="empty"><BindingInput value={r.empty!} sources={sources} onChange={bind(i, 'empty')} /></Line>
                    <Line t={r.itemStyle === 'task' ? 'title' : 'item key'}><BindingInput value={r.itemLabel!} sources={sources} onChange={bind(i, 'itemLabel')} /></Line>
                    <Line t={r.itemStyle === 'task' ? 'badge' : 'item val'}><BindingInput value={r.itemValue!} sources={sources} onChange={bind(i, 'itemValue')} /></Line>
                    {r.itemStyle && r.itemStyle !== 'keyval' && <p style={hintStyle}>{r.itemStyle === 'status' ? 'A coloured dot reads each item’s ' : 'A coloured badge + time read each item’s '}<code>$.tone</code>{r.itemStyle === 'task' ? ' / $.timeLabel' : ''}.</p>}
                  </>}
                  <Line t="show if"><BindingInput value={r.cond || eb('')} sources={sources} onChange={bind(i, 'cond')} /></Line>
                </div>
              ))}
            </Card>

            <Card title="ACTION (WRITE)">
              <label style={{ ...rowLine, cursor: 'pointer' }}>
                <input type="checkbox" checked={actionOn} onChange={(e) => setActionOn(e.target.checked)} />
                <span style={hintStyle}>Turn this widget into a form that submits a command to a suite app — discovered from its capabilities, no code.</span>
              </label>
              {actionOn && (cmdApps.length === 0 ? (
                <p style={hintStyle}>No suite app exposes capabilities yet (looking for a <code>capabilities_path</code> in the registry).</p>
              ) : (
                <>
                  <Line t="app"><Select value={cmdApp} onChange={(v) => { setCmdApp(v); setCmdCap(''); }} options={['', ...cmdApps.map((a) => a.id)]} /></Line>
                  {capDoc && <Line t="action"><Select value={cmdCap} onChange={setCmdCap} options={['', ...capDoc.capabilities.map((c) => c.id)]} /></Line>}
                  {cap && (
                    <>
                      <Line t="submit"><input style={{ ...field, flex: 1 }} value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} /></Line>
                      <p style={hintStyle}>Map each field — <b>input</b> (user fills it), <b>lit</b> (fixed value), <b>data</b> (a live slice, e.g. <code>clock.iso</code>), or <b>skip</b>.</p>
                      {(cap.body ?? []).map((f) => {
                        const e = fieldMap[f.name] || { mode: 'skip' as FMMode, lit: '', src: '', path: '' };
                        return (
                          <div key={f.name} style={{ borderTop: '1px solid var(--hub-line)', marginTop: 8, paddingTop: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' }}>
                                {f.name}{f.required ? ' *' : ''} <span style={{ color: 'var(--hub-cream-faint)' }}>· {f.type}</span>
                              </span>
                              <span style={{ marginLeft: 'auto' }}><Select value={e.mode} onChange={(m) => setFM(f.name, { mode: m as FMMode })} options={FM_MODES} /></span>
                            </div>
                            {e.mode === 'lit' && <div style={rowLine}><input style={{ ...field, flex: 1 }} value={e.lit} placeholder="fixed value" onChange={(ev) => setFM(f.name, { lit: ev.target.value })} /></div>}
                            {e.mode === 'data' && (
                              <div style={rowLine}>
                                <Select value={e.src || 'clock'} onChange={(s) => setFM(f.name, { src: s })} options={HUD_SOURCES} />
                                <input style={{ ...field, flex: 1 }} list={`pl-${e.src || 'clock'}`} value={e.path} placeholder="field" onChange={(ev) => setFM(f.name, { path: ev.target.value })} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              ))}
            </Card>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <button onClick={publish} disabled={busy} style={{ ...field, cursor: 'pointer', background: 'var(--hub-amber)', color: 'var(--hub-bg-0)', fontWeight: 600, padding: '8px 16px', border: 'none' }}>
                {busy ? 'Publishing…' : 'Publish server-wide'}
              </button>
              {msg && <span style={{ fontSize: 12, color: 'var(--hub-cream)' }}>{msg}</span>}
            </div>
          </div>

          {/* ── Preview + published ── */}
          <div style={{ position: 'sticky', top: 16 }}>
            <span className="hud-eyebrow">LIVE PREVIEW · {def.sizing.desktop.w}×{def.sizing.desktop.h}</span>
            <div style={{ marginTop: 8, minHeight: 140 }}>{renderWidget(def, ctx)}</div>
            <span className="hud-eyebrow" style={{ display: 'block', marginTop: 20 }}>PUBLISHED ({published.length})</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {published.length === 0 && <span style={{ fontSize: 11, color: 'var(--hub-cream-faint)' }}>None yet.</span>}
              {published.map((w) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.label} <span style={{ color: 'var(--hub-cream-faint)' }}>· {w.id}</span></span>
                  <button style={ghostBtn} onClick={() => unpublish(w.id)}>unpublish</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ── Layout helpers ─────────────────────────────────────────────────────── */

const hintStyle: CSSProperties = { fontSize: 11, lineHeight: 1.5, color: 'var(--hub-cream-dim)', margin: '8px 0 0' };

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, color: 'var(--hub-cream-faint)' }}>{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(clamp(Number(e.target.value), min, max))} style={{ ...field, width: 48 }} />
    </span>
  );
}

function Line({ t, children }: { t: string; children: ReactNode }) {
  return <div style={rowLine}>{tag(t)}{children}</div>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hud-card" style={{ padding: 16, marginTop: 16 }}>
      <span className="hud-eyebrow">{title}</span>
      {children}
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  if (b < 0 || b >= arr.length) return arr;
  const next = [...arr];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

function Shell({ tab, setTab, children }: { tab: 'build' | 'guide'; setTab: (t: 'build' | 'guide') => void; children: ReactNode }) {
  const tabBtn = (key: 'build' | 'guide'): CSSProperties => ({
    ...field, cursor: 'pointer', padding: '5px 14px',
    background: tab === key ? 'var(--hub-amber)' : 'transparent',
    color: tab === key ? 'var(--hub-bg-0)' : 'var(--hub-cream)',
    border: tab === key ? 'none' : '1px solid var(--hub-line)',
  });
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: 'var(--hub-bg-1)', padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <a href="/" style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 12, color: 'var(--hub-cream-dim)', textDecoration: 'none' }}>← HUD</a>
        <h1 style={{ fontFamily: 'var(--hub-font-serif, var(--hub-font-sans))', fontSize: 24, color: 'var(--hub-cream-bright)', margin: 0 }}>Widget Workshop</h1>
        <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button style={tabBtn('build')} onClick={() => setTab('build')}>Build</button>
          <button style={tabBtn('guide')} onClick={() => setTab('guide')}>Guide</button>
        </span>
      </div>
      {children}
    </div>
  );
}

/* ── Guide tab ──────────────────────────────────────────────────────────── */

function Guide() {
  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <GuideCard title="Identity & size">
        <Def k="id">Unique key (lowercase, dashes). Re-publishing the same id overwrites it.</Def>
        <Def k="label">Friendly name shown on the HUD's "add widget" strip.</Def>
        <Def k="eyebrow">Small caption at the card's top-left (e.g. UPTIME). Optional.</Def>
        <Def k="source">Caption at the card's top-right (e.g. ORDECK). Optional.</Def>
        <Def k="size">Footprint in grid cells. Desktop is a 12-column grid; mobile is strict 2-column. A row is ~44px tall, so h:5 ≈ 220px. Users can still drag/rearrange it after placing.</Def>
      </GuideCard>

      <GuideCard title="Data sources & paths">
        <Def k="HUD slices">Always available: <code>clock, weather, systems, today, study, cal</code>. Pick one as a field's source and enter a path (e.g. <code>systems</code> → <code>up</code>).</Def>
        <Def k="Add source">Point at any JSON endpoint: a <b>name</b> (how you'll reference it), the <b>URL</b>, and a <b>refresh</b> in seconds (blank = fetch once). The endpoint must permit browser/CORS access.</Def>
        <Def k="path">Dot-walks the JSON: <code>price</code> → <code>{'{price: 42}'}</code>; <code>data.v</code> → <code>{'{data:{v:9}}'}</code>; <code>items.0.name</code> → first array element. Leave blank to use the whole value.</Def>
        <Def k="fixed vs data">Every field is either <b>lit</b> (a fixed value you type) or <b>data</b> (pulled live from a source + path).</Def>
        <Def k="$ (list item)">Inside a List, item fields use the <code>$</code> source — it's the current array element. e.g. for <code>systems.rows</code>, <code>$</code> → <code>name</code> / <code>detail</code>.</Def>
      </GuideCard>

      <GuideCard title="Body elements">
        <Def k="Metric">A big number with an optional unit and a small sub-label.</Def>
        <Def k="Gauge">A circular ring showing value ÷ max as a percentage.</Def>
        <Def k="Progress bar">A horizontal fill of value ÷ max.</Def>
        <Def k="Key / value">A name on the left and a value on the right; tone colours the name.</Def>
        <Def k="List">Repeats a row over an array (the <code>from</code> field). <b>Row style</b>: <code>keyval</code> (name + value), <code>status</code> (a tone dot + name + value), or <code>task</code> (time + title + tone badge). The <code>status</code>/<code>task</code> styles colour themselves from each item’s <code>$.tone</code>. <b>Direction</b> lays items in a column or a row. Set <code>empty</code> for the blank-array case.</Def>
        <Def k="Status pill / dot">A small coloured badge or indicator; tone sets the colour (ok/warn/danger/accent/muted). A dot can pulse.</Def>
        <Def k="Icon">A line glyph (sun, check, book, clock, bolt…); tone sets its colour.</Def>
        <Def k="Big clock">A large time with up to two meta lines under it — point it at <code>clock.hm</code> / <code>clock.ss</code> (or any source).</Def>
        <Def k="Calendar / Weather">Self-contained cards that render from the <code>cal</code> / <code>weather</code> slices. No fields to set — drop one in (give the widget no eyebrow so it owns its own header).</Def>
        <Def k="Text / Eyebrow">A heading or body line (styles: title / body / sub / mono) / a small uppercase caption.</Def>
        <Def k="Divider">A rule, with an optional centered caption.</Def>
        <Def k="Link button">An anchor that opens a URL (text + url, either fixed or data-driven).</Def>
      </GuideCard>

      <GuideCard title="Conditions & states">
        <Def k="show if">Every element has an optional <b>show if</b>. Leave it blank and the element always shows; bind it to a boolean (e.g. <code>today</code> → <code>showTasks</code>, or <code>study</code> → <code>available</code>) and the element only renders when that’s true. Empty arrays, <code>0</code>, <code>""</code> and <code>false</code> count as “off”.</Def>
        <Def k="states">That’s how a card swaps between states: add one element per state, each with its own <b>show if</b> — e.g. a “SIGN IN” link <code>show if today.signedOut</code>, an “OFFLINE” note <code>show if today.showOffline</code>, and the task list <code>show if today.showTasks</code>. The slices expose ready-made flags (<code>signedOut, showOffline, showTasks, showEmpty</code>; <code>available, showStreak, unavailable</code>; <code>weather.offline</code>).</Def>
      </GuideCard>

      <GuideCard title="Publishing">
        <Def k="Live preview">Renders the widget exactly as the HUD will, against real data, as you edit.</Def>
        <Def k="Publish">Saves it server-wide (admin only). It appears on every HUD's "add widget" strip on next load — no redeploy.</Def>
        <Def k="Unpublish">Removes it from the registry. Already-placed copies fall back to a missing-widget card.</Def>
      </GuideCard>
    </div>
  );
}

function GuideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hud-card" style={{ padding: 18 }}>
      <span className="hud-eyebrow">{title}</span>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Def({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12.5, lineHeight: 1.5, color: 'var(--hub-cream)' }}>
      <span style={{ flex: 'none', width: 120, fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-amber)' }}>{k}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
