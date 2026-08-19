#!/usr/bin/env node
/**
 * check:scroll — the suite scrollbar is drawn, in BOTH engines, for real.
 *
 * WHY THIS GATE EXISTS. The hairline (packages/design/tokens/hub.css, "Scrollbars
 * — THE HAIRLINE") shipped correct-looking CSS that reached exactly one engine.
 * The standard-property half was guarded by `@supports not (selector(::-webkit-
 * scrollbar))`, which reads as "engines with no webkit pseudos to lose" and is
 * wrong: Selectors-4 tells engines to PARSE unknown `-webkit-` prefixed pseudo-
 * elements as valid rather than drop the rule, and Gecko obeys. Firefox 153
 * answers YES to `selector(::-webkit-scrollbar)` while implementing none of it,
 * so the guard fell FALSE in the one engine it existed to serve. Firefox got
 * neither syntax and every pane in the suite came up with the raw OS bar.
 *
 * No text-scan could have caught that — the CSS was present, well-formed and
 * inert. So this gate MEASURES: it serves hub.css to a real headless Chromium
 * and a real headless Firefox and asks each one what it actually computed.
 *
 * WHAT EACH ENGINE MUST SAY
 *   Blink    ::-webkit-scrollbar is 10px wide and ::-webkit-scrollbar-thumb is
 *            painted with a real (non-transparent) colour — and the root's
 *            `scrollbar-color` is still `auto`. That last one is not pedantry:
 *            the moment `scrollbar-color` applies to an element, Blink discards
 *            every ::-webkit-scrollbar-* rule for it and paints its own themed
 *            bar with stepper arrows. Handing Blink the standard properties is
 *            how you silently lose the drawn bar, so the gate forbids it.
 *   Gecko    the root's `scrollbar-width` is `thin` and its `scrollbar-color` is
 *            NOT `auto`. This is the exact assertion the shipped bug failed.
 *
 * A missing browser SKIPS its half rather than failing — the static half below
 * still runs everywhere, and it names the trap by its literal text so the guard
 * cannot be rewritten back into the broken form without tripping.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = join(ROOT, 'packages/design/tokens/hub.css');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const skip = (msg) => console.log(`  – ${msg}`);

/* ── 1. The static guard ──────────────────────────────────────────────────
 * One rule, stated where it can be read: the engine test may not be the one
 * that lied. Everything else about the block is measured live below. */
console.log('\nscrollbar · the source');
const hub = readFileSync(HUB, 'utf8');

if (/@supports\s+not\s*\(\s*selector\(\s*::-webkit-scrollbar\s*\)\s*\)/.test(hub)) {
  fail(
    'hub.css guards the standard scrollbar properties with '
    + '`@supports not (selector(::-webkit-scrollbar))`.\n'
    + '    Gecko PARSES unknown -webkit- pseudo-elements as valid (Selectors-4), so\n'
    + '    Firefox answers YES to that query and the block never applies there — the\n'
    + '    one engine it exists for gets the raw OS bar. Test the THUMB instead:\n'
    + '    `@supports (not (selector(::-webkit-scrollbar-thumb))) or (-moz-orient: inline)`',
  );
} else {
  pass('the engine test is not the ::-webkit-scrollbar parse trap');
}

