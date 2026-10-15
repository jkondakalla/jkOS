/**
 * preview/kit.tsx — a contact sheet: one widget, every state, every tier, drawn by the
 * real renderer for a camera. Each app that hosts widgets has a preview entry
 * (apps/<app>/preview, its own Vite config, never part of the app's build) that hands
 * this its host and its rows; `pnpm widget shot` and `pnpm check:widget-render` build the
 * entry of the host that can draw a widget (scripts/widget/render.mjs) and serve it a job
 * at /job.json?job=<n>:
 *
 *   { def, mode: 'paper' | 'dark', accent?: 0..3, states?: PreviewState[], fixtures? }
 *
 * The sheet is a row per tier and a column per state. Each cell holds
 * `renderWidget(def, hostFor(job, state, tier), $in)` — the call the app itself makes —
 * with each declared source read by the shared fixtureReader: the real discovery, refusal
 * and shape checks, with only the request answered from the job's fixtures for that state
 * (data, empty, 503, 401, or never). A state's fixtures may also carry what no source
 * answers: `$slices` (host slices the widget binds, over the host's sample), `$route` (a
 * page's params) and `$in` (a part's inputs); the synthesised states use `ready`'s.
 *
 * A PAGE (a widget with a `route`) is drawn at a screen's size per tier, and scrolls in
 * it; what a card or a part is drawn at is the host's to say (ORDECK: its grid).
 *
 * When everything that should arrive has arrived, the page measures itself and raises
 * `window.__widgetReady`, with the findings in `window.__widgetReport` — a real signal, so
 * the camera never guesses with a sleep (TRAPS.md: `--screenshot` fires on load, before
 * React has anything).
 */

import { StrictMode, type ReactNode } from 'react';
import { renderWidget, vars, type WidgetHost } from '../render';
import { SourceReaderProvider, type SourceReader } from '../sources';
import { fixtureReader, PREVIEW_STATES, type PreviewState } from '../fixtures';
import type { WidgetDef } from '../types';
import './preview.css';

export interface PreviewJob {
  def: WidgetDef;
  mode?: 'paper' | 'dark';
  accent?: number;
  states?: PreviewState[];
  fixtures?: Record<string, Record<string, unknown>> | null;
}

/** A row of the sheet: one tier, the cell size it is drawn at, and how it is labelled. */
export interface SheetRow { tier: 'desktop' | 'tablet' | 'mobile' | 'min'; label: string; w: number; h: number; dims: string }

export interface PreviewConfig {
  /** The host a cell draws in, for this job, state and tier — before the job's `$slices`
   *  and `$route` are laid over it (the kit does that). */
  hostFor(job: PreviewJob, state: PreviewState, tier: SheetRow['tier']): WidgetHost;
  /** The rows of a widget that is not a page (a card's footprints, a part's cells). */
  rowsFor(def: WidgetDef): SheetRow[];
  /** The app's face: its theme inputs, the job's mode and accent, nothing moving. */
  setup(job: PreviewJob): void;
  /** Every widget file this preview compiled in — the render gate holds it to the disk. */
  catalog: readonly string[];
  /** An extra class on each cell's frame (ORDECK: its grid's `hud-cell`). */
  cellClass?: string;
  /** Put the sheet on the page — the entry's own react-dom (`createRoot(#root).render`). */
  mount(node: ReactNode): void;
}

/** A page is a SCREEN: drawn at a screen's size per tier, and it scrolls. */
export const SCREENS: SheetRow[] = [
  { tier: 'desktop', label: 'DESKTOP', w: 1280, h: 800, dims: '1280×800px' },
  { tier: 'tablet', label: 'TABLET', w: 820, h: 1000, dims: '820×1000px' },
  { tier: 'mobile', label: 'MOBILE', w: 390, h: 844, dims: '390×844px' },
];

/** What a state's fixtures give besides sources: `$slices`, `$route`, `$in` — the state's
 *  own, else `ready`'s (the synthesised states have no fixtures of their own). */
function extra(job: PreviewJob, state: PreviewState, key: '$slices' | '$route' | '$in'): Record<string, unknown> | undefined {
  return (job.fixtures?.[state]?.[key] ?? job.fixtures?.ready?.[key]) as Record<string, unknown> | undefined;
}

/** Draw the job this page was opened for, then report. */
export function runPreview(config: PreviewConfig): void {
  const JOB = new URLSearchParams(location.search).get('job') ?? '0';

  // One reader per state, made once (fixtureReader over this job's fixtures).
  const readers = new Map<PreviewState, SourceReader>();
  const readerFor = (state: PreviewState, fixtures: PreviewJob['fixtures']): SourceReader => {
    let r = readers.get(state);
    if (!r) { r = fixtureReader(state, fixtures); readers.set(state, r); }
    return r;
  };

  /* Count the requests still owed an answer — the apps' declarations the readers discover
     datasets through, and a form's capabilities. (A source's own answer is in memory, and
     a `loading` cell's never comes: that is the state.) */
  let pending = 0;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    pending++;
    return realFetch(input, init).finally(() => { pending--; });
  };

  /** The cell's host: the app's, with the fixtures' slices over its sample, the page's
   *  route params, and a router that goes nowhere — so a `go` is armed as in the app. */
  const hostFor = (job: PreviewJob, state: PreviewState, tier: SheetRow['tier']): WidgetHost => {
    const base = config.hostFor(job, state, tier);
    return {
      ...base,
      slices: { ...base.slices, ...extra(job, state, '$slices') },
      route: extra(job, state, '$route') as Record<string, string> | undefined,
      navigate: () => {},
    };
  };

  function Sheet({ job }: { job: PreviewJob }) {
    const states = job.states ?? PREVIEW_STATES;
    const screen = !!job.def.route;
    return (
      <div className="wp-sheet">
        <div className="wp-head">
          <span className="hud-eyebrow">{job.def.label || job.def.id}</span>
          <span className="hud-eyebrow-src">{job.def.id} · {job.mode ?? 'paper'}</span>
        </div>
        {(screen ? SCREENS : config.rowsFor(job.def)).map(({ tier, label, w, h, dims }) => (
          <div className="wp-row" key={tier}>
            <div className="wp-tier hud-eyebrow">{label}<br />{dims}</div>
            {states.map((state) => (
              <div className="wp-cell" key={state} data-tier={tier} data-state={state} data-kind={screen ? 'screen' : 'card'}>
                <div className="wp-label hud-eyebrow">{state}</div>
                <div className={`wp-frame${config.cellClass ? ` ${config.cellClass}` : ''}${screen ? ' wp-screen' : ''}`} style={vars({ '--wp-w': `${w}px`, '--wp-h': `${h}px`, '--w-screen-h': `${h}px` })}>
                  <SourceReaderProvider value={readerFor(state, job.fixtures)}>
                    {renderWidget(job.def, hostFor(job, state, tier), extra(job, state, '$in'))}
                  </SourceReaderProvider>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  async function main() {
    const job: PreviewJob = await (await realFetch(`/job.json?job=${JOB}`)).json();
    config.setup(job);
    config.mount(<StrictMode><Sheet job={job} /></StrictMode>);

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
    (window as unknown as Record<string, unknown>).__widgetReport = { ...measure(), unsettled: pending, fonts: [...new Set(fonts)], catalog: [...config.catalog].sort() };
    (window as unknown as Record<string, unknown>).__widgetReady = true;
  }

  main().catch((e) => {
    (window as unknown as Record<string, unknown>).__widgetReport = { error: String(e?.stack || e) };
    (window as unknown as Record<string, unknown>).__widgetReady = true;
  });
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
