// Design-page conformance — keeps staging.jkos.net/design honest.
//
// The page (apps/jkauth/public/design.html) is a BUILT SNAPSHOT: build-design-page.mjs
// inlines hub.css + player-ui.css verbatim into design-template.html. A snapshot has
// exactly two failure modes, and a reference nobody can trust is worse than none:
//
//   1. STALE — someone edits hub.css (or player-ui.css) and forgets to rerun the
//      build, so the page renders yesterday's system. Caught by rebuilding in memory
//      and diffing against the committed file.
//   2. INCOMPLETE — someone adds a shared class and never demos it, so the "living
//      style guide" quietly stops showing part of the system. This is what happened
//      before 2026-07-16: the shell, match panel, async triad, scrim, cards
//      affordances and the whole player bar existed but were on no page. Caught by
//      scanning every top-level class hub.css defines and requiring the template to
//      use it.
//
// Run:  node test/design-page.mjs   (wired as `pnpm check:design`, folded into
//                                    `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildDesignPage, DESIGN_PAGE_PATH } from '../apps/jkauth/scripts/build-design-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const TEMPLATE = 'apps/jkauth/scripts/design-template.html';
const template = read(TEMPLATE);
const hub = read('packages/design/tokens/hub.css');

/* ── 1. The built page is not stale ────────────────────────────────────────── */
{
  const built = buildDesignPage();
  const committed = readFileSync(DESIGN_PAGE_PATH, 'utf8');
  if (built === committed) {
    ok('design.html is up to date with the template + hub.css + player-ui.css');
  } else {
    fail(
      'design.html is STALE — it no longer matches a fresh build of its sources.\n' +
      '    Rerun:  node apps/jkauth/scripts/build-design-page.mjs',
    );
  }
}

/* ── 2. Every shared class hub.css defines is demonstrated ─────────────────── */

// Top-level class selectors only: a rule that starts at column 0. Nested/state
// selectors (`.led.green`, `:root[data-mode] .jk-glow`) ride on their base class,
// and the base is what must be demoed.
const hubNoComments = hub.replace(/\/\*[\s\S]*?\*\//g, '');
const declared = new Set();
for (const line of hubNoComments.split('\n')) {
  const m = /^(\.[a-zA-Z][a-zA-Z0-9_-]*)/.exec(line);
  if (m) declared.add(m[1].slice(1));
}

// Classes that CANNOT be shown standing still, each for a stated reason. Anything
// not listed here has to appear on the page — the list is the argument, so a new
// entry needs a new reason, not just a new line.
const EXEMPT = new Map([
  // Terminal state of a pair whose correct demo is "nothing there".
  ['intro-out', 'the boot screen fading OUT — a correct demo is an empty box (§14 says so in prose)'],
]);

// The classes the template actually PUTS ON something. Tokenised out of class="…"
// attributes rather than substring-searched: `\b` treats `-` as a word boundary, so
// a naive /\bjk-press\b/ is satisfied by `jk-press-lg` — the gate would pass while
// the base class went undemoed. Only a whole token counts.
const rendered = new Set();
for (const [, value] of template.matchAll(/\bclass="([^"]*)"/g)) {
  for (const token of value.split(/\s+/)) if (token) rendered.add(token);
}

const missing = [...declared].filter((cls) => !EXEMPT.has(cls) && !rendered.has(cls));
if (missing.length) {
  fail(
    `hub.css defines ${missing.length} shared class(es) the design page never renders:\n` +
    missing.map((c) => `      .${c}`).join('\n') +
    `\n    Add a demo to ${TEMPLATE} (then rerun the build), or — if it genuinely cannot be\n` +
    '    shown — add it to EXEMPT in this file WITH the reason.',
  );
} else {
  ok(`every shared class in hub.css (${declared.size - EXEMPT.size} of them) is demonstrated on the page`);
}

/* ── 3. The slider primitive is real, tokenised, and wired ─────────────────── */
{
  const track = hubNoComments.match(/\.jk-slider::-webkit-slider-runnable-track\s*\{([^}]*)\}/);
  const thumb = hubNoComments.match(/\.jk-slider::-webkit-slider-thumb\s*\{([^}]*)\}/);
  if (!/^\.jk-slider\s*\{/m.test(hubNoComments)) {
    fail('hub.css is missing the .jk-slider rule');
  } else if (!track || !thumb) {
    fail('.jk-slider has no ::-webkit- track/thumb — the range would render as OS chrome');
  } else if (!/var\(--jk-slider-fill/.test(track[1])) {
    fail('.jk-slider track does not read --jk-slider-fill — the elapsed fill would never paint');
  } else if (!/var\(--jk-tint,\s*var\(--accent\)\)/.test(track[1])) {
    fail('.jk-slider track does not fill from --jk-tint/--accent — retinting would break');
  } else {
    ok('hub.css ships .jk-slider — track + cap, fills from --jk-slider-fill, retints via --jk-tint');
  }
  // moz gets the same treatment: vendor pseudos can't be grouped, so a missing
  // -moz- twin means the whole control silently degrades in Firefox.
  for (const pseudo of ['::-moz-range-track', '::-moz-range-thumb']) {
    if (hubNoComments.includes(`.jk-slider${pseudo}`)) ok(`.jk-slider${pseudo} present (Firefox parity)`);
    else fail(`.jk-slider${pseudo} is missing — the control degrades to OS chrome in Firefox`);
  }
}
{
  const primitives = read('packages/ui/src/primitives.tsx');
  const barrel = read('packages/ui/src/index.ts');
  if (/export\s+function\s+Slider\b/.test(primitives)) ok('@jkos/ui primitives.tsx exports Slider');
  else fail('@jkos/ui primitives.tsx no longer exports a function Slider');
  if (/\bSlider\b/.test(barrel.match(/export\s*\{([\s\S]*?)\}\s*from\s*'\.\/primitives'/)?.[1] ?? '')) {
    ok("@jkos/ui index.ts re-exports Slider from './primitives'");
  } else {
    fail("@jkos/ui index.ts does not re-export Slider — '@jkos/ui' is the only sanctioned import path");
  }
}

/* ── 4. The player's seek control rides the primitive, not a bespoke range ─── */
{
  const scrubber = read('packages/player/src/ui/Scrubber.tsx');
  const playerCss = read('packages/player/src/ui/player-ui.css');
  if (/<Slider\b/.test(scrubber) && /from\s*'@jkos\/ui'/.test(scrubber)) {
    ok('player <Scrubber> seeks through the suite <Slider>');
  } else {
    fail('player <Scrubber> no longer renders <Slider> from @jkos/ui — the seek bar has forked');
  }
  if (/^\.pb-range\s*\{/m.test(playerCss.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    fail('player-ui.css redeclared .pb-range — the seek control must take its look from .jk-slider');
  } else {
    ok('player-ui.css keeps no bespoke range styling');
  }
}

if (failed) {
  console.error(`\n${failed} design-page check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ design page: fresh, complete, and the slider is one primitive');
