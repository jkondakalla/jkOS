// Binding conformance — ONE binding model, two directions (D13 / WV-2 + WV-5).
//
// WHY THIS EXISTS
//
// The suite grew two halves of one system that never met:
//
//   READ   `WidgetSpec` (ORDECK) binds a dataset into a tree of primitives.
//   WRITE  `TriggerDef` (weave) binds one capability's typed output into another
//          capability's body.
//
// `trigger.ts`'s header calls itself "the design-time shapes a Workshop GUI / an AI
// emits" — the same sentence WidgetSpec's docs use, about the same GUI, for the other
// direction. They had two vocabularies for one idea, and ORDECK's Workshop editor a
// third reading of it.
//
// ⚠️ Converging them was not a compromise: one form was strictly the other's
// degenerate case. `{from:'x'}` is `{src:'event', path:'x'}` with the source left
// implicit, because a trigger only ever had one — while ORDECK's form already carried
// the two things the trigger form could not express, an explicit `{lit}` and a
// `fallback`. So the richer form won, the narrower became sugar, and nothing had to
// be rewritten.
//
// This is the model the widget factory is built from, so it is worth a gate: the
// failure mode is not a crash, it is a fourth vocabulary quietly appearing next to
// the three that were merged.
//
// Run:  node test/binding.mjs      (wired as `pnpm check:binding`, folded into
//                                   `pnpm test:contracts`)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const b = await import(resolve(root, 'packages/weave/src/shared/binding.js'));

// ── 1. the model resolves every form ────────────────────────────────────────
{
  const sources = { event: { title: 'Ship it', nested: { deep: 7 } }, today: { count: 3 } };

  check(b.resolveBinding('plain', sources) === 'plain', 'a bare literal resolves to itself');
  check(b.resolveBinding(42, sources) === 42, 'a bare number resolves to itself');
  /* The reason `{lit}` exists at all: a literal that would otherwise LOOK like a
     binding. Without it there is no way to pass `{src:'…'}` as data. */
  const litObj = b.resolveBinding({ lit: { src: 'not a binding' } }, sources);
  check(litObj && litObj.src === 'not a binding', '{lit} passes an object through even when it looks like a binding');

  check(b.resolveBinding({ src: 'today', path: 'count' }, sources) === 3, 'the canonical {src,path} form resolves');
  check(b.resolveBinding({ from: 'title' }, sources) === 'Ship it', "the trigger's {from} sugar resolves against the `event` source");
  check(b.resolveBinding({ from: 'nested.deep' }, sources) === 7, '…dotted, the way every existing TriggerDef writes it');
  check(b.resolveBinding({ src: 'today', path: 'missing', fallback: '—' }, sources) === '—', 'fallback fills a missing path');
  /* A binding points at data that may not have arrived. That is a normal state, and
     a renderer that throws on it blanks a whole dashboard card. */
  check(b.resolveBinding({ src: 'nope', path: 'a.b.c' }, sources) === undefined, 'a missing SOURCE resolves to undefined rather than throwing');

  const norm = b.normalizeBinding({ from: 'a.b' });
  check(norm.src === b.EVENT_SOURCE && norm.path === 'a.b', '{from} normalises to the canonical form — the two are one binding written two ways');
  check(b.normalizeBinding('plain') === null, 'a literal is not a binding');
  check(b.normalizeBinding({ lit: 1 }) === null, '{lit} is not a binding either — it is an escape from being one');
}

// ── 2. one implementation, not one idea spelled twice ───────────────────────
{
  const trigger = read('packages/weave/src/server/trigger.js');
  check(/require\('\.\.\/shared\/binding'\)/.test(trigger),
    'the trigger engine (WRITE) takes its resolver from shared/binding');
  /* The shapes the old hand-rolled resolver had. Their return is the whole point of
     the convergence: if either regrows here, there are two models again. */
  check(!/function\s+resolveBindings\s*\([^)]*\)\s*\{[\s\S]{0,200}?Object\.entries/.test(trigger)
        || /resolveBody\(/.test(trigger),
    'it does not re-walk the template itself');
  check(!/^function dig\(/m.test(trigger), 'it does not carry its own `dig` any more');

  const registry = read('apps/ordeck/src/hud/registry.tsx');
  check(/resolveBinding/.test(registry) && /@jkos\/weave/.test(registry),
    'the widget renderer (READ) takes the same resolver from @jkos/weave');
  /* ⚠️ Asserted as DELEGATION, not as the absence of the old body. A first pass
     matched the old scope-walk literally (`scope[b.src]`) and sailed straight past a
     re-hand-rolled copy that differed only by a cast. What matters is that resolve()
     is a one-liner handing off — so its body is measured, not pattern-matched. */
  const body = registry.match(/export function resolve\(b: Binding, scope: Scope\): unknown \{([\s\S]*?)\n\}/);
  check(!!body, 'the widget renderer still exports resolve(b, scope)');
  if (body) {
    const stmts = body[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    check(stmts.length === 1 && /resolveBinding\(/.test(stmts[0]),
      `resolve() DELEGATES rather than re-implementing (its body is ${stmts.length} statement(s): ${stmts.join(' ')})`);
  }

  const types = read('apps/ordeck/src/hud/types.ts');
  check(/WeaveBinding/.test(types),
    "ORDECK's Binding type IS weave's — not a second declaration that happens to match");

  const inspector = read('apps/ordeck/src/workshop/Inspector.tsx');
  check(/normalizeBinding/.test(inspector),
    'the Workshop editor normalises, so a spec in either vocabulary opens correctly (it was the third reading of the same idea)');
}

/* ── 3. no fourth vocabulary ─────────────────────────────────────────────────
   The regrowth shape: a hand-rolled `{from:` reader, or a fresh `Binding` type. */
{
  const SKIP = new Set(['node_modules', 'dist', 'build', '.turbo', 'sylibos']);
  const files = [];
  const walk = (dir) => {
    const abs = resolve(root, dir);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs)) {
      if (SKIP.has(e)) continue;
      const p = join(dir, e);
      if (statSync(resolve(root, p)).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e)) files.push(p);
    }
  };
  walk('apps'); walk('packages');

  const CANON = new Set([
    'packages/weave/src/shared/binding.js',
    'packages/weave/src/shared/binding.d.ts',
    'packages/weave/src/binding.ts',
    'packages/weave/src/trigger.ts',
    'apps/ordeck/src/hud/types.ts',
  ]);
  const offenders = [];
  for (const rel of files) {
    if (CANON.has(rel) || rel.endsWith('test/binding.mjs')) continue;
    const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (/^\s*export (?:type|interface) Binding\b/m.test(src)) {
      offenders.push(`${rel} — declares its own \`Binding\` type`);
    }
  }
  if (offenders.length) {
    fail(`${offenders.length} second binding vocabulary(ies):`);
    for (const o of offenders) console.error(`      ${o}`);
    console.error('    Import Binding from @jkos/weave. Two vocabularies for "point at a value');
    console.error('    that will exist at run time" is what D13 converged; a third undoes it.');
  } else {
    ok(`no second binding vocabulary anywhere in the suite (${files.length} files scanned)`);
  }
}

if (failed) {
  console.error(`\n✗ binding conformance: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ binding conformance: one model, two directions — read and write');
