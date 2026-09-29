/**
 * workshop/Gallery.tsx — every widget the suite ships, in every state.
 *
 * The preview harness's contact sheet, inside the app: each catalog widget (and the one
 * on the canvas) drawn at its desktop footprint in ready, empty, offline, signed-out and
 * loading, from the same sample context (hud/sample.ts) and the same fixture reader the
 * gate draws with. So an author sees every state a card will ever be in without faking
 * one, and a reviewer sees the whole catalog at once.
 */

import { useEffect, useMemo, useState } from 'react';
import { renderWidget } from '../hud/registry';
import { SourceReaderProvider } from '../hud/sources';
import { sampleCtx, fixtureReader, PREVIEW_STATES } from '../hud/sample';
import { CATALOG, CATALOG_APP, loadFixtures } from '../hud/catalog';
import type { WidgetDef } from '../hud/types';
import { TIERS, ROW_H, unitsToPx } from './EditorCanvas';

type Fixtures = Record<string, Record<string, Record<string, unknown>>>;

export function Gallery({ draft }: { draft: WidgetDef | null }) {
  const [fixtures, setFixtures] = useState<Fixtures | null>(null);
  useEffect(() => { let live = true; loadFixtures().then((f) => { if (live) setFixtures(f); }); return () => { live = false; }; }, []);
  const widgets: [WidgetDef, string][] = [
    ...(draft && draft.id && !CATALOG[draft.id] ? [[draft, 'on the canvas'] as [WidgetDef, string]] : []),
    ...Object.values(CATALOG).map((d) => [d, `apps/${CATALOG_APP[d.id]}/widgets/${d.id}.json`] as [WidgetDef, string]),
  ];
  // One reader per widget × state, made once: a new reader each render would re-read.
  const readers = useMemo(() => {
    const m = new Map<string, ReturnType<typeof fixtureReader>>();
    if (fixtures) for (const [def] of widgets) for (const s of PREVIEW_STATES) m.set(`${def.id}|${s}`, fixtureReader(s, fixtures[def.id]));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures, widgets.map(([d]) => d.id).join()]);
  if (!fixtures) return <p className="wg-note">Loading the fixtures…</p>;
  return (
    <div className="wg">
      {widgets.map(([def, where]) => {
        const w = unitsToPx(Math.min(def.sizing.desktop.w, 12), TIERS.desktop.colW);
        const h = unitsToPx(def.sizing.desktop.h, ROW_H);
        return (
          <section key={def.id} className="wg-widget">
            <div className="wg-head">
              <span className="hud-eyebrow">{def.label || def.id}</span>
              <span className="wg-where">{where} · {def.sizing.desktop.w}×{def.sizing.desktop.h}</span>
            </div>
            <div className="wg-row">
              {PREVIEW_STATES.map((state) => (
                <figure key={state} className="wg-cell">
                  <figcaption className="hud-eyebrow">{state}</figcaption>
                  <div className="hud-cell" style={{ width: w, height: h }}>
                    <SourceReaderProvider value={readers.get(`${def.id}|${state}`)!}>
                      {renderWidget(def, sampleCtx(state))}
                    </SourceReaderProvider>
                  </div>
                </figure>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
