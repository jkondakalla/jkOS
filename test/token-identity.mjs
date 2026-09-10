#!/usr/bin/env node
/**
 * check:token-identity — Stage F's step zero: what every design token ACTUALLY
 * COMPUTES TO, on both faces, measured by a real engine and pinned.
 *
 * WHY THIS GATE EXISTS, AND WHY IT HAD TO EXIST BEFORE STAGE F STARTS.
 * Every other conformance check in this suite is a text scan. `check:design`
 * catches a token that is STALE and a primitive that is UNDEMOED; `check:tokens`
 * catches the jkAuth mirror drifting from hub.css. **Not one of them can tell you
 * a colour changed.** Rewrite `--hub-amber` from `#ffb000` to `#ffb100` and every
 * gate in the repo stays green.
 *
 * Stage F is a 2,700-line restructure of exactly that file: naming the tiers,
 * collapsing four accent schemes into one, retiring the pigment names, reordering
 * by system. It is a rename-and-move pass that must change NOTHING a user can
 * see — and there is currently no way to know whether it did. So this measures
 * the values first, and the restructure is judged against the measurement.
 *
 * WHAT IT MEASURES. hub.css is served to a real headless Chromium, which is asked
 * for the computed value of every custom property declared on `:root` — once on
 * the paper face, once with `data-mode="dark"` — plus, for anything that resolves
 * to a colour, the USED value after `color-mix()` and friends are evaluated.
 *
 * ⚠️ **THE SUBSTITUTED TEXT IS NOT ENOUGH ON ITS OWN.** A custom property's
 * computed value has `var()` substituted but leaves `color-mix()` unevaluated, so
 * two tokens whose mix percentages differ can share a text form's shape and only
 * diverge in pixels. `used` is the second column, and it is the one that answers
 * "would anyone see a difference".
 *
 * HOW IT TREATS A RENAME, which is the whole reason it is not a plain equality
 * check. Stage F renames tokens on purpose, so a gate that failed on any name
 * change would be one nobody could keep green — and a gate nobody can turn green
 * is one people learn to skip. So:
 *
 *   · a SURVIVING name whose value moved   → FAILURE. Silent visual change.
 *   · a name that vanished and one that appeared, WITH THE SAME VALUE
 *                                          → reported as a rename, and passes.
 *     That is precisely the edit Stage F is made of, and naming it is the useful
 *     output rather than an exception to wave through.
 *   · a name that vanished with no match, or one that appeared, or a rename whose
 *     value ALSO moved                     → FAILURE, listed by name.
 *
 * Accept an intended change with `--update`, which rewrites the baseline. That is
 * a deliberate, reviewable diff of colours in a JSON file — which is the artifact
 * this suite has never had.
 *
 * A missing Chromium SKIPS rather than fails: the baseline still gets its
 * structural checks, and CI on a machine without a browser is not a red gate.
 *
 * Run:  node test/token-identity.mjs [--update]
 *       (wired as `pnpm check:token-identity`, folded into `pnpm test:contracts`)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = join(ROOT, 'packages/design/tokens/hub.css');
const BASELINE = join(ROOT, 'packages/design/tokens/computed-baseline.json');
const UPDATE = process.argv.includes('--update');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const skip = (msg) => console.log(`  – ${msg}`);

const hub = readFileSync(HUB, 'utf8');

/* ── The probe ────────────────────────────────────────────────────────────────
 * The token LIST comes from the CSSOM, not from a regex over the file. The
 * browser's own parse is the authority on what `:root` declares, and a regex that
 * disagreed with it would measure a set that does not exist — a gate reporting on
 * something it never read, which is the defect class this whole suite is built
 * against.
 *
 * `used` is read by applying each token to `color` on a probe element: anything
 * that resolves to a colour comes back as `rgb(...)`/`color(...)` with every
 * `color-mix()` already evaluated, and anything that does not simply inherits the
 * sentinel below and is recorded as a non-colour. */
