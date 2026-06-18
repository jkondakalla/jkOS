/**
 * pages/WidgetWorkshop.tsx — the admin "/widgets" workshop.
 *
 * A guided GUI for composing a declarative widget (the same WidgetSpec the HUD
 * factory renders) with a live preview, then publishing it server-wide via
 * jkAuth (`POST /auth/widgets`). Admin-only. No code, no redeploy: a published
 * widget appears on every HUD's "add widget" strip on next load.
 */

import { useEffect, useMemo, useState } from 'react';
import { AUTH_URL, useJkOSPreferences } from '../hooks/useJkOSPreferences';
import {
  useClock, useWeather, useSystems, useToday, useStudy, useMonthCalendar,
} from './hud/useHudData';
import { renderWidget, type WidgetCtx } from '../hud/registry';
import type { Binding, WidgetDef, WidgetNode } from '../hud/types';

/* ── Editor model ───────────────────────────────────────────────────────── */

type EB = { mode: 'lit' | 'data'; lit: string; src: string; path: string };
const eb = (lit = ''): EB => ({ mode: 'lit', lit, src: 'systems', path: '' });

type PrimType = 'label' | 'text' | 'metric' | 'bar' | 'pill' | 'keyval' | 'list';
interface Row {
  type: PrimType;
  text?: EB; value?: EB; unit?: EB; sub?: EB; max?: EB; label?: EB;
  from?: EB; empty?: EB; itemLabel?: EB; itemValue?: EB;
  size?: string; variant?: string; tone?: string;
}

const HUD_SOURCES = ['clock', 'weather', 'systems', 'today', 'study', 'cal'];
const PRIMS: { type: PrimType; label: string }[] = [
  { type: 'label', label: 'Eyebrow label' },
  { type: 'text', label: 'Text' },
  { type: 'metric', label: 'Metric' },
  { type: 'bar', label: 'Progress bar' },
  { type: 'pill', label: 'Status pill' },
  { type: 'keyval', label: 'Key / value' },
  { type: 'list', label: 'List (key/value rows)' },
];

function newRow(type: PrimType): Row {
  switch (type) {
    case 'label': return { type, text: eb('LABEL'), size: 'md' };
    case 'text': return { type, text: eb('Heading'), variant: 'title' };
    case 'metric': return { type, value: eb('0'), unit: eb(''), sub: eb('') };
    case 'bar': return { type, value: eb('0'), max: eb('100') };
    case 'pill': return { type, text: eb('OK'), tone: 'ok' };
    case 'keyval': return { type, label: eb('Name'), value: eb('Value') };
    case 'list': return { type, from: { mode: 'data', lit: '', src: 'systems', path: 'rows' }, empty: eb('NOTHING'), itemLabel: { mode: 'data', lit: '', src: '$', path: 'name' }, itemValue: { mode: 'data', lit: '', src: '$', path: 'detail' } };
  }
}

const toBinding = (b: EB): Binding =>
  b.mode === 'data' ? { src: b.src, ...(b.path ? { path: b.path } : {}) } : b.lit;
const optBinding = (b?: EB): Binding | undefined =>
  !b || (b.mode === 'lit' && b.lit === '') ? undefined : toBinding(b);

/* ── Small inputs ───────────────────────────────────────────────────────── */

const fieldStyle: React.CSSProperties = {
  background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', color: 'var(--hub-cream-bright)',
  fontFamily: 'var(--hub-font-mono)', fontSize: 12, padding: '5px 8px', borderRadius: 'var(--hub-radius-sm)', minWidth: 0,
};

function BindingInput({ value, onChange, sources }: { value: EB; onChange: (v: EB) => void; sources: string[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <select style={{ ...fieldStyle, flex: 'none' }} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as EB['mode'] })}>
        <option value="lit">Text</option>
        <option value="data">Data</option>
      </select>
      {value.mode === 'lit' ? (
        <input style={{ ...fieldStyle, flex: 1 }} value={value.lit} placeholder="literal value" onChange={(e) => onChange({ ...value, lit: e.target.value })} />
      ) : (
        <>
          <select style={{ ...fieldStyle, flex: 'none' }} value={value.src} onChange={(e) => onChange({ ...value, src: e.target.value })}>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={{ ...fieldStyle, flex: 1 }} value={value.path} placeholder="path e.g. up" onChange={(e) => onChange({ ...value, path: e.target.value })} />
        </>
      )}
    </span>
  );
}

const lbl = (t: string) => <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--hub-cream-dim)', minWidth: 56 }}>{t}</span>;
const rowLine: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 };

/* ── Workshop ───────────────────────────────────────────────────────────── */

