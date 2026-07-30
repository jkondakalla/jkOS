// Overlay-panel conformance — keeps BeigeBoard's detail panel an OVERLAY on the
// app-shell grid instead of a member of it.
//
// This is a regression gate for a bug that has now shipped TWICE, both times from
// the same root cause: the panel was written as a grid item sharing the content
// cell with <main>.
//
//   1st  It took a transform-animated entrance class WITH a fill-mode. A transform
//        "in effect" makes an element a containing block, so fixed-position popups
//        it hosted mispositioned. (Fix: .view-enter/.panel-enter carry no fill-mode
//        — see the note above them in hub.css.)
//   2nd  It was the only grid child with an EXPLICIT grid-row/grid-column. CSS grid
//        places definite items before auto ones, so the panel claimed row 2 / col 1
//        first, auto-placement found that cell occupied and pushed <main> into an
//        IMPLICIT row 3, and the declared `minmax(0, 1fr)` row 2 collapsed to 0px.
//        The panel mounted, rendered its entire subtree, measured 0px tall, and was
//        invisible — "opening a task" silently did nothing, in every view at once.
//
// Nothing in tsc or the build can see either failure: both files type-check, and
// the panel is present in the DOM. What makes the class of bug impossible is a
// structural rule, and this asserts the four halves of it:
//
//   1. hub.css ships the .jk-panel primitive and it is `position: absolute` —
//      the property that takes the overlay out of BOTH flow and grid placement.
//      Also: the rail/sheet variants exist, and .jk-panel re-enables pointer
//      events (its host layer disables them).
//   2. DetailPanel.tsx renders .jk-panel + exactly one variant, and declares NO
//      grid-placement or self-alignment properties of its own — the inline
//      positioning that caused both bugs cannot grow back.
//   3. App.tsx places EVERY child of the shell grid explicitly. Auto-placement is
//      what turned one definitely-placed sibling into a collapsed row, so <main>
//      in particular must carry its own gridRow.
//   4. App.tsx hosts the panel in a positioned, click-transparent layer that is
//      NOT the keyed <main> (an overlay inside key={view} replays its entrance on
//      every tab switch) — and the .jk-canvas it sits in stays `position: relative`.
//
// Run:  node test/overlay-panel.mjs   (wired as `pnpm check:overlay`, folded into
//                                      `pnpm test:contracts`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failed = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failed++; };
const ok = (msg) => console.log(`✓ ${msg}`);

const stripCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const HUB = 'packages/design/tokens/hub.css';
const PANEL = 'apps/beigeboard/src/components/DetailPanel.tsx';
const APP = 'apps/beigeboard/src/App.tsx';

const hub = stripCss(read(HUB));
const panel = stripTs(read(PANEL));
const app = stripTs(read(APP));

/* ── 1. The primitive exists and is positioned out of the grid ─────────────── */
{
  const rule = hub.match(/^\.jk-panel\s*\{([^}]*)\}/m);
  if (!rule) {
    fail(`${HUB} is missing the .jk-panel rule — the overlay has no primitive to ride`);
  } else if (!/position:\s*absolute/.test(rule[1])) {
    fail(
      '.jk-panel is not `position: absolute`. That property is load-bearing, not styling: ' +
      'it is what keeps the overlay out of grid placement so it cannot collapse a track.',
    );
  } else {
    ok('.jk-panel is position:absolute — out of flow AND out of grid placement');
  }
  if (rule && !/pointer-events:\s*auto/.test(rule[1])) {
    fail('.jk-panel does not set pointer-events:auto — its click-transparent host layer would swallow the panel\'s own clicks');
  } else if (rule) {
    ok('.jk-panel re-enables pointer-events over its click-transparent host');
  }
  for (const variant of ['jk-panel-rail', 'jk-panel-sheet']) {
    if (new RegExp(`^\\.${variant}\\s*\\{`, 'm').test(hub)) ok(`.${variant} variant present`);
    else fail(`${HUB} is missing .${variant} — the desktop rail / narrow bottom-sheet pair must both exist`);
  }
}

