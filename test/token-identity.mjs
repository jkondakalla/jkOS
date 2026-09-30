#!/usr/bin/env node
/**
 * check:token-identity — Stage F's step zero: what every design token ACTUALLY
 * COMPUTES TO, on both faces, measured by a real engine and pinned.
 *
 * WHY THIS GATE EXISTS, AND WHY IT HAD TO EXIST BEFORE STAGE F STARTS.
 * Every other conformance check in this suite is a text scan. `check:design`
 * catches a token that is STALE and a primitive that is UNDEMOED; `check:tokens`
 * catches the jkAuth mirror drifting from hub.css. **Not one of them can tell you
 * a colour changed.** Rewrite `--hub-accent-raw` from `#ffb000` to `#ffb100` and every
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
 * ⚠️ **AT ALL THREE VIEWPORT TIERS.** hub.css re-declares the scale tokens inside
 * two `@media` blocks, so a token has up to six values, not two. Until 2026-09-30
 * this measured once, at headless Chrome's default 800px window — the TABLET tier
 * only — so a rename done in `:root` and missed in the MOBILE block passed green.
 * Each tier is now its own window width, and the baseline records a tier's values
 * only where they differ from desktop.
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
/* The sentinel sits on BODY, not on the probe. A token that is not a colour makes
 * the probe's `color: var(--x)` invalid at computed-value time, which resolves to
 * `unset` — and `color` inherits, so the probe takes its PARENT's colour. With the
 * sentinel on the probe itself that parent was body's CanvasText, and every
 * radius, font and length recorded a black/white "used colour" that flipped with
 * color-scheme (fixed 2026-09-30). */