export default function WidgetWorkshop() {
  const { user } = useJkOSPreferences();

  // Live preview context — real HUD data, same hooks the dashboard uses.
  const clock = useClock();
  const weather = useWeather();
  const systems = useSystems(true);
  const today = useToday();
  const study = useStudy();
  const cal = useMonthCalendar();
  const ctx: WidgetCtx = { clock, weather, systems, today, study, cal, authUrl: AUTH_URL };

  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [eyebrow, setEyebrow] = useState('');
  const [source, setSource] = useState('');
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

  const sources = useMemo(
    () => [...HUD_SOURCES, ...fetches.map((f) => f.name).filter(Boolean), '$'],
    [fetches],
  );

  const def = useMemo<WidgetDef>(() => {
    const children: WidgetNode[] = rows.map((r) => {
      switch (r.type) {
        case 'label': return { t: 'label', text: toBinding(r.text!), size: (r.size as 'md') || undefined };
        case 'text': return { t: 'text', text: toBinding(r.text!), variant: (r.variant as 'title') || undefined };
        case 'metric': return { t: 'metric', value: toBinding(r.value!), unit: optBinding(r.unit), sub: optBinding(r.sub) };
        case 'bar': return { t: 'bar', value: toBinding(r.value!), max: optBinding(r.max) };
        case 'pill': return { t: 'pill', text: toBinding(r.text!), tone: (r.tone as 'ok') || undefined };
        case 'keyval': return { t: 'keyval', label: toBinding(r.label!), value: toBinding(r.value!) };
        case 'list': return { t: 'list', from: toBinding(r.from!), empty: optBinding(r.empty), item: { t: 'keyval', label: toBinding(r.itemLabel!), value: toBinding(r.itemValue!) } };
      }
    });
    const srcMap: Record<string, { from: 'fetch'; url: string; poll?: number }> = {};
    for (const f of fetches) if (f.name && f.url) srcMap[f.name] = { from: 'fetch', url: f.url, poll: f.poll ? Number(f.poll) : undefined };
    return {
      id: id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      label: label || id || 'Untitled',
      sizing: { desktop: { w: 3, h: 5 }, mobile: { w: 2, h: 4 } },
      spec: {
        frame: { eyebrow: eyebrow || undefined, source: source || undefined },
        sources: Object.keys(srcMap).length ? srcMap : undefined,
        body: { t: 'stack', gap: 10, children },
      },
    };
  }, [id, label, eyebrow, source, rows, fetches]);

  async function publish() {
    if (!def.id) { setMsg('Give the widget an id first.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${AUTH_URL}/auth/widgets`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(def),
      });
      if (r.ok) { setMsg(`Published "${def.id}" — it's live on every HUD's add strip.`); loadPublished(); }
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

  if (user && !isAdmin) {
    return <Shell><p style={{ color: 'var(--hub-cream-dim)', fontFamily: 'var(--hub-font-mono)' }}>The widget workshop is admin-only.</p></Shell>;
  }

  return (
    <Shell>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24, alignItems: 'start' }}>
        {/* Builder */}
        <div>
          <div className="hud-card" style={{ padding: 16 }}>
            <span className="hud-eyebrow">IDENTITY</span>
            <div style={rowLine}>{lbl('id')}<input style={{ ...fieldStyle, flex: 1 }} value={id} placeholder="e.g. btc-price" onChange={(e) => setId(e.target.value)} /></div>
            <div style={rowLine}>{lbl('label')}<input style={{ ...fieldStyle, flex: 1 }} value={label} placeholder="Display name" onChange={(e) => setLabel(e.target.value)} /></div>
            <div style={rowLine}>{lbl('eyebrow')}<input style={{ ...fieldStyle, flex: 1 }} value={eyebrow} placeholder="Card eyebrow (optional)" onChange={(e) => setEyebrow(e.target.value)} /></div>
            <div style={rowLine}>{lbl('source')}<input style={{ ...fieldStyle, flex: 1 }} value={source} placeholder="Right-side label (optional)" onChange={(e) => setSource(e.target.value)} /></div>
          </div>

          <div className="hud-card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="hud-eyebrow">DATA SOURCES (FETCH)</span>
              <button style={{ ...fieldStyle, marginLeft: 'auto', cursor: 'pointer' }} onClick={() => setFetches((f) => [...f, { name: '', url: '', poll: '' }])}>+ source</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--hub-cream-dim)', margin: '6px 0 0' }}>HUD slices ({HUD_SOURCES.join(', ')}) are always available. Add a fetch source to bind any JSON endpoint.</p>
            {fetches.map((f, i) => (
              <div key={i} style={rowLine}>
                <input style={{ ...fieldStyle, width: 90 }} value={f.name} placeholder="name" onChange={(e) => setFetches((fs) => fs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input style={{ ...fieldStyle, flex: 1 }} value={f.url} placeholder="https://api…/data.json" onChange={(e) => setFetches((fs) => fs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <input style={{ ...fieldStyle, width: 64 }} value={f.poll} placeholder="poll s" onChange={(e) => setFetches((fs) => fs.map((x, j) => (j === i ? { ...x, poll: e.target.value } : x)))} />
                <button style={{ ...fieldStyle, cursor: 'pointer' }} onClick={() => setFetches((fs) => fs.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>

          <div className="hud-card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="hud-eyebrow">BODY</span>
              <select style={{ ...fieldStyle, marginLeft: 'auto', cursor: 'pointer' }} value="" onChange={(e) => { if (e.target.value) setRows((rs) => [...rs, newRow(e.target.value as PrimType)]); }}>
                <option value="">+ add element…</option>
                {PRIMS.map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}
              </select>
            </div>
            {rows.map((r, i) => (
              <div key={i} style={{ borderTop: '1px solid var(--hub-line)', marginTop: 10, paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-amber)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{r.type}</span>
                  <button style={{ ...fieldStyle, marginLeft: 'auto', cursor: 'pointer' }} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>remove</button>
                </div>
                {(r.type === 'label' || r.type === 'text' || r.type === 'pill') && (
                  <div style={rowLine}>{lbl('text')}<BindingInput value={r.text!} sources={sources} onChange={(v) => setRow(i, { text: v })} /></div>
                )}
                {r.type === 'metric' && (<>
                  <div style={rowLine}>{lbl('value')}<BindingInput value={r.value!} sources={sources} onChange={(v) => setRow(i, { value: v })} /></div>
                  <div style={rowLine}>{lbl('unit')}<BindingInput value={r.unit!} sources={sources} onChange={(v) => setRow(i, { unit: v })} /></div>
                  <div style={rowLine}>{lbl('sub')}<BindingInput value={r.sub!} sources={sources} onChange={(v) => setRow(i, { sub: v })} /></div>
                </>)}
                {r.type === 'bar' && (<>
                  <div style={rowLine}>{lbl('value')}<BindingInput value={r.value!} sources={sources} onChange={(v) => setRow(i, { value: v })} /></div>
                  <div style={rowLine}>{lbl('max')}<BindingInput value={r.max!} sources={sources} onChange={(v) => setRow(i, { max: v })} /></div>
                </>)}
                {r.type === 'keyval' && (<>
                  <div style={rowLine}>{lbl('label')}<BindingInput value={r.label!} sources={sources} onChange={(v) => setRow(i, { label: v })} /></div>
                  <div style={rowLine}>{lbl('value')}<BindingInput value={r.value!} sources={sources} onChange={(v) => setRow(i, { value: v })} /></div>
                </>)}
                {r.type === 'list' && (<>
                  <div style={rowLine}>{lbl('from[]')}<BindingInput value={r.from!} sources={sources} onChange={(v) => setRow(i, { from: v })} /></div>
                  <div style={rowLine}>{lbl('empty')}<BindingInput value={r.empty!} sources={sources} onChange={(v) => setRow(i, { empty: v })} /></div>
                  <div style={rowLine}>{lbl('item key')}<BindingInput value={r.itemLabel!} sources={sources} onChange={(v) => setRow(i, { itemLabel: v })} /></div>
                  <div style={rowLine}>{lbl('item val')}<BindingInput value={r.itemValue!} sources={sources} onChange={(v) => setRow(i, { itemValue: v })} /></div>
                </>)}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button onClick={publish} disabled={busy} style={{ ...fieldStyle, cursor: 'pointer', background: 'var(--hub-amber)', color: 'var(--hub-bg-0)', fontWeight: 600, padding: '8px 16px', border: 'none' }}>
              {busy ? 'Publishing…' : 'Publish server-wide'}
            </button>
            {msg && <span style={{ fontSize: 12, color: 'var(--hub-cream)' }}>{msg}</span>}
          </div>
        </div>

        {/* Preview + published list */}
        <div style={{ position: 'sticky', top: 16 }}>
          <span className="hud-eyebrow">LIVE PREVIEW</span>
          <div style={{ marginTop: 8, minHeight: 140 }}>
            {renderWidget(def, ctx)}
          </div>
          <span className="hud-eyebrow" style={{ display: 'block', marginTop: 20 }}>PUBLISHED ({published.length})</span>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {published.length === 0 && <span style={{ fontSize: 11, color: 'var(--hub-cream-faint)' }}>None yet.</span>}
            {published.map((w) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.label} <span style={{ color: 'var(--hub-cream-faint)' }}>· {w.id}</span></span>
                <button style={{ ...fieldStyle, cursor: 'pointer' }} onClick={() => unpublish(w.id)}>unpublish</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: 'var(--hub-bg-1)', padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <a href="/" style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 12, color: 'var(--hub-cream-dim)', textDecoration: 'none' }}>← HUD</a>
        <h1 style={{ fontFamily: 'var(--hub-font-serif, var(--hub-font-sans))', fontSize: 24, color: 'var(--hub-cream-bright)', margin: 0 }}>Widget Workshop</h1>
        <span style={{ fontFamily: 'var(--hub-font-mono)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--hub-cream-faint)', textTransform: 'uppercase' }}>jkos.net/widgets</span>
      </div>
      {children}
    </div>
  );
}
