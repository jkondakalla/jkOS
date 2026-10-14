/**
 * render.tsx — the widget renderer, for whichever app hosts a widget.
 *
 * A widget is a declarative SPEC: a frame (card chrome) + named data sources + a tree of
 * PRIMITIVES bound to data. Adding a primitive is one entry in the map below; adding a
 * WIDGET is pure data — the shape a text→widget AI step emits.
 *
 * The HOST is the app the widget is drawn in. It hands the renderer a WidgetHost: its
 * declared slices (what a binding's `src` may name besides the widget's own sources),
 * where to sign in, the AI kill switch, this instant, and the kinds only it can draw —
 * the manifest's molecules (HostKind), each reading one of its slices. Everything else
 * is here, once: the frame and the states it owns, the sources, the bindings, the
 * patterns, the command family, and the per-card update gate. It lived in ORDECK as
 * hud/registry.tsx until 2026-09-30, typed against ORDECK's own data hooks, so no other
 * app could draw a widget.
 *
 * A host kind may be a React.lazy component: it is drawn under Suspense, so a heavy one
 * (a WebGL map) is downloaded only when a widget that uses it is placed.
 */

import {
  Fragment, Suspense, createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ComponentType, type CSSProperties, type FormEvent, type ReactNode,
} from 'react';
import {
  fetchCapabilities, getCapability, runCommand, suiteApp, followJob, format, type CapabilityDef, type CapabilityDoc, type JobOutcome,
  type FieldType, type SuiteApp, resolveBinding, truthy } from '@jkos/weave';
import type { ActionChain, Binding, CommandRef, HostKind, IconName, Tone, ToneBinding, WidgetAction, WidgetDef, WidgetNode, WidgetSpec } from './types';
import { useDataSources, cardState, type CardState } from './sources';
import './widgets.css';
import { TONE_COLOR } from './tone';
import { fillRoute, safeHref, sourcesOf, partsOf, MAX_USE_DEPTH } from '@jkos/widgets';
import { usesAi } from './ai';
import { Field, SelectField, Check, AsyncView } from '@jkos/ui';
import { Scrubber } from '@jkos/player/ui';
import type { NavPoint } from '@jkos/player/core';
import { WidgetBoundary } from './boundary';

/** What the app drawing a widget hands the renderer. */
export interface WidgetHost {
  /** The host's slices, by the name a binding's `src` uses (ORDECK: clock, weather, today…).
   *  Each is in every widget's scope beside its own sources. Keep each slice's reference
   *  stable between real changes: a card re-renders when a slice it binds changes
   *  REFERENCE, so a host that rebuilds a slice every tick re-renders every card on it. */
  slices: Readonly<Record<string, unknown>>;
  /** Where the frame's signed-out state sends someone to sign in. */
  authUrl: string;
  /** The suite-wide LazurOS kill switch (profile → AI). Off, a widget that binds an AI app
   *  does not render — or read, or run anything. */
  aiEnabled: boolean;
  /** This instant, epoch ms: `$now`, what `fmt: 'ago'` measures against. A host that ticks
   *  a clock passes it here, and a widget that draws an `ago` re-renders with it. */
  now: number;
  /** The kinds only this host can draw — the manifest's molecules, each reading one of its
   *  slices. A widget using a kind its host lacks draws a not-here tile. */
  kinds?: HostKinds;
  /** The actions this host's engines take (a `do` action names one): the host DECLARES
   *  each (HostActionDecl — the second tier checks a widget against the declaration) and
   *  implements it here, typed by HostActions so none is declared without an
   *  implementation or implemented without a declaration. What one returns is `$result`
   *  to the actions after it. */
  actions?: Readonly<Record<string, HostActionFn>>;
  /** Go to a path in this host (its router). A host that routes passes it; without it a
   *  `go` fails its chain ("navigation is not available here"). */
  navigate?: (path: string) => void;
  /** The params of the route the page being drawn matched (pageFor) — `$route`. */
  route?: Readonly<Record<string, string>>;
  /** Every widget a `use` may draw, by id (the host's catalog — parts included). Without
   *  it a `use` draws a not-here tile. */
  widgets?: Readonly<Record<string, WidgetDef>>;
  /** The viewport tier it is drawn at: on `mobile`, a widget with a phone body
   *  (spec.mobile) draws that instead of its body. Omitted = desktop. */
  tier?: 'desktop' | 'tablet' | 'mobile';
}

/** One field of a host action's declaration — the field vocabulary a dataset uses. */
export interface DeclField { name: string; type: FieldType; required?: boolean; label?: string; /** an enum's values */ enum?: readonly string[] }
/** A host action, as its host declares it: what it does, its arguments, what it returns. */
export interface HostActionDecl { label: string; args?: readonly DeclField[]; returns?: readonly DeclField[] }
/** A host action's implementation: its arguments, resolved from the widget's bindings. */
export type HostActionFn = (args: Record<string, unknown>) => unknown | Promise<unknown>;
/** A host's implementations of its declared actions — every one of them, and nothing else. */
export type HostActions<D extends Readonly<Record<string, HostActionDecl>>> = { readonly [K in keyof D]: HostActionFn };

/** The host a widget is drawn in, for what runs inside it (an event's `do`, a `use`). */
const HostCtx = createContext<WidgetHost | null>(null);
/** How many `use`s deep this node is drawn — the guard against a cycle at run time. */
const UseDepthCtx = createContext(0);

/** A part, drawn where a `use` sits: the widget its id names, handed its inputs (`with`,
 *  resolved here) as `$in`, with its own sources, state and frame. The kill switch holds
 *  for a part as for a card. */
function UseNode({ node, scope }: { node: NodeOf<'use'>; scope: Scope }) {
  const host = useContext(HostCtx);
  const depth = useContext(UseDepthCtx);
  const part = host?.widgets?.[node.widget];
  if (!host || !part?.spec) return notHere(`use ${node.widget}`);
  if (depth >= MAX_USE_DEPTH) return notHere(`use ${node.widget} (nested too deep)`);
  if (!host.aiEnabled && usesAi(part, host.widgets)) return aiOffTile(part);
  const inputs = Object.fromEntries(Object.entries(node.with ?? {}).map(([k, b]) => [k, resolve(b, scope)]));
  return (
    <UseDepthCtx.Provider value={depth + 1}>
      <SpecWidget spec={part.spec} host={host} inputs={inputs} />
    </UseDepthCtx.Provider>
  );
}

/** A part's `$in`: each declared input's default, under what the `use` handed it. */
function inputScope(spec: WidgetSpec, given: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(spec.inputs ?? {})) out[k] = d.default ?? null;
  for (const [k, v] of Object.entries(given ?? {})) if (v !== undefined) out[k] = v;
  return out;
}

/** A host kind's renderer: the node, and the scope it is drawn in (the host's slices, the
 *  widget's sources). May be React.lazy — it draws under Suspense. */
export type HostKindComponent<K extends HostKind> = ComponentType<{ node: NodeOf<K>; scope: Scope }>;
export type HostKinds = { readonly [K in HostKind]?: HostKindComponent<K> };

/* ═══ Declarative spec layer ═══════════════════════════════════════════════ */

export type Scope = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** How far along, as a percent 0–100 — or null when it cannot be known (no value, or
 *  nothing to be out of): a bar that is not drawn, rather than one drawn empty. */
const fraction = (v: unknown, total: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v), t = Number(total);
  if (!Number.isFinite(n) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(100, (n / t) * 100));
};

/** Resolve a binding against the current scope (literal, {lit}, or {src,path}).
 *
 *  ⭐ DELEGATES TO @jkos/weave (D13). This function and the trigger engine's
 *  `resolveBindings` were the two halves of one system that never met — a
 *  WidgetSpec binds a dataset into a tree of primitives (READ), a TriggerDef binds a
 *  capability's typed output into another's body (WRITE) — each with its own
 *  vocabulary for "point at a value that will exist at run time". One model now, and
 *  this thin wrapper stays only because `resolve(b, scope)` is the argument order
 *  ~40 call sites in this file are written against. */
export function resolve(b: Binding, scope: Scope): unknown {
  return resolveBinding(b, scope);
}

/** Resolve a tone that may be fixed OR data-bound (→ a CSS colour). Unknown
 *  resolved values fall back to `fallback`, so a bad data path degrades quietly. */
function toneColor(t: ToneBinding | undefined, scope: Scope, fallback: Tone = 'muted'): string {
  if (t == null) return TONE_COLOR[fallback];
  const v = typeof t === 'object' ? resolve(t as Binding, scope) : t;
  return TONE_COLOR[v as Tone] ?? TONE_COLOR[fallback];
}

/** Truthiness for `when` lives in @jkos/weave's binding model now, beside the `not`
 *  condition that must agree with it. Re-exported for the Workshop canvas. */
export { truthy };

