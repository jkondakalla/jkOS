/**
 * TEST-20 · Temp-dir hygiene — every test that makes a temp directory removes it.
 *
 * The harness contract (TESTING.md) says a test cleans up every temp file it makes. Seventeen
 * gate tests did not (found 2026-09-24): each transpile-and-import unit test made a
 * `mkdtempSync` directory for its emitted modules and walked away from it, so every
 * `pnpm test:contracts` left seventeen directories in /tmp — on this machine a RAM tmpfs —
 * and one of them (jkAuth's contracts bridge) held a signed test token and a public key.
 * Nothing failed; the leak was invisible to every assertion in the suite.
 *
 * The rule, read straight off each test's source: a directory bound by
 * `<name> = mkdtempSync(…)` (declared or assigned, `this.x` included) must be handed to
 * `rmSync(<name>…)` in the same file. The house form is
 * `process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))`, which also runs
 * when the test fails. A `mkdtempSync` whose result is not bound to a name cannot be removed
 * by anything, so it is reported too.
 *
 *   drift  a test makes a temp directory it never removes
 *   ok     every temp directory a test makes is removed
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../topology.mjs';

/** Every script that runs as a test: root test/, each package's and app's test/, the app
 *  scripts the gate calls (check-hud-doc), and the prober's own drivers. */
function testFiles() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
    }
  };
  walk(join(REPO_ROOT, 'test'));
  for (const group of ['packages', 'apps']) {
    for (const name of readdirSync(join(REPO_ROOT, group))) {
      walk(join(REPO_ROOT, group, name, 'test'));
      walk(join(REPO_ROOT, group, name, 'backend', 'test'));
      walk(join(REPO_ROOT, group, name, 'scripts'));
    }
  }
  for (const f of ['prove.mjs', 'roundtrip.mjs']) out.push(join(REPO_ROOT, 'packages', 'suite-prober', f));
  return out.filter((p) => existsSync(p));
}

export default {
  id: 'temp-dirs',
  title: 'Temp-dir hygiene — every temp directory a test makes, it removes',

  run() {
    const out = [];
    let makers = 0;
    for (const path of testFiles()) {
      const src = readFileSync(path, 'utf8');
      if (!src.includes('mkdtempSync(')) continue;
      const rel = path.slice(REPO_ROOT.length + 1);
      const calls = [...src.matchAll(/mkdtempSync\(/g)].length;
      // Bound by a declaration (`const tmp = …`) or an assignment (`tmp = …`, `this.tmp = …`).
      const bound = [...src.matchAll(/(?:\b(?:const|let|var)\s+)?((?:this\.)?\w+)\s*=\s*mkdtempSync\(/g)].map((m) => m[1]);
      makers++;
      if (bound.length < calls) {
        out.push({ level: 'drift', msg: `${rel} makes a temp directory it never names — nothing can remove it`, where: [rel] });
      }
      for (const name of bound) {
        if (!new RegExp(`rmSync\\(\\s*${name.replace('.', '\\.')}\\b`).test(src)) {
          out.push({
            level: 'drift',
            msg: `${rel} makes temp dir '${name}' and never removes it — ` +
                 `add process.on('exit', () => rmSync(${name}, { recursive: true, force: true }))`,
            where: [rel],
          });
        }
      }
    }
    if (!out.length) {
      out.push({ level: 'ok', msg: `${makers} tests make a temp directory; every one removes it`, where: ['test/'] });
    }
    return out;
  },
};
