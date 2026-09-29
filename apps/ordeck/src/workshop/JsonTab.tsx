/**
 * workshop/JsonTab.tsx — the widget as its file, with every problem as you type.
 *
 * What the canvas edits IS a widget file (apps/<app>/widgets/<id>.json). This tab shows
 * it, lets you edit or paste one, and runs BOTH validation tiers on every keystroke: the
 * structure and safety jkAuth checks at publish (validateWidget), and every binding,
 * source and command against what its app declares and ORDECK's slices (checkBindings,
 * with the declarations fetched from the apps this widget reaches). Each problem is a
 * JSON Pointer with the likely fix — the same list `pnpm widget check` prints.
 */

import { useEffect, useMemo, useState } from 'react';
import { validateWidget, appsOf } from '@jkos/widgets';
import { checkBindings } from '@jkos/widgets/semantic';
import { fetchCapabilities, fetchDatasets, suiteApps, type AppId, type CapabilityDoc, type DatasetDoc } from '@jkos/weave';
import { HUD_SLICES } from '../hud/slices';
import type { WidgetDef } from '../hud/types';

type Docs = Record<string, { capabilities: CapabilityDoc | null; datasets: DatasetDoc | null }>;

/** The suite's hostnames — what jkAuth refuses a fetch source at (validateWidget ctx). */
function suiteHosts(): string[] {
  const out = new Set<string>([window.location.hostname]);
  for (const a of Object.values(suiteApps())) { try { if (a.origin) out.add(new URL(a.origin).hostname); } catch { /* none */ } }
  return [...out];
}

export function JsonTab({ def, onLoad }: { def: WidgetDef; onLoad: (d: WidgetDef) => void }) {
  const [text, setText] = useState(() => JSON.stringify(def, null, 2));
  const [docs, setDocs] = useState<Docs>({});
  useEffect(() => { setText(JSON.stringify(def, null, 2)); }, [def]);

  const parsed = useMemo((): { def?: WidgetDef; error?: string } => {
    try { return { def: JSON.parse(text) as WidgetDef }; } catch (e) { return { error: String((e as Error).message) }; }
  }, [text]);

  // The declarations of every app the draft reaches, fetched (and cached by weave) as it changes.
  const apps = parsed.def ? [...appsOf(parsed.def)].sort().join() : '';
  useEffect(() => {
    let live = true;
    const ids = apps ? apps.split(',') : [];
    Promise.all(ids.map(async (id) => [id, {
      capabilities: await fetchCapabilities(id as AppId), datasets: await fetchDatasets(id as AppId),
    }] as const)).then((rows) => { if (live) setDocs(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [apps]);

  // Structure first (what jkAuth refuses — it blocks loading); bindings once that passes.
  const structural = useMemo(() => (parsed.def ? validateWidget(parsed.def, { suiteHosts: suiteHosts() }) : []), [parsed.def]);
  const problems = useMemo(
    () => (structural.length || !parsed.def ? structural : checkBindings(parsed.def, { docs, slices: HUD_SLICES as Record<string, object> })),
    [structural, parsed.def, docs],
  );

  const copy = () => { navigator.clipboard?.writeText(text).catch(() => { /* the textarea is selectable */ }); };

  return (
    <div className="wj">
      <div className="wj-bar">
        <span className="hud-eyebrow">WIDGET FILE</span>
        <span className="wj-hint">apps/&lt;app&gt;/widgets/{parsed.def?.id || '<id>'}.json</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" className="wj-btn" onClick={copy}>Copy</button>
          <button type="button" className="wj-btn is-primary" disabled={!parsed.def || structural.length > 0}
            title={structural.length ? 'fix the structural problems first' : undefined}
            onClick={() => parsed.def && onLoad(parsed.def)}>Load into the canvas</button>
        </span>
      </div>
      <div className="wj-body">
        <textarea id="widget-json" className="wj-text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="wj-problems" aria-live="polite">
          {parsed.error ? <p className="wj-bad">Not JSON — {parsed.error}</p>
            : problems.length === 0 ? <p className="wj-ok">Both tiers pass: the structure jkAuth checks at publish, and every binding against what its apps declare.</p>
            : (
              <ol>
                {problems.map((p, i) => (
                  <li key={i}>
                    <code>{p.path || '/'}</code> <span className="wj-code">{p.code}</span>
                    <div>{p.message}</div>
                    {p.fix && <div className="wj-fix">↳ {p.fix}</div>}
                  </li>
                ))}
              </ol>
            )}
        </div>
      </div>
    </div>
  );
}
