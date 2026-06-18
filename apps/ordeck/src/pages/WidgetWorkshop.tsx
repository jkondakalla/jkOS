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
import {
  useClock, useWeather, useSystems, useToday, useStudy, useMonthCalendar,
} from './hud/useHudData';
import { renderWidget, type WidgetCtx } from '../hud/registry';
import type { Binding, Tone, WidgetDef, WidgetNode } from '../hud/types';

/* ── Binding editor model ───────────────────────────────────────────────── */

type EB = { mode: 'lit' | 'data'; lit: string; src: string; path: string };
const eb = (lit = ''): EB => ({ mode: 'lit', lit, src: 'systems', path: '' });
const dataEb = (src: string, path: string): EB => ({ mode: 'data', lit: '', src, path });

const toBinding = (b: EB): Binding =>
  b.mode === 'data' ? { src: b.src, ...(b.path ? { path: b.path } : {}) } : b.lit;
const optBinding = (b?: EB): Binding | undefined =>
  !b || (b.mode === 'lit' && b.lit === '') ? undefined : toBinding(b);

/* ── Primitive catalog ──────────────────────────────────────────────────── */

type PrimType =
  | 'label' | 'text' | 'metric' | 'bar' | 'gauge' | 'pill' | 'dot'
  | 'keyval' | 'divider' | 'link' | 'list';

interface Row {
  type: PrimType;
  text?: EB; value?: EB; unit?: EB; sub?: EB; max?: EB; label?: EB; href?: EB;
  from?: EB; empty?: EB; itemLabel?: EB; itemValue?: EB;
  size?: string; variant?: string; tone?: Tone; pulse?: boolean;
}

const PRIMS: { type: PrimType; label: string; hint: string }[] = [
  { type: 'metric', label: 'Metric', hint: 'big number + unit' },
  { type: 'gauge', label: 'Gauge', hint: 'circular % ring' },
  { type: 'bar', label: 'Progress bar', hint: 'value vs max' },
  { type: 'keyval', label: 'Key / value', hint: 'name on the left, value on the right' },
  { type: 'list', label: 'List', hint: 'repeat a key/value row over an array' },
  { type: 'pill', label: 'Status pill', hint: 'small coloured badge' },
  { type: 'dot', label: 'Status dot', hint: 'coloured indicator' },
  { type: 'text', label: 'Text', hint: 'heading or body line' },
  { type: 'label', label: 'Eyebrow label', hint: 'small uppercase caption' },
  { type: 'divider', label: 'Divider', hint: 'rule, optional caption' },
  { type: 'link', label: 'Link button', hint: 'opens a URL' },
];

const TONES: Tone[] = ['ok', 'warn', 'danger', 'accent', 'muted'];
const SIZES = ['md', 'sm', 'xs'];
const VARIANTS = ['title', 'body', 'sub'];

/* ── Data-source field suggestions (drive the path datalists) ────────────── */

const HUD_SOURCES = ['clock', 'weather', 'systems', 'today', 'study', 'cal'];
const SCALAR_FIELDS: Record<string, string[]> = {
  clock: ['hm', 'ss', 'dateLine', 'utcShort', 'jday'],
  weather: ['temp', 'feels', 'desc', 'hi', 'lo', 'label'],
  systems: ['up', 'total'],
  study: ['streak', 'nextLesson', 'courseTitle', 'todayDone', 'dailyGoal'],
  cal: ['year', 'month'],
  today: ['authed'],
};
const ARRAY_FIELDS: Record<string, string[]> = {
  systems: ['rows'], today: ['tasks'], weather: ['slots'], cal: ['days'],
};
const ITEM_FIELDS = ['name', 'detail', 'status', 'title', 'time', 'done', 'tag', 'label', 'temp', 'date', 'count'];
const KNOWN_SUGGEST = [...HUD_SOURCES, '$'];
function pathSuggestions(src: string): string[] {
  if (src === '$') return ITEM_FIELDS;
  return [...(SCALAR_FIELDS[src] || []), ...(ARRAY_FIELDS[src] || [])];
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
    case 'list': return { type, from: dataEb('systems', 'rows'), empty: eb('NOTHING'), itemLabel: dataEb('$', 'name'), itemValue: dataEb('$', 'detail') };
  }
}