const PROBE = `<!doctype html><html><head>
<link rel="stylesheet" href="/hub.css">
<style>html,body{margin:0}#probe{color:rgb(1,2,3)}</style>
</head><body><span id="probe"></span><script>
(function(){
  var SENTINEL = 'rgb(1, 2, 3)';
  var root = document.documentElement;
  var el = document.getElementById('probe');

  function declaredOnRoot() {
    var names = Object.create(null);
    for (var s = 0; s < document.styleSheets.length; s++) {
      var rules; try { rules = document.styleSheets[s].cssRules; } catch (e) { continue; }
      walk(rules, names);
    }
    return Object.keys(names).sort();
  }
  function walk(rules, names) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      // ⚠ THE STYLE RULE IS CHECKED FIRST, AND THAT ORDERING IS THE WHOLE
      // WALK. Since CSS Nesting shipped, a plain CSSStyleRule ALSO carries a
      // (usually empty) .cssRules, so testing for a group FIRST and recursing
      // skips every rule in the sheet and reports zero tokens — measured, on
      // this exact file, against 312 real rules.
      if (r.style && typeof r.selectorText === 'string') {
        collect(r, names);
        if (r.cssRules && r.cssRules.length) walk(r.cssRules, names);
        continue;
      }
      if (r.cssRules) { walk(r.cssRules, names); continue; }
    }
  }
  function collect(r, names) {
      var sel = r.selectorText || '';
      // Only the token LAYER: what :root declares, on either face. A custom
      // property declared on a component class is that component's business and
      // is not a token.
      if (!/^:root(\\[data-mode="dark"\\])?$/.test(sel.trim())) return;
      for (var k = 0; k < r.style.length; k++) {
        var n = r.style[k];
        if (n.indexOf('--') === 0) names[n] = 1;
      }
  }

  function readAll(names) {
    var cs = getComputedStyle(root);
    var out = {};
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var value = (cs.getPropertyValue(n) || '').trim();
      el.style.color = '';
      el.style.color = 'var(' + n + ')';
      var used = getComputedStyle(el).color;
      out[n] = { value: value, used: used === SENTINEL ? null : used };
    }
    return out;
  }

  var names = declaredOnRoot();
  root.removeAttribute('data-mode');
  var light = readAll(names);
  root.setAttribute('data-mode', 'dark');
  var dark = readAll(names);
  root.removeAttribute('data-mode');

  fetch('/report', { method: 'POST', body: JSON.stringify({ names: names, light: light, dark: dark }) });
})();
</script></body></html>`;

