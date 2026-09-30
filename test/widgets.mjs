// Widget factory conformance — the vocabulary, and what a widget may make the browser
// do, held in code. The validator's own behaviour is the @jkos/widgets package test;
// this gate holds everything that must AGREE with it across the suite.
//
//   1. GENERATED FILES ARE FRESH. ORDECK's `WidgetNode` union (hud/nodes.gen.ts) is
//      projected from packages/widgets/src/manifest.js. Stale means the renderer is
//      type-checked against a vocabulary the validator no longer speaks.
//   2. EVERY WIDGET THE SUITE SHIPS IS VALID. Every widget file (apps/*/widgets/*.json,
//      ORDECK's own cards included) passes the validator jkAuth holds a publish to — so
//      "committed" and "publishable" cannot disagree — AND its second tier: every
//      binding, source and command against what its app declares and ORDECK's slices.
//   3. THE WORKSHOP EDITS LOSSLESSLY. The real workshop/model.ts, whose tree shape is
//      now derived from the manifest, round-trips every shipped body byte-for-byte:
//      what you open in the canvas is what you publish.
//   4. ONE WALKER. The three hand-rolled binding walkers (the renderer's collectSrcs,
//      the tray's scanSrcs, the HUD doc's bindsSlice) are @jkos/widgets' sourcesOf now;
//      a regrown one is the regression.
//   5. HREFS. `link.href`, `frame.href` and Focus's deeplink resolve from live data,
//      and React 18 renders `javascript:` with only a dev-mode warning. Every dynamic
//      href in the widget renderer passes through safeHref (whose behaviour the
//      package test pins).
//   6. SOURCES SAY WHAT HAPPENED. weave's readDataset (the REAL module, transpiled over
//      stubbed network) maps every way a read can go to a named state — never the bare
//      `[]` that made "signed out" and "no rows" one value — and ORDECK's source runtime
//      refuses a relative, plain-http or suite URL before it is ever requested.
//   9. ONE STYLESHEET. The renderer writes no inline visual style: every look is a class
//      in hud/widgets.css, and the only `style=` it may write is vars({...}) — custom
//      properties carrying what a node's DATA decides (a gap, a tone's colour, a size).
//  10. THE WORKSHOP IS DERIVED. Its Inspector is each node's manifest props through one
//      editor per prop type (no per-kind block can regrow), its JSON tab runs both tiers,
//      and its gallery draws every widget in every state with the preview's own reader.
//   8. THE AI KILL SWITCH IS ENFORCED WHERE A WIDGET RENDERS, not only on the shelf: a
//      placed widget that binds an AI app draws the off tile, reading and running nothing.
//   7. AN ASYNC COMMAND IS FOLLOWED TO ITS ANSWER. weave's followJob (the REAL module)
//      reads the app's common-shape jobs dataset until the job ends, hands back what it
//      RESOLVED to, re-reads when the bus fires, and gives up as `lost`, never spinning.
//  11. EVERY DRAFT PASSES. `pnpm widget new` over every declared dataset, in every
//      pattern, and over every list inside one, writes only widgets both tiers accept.
//
// Run:  node test/widgets.mjs      (wired as `pnpm check:widgets`, folded into
//                                   `pnpm test:contracts`)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unit, REPO_ROOT } from './lib/unit.mjs';
import { shippedWidgets, suiteHosts, appDocs, declarations, WIDGETS_URL as WIDGETS, SEMANTIC_URL } from '../scripts/widget/catalog.mjs';

const { check, importTs, done } = unit('widgets');
const { validateWidget } = await import(WIDGETS);
const { checkBindings } = await import(SEMANTIC_URL);
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const fmt = (errs) => errs.map((e) => `${e.path} ${e.code}${e.fix ? ` (${e.fix})` : ''}`).join('; ');

// ── 1. generated files are fresh ────────────────────────────────────────────
try {
  execFileSync(process.execPath, [join(REPO_ROOT, 'packages/widgets/scripts/gen.mjs'), '--check'], { stdio: 'pipe' });
  check(true, 'files generated from the manifest are fresh');
} catch (e) {
  check(false, `files generated from the manifest are stale — run \`pnpm widgets:gen\`\n${e.stdout}${e.stderr}`);
}

