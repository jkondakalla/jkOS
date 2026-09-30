// Design-token tier gate — holds the three tiers hub.css is built from, from the file itself.
//
// hub.css's tiers (Stage F, decided 2026-09-16; restructured 2026-09-30):
//   --hub-*    tier 1 · raw values and per-face recipes — the ONLY tier the dark block sets
//   --color-*  tier 2 · what a component reads for a colour: an alias of tier 1, or one
//              formula over it, declared once
//   --jk-*     tier 3 · face-invariant type, geometry and scale — only the viewport tiers
//              re-declare it
//
// A tier that exists only as a naming convention drifts the first time someone is in a
// hurry, and a drifted tier is invisible: the page still renders. So every rule below is
// DERIVED from the declarations, never from a typed list of names:
//
//   1. Every token on :root carries a tier prefix.
//   2. The dark block declares tier 1 only, and nothing the paper face lacks.
//   3. A tier-1 FORMULA (a paper value that reads var()) is restated on dark. One that
//      isn't is the same formula on both faces — which is tier 2's definition, so it is
//      wearing the wrong prefix. This is the old accent-family set-parity (ARCH-6: add
//      `--hub-amber-ultra` to paper, forget dark, and the faces silently disagree),
//      generalised so a new family needs no edit here.
//   4. Tier 1 never reads tier 2. The chain runs one way; a cycle through it makes every
//      token in the loop invalid at computed time with no error (jkAuth lost every accent
//      surface to exactly that — see its style.css).
//   5. The viewport @media blocks re-declare tier 3 only.
//   6. ONE NAME PER VALUE. A tier-1 token that tier 2 aliases one-to-one
//      (`--color-ink: var(--hub-ink)`) is private to hub.css: nothing else may read it.
//      That rule is what collapsed four accent schemes into one, and it is what lets a
//      subtree re-point a colour by setting the one name every component reads.
//      And every read of a --hub-* / --color-* name resolves to a token hub.css declares.
//      Those prefixes are reserved for tokens, so an unknown one is a typo or a rename
//      that missed a file — and it renders its fallback (or nothing) with no error. The
//      new-app template read `--hub-bg`, `--hub-ink` and `--hub-surface`, none of which
//      ever existed, so every scaffolded app painted its hard-coded fallbacks.
//   7. CRT knob OWNERSHIP (BUG-8): hub.css owns the base scanline/vignette knobs on both
//      faces, and `@jkos/ui/tokens.css` takes exactly ONE sanctioned opt-out.
//
// Run:  node test/tokens-parity.mjs   (wired into `pnpm check:tokens`).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const hub = read('packages/design/tokens/hub.css');

