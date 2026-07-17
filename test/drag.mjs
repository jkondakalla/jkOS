// Drag conformance — keeps the suite on ONE gesture engine.
//
// BeigeBoard's calendar and ORDECK's widget grid used to hand-roll two separate
// drag engines on incompatible event models (mouse vs pointer); only ORDECK's
// worked on touch. They now share @jkos/ui's usePointerDrag, which is what makes
// the calendar mobile-ready. Nothing in the build forces them to keep sharing it,
// so this asserts:
//
//   1. usePointerDrag exists and exports the named activation constants
//      (DRAG_THRESHOLD_PX / HOLD_MS / HOLD_CANCEL_PX) — the one source of truth.
//   2. Both drop-layers (the calendar's CalendarDragProvider and ORDECK's
//      HudGrid) import usePointerDrag from @jkos/ui — neither forks its own.
//   3. No hand-rolled mouse-drag remains: no `addEventListener('mousedown'…` and
//      no HTML5 drag-source (`draggable` / `onDragStart`) in the drag surfaces.
//      A mouse-only engine silently drops touch support — this is that regression.
//   4. The apps don't re-litter the activation magic numbers (4 / 500 / 5) as raw
//      literals — they reference the primitive's exported names.
//
// Run:  node test/drag.mjs        (wired as `pnpm check:drag`, folded into
//                                  `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const PRIMITIVE = 'packages/ui/src/usePointerDrag.ts';
const CONSUMERS = {
  'calendar drop-layer': 'packages/cards/src/CalendarDragProvider.tsx',
  'ORDECK HudGrid': 'apps/ordeck/src/hud/HudGrid.tsx',
  'ORDECK workshop canvas': 'apps/ordeck/src/workshop/EditorCanvas.tsx',
  'ORDECK widget tray': 'apps/ordeck/src/hud/WidgetTray.tsx',
};
// Where a forked drag engine would most plausibly regrow.
const SURFACES = [
  'packages/cards/src/CalendarDragProvider.tsx',
  'packages/cards/src/WeekView.tsx',
  'packages/cards/src/CalendarView.tsx',
  'packages/cards/src/DayView.tsx',
  'apps/ordeck/src/hud/HudGrid.tsx',
  'apps/ordeck/src/hud/WidgetTray.tsx',
  'apps/ordeck/src/workshop/EditorCanvas.tsx',
  'apps/beigeboard/src/providers/DragProvider.tsx',
];

// ── 1. The primitive exports the activation constants ───────────────────────
const prim = read(PRIMITIVE);
const NEEDED = ['usePointerDrag', 'DRAG_THRESHOLD_PX', 'HOLD_MS', 'HOLD_CANCEL_PX'];
const missing = NEEDED.filter((n) => !new RegExp(`export\\b[^\\n]*\\b${n}\\b`).test(prim));
if (missing.length === 0) ok('usePointerDrag exports usePointerDrag + DRAG_THRESHOLD_PX/HOLD_MS/HOLD_CANCEL_PX');
else fail(`usePointerDrag is missing exports: ${missing.join(', ')} — the one gesture source is incomplete`);

// ── 2. Both drop-layers consume the shared primitive ────────────────────────
for (const [label, path] of Object.entries(CONSUMERS)) {
  const src = read(path);
  const importsIt = /import\s*\{[^}]*\busePointerDrag\b[^}]*\}\s*from\s*['"]@jkos\/ui['"]/.test(src);
  if (importsIt) ok(`${label} imports usePointerDrag from @jkos/ui`);
  else fail(`${label} (${path}) does not import usePointerDrag from @jkos/ui — it forked its own engine`);
}

// ── 3. No hand-rolled mouse-drag / HTML5 drag-source survives ───────────────
for (const path of SURFACES) {
  const src = read(path);
  if (/addEventListener\(\s*['"]mouse(down|move|up)['"]/.test(src)) {
    fail(`${path} hand-rolls document mouse listeners — that engine is mouse-only (no touch)`);
  }
  // `draggable` / onDragStart = native HTML5 DnD, the flaky-on-phones path we removed.
  if (/\bdraggable=\{|\bonDragStart=/.test(src)) {
    fail(`${path} uses HTML5 drag-and-drop (draggable/onDragStart) instead of usePointerDrag`);
  }
}
ok('no addEventListener("mouse…") or HTML5 draggable/onDragStart in any drag surface');

// ── 4. Apps reference the constants by name, not as re-littered literals ─────
// HudGrid must not redefine its own HOLD_MS / cancel threshold — it imports them.
const hud = read('apps/ordeck/src/hud/HudGrid.tsx');
if (/const\s+HOLD_MS\s*=/.test(hud) || /const\s+MOVE_CANCEL_PX\s*=/.test(hud)) {
  fail('HudGrid redefines HOLD_MS / MOVE_CANCEL_PX locally instead of importing from @jkos/ui');
} else if (/\bHOLD_MS\b/.test(hud) && /\bHOLD_CANCEL_PX\b/.test(hud)) {
  ok('HudGrid references HOLD_MS / HOLD_CANCEL_PX from the primitive (no local redef)');
} else {
  fail('HudGrid no longer references the shared hold constants — activation may have drifted');
}
// The calendar drop-layer must build its activation on the exported names.
const cal = read('packages/cards/src/CalendarDragProvider.tsx');
if (/\bDRAG_THRESHOLD_PX\b/.test(cal) && /\bHOLD_MS\b/.test(cal)) {
  ok('CalendarDragProvider builds activation from DRAG_THRESHOLD_PX / HOLD_MS');
} else {
  fail('CalendarDragProvider hardcodes its activation thresholds instead of using the exported names');
}

if (failed) {
  console.error(`\n✗ drag conformance: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('\n✓ drag conformance: one gesture engine, mobile-ready, no forks');
