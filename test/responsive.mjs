// Responsive conformance — keeps the ONE breakpoint definition honest.
//
// The viewport axis has two faces that must agree: the JS source
// (packages/design/responsive/breakpoints.ts) and the CSS that reflows cards
// (the `@media` blocks + tap-target rule in packages/design/tokens/hub.css).
// Nothing in the build forces them to match, so this asserts:
//
//   1. breakpoints.ts is internally consistent: each BREAKPOINT_MAX is one below
//      the next BREAKPOINTS minWidth, and MEDIA derives from BREAKPOINT_MAX (it's
//      what useBreakpoint feeds matchMedia — no hardcoded breakpoint literals)
//   2. hub.css's tablet/mobile `@media (max-width: …)` bounds === BREAKPOINT_MAX
//   3. the tap-target floor rule applies to EXACTLY the interactive primitives
//      (no stray static selector silently inheriting the 44px floor)
//   4. the retired magic numbers (768 / 880 / 1100) don't reappear as raw
//      breakpoints in BeigeBoard / ORDECK layout code
//   5. buildJkOSTheme emits its `responsive` overrides at the canonical
//      BREAKPOINT_MAX bounds (no hardcoded breakpoint literal in the emit)
//
// Run:  node test/responsive.mjs        (wired as `pnpm check:responsive`,
//                                         folded into `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// Parse BREAKPOINT_MAX from the TS source as text — Node (>=20) can't import .ts,
// and text-parsing keeps the single source authoritative without a build step.
const bpSrc = read('packages/design/responsive/breakpoints.ts');
const bpBlock = bpSrc.match(/BREAKPOINT_MAX\s*=\s*\{([^}]*)\}/);
if (!bpBlock) { console.error('✗ could not find BREAKPOINT_MAX in breakpoints.ts'); process.exit(1); }
const BREAKPOINT_MAX = Object.fromEntries(
  [...bpBlock[1].matchAll(/(\w+)\s*:\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)]));

// Also parse the BREAKPOINTS tiers (name → minWidth) and the MEDIA block from the
// same source text, so we can prove the file is internally consistent before
// checking anything else against it.
const bpArr = bpSrc.match(/BREAKPOINTS\s*:[^=]*=\s*\[([\s\S]*?)\]/);
const MINW = bpArr ? Object.fromEntries(
  [...bpArr[1].matchAll(/name:\s*'(\w+)'\s*,\s*minWidth:\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)])) : {};
// Anchor on `} as const` so the capture spans the whole object — a bare `\}`
// would stop at the first `${…}` interpolation and miss later lines.
const mediaBlock = bpSrc.match(/MEDIA\s*=\s*\{([\s\S]*?)\}\s*as const/);

// ── 1. breakpoints.ts is internally consistent ──────────────────────────────
// (a) Each BREAKPOINT_MAX is exactly one below the next tier's minWidth, so the
//     CSS max-width bounds and the JS minWidth resolver can never disagree.
if (MINW.tablet - 1 === BREAKPOINT_MAX.mobile && MINW.desktop - 1 === BREAKPOINT_MAX.tablet) {
  ok('BREAKPOINT_MAX is one below the next BREAKPOINTS minWidth (mobile & tablet)');
} else {
  fail('BREAKPOINT_MAX drifted from BREAKPOINTS minWidths — expected ' +
       `mobile=${MINW.tablet - 1} (got ${BREAKPOINT_MAX.mobile}), ` +
       `tablet=${MINW.desktop - 1} (got ${BREAKPOINT_MAX.tablet}); one was edited without the other`);
}
// (b) MEDIA must DERIVE from BREAKPOINT_MAX, never hardcode a breakpoint number.
//     It's what useBreakpoint feeds matchMedia — the most likely thing to silently
//     drift from the CSS — so a raw 3+-digit literal here is the regression we ban.
if (mediaBlock && /BREAKPOINT_MAX/.test(mediaBlock[1]) && !/\d{3,}/.test(mediaBlock[1])) {
  ok('MEDIA derives every bound from BREAKPOINT_MAX (no hardcoded breakpoint literals)');
} else if (!mediaBlock) {
  fail('could not find the MEDIA block in breakpoints.ts');
} else {
  fail('MEDIA hardcodes a breakpoint literal instead of deriving from BREAKPOINT_MAX — ' +
       'useBreakpoint would drift from the CSS @media bounds');
}

// ── 2. CSS media bounds match the canonical source ──────────────────────────
const hub = read('packages/design/tokens/hub.css');
for (const [tier, px] of Object.entries(BREAKPOINT_MAX)) {
  const re = new RegExp(`@media\\s*\\(max-width:\\s*${px}px\\)`);
  if (re.test(hub)) ok(`hub.css has the ${tier} @media at ${px}px (matches BREAKPOINT_MAX)`);
  else fail(`hub.css is missing a @media (max-width: ${px}px) block for the ${tier} tier — ` +
            `it drifted from BREAKPOINT_MAX.${tier} in responsive/breakpoints.ts`);
}

// ── 3. tap-target floor rule survives — with the EXACT interactive selector ──
// Proving the rule merely *exists* isn't enough: the whole point of the tag+class
// selector is that it lifts the 44px floor onto interactive instances (real
// <button>/<a>) only and leaves static <span> badges dense. A stray `span.jk-bubble`
// (or a dropped `.jk-tbtn`) would silently break that intent with the rule still
// "present". So pin the selector list to exactly the interactive primitives.
const EXPECTED_TAP_SELECTOR =
  'button.jk-bubble, a.jk-bubble, button.jk-pill, a.jk-pill, .jk-tbtn';