for (const part of ['::-webkit-scrollbar ', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-track', '::-webkit-scrollbar-corner', '::-webkit-scrollbar-button']) {
  if (hub.includes(part)) pass(`hub.css draws ${part.trim()}`);
  else fail(`hub.css no longer styles ${part.trim()} — Blink falls back to the OS bar`);
}

if (/scrollbar-width:\s*thin/.test(hub) && /scrollbar-color:/.test(hub)) {
  pass('hub.css carries the standard-property half for Gecko');
} else {
  fail('hub.css lost `scrollbar-width` / `scrollbar-color` — Firefox gets nothing');
}

/* No app may re-declare the bar. One look for the suite, or the two drift and
   only one of them gets fixed the next time this comes up. sylibos is excluded
   by standing instruction (it is not touched in any session). The generated
   mirrors of hub.css are excluded because they ARE hub.css. */
const MIRRORS = [
  'apps/jkauth/public/jkos-tokens.css',
  'apps/jkauth/public/design.html',
  'apps/jkauth/scripts/design-template.html',
  'jkos-deploy/static/jkos-tokens.css',
];
let strays = [];
try {
  const out = execFileSync('git', ['grep', '-l', '-E', '::-webkit-scrollbar|scrollbar-color|scrollbar-width', '--', '*.css', '*.html', '*.tsx', '*.ts'], { cwd: ROOT, encoding: 'utf8' });
  strays = out.split('\n').filter(Boolean).filter((f) => (
    !f.startsWith('packages/design/')
    && !f.startsWith('apps/sylibos/')
    && !MIRRORS.includes(f)
    && f !== 'test/scrollbar.mjs'
  ));
} catch { /* git grep exits 1 with no matches */ }
if (strays.length) fail(`these declare their own scrollbar, outside the primitive: ${strays.join(', ')}`);
else pass('no app re-declares the scrollbar');

/* ── 2. What the engines actually computed ───────────────────────────────── */

const PROBE = `<!doctype html><html data-mode="dark"><head>
<link rel="stylesheet" href="/hub.css">
<style>html,body{margin:0;height:100%}#p{width:300px;height:200px;overflow:auto}#t{height:1400px}</style>
</head><body><div id="p"><div id="t"></div></div><script>
(function(){
  var el = document.getElementById('p');
  var root = getComputedStyle(document.documentElement);
  function pseudo(pe, prop) {
    try { return getComputedStyle(el, pe)[prop] || ''; } catch (e) { return ''; }
  }
  var r = {
    ua: navigator.userAgent,
    rootScrollbarWidth: root.scrollbarWidth || '',
    rootScrollbarColor: root.scrollbarColor || '',
    barWidth: pseudo('::-webkit-scrollbar', 'width'),
    thumbBg: pseudo('::-webkit-scrollbar-thumb', 'backgroundColor'),
  };
  fetch('/report', { method: 'POST', body: JSON.stringify(r) });
})();
</script></body></html>`;

/** Serve hub.css + the probe, resolve with whatever the page reports back. */
function measure(launch, label) {
  return new Promise((done) => {
    let settled = false;
    const server = createServer((req, res) => {
      if (req.url === '/hub.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end(hub);
      } else if (req.url === '/report' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          res.writeHead(204).end();
          finish(JSON.parse(body));
        });
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PROBE);
      }
    });
    let child = null;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      server.close(() => done(result));
    };
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/probe.html`;
      child = launch(url);
      child.on('error', () => finish(null));
      timer = setTimeout(() => finish(null), 30_000);
    });
  }).then((r) => {
    if (!r) fail(`${label} never reported back — could not measure the scrollbar`);
    return r;
  });
}

/** Chromium, from the playwright cache or the PATH. */
function findChromium() {
  const cache = join(process.env.HOME || '', '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
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

function findFirefox() {
  for (const name of ['firefox', 'firefox-esr']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  return existsSync('/usr/sbin/firefox') ? '/usr/sbin/firefox' : null;
}

console.log('\nscrollbar · Blink');
const chromium = findChromium();
if (!chromium) {
  skip('no Chromium found — install one to measure the drawn bar');
} else {
  const r = await measure(
    (url) => spawn(chromium, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=8000', url], { stdio: 'ignore' }),
    'Chromium',
  );
  if (r) {
    if (r.barWidth === '10px') pass('::-webkit-scrollbar is the suite\'s 10px hit box');
    else fail(`Blink computed ::-webkit-scrollbar width = ${r.barWidth || '(nothing)'} — expected 10px`);

    const bg = r.thumbBg || '';
    const invisible = !bg || /rgba?\(0,\s*0,\s*0,\s*0\)/.test(bg) || bg === 'transparent';
    if (invisible) fail('Blink paints no ::-webkit-scrollbar-thumb colour — the mark is invisible or unstyled');
    else pass(`::-webkit-scrollbar-thumb is painted (${bg})`);

    /* The mutual-exclusion trap, from the other side. */
    if ((r.rootScrollbarColor || 'auto') === 'auto') pass('Blink was NOT handed `scrollbar-color` (which would discard every webkit rule)');
    else fail(`Blink computed scrollbar-color = ${r.rootScrollbarColor} — this discards the drawn bar and brings back stepper arrows`);
  }
}

console.log('\nscrollbar · Gecko');
const firefox = findFirefox();
if (!firefox) {
  skip('no Firefox found — install one to measure the Gecko half (this is the half that shipped broken)');
} else {
  const profile = mkdtempSync(join(tmpdir(), 'jkos-scroll-ff-'));
  try {
    const r = await measure(
      (url) => spawn(firefox, ['--headless', '--no-remote', '--profile', profile, url], { stdio: 'ignore' }),
      'Firefox',
    );
    if (r) {
      if (r.rootScrollbarWidth === 'thin') pass('Gecko computed scrollbar-width: thin');
      else fail(`Gecko computed scrollbar-width = ${r.rootScrollbarWidth || '(nothing)'} — expected thin; the @supports guard is not reaching Firefox`);

      if (r.rootScrollbarColor && r.rootScrollbarColor !== 'auto') pass(`Gecko computed scrollbar-color = ${r.rootScrollbarColor}`);
      else fail('Gecko computed scrollbar-color = auto — Firefox is showing the raw OS bar. This is the exact bug this gate exists for.');
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

console.log('');
if (failures) {
  console.error(`check:scroll — ${failures} failure${failures === 1 ? '' : 's'}\n`);
  process.exit(1);
}
console.log('check:scroll — the hairline reaches every engine measured\n');
