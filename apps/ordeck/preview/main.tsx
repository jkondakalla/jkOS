/**
 * preview/main.tsx — one widget, every state, every tier, drawn by the real renderer
 * for a camera.
 *
 * `pnpm widget shot` and `pnpm check:widget-render` build this entry (never shipped:
 * it has its own Vite config, vite.preview.config.ts, and is not part of ORDECK's
 * build) and serve it a job at /job.json?job=<n>:
 *
 *   { def, mode: 'paper' | 'dark', accent?: 0..3, states?: PreviewState[] }
 *
 * The page lays out a contact sheet — a row per tier, a column per state. A HUD card's
 * rows are desktop, mobile and the smallest footprint a user may resize to, each cell
 * sized exactly as the HUD grid sizes it (the Workshop canvas's geometry); a PAGE's are
 * the three screen tiers at a screen's size, where the page scrolls; a part's are a
 * generous cell per tier. Each cell holds `renderWidget(def, hudHost(ctx, tier))`, the
 * same call RoomHUD makes. Built-in slices come from hud/sample.ts, and each declared
 * source is read by its fixtureReader — the real discovery, refusal and shape checks,
 * with only the request answered from the job's fixtures for that state (data, empty,
 * 503, 401, or never).
 *
 * A state's fixtures may also carry what no source answers: `$slices` (host slices the
 * widget binds, over the sample's — a KourOS page's player), `$route` (a page's route
 * params) and `$in` (a part's inputs). The synthesised states (loading, offline, signed
 * out) use the `ready` ones.
 *
 * When everything that should arrive has arrived, the page measures itself and
 * raises `window.__widgetReady`, with the findings in `window.__widgetReport` — a
 * real signal, so the camera never guesses with a sleep (TRAPS.md: `--screenshot`
 * fires on load, before React has anything).
 */

import './clock';   // FIRST: the page's Date is pinned before anything reads it
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { injectJkOSTheme, applyJkOSMode, applyJkOSMotion, applyJkOSTheme, ACCENT_SCHEMES } from '@jkos/design';
import { renderWidget, SourceReaderProvider, type SourceReader, type WidgetHost } from '@jkos/widget-render';
import { hudHost } from '../src/hud/host';
import { WIDGETS } from '../src/hud/catalog';
import { DEFAULT_MIN_SIZE, type WidgetDef } from '../src/hud/types';
import { TIERS, ROW_H, unitsToPx } from '../src/workshop/EditorCanvas';
import { sampleCtx, fixtureReader, PREVIEW_STATES, type PreviewState } from '../src/hud/sample';
import '../src/styles/global.css';
import '../src/styles/hud.css';
import '../src/hud/grid.css';
import './preview.css';

type AnyDef = Omit<WidgetDef, 'sizing'> & { sizing?: WidgetDef['sizing'] };
interface Job { def: AnyDef; mode?: 'paper' | 'dark'; accent?: number; states?: PreviewState[]; fixtures?: Record<string, Record<string, unknown>> | null }

type Tier = 'desktop' | 'tablet' | 'mobile' | 'min';
interface Row { tier: Tier; label: string; w: number; h: number; dims: string }

/** A page is a SCREEN: drawn at a screen's size per tier, and it scrolls. */
const SCREENS: { tier: Tier; label: string; w: number; h: number }[] = [
  { tier: 'desktop', label: 'DESKTOP', w: 1280, h: 800 },
  { tier: 'tablet', label: 'TABLET', w: 820, h: 1000 },
  { tier: 'mobile', label: 'MOBILE', w: 390, h: 844 },
];
/** A part (no footprint, no route) is drawn in a generous cell per tier, in grid units. */
const PART = { desktop: { w: 6, h: 8 }, mobile: { w: 2, h: 10 }, min: { w: 4, h: 6 } } as const;

