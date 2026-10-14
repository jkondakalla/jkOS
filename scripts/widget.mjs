#!/usr/bin/env node
// pnpm widget — build, check and LOOK AT an ORDECK widget.
//
//   pnpm widget new <app> <id> --dataset <name> [--from <field>] [--pattern P] [--params k=v,…]
//                                             draft a widget over a dataset the app declares
//                                             (P: rows | feed for a list; facts | stat | meter | media for one document;
//                                             --from drafts a list over a list field inside one document;
//                                             --params gives the path parameters and required filters it is read with)
//   pnpm widget new <app> <id> --ask <capability>
//                                             draft an ask over a capability the app declares
//   pnpm widget vocab [<kind> …]               the node vocabulary, read from the manifest: every
//                                             kind, its props, an example (a kind's name: just that one)
//   pnpm widget list                          every widget the suite ships, and where it lives
//   pnpm widget routes [<app>]                each app's pages: route → page widget (derived from the files)
//   pnpm widget check [<id|file> …]           validate (all shipped widgets when none named)
//   pnpm widget shot <id|file> … [options]    draw it — every tier × state — and write PNGs
//   pnpm widget shot --routes <app> [options] draw every page of an app — screen × tier × state × face
//   pnpm widget diff [<id> …] [--against REV] [--out DIR]
//                                             did this change move any widget's pixels? Shoots every
//                                             widget at REV (default HEAD, in a scratch worktree) and
//                                             here; identical sheets are the review page's "proven
//                                             unchanged", differing ones are kept as before/after PNGs
//       --mode paper|dark|both   face(s) to draw (default both)
//       --state ready,empty,…    states to draw (default: ready, empty, offline, signed-out, loading)
//       --out DIR                where the PNGs go (default: $TMPDIR/jkos-widget-shots)
//       --scale N                device pixel ratio (default 1; 2 for a close look)
//
// A widget is a file (apps/<app>/widgets/<id>.json, fixtures in <id>.fixtures.json) or
// one of ORDECK's built-ins, named by id. `shot` renders with the real renderer and
// the HUD's real selectors (apps/ordeck/preview), and prints what it measured per cell:
// a fault tile, a card that outgrew its footprint, text cut off without an ellipsis.
// Then read the PNGs — a widget is not done until it has been looked at in both faces.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { shippedWidgets, suiteHosts, declarations, hosts, secondTierContexts, WIDGETS_URL, SEMANTIC_URL, REPO_ROOT } from './widget/catalog.mjs';
import { renderWidgets } from './widget/render.mjs';
import { draftWidget } from './widget/scaffold.mjs';
import { diffWidgets } from './widget/diff.mjs';

const { validateWidget: validate, NODES, FRAME, SOURCES, ACTIONS, STATE_TYPES, TONES, isPortable, drawableIn, routeTable } = await import(WIDGETS_URL);
const { checkBindings } = await import(SEMANTIC_URL);
const CTX = { suiteHosts: suiteHosts() };
const DECLS = await declarations();
/* Both tiers: the structure jkAuth checks at publish, then every binding, source and
   command against what its app declares and what each host that can draw it declares
   (its slices, its actions, the app's pages) — the gate's check (test/widgets.mjs). */
const validateWidget = async (def, app) => {
  const structural = validate(def, CTX);
  if (structural.length) return structural;
  const seen = new Set();
  const out = [];
  for (const { ctx } of await secondTierContexts(def, app)) {
    for (const p of checkBindings(def, ctx)) {
      const k = `${p.path} ${p.code} ${p.message}`;
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
  }
  return out;
};
/** The app a widget file belongs to: its folder (apps/<app>/widgets/). */
const appOf = (w) => w.app ?? String(w.where).match(/apps\/([^/]+)\/widgets\//)?.[1];
const [cmd, ...rest] = process.argv.slice(2);

const flags = {};
const names = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i];
  else names.push(rest[i]);
}

