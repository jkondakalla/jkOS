#!/usr/bin/env node
// pnpm widget — build, check and LOOK AT an ORDECK widget.
//
//   pnpm widget list                          every widget the suite ships, and where it lives
//   pnpm widget check [<id|file> …]           validate (all shipped widgets when none named)
//   pnpm widget shot <id|file> … [options]    draw it — every tier × state — and write PNGs
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
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { shippedWidgets, suiteHosts, declarations, WIDGETS_URL, SEMANTIC_URL } from './widget/catalog.mjs';
import { renderWidgets } from './widget/render.mjs';

const { validateWidget: validate } = await import(WIDGETS_URL);
const { checkBindings } = await import(SEMANTIC_URL);
const CTX = { suiteHosts: suiteHosts() };
const DECLS = await declarations();
/* Both tiers: the structure jkAuth checks at publish, then every binding, source and
   command against what its app declares (and ORDECK's slices). */
const validateWidget = (def) => {
  const structural = validate(def, CTX);
  return structural.length ? structural : checkBindings(def, DECLS);
};
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

if (cmd === 'list') {
  for (const w of await shippedWidgets()) console.log(`${(w.def?.id ?? '?').padEnd(22)} ${w.where}${w.fixtures ? '  (+ fixtures)' : ''}`);
} else if (cmd === 'check') {
  let bad = 0;
  for (const w of await resolveWidgets(names)) {
    if (!w.def) { console.log(`✗ ${w.where}: not JSON — ${w.error}`); bad++; continue; }
    const problems = validateWidget(w.def);
    if (problems.length) { bad++; console.log(`✗ ${w.where}`); for (const p of problems) console.log(fmt(p)); }
    else console.log(`✓ ${w.where}`);
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === 'shot') {
  if (!names.length) { console.error('name at least one widget: pnpm widget shot <id|file> …'); process.exit(2); }
  const widgets = await resolveWidgets(names);
  for (const w of widgets) {
    const problems = validateWidget(w.def);
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
