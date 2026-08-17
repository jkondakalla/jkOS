/**
 * pages/WidgetWorkshop.tsx — the admin "/widgets" workshop.
 *
 * A direct-manipulation CANVAS for composing a declarative widget (the
 * WidgetSpec the HUD factory renders), then publishing it server-wide via
 * jkAuth (`POST /auth/widgets`). Admin-only. No code, no redeploy.
 *
 * The widget-under-construction renders as a real card against live data; you
 * edit it in place — tap to select (properties open in the inspector),
 * right-click or long-hold to add compatible primitives right there, drag
 * elements to rearrange or re-nest them, drag the card's edges to resize its
 * grid footprint. The editor works on the WidgetNode tree itself (workshop/
 * model.ts), so round-tripping a published widget is lossless — nested rows
 * and stacks that the old flat form editor dropped now load and edit fine.
 *
 * Two tabs: BUILD (the canvas) and GUIDE (what everything means).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { authFetch } from '@jkos/auth-client';
import { AUTH_URL, useJkOSPreferences } from '../hooks/useJkOSPreferences';
import { useBreakpoint } from '@jkos/ui';
import { useHudContext } from './hud/useHudContext';
import { renderWidget, useDataSources, type Scope } from '../hud/registry';
import type { WidgetDef, WidgetNode } from '../hud/types';
import { WIDGET_EDIT_KEY } from '../hud/state';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  allowedTypes, catalogEntry, duplicateEn, emptyStack, enToNode, findEn, findPlace, insertKid,
  isKidContainer, moveEn, newId, newNode, nodeToEn, patchEn, removeEn, rewrite, setSlot, wrapEn,
  type ENode,
} from '../workshop/model';
import { EditorCanvas, TIERS, ROW_H, unitsToPx, type GhostAdd, type TierName } from '../workshop/EditorCanvas';
import { ContextMenu, type MenuGroup } from '../workshop/ContextMenu';
import { Inspector, HUD_SOURCES, type FetchRow, type IdentityState, type SizingState } from '../workshop/Inspector';
import '../styles/hud.css';

const clampU = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n || lo));

// This page has no inputs of its own — `field` existed only as the base of
// ghostBtn, which is a button. Folded in so the input dialect stops being
// copied forward with each new workshop page.
const ghostBtn: CSSProperties = {
  background: 'var(--hub-bg-0)', border: '1px solid var(--hub-line)', color: 'var(--hub-cream-bright)',
  fontFamily: 'var(--hub-font-mono)', fontSize: 12, padding: '5px 8px',
  borderRadius: 'var(--hub-radius-sm)', minWidth: 0, cursor: 'pointer',
};

const initialRoot = (): ENode => ({
  id: newId(),
  node: { t: 'stack', gap: 10, children: [] },
  kids: [newNode('metric')],
});

interface Snap { root: ENode; sizing: SizingState }

export default function WidgetWorkshop() {
  const { user } = useJkOSPreferences();
  const isAdmin = user?.role === 'admin';

  // The canvas renders against the real HUD context, so edits show real values.
  const ctx = useHudContext(true);
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';

  const [tab, setTab] = useState<'build' | 'guide'>('build');
  const [identity, setIdentity] = useState<IdentityState>({ id: '', label: '', eyebrow: '', source: '', refresh: '', fetches: [] });
  const [sizing, setSizing] = useState<SizingState>({ dw: 3, dh: 5, mw: 2, mh: 4 });
  const [root, setRoot] = useState<ENode>(initialRoot);
  const [sel, setSel] = useState<string | null>(null);
  const [tier, setTier] = useState<TierName>('desktop');
  const [view, setView] = useState<'edit' | 'live'>('edit');
  const [menu, setMenu] = useState<{ x: number; y: number; targetId: string } | null>(null);
  const [ghost, setGhost] = useState<GhostAdd | null>(null);
  const [published, setPublished] = useState<WidgetDef[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  /* ── undo / redo (tree + footprint snapshots) ──────────────────────────── */
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const coalesceRef = useRef<{ key: string; at: number } | null>(null);
  const resizeBase = useRef<SizingState | null>(null);

  /** Apply a mutation as one undo step. Consecutive edits with the same
   *  coalesce key (inspector keystrokes on one node) fold into one step. */
  const commit = (next: { root?: ENode; sizing?: SizingState }, coalesce?: string) => {
    const now = Date.now();
    const fold = !!coalesce && coalesceRef.current?.key === coalesce && now - coalesceRef.current.at < 1200;
    coalesceRef.current = coalesce ? { key: coalesce, at: now } : null;
    if (!fold) setPast((p) => [...p.slice(-99), { root, sizing }]);
    setFuture([]);
    if (next.root) setRoot(next.root);
    if (next.sizing) setSizing(next.sizing);
  };

  const undo = () => {
    if (!past.length) return;
    const last = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([...future, { root, sizing }]);
    setRoot(last.root);
    setSizing(last.sizing);
    coalesceRef.current = null;
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setPast([...past, { root, sizing }]);
    setRoot(next.root);
    setSizing(next.sizing);
    coalesceRef.current = null;
  };

  const closeMenu = () => { setMenu(null); setGhost(null); };

  /* ── published widgets (jkAuth registry) ───────────────────────────────── */
  // authFetch throughout: an expired access token silently refreshes instead of
  // 401ing — a stale list here is how "publish worked but nothing changed" happens.
  const loadPublished = () => {
    authFetch(`${AUTH_URL}/auth/widgets`)
      .then((r) => (r.ok ? r.json() : { widgets: [] }))
      .then((d) => setPublished(Array.isArray(d.widgets) ? d.widgets : []))
      .catch(() => {});
  };
  useEffect(loadPublished, []);

  /* ── load an existing def into the editor (lossless) ───────────────────── */
  function loadDef(def: WidgetDef) {
    if (!def.spec) return;
    // Frame captions are Bindings; only a plain string (or {lit} string) maps
    // back into the text inputs — a data-bound caption loads blank.
    const frameText = (b: unknown): string =>
      typeof b === 'string' ? b
        : b && typeof b === 'object' && 'lit' in b && typeof (b as { lit: unknown }).lit === 'string' ? (b as { lit: string }).lit
          : '';
    const fetches: FetchRow[] = [];
    for (const [name, s] of Object.entries(def.spec.sources || {})) {
      if (s?.from === 'fetch') fetches.push({ name, url: s.url, poll: s.poll != null ? String(s.poll) : '' });
    }
    setIdentity({
      id: def.id || '',
      label: def.label || '',
      eyebrow: frameText(def.spec.frame?.eyebrow),
      source: frameText(def.spec.frame?.source),
      refresh: def.refreshMs ? String(def.refreshMs / 1000) : '',
      fetches,
    });
    setSizing({
      dw: def.sizing?.desktop?.w ?? 3, dh: def.sizing?.desktop?.h ?? 5,
      mw: def.sizing?.mobile?.w ?? 2, mh: def.sizing?.mobile?.h ?? 4,
    });
    const body = def.spec.body;
    // Everything loads under a root stack; emission unwraps a lone form/molecule
    // back to the exact body shapes the old builder produced.
    setRoot(body.t === 'stack'
      ? nodeToEn(body)
      : { id: newId(), node: { t: 'stack', gap: 10, children: [] }, kids: [nodeToEn(body)] });
    setPast([]); setFuture([]); setSel(null); closeMenu();
  }

  // If the HUD handed us a card to edit (pencil affordance), load it once.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(WIDGET_EDIT_KEY);
      if (raw) localStorage.removeItem(WIDGET_EDIT_KEY);
    } catch { return; }
    if (!raw) return;
    try {
      const def = JSON.parse(raw) as WidgetDef;
      if (!def?.spec) return;
      loadDef(def);
      setMsg(`Editing "${def.id}" — change anything and re-publish to update it everywhere.`);
    } catch { /* malformed handoff — start blank */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── the spec (single source: the ENode tree + identity/sizing) ────────── */

  const sources = useMemo(
    () => [...HUD_SOURCES, ...identity.fetches.map((f) => f.name).filter(Boolean), '$'],
    [identity.fetches],
  );

  // Stable sources object so editing the body doesn't refetch live endpoints.
  const sourcesObj = useMemo(() => {
    const m: Record<string, { from: 'fetch'; url: string; poll?: number }> = {};
    for (const f of identity.fetches) if (f.name && f.url) m[f.name] = { from: 'fetch', url: f.url, poll: f.poll ? Number(f.poll) : undefined };
    return Object.keys(m).length ? m : undefined;
  }, [identity.fetches]);

  const kids = root.kids ?? [];
  const lone = kids.length === 1 ? kids[0] : null;
  // A lone molecule is its own card — emit it frameless so it isn't
  // double-wrapped; a lone form emits directly as the body (old shape).
  // `time` is in the set because the clock is DESIGNED to sit raw on the
  // background (the one chromeless card): an empty frame around it would
  // wrap it in card chrome on every HUD.
  const onlyMolecule = !!lone &&
    (lone.node.t === 'calendar' || lone.node.t === 'weather' || lone.node.t === 'time');

  const def = useMemo<WidgetDef>(() => {
    const body: WidgetNode = lone && (onlyMolecule || lone.node.t === 'form') ? enToNode(lone) : enToNode(root);
    const refreshMs = identity.refresh ? Math.max(1000, Math.round(Number(identity.refresh) * 1000)) : 0;
    return {
      id: identity.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      label: identity.label || identity.id || 'Untitled',
      sizing: {
        desktop: { w: clampU(sizing.dw, 1, 12), h: clampU(sizing.dh, 1, 40) },
        mobile: { w: clampU(sizing.mw, 1, 2), h: clampU(sizing.mh, 1, 40) },
      },
      ...(refreshMs > 0 ? { refreshMs } : {}),
      spec: {
        frame: onlyMolecule ? undefined : { eyebrow: identity.eyebrow || undefined, source: identity.source || undefined },
        sources: sourcesObj,
        body,
      },
    };
  }, [identity, sizing, root, sourcesObj, lone, onlyMolecule]);

  // Canvas binding scope = the live HUD slices + any declared fetch sources.
  const fetched = useDataSources(sourcesObj);
  const scope: Scope = { ...(ctx as unknown as Scope), ...fetched };

  /* ── canvas callbacks ──────────────────────────────────────────────────── */

  const size = tier === 'desktop' ? { w: sizing.dw, h: sizing.dh } : { w: sizing.mw, h: sizing.mh };

  const handleResize = (w: number, h: number, commitIt: boolean) => {
    if (!resizeBase.current) resizeBase.current = sizing;
    const patch = tier === 'desktop' ? { dw: w, dh: h } : { mw: w, mh: h };
    if (!commitIt) { setSizing((s) => ({ ...s, ...patch })); return; }
    // One undo step spanning the whole handle drag (from the pre-drag footprint).
    const base = resizeBase.current;
    resizeBase.current = null;
    setPast((p) => [...p.slice(-99), { root, sizing: base }]);
    setFuture([]);
    setSizing((s) => ({ ...s, ...patch }));
  };

  const deleteNode = (id: string) => {
    if (id === root.id) return;
    commit({ root: removeEn(root, id) });
    if (sel === id) setSel(null);
  };

  /* ── context menu content ──────────────────────────────────────────────── */

  const menuGroups = useMemo<MenuGroup[] | null>(() => {
    if (!menu) return null;
    const targetId = menu.targetId;
    const isRoot = targetId === root.id;
    const target = isRoot ? root : findEn(root, targetId);
    if (!target) return null;
    // Adds land INSIDE a container target (at the pointer-agnostic end), or
    // right AFTER a leaf target among its siblings.
    const container = isKidContainer(target.node.t) ? target : null;
    const place = container ? null : findPlace(root, targetId);
    const parent = container ?? place?.parent ?? root;
    const index = container ? (container.kids?.length ?? 0)
      : place && place.key.kind === 'kid' ? place.key.index + 1
        : (parent.kids?.length ?? 0);

    const groups: MenuGroup[] = [{
      head: isRoot ? 'ADD ELEMENT' : container ? `ADD INSIDE ${target.node.t.toUpperCase()}` : 'ADD BELOW',
      items: allowedTypes(root, parent).map((t) => {
        const c = catalogEntry(t);
        return {
          key: `add-${t}`,
          label: c.label,
          hint: c.hint,
          onPick: () => {
            const child = newNode(t);
            commit({ root: insertKid(root, parent.id, index, child) });
            setSel(child.id);
            closeMenu();
          },
          onHover: (on: boolean) => setGhost(on ? { t, parentId: parent.id, index } : null),
        };
      }),
    }];

    if (!isRoot) {
      const canDupe = place?.key.kind === 'kid';
      const items = [
        { key: 'props', label: 'Properties', hint: 'edit in the inspector', onPick: () => { setSel(targetId); closeMenu(); } },
        ...(canDupe ? [{
          key: 'dupe', label: 'Duplicate', hint: 'copy right below',
          onPick: () => { const { root: r2, newId: nid } = duplicateEn(root, targetId); commit({ root: r2 }); if (nid) setSel(nid); closeMenu(); },
        }] : []),
        { key: 'wrap-row', label: 'Wrap in row', hint: 'side-by-side group', onPick: () => { const { root: r2, newId: nid } = wrapEn(root, targetId, 'row'); commit({ root: r2 }); if (nid) setSel(nid); closeMenu(); } },
        { key: 'wrap-stack', label: 'Wrap in stack', hint: 'vertical group', onPick: () => { const { root: r2, newId: nid } = wrapEn(root, targetId, 'stack'); commit({ root: r2 }); if (nid) setSel(nid); closeMenu(); } },
        ...(target.node.t !== 'when' ? [{
          key: 'wrap-when', label: 'Show only if…', hint: 'wrap in a condition',
          onPick: () => { const { root: r2, newId: nid } = wrapEn(root, targetId, 'when'); commit({ root: r2 }); if (nid) setSel(nid); closeMenu(); },
        }] : []),
        ...(target.node.t === 'when' && !target.slots?.else ? [{
          key: 'add-else', label: 'Add ELSE branch', hint: 'shown when the condition is false',
          onPick: () => { commit({ root: setSlot(root, targetId, 'else', emptyStack()) }); closeMenu(); },
        }] : []),
        { key: 'delete', label: 'Delete', hint: 'remove this element', danger: true, onPick: () => { deleteNode(targetId); closeMenu(); } },
      ];
      groups.push({ head: 'ELEMENT', items });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, root]);

  /* ── keyboard: esc / delete / undo-redo ────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') { closeMenu(); if (!typing) setSel(null); return; }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel !== root.id) deleteNode(sel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── publish ───────────────────────────────────────────────────────────── */

  async function publish() {
    if (!def.id) { setMsg('Give the widget an id first (tap the card background).'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await authFetch(`${AUTH_URL}/auth/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(def),
      });
      if (r.ok) { setMsg(`Published "${def.id}" — it's on every HUD's add strip now.`); loadPublished(); }
      else if (r.status === 403) setMsg('Admin access required to publish.');
      else setMsg(`Publish failed (${r.status}).`);
    } catch { setMsg('Network error while publishing.'); }
    setBusy(false);
  }

  async function unpublish(wid: string) {
    await authFetch(`${AUTH_URL}/auth/widgets/${encodeURIComponent(wid)}`, { method: 'DELETE' }).catch(() => {});
    loadPublished();
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  if (user && !isAdmin) {
    return <Shell tab={tab} setTab={setTab}><p style={{ color: 'var(--hub-cream-dim)', fontFamily: 'var(--hub-font-mono)' }}>The widget workshop is admin-only.</p></Shell>;
  }

  const selEn = sel && sel !== root.id ? findEn(root, sel) : null;
  const cardW = unitsToPx(size.w, TIERS[tier].colW);
  const cardH = unitsToPx(size.h, ROW_H);

  const inspector = (
    <Inspector
      sel={selEn}
      sources={sources}
      identity={identity}
      moleculeOnly={onlyMolecule}
      onIdentity={(p) => setIdentity((s) => ({ ...s, ...p }))}
      sizing={sizing}
      onSizing={(p) => commit({ sizing: { ...sizing, ...p } }, 'sizing')}
      onPatch={(id, patch) => commit({ root: patchEn(root, id, patch) }, `prop:${id}`)}
      onPatchForm={(id, cmd, controls) => {
        const next = rewrite(root, id, (en) => {
          if (en.node.t !== 'form') return en;
          const keep = (en.kids ?? []).filter((k) => k.node.t !== 'input' && k.node.t !== 'select' && k.node.t !== 'toggle');
          return { ...en, node: { ...en.node, cmd }, kids: [...keep, ...controls.map(nodeToEn)] };
        });
        commit({ root: next }, `form:${id}`);
      }}
      onDelete={(id) => { deleteNode(id); }}
      onDuplicate={(id) => { const { root: r2, newId: nid } = duplicateEn(root, id); commit({ root: r2 }); if (nid) setSel(nid); }}
    />
  );

  const toolBtn = (on: boolean): CSSProperties => ({
    ...ghostBtn, padding: '5px 10px',
    background: on ? 'var(--hub-amber)' : 'transparent',
    color: on ? 'var(--hub-bg-0)' : 'var(--hub-cream)',
    border: on ? '1px solid var(--hub-amber)' : '1px solid var(--hub-line)',
  });

  return (
    <Shell tab={tab} setTab={setTab}>
      {tab === 'guide' ? <Guide /> : (
        <div className="wc-layout" style={isDesktop ? { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 24, alignItems: 'start' } : undefined}>
          <div>
            <div className="wc-toolbar">
              <span className="hud-eyebrow">CANVAS · {size.w}×{size.h}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button style={toolBtn(tier === 'desktop')} onClick={() => setTier('desktop')}>desktop</button>
                <button style={toolBtn(tier === 'mobile')} onClick={() => setTier('mobile')}>mobile</button>
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button style={toolBtn(view === 'edit')} onClick={() => setView('edit')}>edit</button>
                <button style={toolBtn(view === 'live')} onClick={() => setView('live')}>live</button>
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button style={{ ...ghostBtn, opacity: past.length ? 1 : 0.4 }} disabled={!past.length} onClick={undo}>↶ undo</button>
                <button style={{ ...ghostBtn, opacity: future.length ? 1 : 0.4 }} disabled={!future.length} onClick={redo}>↷ redo</button>
              </span>
              <span className="wc-toolhint">tap = select · hold / right-click = add · drag = move · edges = resize</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={publish} disabled={busy} style={{ ...ghostBtn, background: 'var(--hub-amber)', color: 'var(--hub-bg-0)', fontWeight: 600, padding: '7px 14px', border: 'none' }}>
                  {busy ? 'Publishing…' : 'Publish'}
                </button>
              </span>
            </div>
            {msg && <p style={{ fontSize: 12, color: 'var(--hub-cream)', margin: '8px 0 0' }}>{msg}</p>}

            <div className="wc-canvaswrap">
              {view === 'edit' ? (
                <div style={{ position: 'relative' }}>
                  <ErrorBoundary widgetName="canvas" resetKey={root}>
                    <EditorCanvas
                      root={root}
                      scope={scope}
                      frame={onlyMolecule ? null : { eyebrow: identity.eyebrow, source: identity.source }}
                      tier={tier}
                      size={size}
                      selection={sel}
                      ghost={ghost}
                      onSelect={setSel}
                      onOpenMenu={(pt, targetId) => setMenu({ ...pt, targetId })}
                      onMoveNode={(id, parentId, index) => commit({ root: moveEn(root, id, parentId, index) })}
                      onResize={handleResize}
                    />
                  </ErrorBoundary>
                  {menu && menuGroups && <ContextMenu x={menu.x} y={menu.y} groups={menuGroups} onClose={closeMenu} />}
                </div>
              ) : (
                <div className="wc-stage">
                  <div style={{ width: cardW, height: cardH }}>{renderWidget(def, ctx)}</div>
                </div>
              )}
            </div>
          </div>

          {isDesktop ? (
            <div style={{ position: 'sticky', top: 16 }}>
              {inspector}
              <PublishedList published={published} onEdit={(w) => { loadDef(w); setMsg(`Editing "${w.id}" — re-publish to update it everywhere.`); }} onUnpublish={unpublish} />
            </div>
          ) : (
            <>
              <PublishedList published={published} onEdit={(w) => { loadDef(w); setMsg(`Editing "${w.id}" — re-publish to update it everywhere.`); }} onUnpublish={unpublish} />
              {sel !== null && (
                <>
                  <div className="wc-sheet-scrim" onClick={() => setSel(null)} />
                  <div className="wc-sheet">
                    <div className="wc-sheet-handle" onClick={() => setSel(null)} />
                    {inspector}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Shell>
  );
}

/* ── published list ─────────────────────────────────────────────────────── */

function PublishedList({ published, onEdit, onUnpublish }: {
  published: WidgetDef[];
  onEdit: (w: WidgetDef) => void;
  onUnpublish: (id: string) => void;
}) {
  return (
    <>
      <span className="hud-eyebrow" style={{ display: 'block', marginTop: 20 }}>PUBLISHED ({published.length})</span>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {published.length === 0 && <span style={{ fontSize: 11, color: 'var(--hub-cream-faint)' }}>None yet.</span>}
        {published.map((w) => (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--hub-font-mono)', fontSize: 11, color: 'var(--hub-cream)' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.label} <span style={{ color: 'var(--hub-cream-faint)' }}>· {w.id}</span></span>
            {w.spec && <button style={ghostBtn} onClick={() => onEdit(w)}>edit</button>}
            <button style={ghostBtn} onClick={() => onUnpublish(w.id)}>unpublish</button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── layout shell ───────────────────────────────────────────────────────── */

function Shell({ tab, setTab, children }: { tab: 'build' | 'guide'; setTab: (t: 'build' | 'guide') => void; children: ReactNode }) {
  const tabBtn = (key: 'build' | 'guide'): CSSProperties => ({
    ...ghostBtn, padding: '5px 14px',
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
      <GuideCard title="The canvas">
        <Def k="tap">Select an element — its properties open in the inspector (bottom sheet on touch). Tap the card background for the widget's own identity, sizing, refresh, and data sources.</Def>
        <Def k="add">Right-click (mouse) or press-and-HOLD then release (touch) anywhere: a menu lists every element compatible with that spot. Hovering an entry previews a translucent ghost of it in place.</Def>
        <Def k="move">Drag an element to rearrange it — drop lines show where it lands, including into rows, stacks, forms, a list's item template, or a condition's branches.</Def>
        <Def k="resize">Drag the card's right/bottom edges (or the corner) to resize its grid footprint. The desktop/mobile toggle picks which tier's footprint you're shaping.</Def>
        <Def k="undo">↶/↷ in the toolbar, or Ctrl+Z / Ctrl+Shift+Z. Delete removes the selected element.</Def>
        <Def k="edit vs live">EDIT shows editor chrome (labeled groups, both branches of a condition, one list row). LIVE renders exactly what the HUD will ship.</Def>
      </GuideCard>

      <GuideCard title="Identity & size">
        <Def k="id">Unique key (lowercase, dashes). Re-publishing the same id overwrites it.</Def>
        <Def k="label">Friendly name shown on the HUD's "add widget" strip.</Def>
        <Def k="eyebrow / source">Small captions at the card's top-left / top-right. Optional.</Def>
        <Def k="size">Footprint in grid cells. Desktop is a 12-column grid; mobile is strict 2-column. A row is ~44px tall, so h:5 ≈ 220px.</Def>
      </GuideCard>

      <GuideCard title="Data sources & paths">
        <Def k="HUD slices">Always available: <code>clock, weather, systems, today, study, cal</code>. Pick one as a field's source and enter a path (e.g. <code>systems</code> → <code>up</code>).</Def>
        <Def k="Add source">Point at any JSON endpoint (widget properties → data sources): a <b>name</b>, the <b>URL</b>, and a <b>refresh</b> in seconds (blank = fetch once). The endpoint must permit browser/CORS access.</Def>
        <Def k="path">Dot-walks the JSON: <code>price</code> → <code>{'{price: 42}'}</code>; <code>data.v</code> → <code>{'{data:{v:9}}'}</code>; <code>items.0.name</code> → first array element.</Def>
        <Def k="fixed vs data">Every field is either <b>lit</b> (a fixed value you type) or <b>data</b> (pulled live from a source + path).</Def>
        <Def k="$ (list item)">Inside a List's item template, fields use the <code>$</code> source — the current array element. e.g. for <code>systems.rows</code>, <code>$</code> → <code>name</code> / <code>detail</code>.</Def>
      </GuideCard>

      <GuideCard title="Elements">
        <Def k="Metric / Gauge / Bar">A big number with unit; a circular value÷max ring; a horizontal fill. Metric and Gauge take a size so they work as compact inline stats too.</Def>
        <Def k="Sparkline">A tiny trend line over a bound array — set the array (e.g. <code>weather.slots</code>) and the number field per element (e.g. <code>temp</code>).</Def>
        <Def k="Key / value">A name on the left and a value on the right; tone colours the name.</Def>
        <Def k="List">Repeats its item template over a bound array. On the canvas you edit the template once (EACH ITEM) against the first live element; compose any row from text/pills/dots inside it. Columns wraps it into an N-column grid for dense fact lists.</Def>
        <Def k="Pill / Dot / Icon">Small coloured badge / indicator / line glyph; tone sets the colour (ok/warn/danger/accent/muted) and can be data-bound (e.g. <code>$.tone</code>).</Def>
        <Def k="Row / Stack">Layout groups — side-by-side or vertical. Drag elements in and out; wrap an element via its menu.</Def>
        <Def k="Condition">Shows THEN when the bound value is truthy, otherwise ELSE (add the branch from the menu). Empty arrays, <code>0</code>, <code>""</code> and <code>false</code> count as "off". That's how a card swaps states — the slices expose ready-made flags (<code>signedOut, showOffline, showTasks, available…</code>).</Def>
        <Def k="Calendar / Weather">Self-contained cards from the <code>cal</code>/<code>weather</code> slices. Alone in a widget they own the whole card (frameless).</Def>
        <Def k="Big clock / Text / Eyebrow / Divider / Link">A large time with meta lines; a heading or body line; a small caption; a rule; an anchor that opens a URL.</Def>
      </GuideCard>

      <GuideCard title="Actions (writes)">
        <Def k="Action form">A form that submits a command to a suite app — pick the app + action in the inspector (discovered from its capabilities), then map each field: <b>input</b> (a control appears in the form), <b>lit</b> (fixed), <b>data</b> (a live slice), or <b>skip</b>.</Def>
        <Def k="Action button">One tap runs a command — same mapping, minus user inputs.</Def>
        <Def k="Form controls">Input/select/toggle elements live inside a form and write into its <code>$form</code> scope; the field mapper manages them for you.</Def>
      </GuideCard>

      <GuideCard title="Publishing">
        <Def k="Live data">The canvas renders against real data as you edit; LIVE shows the exact shipped card.</Def>
        <Def k="Publish">Saves it server-wide (admin only). It appears on every HUD's "add widget" strip on next load — no redeploy.</Def>
        <Def k="Edit / Unpublish">Edit loads a published widget back onto the canvas — losslessly, including nested layouts. Unpublish removes it from the registry.</Def>
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
