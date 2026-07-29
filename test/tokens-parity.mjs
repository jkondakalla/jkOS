// Design-system parity gate — keeps hub.css's two mode blocks from silently drifting.
//
// hub.css defines the atmosphere twice: a paper `:root {…}` block and a CRT
// `:root[data-mode="dark"] {…}` block. Most of the derivation is written ONCE and
// re-resolves per mode through lazy `var()` (the `--color-*` aliases point at
// `--hub-amber`, which each block redefines). But the ACCENT-DERIVATION FAMILY —
// `--accent`, the `--hub-amber-*`/`--hub-cyan-*` scales, the halation tokens, the
// accent-press/ink/contrast flips — is hand-restated in BOTH blocks with DIFFERENT
// mix constants (paper deepens toward ink; dark uses the raw pair + glow). That
// hand-restating is the drift surface ARCH-6 flags: add `--hub-amber-ultra` to the
// paper family and forget the dark block and the two modes silently disagree, with
// no failing gate. So this asserts:
//
//   1. SET-PARITY of the accent-derivation family: the family vars defined in the
//      paper block === the family vars defined in the dark block (VALUES may differ
//      by design — this is set-parity, not value-parity). Membership is by naming
//      convention (below), so a new `--hub-amber-*`/`--hub-cyan-*`/`--accent-halo*`
//      is auto-covered; a genuinely new family PREFIX means extending FAMILY here.
//   2. CRT knob OWNERSHIP (BUG-8): hub.css owns the base `--crt-scanline-opacity`
//      / `--crt-vignette-opacity` in BOTH modes, and `@jkos/ui/tokens.css` takes
//      exactly ONE sanctioned opt-out (`--crt-vignette-opacity`) and re-overrides
//      no other CRT knob — so the atmosphere can't fork between import paths.
//
// This is the cheap drift-catcher ARCH-6 step 1 calls for (before any move to
// generating the dark block from buildTheme). See DESIGN.md § "CRT knob ownership".
//
// Run:  node test/tokens-parity.mjs   (wired into `pnpm check:tokens`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const hub = read('packages/design/tokens/hub.css');

