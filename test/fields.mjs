// Field-primitive conformance gate — `pnpm check:fields`, folded into
// `pnpm test:contracts`.
//
// WHY THIS EXISTS
// Until 2026-08-17 the suite shipped .jk-switch / .jk-check / .jk-slider / .jk-vu
// and NO primitive for the half of the control set the user actually writes into.
// ~137 inputs had grown five app-local dialects — BeigeBoard's `parts.tsx`
// field/numField/textField, ORDECK's Inspector `field`, its registry `fieldStyle`
// and WidgetWorkshop's third copy, jkAuth's `input[type=...]` element selectors,
// and @jkos/ui's own .jk-match-input — each redrawing the border, the fill and the
// focus state by hand, and NOT ONE of them resetting `appearance`. So under every
// hand-drawn hairline the engine kept painting its own control: the white number
// spinners that started this, plus the OS select arrow, the search ×, autofill
// yellow, and a system-blue highlight inside every time field.
//
// A sixth dialect is one hurried afternoon away, and the failure mode is silent —
// it looks fine on the machine of whoever wrote it. So this scans for the shapes
// that regression takes:
//
//   1. a raw <input>/<select>/<textarea> that carries no jk-field class
//   2. native chrome addressed anywhere but hub.css (appearance resets, vendor
//      pseudo-elements, scrollbar parts, accent-color/color-scheme)
//   3. hub.css losing the parts that make the family work at all — the two-face
//      token pair, `color-scheme` in BOTH root blocks, the bare modifier
//   4. a vendor pseudo-element rule that groups selectors ACROSS engines, which
//      silently drops the whole declaration on both
//   5. a primitive that exists in primitives.tsx but never reaches the barrel
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

// Per project convention these two are out of scope for suite-wide sweeps.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'sylibos', 'lazuros']);