// ── Where each token is declared ────────────────────────────────────────────
// A small walk over the file's rule structure: comments stripped, braces counted, each
// `:root` rule classified by its selector and the at-rule around it. Every token block
// in hub.css is FLAT (declarations only — color-mix()/url() use parens, never braces),
// so a rule's body runs from its `{` to its matching `}`.
function tokenRules(css) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') {
      const prelude = code.slice(start, i).trim();
      stack.push({ prelude, open: i });
      start = i + 1;
    } else if (ch === '}') {
      const rule = stack.pop();
      if (rule && /^:root/.test(rule.prelude)) {
        const at = stack.map((r) => r.prelude).find((p) => p.startsWith('@')) || '';
        out.push({ selector: rule.prelude, at, body: code.slice(rule.open + 1, i) });
      }
      start = i + 1;
    } else if (ch === ';' && !stack.length) {
      start = i + 1;
    }
  }
  return out;
}
const decls = (body) => new Map([...body.matchAll(/(?:^|[;{\s])--([\w-]+)\s*:([^;]*)/g)].map((m) => [m[1], m[2].trim()]));
const merge = (rules) => new Map(rules.flatMap((r) => [...decls(r.body)]));

const rules = tokenRules(hub);
const top = rules.filter((r) => !r.at);
const paper = merge(top.filter((r) => r.selector === ':root'));
const dark = merge(top.filter((r) => r.selector === ':root[data-mode="dark"]'));
const supports = merge(rules.filter((r) => r.at.startsWith('@supports') && r.selector === ':root'));
const media = merge(rules.filter((r) => r.at.startsWith('@media') && r.selector === ':root'));
const stray = top.filter((r) => r.selector !== ':root' && r.selector !== ':root[data-mode="dark"]'
  && decls(r.body).size && [...decls(r.body).keys()].some((n) => /^(hub|color|jk)-/.test(n)));

if (!paper.size || !dark.size) fail('could not locate hub.css\'s paper or dark token blocks — the walk is broken');

const TIER = (n) => (n.startsWith('hub-') ? 1 : n.startsWith('color-') ? 2 : n.startsWith('jk-') ? 3 : 0);
const list = (names) => names.map((n) => '--' + n).join(', ');

// ── 1. Every token carries its tier ─────────────────────────────────────────
{
  const all = new Set([...paper.keys(), ...dark.keys(), ...supports.keys(), ...media.keys()]);
  const untiered = [...all].filter((n) => !TIER(n)).sort();
  if (untiered.length) fail(`token(s) with no tier prefix (--hub- / --color- / --jk-): ${list(untiered)}`);
  else ok(`all ${all.size} tokens carry a tier prefix (${[1, 2, 3].map((t) => [...all].filter((n) => TIER(n) === t).length).join(' / ')} in tiers 1 / 2 / 3)`);
  if (stray.length) fail(`a tier token is declared on a selector other than :root / :root[data-mode="dark"]: ${stray.map((r) => r.selector).join(', ')}`);
}

// ── 2. The dark block is tier 1, and a subset of paper ──────────────────────
{
  const notT1 = [...dark.keys()].filter((n) => TIER(n) !== 1).sort();
  const darkOnly = [...dark.keys()].filter((n) => !paper.has(n)).sort();
  if (notT1.length) fail(`the dark block declares non-tier-1 token(s): ${list(notT1)}\n` +
    '  → a --color-* re-resolves on its own through the tier-1 values under it, and a --jk-* is\n' +
    '    the same on both faces by definition. Move the per-face value into a --hub-* token.');
  else ok(`the dark block declares tier 1 only (${dark.size} tokens)`);
  if (darkOnly.length) fail(`the dark block declares token(s) the paper face never defines: ${list(darkOnly)}`);
  else ok('every dark token has a paper value');
}

// ── 3. A tier-1 formula is restated on dark ─────────────────────────────────
{
  const formulas = [...paper].filter(([n, v]) => TIER(n) === 1 && /var\(/.test(v)).map(([n]) => n);
  const unrestated = formulas.filter((n) => !dark.has(n)).sort();
  if (unrestated.length) fail(`tier-1 formula(s) with no dark restatement: ${list(unrestated)}\n` +
    '  → either the dark face needs its own mix constants here, or this is the same formula on\n' +
    '    both faces — tier 2 — and should be a --color-* token.');
  else ok(`all ${formulas.length} tier-1 formulas are restated on the dark face`);
}

// ── 4. Tier 1 never reads tier 2 ────────────────────────────────────────────
{
  const upward = [...paper, ...dark].filter(([n, v]) => TIER(n) === 1 && /var\(\s*--color-/.test(v)).map(([n]) => n);
  if (upward.length) fail(`tier-1 token(s) reading a --color-* token: ${list([...new Set(upward)].sort())}`);
  else ok('tier 1 reads only tier 1 — the chain runs one way');
}

// ── 5. The viewport tiers re-declare tier 3 only ────────────────────────────
{
  const bad = [...media.keys()].filter((n) => TIER(n) !== 3).sort();
  if (bad.length) fail(`an @media :root block re-declares non-tier-3 token(s): ${list(bad)}`);
  else ok(`the viewport @media blocks re-declare tier 3 only (${media.size} tokens)`);
}

// ── 6. One name per value: an aliased tier-1 token is private to hub.css ─────
{
  const privateNames = new Map();
  for (const [n, v] of paper) {
    const m = TIER(n) === 2 && v.match(/^var\(\s*--(hub-[\w-]+)\s*\)$/);
    if (m) privateNames.set(m[1], n);
  }
  const SKIP = [/^packages\/design\/tokens\/hub\.css$/, /(^|\/)jkos-tokens\.css$/,
    /^apps\/jkauth\/public\/design\.html$/, /computed-baseline\.json$/, /\.md$/,
    /^test\/tokens-parity\.mjs$/];
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(css|tsx?|jsx?|mjs|cjs|html|py)$/.test(f) && !SKIP.some((r) => r.test(f)));
  const reads = new RegExp(`(?:var\\(\\s*|getPropertyValue\\(\\s*['"\`])--(${[...privateNames.keys()].join('|')})(?![\\w-])`, 'g');
  const hits = [];
  for (const f of files) {
    let text; try { text = read(f); } catch { continue; }
    for (const m of text.matchAll(reads)) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(`${f}:${line}  --${m[1]} → read --${privateNames.get(m[1])}`);
    }
  }
  if (hits.length) {
    fail(`${hits.length} read(s) of a tier-1 token that tier 2 already names — use the one consumer name:`);
    for (const h of hits.slice(0, 30)) console.error(`    ${h}`);
    if (hits.length > 30) console.error(`    … and ${hits.length - 30} more`);
  } else {
    ok(`${privateNames.size} aliased tier-1 tokens are read only inside hub.css (${files.length} files scanned)`);
  }

  const declared = new Set([...paper.keys(), ...dark.keys(), ...supports.keys(), ...media.keys()]);
  const unknown = [];
  for (const f of files) {
    let text; try { text = read(f); } catch { continue; }
    for (const m of text.matchAll(/var\(\s*--((?:hub|color)-[\w-]+)/g)) {
      if (declared.has(m[1])) continue;
      unknown.push(`${f}:${text.slice(0, m.index).split('\n').length}  --${m[1]}`);
    }
  }
  if (unknown.length) {
    fail(`${unknown.length} read(s) of a --hub-* / --color-* name that hub.css does not declare:`);
    for (const u of unknown.slice(0, 30)) console.error(`    ${u}`);
  } else {
    ok('every --hub-* / --color-* read in the repo resolves to a declared token');
  }
}

// ── 7. CRT knob ownership (BUG-8) ───────────────────────────────────────────
const CRT_BASE = ['hub-crt-scanline-opacity', 'hub-crt-vignette-opacity'];
for (const knob of CRT_BASE) {
  const inPaper = paper.has(knob);
  const inDark = dark.has(knob);
  if (inPaper && inDark) ok(`hub.css owns --${knob} on BOTH faces (base owner)`);
  else fail(`--${knob} must be defined in hub.css's ${!inPaper ? 'paper' : 'dark'} block — hub.css owns the CRT base`);
}

const uiTokens = read('packages/ui/src/tokens.css');
// Strip comments so the prose ("Any NEW CRT knob belongs in hub.css") can't trip
// the scan — only real `--hub-crt-*:` definitions count.
const uiCode = uiTokens.replace(/\/\*[\s\S]*?\*\//g, '');
const uiCrt = [...new Set([...uiCode.matchAll(/--((?:hub-)?crt-[\w-]+)\s*:/g)].map((m) => m[1]))].sort();
const SANCTIONED = 'hub-crt-vignette-opacity';
const extra = uiCrt.filter((n) => n !== SANCTIONED);
if (uiCrt.length === 1 && uiCrt[0] === SANCTIONED)
  ok(`@jkos/ui/tokens.css takes exactly its ONE sanctioned CRT opt-out (--${SANCTIONED})`);
else if (!uiCrt.includes(SANCTIONED))
  fail(`@jkos/ui/tokens.css no longer sets its sanctioned --${SANCTIONED} opt-out (found: ${uiCrt.map((n) => '--' + n).join(', ') || 'none'})`);
else
  fail(`@jkos/ui/tokens.css re-overrides CRT knobs beyond its sanctioned opt-out: ${extra.map((n) => '--' + n).join(', ')}\n` +
    `  → these belong in hub.css (the base owner) so atmosphere can't fork between import paths. See DESIGN.md § "CRT knob ownership".`);

// ── 3. Full Press face checks (Wave 22, 2026-07-19) ─────────────────────────
// The Voice: humans read PRINT (--jk-font-serif, Fraunces by default), the
// machine speaks MONO (.jk-pill keeps its mono face; .jk-mono-eyebrow is untouched
// by doctrine), the tube EMITS (.jk-seg keeps Big Shoulders + glow in dark while
// paper prints serif lining figures — "the seg verdict"). These pins stop a
// future cleanup from quietly un-cutting the press or re-facing the machine.
{
  const hubCode = hub.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (selector) => {
    const m = hubCode.match(new RegExp(selector.replace(/[.[\]()*+?^$\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
  };

  const serifDef = paper.get('jk-font-serif');
  if (serifDef && /^['"]Fraunces['"]/.test(serifDef))
    ok('--jk-font-serif defaults to the Fraunces stack (the print voice is the default)');
  else
    fail(`--jk-font-serif no longer defaults to Fraunces (got: ${serifDef || 'missing'}) — ` +
         'Full Press promoted the serif to a suite default; apps only override via the factory fonts.serif input');

  // The seg verdict — one class, two faces.
  const segBase = ruleOf('.jk-seg');
  const segPaper = ruleOf(':root:not([data-mode="dark"]) .jk-seg');
  if (segBase && /var\(--jk-font-seg\)/.test(segBase))
    ok('.jk-seg keeps the phosphor face (--jk-font-seg) as its base — the tube still emits');
  else
    fail('.jk-seg no longer reads --jk-font-seg — the dark-face readout lost its phosphor numerals');
  if (segPaper && /var\(--jk-font-serif\)/.test(segPaper) && /text-shadow:\s*none/.test(segPaper))
    ok('paper .jk-seg override prints serif lining figures with no glow (the seg verdict holds)');
  else
    fail('the paper .jk-seg override (:root:not([data-mode="dark"]) .jk-seg) must set font-family: ' +
         'var(--jk-font-serif) and text-shadow: none — the readout face splits by medium');

  // Print voice on the re-cut primitives; mono voice retained where doctrine says.
  for (const cls of ['.jk-lab', '.jk-tbtn', '.jk-bubble', '.jk-stamp']) {
    const body = ruleOf(cls);
    if (body && /var\(--jk-font-serif\)/.test(body)) ok(`${cls} is set in print (var(--jk-font-serif))`);
    else fail(`${cls} no longer reads var(--jk-font-serif) — the Full Press voice was un-cut`);
  }
  const pill = ruleOf('.jk-pill');
  if (pill && /var\(--jk-font-mono\)/.test(pill))
    ok('.jk-pill keeps the machine\'s mono voice (a status, not prose)');
  else
    fail('.jk-pill must stay in var(--jk-font-mono) — the machine speaks mono');

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
console.log('\n✓ tokens-parity: hub.css\'s three tiers hold, and every consumer reads the one name');
