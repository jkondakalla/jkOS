// Responsive conformance — keeps the ONE breakpoint definition honest.
//
// The viewport axis has two faces that must agree: the JS source
// (packages/design/responsive/breakpoints.ts) and the CSS that reflows cards
// (the `@media` blocks + tap-target rule in packages/design/tokens/hub.css).
// Nothing in the build forces them to match, so this asserts:
//
//   1. hub.css's tablet/mobile `@media (max-width: …)` bounds === BREAKPOINT_MAX
//   2. the interactive-primitive tap-target floor rule still exists
//   3. the retired magic numbers (768 / 880 / 1100) don't reappear as raw
//      breakpoints in BeigeBoard / ORDECK layout code
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

// ── 1. CSS media bounds match the canonical source ──────────────────────────
const hub = read('packages/design/tokens/hub.css');
for (const [tier, px] of Object.entries(BREAKPOINT_MAX)) {
  const re = new RegExp(`@media\\s*\\(max-width:\\s*${px}px\\)`);
  if (re.test(hub)) ok(`hub.css has the ${tier} @media at ${px}px (matches BREAKPOINT_MAX)`);
  else fail(`hub.css is missing a @media (max-width: ${px}px) block for the ${tier} tier — ` +
            `it drifted from BREAKPOINT_MAX.${tier} in responsive/breakpoints.ts`);
}

// ── 2. tap-target floor rule survives ───────────────────────────────────────
if (/button\.jk-bubble[\s\S]*?min-height:\s*var\(--hub-tap-min\)/.test(hub)) {
  ok('hub.css keeps the interactive-primitive tap-target floor (--hub-tap-min)');
} else {
  fail('hub.css lost the tap-target floor rule (button.jk-bubble/.jk-tbtn { min-height: var(--hub-tap-min) })');
}

// ── 3. no retired breakpoint literals in migrated layout code ────────────────
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

if (failed) {
  console.error(`\n${failed} responsive conformance check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ responsive conformance: CSS, JS, and app code agree on the canonical breakpoints');