// ── Extract each mode's top-level rule block ────────────────────────────────
// Both blocks are FLAT (declarations only — color-mix()/url() use parens, never
// braces), so the block runs from its selector's `{` to the next `}`. The paper
// matcher requires `{` right after `:root` so it never catches `:root[data-mode…`;
// the dark matcher requires `{` right after `]` so it never catches the later
// descendant rules (`:root[data-mode="dark"] .jk-glow {…}`).
function block(css, selectorRe, label) {
  const m = selectorRe.exec(css);
  if (!m) { fail(`could not locate the ${label} block in hub.css`); return ''; }
  const open = m.index + m[0].length;
  const close = css.indexOf('}', open);
  if (close === -1) { fail(`${label} block in hub.css is unterminated`); return ''; }
  return css.slice(open, close);
}
const paper = block(hub, /:root\s*\{/, 'paper :root');
const dark = block(hub, /:root\[data-mode="dark"\]\s*\{/, 'dark :root[data-mode="dark"]');

// Custom-property DEFINITIONS in a block (`--name:` — the `)` before any color-mix
// colon means a var() usage is never mistaken for a def).
const defsOf = (css) => new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((x) => x[1]));

// ── 1. Accent-derivation family set-parity ──────────────────────────────────
// Family = the vars that carry per-mode mix constants and so are restated in both
// blocks. Amber/cyan scales + the raw accents are prefix-detected (self-covering);
// the accent-press glow and the two accent TEXT flips (ink darkens on paper /
// lightens on CRT, contrast inverts) are named explicitly — the sibling
// `--color-accent-{soft,dim,glow,…}` are paper-only lazy passthroughs, NOT family.
const EXPLICIT = new Set(['hub-accent-press', 'color-accent-ink', 'color-accent-contrast']);
const isFamily = (n) =>
  n === 'accent' || n === 'accent-secondary' ||
  n.startsWith('accent-halo') ||
  n.startsWith('hub-amber') ||
  n.startsWith('hub-cyan') ||
  EXPLICIT.has(n);
const family = (css) => new Set([...defsOf(css)].filter(isFamily));

const fPaper = family(paper);
const fDark = family(dark);
const onlyPaper = [...fPaper].filter((n) => !fDark.has(n)).sort();
const onlyDark = [...fDark].filter((n) => !fPaper.has(n)).sort();

if (fPaper.size === 0 || fDark.size === 0) {
  fail('accent-derivation family came up empty — the family matcher or block extraction is broken');
} else if (onlyPaper.length === 0 && onlyDark.length === 0) {
  ok(`accent-derivation family is set-parity across paper/dark (${fPaper.size} vars each)`);
} else {
  if (onlyPaper.length)
    fail(`accent vars in the PAPER block but not restated in DARK: ${onlyPaper.map((n) => '--' + n).join(', ')}\n` +
      `  → add each to the :root[data-mode="dark"] derivation with its dark mix constant (or, if it should\n` +
      `    resolve lazily, drop it from paper too). A missing dark restatement silently reuses the paper mix.`);
  if (onlyDark.length)
    fail(`accent vars in the DARK block but not defined in PAPER: ${onlyDark.map((n) => '--' + n).join(', ')}\n` +
      `  → the dark block is deriving something the paper baseline lacks; add the paper counterpart.`);
}

// ── 2. CRT knob ownership (BUG-8) ───────────────────────────────────────────
const CRT_BASE = ['crt-scanline-opacity', 'crt-vignette-opacity'];
for (const knob of CRT_BASE) {
  const inPaper = defsOf(paper).has(knob);
  const inDark = defsOf(dark).has(knob);
  if (inPaper && inDark) ok(`hub.css owns --${knob} in BOTH modes (base owner)`);
  else fail(`--${knob} must be defined in hub.css's ${!inPaper ? 'paper' : 'dark'} block — hub.css owns the CRT base`);
}

const uiTokens = read('packages/ui/src/tokens.css');
// Strip comments so the prose ("Any NEW CRT knob belongs in hub.css") can't trip
// the scan — only real `--crt-*:` definitions count.
const uiCode = uiTokens.replace(/\/\*[\s\S]*?\*\//g, '');
const uiCrt = [...new Set([...uiCode.matchAll(/--(crt-[\w-]+)\s*:/g)].map((m) => m[1]))].sort();
const SANCTIONED = 'crt-vignette-opacity';
const extra = uiCrt.filter((n) => n !== SANCTIONED);
if (uiCrt.length === 1 && uiCrt[0] === SANCTIONED)
  ok(`@jkos/ui/tokens.css takes exactly its ONE sanctioned CRT opt-out (--${SANCTIONED})`);
else if (!uiCrt.includes(SANCTIONED))
  fail(`@jkos/ui/tokens.css no longer sets its sanctioned --${SANCTIONED} opt-out (found: ${uiCrt.map((n) => '--' + n).join(', ') || 'none'})`);
else
  fail(`@jkos/ui/tokens.css re-overrides CRT knobs beyond its sanctioned opt-out: ${extra.map((n) => '--' + n).join(', ')}\n` +
    `  → these belong in hub.css (the base owner) so atmosphere can't fork between import paths. See DESIGN.md § "CRT knob ownership".`);

// ── 3. Full Press face checks (Wave 22, 2026-07-19) ─────────────────────────
// The Voice: humans read PRINT (--hub-font-serif, Fraunces by default), the
// machine speaks MONO (.jk-pill keeps its mono face; .mono-eyebrow is untouched
// by doctrine), the tube EMITS (.seg keeps Big Shoulders + glow in dark while
// paper prints serif lining figures — "the seg verdict"). These pins stop a
// future cleanup from quietly un-cutting the press or re-facing the machine.
{
  const hubCode = hub.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (selector) => {
    const m = hubCode.match(new RegExp(selector.replace(/[.[\]()*+?^$\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
  };

  const serifDef = paper.match(/--hub-font-serif\s*:\s*([^;]+);/);
  if (serifDef && /^['"]Fraunces['"]/.test(serifDef[1].trim()))
    ok('--hub-font-serif defaults to the Fraunces stack (the print voice is the default)');
  else
    fail(`--hub-font-serif no longer defaults to Fraunces (got: ${serifDef ? serifDef[1].trim() : 'missing'}) — ` +
         'Full Press promoted the serif to a suite default; apps only override via the factory fonts.serif input');

  // The seg verdict — one class, two faces.
  const segBase = ruleOf('.seg');
  const segPaper = ruleOf(':root:not([data-mode="dark"]) .seg');
  if (segBase && /var\(--hub-font-seg\)/.test(segBase))
    ok('.seg keeps the phosphor face (--hub-font-seg) as its base — the tube still emits');
  else
    fail('.seg no longer reads --hub-font-seg — the dark-face readout lost its phosphor numerals');
  if (segPaper && /var\(--hub-font-serif\)/.test(segPaper) && /text-shadow:\s*none/.test(segPaper))
    ok('paper .seg override prints serif lining figures with no glow (the seg verdict holds)');
  else
    fail('the paper .seg override (:root:not([data-mode="dark"]) .seg) must set font-family: ' +
         'var(--hub-font-serif) and text-shadow: none — the readout face splits by medium');

  // Print voice on the re-cut primitives; mono voice retained where doctrine says.
  for (const cls of ['.jk-lab', '.jk-tbtn', '.jk-bubble', '.stamp']) {
    const body = ruleOf(cls);
    if (body && /var\(--hub-font-serif\)/.test(body)) ok(`${cls} is set in print (var(--hub-font-serif))`);
    else fail(`${cls} no longer reads var(--hub-font-serif) — the Full Press voice was un-cut`);
  }
  const pill = ruleOf('.jk-pill');
  if (pill && /var\(--hub-font-mono\)/.test(pill))
    ok('.jk-pill keeps the machine\'s mono voice (a status, not prose)');
  else
    fail('.jk-pill must stay in var(--hub-font-mono) — the machine speaks mono');

  // The print marks exist.
  for (const cls of ['.jk-rule', '.jk-rule-strong', '.jk-rule-double', '.jk-folio', '.jk-colophon']) {
    if (ruleOf(cls) !== null) ok(`${cls} print mark present`);
    else fail(`${cls} is missing from hub.css — the Full Press print marks were dropped`);
  }
}

// ── summary ─────────────────────────────────────────────────────────────────
if (failed) {
  console.error(`\n✗ tokens-parity: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ tokens-parity: hub.css mode blocks are in derivation + CRT-ownership parity');