/** The sheet's rows: a page's screens, a card's footprints, or a part's cells. */
function rowsFor(def: AnyDef): Row[] {
  if (def.route) return SCREENS.map((s) => ({ ...s, dims: `${s.w}×${s.h}px` }));
  const cards: { tier: Tier; colW: number; label: string }[] = [
    { tier: 'desktop', colW: TIERS.desktop.colW, label: 'DESKTOP' },
    { tier: 'mobile', colW: TIERS.mobile.colW, label: 'MOBILE' },
    { tier: 'min', colW: TIERS.desktop.colW, label: 'SMALLEST' },
  ];
  return cards.map(({ tier, colW, label }) => {
    const size = !def.sizing ? PART[tier as keyof typeof PART]
      : tier === 'min' ? def.sizing.min ?? DEFAULT_MIN_SIZE : def.sizing[tier as 'desktop' | 'mobile'];
    return {
      tier, label, dims: `${size.w}×${size.h}`,
      w: unitsToPx(Math.min(size.w, tier === 'mobile' ? 2 : 12), colW), h: unitsToPx(size.h, ROW_H),
    };
  });
}

/** What a state's fixtures give besides sources: `$slices`, `$route`, `$in` — the state's
 *  own, else `ready`'s (the synthesised states have no fixtures of their own). */
function extra(job: Job, state: PreviewState, key: '$slices' | '$route' | '$in'): Record<string, unknown> | undefined {
  return (job.fixtures?.[state]?.[key] ?? job.fixtures?.ready?.[key]) as Record<string, unknown> | undefined;
}

/** The host a cell draws in: ORDECK's (sample slices, at this tier), with the fixtures'
 *  slices over them, the page's route params, and a router that goes nowhere — so a `go`
 *  is armed as it would be in an app that routes. */
function hostFor(job: Job, state: PreviewState, tier: Tier): WidgetHost {
  const base = hudHost(sampleCtx(state), tier === 'min' ? 'desktop' : tier);
  return {
    ...base,
    slices: { ...base.slices, ...extra(job, state, '$slices') },
    route: extra(job, state, '$route') as Record<string, string> | undefined,
    navigate: () => {},
  };
}

/** Which job this page is — the harness serves several through one page, in turn. */
const JOB = new URLSearchParams(location.search).get('job') ?? '0';

/** How a cell's sources are read for its state: the shared fixtureReader (hud/sample.ts)
 *  over this job's fixtures — the real discovery, refusal and shape checks, with only
 *  the request answered. One reader per state, made once. */
const readers = new Map<PreviewState, SourceReader>();
function readerFor(state: PreviewState, fixtures: Job['fixtures']): SourceReader {
  let r = readers.get(state);
  if (!r) { r = fixtureReader(state, fixtures); readers.set(state, r); }
  return r;
}

/* Count the requests still owed an answer — the apps' declarations the readers discover
   datasets through, and a form's capabilities. (A source's own answer is in memory, and a
   `loading` cell's never comes: that is the state.) */
let pending = 0;
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  pending++;
  return realFetch(input, init).finally(() => { pending--; });
};