async function resolveWidgets(list) {
  const shipped = await shippedWidgets();
  if (!list.length) return shipped;
  return list.map((n) => {
    const path = resolve(process.env.INIT_CWD || process.cwd(), n);
    if (n.endsWith('.json') && existsSync(path)) {
      const fx = path.replace(/\.json$/, '.fixtures.json');
      return { where: n, def: JSON.parse(readFileSync(path, 'utf8')), fixtures: existsSync(fx) ? JSON.parse(readFileSync(fx, 'utf8')) : null };
    }
    const hit = shipped.find((w) => w.def?.id === n);
    if (!hit) { console.error(`✗ no widget '${n}' — \`pnpm widget list\` shows what exists`); process.exit(2); }
    return hit;
  });
}

const fmt = (p) => `    ${p.path || '/'}  ${p.code} — ${p.message}${p.fix ? `\n      ↳ ${p.fix}` : ''}`;

if (cmd === 'new') {
  const [app, id] = names;
  if (!app || !id || (!flags.dataset === !flags.ask)) {
    console.error('usage: pnpm widget new <app> <id> --dataset <name> [--pattern P]   |   pnpm widget new <app> <id> --ask <capability>');
    process.exit(2);
  }
  if ((await shippedWidgets()).some((w) => w.def?.id === id)) { console.error(`✗ a widget '${id}' already ships — \`pnpm widget list\``); process.exit(2); }
  const params = typeof flags.params === 'string'
    ? Object.fromEntries(flags.params.split(',').map((kv) => { const [k, ...v] = kv.split('='); const val = v.join('='); return [k.trim(), /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : val]; }))
    : undefined;
  const draft = draftWidget({ app, id, dataset: flags.dataset, from: typeof flags.from === 'string' ? flags.from : undefined, ask: flags.ask, pattern: typeof flags.pattern === 'string' ? flags.pattern : undefined, params, docs: DECLS.docs });
  if (draft.error) { console.error(`✗ ${draft.error}`); process.exit(2); }
  const problems = await validateWidget(draft.def, app);
  if (problems.length) { console.error('✗ the draft does not pass validation — a scaffolder bug:'); for (const p of problems) console.error(fmt(p)); process.exit(1); }
  const dir = join(REPO_ROOT, 'apps', app, 'widgets');
  const file = join(dir, `${id}.json`);
  if (existsSync(file)) { console.error(`✗ ${relative(REPO_ROOT, file)} exists`); process.exit(2); }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(draft.def, null, 2)}\n`);
  console.log(`✓ ${relative(REPO_ROOT, file)} — passes both tiers`);
  if (draft.fixtures) {
    writeFileSync(join(dir, `${id}.fixtures.json`), `${JSON.stringify(draft.fixtures, null, 2)}\n`);
    console.log(`✓ ${relative(REPO_ROOT, join(dir, `${id}.fixtures.json`))}`);
  }
  for (const n of draft.notes) console.log(`  · ${n}`);
  console.log(`\nIt is a draft: choose the fields that matter, write the empty line, size it. Then\n  pnpm widget check ${id}\n  pnpm widget shot ${id}\nand LOOK at both faces. Documentation/agents/WIDGETS.md is the reference.`);
} else if (cmd === 'vocab') {
  const prop = (name, p) => `    ${(name + (p.required ? '*' : '')).padEnd(12)} ${p.type}${p.values ? ` (${p.values.join('|')})` : p.type === 'tone' ? ` (${TONES.join('|')})` : ''}${p.row ? ' · per row, binds into $' : ''}${p.result ? ' · reads $result' : ''}${p.doc ? ` — ${p.doc}` : ''}`;
  const kinds = names.length ? names : Object.keys(NODES);
  for (const t of kinds) {
    const n = NODES[t];
    if (!n) { console.error(`✗ no kind '${t}' — one of: ${Object.keys(NODES).join(', ')}`); process.exit(2); }
    console.log(`\n${t}  [${n.kind}] ${n.label} — ${n.hint ?? ''}`);
    for (const [name, p] of Object.entries(n.props)) console.log(prop(name, p));
    if (n.placement) console.log(`    placement: ${Object.entries(n.placement).map(([k, v]) => (k === 'outside' ? `outside a form with ${v}` : `${k} ${v}`)).join(', ')}`);
    for (const g of n.oneOf ?? []) console.log(`    exactly one of: ${g.join(' | ')}`);
    for (const [ev, doc] of Object.entries(n.events ?? {})) console.log(`    on.${ev} — ${doc}`);
    if (n.example) console.log(`    e.g. ${JSON.stringify(n.example)}`);
  }
  if (!names.length) {
    console.log('\nframe (spec.frame)'); for (const [name, p] of Object.entries(FRAME)) console.log(prop(name, p));
    for (const [kind, s] of Object.entries(SOURCES)) {
      console.log(`\nsource  { "kind": "${kind}" }  ${s.label} — ${s.hint}`);
      for (const [name, p] of Object.entries(s.props)) console.log(prop(name, p));
    }
    console.log(`\nstate (spec.state)  name → { type: ${STATE_TYPES.join('|')}, default? } — read as $state.<name>; written by \`set\` and by a control with \`state\``);
    console.log(`inputs (spec.inputs)  name → { type: ${STATE_TYPES.join('|')}, required?, default? } — read as $in.<name>; handed by a \`use\`'s \`with\``);
    console.log('route (top level)  "/books/:id" — a page; its params are $route.<name>');
    console.log('mobile (spec.mobile)  a whole body the mobile tier draws instead of spec.body — where the phone UI genuinely differs');
    for (const [name, a] of Object.entries(ACTIONS)) {
      console.log(`\naction  { "${name}": … }  ${a.label} — ${a.hint}`);
      for (const [k, p] of Object.entries(a.props)) console.log(prop(k, p));
      console.log(`    e.g. ${JSON.stringify(a.example)}`);
    }
  }
  console.log('\n* required');
} else if (cmd === 'diff') {
  const out = resolve(typeof flags.out === 'string' ? flags.out : join(tmpdir(), 'jkos-widget-diff'));
  const r = diffWidgets({ against: typeof flags.against === 'string' ? flags.against : 'HEAD', ids: names, out });
  console.log(`against ${r.against}: ${r.identical.length} sheet(s) byte-identical, ${r.differ.length} differ`);
  for (const d of r.differ) console.log(`  ≠ ${d}  →  ${out}/${d.replace(' · ', '-')}-{before,after}.png`);
  for (const id of r.added) console.log(`  + ${id} (new — nothing to compare)`);
  for (const id of r.removed) console.log(`  − ${id} (gone)`);
  if (!r.differ.length) console.log('Nothing moved: log it on the review page as proven unchanged.');
  else console.log('Something moved: LOOK at each pair, then put it on the review page.');
} else if (cmd === 'routes') {
  const shipped = (await shippedWidgets()).filter((w) => w.def);
  const apps = names.length ? names : [...new Set(shipped.map((w) => w.app))];
  for (const app of apps) {
    const { routes, problems } = routeTable(shipped.filter((w) => w.app === app).map((w) => w.def));
    console.log(`\n${app}${routes.size ? '' : '  (no pages yet — a page is a widget file with a "route")'}`);
    for (const [route, id] of routes) console.log(`  ${route.padEnd(28)} ${id}`);
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
} else if (cmd === 'list') {
  for (const w of await shippedWidgets()) console.log(`${(w.def?.id ?? '?').padEnd(22)} ${w.where}${w.fixtures ? '  (+ fixtures)' : ''}`);
} else if (cmd === 'check') {
  let bad = 0;
  for (const w of await resolveWidgets(names)) {
    if (!w.def) { console.log(`✗ ${w.where}: not JSON — ${w.error}`); bad++; continue; }
    const problems = await validateWidget(w.def, appOf(w));
    if (problems.length) { bad++; console.log(`✗ ${w.where}`); for (const p of problems) console.log(fmt(p)); continue; }
    // Where it can live — derived from what it binds, never declared.
    const HOSTS = await hosts();
    const homes = Object.entries(HOSTS).filter(([, h]) => drawableIn(w.def, h, DECLS.widgets).length === 0).map(([id]) => id);
    const where = isPortable(w.def, DECLS.widgets) ? 'portable — any host can draw it'
      : homes.length ? `drawn by: ${homes.join(', ')}` : `no host can draw it — ${Object.entries(HOSTS).map(([id, h]) => `${id} lacks ${drawableIn(w.def, h, DECLS.widgets).join(', ')}`).join('; ')}`;
    if (!homes.length) bad++;
    console.log(`${homes.length ? '✓' : '✗'} ${w.where}  (${where})`);
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === 'shot') {
  // --routes <app>: every page of the app, from its route table.
  if (typeof flags.routes === 'string') {
    const pages = (await shippedWidgets()).filter((w) => w.def && w.app === flags.routes && typeof w.def.route === 'string');
    if (!pages.length) { console.error(`✗ ${flags.routes} has no pages yet — a page is a widget file with a "route" (pnpm widget routes)`); process.exit(2); }
    names.push(...pages.map((w) => w.def.id));
  }
  if (!names.length) { console.error('name at least one widget: pnpm widget shot <id|file> …, or --routes <app>'); process.exit(2); }
  const widgets = await resolveWidgets(names);
  for (const w of widgets) {
    const problems = await validateWidget(w.def, appOf(w));
    if (problems.length) { console.log(`✗ ${w.where} is not a valid widget — fix these first:`); for (const p of problems) console.log(fmt(p)); process.exit(1); }
  }
  const modes = flags.mode === 'paper' || flags.mode === 'dark' ? [flags.mode] : ['paper', 'dark'];
  const states = typeof flags.state === 'string' ? flags.state.split(',') : undefined;
  const out = resolve(typeof flags.out === 'string' ? flags.out : join(tmpdir(), 'jkos-widget-shots'));
  const results = await renderWidgets(widgets, { modes, states, shots: true, scale: Number(flags.scale) || 1 });
  if (!results) { console.error('✗ no Chromium found (looked in ~/.cache/ms-playwright, then PATH)'); process.exit(2); }
  mkdirSync(out, { recursive: true });
  let findings = 0;
  for (const r of results) {
    if (r.report.error) { console.log(`✗ ${r.id} (${r.mode}): the preview page failed\n${r.report.error}`); findings++; continue; }
    const file = join(out, `${r.id}-${r.mode}.png`);
    writeFileSync(file, r.png);
    console.log(`\n${r.id} · ${r.mode}  →  ${file}`);
    for (const e of r.report.pageErrors) { console.log(`  ✗ page error: ${e.split('\n')[0]}`); findings++; }
    for (const c of r.report.cells) {
      const notes = [
        c.fault && 'WIDGET FAULT (it threw while rendering)',
        c.overflowX && 'wider than its footprint',
        c.overflowY && 'taller than its footprint (content cut off at the bottom)',
        c.clipped.length && `text cut off without an ellipsis: ${c.clipped.map((t) => JSON.stringify(t)).join(', ')}`,
      ].filter(Boolean);
      if (notes.length) { findings++; console.log(`  ${c.tier.padEnd(8)} ${c.state.padEnd(11)} ${notes.join('; ')}`); }
    }
  }
  console.log(findings ? `\n${findings} finding(s). Now LOOK at the PNGs above, in both faces.` : '\nNothing measured wrong. Now LOOK at the PNGs above, in both faces.');
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(cmd ? 2 : 0);
}