// ── 2. every widget the suite ships is valid ────────────────────────────────
// Every widget file, ORDECK's own cards included — read by scripts/widget/catalog.mjs,
// the same list the CLI and render gate use.
const shipped = await shippedWidgets();
check(shipped.filter((w) => w.app === 'ordeck').length >= 9, `ORDECK's own cards are widget files too (${shipped.filter((w) => w.app === 'ordeck').length} in apps/ordeck/widgets)`);
for (const w of shipped) {
  if (!w.def) { check(false, `${w.where} is JSON — ${w.error}`); continue; }
  if (w.file) check(w.def.id === w.where.split('/').pop().replace(/\.json$/, ''), `${w.where}: the file is named for its widget id`);
}
// A file is compiled into ORDECK's bundle and reaches every HUD. `allowed_roles` is
// enforced only on PUBLISHED defs (jkAuth's GET /auth/widgets filters by role) — in a
// file it would be a role gate nothing enforces, and a card in a public bundle cannot be
// hidden from anyone anyway. Gate the DATA (the dataset's scopes); the card follows.
{
  const gated = shipped.filter((w) => w.def?.allowed_roles !== undefined).map((w) => w.where);
  check(gated.length === 0, `no widget file claims allowed_roles — only a published def is role-filtered${gated.length ? ` — ${gated.join(', ')}` : ''}`);
}
const CTX = { suiteHosts: suiteHosts() };
const DECLS = await declarations();
for (const { where, def } of shipped.filter((w) => w.def)) {
  const errs = validateWidget(def, CTX);
  check(errs.length === 0, `${where} is a valid widget${errs.length ? ` — ${fmt(errs)}` : ''}`);
  // The second tier: every binding, source and command against what its app declares
  // (and ORDECK's typed slice declaration) — a field nobody declares draws an empty string.
  const t2 = errs.length ? [] : checkBindings(def, DECLS);
  check(t2.length === 0, `${where} binds only what its apps declare${t2.length ? ` — ${fmt(t2)}` : ''}`);
}

// A widget's fixtures are what its preview draws; for a dataset source they must be
// what that dataset DECLARES it answers, or the preview shows rows the app never sends.
{
  const { checkDatasetAnswer } = await import(new URL('../packages/weave/src/shared/datasetShape.js', import.meta.url).href);
  const docs = appDocs();
  for (const w of shipped.filter((x) => x.def && x.fixtures)) {
    for (const [state, byName] of Object.entries(w.fixtures)) {
      for (const [name, value] of Object.entries(byName ?? {})) {
        const s = w.def.spec?.sources?.[name];
        if (!s) { check(false, `${w.where}: fixtures.${state}.${name} names no source of the widget`); continue; }
        if (s.kind !== 'dataset') continue;
        const ds = docs[s.app]?.datasets?.datasets?.find((d) => d.id === s.dataset);
        if (!ds) { check(false, `${w.where}: source '${name}' reads ${s.app}.${s.dataset}, which ${s.app} does not declare`); continue; }
        const problems = checkDatasetAnswer(ds, value);
        check(problems.length === 0, `${w.where}: fixtures.${state}.${name} is what ${s.app}.${s.dataset} declares it answers${problems.length ? ` — ${problems.join('; ')}` : ''}`);
      }
    }
  }
}

// ── 3. the Workshop edits losslessly ────────────────────────────────────────
const model = await importTs('apps/ordeck/src/workshop/model.ts', 'model.mjs', { '@jkos/widgets': WIDGETS });
for (const { where, def } of shipped.filter((w) => w.def)) {
  if (!def.spec) continue;
  const back = model.enToNode(model.nodeToEn(def.spec.body));
  check(JSON.stringify(back) === JSON.stringify(def.spec.body), `${where} round-trips through the Workshop tree byte-for-byte`);
}

// ── 4. one walker ────────────────────────────────────────────────────────────
for (const rel of ['packages/widget-render/src/render.tsx', 'apps/ordeck/src/hud/state.ts', 'apps/ordeck/src/hud/WidgetTray.tsx']) {
  const src = read(rel);
  check(/\bsourcesOf\b/.test(src) && /from '@jkos\/widgets'/.test(src), `${rel} asks @jkos/widgets' sourcesOf which slices a widget binds`);
  const regrown = ['collectSrcs', 'scanSrcs', 'bindsSlice'].filter((n) => new RegExp(`function ${n}\\b`).test(src));
  check(regrown.length === 0, `${rel} does not regrow a binding walker${regrown.length ? ` (${regrown.join(', ')})` : ''}`);
}