/** The ONLY inline style a widget renderer writes: custom properties carrying what a
 *  node's data decides (a gap, a tone's colour, a size). Every visual rule is a class in
 *  widgets.css, and check:widgets holds every `style=` in this file to this helper.
 *  ⚠️ Custom properties inherit — an element that reads one sets ALL of its own, defaults
 *  included, or a nested stack would take its parent's gap. */
export function vars(v: Record<`--${string}`, string | number>): CSSProperties {
  return v as unknown as CSSProperties;
}

/** A tone for a PATTERN: the status palette (TONE_COLOR's `accent` is the suite accent
 *  chain, --color-accent, which a theme moves). */
function patternTone(t: ToneBinding | undefined, scope: Scope, fallback: Tone): string {
  const v = t == null ? fallback : typeof t === 'object' ? resolve(t as Binding, scope) : t;
  const tone = (typeof v === 'string' && v in TONE_COLOR ? v : fallback) as Tone;
  return TONE_COLOR[tone];
}

/** An optional binding's text: '' when the prop is absent or resolves to nothing. */
function opt(b: Binding | undefined, scope: Scope): string {
  return b == null ? '' : str(resolve(b, scope));
}

/** A sparkline's points over a 100-wide box, with a 4px inset so round caps never clip. */
function sparkPoints(arr: unknown[], path: string | undefined, h: number): string | null {
  const values = arr.map((el) => num(path && el != null && typeof el === 'object' ? (el as Record<string, unknown>)[path] : el));
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${(i / (values.length - 1)) * 100},${4 + (1 - (v - min) / span) * (h - 8)}`).join(' ');
}

/** Curated line-icon set (inherits stroke colour + size). `dot` is the fallback. Keyed
 *  by the manifest's ICON_NAMES (IconName), so a name the validator accepts always draws. */
const ICONS: Record<IconName, ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7" /></>,
  moon: <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />,
  cloud: <path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 006 19z" />,
  rain: <><path d="M17.5 15a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 005.5 15" /><path d="M8 19v2M12 19v3M16 19v2" /></>,
  snow: <><path d="M17.5 14a4.5 4.5 0 000-9 6 6 0 00-11.6 1.5A4 4 0 005.5 14" /><path d="M8 17.5h.01M12 19h.01M16 17.5h.01M10 21h.01M14 21.5h.01" /></>,
  bolt: <path d="M13 2L4.5 13H11l-1 9 8.5-11H12l1-9z" />,
  check: <path d="M20 6L9 17l-5-5" />,
  book: <><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  star: <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z" />,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 001.7 3h16.9a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  dot: <circle cx="12" cy="12" r="6" />,
  rise: <path d="M4 17C12 17 16 7 20 7" />,
  fall: <path d="M4 7c4 0 8 4 16 10" />,
  peak: <path d="M4 18c4 0 5-11 8-11s4 11 8 11" />,
  // The transport's glyphs are FILLED (a play triangle is a shape, not a line): each
  // says so itself, so the stroked icons above keep their fill: none.
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none" />,
  prev: <path d="M7 6v12M19 6l-9 6 9 6z" fill="currentColor" />,
  next: <path d="M17 6v12M5 6l9 6-9 6z" fill="currentColor" />,
  back: <path d="M12 6V3L7 7l5 4V8a5 5 0 1 1-5 5" />,
  forward: <path d="M12 6V3l5 4-5 4V8a5 5 0 1 0 5 5" />,
  shuffle: <><path d="M3 6h3.5l8 12H18M3 18h3.5l2.4-3.6M14.1 9.6 16.5 6H18" /><path d="M15.5 4.5 18.5 6l-3 1.7zM15.5 19.5l3-1.5-3-1.7z" fill="currentColor" stroke="none" /></>,
  repeat: <><path d="M6 9V7a2 2 0 0 1 2-2h9M18 5v3M18 15v2a2 2 0 0 1-2 2H7M6 19v-3" /><path d="M15.5 3.5 18.5 6l-3 2.5zM8.5 20.5 5.5 18l3-2.5z" fill="currentColor" stroke="none" /></>,
  'repeat-one': <><path d="M6 9V7a2 2 0 0 1 2-2h9M18 5v3M18 15v2a2 2 0 0 1-2 2H7M6 19v-3" /><path d="M15.5 3.5 18.5 6l-3 2.5zM8.5 20.5 5.5 18l3-2.5z" fill="currentColor" stroke="none" /><path d="M11 10.5l1.5-1v5" /></>,
  spinner: <><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M12 3a9 9 0 0 1 9 9" className="hud-w-spin" /></>,
  radio: <><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6" /><path d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 18.5a9.2 9.2 0 0 0 0-13" opacity="0.5" /></>,
  devices: <><rect x="2.5" y="5" width="11" height="8.5" rx="1.2" /><path d="M5.5 17h5M8 13.5V17" /><rect x="15.5" y="4" width="6" height="15.5" rx="1.4" /><circle cx="18.5" cy="14.8" r="2" /></>,
  down: <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  queue: <><path d="M4 6h12M4 12h12M4 18h8" /><path d="M18 9v10M18 9l-3 3M18 9l3 3" /></>,
  more: <><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></>,
};

/** A control's glyph: stroked in its button's colour (currentColor). */
function glyph(name: string): ReactNode {
  return (
    <svg className="hud-w-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name as IconName] ?? ICONS.dot}
    </svg>
  );
}

/** A pattern's progress: the suite's one bar (hub.css .jk-bar-track / .jk-bar-fill, the
 *  bar @jkos/ui <Bar> draws), tinted, at the pattern track's height. */
function track(pct: number, tint: string): ReactNode {
  return <span className="jk-bar-track hud-p-track" style={vars({ '--jk-tint': tint, '--w-fill': `${pct}%` })}><span className="jk-bar-fill" /></span>;
}

/** A pattern's leading glyph, stroked in its tone (an unknown name draws the dot). */
function patternIcon(name: string, tone: string): ReactNode {
  return (
    <svg className="hud-p-icon" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={vars({ '--w-tone': tone })}>
      {ICONS[name as IconName] ?? ICONS.dot}
    </svg>
  );
}

/** The most steps a ladder draws — beyond it, a step is under a pixel wide anyway. */
const MAX_STEPS = 400;

/** Up to four URLs from an array — each element a URL, or (with `path`) an object holding
 *  one — each through safeHref: a tile's mosaic. */
function pluck(arr: unknown, path: string | undefined): string[] {
  if (!Array.isArray(arr)) return [];
  const urls = arr.map((el) => safeHref(path && el != null && typeof el === 'object' ? (el as Record<string, unknown>)[path] : el));
  return urls.filter((u): u is string => !!u).slice(0, 4);
}

/** A tile's cover: its image, a 2×2 mosaic of several, or — none, or one that fails to
 *  load — the title's first letter on the blank sleeve. A mosaic keeps its four cells
 *  when a cover is missing (a set reads as a set), each blank cell its sleeve. */
function TileArt({ one, many, letter }: { one?: string; many: string[]; letter: string }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const fail = (u: string) => setFailed((f) => new Set(f).add(u));
  const img = (u: string) => <img src={u} alt="" loading="lazy" decoding="async" onError={() => fail(u)} />;
  if (many.length > 1) {
    const cells = [0, 1, 2, 3].map((i) => many[i]);
    return (
      <span className="hud-p-tile-art is-mosaic">
        {cells.map((u, i) => <span key={i} className="hud-p-tile-cell">{u && !failed.has(u) ? img(u) : null}</span>)}
      </span>
    );
  }
  const u = one ?? many[0];
  return (
    <span className="hud-p-tile-art">
      {u && !failed.has(u) ? img(u) : <span className="hud-p-tile-letter" aria-hidden="true">{letter}</span>}
    </span>
  );
}

/** The art of one thing: the image, or — none, or one that fails to load — the title's
 *  letter on the blank sleeve. `fill` makes it the largest it can be in the room it is
 *  given (a size container — widgets.css § Cover); `ambient` also paints a blurred copy
 *  behind the whole screen. */
function CoverNode({ node, scope }: { node: NodeOf<'cover'>; scope: Scope }) {
  const title = str(resolve(node.title, scope));
  const url = node.image != null ? safeHref(resolve(node.image, scope)) : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  const show = url && failed !== url;
  const art = (
    <span className={`hud-w-cover${node.shape && node.shape !== 'square' ? ` is-${node.shape}` : ''}`}>
      {show ? <img src={url} alt={title} decoding="async" onError={() => setFailed(url)} />
        : <span className="hud-p-tile-letter" role="img" aria-label={title}>{(title.trim().charAt(0) || '?').toUpperCase()}</span>}
    </span>
  );
  return (
    <>
      {node.ambient && url && <span className="hud-w-ambient" aria-hidden="true" style={vars({ '--w-art': `url("${url.replace(/"/g, '%22')}")` })} />}
      {node.fill ? <span className="hud-w-cover-room">{art}</span> : art}
    </>
  );
}

