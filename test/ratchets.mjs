// Ratchets — two counts the widget rescope (TODO §6) drives to zero, pinned so they only
// go down.
//
//   node test/ratchets.mjs            (wired in as check:ratchets)
//   node test/ratchets.mjs --update   lower the pins to today's counts — it refuses to
//                                     raise one; a raise is a hand edit to the baseline,
//                                     where a reviewer sees it
//
// 1. INLINE STYLES. Every `style=` in a .tsx file of apps/*/src or packages/*/src that is
//    not `style={vars({…})}` — the one inline style the suite allows: custom properties
//    carrying what DATA decides (a tone, a gap). Every look is a class.
// 2. HAND-BUILT UI. Every JSX element in apps/*/src. Screens are widgets now (JSON files
//    drawn by @jkos/widget-render); an app's own JSX shrinks to its entry, its router and
//    its providers. Those three are counted and pinned like any file — BeigeBoard's
//    App.tsx is a router and 600 lines of screen — but reported apart, as what may remain.
//
// Counted from the TypeScript AST, never a regex: `useState<string>` is no tag, and a
// `style` inside a string or a comment is no attribute.
//
// Each file's count may not rise above its pin, and a file with no pin pins at 0. A count
// that FELL fails too, until the pin is lowered (--update): a pin that trails reality would
// let a later change grow back into the slack unseen.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from './lib/unit.mjs';

const ts = createRequire(join(REPO_ROOT, 'package.json'))('typescript');
const BASELINE = join(REPO_ROOT, 'test/ratchets.baseline.json');
const UPDATE = process.argv.includes('--update');

/** Every .tsx under each `<group>/<name>/src`. */
function tsxFiles(group) {
  const out = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); } else if (n.endsWith('.tsx')) out.push(p);
    }
  };
  for (const name of readdirSync(join(REPO_ROOT, group))) {
    const src = join(REPO_ROOT, group, name, 'src');
    if (existsSync(src)) walk(src);
  }
  return out.map((p) => relative(REPO_ROOT, p)).sort();
}

/** { style, jsx } for one file: inline styles that are not vars(), and JSX elements. */
function count(rel) {
  const sf = ts.createSourceFile(rel, readFileSync(join(REPO_ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let style = 0, jsx = 0;
  const visit = (n) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) jsx++;
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'style') {
      const e = n.initializer && ts.isJsxExpression(n.initializer) ? n.initializer.expression : null;
      const isVars = e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'vars';
      if (!isVars) style++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { style, jsx };
}

/** What may keep JSX when the rescope is done: an app's entry, its router, its providers. */
const mayRemain = (rel) => /\/src\/(main|App)\.tsx$/.test(rel) || /Provider\.tsx$/.test(rel);

const now = { style: {}, jsx: {} };
for (const rel of [...tsxFiles('apps'), ...tsxFiles('packages')]) {
  const c = count(rel);
  if (c.style) now.style[rel] = c.style;
  if (rel.startsWith('apps/') && c.jsx) now.jsx[rel] = c.jsx;
}

const pinned = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { style: {}, jsx: {} };
const sum = (o, f = () => true) => Object.entries(o).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0);

if (UPDATE) {
  const raised = [];
  // The first pin is today's count; after that a pin only comes down.
  if (existsSync(BASELINE)) for (const kind of ['style', 'jsx']) {
    for (const [rel, n] of Object.entries(now[kind])) if (n > (pinned[kind]?.[rel] ?? 0)) raised.push(`${kind} ${rel}: ${pinned[kind]?.[rel] ?? 0} → ${n}`);
  }
  if (raised.length) {
    console.error(`✗ --update only lowers pins. These rose — undo the growth, or raise the pin by hand in ${relative(REPO_ROOT, BASELINE)} where review sees it:\n  ${raised.join('\n  ')}`);
    process.exit(1);
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify({ style: sorted(now.style), jsx: sorted(now.jsx) }, null, 2)}\n`);
  console.log(`pinned: ${sum(now.style)} inline styles, ${sum(now.jsx)} JSX elements`);
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

for (const [kind, what] of [['style', 'inline styles (not vars())'], ['jsx', 'JSX elements']]) {
  const rose = [], fell = [];
  const files = new Set([...Object.keys(now[kind]), ...Object.keys(pinned[kind] ?? {})]);
  for (const rel of files) {
    const n = now[kind][rel] ?? 0, p = pinned[kind]?.[rel] ?? 0;
    if (n > p) rose.push(`${rel}: ${p} → ${n}`);
    else if (n < p) fell.push(`${rel}: ${p} → ${n}`);
  }
  ok(!rose.length, `no file gained ${what}${rose.length ? ` — ${rose.join('; ')} (draw it with a widget${kind === 'style' ? ', a class, or vars()' : ''})` : ''}`);
  ok(!fell.length, `every ${kind} pin is exact${fell.length ? ` — fewer now, lower the pins: node test/ratchets.mjs --update (${fell.join('; ')})` : ''}`);
}

const byApp = (o) => Object.entries(o).reduce((a, [rel, n]) => { const k = rel.split('/').slice(0, 2).join('/'); a[k] = (a[k] ?? 0) + n; return a; }, {});
console.log(`\n  inline styles: ${sum(now.style)} — ${Object.entries(byApp(now.style)).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`  JSX in apps: ${sum(now.jsx, (k) => !mayRemain(k))} to go, + ${sum(now.jsx, mayRemain)} in entries, routers and providers — ${Object.entries(byApp(now.jsx)).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`\nratchets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
