#!/usr/bin/env node
/**
 * build-design-page.mjs — assemble the jkOS design-system reference page.
 *
 * Splices the CANONICAL design tokens (packages/design/tokens/hub.css) verbatim
 * into design-template.html (replacing the `/*__HUB_CSS__*\/` marker inside its
 * <style id="hub-tokens"> block) and writes the self-contained result to
 * apps/jkauth/public/design.html — served at /design (jkAuth static root).
 *
 * Inlining (rather than <link>-ing a mirror) keeps the page self-contained: it
 * renders the real system on staging, as an Artifact, and opened as a local file.
 * The tradeoff is that it is a SNAPSHOT — rerun this after any hub.css change so
 * the reference can't drift:
 *
 *   node apps/jkauth/scripts/build-design-page.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const hubCss = readFileSync(resolve(repoRoot, 'packages/design/tokens/hub.css'), 'utf8');
const template = readFileSync(resolve(here, 'design-template.html'), 'utf8');

const MARKER = '/*__HUB_CSS__*/';
if (!template.includes(MARKER)) {
  console.error(`[design-page] marker ${MARKER} not found in template`);
  process.exit(1);
}

// Trim the file header comment from hub.css (keeps the page's own header the
// single explanation) and indent nothing — CSS is fine flush inside the block.
const out = template.replace(MARKER, hubCss.trimEnd());

const dest = resolve(here, '..', 'public', 'design.html');
writeFileSync(dest, out);
console.log(`[design-page] wrote ${dest} (${out.length.toLocaleString()} bytes, hub.css ${hubCss.length.toLocaleString()})`);
