#!/usr/bin/env node
/**
 * build-design-page.mjs — assemble the jkOS design-system reference page.
 *
 * Splices the CANONICAL suite stylesheets verbatim into design-template.html and
 * writes the self-contained result to apps/jkauth/public/design.html — served at
 * /design (jkAuth static root). Two sources, two markers:
 *
 *   packages/design/tokens/hub.css    → `/*__HUB_CSS__*\/`     (tokens + classes)
 *   packages/player/src/ui/player-ui.css → `/*__PLAYER_CSS__*\/`  (the player bar)
 *
 * player-ui.css is the one shared component stylesheet that lives OUTSIDE hub.css
 * (it ships with @jkos/player/ui, which apps' bundlers pull in), so the page has
 * to inline it too or the player section would be the only unrendered element.
 *
 * Inlining (rather than <link>-ing a mirror) keeps the page self-contained: it
 * renders the real system on staging, as an Artifact, and opened as a local file.
 * The tradeoff is that it is a SNAPSHOT — rerun this after any change to either
 * source so the reference can't drift:
 *
 *   node apps/jkauth/scripts/build-design-page.mjs
 *
 * `pnpm check:design` (test/design-page.mjs) fails the suite gate if you forget,
 * and if a shared class exists in hub.css but is nowhere on the page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

/** Assemble the page from the template + the canonical stylesheets. Exported so
 *  the gate can rebuild in memory and diff against the committed file. */
export function buildDesignPage() {
  const template = readFileSync(resolve(here, 'design-template.html'), 'utf8');
  const sources = {
    '/*__HUB_CSS__*/': 'packages/design/tokens/hub.css',
    '/*__PLAYER_CSS__*/': 'packages/player/src/ui/player-ui.css',
  };
  let out = template;
  for (const [marker, path] of Object.entries(sources)) {
    if (!out.includes(marker)) throw new Error(`marker ${marker} not found in design-template.html`);
    out = out.replace(marker, readFileSync(resolve(repoRoot, path), 'utf8').trimEnd());
  }
  return out;
}

export const DESIGN_PAGE_PATH = resolve(here, '..', 'public', 'design.html');

// Only write when run directly — importing this from the gate must have no effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let out;
  try {
    out = buildDesignPage();
  } catch (err) {
    console.error(`[design-page] ${err.message}`);
    process.exit(1);
  }
  writeFileSync(DESIGN_PAGE_PATH, out);
  console.log(`[design-page] wrote ${DESIGN_PAGE_PATH} (${out.length.toLocaleString()} bytes)`);
}