function findChromium() {
  const cache = join(process.env.HOME || '', '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome',
                         'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(cache, dir, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  return null;
}

function measure(chromium) {
  return new Promise((done) => {
    let settled = false;
    const server = createServer((req, res) => {
      if (req.url === '/hub.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end(hub);
      } else if (req.url === '/report' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { res.writeHead(204).end(); finish(JSON.parse(body)); });
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PROBE);
      }
    });
    let child = null, timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      server.close(() => done(result));
    };
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/probe.html`;
      child = spawn(chromium, ['--headless=new', '--disable-gpu', '--no-sandbox',
                               '--virtual-time-budget=8000', url], { stdio: 'ignore' });
      child.on('error', () => finish(null));
      timer = setTimeout(() => finish(null), 60_000);
    });
  });
}

/* ── The comparison ───────────────────────────────────────────────────────── */
const key = (t) => `${t.value}\u0000${t.used || ''}`;

function compare(base, now) {
  const oldNames = new Set(Object.keys(base.light));
  const newNames = new Set(Object.keys(now.light));

  const survived = [...newNames].filter((n) => oldNames.has(n));
  const gone = [...oldNames].filter((n) => !newNames.has(n));
  const added = [...newNames].filter((n) => !oldNames.has(n));

  // 1. A surviving name whose value moved. The silent visual change.
  const moved = [];
  for (const n of survived) {
    for (const face of ['light', 'dark']) {
      if (key(base[face][n]) !== key(now[face][n])) {
        moved.push(`${n} (${face}): ${base[face][n].value} → ${now[face][n].value}` +
          (base[face][n].used !== now[face][n].used
            ? `   [used ${base[face][n].used} → ${now[face][n].used}]` : ''));
      }
    }
  }
  if (moved.length) {
    fail(`${moved.length} token value(s) CHANGED under a name that still exists — ` +
      'nothing else in this repo would have said so:');
    for (const m of moved.slice(0, 40)) console.error(`      ${m}`);
    if (moved.length > 40) console.error(`      … and ${moved.length - 40} more`);
  } else {
    pass(`${survived.length} surviving token(s) compute byte-identically on both faces`);
  }

  // 2. Renames: a name that vanished and one that appeared carrying the same
  //    value on both faces. This is the edit Stage F is made of.
  const byValue = new Map();
  for (const n of added) {
    const k = `${key(now.light[n])}\u0001${key(now.dark[n])}`;
    if (!byValue.has(k)) byValue.set(k, []);
    byValue.get(k).push(n);
  }
  const renamed = [];
  const orphaned = [];
  for (const n of gone) {
    const k = `${key(base.light[n])}\u0001${key(base.dark[n])}`;
    const candidates = byValue.get(k);
    if (candidates && candidates.length) renamed.push([n, candidates.shift()]);
    else orphaned.push(n);
  }
  const arrived = [...byValue.values()].flat();

  if (renamed.length) {
    pass(`${renamed.length} token(s) renamed with the value preserved:`);
    for (const [a, b] of renamed.slice(0, 30)) console.log(`      ${a} → ${b}`);
    if (renamed.length > 30) console.log(`      … and ${renamed.length - 30} more`);
  }
  if (orphaned.length) {
    fail(`${orphaned.length} token(s) disappeared with no same-valued replacement — ` +
      'either a value moved during the rename, or a token was dropped:');
    for (const n of orphaned.slice(0, 30)) console.error(`      ${n} (was ${base.light[n].value})`);
    if (orphaned.length > 30) console.error(`      … and ${orphaned.length - 30} more`);
  }
  if (arrived.length) {
    fail(`${arrived.length} NEW token(s) that are not a rename of anything — ` +
      'legitimate when the factory grows a primitive, and never silent:');
    for (const n of arrived.slice(0, 30)) console.error(`      ${n} = ${now.light[n].value}`);
    if (arrived.length > 30) console.error(`      … and ${arrived.length - 30} more`);
  }
  if (orphaned.length || arrived.length || moved.length) {
    console.error('\n    If the change is intended, re-run with --update and review the ' +
      'JSON diff — that diff is the visual review this suite has never had.');
  }
}

/* ── Run ──────────────────────────────────────────────────────────────────── */
console.log('\ntoken-identity · measured');

let measured = false;
const chromium = findChromium();
if (!chromium) {
  skip('no Chromium found — cannot measure computed token values');
  if (!existsSync(BASELINE)) fail(`no baseline at ${BASELINE} and no browser to build one`);
  else pass('the committed baseline is present (unverified without a browser)');
} else {
  const now = await measure(chromium);
  if (!now) {
    fail('Chromium never reported back — could not measure the token layer');
  } else {
    const both = now.names.filter((n) => key(now.light[n]) !== key(now.dark[n]));
    console.log(`    ${now.names.length} tokens on :root — ${both.length} differ between the ` +
      `faces, ${now.names.length - both.length} are the same on both`);

    if (UPDATE || !existsSync(BASELINE)) {
      writeFileSync(BASELINE, JSON.stringify(
        { note: 'Measured by test/token-identity.mjs from a real headless Chromium. ' +
                'Regenerate with `pnpm check:token-identity --update`; the diff is the review.',
          tokens: now.names.length, light: now.light, dark: now.dark }, null, 2) + '\n');
      pass(`${UPDATE ? 'rewrote' : 'created'} the baseline — ${now.names.length} tokens`);
    } else {
      const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
      compare(base, now);
    }
    measured = true;
  }
}

/* ── The structural half — a FALLBACK, not a second opinion ───────────────────
 * It exists so a machine with no browser still notices a token being deleted. It
 * is skipped whenever the measured half actually ran, because the two disagree by
 * construction on the one edit Stage F is made of: a rename is a clean pass up
 * there and a missing name down here, and a gate that contradicts itself on the
 * expected edit is a gate people learn to read past. */
console.log('\ntoken-identity · the source');
if (measured) {
  skip('the measured half ran — it subsumes this');
} else if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const names = Object.keys(base.light);
  // Every baselined name must still be DECLARED somewhere in hub.css. Cheap, and
  // it catches a deletion even on a machine with no browser.
  const missing = names.filter((n) => !hub.includes(`${n}:`));
  if (missing.length) fail(`baselined token(s) no longer declared in hub.css: ${missing.slice(0, 10).join(', ')}`);
  else pass(`all ${names.length} baselined tokens are still declared in hub.css`);
} else {
  fail('no baseline to check against');
}

console.log(failures
  ? `\ncheck:token-identity — ${failures} problem(s)`
  : '\ncheck:token-identity — the token layer computes what it computed before');
process.exit(failures ? 1 : 0);