// ── 5. every dynamic href a widget draws goes through safeHref ──────────────
// The renderer's, and every host's kinds (ORDECK's molecules in hud/).
for (const dir of ['packages/widget-render/src', 'apps/ordeck/src/hud']) {
  for (const f of readdirSync(join(REPO_ROOT, dir)).filter((n) => n.endsWith('.tsx'))) {
    const src = readFileSync(join(REPO_ROOT, dir, f), 'utf8');
    for (const [, expr] of src.matchAll(/href=\{([^}]*)\}/g)) {
      const ok = /^\s*safeHref\(/.test(expr) || /^\s*href\s*$/.test(expr) && /const href = [^;]*safeHref\(/.test(src);
      check(ok, `${dir}/${f}: href={${expr.trim()}} passes through safeHref`);
    }
  }
}

// ── 6. sources say what happened ────────────────────────────────────────────
{
  const { tmp, emitTs } = unit('widget-sources');
  const { writeFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const SHAPE = pathToFileURL(join(REPO_ROOT, 'packages/weave/src/shared/datasetShape.js')).href;
  // Stubs: the network is whatever the case says; discovery answers one app's doc.
  writeFileSync(join(tmp, 'net.mjs'), `
    export const net = { answer: null, doc: null, hasPath: true };
    export const authFetch = async (url) => { net.url = url; if (net.answer instanceof Error) throw net.answer; return net.answer; };
    export const apiBase = (id) => '/api/' + id;
    export const suiteApp = (id) => (net.hasPath ? { id, datasetsPath: '/api/' + id + '/datasets' } : { id });
    export const fetchDatasets = async () => net.doc;
    export const getDataset = (doc, id) => doc?.datasets.find((d) => d.id === id) ?? null;
  `);
  const net = (await import(pathToFileURL(join(tmp, 'net.mjs')).href)).net;
  const rd = await import(pathToFileURL(emitTs('packages/weave/src/readDataset.ts', 'readDataset.mjs', {
    '@jkos/auth-client': './net.mjs', './manifest': './net.mjs', './fetchDatasets': './net.mjs', './shared/datasetShape.js': SHAPE,
  })).href);
  const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => (body instanceof Error ? Promise.reject(body) : body) });
  net.doc = { app: 'x', version: 1, datasets: [
    { id: 'jobs', path: '/jobs', filters: [{ name: 'job_id' }, { name: 'status' }] },
    { id: 'one', path: '/things/:id', cardinality: 'one' },
  ] };
  const cases = [
    ['a list with rows is ready', 'jobs', {}, resp(200, [{ id: 1 }]), 'ready'],
    ['a list with none is EMPTY (not ready, not a failure)', 'jobs', {}, resp(200, []), 'empty'],
    ['401 is signed-out', 'jobs', {}, resp(401, {}), 'signed-out'],
    ['403 is forbidden', 'jobs', {}, resp(403, {}), 'forbidden'],
    ['a 5xx is offline', 'jobs', {}, resp(503, {}), 'offline'],
    ['a network error is offline', 'jobs', {}, new Error('ECONNREFUSED'), 'offline'],
    ['a list declared and an object answered is unavailable — the declaration lies', 'jobs', {}, resp(200, { jobs: [] }), 'unavailable'],
    ['non-JSON is unavailable', 'jobs', {}, resp(200, new Error('bad json')), 'unavailable'],
    ['one document is ready', 'one', { id: 3 }, resp(200, { a: 1 }), 'ready'],
    ['one document that is null is empty', 'one', { id: 3 }, resp(200, null), 'empty'],
    ['one document declared and a list answered is unavailable', 'one', { id: 3 }, resp(200, []), 'unavailable'],
    ['a path parameter with no value is idle — nothing is asked', 'one', {}, resp(200, { a: 1 }), 'idle'],
    ['a dataset the app does not declare is unavailable', 'ghost', {}, resp(200, []), 'unavailable'],
  ];
  for (const [msg, id, params, answer, want] of cases) {
    net.answer = answer; net.url = null;
    const r = await rd.readDataset('x', id, params);
    check(r.state === want, `readDataset: ${msg} (got ${r.state}${r.error ? ` — ${r.error}` : ''})`);
    if (want === 'idle') check(net.url === null, 'readDataset: …and an idle read sends no request');
  }
  net.doc = null;
  check((await rd.readDataset('x', 'jobs')).state === 'offline', 'readDataset: an app whose declarations cannot be read is offline');
  net.hasPath = false;
  check((await rd.readDataset('x', 'jobs')).state === 'unavailable', 'readDataset: an app that declares no datasets is unavailable');
  const jobs = { id: 'jobs', path: '/jobs', filters: [{ name: 'job_id' }, { name: 'status' }] };
  check(rd.datasetUrl(jobs, { job_id: 'a b', typo_id: 1, status: '' }) === '/jobs?job_id=a+b', 'datasetUrl: declared filters only, empty ones dropped (an undeclared one would hide a typo)');
  check(rd.datasetUrl({ id: 'r', path: '/routines/:id/series', filters: [{ name: 'weeks' }] }, { id: '7/x', weeks: 4 }) === '/routines/7%2Fx/series?weeks=4', 'datasetUrl: a path parameter is filled and encoded, not repeated as a query');

  // ORDECK's runtime: the refusal, before any request.
  writeFileSync(join(tmp, 'react.mjs'), 'export const createContext = (v) => ({ Provider: null, v }); export const useContext = () => null; export const useEffect = () => {}; export const useMemo = (f) => f(); export const useState = (v) => [v, () => {}];');
  writeFileSync(join(tmp, 'weave.mjs'), `
    import { resolveBinding } from ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/weave/src/shared/binding.js')).href)};
    export { resolveBinding };
    export const reads = [];
    export const readDataset = async (app, dataset, params) => { reads.push({ app, dataset, params }); return { state: 'ready', data: [], def: { invalidates: ['lazuros.jobs'] } }; };
    export const subscribe = () => () => {};
    export const suiteApps = () => ({ beigeboard: { origin: 'https://beigeboard.jkos.net' }, ordeck: { origin: 'https://jkos.net' } });
  `);
  const src = await import(pathToFileURL(emitTs('packages/widget-render/src/sources.ts', 'sources.mjs', { react: './react.mjs', '@jkos/weave': './weave.mjs' })).href);
  const weaveStub = await import(pathToFileURL(join(tmp, 'weave.mjs')).href);
  const ORIGINS = ['https://jkos.net', 'https://beigeboard.jkos.net'];
  check(src.refusedUrl('/api/lazuros/jobs', ORIGINS) !== null, 'refusedUrl: a relative URL (this origin) is refused');
  check(src.refusedUrl('http://api.example.com/x', ORIGINS) !== null, 'refusedUrl: plain http is refused');
  check(/part of this suite/.test(src.refusedUrl('https://beigeboard.jkos.net/api/items', ORIGINS) ?? ''), 'refusedUrl: a suite subdomain is refused');
  check(/part of this suite/.test(src.refusedUrl('https://kouros.jkos.net/api/tracks', ORIGINS) ?? ''), 'refusedUrl: …and any other subdomain of the suite domain');
  check(src.refusedUrl('https://api.open-meteo.com/v1/forecast', ORIGINS) === null, 'refusedUrl: an external public https URL may be fetched');
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return resp(200, []); };
  const refused = await src.liveReader('items', { kind: 'fetch', url: 'https://beigeboard.jkos.net/api/items' }, {});
  check(refused.state === 'refused' && fetched === 0, 'liveReader: a suite fetch is REFUSED and never requested');
  const viaDecl = await src.liveReader('jobs', { kind: 'dataset', app: 'lazuros', dataset: 'jobs' }, { job_id: 'j1' });
  check(weaveStub.reads.at(-1)?.dataset === 'jobs' && weaveStub.reads.at(-1)?.params.job_id === 'j1' && viaDecl.invalidates?.[0] === 'lazuros.jobs',
    "liveReader: a dataset is read through its declaration, and hands back the dataset's invalidation keys to subscribe");
  check(JSON.stringify(src.resolveParams({ job_id: { src: '$result', path: 'job_id' }, status: 'DONE', gone: { src: 'x' } }, { $result: { job_id: 'j9' } }))
    === JSON.stringify({ job_id: 'j9', status: 'DONE', gone: null }), 'resolveParams: bindings resolve against the scope; a missing one is null (the read goes idle)');

  // The frame's state: what a card shows instead of its body. The ORDER is the contract.
  const TWO = { a: { kind: 'dataset', app: 'lazuros', dataset: 'jobs' }, b: { kind: 'dataset', app: 'kouros', dataset: 'tracks' } };
  const cs = (a, b, data = {}) => src.cardState(TWO, { a: { state: a }, b: { state: b } }, data).kind;
  check(src.cardState(undefined, {}, {}).kind === 'ready', 'cardState: a widget with no sources is ready (its slices carry their own flags)');
  check(cs('signed-out', 'ready', { b: [1] }) === 'signed-out', 'cardState: signed-out wins over data — nothing else can be read until they sign in');
  check(cs('forbidden', 'loading') === 'forbidden', 'cardState: forbidden, with nothing to show');
  check(cs('unavailable', 'ready', { b: [1] }) === 'unavailable' && cs('refused', 'ready', { b: [1] }) === 'unavailable', 'cardState: an undeclared or refused source is unavailable');
  check(src.cardState(TWO, { a: { state: 'offline' }, b: { state: 'loading' } }, {}).app === 'lazuros', 'cardState: a down source with no data names its app');
  check(cs('loading', 'ready', { b: [1] }) === 'loading', 'cardState: loading while any source has no first answer');
  check(cs('empty', 'empty', { a: [], b: [] }) === 'empty' && cs('empty', 'ready', { a: [], b: [1] }) === 'ready', 'cardState: empty only when EVERY source answered nothing');
  const stale = src.cardState(TWO, { a: { state: 'offline' }, b: { state: 'ready' } }, { a: [1], b: [1] });
  check(stale.kind === 'ready' && stale.stale?.app === 'lazuros', 'cardState: a source that had data and then went offline keeps it, marked stale');
  check(cs('idle', 'ready', { b: [1] }) === 'ready', "cardState: an idle source (a parameter not known yet) is the body's business");
}