function Sheet({ job }: { job: Job }) {
  const states = job.states ?? PREVIEW_STATES;
  return (
    <div className="wp-sheet">
      <div className="wp-head">
        <span className="hud-eyebrow">{job.def.label || job.def.id}</span>
        <span className="hud-eyebrow-src">{job.def.id} · {job.mode ?? 'paper'}</span>
      </div>
      {rowsFor(job.def).map(({ tier, label, w, h, dims }) => (
        <div className="wp-row" key={tier}>
          <div className="wp-tier hud-eyebrow">{label}<br />{dims}</div>
          {states.map((state) => (
            <div className="wp-cell" key={state} data-tier={tier} data-state={state} data-kind={job.def.route ? 'screen' : 'card'}>
              <div className="wp-label hud-eyebrow">{state}</div>
              <div className={`hud-cell wp-frame${job.def.route ? ' wp-screen' : ''}`} style={{ width: w, height: h }}>
                <SourceReaderProvider value={readerFor(state, job.fixtures)}>
                  {renderWidget(job.def as WidgetDef, hostFor(job, state, tier), extra(job, state, '$in'))}
                </SourceReaderProvider>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** What the gate asserts and the agent reads: per cell, a fault tile, the card
 *  overflowing its footprint, and text that is cut off rather than ellipsized. */
function measure() {
  const cells = [...document.querySelectorAll<HTMLElement>('.wp-cell')].map((cell) => {
    const frame = cell.querySelector<HTMLElement>('.wp-frame')!;
    // A screen scrolls: content below its fold is reachable, not lost.
    const screen = cell.dataset.kind === 'screen';
    const card = frame.firstElementChild as HTMLElement | null;
    const fr = frame.getBoundingClientRect();
    const clipped: string[] = [];
    /* Content a scroll area can reach is not lost (the Week view scrolls its hours). */
    const scrollable = (el: HTMLElement) => {
      for (let a = el.parentElement; a && a !== frame; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (/(auto|scroll)/.test(o.overflowY + o.overflowX)) return true;
      }
      return false;
    };
    for (const el of frame.querySelectorAll<HTMLElement>('*')) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis') continue;                      // cut deliberately, with a mark
      if (scrollable(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const outside = r.right > fr.right + 1 || (!screen && r.bottom > fr.bottom + 1);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' || outside) {
        clipped.push(el.textContent!.trim().slice(0, 40));
      }
    }
    return {
      tier: cell.dataset.tier, state: cell.dataset.state,
      rect: { x: fr.x + window.scrollX, y: fr.y + window.scrollY, width: fr.width, height: fr.height },
      fault: !!frame.querySelector('[data-widget-fault]'),
      overflowX: !!card && card.scrollWidth > card.clientWidth + 1,
      overflowY: !screen && !!card && card.scrollHeight > card.clientHeight + 1,
      clipped: [...new Set(clipped)].slice(0, 6),
    };
  });
  const sheet = document.querySelector<HTMLElement>('.wp-sheet')!.getBoundingClientRect();
  return { cells, width: Math.ceil(sheet.width), height: Math.ceil(sheet.height) };
}

async function main() {
  const job: Job = await (await realFetch(`/job.json?job=${JOB}`)).json();
  // ORDECK's own theme inputs (App.tsx), the requested face, and nothing moving.
  injectJkOSTheme({ selector: 'html.od-v2', radius: { base: '10px', xs: '4px', sm: '7px', lg: '16px', soft: '8px', button: '9px' } });
  document.documentElement.classList.add('od-v2');
  applyJkOSMode(job.mode === 'dark' ? 'dark' : 'light');
  applyJkOSMotion('static');
  if (job.accent != null && ACCENT_SCHEMES[job.accent]) applyJkOSTheme(ACCENT_SCHEMES[job.accent]);

  ReactDOM.createRoot(document.getElementById('root')!).render(<StrictMode><Sheet job={job} /></StrictMode>);

  // Settle, in order: every owed request answered; React committed what arrived; every
  // font face that text asked for finished loading (a face only starts loading once
  // text that uses it is laid out, so fonts are awaited AFTER the commit — awaiting
  // them first measured fallback metrics and made the gate flaky); then a last frame.
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const until = Date.now() + 10_000;
  do { await new Promise((r) => setTimeout(r, 50)); } while (pending > 0 && Date.now() < until);
  await frames();
  const fontsBy = Date.now() + 8_000;   // bounded: an offline machine falls back, consistently
  while (document.fonts.status !== 'loaded' && Date.now() < fontsBy) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 250))]);
  }
  await frames();
  const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`);
  // What Vite's glob compiled in (hud/catalog.ts) — the render gate holds it to the files.
  (window as unknown as Record<string, unknown>).__widgetReport = { ...measure(), unsettled: pending, fonts: [...new Set(fonts)], catalog: Object.keys(WIDGETS).sort() };
  (window as unknown as Record<string, unknown>).__widgetReady = true;
}

main().catch((e) => {
  (window as unknown as Record<string, unknown>).__widgetReport = { error: String(e?.stack || e) };
  (window as unknown as Record<string, unknown>).__widgetReady = true;
});
