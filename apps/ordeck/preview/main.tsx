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
 * The page lays out a contact sheet — a row per tier (desktop, mobile, and the
 * smallest footprint a user may resize to), a column per state — each cell sized
 * exactly as the HUD grid sizes it (the Workshop canvas's geometry) and holding
 * `renderWidget(def, ctx)`, the same call RoomHUD makes. Built-in slices come from
 * sample.ts; each declared source is read through the real reader (dataset discovery,
 * the refusal of suite URLs, the shape checks) with only the request itself sent to
 * /__fixture/<job>/<state>/<name>, which the harness answers per state (data, empty,
 * 503, 401, or never).
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
import { renderWidget } from '../src/hud/registry';
import { SourceReaderProvider, readExternal, type SourceReader } from '../src/hud/sources';
import { CATALOG } from '../src/hud/catalog';
import { readDataset } from '@jkos/weave';
import { DEFAULT_MIN_SIZE, type WidgetDef } from '../src/hud/types';
import { TIERS, ROW_H, unitsToPx } from '../src/workshop/EditorCanvas';
import { sampleCtx, PREVIEW_STATES, type PreviewState } from './sample';
import '../src/styles/global.css';
import '../src/styles/hud.css';
import '../src/hud/grid.css';
import './preview.css';

interface Job { def: WidgetDef; mode?: 'paper' | 'dark'; accent?: number; states?: PreviewState[] }

type Tier = 'desktop' | 'mobile' | 'min';
const TIER_ROWS: { tier: Tier; colW: number; label: string }[] = [
  { tier: 'desktop', colW: TIERS.desktop.colW, label: 'DESKTOP' },
  { tier: 'mobile', colW: TIERS.mobile.colW, label: 'MOBILE' },
  { tier: 'min', colW: TIERS.desktop.colW, label: 'SMALLEST' },
];

function footprint(def: WidgetDef, tier: Tier) {
  if (tier === 'min') return def.sizing.min ?? DEFAULT_MIN_SIZE;
  return def.sizing[tier];
}

/** Which job this page is — the harness serves several through one page, in turn. */
const JOB = new URLSearchParams(location.search).get('job') ?? '0';

/** How a cell's sources are read: through the REAL reader's discovery, URL and shape
 *  checks (a dataset is looked up in the app's declaration, which the harness serves;
 *  a suite URL in a fetch source is refused as it would be live) — with only the request
 *  itself answered from this state's fixture. One reader per state, made once. */
const readers = new Map<PreviewState, SourceReader>();
function readerFor(state: PreviewState): SourceReader {
  let r = readers.get(state);
  if (!r) {
    const answer = (name: string) => () => realFetch(`/__fixture/${JOB}/${state}/${encodeURIComponent(name)}`);
    r = async (name, source, params) => {
      if (source.kind === 'dataset') {
        const read = await readDataset(source.app, source.dataset, params, { fetch: answer(name) });
        return { ...read, invalidates: read.def?.invalidates };
      }
      if (source.kind === 'fetch') return readExternal(source.url, answer(name));
      return { state: 'unavailable', error: 'unknown source kind' };
    };
    readers.set(state, r);
  }
  return r;
}

/* Count the fixture requests still owed an answer. A `loading` cell's are never
   answered — that is the state — so they are not waited for. */
let pending = 0;
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const owed = !/\/__fixture\/[^/]+\/loading\//.test(url);
  if (owed) pending++;
  return realFetch(input, init).finally(() => { if (owed) pending--; });
};

function Sheet({ job }: { job: Job }) {
  const states = job.states ?? PREVIEW_STATES;
  return (
    <div className="wp-sheet">
      <div className="wp-head">
        <span className="hud-eyebrow">{job.def.label || job.def.id}</span>
        <span className="hud-eyebrow-src">{job.def.id} · {job.mode ?? 'paper'}</span>
      </div>
      {TIER_ROWS.map(({ tier, colW, label }) => {
        const size = footprint(job.def, tier);
        const w = unitsToPx(Math.min(size.w, tier === 'mobile' ? 2 : 12), colW);
        const h = unitsToPx(size.h, ROW_H);
        return (
          <div className="wp-row" key={tier}>
            <div className="wp-tier hud-eyebrow">{label}<br />{size.w}×{size.h}</div>
            {states.map((state) => (
              <div className="wp-cell" key={state} data-tier={tier} data-state={state}>
                <div className="wp-label hud-eyebrow">{state}</div>
                <div className="hud-cell wp-frame" style={{ width: w, height: h }}>
                  <SourceReaderProvider value={readerFor(state)}>
                    {renderWidget(job.def, sampleCtx(state))}
                  </SourceReaderProvider>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** What the gate asserts and the agent reads: per cell, a fault tile, the card
 *  overflowing its footprint, and text that is cut off rather than ellipsized. */
function measure() {
  const cells = [...document.querySelectorAll<HTMLElement>('.wp-cell')].map((cell) => {
    const frame = cell.querySelector<HTMLElement>('.wp-frame')!;
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
      const outside = r.right > fr.right + 1 || r.bottom > fr.bottom + 1;
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' || outside) {
        clipped.push(el.textContent!.trim().slice(0, 40));
      }
    }
    return {
      tier: cell.dataset.tier, state: cell.dataset.state,
      rect: { x: fr.x + window.scrollX, y: fr.y + window.scrollY, width: fr.width, height: fr.height },
      fault: !!frame.querySelector('[data-widget-fault]'),
      overflowX: !!card && card.scrollWidth > card.clientWidth + 1,
      overflowY: !!card && card.scrollHeight > card.clientHeight + 1,
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

  // Settle, in order: every owed fixture answered; React committed what arrived; every
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
  (window as unknown as Record<string, unknown>).__widgetReport = { ...measure(), unsettled: pending, fonts: [...new Set(fonts)], catalog: Object.keys(CATALOG).sort() };
  (window as unknown as Record<string, unknown>).__widgetReady = true;
}

main().catch((e) => {
  (window as unknown as Record<string, unknown>).__widgetReport = { error: String(e?.stack || e) };
  (window as unknown as Record<string, unknown>).__widgetReady = true;
});