// ── 7. an async command is followed to its answer ───────────────────────────
{
  const { tmp, emitTs } = unit('follow-job');
  const { writeFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  writeFileSync(join(tmp, 'stubs.mjs'), `
    export const st = { rows: [], reads: 0, doc: null, subs: [] };
    export const fetchDatasets = async () => st.doc;
    export const readDataset = async (app, id, params) => { st.reads++; st.last = { app, id, params };
      const next = st.rows.length > 1 ? st.rows.shift() : st.rows[0];
      return typeof next === 'string' ? { state: next, error: next } : { state: next ? 'ready' : 'empty', data: next ? [next] : [] }; };
    export const subscribe = (keys, fn) => { st.subs.push({ keys, fn }); return () => { st.subs = st.subs.filter((x) => x.fn !== fn); }; };
  `);
  const st = (await import(pathToFileURL(join(tmp, 'stubs.mjs')).href)).st;
  const fj = await import(pathToFileURL(emitTs('packages/weave/src/followJob.ts', 'followJob.mjs', {
    './fetchDatasets': './stubs.mjs', './readDataset': './stubs.mjs', './resource': './stubs.mjs',
    './shared/jobs.js': pathToFileURL(join(REPO_ROOT, 'packages/weave/src/shared/jobs.js')).href,
  })).href);
  const FAST = { intervalMs: 5, maxIntervalMs: 10, timeoutMs: 2000 };
  st.doc = { datasets: [{ id: 'jobs', shape: 'jobs', invalidates: ['lazuros.jobs'] }] };
  const J = (status, extra = {}) => ({ id: 'j1', status, result: null, error: null, ...extra });

  st.rows = [J('PENDING'), J('IN_PROGRESS'), J('DONE', { result: { response: '42' } })];
  const seen = [];
  const done = await fj.followJob('lazuros', 'j1', { ...FAST, onUpdate: (o) => seen.push(o.status) });
  check(done.phase === 'done' && JSON.stringify(done.result) === '{"response":"42"}', 'followJob: a DONE job hands back what it RESOLVED to');
  check(st.last.id === 'jobs' && st.last.params.job_id === 'j1', 'followJob: the job is looked up by job_id in the dataset declaring shape: jobs');
  check(JSON.stringify(seen) === JSON.stringify(['PENDING', 'IN_PROGRESS', 'DONE']), 'followJob: every reading is reported, with the app\'s own status word');

  st.rows = [J('FAILED', { error: 'the model answered no JSON' })];
  const failed = await fj.followJob('lazuros', 'j1', FAST);
  check(failed.phase === 'failed' && failed.error === 'the model answered no JSON', 'followJob: a FAILED job hands back its error');

  st.rows = [J('PENDING')];
  const lost = await fj.followJob('lazuros', 'j1', { ...FAST, timeoutMs: 40 });
  check(lost.phase === 'lost' && /stopped waiting/.test(lost.error), 'followJob: a job that never ends is given up on as lost, not followed for ever');

  st.rows = ['signed-out'];
  check((await fj.followJob('lazuros', 'j1', FAST)).phase === 'lost', 'followJob: signed out ends the follow');
  st.rows = [null];
  check((await fj.followJob('lazuros', 'j1', FAST)).phase === 'lost', 'followJob: a job the app does not have is lost, not pending');

  st.rows = ['offline', J('DONE', { result: { response: 'ok' } })];
  check((await fj.followJob('lazuros', 'j1', FAST)).phase === 'done', 'followJob: a transient offline read is waited out');

  st.doc = { datasets: [{ id: 'jobs' }] };
  check(/declares no jobs dataset/.test((await fj.followJob('lazuros', 'j1', FAST)).error ?? ''), 'followJob: an app with no common-shape jobs dataset cannot be followed, and says so');

  st.doc = { datasets: [{ id: 'jobs', shape: 'jobs', invalidates: ['lazuros.jobs'] }] };
  st.rows = [J('PENDING'), J('DONE', { result: {} })]; st.reads = 0;
  const slow = { intervalMs: 60_000, maxIntervalMs: 60_000, timeoutMs: 120_000 };
  const woke = fj.followJob('lazuros', 'j1', slow);
  await new Promise((r) => setTimeout(r, 20));
  check(st.subs.some((x) => x.keys.includes('lazuros.jobs')), 'followJob: it subscribes to the jobs dataset\'s bus keys');
  st.subs.forEach((x) => x.fn());
  const t0 = Date.now();
  check((await woke).phase === 'done' && Date.now() - t0 < 1000, 'followJob: an invalidation re-reads at once, not at the next interval');
  check(st.subs.length === 0, 'followJob: …and unsubscribes when it ends');
}

// ── 8. the AI kill switch is enforced where a widget renders ────────────────
{
  const reg = read('packages/widget-render/src/render.tsx');
  const body = reg.match(/function renderWidgetBody\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const first = body.trim().split('\n')[0];
  check(/if \(!host\.aiEnabled && usesAi\(def\)\) return aiOffTile\(def\);/.test(first),
    `renderWidgetBody's first act is the kill switch — before any source is read or command armed (got: ${first.trim()})`);
  check(!/\bw\.ai\b|\bdef\.ai\b/.test(read('apps/ordeck/src/pages/hud/RoomHUD.tsx') + read('apps/ordeck/src/hud/WidgetTray.tsx') + reg),
    'nothing in ORDECK reads a hand-set `ai` flag — AI-backed is usesAi(def), derived from the apps it binds');
  const ai = await importTs('packages/widget-render/src/ai.ts', 'ai.mjs', {
    '@jkos/weave': `data:text/javascript,${encodeURIComponent("export const suiteApp = (id) => ({ lazuros: { ai: true }, beigeboard: {} })[id];")}`,
    '@jkos/widgets': WIDGETS,
  });
  const lz = { id: 'l', label: 'L', sizing: {}, spec: { body: { t: 'button', text: 'GO', cmd: { app: 'lazuros', capability: 'query' } } } };
  const bb = { id: 'b', label: 'B', sizing: {}, spec: { body: { t: 'button', text: 'GO', cmd: { app: 'beigeboard', capability: 'createItem' } } } };
  check(ai.usesAi(lz) && !ai.usesAi(bb), 'usesAi: a widget whose command reaches LazurOS is AI-backed; one reaching only BeigeBoard is not');
}

// ── 9. one stylesheet ───────────────────────────────────────────────────────
// Every file that draws part of a widget: the renderer's, and ORDECK's host kinds.
{
  const reg = read('packages/widget-render/src/render.tsx');
  for (const rel of ['packages/widget-render/src/render.tsx', 'packages/widget-render/src/boundary.tsx', 'apps/ordeck/src/hud/host.tsx']) {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const inline = [...code.matchAll(/\bstyle=\{(?!vars\()[^\n]{0,60}/g)].map((m) => m[0]);
    check(inline.length === 0, `${rel} writes no inline style but vars({...})${inline.length ? ` — ${inline.slice(0, 4).join(' | ')}` : ''}`);
    const setsVars = [...code.matchAll(/vars\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    const notVar = setsVars.filter((body) => /(^|,)\s*[a-zA-Z]+\s*:/.test(body));
    check(notVar.length === 0, `${rel}: vars() sets only custom properties (--w-*)${notVar.length ? ` — ${notVar[0]}` : ''}`);
  }
  check(/import '\.\/widgets\.css';/.test(reg), 'the renderer imports widgets.css, so a widget carries its styles wherever it draws');
}

// ── 10. the Workshop is derived from the manifest ───────────────────────────
{
  const insp = read('apps/ordeck/src/workshop/Inspector.tsx');
  const perKind = [...insp.matchAll(/\bn\.t === '([a-z]+)'/g)].map((m) => m[1]);
  check(perKind.every((t) => t === 'form'), `the Inspector edits every node from its manifest props — no per-kind branch regrows${perKind.length ? ` (found ${perKind.join(', ')})` : ''}`);
  check(/Object\.entries\(NODES\[n\.t\]\?\.props/.test(insp), "the Inspector's panel is the node's manifest props, in order");
  const ws = read('apps/ordeck/src/pages/WidgetWorkshop.tsx');
  check(/<JsonTab\b/.test(ws) && /<Gallery\b/.test(ws), 'the Workshop has the JSON tab (both tiers, live) and the gallery (every widget, every state)');
  const json = read('apps/ordeck/src/workshop/JsonTab.tsx');
  check(/validateWidget\(/.test(json) && /checkBindings\(/.test(json), 'the JSON tab runs BOTH validation tiers');
  check(/fixtureReader\(/.test(read('apps/ordeck/src/workshop/Gallery.tsx')) && /fixtureReader\(/.test(read('apps/ordeck/preview/main.tsx')),
    'the gallery and the preview harness draw a state with the SAME reader (hud/sample.ts fixtureReader)');
}

// ── 11. every draft `pnpm widget new` makes passes both tiers ───────────────
// The scaffolder promises a draft that passes; a validator rule it does not know about
// breaks `widget new` for every agent while every shipped file stays green (silent-empty
// did, 2026-09-29). So draft every declared dataset in every pattern, and every list
// inside a one-document dataset in each list pattern. A draft may REFUSE (nothing to title
// a row with, no number for a stat); what it writes may never be invalid.
{
  const { draftWidget, DRAFT_PATTERNS } = await import(new URL('../scripts/widget/scaffold.mjs', import.meta.url).href);
  const patterns = [...DRAFT_PATTERNS.many, ...DRAFT_PATTERNS.one];
  let drafted = 0;
  for (const [app, decl] of Object.entries(DECLS.docs)) {
    for (const ds of decl.datasets?.datasets ?? []) {
      if (!Array.isArray(ds.item)) continue;
      const needed = [...[...ds.path.matchAll(/:(\w+)/g)].map((m) => m[1]), ...(ds.filters ?? []).filter((f) => f.required).map((f) => f.name)];
      const params = needed.length ? Object.fromEntries(needed.map((k) => [k, 1])) : undefined;
      const lists = ds.item.filter((f) => f.type === 'json' && Array.isArray(f.item)).map((f) => f.name);
      const tries = [
        ...patterns.map((pattern) => ({ pattern })),
        ...lists.flatMap((from) => DRAFT_PATTERNS.many.map((pattern) => ({ pattern, from }))),
      ];
      for (const t of tries) {
        const d = draftWidget({ app, id: `${app}-draft`, dataset: ds.id, params, docs: DECLS.docs, ...t });
        if (d.error) continue;
        drafted++;
        const at = `widget new ${app} --dataset ${ds.id}${t.from ? ` --from ${t.from}` : ''} --pattern ${t.pattern}`;
        const errs = validateWidget(d.def, CTX);
        const t2 = errs.length ? [] : checkBindings(d.def, DECLS);
        if (errs.length || t2.length) check(false, `${at} drafts a widget that fails validation — ${fmt([...errs, ...t2])}`);
      }
    }
  }
  check(drafted >= 20, `every draft \`pnpm widget new\` can make passes both tiers (${drafted} drafted, over every declared dataset and every list inside one)`);
}

done();