const PROBE = `<!doctype html><html><head>
<link rel="stylesheet" href="/hub.css">
<style>html,body{margin:0}body{color:rgb(1,2,3)}</style>
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

/* The three tiers, each measured at a window width inside it. The bounds are
 * responsive/breakpoints.ts's (desktop ≥1024, tablet 768–1023, mobile ≤767);
 * test/responsive.mjs pins hub.css's @media blocks to the same numbers. */
const TIERS = { desktop: 1280, tablet: 900, mobile: 390 };

function measure(chromium, width) {
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
                               `--window-size=${width},900`,
                               '--virtual-time-budget=8000', url], { stdio: 'ignore' });
      child.on('error', () => finish(null));
      timer = setTimeout(() => finish(null), 60_000);
    });
  });
}

/* ── The baseline's shape ─────────────────────────────────────────────────────
 * Per token: its desktop `light` and `dark`, plus `tablet`/`mobile` entries holding
 * only the faces whose value differs from desktop. Most tokens never move with the
 * viewport, so the file stays about the size it was and a rename still reads as
 * one block moving in the diff. `faces()` expands an entry back to all six. */
const FACES = Object.keys(TIERS).flatMap((t) => ['light', 'dark'].map((f) => `${t}/${f}`));

function faces(entry) {
  const out = {};
  for (const tier of Object.keys(TIERS)) {
    for (const face of ['light', 'dark']) {
      out[`${tier}/${face}`] = (tier !== 'desktop' && entry[tier]?.[face]) || entry[face];
    }
  }
  return out;
}

function toBaseline(byTier) {
  const entries = {};
  for (const n of byTier.desktop.names) {
    const e = { light: byTier.desktop.light[n], dark: byTier.desktop.dark[n] };
    for (const tier of Object.keys(TIERS).filter((t) => t !== 'desktop')) {
      for (const face of ['light', 'dark']) {
        const v = byTier[tier][face][n];
        if (v && key(v) !== key(e[face])) (e[tier] ||= {})[face] = v;
      }
    }
    entries[n] = e;
  }
  return entries;
}

/* ── The comparison ───────────────────────────────────────────────────────── */
const key = (t) => `${t.value}\u0000${t.used || ''}`;
const allKey = (entry) => { const f = faces(entry); return FACES.map((k) => key(f[k])).join('\u0001'); };

/* Suffix affinity, for pairing renames when several new names share one value
 * (every 8px radius, every `none` halo): the new name that keeps the most of the
 * old one's tail is the likeliest heir, so the report reads `--jk-radius-sm →
 * --jk-radius-sm` instead of an arbitrary pairing that happens to pass. */
const tail = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
};

function compare(base, now) {
  const oldNames = new Set(Object.keys(base));
  const newNames = new Set(Object.keys(now));

  const survived = [...newNames].filter((n) => oldNames.has(n));
  const gone = [...oldNames].filter((n) => !newNames.has(n));
  const added = [...newNames].filter((n) => !oldNames.has(n));

  // 1. A surviving name whose value moved. The silent visual change.
  const moved = [];
  for (const n of survived) {
    const was = faces(base[n]), is = faces(now[n]);
    for (const face of FACES) {
      if (key(was[face]) !== key(is[face])) {
        moved.push(`${n} (${face}): ${was[face].value} → ${is[face].value}` +
          (was[face].used !== is[face].used ? `   [used ${was[face].used} → ${is[face].used}]` : ''));
      }
    }
  }
  if (moved.length) {
    fail(`${moved.length} token value(s) CHANGED under a name that still exists — ` +
      'nothing else in this repo would have said so:');
    for (const m of moved.slice(0, 40)) console.error(`      ${m}`);
    if (moved.length > 40) console.error(`      … and ${moved.length - 40} more`);
  } else {
    pass(`${survived.length} surviving token(s) compute byte-identically on both faces at all ` +
      `${Object.keys(TIERS).length} tiers`);
  }

  // 2. Renames: a name that vanished and one that appeared carrying the same
  //    value on every face at every tier. This is the edit Stage F is made of.
  const byValue = new Map();
  for (const n of added) {
    const k = allKey(now[n]);
    if (!byValue.has(k)) byValue.set(k, []);
    byValue.get(k).push(n);
  }
  const renamed = [];
  const orphaned = [];
  for (const n of gone) {
    const candidates = byValue.get(allKey(base[n]));
    if (candidates && candidates.length) {
      let best = 0;
      for (let i = 1; i < candidates.length; i++) if (tail(n, candidates[i]) > tail(n, candidates[best])) best = i;
      renamed.push([n, candidates.splice(best, 1)[0]]);
    } else orphaned.push(n);
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
    for (const n of orphaned.slice(0, 30)) console.error(`      ${n} (was ${base[n].light.value})`);
    if (orphaned.length > 30) console.error(`      … and ${orphaned.length - 30} more`);
  }
  if (arrived.length) {
    fail(`${arrived.length} NEW token(s) that are not a rename of anything — ` +
      'legitimate when the factory grows a primitive, and never silent:');
    for (const n of arrived.slice(0, 30)) console.error(`      ${n} = ${now[n].light.value}`);
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
  const byTier = {};
  for (const [tier, width] of Object.entries(TIERS)) byTier[tier] = await measure(chromium, width);
  const missing = Object.keys(TIERS).filter((t) => !byTier[t]);
  if (missing.length) {
    fail(`Chromium never reported back at the ${missing.join(', ')} tier — could not measure the token layer`);
  } else {
    const now = toBaseline(byTier);
    const names = Object.keys(now);
    const both = names.filter((n) => key(now[n].light) !== key(now[n].dark));
    const tiered = names.filter((n) => now[n].tablet || now[n].mobile);
    console.log(`    ${names.length} tokens on :root — ${both.length} differ between the faces, ` +
      `${tiered.length} move with the viewport tier`);

    if (UPDATE || !existsSync(BASELINE)) {
      writeFileSync(BASELINE, JSON.stringify(
        { note: 'Measured by test/token-identity.mjs from a real headless Chromium at the desktop, ' +
                'tablet and mobile widths. Per token: the desktop light/dark values, plus a tier ' +
                'entry only where that tier differs. Regenerate with ' +
                '`pnpm check:token-identity --update`; the diff is the review.',
          tokens: names.length, widths: TIERS, values: now }, null, 2) + '\n');
      pass(`${UPDATE ? 'rewrote' : 'created'} the baseline — ${names.length} tokens`);
    } else {
      const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
      if (!base.values) fail('the baseline predates the per-tier format — regenerate it with --update');
      else compare(base.values, now);
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
  const names = Object.keys(base.values || {});
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