/** A seek bar: @jkos/player's Scrubber (the suite's one), its release firing `on.seek`
 *  with the second chosen as `$seek.to`. */
function ScrubberNode({ node, scope }: { node: NodeOf<'scrubber'>; scope: Scope }) {
  const act = useActions();
  const pts = node.points != null ? resolve(node.points, scope) : null;
  const points = Array.isArray(pts) ? (pts as NavPoint[]) : undefined;
  const chain = node.on?.seek;
  return (
    <div className="hud-w-scrubber">
      <Scrubber
        position={num(resolve(node.position, scope))}
        total={Math.max(0, num(resolve(node.total, scope)))}
        points={points}
        currentIndex={node.at != null ? Math.round(num(resolve(node.at, scope))) : -1}
        mode={node.mode ?? 'timeline'}
        disabled={!chain}
        ariaLabel={node.label != null ? str(resolve(node.label, scope)) : undefined}
        onSeek={(to) => { if (chain) void act.fire(chain, { ...scope, $seek: { to } }); }}
      />
    </div>
  );
}

/** node type → renderer. Each case is one primitive; adding to the vocabulary is a new
 *  manifest kind + a new entry here. The host's kinds (HostKind) are not here: the host
 *  draws them, and tsc holds each side to its half of the manifest. */
export type NodeOf<K extends WidgetNode['t']> = Extract<WidgetNode, { t: K }>;
type Primitives = { [K in Exclude<WidgetNode['t'], HostKind>]: (node: NodeOf<K>, scope: Scope) => ReactNode };

/** The `rows` pattern's body. `onSelect`: each row is an action (the node's `on.select`),
 *  drawn as a button that hands back that row's scope; otherwise a row with `href` is a
 *  link. (The validator refuses both on one node — one tap, one meaning.) */
function rowsBody(n: NodeOf<'rows'>, scope: Scope, onSelect?: (rowScope: Scope) => void, busy = false): ReactNode {
  const arr = resolve(n.from, scope);
  const items = Array.isArray(arr) ? arr : [];
  if (!items.length) return n.empty != null ? <div className="hud-p hud-p-empty">{str(resolve(n.empty, scope))}</div> : null;
  const shown = n.max && n.max > 0 ? items.slice(0, n.max) : items;
  return (
    <div className="hud-p hud-p-rows">
      {shown.map((el, i) => {
        const s = { ...scope, $: el };
        const href = n.href != null ? safeHref(resolve(n.href, s)) : undefined;
        // An optional line whose value is empty draws nothing, not an empty line — so
        // `sub: $.error` shows only on the rows that have one.
        const lead = opt(n.lead, s), sub = opt(n.sub, s), detail = opt(n.detail, s);
        const pct = n.progress != null ? fraction(resolve(n.progress, s), n.total != null ? resolve(n.total, s) : 1) : null;
        const inner = (
          <>
            {n.icon != null ? patternIcon(str(resolve(n.icon, s)), patternTone(n.mark, s, 'muted'))
              : n.mark != null ? <span className="hud-p-mark" style={vars({ '--w-tone': patternTone(n.mark, s, 'muted') })} /> : null}
            {n.lead != null && <span className="hud-p-lead">{lead}</span>}
            <span className="hud-p-main">
              <span className="hud-p-title">{str(resolve(n.title, s))}</span>
              {sub && <span className="hud-p-sub">{sub}</span>}
              {pct != null && track(pct, 'var(--color-accent)')}
            </span>
            {detail && <span className="hud-p-detail">{detail}</span>}
          </>
        );
        if (onSelect) return <button key={i} type="button" className="hud-p-row is-action" disabled={busy} onClick={() => onSelect(s)}>{inner}</button>;
        return href ? <a key={i} className="hud-p-row" href={href}>{inner}</a> : <div key={i} className="hud-p-row">{inner}</div>;
      })}
      {items.length > shown.length && <div className="hud-p-more">+{items.length - shown.length} MORE</div>}
    </div>
  );
}

