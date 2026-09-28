// Widget factory conformance — what an ORDECK widget may do, held in code.
//
// A widget is data: a spec an agent committed, an admin published, or (later) a model
// emitted. Everything it can make the browser do is decided by the renderer, so the
// renderer's guarantees are what this gate pins.
//
//   1. HREFS. `link.href`, `frame.href` and Focus's deeplink resolve from live data,
//      and React 18 renders a `javascript:` URL with only a dev-mode warning. The REAL
//      safeHref (transpiled, not re-implemented) must keep http(s)/mailto/relative and
//      refuse every other scheme, including the spellings a browser normalises
//      (`java\tscript:`, leading whitespace, mixed case). And every dynamic href in the
//      widget renderer must pass through it — a new primitive that renders
//      `href={resolve(…)}` directly is the regression this catches.
//
// Run:  node test/widgets.mjs      (wired as `pnpm check:widgets`, folded into
//                                   `pnpm test:contracts`)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unit, REPO_ROOT } from './lib/unit.mjs';

const { check, importTs, done } = unit('widgets');

// ── 1. hrefs ────────────────────────────────────────────────────────────────
const { safeHref } = await importTs('apps/ordeck/src/hud/safeHref.ts', 'safeHref.mjs');

const KEEP = [
  'https://kouros.jkos.net/', 'http://localhost:3000/x', 'mailto:jag@example.com',
  '/widgets', './x', '../y', '?q=1', '#top', 'relative/path', '//cdn.example.com/a',
];
for (const h of KEEP) check(safeHref(h) === h, `keeps ${JSON.stringify(h)}`);
check(safeHref('  https://x.test/  ') === 'https://x.test/', 'trims surrounding whitespace');

const REFUSE = [
  'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
  'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)', 'file:///etc/passwd', 'blob:https://x.test/uuid',
];
for (const h of REFUSE) check(safeHref(h) === undefined, `refuses ${JSON.stringify(h)}`);
for (const v of [undefined, null, 42, {}, [], '', '   ']) check(safeHref(v) === undefined, `no href for ${JSON.stringify(v)}`);

// Every dynamic href in the widget renderer goes through safeHref.
const HUD = join(REPO_ROOT, 'apps/ordeck/src/hud');
for (const f of readdirSync(HUD).filter((n) => n.endsWith('.tsx'))) {
  const src = readFileSync(join(HUD, f), 'utf8');
  for (const [, expr] of src.matchAll(/href=\{([^}]*)\}/g)) {
    const ok = /^\s*safeHref\(/.test(expr) || /^\s*href\s*$/.test(expr) && /const href = [^;]*safeHref\(/.test(src);
    check(ok, `hud/${f}: href={${expr.trim()}} passes through safeHref`);
  }
}

done();