const hubNoComments = hub.replace(/\/\*[\s\S]*?\*\//g, '');
const tapRule = hubNoComments.match(/([^{};]*?)\{\s*min-height:\s*var\(--hub-tap-min\)/);
const tapSelector = tapRule ? tapRule[1].trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ') : null;
if (tapSelector === EXPECTED_TAP_SELECTOR) {
  ok('hub.css tap-target floor applies to exactly the interactive primitives');
} else if (!tapRule) {
  fail('hub.css lost the tap-target floor rule (… { min-height: var(--hub-tap-min) })');
} else {
  fail(`hub.css tap-target selector drifted — a non-interactive selector (e.g. span.jk-bubble) ` +
       `would wrongly inherit the 44px floor.\n    expected: ${EXPECTED_TAP_SELECTOR}\n    got:      ${tapSelector}`);
}

// ── 4. no retired breakpoint literals in migrated layout code ────────────────
// 768 / 880 / 1100 were the three pre-consolidation crossovers. They must now
// come only from the canonical source. Scan the files that used to hardcode them.
const RETIRED = [768, 880, 1100];
const SCANNED = [
  'apps/beigeboard/src/App.tsx',
  'apps/ordeck/src/hud/types.ts',
  'apps/ordeck/src/styles/hud.css',
];
for (const file of SCANNED) {
  let src;
  try { src = read(file); } catch { continue; }
  const hits = RETIRED.filter((n) =>
    new RegExp(`(max-width:\\s*${n}px|max-width:\\s*${n}\\b|>=?\\s*${n}\\b|minWidth:\\s*${n}\\b)`).test(src));
  if (hits.length) {
    fail(`${file} still references retired breakpoint literal(s): ${hits.join(', ')} — ` +
         `import from @jkos/design instead`);
  } else {
    ok(`${file} has no retired breakpoint literals`);
  }
}

// ── 5. buildJkOSTheme emits its responsive overrides at the canonical bounds ──
// The factory's optional `responsive` override emits per-tier scale tokens inside
// `@media (max-width: …)` blocks. Those bounds MUST come from BREAKPOINT_MAX, not
// a hardcoded literal, or an app's responsive tuning would fire at a width the CSS
// `@media` blocks and useBreakpoint don't agree on. Node 20 can't import the .ts,
// so (like the BREAKPOINT_MAX parse above) assert it at the source-text level:
// each emit references `${BREAKPOINT_MAX.<tier>}px` and never a 3+-digit literal.
const buildSrc = read('packages/design/theme/buildTheme.ts');
const emitLines = buildSrc.split('\n').filter((l) => /css \+=.*@media\s*\(max-width:/.test(l));
if (emitLines.length < 2) {
  fail('buildTheme.ts no longer emits both tablet & mobile @media override blocks');
} else {
  const derivesTablet = emitLines.some((l) => /max-width:\s*\$\{BREAKPOINT_MAX\.tablet\}px/.test(l));
  const derivesMobile = emitLines.some((l) => /max-width:\s*\$\{BREAKPOINT_MAX\.mobile\}px/.test(l));
  const hardcoded = emitLines.some((l) => /max-width:\s*\d{3,}px/.test(l));
  if (derivesTablet && derivesMobile && !hardcoded) {
    ok('buildJkOSTheme emits responsive overrides at the canonical BREAKPOINT_MAX bounds');
  } else {
    fail('buildTheme.ts responsive emit drifted from BREAKPOINT_MAX — its @media bounds must ' +
         'interpolate ${BREAKPOINT_MAX.tablet/mobile}px, never a hardcoded breakpoint literal');
  }
}

// ── 6. the @jkos/cards calendar views stay token-only + literal-free ────────
// The calendar primitive is the ONE source for the scheduling look, so its views
// must not reintroduce raw hex colours (every colour is var(--color-*)/var(--hub-*),
// with neutral black/white alpha overlays as the only exception — exactly as
// surface.ts allows) or hardcoded breakpoint numbers. New views (Day/Year) are the
// most likely place this drifts, so scan the whole view set. A `${accent}66` glow
// is a CSS-var interpolation, not a literal, and `rgb(a)(0,0,0/255,255,255,…)` are
// the sanctioned neutral overlays — both pass; a bare `#abc123` does not.
const CARD_VIEWS = [
  'packages/cards/src/DayView.tsx',
  'packages/cards/src/YearView.tsx',
  'packages/cards/src/Calendar.tsx',
  'packages/cards/src/WeekView.tsx',
  'packages/cards/src/CalendarView.tsx',
  'packages/cards/src/sections.ts',
];
for (const file of CARD_VIEWS) {
  let src;
  try { src = read(file); } catch { continue; }
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const hex = stripped.match(/#[0-9a-fA-F]{3,8}\b/g);
  const lits = RETIRED.filter((n) => new RegExp(`(max-width:\\s*${n}\\b|minWidth:\\s*${n}\\b|>=?\\s*${n}\\b)`).test(stripped));
  if (hex) fail(`${file} has raw hex colour(s) ${[...new Set(hex)].join(', ')} — use var(--color-*)/var(--hub-*) (neutral rgba overlays only)`);
  else if (lits.length) fail(`${file} hardcodes breakpoint literal(s) ${lits.join(', ')} — import from @jkos/design`);
  else ok(`${file} is token-only + breakpoint-literal-free`);
}

if (failed) {
  console.error(`\n${failed} responsive conformance check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ responsive conformance: CSS, JS, and app code agree on the canonical breakpoints');