function toNode(r: Row): WidgetNode {
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
    case 'list': return { t: 'list', from: toBinding(r.from!), empty: optBinding(r.empty), item: { t: 'keyval', label: toBinding(r.itemLabel!), value: toBinding(r.itemValue!) } };
  }
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

  // Live preview context — the real HUD hooks, so previews show real values.
  const clock = useClock();
  const weather = useWeather();
  const systems = useSystems(true);
  const today = useToday();
  const study = useStudy();
  const cal = useMonthCalendar();
  const ctx: WidgetCtx = { clock, weather, systems, today, study, cal, authUrl: AUTH_URL };

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

  const isAdmin = user?.role === 'admin';

  const loadPublished = () => {
    fetch(`${AUTH_URL}/auth/widgets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { widgets: [] }))
      .then((d) => setPublished(Array.isArray(d.widgets) ? d.widgets : []))
      .catch(() => {});
  };
  useEffect(loadPublished, []);

  const sources = useMemo(() => [...HUD_SOURCES, ...fetches.map((f) => f.name).filter(Boolean), '$'], [fetches]);

  // Stable sources object so editing the body doesn't refetch live endpoints.
  const sourcesObj = useMemo(() => {
    const m: Record<string, { from: 'fetch'; url: string; poll?: number }> = {};
    for (const f of fetches) if (f.name && f.url) m[f.name] = { from: 'fetch', url: f.url, poll: f.poll ? Number(f.poll) : undefined };
    return Object.keys(m).length ? m : undefined;
  }, [fetches]);

  const def = useMemo<WidgetDef>(() => ({
    id: id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    label: label || id || 'Untitled',
    sizing: { desktop: { w: clamp(dw, 1, 12), h: clamp(dh, 1, 40) }, mobile: { w: clamp(mw, 1, 2), h: clamp(mh, 1, 40) } },
    spec: {
      frame: { eyebrow: eyebrow || undefined, source: source || undefined },
      sources: sourcesObj,
      body: { t: 'stack', gap: 10, children: rows.map(toNode) },
    },
  }), [id, label, eyebrow, source, dw, dh, mw, mh, rows, sourcesObj]);

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
                  {(r.type === 'pill' || r.type === 'dot' || r.type === 'keyval') && <Line t="tone"><Select value={r.tone!} onChange={(v) => setRow(i, { tone: v as Tone })} options={TONES} /></Line>}
                  {r.type === 'dot' && <Line t="pulse"><input type="checkbox" checked={!!r.pulse} onChange={(e) => setRow(i, { pulse: e.target.checked })} /></Line>}
                  {(r.type === 'metric' || r.type === 'bar' || r.type === 'gauge') && <Line t="value"><BindingInput value={r.value!} sources={sources} onChange={bind(i, 'value')} /></Line>}
                  {r.type === 'metric' && <><Line t="unit"><BindingInput value={r.unit!} sources={sources} onChange={bind(i, 'unit')} /></Line><Line t="sub"><BindingInput value={r.sub!} sources={sources} onChange={bind(i, 'sub')} /></Line></>}
                  {(r.type === 'bar' || r.type === 'gauge') && <Line t="max"><BindingInput value={r.max!} sources={sources} onChange={bind(i, 'max')} /></Line>}
                  {r.type === 'gauge' && <Line t="caption"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line>}
                  {r.type === 'keyval' && <><Line t="label"><BindingInput value={r.label!} sources={sources} onChange={bind(i, 'label')} /></Line><Line t="value"><BindingInput value={r.value!} sources={sources} onChange={bind(i, 'value')} /></Line></>}
                  {r.type === 'divider' && <Line t="caption"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line>}
                  {r.type === 'link' && <><Line t="text"><BindingInput value={r.text!} sources={sources} onChange={bind(i, 'text')} /></Line><Line t="url"><BindingInput value={r.href!} sources={sources} onChange={bind(i, 'href')} /></Line></>}
                  {r.type === 'list' && <>
                    <Line t="from []"><BindingInput value={r.from!} sources={sources} onChange={bind(i, 'from')} /></Line>
                    <Line t="empty"><BindingInput value={r.empty!} sources={sources} onChange={bind(i, 'empty')} /></Line>
                    <Line t="item key"><BindingInput value={r.itemLabel!} sources={sources} onChange={bind(i, 'itemLabel')} /></Line>
                    <Line t="item val"><BindingInput value={r.itemValue!} sources={sources} onChange={bind(i, 'itemValue')} /></Line>
                  </>}
                </div>
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
        <Def k="List">Repeats a key/value row over an array (the <code>from</code> field). Set <code>empty</code> for when the array is blank.</Def>
        <Def k="Status pill / dot">A small coloured badge or indicator; tone sets the colour (ok/warn/danger/accent/muted). A dot can pulse.</Def>
        <Def k="Text / Eyebrow">A heading or body line / a small uppercase caption.</Def>
        <Def k="Divider">A rule, with an optional centered caption.</Def>
        <Def k="Link button">An anchor that opens a URL (text + url, either fixed or data-driven).</Def>
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