const PRIMITIVES: Primitives = {
  stack: (n, scope) => (
    <div className={`hud-w-stack${n.grow ? ' is-grow' : ''}${n.screen ? ' is-screen' : ''}`} style={vars({ '--w-gap': `${n.gap ?? 8}px`, '--w-justify': n.justify ?? 'flex-start' })}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  row: (n, scope) => (
    <div className={`hud-w-row${n.grow ? ' is-grow' : ''}`} style={vars({ '--w-gap': `${n.gap ?? 8}px`, '--w-justify': n.justify ?? 'flex-start', '--w-align': n.align ?? 'center' })}>
      {n.children.map((c, i) => <Fragment key={i}>{renderNode(c, scope)}</Fragment>)}
    </div>
  ),
  label: (n, scope) => <span className={`hud-eyebrow${n.size === 'sm' || n.size === 'xs' ? ` is-${n.size}` : ''}`}>{str(resolve(n.text, scope))}</span>,
  text: (n, scope) => (
    <span className={`hud-w-text${n.variant && n.variant !== 'body' ? ` is-${n.variant}` : ''}${n.grow ? ' is-grow' : ''}`}>{str(resolve(n.text, scope))}</span>
  ),
  metric: (n, scope) => {
    const size = n.size ?? 30;
    return (
      <div className="hud-w-metric" style={vars({ '--w-size': `${size}px`, '--w-unit': `${Math.max(10, Math.round(size * 0.4))}px` })}>
        <b>{str(resolve(n.value, scope))}</b>
        {n.unit != null && <span className="hud-w-metric-unit">{str(resolve(n.unit, scope))}</span>}
        {n.sub != null && <span className="hud-w-metric-sub">{str(resolve(n.sub, scope))}</span>}
      </div>
    );
  },
  bar: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 100;
    const pct = m > 0 ? Math.max(0, Math.min(100, (v / m) * 100)) : 0;
    return <span className="jk-bar-track hud-w-bar" style={vars({ '--w-fill': `${pct}%` })}><span className="jk-bar-fill" /></span>;
  },
  pill: (n, scope) => (
    <span className="jk-pill" style={vars({ '--jk-tint': toneColor(n.tone, scope, 'ok') })}>{str(resolve(n.text, scope))}</span>
  ),
  dot: (n, scope) => (
    <span className={`hud-dot hud-w-dot${n.pulse ? ' pulse' : ''}`} style={vars({ '--w-tone': toneColor(n.tone, scope, 'muted') })} />
  ),
  keyval: (n, scope) => (
    <div className="hud-w-keyval">
      <span className="hud-w-keyval-label" style={vars({ '--w-tone': n.tone ? toneColor(n.tone, scope) : 'var(--color-muted)' })}>
        {str(resolve(n.label, scope))}
      </span>
      <span className="hud-w-keyval-value">{str(resolve(n.value, scope))}</span>
    </div>
  ),
  gauge: (n, scope) => {
    const v = num(resolve(n.value, scope));
    const m = n.max != null ? num(resolve(n.max, scope)) : 100;
    const pct = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
    const size = n.size ?? 76;
    const R = 26, C = 2 * Math.PI * R;
    return (
      <div className="hud-w-gauge">
        <svg width={size} height={size} viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--color-line)" strokeWidth="6" />
          <circle cx="36" cy="36" r={R} fill="none" stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 36 36)" className="hud-w-gauge-arc" />
          <text x="36" y="41" textAnchor="middle" className="hud-w-gauge-num">{Math.round(pct * 100)}</text>
        </svg>
        {n.label != null && <span className="hud-w-caption">{str(resolve(n.label, scope))}</span>}
      </div>
    );
  },
  divider: (n, scope) => {
    const label = n.label != null ? str(resolve(n.label, scope)) : '';
    if (!label) return <div className="hud-w-rule" />;
    return (
      <div className="hud-w-divider">
        <span className="hud-w-divider-line" />
        <span className="hud-w-caption">{label}</span>
        <span className="hud-w-divider-line" />
      </div>
    );
  },
  link: (n, scope) => (
    <a href={safeHref(resolve(n.href, scope))} className="hud-w-link">{str(resolve(n.text, scope))} →</a>
  ),
  icon: (n, scope) => {
    const name = str(resolve(n.name, scope));
    const s = n.size ?? 24;
    const color = n.tone != null ? toneColor(n.tone, scope, 'accent') : 'var(--color-accent)';
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hud-w-icon">
        {ICONS[name as IconName] ?? ICONS.dot}
      </svg>
    );
  },
  time: (n, scope) => (
    <div className="hud-clock">
      <div className="hud-clock-time">
        <span className="hud-clock-hm jk-press-lg">{str(resolve(n.value, scope))}</span>
        {n.seconds != null && <span className="hud-clock-ss">{str(resolve(n.seconds, scope))}</span>}
      </div>
      {(n.sub != null || n.sub2 != null) && (
        <div className="hud-clock-meta">
          {n.sub != null && <span className="hud-clock-date">{str(resolve(n.sub, scope))}</span>}
          {n.sub2 != null && <span className="hud-clock-utc">{str(resolve(n.sub2, scope))}</span>}
        </div>
      )}
    </div>
  ),
  when: (n, scope) =>
    truthy(resolve(n.cond, scope)) ? renderNode(n.then, scope) : (n.else ? renderNode(n.else, scope) : null),
  list: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (items.length === 0 && n.empty != null) {
      return <div className="hud-w-list-empty">{str(resolve(n.empty, scope))}</div>;
    }
    const body = items.map((el, i) => <Fragment key={i}>{renderNode(n.item, { ...scope, $: el })}</Fragment>);
    if (n.dir === 'row') return <div className="hud-w-list-row">{body}</div>;
    if (n.cols && n.cols > 1) {
      return <div className="hud-w-list-grid" style={vars({ '--w-cols': Math.round(n.cols) })}>{body}</div>;
    }
    return <>{body}</>;
  },
  steps: (n, scope) => {
    // Compressed, never wrapped: a ladder that wraps stops reading as one axis.
    const count = Math.max(0, Math.min(MAX_STEPS, Math.round(num(resolve(n.count, scope)))));
    const at = n.at != null ? Math.round(num(resolve(n.at, scope))) : -1;
    return (
      <span className="hud-w-steps" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => <span key={i} className={`hud-w-step${i < at ? ' is-done' : i === at ? ' is-now' : ''}`} />)}
      </span>
    );
  },
  cover: (n, scope) => <CoverNode node={n} scope={scope} />,
  scrubber: (n, scope) => <ScrubberNode node={n} scope={scope} />,
  sparkline: (n, scope) => {
    const arr = resolve(n.from, scope);
    const values = (Array.isArray(arr) ? arr : [])
      .map((el) => num(n.path && el != null && typeof el === 'object' ? (el as Record<string, unknown>)[n.path] : el));
    if (values.length < 2) return null;
    const h = n.height ?? 28;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    // 4px vertical inset keeps the round linecaps from clipping at the extremes.
    const pts = values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${4 + (1 - (v - min) / span) * (h - 8)}`)
      .join(' ');
    const color = n.tone != null ? toneColor(n.tone, scope, 'accent') : 'var(--color-accent)';
    return (
      <svg width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="hud-w-spark">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          vectorEffect="non-scaling-stroke" />
      </svg>
    );
  },
  /* ── Patterns: one node, a finished card body (widgets.css § Patterns) ───── */
  stat: (n, scope) => {
    const trend = n.trend != null ? resolve(n.trend, scope) : null;
    const pts = Array.isArray(trend) ? sparkPoints(trend, n.trendPath, 24) : null;
    return (
      <div className="hud-p hud-p-stat">
        {(n.label != null || n.delta != null) && (
          <div className="hud-p-line">
            {n.label != null && <span className="hud-p-label">{str(resolve(n.label, scope))}</span>}
            {n.delta != null && (
              <span className="hud-p-delta" style={vars({ '--w-tone': patternTone(n.deltaTone, scope, 'muted') })}>{str(resolve(n.delta, scope))}</span>
            )}
          </div>
        )}
        <div className="hud-p-stat-value">
          <b>{str(resolve(n.value, scope))}</b>
          {n.unit != null && <span>{str(resolve(n.unit, scope))}</span>}
        </div>
        {opt(n.sub, scope) && <div className="hud-p-sub">{opt(n.sub, scope)}</div>}
        {pts && (
          <svg className="hud-p-trend" width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none">
            <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
    );
  },
  meter: (n, scope) => {
    const pct = fraction(resolve(n.value, scope), n.max != null ? resolve(n.max, scope) : 1) ?? 0;
    return (
      <div className="hud-p hud-p-meter">
        {(n.label != null || n.detail != null) && (
          <div className="hud-p-line">
            {n.label != null && <span className="hud-p-label">{str(resolve(n.label, scope))}</span>}
            {n.detail != null && <span className="hud-p-detail">{str(resolve(n.detail, scope))}</span>}
          </div>
        )}
        {track(pct, patternTone(n.tone, scope, 'accent'))}
      </div>
    );
  },
  rows: (n, scope) => (n.on?.select ? <ActionRows node={n} scope={scope} /> : rowsBody(n, scope)),
  feed: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (!items.length) return n.empty != null ? <div className="hud-p hud-p-empty">{str(resolve(n.empty, scope))}</div> : null;
    const shown = n.max && n.max > 0 ? items.slice(0, n.max) : items;
    return (
      <div className="hud-p hud-p-feed">
        {shown.map((el, i) => {
          const s = { ...scope, $: el };
          const tone = patternTone(n.tone, s, 'muted');
          // An instant is drawn as 'ago' unless the binding already says how to draw it.
          const at = n.at == null ? null
            : typeof n.at === 'object' && 'fmt' in n.at ? str(resolve(n.at, s)) : str(format(resolve(n.at, s), 'ago', s));
          return (
            <div key={i} className="hud-p-event">
              {n.icon != null ? patternIcon(str(resolve(n.icon, s)), tone) : <span className="hud-p-mark" style={vars({ '--w-tone': tone })} />}
              <span className="hud-p-main">
                <span className="hud-p-title">{str(resolve(n.text, s))}</span>
                {opt(n.detail, s) && <span className="hud-p-sub">{opt(n.detail, s)}</span>}
              </span>
              {at && <span className="hud-p-when">{at}</span>}
            </div>
          );
        })}
        {items.length > shown.length && <div className="hud-p-more">+{items.length - shown.length} MORE</div>}
      </div>
    );
  },
  facts: (n, scope) => (
    // The grid is INSIDE the pattern: a container query styles descendants, never the
    // container itself, so the one-column narrow rule needs something to land on.
    <div className="hud-p hud-p-facts"><div className="hud-p-facts-grid" style={vars({ '--w-cols': Math.max(1, Math.round(n.cols ?? 2)) })}>
      {n.items.map((f, i) => (
        <div key={i} className="hud-p-fact">
          <span className="hud-p-label">{str(resolve(f.label, scope))}</span>
          <span className="hud-p-fact-value" style={vars({ '--w-tone': f.tone != null ? patternTone(f.tone, scope, 'muted') : 'var(--color-ink)' })}>
            {str(resolve(f.value, scope))}
          </span>
        </div>
      ))}
    </div></div>
  ),
  media: (n, scope) => {
    const img = n.image != null ? safeHref(resolve(n.image, scope)) : undefined;
    const href = n.href != null ? safeHref(resolve(n.href, scope)) : undefined;
    const pct = n.progress != null ? fraction(resolve(n.progress, scope), n.max != null ? resolve(n.max, scope) : 1) : null;
    const body = (
      <>
        <div className="hud-p-media-top">
          {img ? <img className="hud-p-art" src={img} alt="" /> : <span className="hud-p-art is-blank"><svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5">{ICONS.book}</svg></span>}
          <span className="hud-p-main">
            <span className="hud-p-media-title">{str(resolve(n.title, scope))}</span>
            {n.subtitle != null && <span className="hud-p-sub">{str(resolve(n.subtitle, scope))}</span>}
            {n.meta != null && <span className="hud-p-detail">{str(resolve(n.meta, scope))}</span>}
          </span>
        </div>
        {pct != null && track(pct, 'var(--color-accent)')}
      </>
    );
    if (n.on?.press) return <ActionTarget chain={n.on.press} scope={scope} className="hud-p hud-p-media is-action">{body}</ActionTarget>;
    return href ? <a className="hud-p hud-p-media" href={href}>{body}</a> : <div className="hud-p hud-p-media">{body}</div>;
  },
  rail: (n, scope) => {
    const arr = resolve(n.from, scope);
    const items = Array.isArray(arr) ? arr : [];
    if (!items.length) return n.empty != null ? <div className="hud-w-list-empty">{str(resolve(n.empty, scope))}</div> : null;
    // The box is the container the strip's column width answers to (widgets.css § Rail).
    return (
      <div className={`hud-w-rail-box${n.size === 'wide' ? ' is-wide' : ''}`}>
        <div className="hud-w-rail jk-scroll-none">
          {items.map((el, i) => <div key={i} className="hud-w-rail-item">{renderNode(n.item, { ...scope, $: el })}</div>)}
        </div>
      </div>
    );
  },
  tile: (n, scope) => {
    const title = str(resolve(n.title, scope));
    const one = n.image != null ? safeHref(resolve(n.image, scope)) : undefined;
    const many = n.images != null ? pluck(resolve(n.images, scope), n.imagesPath) : [];
    const pct = n.progress != null ? fraction(resolve(n.progress, scope), n.total != null ? resolve(n.total, scope) : 1) : null;
    const sub = opt(n.sub, scope), meta = opt(n.meta, scope);
    const href = n.href != null ? safeHref(resolve(n.href, scope)) : undefined;
    const cls = `hud-p hud-p-tile${n.shape === 'round' ? ' is-round' : ''}${n.active != null && truthy(resolve(n.active, scope)) ? ' is-active' : ''}`;
    const body = (
      <>
        <TileArt one={one} many={many} letter={(title.trim().charAt(0) || '?').toUpperCase()} />
        {pct != null && track(pct, 'var(--color-accent)')}
        <span className="hud-p-tile-title">
          {n.icon != null && patternIcon(str(resolve(n.icon, scope)), 'currentColor')}
          <span className="hud-p-tile-text">{title}</span>
        </span>
        {sub && <span className="hud-p-tile-sub">{sub}</span>}
        {meta && <span className="hud-p-tile-meta">{meta}</span>}
      </>
    );
    if (n.on?.press) return <ActionTarget chain={n.on.press} scope={scope} className={`${cls} is-action`}>{body}</ActionTarget>;
    return href ? <a className={cls} href={href}>{body}</a> : <div className={cls}>{body}</div>;
  },
  use: (n, scope) => <UseNode node={n} scope={scope} />,
  ask: (n, scope) => <AskNode node={n} scope={scope} />,
  // Write family — each delegates to a hook-bearing component (see below).
  form:   (n, scope) => <FormNode node={n} scope={scope} />,
  input:  (n, scope) => <InputNode node={n} scope={scope} />,
  select: (n, scope) => <SelectNode node={n} scope={scope} />,
  toggle: (n, scope) => <ToggleNode node={n} scope={scope} />,
  button: (n, scope) => <ButtonNode node={n} scope={scope} />,
};

/** The kinds of the host a widget is being drawn in — provided around every card by
 *  renderWidget, and by a host drawing loose nodes itself (a workshop canvas). */
const KindsCtx = createContext<HostKinds>({});
export const HostKindsProvider = KindsCtx.Provider;

/** A host kind, drawn by its host: under Suspense (a lazy kind loads on first use), or as
 *  a not-here tile when this host does not draw it. */
function HostNode({ node, scope }: { node: WidgetNode; scope: Scope }) {
  const Kind = useContext(KindsCtx)[node.t as HostKind] as ComponentType<{ node: WidgetNode; scope: Scope }> | undefined;
  if (!Kind) return notHere(node.t);
  return <Suspense fallback={stateView({ kind: 'loading' }, '', '')}><Kind node={node} scope={scope} /></Suspense>;
}

/** Exported for a workshop's canvas editor, which reuses the SAME primitive renderers
 *  for its editable leaves (so what you edit is what ships). */
export function renderNode(node: WidgetNode, scope: Scope): ReactNode {
  const fn = (PRIMITIVES as Record<string, (n: WidgetNode, s: Scope) => ReactNode>)[node.t];
  if (fn) return fn(node, scope);
  return <HostNode node={node} scope={scope} />;
}

/** The eyebrow + right-aligned source row at the top of a card. One definition
 *  for the spec frame and every bespoke card, instead of the same inline div
 *  copy-pasted per component. Renders nothing when both captions are empty. */
export function CardHead({ eyebrow, source, stale }: { eyebrow?: string; source?: string; stale?: string }) {
  if (!eyebrow && !source && !stale) return null;
  return (
    <div className="hud-w-head">
      {eyebrow && <span className="hud-eyebrow">{eyebrow}</span>}
      {(source || stale) && (
        <span className="hud-eyebrow-src">
          {source}{stale && <span className="hud-widget-stale">{source ? ' · ' : ''}{stale}</span>}
        </span>
      )}
    </div>
  );
}

/** What the frame draws instead of the body, for every state but ready. The copy is the
 *  suite's (AsyncView's italic off-state note); only the empty line is the author's. */
function stateView(state: CardState, emptyText: string, authUrl: string): ReactNode {
  const appName = (id: string) => suiteApp(id as Parameters<typeof suiteApp>[0])?.label ?? id;
  // A fault reads in the error ink; being signed out is not a fault, so it takes the
  // neutral note, with the way in beside it.
  const fault =
    state.kind === 'offline' ? `${appName(state.app)} is offline.`
    : state.kind === 'forbidden' ? 'Not available to your account.'
    : state.kind === 'unavailable' ? <span title={state.error}>Unavailable.</span>
    : null;
  const neutral = state.kind === 'signed-out'
    ? <>Sign in to see this.<a href={safeHref(authUrl)}>SIGN IN →</a></>
    : emptyText;
  return (
    <AsyncView className="hud-widget-state" loading={state.kind === 'loading'} error={fault != null}
      empty={state.kind === 'empty' || state.kind === 'signed-out'} errorText={fault} emptyText={neutral}>
      {null}
    </AsyncView>
  );
}

/* ── Command vocabulary (declarative writes) ────────────────────────────────
 * The read-only spec grows a write family. A `form` owns a `$form` source its
 * input/select/toggle children write into; its submit (and standalone `button`s)
 * run a CommandRef through ONE capability-driven dispatcher — discover the app's
 * CapabilityDef (weave fetchCapabilities), resolve the body bindings against the
 * live scope (+$form), issue via runCommand, and let the invalidation bus
 * reconcile the owning app's views. Pure data in, so the workshop composes it and
 * an AI can emit it; the dispatcher and loading/error states live here, once. */

interface FormCtxValue { values: Record<string, unknown>; set: (field: string, v: unknown) => void }
const FormCtx = createContext<FormCtxValue | null>(null);

/** A widget instance's own variables (spec.state → `$state`): what a `set` action and a
 *  control with `state` write. Each SpecWidget provides its own, so two placed copies of
 *  one widget — or two `use`s of a part — never share a value. */
const StateCtx = createContext<FormCtxValue | null>(null);

/** The initial `$state`: each declared variable's default (null when it has none). */
function initialState(spec: WidgetSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec.state ?? {}).map(([k, d]) => [k, d.default ?? null]));
}

// The field faces come from the @jkos/ui primitives; the widget form only makes them
// fill the card's width (.hud-w-field), and a command's button is .hud-w-action.
const actionCls = (on: boolean) => `hud-w-action${on ? '' : ' is-off'}`;

type CmdStatus = 'idle' | 'saving' | 'working' | 'ok' | 'err';

/** Issue one command: its body is the capability's defaults under the ref's bindings
 *  (resolved against `scope`; an empty optional stays unset). A synchronous capability
 *  answers an outcome; an async one (it declares `resolves`) answers the job to follow. */
async function issue(app: SuiteApp, cap: CapabilityDef, ref: CommandRef, scope: Scope): Promise<{ outcome: JobOutcome } | { jobId: string }> {
  const body: Record<string, unknown> = {};
  for (const fld of cap.body ?? []) if (fld.default !== undefined) body[fld.name] = fld.default;
  for (const [k, b] of Object.entries(ref.body ?? {})) {
    const v = resolve(b, scope);
    if (v !== undefined && v !== null && v !== '') body[k] = v;  // keep optionals unset
  }
  const res = await runCommand(app, cap, body);
  if (!res.ok) return { outcome: { phase: 'failed', error: res.error } };
  if (!Array.isArray(cap.resolves)) return { outcome: { phase: 'done', result: res.data } };
  const jobId = (res.data as { job_id?: unknown } | null)?.job_id;
  if (typeof jobId !== 'string' && typeof jobId !== 'number') {
    return { outcome: { phase: 'lost', error: `${ref.app}.${ref.capability} is async and answered no job_id` } };
  }
  return { jobId: String(jobId) };
}

/** Run a command to its END: discover its capability, issue it, and follow an async one
 *  until the job ends — what an event's `run` action waits on before the next action. */
async function runToEnd(ref: CommandRef, scope: Scope, signal: AbortSignal): Promise<JobOutcome> {
  const app = suiteApp(ref.app);
  const doc = await fetchCapabilities(ref.app);
  const cap = doc ? getCapability(doc, ref.capability) : null;
  if (!app?.apiBase || !cap) return { phase: 'failed', error: `${ref.app}.${ref.capability} is not available` };
  const res = await issue(app, cap, ref, scope);
  if ('outcome' in res) return res.outcome;
  return followJob(ref.app, res.jobId, { signal });
}

/**
 * Run an event's actions, in order, against the scope the event fired in. A `set` writes
 * the widget's state; a `run` issues a capability and waits for its end — a failure stops
 * the rest, and the actions after it read what it produced as `$result`.
 *
 * `status` is the chain's, for the control that fired it: idle → working → ok | err.
 */
function useActions() {
  const state = useContext(StateCtx);
  const host = useContext(HostCtx);
  const [status, setStatus] = useState<CmdStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const live = useRef<AbortController | null>(null);
  useEffect(() => () => live.current?.abort(), []);

  const fire = useCallback(async (chain: ActionChain, scope: Scope): Promise<boolean> => {
    live.current?.abort();
    const ac = new AbortController();
    live.current = ac;
    setStatus('working'); setError(undefined);
    let here = scope;
    for (const a of ([] as WidgetAction[]).concat(chain)) {
      if ('set' in a) {
        state?.set(a.set, resolve(a.to, here));
      } else if ('do' in a) {
        const fn = host?.actions?.[a.do];
        if (!fn) { setStatus('err'); setError(`${a.do} is not available here`); return false; }
        const args = Object.fromEntries(Object.entries(a.with ?? {}).map(([k, b]) => [k, resolve(b, here)]));
        try {
          const out = await fn(args);
          here = { ...here, $result: out };
        } catch (e) {
          if (!ac.signal.aborted) { setStatus('err'); setError(e instanceof Error ? e.message : String(e)); }
          return false;
        }
        if (ac.signal.aborted) return false;
      } else if ('go' in a) {
        const path = fillRoute(a.go, Object.fromEntries(Object.entries(a.params ?? {}).map(([k, b]) => [k, resolve(b, here)])));
        if (!host?.navigate || path == null) {
          setStatus('err'); setError(!host?.navigate ? 'navigation is not available here' : `${a.go}: a param has no value`);
          return false;
        }
        host.navigate(path);
      } else if ('run' in a) {
        const o = await runToEnd(a.run, here, ac.signal);
        if (ac.signal.aborted) return false;
        if (o.phase !== 'done') { setStatus('err'); setError(o.error); return false; }
        here = { ...here, $result: o.result, $job: o };
      }
    }
    if (ac.signal.aborted) return false;
    setStatus('ok');
    setTimeout(() => setStatus((st) => (st === 'ok' ? 'idle' : st)), 1600);
    return true;
  }, [state, host]);

  return { status, error, busy: status === 'working', fire };
}

/** For a HOST KIND that fires its node's events (`on`): run an event's actions in the
 *  scope it fired in — the same engine every renderer event uses, so a `set`, a `do` or a
 *  `go` from a molecule is checked and runs exactly as one from a button. */
export function useWidgetActions(): { fire: (chain: ActionChain, scope: Scope) => Promise<boolean>; busy: boolean; error?: string } {
  const { fire, busy, error } = useActions();
  return { fire, busy, error };
}

/** Something tapped to fire its actions (a media card's `on.press`), drawn as a button. */
function ActionTarget({ chain, scope, className, children }: { chain: ActionChain; scope: Scope; className: string; children: ReactNode }) {
  const act = useActions();
  return (
    <button type="button" className={className} disabled={act.busy} onClick={() => { void act.fire(chain, scope); }}>
      {children}
      {act.status === 'err' && <span className="hud-p-note is-error">{act.error ?? 'COULDN’T — RETRY'}</span>}
    </button>
  );
}

/** A rows pattern whose rows are actions (`on.select`): a tap fires them with that row as `$`. */
function ActionRows({ node, scope }: { node: NodeOf<'rows'>; scope: Scope }) {
  const act = useActions();
  const chain = node.on?.select;
  return (
    <>
      {rowsBody(node, scope, chain ? (row) => { void act.fire(chain, row); } : undefined, act.busy)}
      {act.status === 'err' && <span className="hud-p-note is-error">{act.error ?? 'COULDN’T — RETRY'}</span>}
    </>
  );
}

/** Resolve a CommandRef to its app + capability, and expose a run() that builds
 *  the body (capability defaults under the ref's bindings) and dispatches it.
 *  `available` is false until the capability is discovered (or if it's gone) —
 *  callers render disabled, the soft-fail equivalent of an offline data source.
 *
 *  `outcome` is what the command produced — `$result` / `$job` in a `result` slot. A
 *  synchronous capability's is its answer. An ASYNC one's (it declares `resolves`)
 *  answer is only a job handle, so the job is FOLLOWED (weave followJob, through the
 *  app's common-shape jobs dataset) until it ends, and the outcome is what it
 *  resolved to — the answer itself, never an id to go looking for. */
function useCommand(ref: CommandRef) {
  const [doc, setDoc] = useState<CapabilityDoc | null | undefined>(undefined); // undefined = loading
  useEffect(() => {
    let dead = false;
    fetchCapabilities(ref.app).then((d) => { if (!dead) setDoc(d); });
    return () => { dead = true; };
  }, [ref.app]);

  const app = suiteApp(ref.app);
  const cap = doc ? getCapability(doc, ref.capability) : null;
  const available = !!(app?.apiBase && cap);
  const [status, setStatus] = useState<CmdStatus>('idle');
  const [outcome, setOutcome] = useState<JobOutcome | null>(null);
  const following = useRef<AbortController | null>(null);
  useEffect(() => () => following.current?.abort(), []);

  const settle = useCallback((o: JobOutcome) => {
    setOutcome(o);
    setStatus(o.phase === 'done' ? 'ok' : 'err');
    if (o.phase === 'done') setTimeout(() => setStatus((s) => (s === 'ok' ? 'idle' : s)), 1600);
  }, []);

  const run = useCallback(async (scope: Scope): Promise<boolean> => {
    if (!app || !cap) return false;
    following.current?.abort();
    setStatus('saving');
    setOutcome({ phase: 'pending' });
    const res = await issue(app, cap, ref, scope);
    if ('outcome' in res) { settle(res.outcome); return res.outcome.phase === 'done'; }
    setStatus('working');
    const ac = new AbortController();
    following.current = ac;
    void followJob(ref.app, res.jobId, { signal: ac.signal, onUpdate: (o) => { if (!ac.signal.aborted) setOutcome(o); } })
      .then((o) => { if (!ac.signal.aborted) settle(o); });
    return true;   // accepted: the inputs clear while the job runs
  }, [app, cap, ref, settle]);

  return { loading: doc === undefined, available, status, outcome, async: Array.isArray(cap?.resolves), run };
}

/** A command's `result` slot, drawn with what it produced: `$result` (the answer, or
 *  what an async job resolved to) and `$job` ({ phase, status, error }). */
function resultSlot(node: WidgetNode | undefined, outcome: JobOutcome | null, scope: Scope): ReactNode {
  if (!node || !outcome) return null;
  return renderNode(node, { ...scope, $result: outcome.result, $job: outcome });
}

/** The line under a command: what it is doing, or how it ended. */
function commandNote(cmd: ReturnType<typeof useCommand>): { text: string; color: string } {
  if (!cmd.available && !cmd.loading) return { text: 'UNAVAILABLE', color: 'var(--color-ghost)' };
  if (cmd.status === 'working') return { text: 'WORKING…', color: 'var(--color-ghost)' };
  if (cmd.status === 'ok') return { text: 'DONE', color: 'var(--color-ok)' };
  if (cmd.status === 'err') {
    // The job ran and failed; the job was not followed to an end; the call itself failed.
    const text = cmd.async && cmd.outcome?.phase === 'failed' && cmd.outcome.status ? 'FAILED'
      : cmd.outcome?.phase === 'lost' ? 'NO ANSWER YET'
      : 'COULDN’T SAVE — RETRY';
    return { text, color: 'var(--color-danger)' };
  }
  return { text: '', color: 'var(--color-ghost)' };
}

function FormNode({ node, scope }: { node: Extract<WidgetNode, { t: 'form' }>; scope: Scope }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const set = useCallback((field: string, v: unknown) => setValues((s) => ({ ...s, [field]: v })), []);
  const cmd = useCommand(node.cmd);
  const done = useActions();
  const formScope: Scope = { ...scope, $form: values };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (cmd.status === 'saving' || cmd.status === 'working' || !cmd.available) return;
    if (await cmd.run(formScope)) setValues({});
  };
  // `on.done` fires once the command has SUCCEEDED (an async one: its job has ended), with
  // what it produced as $result — so an event can go to the thing it just made.
  const fired = useRef<JobOutcome | null>(null);
  const onDone = node.on?.done;
  const { fire } = done;
  useEffect(() => {
    const o = cmd.outcome;
    if (!onDone || o?.phase !== 'done' || fired.current === o) return;
    fired.current = o;
    void fire(onDone, { ...scope, $result: o.result, $job: o });
  }, [cmd.outcome, onDone, scope, fire]);

  const label = str(resolve(node.submit, scope));
  const note = commandNote(cmd);

  return (
    <FormCtx.Provider value={{ values, set }}>
      {/* A layout container, not a card — the spec frame provides the chrome
          (like every primitive except the calendar/weather molecules). */}
      <form onSubmit={submit} className="hud-w-form">
        {(() => {
          const button = (
            <button type="submit" disabled={!cmd.available || cmd.status === 'saving' || cmd.status === 'working'}
              className={actionCls(cmd.available)} style={vars({ '--w-tone': 'var(--color-accent)' })}>
              {cmd.status === 'saving' ? '…' : label}
            </button>
          );
          // One input is a quick-add: the button sits beside it, not under it.
          if (node.children.length === 1 && node.children[0].t === 'input') {
            return <div className="hud-w-form-bar">{renderNode(node.children[0], formScope)}{button}</div>;
          }
          return <>{node.children.map((c, i) => <Fragment key={i}>{renderNode(c, formScope)}</Fragment>)}{button}</>;
        })()}
        {note.text && <span className="hud-w-note" style={vars({ '--w-tone': note.color })}>{note.text}</span>}
        {resultSlot(node.result, cmd.outcome, scope)}
      </form>
    </FormCtx.Provider>
  );
}

/** Where a control reads and writes: the form's `$form.<field>`, or — a control with
 *  `state`, outside any form — the widget's `$state.<name>`. */
function useControl(node: { field?: string; state?: string }): { value: unknown; set: (v: unknown) => void } {
  const form = useContext(FormCtx);
  const state = useContext(StateCtx);
  const ctx = node.state != null ? state : form;
  const key = node.state ?? node.field ?? '';
  return { value: ctx?.values[key], set: (v) => ctx?.set(key, v) };
}

function InputNode({ node, scope }: { node: Extract<WidgetNode, { t: 'input' }>; scope: Scope }) {
  const c = useControl(node);
  const ph = node.placeholder != null ? str(resolve(node.placeholder, scope)) : '';
  return (
    <Field value={str(c.value ?? '')} placeholder={ph} type={node.itype ?? 'text'}
      onChange={(e) => c.set(e.target.value)} className="hud-w-field" />
  );
}

function SelectNode({ node, scope }: { node: Extract<WidgetNode, { t: 'select' }>; scope: Scope }) {
  const c = useControl(node);
  const raw = resolve(node.options, scope);
  const opts = (Array.isArray(raw) ? raw : []).map((o) =>
    o && typeof o === 'object'
      ? { value: str((o as { value?: unknown }).value), label: str((o as { label?: unknown }).label ?? (o as { value?: unknown }).value) }
      : { value: str(o), label: str(o) });
  const ph = node.placeholder != null ? str(resolve(node.placeholder, scope)) : '';
  return (
    <SelectField value={str(c.value ?? '')} onChange={(e) => c.set(e.target.value)}
      wrapperClassName="hud-w-field" className="hud-w-field">
      {ph && <option value="">{ph}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </SelectField>
  );
}

function ToggleNode({ node, scope }: { node: Extract<WidgetNode, { t: 'toggle' }>; scope: Scope }) {
  const c = useControl(node);
  const checked = truthy(c.value);
  const label = node.label != null ? str(resolve(node.label, scope)) : '';
  return (
    <label className="hud-w-toggle">
      <Check checked={checked} onChange={(next) => c.set(next)} />
      {label && <span className="hud-w-toggle-label">{label}</span>}
    </label>
  );
}

/** The `ask` pattern: one question, its answer drawn under it. The question is sent as
 *  `field` (default "text") in the command's body; an async command is FOLLOWED to what
 *  it resolved to (useCommand), and `answer` picks what to show from $result (default
 *  $result.response). */
function AskNode({ node, scope }: { node: Extract<WidgetNode, { t: 'ask' }>; scope: Scope }) {
  const field = node.field ?? 'text';
  const ref = useMemo<CommandRef>(
    () => ({ ...node.cmd, body: { ...(node.cmd.body ?? {}), [field]: { src: '$ask', path: 'q' } } }),
    [node.cmd, field],
  );
  const cmd = useCommand(ref);
  const [q, setQ] = useState('');
  const busy = cmd.status === 'saving' || cmd.status === 'working';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !cmd.available || !q.trim()) return;
    if (await cmd.run({ ...scope, $ask: { q: q.trim() } })) setQ('');
  };
  const o = cmd.outcome;
  const answer = o?.phase === 'done'
    ? str(resolve(node.answer ?? { src: '$result', path: 'response' }, { ...scope, $result: o.result, $job: o }))
    : '';
  return (
    <form className="hud-p hud-p-ask" onSubmit={submit}>
      <div className="hud-p-ask-bar">
        <Field value={q} placeholder={node.placeholder != null ? str(resolve(node.placeholder, scope)) : 'Ask…'}
          onChange={(e) => setQ(e.target.value)} className="hud-p-ask-input" />
        <button type="submit" disabled={!cmd.available || busy} className={actionCls(cmd.available)}
          style={vars({ '--w-tone': 'var(--color-accent)' })}>
          {busy ? '…' : str(resolve(node.submit ?? 'ASK', scope))}
        </button>
      </div>
      {!cmd.available && !cmd.loading && <span className="hud-p-note">Unavailable.</span>}
      {o?.phase === 'pending' && (
        <span className="hud-p-note">Working…{o.status ? ` ${o.status.toLowerCase().replace(/_/g, ' ')}` : ''}</span>
      )}
      {o?.phase === 'done' && <p className="hud-p-answer">{answer}</p>}
      {(o?.phase === 'failed' || o?.phase === 'lost') && <p className="hud-p-answer is-error">{o.error}</p>}
    </form>
  );
}

/** Standalone action button (outside a form): runs its command with body bound
 *  against the live scope — e.g. a "mark done" with a fixed id, or a list-row action. */
function ButtonNode({ node, scope }: { node: Extract<WidgetNode, { t: 'button' }>; scope: Scope }) {
  // A button runs its `cmd`, or its `on.press` actions (exactly one: the validator's oneOf).
  return node.cmd ? <CommandButton node={node} cmdRef={node.cmd} scope={scope} /> : <ActionButton node={node} scope={scope} />;
}

function ActionButton({ node, scope }: { node: Extract<WidgetNode, { t: 'button' }>; scope: Scope }) {
  const act = useActions();
  const chain = node.on?.press;
  const label = str(resolve(node.text, scope));
  const color = node.tone != null ? toneColor(node.tone, scope, 'accent') : 'var(--color-accent)';
  const variant = node.variant ?? 'action';
  // A glyph button is its glyph: the label is its name (a screen reader's, a tooltip's),
  // and a failure says so in the tooltip rather than swapping the face for a word.
  if (node.icon != null || variant !== 'action') {
    const icon = node.icon != null ? str(resolve(node.icon, scope)) : null;
    const on = node.active != null && truthy(resolve(node.active, scope));
    return (
      <button type="button" disabled={act.busy || !chain} onClick={() => { if (chain) void act.fire(chain, scope); }}
        className={`hud-w-btn is-${variant}${on ? ' is-on' : ''}${act.status === 'err' ? ' is-err' : ''}`}
        aria-label={icon ? label : undefined} aria-pressed={node.active != null ? on : undefined}
        title={act.status === 'err' ? act.error : icon ? label : undefined}>
        {icon ? glyph(icon) : act.busy ? '…' : label}
      </button>
    );
  }
  const text = act.busy ? '…' : act.status === 'ok' ? 'DONE' : act.status === 'err' ? 'RETRY' : label;
  return (
    <button type="button" title={act.status === 'err' ? act.error : undefined} disabled={act.busy || !chain}
      onClick={() => { if (chain) void act.fire(chain, scope); }}
      className={actionCls(!!chain)} style={vars({ '--w-tone': color })}>
      {text}
    </button>
  );
}

function CommandButton({ node, cmdRef, scope }: { node: Extract<WidgetNode, { t: 'button' }>; cmdRef: CommandRef; scope: Scope }) {
  const cmd = useCommand(cmdRef);
  const label = str(resolve(node.text, scope));
  const color = node.tone != null ? toneColor(node.tone, scope, 'accent') : 'var(--color-accent)';
  const text = cmd.status === 'saving' ? '…' : cmd.status === 'working' ? 'WORKING…' : cmd.status === 'ok' ? 'DONE' : cmd.status === 'err' ? 'RETRY' : label;
  return (
    <>
      <button onClick={() => cmd.available && cmd.run(scope)} disabled={!cmd.available || cmd.status === 'saving' || cmd.status === 'working'}
        className={actionCls(cmd.available)} style={vars({ '--w-tone': color })}>
        {text}
      </button>
      {resultSlot(node.result, cmd.outcome, scope)}
    </>
  );
}

function SpecWidget({ spec, host, inputs }: { spec: WidgetSpec; host: WidgetHost; inputs?: Record<string, unknown> }) {
  // This instance's own variables — `$state`, written by `set` and by a control with `state`.
  const [vars_, setVars] = useState(() => initialState(spec));
  const setVar = useCallback((k: string, v: unknown) => setVars((st) => (Object.is(st[k], v) ? st : { ...st, [k]: v })), []);
  const stateCtx = useMemo(() => ({ values: vars_, set: setVar }), [vars_, setVar]);
  // The host's slices are in scope by name, `$now` is this instant (what `fmt: 'ago'`
  // measures against), and `$state` is this instance's.
  const $in = useMemo(() => inputScope(spec, inputs), [spec, inputs]);
  const base: Scope = { ...host.slices, $now: host.now, $state: vars_, $route: host.route ?? {}, $in };
  // Each declared source by name, and `$sources.<name>.state` beside it — ready, empty,
  // loading, signed-out, offline… (./sources.ts), so a card can tell "nothing" from "down".
  const { data, status } = useDataSources(spec.sources, base);
  const scope: Scope = { ...base, ...data, $sources: status };
  // The FRAME owns the states — loading, offline, signed-out, forbidden, unavailable,
  // empty — so no author draws them and none can forget one (sources.ts cardState).
  const card = cardState(spec.sources, status, data);
  const f = spec.frame;
  const emptyText = f?.empty != null ? str(resolve(f.empty, scope)) : 'Nothing here yet.';
  // The phone draws its own body where the widget has one; one widget either way, so its
  // sources, state and frame are the same on every tier.
  const tree = host.tier === 'mobile' && spec.mobile ? spec.mobile : spec.body;
  const body = card.kind === 'ready'
    ? <StateCtx.Provider value={stateCtx}>{renderNode(tree, scope)}</StateCtx.Provider>
    : stateView(card, emptyText, host.authUrl);

  // No frame: the body is a self-contained card (a molecule, or chrome:false
  // raw content). Render it bare so it fills the grid cell directly — unless it is
  // standing in for a state, which gets a card to stand in.
  if (!f) {
    return card.kind === 'ready' ? <>{body}</>
      : <div className="hud-card hud-w-frame">{body}</div>;
  }

  const eyebrow = f.eyebrow != null ? str(resolve(f.eyebrow, scope)) : '';
  const source = f.source != null ? str(resolve(f.source, scope)) : '';
  const href = f.href != null ? safeHref(resolve(f.href, scope)) : undefined;
  const stale = card.kind === 'ready' && card.stale ? 'OFFLINE' : undefined;

  const head = <CardHead eyebrow={eyebrow} source={source} stale={stale} />;

  const inner = <>{head}{body}</>;
  const cls = f.chrome === false ? 'hud-spec-raw hud-w-frame is-raw' : 'hud-card hud-w-frame';
  return href
    ? <a className={cls} href={href}>{inner}</a>
    : <div className={cls}>{inner}</div>;
}

/* ═══ Per-card update isolation ═════════════════════════════════════════════
 * A host's slices change on their own clocks (ORDECK's clock every second, its
 * weather on a 15-minute poll), but a card only depends on the SLICES its spec binds
 * to. Those are collected once per def and each card is gated behind a memo that
 * re-renders only when one of THOSE changes reference — so a clock card updates every
 * second and a static card almost never. The host keeps each slice's reference stable
 * between real changes (WidgetHost.slices), which is what makes the comparison mean
 * something. */
const bindsCache = new WeakMap<object, { names: Set<string>; now: boolean; ai: boolean; mobile: boolean }>();

/** What a widget reads besides its own sources — cached per def (spec object identity), so
 *  it's recomputed only when the def actually changes (a workshop edit, a published merge). */
function binds(def: WidgetDef, widgets?: Readonly<Record<string, WidgetDef>>) {
  const key: object = def.spec ?? def;
  const cached = bindsCache.get(key);
  if (cached) return cached;
  // One walker (@jkos/widgets sourcesOf): every `{src}` binding plus each molecule's
  // manifest-declared slice. `cmd` and `on` subtrees are skipped — they resolve when
  // submitted or fired, so they are not display dependencies (else a form defaulting
  // due_date to clock.iso would re-render its card every second). A part it `use`s is
  // drawn inside this card, so what the part binds is this card's to watch too.
  const names = new Set<string>();
  const seen = new Set<string>();
  const add = (d: WidgetDef | undefined) => {
    if (!d?.spec) return;
    for (const n of sourcesOf(d.spec)) names.add(n);
    for (const id of partsOf(d)) if (!seen.has(id)) { seen.add(id); add(widgets?.[id]); }
  };
  add(def);
  const out = { names, now: names.has('$now'), ai: usesAi(def, widgets), mobile: !!def.spec?.mobile };
  bindsCache.set(key, out);
  return out;
}

interface CardProps { def: WidgetDef; host: WidgetHost; inputs?: Record<string, unknown> }

/** Last time each card actually rendered, for the refreshMs heartbeat. ORDECK re-renders
 *  its cards ~once a second (the clock), so cardPropsEqual is consulted at that cadence —
 *  fine-grained enough to honour any sane refresh interval. */
const lastRenderAt = new Map<string, number>();

function cardPropsEqual(prev: CardProps, next: CardProps): boolean {
  if (prev.def !== next.def) return false;     // def changed → re-render
  if (prev.inputs !== next.inputs) return false; // a part handed new inputs
  const b = binds(next.def, next.host.widgets);
  // A name that is not one of the host's slices ($ list element, $form, a source's own
  // name) is never on the host, so it never (correctly) triggers a re-render here.
  for (const k of b.names) {
    if (k in next.host.slices && prev.host.slices[k] !== next.host.slices[k]) return false;
  }
  if (b.now && prev.host.now !== next.host.now) return false;          // an `ago` moves with the clock
  if (b.ai && prev.host.aiEnabled !== next.host.aiEnabled) return false; // the kill switch flipped
  if (b.mobile && prev.host.tier !== next.host.tier) return false;        // its phone body comes or goes
  // Manual override: force a render once refreshMs has elapsed since the last one.
  // Because the gate runs on the host's tick, the card re-renders with the LATEST
  // slices (no staleness) — this is the safety valve over auto-detect.
  const ms = next.def.refreshMs;
  if (ms && ms > 0 && Date.now() - (lastRenderAt.get(next.def.id) ?? 0) >= ms) return false;
  return true;                                 // every bound slice stable + not due → skip
}

/** One card, isolated: re-renders when a slice it binds to changes, when its
 *  refreshMs heartbeat is due, or on its own internal state (a form's inputs, a
 *  fetch source's polled data) — so interactive/live cards still update themselves. */
const WidgetCard = memo(function WidgetCard({ def, host, inputs }: CardProps) {
  // Stamp the render time post-commit (not during render) for the heartbeat above.
  useEffect(() => { if (def.refreshMs) lastRenderAt.set(def.id, Date.now()); });
  return <>{renderWidgetBody(def, host, inputs)}</>;
}, cardPropsEqual);

/* ═══ Entry point ══════════════════════════════════════════════════════════ */

function unknownWidget(name: string): ReactNode {
  return (
    <div className="hud-card hud-w-unknown">
      <span>
        UNKNOWN WIDGET: {name.toUpperCase()}
      </span>
    </div>
  );
}

/** A host kind this host does not draw — a molecule placed where its slice does not
 *  exist. Drawn in the node's place, so the rest of the card still renders. */
function notHere(kind: string): ReactNode {
  return (
    <div className="hud-card hud-w-unknown">
      <span>
        NOT AVAILABLE HERE: {kind.toUpperCase()}
      </span>
    </div>
  );
}

/** What an AI widget draws while the kill switch is off: no source read, no command
 *  armed — the switch is enforced here, not only by hiding the widget from the shelf. */
function aiOffTile(def: WidgetDef): ReactNode {
  return (
    <div className="hud-card hud-w-aioff" data-widget-ai-off="">
      <span className="hud-eyebrow">{(def.label || def.id).toUpperCase()}</span>
      <span className="hud-w-aioff-note">AI IS OFF — TURN IT ON IN SETTINGS</span>
    </div>
  );
}

function renderWidgetBody(def: WidgetDef, host: WidgetHost, inputs?: Record<string, unknown>): ReactNode {
  if (!host.aiEnabled && usesAi(def, host.widgets)) return aiOffTile(def);
  if (!def.spec) return unknownWidget(def.id);
  const body = <SpecWidget spec={def.spec} host={host} inputs={inputs} />;
  // A page is a SCREEN: it scrolls, so nothing in it is squeezed to fit a footprint
  // (widgets.css § Pages). A card fits its cell; a page is as tall as what it holds.
  return def.route ? <div className="hud-w-page">{body}</div> : body;
}

/** Render a widget file in `host`, behind its per-card update gate (see WidgetCard) —
 *  `inputs` are a part's `$in`, when a host (a contact sheet) draws a part on its own. Each
 *  card is isolated by a boundary, so one malformed spec (a bad published/AI/workshop
 *  widget) shows a single fault tile instead of taking the whole page down; resetKey=def
 *  clears the fault when the definition is edited/republished. The boundary wraps the
 *  memo, so a stable card still bails out of re-render on the host's tick. */
export function renderWidget(def: WidgetDef, host: WidgetHost, inputs?: Record<string, unknown>): ReactNode {
  return (
    <WidgetBoundary widgetName={def.label} resetKey={def}>
      <HostCtx.Provider value={host}>
        <KindsCtx.Provider value={host.kinds ?? NO_KINDS}>
          <WidgetCard def={def} host={host} inputs={inputs} />
        </KindsCtx.Provider>
      </HostCtx.Provider>
    </WidgetBoundary>
  );
}
const NO_KINDS: HostKinds = {};