/* ── 2. DetailPanel rides the primitive and positions nothing itself ────────── */
{
  if (/className=\{?[^}\n]*\bjk-panel\b/.test(panel)) {
    ok('DetailPanel renders .jk-panel');
  } else {
    fail(`${PANEL} no longer renders the .jk-panel class — it has gone back to positioning itself inline`);
  }
  const hasRail = /jk-panel-rail/.test(panel);
  const hasSheet = /jk-panel-sheet/.test(panel);
  if (hasRail && hasSheet) ok('DetailPanel selects between .jk-panel-rail and .jk-panel-sheet');
  else fail(`${PANEL} must choose between .jk-panel-rail and .jk-panel-sheet (rail=${hasRail}, sheet=${hasSheet})`);

  // The exact shapes that caused bug #2. An overlay never places ITSELF — so the
  // check is scoped to the panel's ROOT tag, not the whole file: `alignSelf` on
  // some inner flex child is ordinary layout and none of this gate's business.
  const rootTag = panel.match(/<aside[\s\S]*?>/);
  if (!rootTag) {
    fail(`${PANEL}: no root <aside> found — this gate is checking the wrong element`);
  } else {
    const BANNED = ['gridRow', 'gridColumn', 'gridArea', 'alignSelf', 'justifySelf'];
    const found = BANNED.filter((p) => new RegExp(`\\b${p}\\s*:`).test(rootTag[0]));
    if (found.length) {
      fail(
        `${PANEL}: the root <aside> declares layout-placement propert${found.length === 1 ? 'y' : 'ies'} ` +
        `${found.join(', ')}. This is bug #2 regrowing: a placed overlay reserves a grid cell, pushes ` +
        '<main> into an implicit row, and collapses the row it was placed in to 0px. Let .jk-panel ' +
        'and its host do the positioning.',
      );
    } else {
      ok('DetailPanel\'s root declares no grid-placement / self-alignment of its own');
    }
  }
}

/* ── 3. Nothing in the shell grid is auto-placed ───────────────────────────── */
{
  if (!/gridTemplateRows/.test(app)) {
    fail(`${APP} no longer declares gridTemplateRows — this gate is checking the wrong shell`);
  } else {
    // <main> is the child auto-placement moved, so it is the one that must be nailed
    // down. Match from `<main` to the end of its style object.
    const mainTag = app.match(/<main[\s\S]*?>/);
    if (!mainTag) {
      fail(`${APP} has no <main> element — this gate is checking the wrong shell`);
    } else if (/gridRow:/.test(mainTag[0])) {
      ok('<main> carries an explicit gridRow — it can no longer be pushed into an implicit row');
    } else {
      fail(
        `${APP}: <main> has no explicit gridRow. It is auto-placed, so any sibling that claims ` +
        'its cell first will displace it into an implicit row and collapse the declared 1fr track. ' +
        'Place every child of the shell grid explicitly.',
      );
    }
    // Every gridColumn in the shell should be paired with a gridRow: a child that
    // pins its column but not its row is exactly the half-placed state that lets
    // auto-placement pick the row for it.
    const cols = (app.match(/gridColumn:/g) || []).length;
    const rows = (app.match(/gridRow:/g) || []).length;
    if (rows >= cols) ok(`shell grid children pin rows as well as columns (${rows} gridRow, ${cols} gridColumn)`);
    else fail(`${APP} has ${cols} gridColumn declaration(s) but only ${rows} gridRow — some child lets auto-placement choose its row`);
  }
}

/* ── 4. The overlay host is positioned, click-transparent, and unkeyed ─────── */
{
  if (/className="jk-canvas jk-canvas-fill"[\s\S]{0,400}?position:\s*'relative'/.test(app)) {
    ok('.jk-canvas keeps position:relative (the panel measures against a positioned ancestor)');
  } else {
    fail(`${APP}: the .jk-canvas shell lost position:relative — an absolutely-positioned overlay inside it would escape to the viewport`);
  }
  // The host wraps <DetailPanel and must be its own layer, not <main>.
  const host = app.match(/<div style=\{\{[^}]*pointerEvents:\s*'none'[^}]*\}\}>[\s\S]{0,900}?<DetailPanel/);
  if (!host) {
    fail(
      `${APP}: <DetailPanel> is not wrapped in a pointerEvents:'none' host layer. Without it the ` +
      'always-mounted overlay layer either eats every click on the view beneath it, or the panel ' +
      'gets hosted in the keyed <main> and replays its entrance on every tab switch.',
    );
  } else if (!/position:\s*'relative'/.test(host[0])) {
    fail(`${APP}: the <DetailPanel> host layer is not position:relative — .jk-panel would pin to the wrong box`);
  } else {
    ok("<DetailPanel> sits in a position:relative, pointerEvents:'none' host layer of its own");
  }
  if (/<main[\s\S]*?<DetailPanel/.test(app) && !/<\/main>[\s\S]*?<DetailPanel/.test(app)) {
    fail(`${APP}: <DetailPanel> is rendered inside <main>, which carries key={view} — it would remount on every tab switch`);
  } else {
    ok('<DetailPanel> is hosted outside the keyed <main>');
  }
}

if (failed) {
  console.error(`\n${failed} overlay-panel conformance check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ overlay-panel conformance: the detail panel overlays the shell grid, it is not a member of it');