function sources(dir, exts) {
  const out = [];
  let ents;
  try { ents = readdirSync(resolve(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const ent of ents) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...sources(p, exts));
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}

const SCAN_ROOTS = ['apps/beigeboard/src', 'apps/ordeck/src', 'apps/jkauth/src',
                    'apps/jkauth/public', 'packages/ui/src', 'packages/cards/src',
                    'packages/design/tokens', 'jkos-deploy'];

const hub = readFileSync(resolve(root, 'packages/design/tokens/hub.css'), 'utf8');

/* ── 1. Every rendered input goes through the primitive ────────────────────
   `type="hidden"` is exempt and only that: it renders nothing, so there is no
   paint to take away. The exemption is matched on the same tag, not on the
   file, so it cannot be used to wave a visible field through. */
{
  const files = SCAN_ROOTS.flatMap((d) => sources(d, ['.tsx', '.jsx', '.js', '.html']));
  const offenders = [];
  for (const rel of files) {
    // primitives.tsx is where the class is PUT ON; design.html is generated from
    // the template, which is scanned in its own right.
    if (rel.endsWith('packages/ui/src/primitives.tsx') || rel.endsWith('primitives.tsx')) continue;
    if (rel.endsWith('public/design.html')) continue;
    const src = readFileSync(resolve(root, rel), 'utf8');
    // Each opening tag with its attributes, across newlines.
    for (const m of src.matchAll(/<(input|select|textarea)(\s[^>]*?)?\/?>/gs)) {
      const attrs = m[2] || '';
      if (/type\s*=\s*["']hidden["']/.test(attrs)) continue;
      if (/\bjk-field\b/.test(attrs)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line}  <${m[1]}> with no jk-field class`);
    }
  }
  if (offenders.length) {
    fail(`${offenders.length} raw form element(s) bypass the field primitive:`);
    for (const o of offenders.slice(0, 20)) console.error(`      ${o}`);
    if (offenders.length > 20) console.error(`      … and ${offenders.length - 20} more`);
    console.error('    Use <Field>/<NumField>/<SelectField>/<TextArea>/<DateField>/<TimeField>/');
    console.error('    <SearchField> from @jkos/ui, or `bare` for an edit inside running text.');
  } else {
    ok(`every rendered input/select/textarea in the suite goes through .jk-field (${files.length} files scanned)`);
  }
}

/* ── 2. Native chrome is addressed in exactly one file ─────────────────────
   These are the levers over engine-drawn UI. Spread across apps they drift and
   fight (BeigeBoard's scrollbar block was already a different width from the
   suite's, and covered neither Firefox nor the corner). */
{
  const NATIVE = [
    [/(?:^|[^-\w])-?(?:webkit-|moz-)?appearance\s*:/m, 'an `appearance` reset'],
    [/::-webkit-(?:inner|outer)-spin-button/, 'a spin-button rule'],
    [/::-webkit-scrollbar/, 'a scrollbar rule'],
    [/scrollbar-(?:width|color)\s*:/, 'a Firefox scrollbar property'],
    [/::-webkit-datetime-edit/, 'a datetime-segment rule'],
    [/::-webkit-calendar-picker-indicator/, 'a picker-indicator rule'],
    [/::(?:-webkit-)?file-(?:selector|upload)-button/, 'a file-button rule'],
    [/::picker\s*\(/, 'a ::picker(select) rule'],
    [/\bcolor-scheme\s*:/, 'a color-scheme declaration'],
  ];
  const cssFiles = SCAN_ROOTS.flatMap((d) => sources(d, ['.css']))
    .filter((f) => !f.endsWith('tokens/hub.css'))
    // The two generated mirrors are copies of hub.css by construction.
    .filter((f) => !f.endsWith('jkos-tokens.css'));
  const offenders = [];
  for (const rel of cssFiles) {
    const src = readFileSync(resolve(root, rel), 'utf8');
    for (const [re, what] of NATIVE) if (re.test(src)) offenders.push(`${rel} — ${what}`);
  }
  if (offenders.length) {
    fail(`native-chrome styling outside hub.css (${offenders.length}):`);
    for (const o of offenders) console.error(`      ${o}`);
    console.error('    hub.css owns every engine-drawn surface; an app-local copy drifts silently.');
  } else {
    ok(`native chrome is addressed only in hub.css (${cssFiles.length} other stylesheets clean)`);
  }
}

/* ── 3. hub.css still carries the load-bearing parts ───────────────────────── */
{
  const darkBlock = hub.slice(hub.indexOf(':root[data-mode="dark"] {'));
  const darkRoot = darkBlock.slice(0, darkBlock.indexOf('\n}'));
  const lightRoot = hub.slice(hub.indexOf(':root {'), hub.indexOf(':root[data-mode="dark"] {'));

  const pairs = ['--hub-field-face', '--hub-field-recess', '--hub-field-face-focus', '--hub-field-recess-focus'];
  const missing = pairs.filter((t) => !darkRoot.includes(`${t}:`));
  if (missing.length) {
    fail(`the CRT face re-uses paper's recess for: ${missing.join(', ')}`);
    console.error('    Each must be overridden in the dark block with the tube\'s OWN recipe.');
    console.error('    Re-tinting the paper bevel is what makes a dark field read as a light');
    console.error('    one with the colours swapped — there is no raking light on a CRT.');
  } else {
    ok('the field recess is a two-face token pair — all 4 overridden in the dark block');
  }

  // The single declaration that governs every popup no selector can reach.
  if (/color-scheme\s*:\s*light/.test(lightRoot) && /color-scheme\s*:\s*dark/.test(darkRoot)) {
    ok('color-scheme is declared in BOTH root blocks — engine popups follow the face');
  } else {
    fail('color-scheme is missing from a :root block');
    console.error('    Without it the select picker, the date/time calendars and the autofill');
    console.error('    dropdown come back white on the tube regardless of the surrounding CSS.');
  }

  for (const [cls, why] of [
    ['.jk-field-bare', 'the reset-without-the-slot modifier'],
    ['.jk-field-step', 'the drawn number stepper'],
    ['.jk-field-sel', 'the select wrapper'],
    ['.jk-fold', 'the <details> marker'],
  ]) {
    if (hub.includes(`${cls} `) || hub.includes(`${cls},`) || hub.includes(`${cls}:`) || hub.includes(`${cls}{`)) {
      ok(`hub.css ships ${cls} — ${why}`);
    } else {
      fail(`hub.css lost ${cls} (${why})`);
    }
  }
}

/* ── 4. No vendor pseudo grouped across engines ────────────────────────────
   A selector list is dropped ENTIRELY by any engine that cannot parse one of its
   selectors. Group a -webkit- pseudo with a -moz- one and both engines throw the
   rule away — the styling vanishes in every browser, which is why the slider's
   track/thumb pairs are declared separately and why the datetime segments are. */
{
  const bad = [];
  // Comments first: this file's section headers are drawn with commas and name
  // the very vendor prefixes being looked for, so scanning raw text reports the
  // documentation as the defect.
  const decommented = hub.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of decommented.matchAll(/^([^{}\n][^{}]*?)\{/gm)) {
    const sel = m[1];
    if (!sel.includes(',')) continue;
    const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
    const webkit = parts.some((p) => p.includes('-webkit-'));
    const moz = parts.some((p) => p.includes('-moz-'));
    if (webkit && moz) bad.push(sel.trim().replace(/\s+/g, ' ').slice(0, 90));
  }
  if (bad.length) {
    fail(`${bad.length} rule(s) group -webkit- and -moz- selectors — both engines drop them:`);
    for (const b of bad) console.error(`      ${b}`);
  } else {
    ok('no vendor pseudo-element rule mixes engines in one selector list');
  }
}

/* ── 5. Every field primitive reaches the barrel ───────────────────────────── */
{
  const prims = readFileSync(resolve(root, 'packages/ui/src/primitives.tsx'), 'utf8');
  const barrel = readFileSync(resolve(root, 'packages/ui/src/index.ts'), 'utf8');
  const NAMES = ['Field', 'NumField', 'SelectField', 'TextArea', 'DateField', 'TimeField', 'SearchField', 'Fold'];
  const missing = NAMES.filter((n) => !new RegExp(`export const ${n}\\b`).test(prims));
  const unexported = NAMES.filter((n) => !new RegExp(`\\b${n}\\b`).test(barrel));
  if (missing.length) fail(`primitives.tsx is missing: ${missing.join(', ')}`);
  else if (unexported.length) fail(`@jkos/ui/index.ts never re-exports: ${unexported.join(', ')}`);
  else ok(`all ${NAMES.length} field primitives are defined and re-exported from @jkos/ui`);

  // The ref trap: React strips `ref` from a plain function component's props, so
  // a wrapper that forgets forwardRef swallows it with no error at all.
  const notForwarded = NAMES.filter((n) => !new RegExp(`export const ${n} = forwardRef<`).test(prims));
  if (notForwarded.length) {
    fail(`these field primitives do not forwardRef: ${notForwarded.join(', ')}`);
    console.error('    A form primitive that swallows the ref fails SILENTLY — the caller');
    console.error('    reaches for .focus()/.select()/a measurement and gets null.');
  } else {
    ok('every field primitive forwards its ref');
  }
}

console.log(failed
  ? `\n${failed} field check(s) failed.`
  : '\n✓ fields: one primitive, two faces, no native chrome left showing');
process.exit(failed ? 1 : 0);
